/**
 * Push a skeleton commit on a cadence against the replayed timeline and record
 * when rejection first arrives.
 *
 * The timeline replayed is the recorded collision of 2026-07-26: a pass cloned
 * at 00:47Z, a different session pushed the same feature at 02:56Z, and the
 * pass learned of it at 08:47Z when its one and only push was rejected. The
 * bar (the vault's assumption test): with a cadence of at most 30 minutes, the
 * first rejection must arrive no later than 30 minutes after the colliding
 * commit lands — bounding the loss at roughly 3.5 hours, not 8.
 *
 * The git here is real: a bare remote, two clones, and the same `gitCommit` /
 * `gitPush` surface the product ships. The rejection measured is git refusing
 * a non-fast-forward push, not this suite agreeing with itself.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { simpleGit } from "simple-git";
import { gitCommit, gitPush } from "../../src/git/safe-git.js";
import {
  pushSchedule,
  replayCollisionWindow,
  RECORDED_COLLISION,
  type ReplayDrivers,
} from "../../src/loop/early-push.js";

const MINUTE = 60_000;

let tmp: string;
let bare: string;
let loser: string;
let winner: string;

/** A clone that can commit anywhere, including a runner with no git identity. */
async function clone(name: string): Promise<string> {
  const dir = path.join(tmp, name);
  await simpleGit(tmp).clone(bare, dir);
  const g = simpleGit(dir);
  await g.addConfig("user.email", `${name}@replay.local`);
  await g.addConfig("user.name", name);
  return dir;
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ost-early-push-"));
  bare = path.join(tmp, "remote.git");
  fs.mkdirSync(bare);
  await simpleGit(bare).raw(["init", "--bare", "--initial-branch=main"]);

  // Seed the shared branch, as the repo both sessions cloned already had history.
  const seed = await clone("seed");
  fs.writeFileSync(path.join(seed, "README.md"), "the shared repository\n");
  await gitCommit(seed, "chore: initial state");
  await simpleGit(seed).push("origin", "main");

  loser = await clone("loser");
  winner = await clone("winner");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * The two timeline operations, on real repos. The winner pulls before landing:
 * on a cadence the losing pass's skeleton commits are already on the branch,
 * and the colliding commit lands on top of them — the replay holds the
 * recorded fact fixed (the commit landed at 02:56Z) and varies only the
 * cadence, which is the counterfactual under test.
 */
function drivers(): ReplayDrivers {
  let skeletonPushes = 0;
  return {
    async landCollidingCommit() {
      await simpleGit(winner).pull("origin", "main");
      fs.writeFileSync(path.join(winner, "feature.md"), "the same feature, built twice\n");
      await gitCommit(winner, "feat: the colliding commit");
      await gitPush(winner);
    },
    async pushAsPass() {
      skeletonPushes += 1;
      fs.writeFileSync(path.join(loser, "skeleton.md"), `building: push ${skeletonPushes}\n`);
      await gitCommit(loser, `wip: skeleton push ${skeletonPushes}`);
      try {
        await gitPush(loser);
        return { accepted: true };
      } catch (e) {
        return { accepted: false, detail: String(e) };
      }
    },
  };
}

describe("the status quo, replayed faithfully", () => {
  test("one push at the end meets the rejection eight hours in — the recorded loss", async () => {
    const result = await replayCollisionWindow(RECORDED_COLLISION, null, drivers());

    expect(result.pushes).toHaveLength(1);
    expect(result.pushes[0].accepted).toBe(false);
    expect(result.firstRejectionAt).toBe("2026-07-26T08:47:00.000Z");

    // Eight hours after the pass started, five hours fifty-one minutes after
    // the collision existed to be found.
    expect(Date.parse(result.firstRejectionAt!) - RECORDED_COLLISION.passStartedAt).toBe(480 * MINUTE);
    expect(result.rejectionDelayMs).toBe(351 * MINUTE);
    expect(result.rejectionDelayMs!).toBeGreaterThan(30 * MINUTE);
  });
});

describe("a 30-minute cadence against the same timeline", () => {
  test("rejection arrives within 30 minutes of the colliding commit landing", async () => {
    const result = await replayCollisionWindow(RECORDED_COLLISION, 30 * MINUTE, drivers());

    // The bar from the assumption test, verbatim: no later than 30 minutes
    // after the colliding commit lands at 02:56Z.
    expect(result.firstRejectionAt).toBe("2026-07-26T03:17:00.000Z");
    expect(result.rejectionDelayMs).toBe(21 * MINUTE);
    expect(result.rejectionDelayMs!).toBeLessThanOrEqual(30 * MINUTE);

    // Every push before the colliding commit succeeded and told the pass
    // nothing — the skeleton is a tripwire, not a detector of the future.
    const before = result.pushes.filter((p) => Date.parse(p.at) < RECORDED_COLLISION.collidingCommitAt);
    expect(before.length).toBe(5); // 00:47, 01:17, 01:47, 02:17, 02:47
    expect(before.every((p) => p.accepted)).toBe(true);

    // The replay stops at the first rejection: finding out is the point.
    expect(result.pushes).toHaveLength(6);

    // The rejection is git's own non-fast-forward refusal, not a driver error.
    expect(result.pushes[5].detail).toMatch(/rejected|fetch first|non-fast-forward|failed to push/i);

    // And it fired for the right reason: the colliding commit holds the branch,
    // the losing pass's sixth commit never landed.
    const remoteTip = (await simpleGit(bare).raw(["log", "-1", "--format=%s", "main"])).trim();
    expect(remoteTip).toBe("feat: the colliding commit");
  });
});

describe("what the bound honestly is", () => {
  test("no cadence makes the loss 'minutes' from the start of the pass", () => {
    // The pass began 129 minutes before anything existed to collide with, and
    // every push in that window succeeds. The earliest any cadence can be
    // rejected is the first tick at or after the colliding commit — so the
    // loss measured from the start of the pass is never under 129 minutes.
    // The solution node's title promises "minutes"; this is what it may claim.
    const head = RECORDED_COLLISION.collidingCommitAt - RECORDED_COLLISION.passStartedAt;
    expect(head).toBe(129 * MINUTE);
    for (const cadence of [1 * MINUTE, 5 * MINUTE, 30 * MINUTE]) {
      const ticks = pushSchedule(RECORDED_COLLISION.passStartedAt, RECORDED_COLLISION.finalPushAt, cadence);
      const firstRejectable = ticks.find((t) => t >= RECORDED_COLLISION.collidingCommitAt)!;
      expect(firstRejectable - RECORDED_COLLISION.passStartedAt).toBeGreaterThanOrEqual(129 * MINUTE);
      // What the cadence does buy: rejection within one cadence of the landing.
      expect(firstRejectable - RECORDED_COLLISION.collidingCommitAt).toBeLessThanOrEqual(cadence);
    }
  });

  test("the schedule starts with the skeleton push and always ends with the real one", () => {
    const ticks = pushSchedule(0, 100 * MINUTE, 30 * MINUTE);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(100 * MINUTE);
    expect(pushSchedule(0, 60 * MINUTE, 30 * MINUTE)).toEqual([0, 30 * MINUTE, 60 * MINUTE]);
    expect(() => pushSchedule(0, 10, 0)).toThrow(/positive/);
    expect(() => pushSchedule(10, 0, 5)).toThrow(/end before it starts/);
  });
});
