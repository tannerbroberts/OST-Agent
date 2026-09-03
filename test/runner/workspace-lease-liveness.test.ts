/**
 * Kill a lease holder mid-build and check the workspace is reclaimed without the
 * TTL elapsing — the assumption test beneath "The workspace is leased, and the
 * next run reclaims a lease whose holder is gone".
 *
 * **The bar, pre-committed by the node and restated here before anything was
 * built:** a holder killed with SIGKILL is *detected* dead and its workspace
 * reclaimed in under one firing interval, well short of the TTL; and across 20
 * trials against a live but slow holder, the workspace is reclaimed **zero**
 * times. One false reclaim of a live holder refutes the assumption outright.
 *
 * The asymmetry is the node's and it is deliberate: a missed death costs one
 * delayed firing, a false reclaim destroys a healthy run's work. So the second
 * bar admits no failures at all where the first is merely bounded.
 *
 * ## The stated bar is looser than the one asserted here, and the reason matters
 *
 * "Under one firing interval, well short of the TTL" reads as two different
 * numbers. In this vault's own `ost.config.yaml` they are the same one:
 * `cadence: "1h"` and `lockTtlMinutes: 60`. So the node's bar, taken literally,
 * is satisfied by anything under an hour — including a mechanism that reclaims
 * at minute fifty-nine by pure timeout, which is exactly the outcome the
 * assumption was written to distinguish itself from. A wall-clock bar cannot
 * separate detection from assumption when the two clocks coincide.
 *
 * So this file asserts the literal bar AND the thing the bar was reaching for,
 * and the second one is not a time at all: `assumed` must be `false` and the
 * evidence must be `pid-gone`. That is the difference between "we noticed" and
 * "we waited", stated as a property of the verdict rather than inferred from a
 * stopwatch.
 *
 * ## The literal bar is asserted against the injected clock, not the machine's
 *
 * The node's bar is about the LEASE's age when it is reclaimed — that a holder
 * dead at minute one does not block the workspace until minute sixty. That is a
 * property of the mechanism, so it is checked against the clock the mechanism is
 * given: the reclaim below is judged at `t0 + 1_000`, one second into a
 * sixty-minute TTL, and it succeeds. No load on any machine can move that
 * number, and no machine's speed is being asserted.
 *
 * The wall-clock cost of the reclaim itself is measured and **reported**, never
 * asserted on. Dropping that assertion was a decision, not an omission: an
 * implementation that reached its verdict through a clock instead of through the
 * holder is already convicted by `evidence` and `assumed` above, an
 * implementation slow enough to matter is convicted by the suite's own
 * `testTimeout`, and what an absolute wall-clock budget would add on top of
 * those two is a gate a busy laptop can fail — which this repository has already
 * paid for once (`test/loop/inherited-tree-build-check.test.ts`, 38.264 s
 * against a 30 s bar, green alone) and whose isolation census came out refuted
 * at 34%. The elapsed number reaches a reader through the failure message on the
 * assertion that actually decides the case.
 *
 * ## Every process here is real
 *
 * Nothing about liveness can be faked and still mean anything: a stubbed
 * `pidAlive` would test this file's opinion of the holder, not the holder. So
 * the holders are real `node` children, the kill is a real SIGKILL, and the
 * reclaim path is the one a firing runs. The clock is the only injected thing —
 * `now` is passed everywhere, because a test that waits out a TTL to prove a TTL
 * was not waited out would be absurd.
 *
 * **The children are awaited to exit, not merely signalled.** `kill -0` succeeds
 * against a process that has exited but not been reaped, so a SIGKILLed child
 * whose parent has not reaped it still reads as alive. Waiting on the `exit`
 * event is what makes the pid genuinely gone, and it is also the module's one
 * documented gap between "the process exists" and "the process is running".
 *
 * ## What green here does NOT settle, restated from the node
 *
 * Liveness is detectable in the two cases staged: a killed process and a slow
 * one. It says nothing about the cases TTLs exist for — a machine that slept, a
 * recycled process id, or a holder whose heartbeat outlived its work. It does
 * not settle what a reclaiming run should do with what the dead one left in the
 * tree; the module never touches the directory, which is why that question is
 * still open rather than silently answered. And nothing here argues leasing is
 * worth its cost against the two cheaper siblings already in `src/runner/` —
 * that comparison is a human's.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  acquireWorkspaceLease,
  formatLeaseOutcome,
  leaseLiveness,
  readWorkspaceLease,
  releaseWorkspaceLease,
  staleAfterFor,
  touchWorkspaceLease,
  workspaceLeasePath,
  type WorkspaceLeaseRecord,
} from "../../src/runner/workspace-lease.js";

/** The vault's own numbers: `loop.lockTtlMinutes: 60`, `loop.lockHeartbeatMinutes: 4`, `cadence: "1h"`. */
const TTL_MS = 60 * 60_000;
const HEARTBEAT_MS = 4 * 60_000;
const FIRING_INTERVAL_MS = 60 * 60_000;

/** The node's second bar, verbatim: twenty trials, zero reclaims. */
const SLOW_HOLDER_TRIALS = 20;

const children: ChildProcess[] = [];
const dirs: string[] = [];

/** A real process that stays alive until something kills it — the "holder" in every case below. */
function spawnHolder(): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  children.push(child);
  return child;
}

/** SIGKILL, then wait for the process to be reaped — `kill -0` still answers for a zombie. */
async function killAndReap(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGKILL");
  await exited;
}

function tempWorkspace(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ost-lease-${name}-`));
  dirs.push(dir);
  return path.join(dir, "ost-main");
}

afterEach(async () => {
  for (const child of children.splice(0)) await killAndReap(child);
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("a killed holder is known dead, not waited out", () => {
  test("a SIGKILLed holder's workspace is reclaimed in milliseconds against a 60-minute TTL", async () => {
    const dir = tempWorkspace("killed");
    const holder = spawnHolder();
    expect(holder.pid).toBeGreaterThan(0);

    const t0 = Date.now();
    const taken = acquireWorkspaceLease(dir, {
      ttlMs: TTL_MS,
      holderPid: holder.pid,
      heartbeatEveryMs: HEARTBEAT_MS,
      runId: "run-that-dies",
      now: t0,
    });
    expect(taken.ok).toBe(true);

    // Before the kill: the next run finds a live holder and backs off. Without
    // this the reclaim below would prove nothing — a lease nobody could hold in
    // the first place is trivially reclaimable.
    const whileAlive = acquireWorkspaceLease(dir, { ttlMs: TTL_MS, holderPid: process.pid, now: t0 + 1_000 });
    expect(whileAlive.ok).toBe(false);
    if (whileAlive.ok) throw new Error("unreachable");
    expect(whileAlive.liveness.verdict).toBe("live");
    expect(whileAlive.liveness.evidence).toBe("pid-alive");

    await killAndReap(holder);

    // The clock is the holder's own: one second after acquisition, 59 minutes
    // inside the TTL and inside the firing interval. Nothing has expired.
    const now = t0 + 1_000;
    const started = Date.now();
    const reclaimed = acquireWorkspaceLease(dir, {
      ttlMs: TTL_MS,
      holderPid: process.pid,
      runId: "the-next-run",
      now,
    });
    const elapsedMs = Date.now() - started;

    expect(reclaimed.ok).toBe(true);
    if (!reclaimed.ok) throw new Error("unreachable");
    expect(reclaimed.reclaimed).not.toBeNull();

    // The bar the node stated, literally, against the lease's own age: reclaimed
    // one second in, well short of the 60-minute TTL and inside one firing
    // interval. Nothing here measures this machine.
    expect(now - t0).toBeLessThan(TTL_MS);
    expect(now - t0).toBeLessThan(FIRING_INTERVAL_MS);

    // The bar the node was reaching for: death was DETECTED, not assumed. This is
    // the assertion that fails if someone reimplements the whole thing as a
    // shorter timeout — which would still pass every clock assertion above. The
    // wall-clock cost of the reclaim rides along in the failure message; see the
    // header for why it is reported here rather than asserted on.
    const liveness = reclaimed.reclaimed!.liveness;
    const took = `the reclaim itself took ${elapsedMs}ms of wall clock`;
    expect(liveness.verdict, took).toBe("dead");
    expect(liveness.evidence, took).toBe("pid-gone");
    expect(liveness.assumed, took).toBe(false);
    expect(formatLeaseOutcome(reclaimed)).toContain("observed dead");

    // And the workspace is genuinely the next run's: the record on disk is its own.
    expect(readWorkspaceLease(dir)?.runId).toBe("the-next-run");
    expect(reclaimed.reclaimed!.held?.runId).toBe("run-that-dies");
  });

  test("a holder that never promised a heartbeat is still detected dead the same way", async () => {
    // The heartbeat is the hang detector, not the death detector. Stripping it
    // must not slow a death down, or the fast path is really the promise.
    const dir = tempWorkspace("no-heartbeat");
    const holder = spawnHolder();
    const t0 = Date.now();
    expect(acquireWorkspaceLease(dir, { ttlMs: TTL_MS, holderPid: holder.pid, now: t0 }).ok).toBe(true);

    await killAndReap(holder);

    const reclaimed = acquireWorkspaceLease(dir, { ttlMs: TTL_MS, holderPid: process.pid, now: t0 + 1_000 });
    expect(reclaimed.ok).toBe(true);
    if (!reclaimed.ok) throw new Error("unreachable");
    expect(reclaimed.reclaimed?.liveness.evidence).toBe("pid-gone");
    expect(reclaimed.reclaimed?.liveness.assumed).toBe(false);
  });
});

describe("a live but slow holder is never reclaimed", () => {
  test(`${SLOW_HOLDER_TRIALS} trials against a live holder, zero reclaims — with the TTL blown and the heartbeat silent`, async () => {
    const dir = tempWorkspace("slow");
    const holder = spawnHolder();

    // The adversarial form of "slow": every clock-based rule this module owns
    // says this lease is dead. Acquired three hours ago against a one-hour TTL,
    // silent for two hours against a four-minute promise. Only the pid says
    // otherwise, and the pid is right — the holder is a real running process.
    const t0 = Date.now();
    const taken = acquireWorkspaceLease(dir, {
      ttlMs: TTL_MS,
      holderPid: holder.pid,
      heartbeatEveryMs: HEARTBEAT_MS,
      runId: "the-slow-run",
      now: t0 - 3 * 60 * 60_000,
    });
    expect(taken.ok).toBe(true);
    if (!taken.ok) throw new Error("unreachable");
    const before = fs.readFileSync(workspaceLeasePath(dir), "utf8");

    let reclaims = 0;
    const verdicts: string[] = [];
    for (let trial = 0; trial < SLOW_HOLDER_TRIALS; trial++) {
      const attempt = acquireWorkspaceLease(dir, {
        ttlMs: TTL_MS,
        holderPid: process.pid,
        runId: `impatient-${trial}`,
        // Time keeps passing across the trials; patience must not erode with it.
        now: t0 + trial * 60_000,
      });
      if (attempt.ok) reclaims++;
      else verdicts.push(attempt.liveness.verdict);
    }

    expect(reclaims).toBe(0);
    // Refused twenty times for the right reason: the mechanism NOTICED the
    // silence and still would not act on it. A run of "live" verdicts here would
    // mean the heartbeat rule is dead code and the zero above is luck.
    expect(verdicts).toEqual(Array(SLOW_HOLDER_TRIALS).fill("suspect"));

    // Nothing on disk moved — no half-reclaim, no rewritten record.
    expect(fs.readFileSync(workspaceLeasePath(dir), "utf8")).toBe(before);
    expect(readWorkspaceLease(dir)?.runId).toBe("the-slow-run");

    // And the holder gets its workspace back the moment it speaks again, which is
    // what makes `suspect` a stop rather than a slow death sentence.
    expect(touchWorkspaceLease(dir, t0)).toBe(true);
    const afterBeat = acquireWorkspaceLease(dir, { ttlMs: TTL_MS, holderPid: process.pid, now: t0 + 60_000 });
    expect(afterBeat.ok).toBe(false);
    if (afterBeat.ok) throw new Error("unreachable");
    expect(afterBeat.liveness.verdict).toBe("live");
    expect(afterBeat.liveness.evidence).toBe("pid-alive");
  });

  test("a live holder inside its TTL is refused, and says so without assuming anything", async () => {
    const dir = tempWorkspace("healthy");
    const holder = spawnHolder();
    const t0 = Date.now();
    expect(
      acquireWorkspaceLease(dir, { ttlMs: TTL_MS, holderPid: holder.pid, heartbeatEveryMs: HEARTBEAT_MS, now: t0 }).ok,
    ).toBe(true);

    const refused = acquireWorkspaceLease(dir, { ttlMs: TTL_MS, holderPid: process.pid, now: t0 + 60_000 });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.liveness.assumed).toBe(false);
    expect(formatLeaseOutcome(refused)).toContain("lease refused");
  });
});

describe("the rules that decide a verdict, stated apart from the processes", () => {
  const host = os.hostname();
  const base = (over: Partial<WorkspaceLeaseRecord> = {}): WorkspaceLeaseRecord => ({
    token: `${process.pid}:fixture`,
    pid: process.pid,
    host,
    acquiredAt: new Date(0).toISOString(),
    ...over,
  });

  test("a live pid suppresses the TTL entirely — a slept machine must not manufacture a reclaim", () => {
    // Acquired at the epoch, judged now: the lease is decades past a one-hour
    // TTL. The holder is this very process, so it is unambiguously alive.
    const verdict = leaseLiveness(base({ holderPid: process.pid }), { now: Date.now(), ttlMs: TTL_MS, host });
    expect(verdict.verdict).toBe("live");
    expect(verdict.evidence).toBe("pid-alive");
  });

  test("the TTL decides only what cannot be observed: an unnamed holder, or another host", () => {
    const now = Date.now();
    const unnamed = leaseLiveness(base({ acquiredAt: new Date(now - 2 * TTL_MS).toISOString() }), {
      now,
      ttlMs: TTL_MS,
      host,
    });
    expect(unnamed.verdict).toBe("dead");
    expect(unnamed.evidence).toBe("ttl-expired");
    // Recorded as an assumption, not a finding. This is the failure mode the
    // candidate promised to improve on, and the field names it as such.
    expect(unnamed.assumed).toBe(true);

    const elsewhere = leaseLiveness(base({ holderPid: process.pid, host: "some-other-machine" }), {
      now,
      ttlMs: TTL_MS,
      host,
    });
    // Alive here means nothing there: a pid number on another host is not a
    // process, so this falls to the clock like any unobservable holder.
    expect(elsewhere.verdict).toBe("dead");
    expect(elsewhere.evidence).toBe("ttl-expired");
    expect(elsewhere.assumed).toBe(true);

    const young = leaseLiveness(base({ acquiredAt: new Date(now - 60_000).toISOString() }), { now, ttlMs: TTL_MS, host });
    expect(young.verdict).toBe("live");
    expect(young.evidence).toBe("within-ttl");
    expect(young.assumed).toBe(true);
  });

  test("an unreadable record is dead, and a zero-byte one is never observed", () => {
    expect(leaseLiveness(null, { now: Date.now(), ttlMs: TTL_MS, host }).verdict).toBe("dead");
    expect(leaseLiveness(base({ acquiredAt: "not a date" }), { now: Date.now(), ttlMs: TTL_MS, host }).evidence).toBe(
      "unreadable",
    );

    // "Unreadable ⇒ reclaim" is only safe because a reader can never see a
    // partly-written lease: acquisition links a complete temp file into place
    // rather than creating and then writing. Assert the file arrives whole.
    const dir = tempWorkspace("atomic");
    const taken = acquireWorkspaceLease(dir, { ttlMs: TTL_MS, holderPid: process.pid, now: Date.now() });
    expect(taken.ok).toBe(true);
    const raw = fs.readFileSync(workspaceLeasePath(dir), "utf8");
    expect(raw.length).toBeGreaterThan(0);
    expect(() => JSON.parse(raw)).not.toThrow();
    // And no temp file is left beside it for the next reader to trip over.
    const strays = fs.readdirSync(path.dirname(workspaceLeasePath(dir))).filter((f) => f.startsWith("."));
    expect(strays).toEqual([]);
  });

  test("three missed beats, not one — a holder descheduled behind a slow commit is not a hang", () => {
    expect(staleAfterFor(HEARTBEAT_MS)).toBe(3 * HEARTBEAT_MS);
    const now = Date.now();
    const oneBeatLate = leaseLiveness(
      base({
        holderPid: process.pid,
        acquiredAt: new Date(now - 2 * HEARTBEAT_MS).toISOString(),
        heartbeatEveryMs: HEARTBEAT_MS,
        heartbeatAt: new Date(now - 2 * HEARTBEAT_MS).toISOString(),
      }),
      { now, ttlMs: TTL_MS, host },
    );
    expect(oneBeatLate.verdict).toBe("live");
  });
});

describe("the lease survives what a reclaim is allowed to destroy", () => {
  test("the lease is a sibling of the workspace, not a file inside it", () => {
    const dir = tempWorkspace("sibling");
    fs.mkdirSync(dir, { recursive: true });
    const taken = acquireWorkspaceLease(dir, { ttlMs: TTL_MS, holderPid: process.pid, now: Date.now() });
    expect(taken.ok).toBe(true);

    // A reclaiming run resets the workspace. A lease stored under it would be
    // destroyed by the reset it authorised, and the next arrival would find an
    // unleased directory somebody is actively building in.
    fs.rmSync(dir, { recursive: true, force: true });
    expect(readWorkspaceLease(dir)).not.toBeNull();
    expect(workspaceLeasePath(dir).startsWith(path.resolve(dir) + path.sep)).toBe(false);
  });

  test("a clean exit hands the workspace straight over; a stolen lease is not released", () => {
    const dir = tempWorkspace("release");
    const now = Date.now();
    const mine = acquireWorkspaceLease(dir, { ttlMs: TTL_MS, holderPid: process.pid, runId: "first", now });
    expect(mine.ok).toBe(true);
    if (!mine.ok) throw new Error("unreachable");

    expect(releaseWorkspaceLease(dir, mine.record, now)).toBe(true);
    expect(readWorkspaceLease(dir)).toBeNull();

    const next = acquireWorkspaceLease(dir, { ttlMs: TTL_MS, holderPid: process.pid, runId: "second", now });
    expect(next.ok).toBe(true);
    if (!next.ok) throw new Error("unreachable");
    // Released, not reclaimed: nothing had to be judged, which is the whole
    // point of releasing. Every liveness rule above is the recovery path for
    // runs that never get here.
    expect(next.reclaimed).toBeNull();

    // The first run, waking up late, must not release a lease that is now the
    // second run's — that would hand the workspace to a third arrival while the
    // second is still building in it.
    //
    // This case is why `token` exists, and it is worth being explicit about how
    // it was found: written against the obvious identity `(pid, acquiredAt)`,
    // the assertion below failed. Both records here are written by one process
    // at one injected instant, so every visible field they carry is equal and
    // the stale holder released the live claim. A holder identified by what it
    // looks like is not identified at all.
    expect(next.record.pid).toBe(mine.record.pid);
    expect(next.record.acquiredAt).toBe(mine.record.acquiredAt);
    expect(next.record.token).not.toBe(mine.record.token);

    expect(releaseWorkspaceLease(dir, mine.record, now)).toBe(false);
    expect(readWorkspaceLease(dir)?.runId).toBe("second");
  });
});
