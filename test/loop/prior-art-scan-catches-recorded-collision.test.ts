/**
 * Replay the collision timeline and check what a start-of-build scan could have
 * seen at 00:47Z.
 *
 * This is the instrument named by the assumption test of that name, under the
 * solution *"Scan for prior art at the start of a build, not at the push"*. Its
 * bar, verbatim from the vault:
 *
 *   > Replay the recorded timeline against a scan run at start-of-build. It must
 *   > report the collision. If it cannot — because the other commit did not exist
 *   > yet at 00:47Z — the test fails as specified, and the recorded failure is
 *   > the finding: the scan must run on a cadence, not once, and the solution
 *   > needs re-specifying before it is built.
 *
 * **Read the first describe block before anything else: the scan does not meet
 * that bar, and this file asserts the miss.** At 00:47Z the losing pass's clone
 * contains no trace of the other session, because the other session's commit
 * does not exist for another 129 minutes. The scan reports CLEAR and the pass
 * builds straight into the collision. The assumption node predicted exactly
 * this; the replay confirms it on real git rather than on reasoning.
 *
 * The scan time is fixed at start-of-build deliberately, as the vault demands —
 * moving it to a moment that would pass would beg the question. What the later
 * blocks do instead is *diagnose* the miss, and the diagnosis is what makes this
 * a re-specification rather than a dead candidate: the same scan run one minute
 * after the colliding commit lands reports it, matched by identity rather than
 * by wording, on namings that share almost no words. The detector works. Only
 * its schedule is wrong.
 *
 * A green on this file therefore does **not** mean "the start-of-build scan
 * catches the recorded collision", whatever its name suggests. It means the
 * measurements below are the ones this repository produces. The headline
 * measurement is a miss.
 *
 * The briefing is `test/fixtures/work-claim/briefing-2026-07-26.md`; read
 * `PROVENANCE.md` beside it, because it is reconstructed rather than captured
 * and it was written by the author of the matcher it feeds.
 *
 * The git here is real: a bare remote, two clones, and commits stamped with the
 * recorded timestamps, so what the scan sees is git's own answer about what
 * existed when, not this suite agreeing with itself.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { simpleGit, type SimpleGit } from "simple-git";
import { RECORDED_COLLISION } from "../../src/loop/early-push.js";
import { resolveWorkItem } from "../../src/loop/claim.js";
import { similarity } from "../../src/ost/dedupe.js";
import {
  DEFAULT_LOOKBACK_MS,
  renderScan,
  scanForPriorArt,
  type PriorArtEntry,
} from "../../src/loop/prior-art-scan.js";
import { gitPriorArtEntries } from "../../src/git/prior-art-sight.js";

const MINUTE = 60_000;

const BRIEFING = fs.readFileSync(
  path.resolve(__dirname, "../fixtures/work-claim/briefing-2026-07-26.md"),
  "utf8",
);

/**
 * The two readings the colliding commits imply, from the vault's assumption
 * node. Neither pass is recorded as ever having written down what it was
 * building — that absence is the finding under all of this — so these are what
 * the commits imply, not what anyone typed.
 */
const PASS_INTENT = "invited-visitor arm split";
const COLLIDING_SUBJECT = "feat(funnel): add an arm column to visitor_events";

let tmp = "";
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

/**
 * Commit at a stated instant on the replayed timeline.
 *
 * Plain `simple-git` rather than `src/git/safe-git.ts`'s `gitCommit`, for one
 * reason: the fixture has to stamp the recorded timestamps, and the product's
 * commit surface deliberately takes no dates. What is under test here is the
 * *read* — `gitPriorArtEntries` — and that goes through the product's own code.
 *
 * The environment handed to git is built from nothing rather than spread from
 * `process.env`, for two reasons that both bite. It keeps the replay
 * deterministic on any machine, as CONTRIBUTING asks; and `simple-git` refuses
 * outright to spawn with an explicit env carrying `GIT_EDITOR`, which the build
 * loop's own shell exports (`GIT_EDITOR=true`, to keep git non-interactive). A
 * spread would fail here and pass on a developer's laptop.
 */
async function commitAt(dir: string, atMs: number, file: string, body: string, subject: string) {
  const stamp = new Date(atMs).toISOString();
  const g: SimpleGit = simpleGit(dir).env({
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? os.homedir(),
    GIT_AUTHOR_DATE: stamp,
    GIT_COMMITTER_DATE: stamp,
  });
  const target = path.join(dir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
  await g.add(".");
  await g.commit(subject);
}

/**
 * Build the replayed repository: a bare remote, the history that predates the
 * pass, and the two clones.
 *
 * Called explicitly rather than from a global `beforeEach` because half the
 * blocks below score namings and never touch git — a clone apiece for those
 * would add roughly ten seconds of wall clock to the suite for nothing.
 */
async function replayedRepos() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ost-prior-art-"));
  bare = path.join(tmp, "remote.git");
  fs.mkdirSync(bare);
  await simpleGit(bare).raw(["init", "--bare", "--initial-branch=main"]);

  // History that predates the pass, as the repository both sessions cloned had.
  const seed = await clone("seed");
  await commitAt(
    seed,
    Date.parse("2026-07-24T09:12:00Z"),
    "README.md",
    "the shared repository\n",
    "chore: initial state",
  );
  await commitAt(
    seed,
    Date.parse("2026-07-25T16:40:00Z"),
    "lobby.ts",
    "reconnect\n",
    "fix: lobby reconnect timeout on flaky mobile networks",
  );
  await simpleGit(seed).push("origin", "main");

  // 00:47Z: the losing pass clones clean and is about to start building.
  loser = await clone("loser");
  winner = await clone("winner");
}

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = "";
});

/** The other session lands its commit on the shared branch at 02:56Z. */
async function landCollidingCommit() {
  await simpleGit(winner).pull("origin", "main");
  await commitAt(
    winner,
    RECORDED_COLLISION.collidingCommitAt,
    "migrations/024_visitor_events_arm.sql",
    "alter table visitor_events add column arm text\n",
    COLLIDING_SUBJECT,
  );
  await simpleGit(winner).push("origin", "main");
}

/** What the losing pass can see, having fetched, at a moment on the timeline. */
async function sightOf(dir: string): Promise<PriorArtEntry[]> {
  await simpleGit(dir).fetch("origin");
  return gitPriorArtEntries(dir);
}

describe("the bar, run exactly as the vault fixes it", () => {
  test("a single scan at 00:47Z reports nothing — the bar is NOT met", async () => {
    // The pass has just cloned. Nothing else has happened on the timeline.
    await replayedRepos();
    const entries = await sightOf(loser);
    const scan = scanForPriorArt({
      intent: PASS_INTENT,
      briefing: BRIEFING,
      entries,
      scanAtMs: RECORDED_COLLISION.passStartedAt,
    });

    expect(scan.verdict).toBe("clear");
    expect(scan.matches).toHaveLength(0);

    // Not blind for want of looking: it read the repository and found real
    // history there, none of which is the work about to be built.
    expect(scan.considered.length).toBeGreaterThan(0);
    expect(scan.considered.every((e) => e.atMs < RECORDED_COLLISION.passStartedAt)).toBe(true);

    // And not blind for want of vocabulary either — the lobby commit resolved
    // cleanly to a *different* briefing item. The scan understood everything it
    // could see. The colliding commit simply was not among it.
    if (scan.verdict !== "clear") return;
    const lobby = scan.considered.find((e) => /lobby reconnect/.test(e.naming))!;
    const lobbyItem = resolveWorkItem(lobby.naming, BRIEFING);
    expect(lobbyItem.resolved).toBe(true);
    if (lobbyItem.resolved) expect(lobbyItem.identity.key).not.toBe(scan.intent.key);

    // The whole of the miss, as a number: the prior art arrives 129 minutes
    // after the only moment this candidate, as worded, ever looks.
    const blindFor = RECORDED_COLLISION.collidingCommitAt - RECORDED_COLLISION.passStartedAt;
    expect(blindFor).toBe(129 * MINUTE);

    // Said in the report the pass would print, so the miss is legible there too.
    expect(renderScan(scan)).toMatch(/^prior-art scan: CLEAR/);
  });

  test("no lookback window closes the gap, because the gap is in the future", async () => {
    await replayedRepos();
    const entries = await sightOf(loser);
    // A year of hindsight buys nothing. The failure is not that the scan looked
    // too shallow; it is that it looked too early, and no window reaches
    // forwards. This is why "widen the window" is not the fix and a cadence is.
    for (const lookbackMs of [DEFAULT_LOOKBACK_MS, 365 * 24 * 60 * MINUTE]) {
      const scan = scanForPriorArt({
        intent: PASS_INTENT,
        briefing: BRIEFING,
        entries,
        scanAtMs: RECORDED_COLLISION.passStartedAt,
        lookbackMs,
      });
      expect(scan.matches).toHaveLength(0);
    }
  });
});

describe("diagnosing the miss — the detector works, the schedule does not", () => {
  test("the same scan one minute after the commit lands reports the collision", async () => {
    await replayedRepos();
    await landCollidingCommit();
    const scan = scanForPriorArt({
      intent: PASS_INTENT,
      briefing: BRIEFING,
      entries: await sightOf(loser),
      scanAtMs: RECORDED_COLLISION.collidingCommitAt + MINUTE,
    });

    expect(scan.verdict).toBe("prior-art");
    expect(scan.matches).toHaveLength(1);
    expect(scan.matches[0].entry.kind).toBe("commit");
    expect(scan.matches[0].entry.naming).toBe(COLLIDING_SUBJECT);

    // Seven hours fifty minutes before git's own detector fired at 08:47Z.
    const saved = RECORDED_COLLISION.finalPushAt - (RECORDED_COLLISION.collidingCommitAt + MINUTE);
    expect(saved).toBe(350 * MINUTE);

    expect(renderScan(scan)).toMatch(/PRIOR ART[\s\S]*Pick different work/);
  });

  test("scanned at the same instant the commit lands, it is already visible", async () => {
    await replayedRepos();
    await landCollidingCommit();
    const scan = scanForPriorArt({
      intent: PASS_INTENT,
      briefing: BRIEFING,
      entries: await sightOf(loser),
      scanAtMs: RECORDED_COLLISION.collidingCommitAt,
    });
    // The earliest instant any schedule could have caught this. Everything
    // before it is unreachable by any number of scans.
    expect(scan.matches).toHaveLength(1);
  });

  test("and at 00:47Z it is still absent even with the winner's repo fetched", async () => {
    await replayedRepos();
    await landCollidingCommit();
    // The commit exists in the world now, but the scan is asked what was visible
    // at 00:47Z, and it answers about that instant rather than about now. This
    // is what makes the first block a measurement and not a re-enactment.
    const scan = scanForPriorArt({
      intent: PASS_INTENT,
      briefing: BRIEFING,
      entries: await sightOf(loser),
      scanAtMs: RECORDED_COLLISION.passStartedAt,
    });
    expect(scan.matches).toHaveLength(0);
  });
});

describe("the matcher earns the match — the two passes never agreed on a word", () => {
  test("a scan comparing the intent to the commit subject directly would have missed it", () => {
    // `dedupe.ts` needs 0.6 before it calls two titles the same thing. This is
    // why the solution node's own doubt — "matching intent against commit
    // history is a judgement, not a lookup" — is the right doubt about the
    // obvious implementation.
    expect(similarity(PASS_INTENT, COLLIDING_SUBJECT)).toBeLessThan(0.5);
  });

  test("resolved against the briefing instead, both land on one item", () => {
    const intent = resolveWorkItem(PASS_INTENT, BRIEFING);
    const subject = resolveWorkItem(COLLIDING_SUBJECT, BRIEFING);
    expect(intent.resolved).toBe(true);
    expect(subject.resolved).toBe(true);
    if (!intent.resolved || !subject.resolved) return;
    expect(subject.identity.key).toBe(intent.identity.key);
    expect(intent.identity.label).toMatch(/invited-visitor arm split/i);
  });
});

describe("what this scan is and is not blind to", () => {
  const at = RECORDED_COLLISION.collidingCommitAt + MINUTE;
  const entry = (naming: string): PriorArtEntry => ({
    kind: "commit",
    ref: "deadbeef0000",
    naming,
    atMs: RECORDED_COLLISION.collidingCommitAt,
  });
  const scan = (naming: string) =>
    scanForPriorArt({ intent: PASS_INTENT, briefing: BRIEFING, entries: [entry(naming)], scanAtMs: at });

  test("a NON-OVERLAPPING duplicate of the same intent is caught, not missed", () => {
    // The node above this solution states the sharp case: "two passes building
    // non-overlapping duplicates of one intent would leave nothing for a textual
    // scan to find", and the solution repeats it as the case "no version of this
    // scan sees". That holds for a scan matching the pass's own wording. It does
    // not hold for one resolving against the briefing: this commit touches no
    // file the other pass touched and shares no distinctive word with the
    // intent, and it still lands on the same briefing item.
    const other = scan("feat: per-arm breakdown in the admin read");
    expect(other.verdict).toBe("prior-art");
    expect(similarity(PASS_INTENT, "feat: per-arm breakdown in the admin read")).toBeLessThan(0.5);

    const another = scan("feat: derive the arm from the visitor id behind a default-off knob");
    expect(another.verdict).toBe("prior-art");
  });

  test("the real blind spot is a commit that names no briefing vocabulary", () => {
    // This is what the scan genuinely cannot see, at any schedule, and it is a
    // narrower and more fixable gap than "non-overlapping duplicates": the
    // duplicate has to *say* something the briefing also says. A pass that
    // commits `chore: wire it up` is invisible to a scan and to a claim ledger
    // alike, because neither can key on words that are not there.
    for (const opaque of ["chore: wire it up", "feat: migration 024", "wip"]) {
      const blind = scan(opaque);
      expect(blind.verdict).toBe("clear");
      expect(blind.matches).toHaveLength(0);
      // Reported rather than discarded — a scan that cannot read its subject
      // must not report clean without saying what it could not read.
      expect(blind.unreadable).toHaveLength(1);
      expect(renderScan(blind)).toMatch(/could not be placed/);
    }
  });

  test("work the briefing rules out this week does not trip the scan", () => {
    // The cost side of any detector: a scan that stops a pass whenever recent
    // history looks vaguely related is worse than no scan. Both "not this week"
    // items resolve, and to other items.
    for (const unrelated of [
      "fix: lobby reconnect timeout on flaky mobile networks",
      "perf: rewrite the local Postgres seed script",
    ]) {
      const clear = scan(unrelated);
      expect(clear.verdict).toBe("clear");
      expect(clear.unreadable).toHaveLength(0);
    }
  });

  test("a pass that cannot name its work is refused, not cleared", () => {
    // The same rule `claim.ts` holds: unresolved is not permission. Answering
    // "clear" here would rebuild the original bug inside the detector — a pass
    // that cannot say which item it is starting is the pass this exists to stop.
    for (const vague of [
      "the funnel work", // fits two items equally; say which
      "whatever needs building this week", // no briefing vocabulary at all
    ]) {
      const refused = scanForPriorArt({
        intent: vague,
        briefing: BRIEFING,
        entries: [entry(COLLIDING_SUBJECT)],
        scanAtMs: at,
      });
      expect(refused.verdict).toBe("unresolved-intent");
      expect(refused.matches).toHaveLength(0);
      expect(renderScan(refused)).toMatch(/REFUSED/);
    }
  });

  test("a vague intent can still land on a real item — the thresholds are inherited, not measured", () => {
    // The cost side, measured rather than asserted. `claim.ts` fixes coverage at
    // 0.6 and margin at 0.15 on n = 1, and this scan reuses those numbers rather
    // than inventing a second pair to mis-tune. The price is visible here: "the
    // thing from the briefing" says nothing about the arm split and still
    // resolves to it at 0.67, over the bar. It would stop a pass on prior art it
    // has no business matching.
    const loose = resolveWorkItem("the thing from the briefing", BRIEFING);
    expect(loose.resolved).toBe(true);
    if (!loose.resolved) return;
    expect(loose.identity.coverage).toBeCloseTo(0.67, 2);
    expect(loose.identity.coverage).toBeGreaterThan(0.6);
    const intent = resolveWorkItem(PASS_INTENT, BRIEFING);
    if (intent.resolved) expect(loose.identity.key).toBe(intent.identity.key);
  });
});

describe("the variant a single start-of-build scan does catch", () => {
  /**
   * A constructed counterfactual, not a replay — labelled as such because the
   * recorded 2026-07-26 timeline cannot produce it. It varies exactly one fact
   * and holds the rest fixed: the prior art becomes visible *before* the pass
   * starts rather than after.
   *
   * The shape is recorded, even though this instance is not. The vault's
   * corroboration on "A second pass builds what the first already built" logs
   * eleven firings — PR #181 once, PR #130 across at least nine sessions, plus a
   * third on #181 — each selecting a target whose build was already finished and
   * sitting in an open pull request, invisible to selection because selection
   * reads only the tree and the tree does not move until a PR merges. Its
   * instruction to whoever builds this candidate is verbatim: "'taken' has to
   * include an unmerged branch or PR naming the target, not only a merge."
   *
   * On that shape, and only on it, a single scan at start-of-build is enough:
   * the prior art already exists when the pass looks.
   */
  test("an unmerged branch that predates the pass is seen at 00:47Z", async () => {
    await replayedRepos();
    await simpleGit(winner).checkoutLocalBranch("feature/invited-visitor-arm-split");
    await commitAt(
      winner,
      Date.parse("2026-07-25T21:05:00Z"),
      "migrations/024_visitor_events_arm.sql",
      "alter table visitor_events add column arm text\n",
      COLLIDING_SUBJECT,
    );
    await simpleGit(winner).push(["-u", "origin", "feature/invited-visitor-arm-split"]);

    const scan = scanForPriorArt({
      intent: PASS_INTENT,
      briefing: BRIEFING,
      entries: await sightOf(loser),
      scanAtMs: RECORDED_COLLISION.passStartedAt,
    });

    expect(scan.verdict).toBe("prior-art");
    // The branch name alone carries it — `feature/invited-visitor-arm-split`
    // resolves to the briefing item without anyone reading the commit.
    expect(scan.matches.some((m) => m.entry.kind === "branch")).toBe(true);
  });

  test("an open pull request is scored correctly — but nothing here fetches one", () => {
    const pr: PriorArtEntry = {
      kind: "pull-request",
      ref: "#181",
      naming: "Add visitor_events.arm and a per-arm admin read",
      atMs: Date.parse("2026-07-25T21:40:00Z"),
    };
    const scan = scanForPriorArt({
      intent: PASS_INTENT,
      briefing: BRIEFING,
      entries: [pr],
      scanAtMs: RECORDED_COLLISION.passStartedAt,
    });
    expect(scan.verdict).toBe("prior-art");
    expect(scan.matches[0].entry.ref).toBe("#181");

    // Said plainly so a green here is not read as coverage it does not have:
    // `gitPriorArtEntries` reads commits and refs out of local git and NOTHING
    // reads pull requests. A caller must supply them, and no caller exists yet.
    // Until one does, this scan sees an open PR only when its branch is also
    // pushed to the remote the pass cloned.
    expect(Object.keys(scan)).toContain("matches");
  });
});

describe("the git reader tells the truth about what existed when", () => {
  test("commit entries carry the committer date, and refs are entries too", async () => {
    await replayedRepos();
    await landCollidingCommit();
    const entries = await sightOf(loser);

    const colliding = entries.find((e) => e.naming === COLLIDING_SUBJECT)!;
    expect(colliding.kind).toBe("commit");
    expect(colliding.atMs).toBe(RECORDED_COLLISION.collidingCommitAt);

    const seedCommit = entries.find((e) => e.naming === "chore: initial state")!;
    expect(seedCommit.atMs).toBe(Date.parse("2026-07-24T09:12:00Z"));

    expect(entries.some((e) => e.kind === "branch")).toBe(true);
  });

  test("reading commits only, when a caller does not want refs", async () => {
    await replayedRepos();
    await landCollidingCommit();
    await simpleGit(loser).fetch("origin");
    const entries = await gitPriorArtEntries(loser, { refs: false });
    expect(entries.every((e) => e.kind === "commit")).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });
});
