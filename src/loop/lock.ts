/**
 * The overlap lock — two firings must not run against one vault.
 *
 * **Why `linkSync` and not `writeFileSync(…, {flag:"wx"})`.** The obvious form
 * is create-exclusive-then-write, and it is wrong: create and write are two
 * syscalls, and between them the lock file exists and is ZERO BYTES. Measured
 * over 20,000 trials, a second firing lands in that window, reads `""`, fails to
 * parse it, classifies the lock "unreadable", breaks it and proceeds — and both
 * firings run, which is the one outcome the lock exists to prevent. Writing the
 * whole record to a temp file and then `link`ing it into place is
 * content-atomic: the name appears already complete or not at all, and `link`
 * fails `EEXIST` in the kernel.
 *
 * **Stale locks break automatically, because a lock that needs a human is worse
 * than no lock.** Three independent conditions, each answering a different way a
 * holder can stop being one:
 *
 *   - the holder's pid is gone *and* it was this host (pid liveness across hosts
 *     is meaningless, and pid reuse on a long-lived daemon means liveness alone
 *     can keep a dead lock forever — so it is the fast path, not the rule);
 *   - the holder promised a heartbeat cadence and stopped keeping it — the only
 *     signal that separates a hung process from a working one, since from
 *     outside they are the same live pid;
 *   - the lock is older than its TTL, which is the backstop that clears every
 *     other case including reuse, a different host, and an unreadable record.
 *
 * Breaking is a rename-then-unlink rather than a bare unlink, so a process that
 * loses the break race removes a file that is already out of the way instead of
 * deleting the winner's fresh lock. Whichever process wins is decided by the
 * single `link` that succeeds afterwards, never by who unlinked first.
 *
 * ## The recovery policy, and why it is split in two
 *
 * Every way this lock can fail is a recovery rule that is wrong in one of two
 * directions: too eager and it breaks a lock somebody still holds, which is the
 * concurrent write the lock existed to prevent; too patient and a crash on a
 * Friday costs the weekend. So the rules are sorted by *what the evidence can
 * actually settle*, and only one class of them may act without looking twice:
 *
 *   - **Conclusive** — a named holder pid that is gone on this host, an
 *     unreadable record, a TTL blown with nobody live to blame. Nothing further
 *     can be learned by waiting, so {@link acquireFiringLock} breaks on the spot.
 *   - **Suspected** — a heartbeat that has fallen behind. This is the ONLY
 *     evidence that catches a hang, and it is also the evidence a suspended
 *     machine manufactures for free: freeze a healthy holder for an hour and its
 *     heartbeat is an hour behind through no fault of its own. A single-shot
 *     acquire therefore never acts on it. {@link waitForFiringLock} does, and only
 *     after watching the heartbeat fail to advance across an unbroken observation
 *     window — one it discards outright if its own clock jumped, because a jump
 *     means the observer was asleep too and everything it "saw" is worthless.
 *
 * The second half of that is why the waiter exists at all, and it is the node's
 * own sentence: a second agent that finds the lock **waits** rather than
 * proceeding. Waiting is not politeness here, it is the measurement — an
 * observer that never watches has no way to tell a hung holder from a sleeping
 * one, and the only recovery rule available to it is a timeout long enough to be
 * useless.
 *
 * **What no policy settles.** A hung holder and a crashed one are the same
 * process from outside. The cadence a holder promises is what decides which way
 * that ambiguity is resolved and how much it costs, and picking it is a human's
 * call, not this file's: `loop.lockHeartbeatMinutes` is where they make it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireLoopStateDir, loopStateDir } from "./state.js";

export interface LockRecord {
  /** The process that wrote the record. Informational — it is gone in milliseconds. */
  pid: number;
  /**
   * The process that owns the whole firing, when the caller named one.
   *
   * Liveness is only checked against this. `loop start` exits long before the
   * pass it opened finishes, so treating *its* pid as the holder would make
   * every lock look pid-dead — and therefore breakable — for the entire firing
   * it was taken for. Absent, the TTL is the only staleness rule, which is the
   * conservative reading: we do not know who to watch.
   */
  holderPid?: number;
  host: string;
  acquiredAt: string;
  /**
   * The cadence this holder PROMISES to prove it is alive at, in milliseconds.
   *
   * Present means the holder has opted into being watchable: it will call
   * {@link touchFiringLock} at least this often, and a gap much larger than it is
   * evidence of a hang rather than of a long quiet stretch. Absent means the
   * holder made no such promise and must be judged on pid liveness and the TTL
   * alone — slower, and the only honest reading of a holder that never said how
   * often it would speak.
   */
  heartbeatEveryMs?: number;
  /**
   * When the holder last proved it was still making progress.
   *
   * Distinct from `acquiredAt` on purpose. Age since acquisition says how long a
   * firing has been running, which is not a fault; age since the last heartbeat
   * says how long it has been since anything happened, which is.
   */
  heartbeatAt?: string;
  runId?: string;
}

export interface AcquireOptions {
  /** How long a lock may be held before it is assumed dead. Required: see F2. */
  ttlMs: number;
  now?: number;
  pid?: number;
  /** The process that owns the firing, if the caller can name it. */
  holderPid?: number;
  host?: string;
  /** The cadence this holder promises to heartbeat at, if it can promise one. */
  heartbeatEveryMs?: number;
  runId?: string;
}

export type AcquireResult =
  | { ok: true; record: LockRecord; broke: { held: LockRecord | null; why: string } | null }
  | { ok: false; held: LockRecord | null; reason: string };

export function firingLockPath(vaultDir: string): string | null {
  const state = loopStateDir(vaultDir);
  return state === null ? null : path.join(state, "firing.lock");
}

/** The current holder, or null when the lock is absent or its record unreadable. */
export function readFiringLock(vaultDir: string): LockRecord | null {
  const p = firingLockPath(vaultDir);
  if (p === null || !fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as LockRecord;
    return typeof parsed?.pid === "number" && typeof parsed?.acquiredAt === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists and belongs to someone else.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The last instant this holder is known to have been doing something, and which
 * fact says so. A holder that never heartbeats has only the moment it started.
 */
export function lastAliveAt(held: LockRecord): { at: number; from: "heartbeat" | "acquisition" } {
  const beat = held.heartbeatAt === undefined ? NaN : Date.parse(held.heartbeatAt);
  if (Number.isFinite(beat)) return { at: beat, from: "heartbeat" };
  return { at: Date.parse(held.acquiredAt), from: "acquisition" };
}

/**
 * Whether a held lock may be broken, and the sentence explaining why.
 *
 * Two verdicts, not one, because they license different actions:
 *
 *   - `stale` — break it now. Nothing is learned by looking again.
 *   - `suspect` — the heartbeat has fallen behind its promised cadence. That is
 *     either a hang or a machine that was asleep, and a single reading cannot
 *     tell them apart. Only {@link waitForFiringLock}, which can watch across
 *     time and notice its own clock jumping, is allowed to act on it.
 *
 * An unreadable or absent record counts as stale on purpose: the file is there,
 * nothing can be learned from it, and the TTL cannot be applied to a timestamp
 * that will not parse. Leaving it would be a permanent red with no owner.
 *
 * **A live named holder on this host suppresses the TTL.** The TTL is a proxy
 * for "nobody is home"; a pid answering `kill -0` is the thing itself, and it
 * outranks the proxy. Without this rule a machine that slept through the TTL
 * wakes up with its own healthy firing's lock breakable by the next arrival —
 * the exact concurrent write the lock exists to prevent, manufactured by the
 * recovery policy. What remains for that holder is the heartbeat rule, which is
 * both faster and, unlike the TTL, capable of being disproved by the holder.
 */
export function staleness(
  held: LockRecord | null,
  opts: { now: number; ttlMs: number; host: string },
): { stale: boolean; suspect: boolean; why: string } {
  if (held === null) return { stale: true, suspect: false, why: "the lock record is unreadable" };
  const acquired = Date.parse(held.acquiredAt);
  if (!Number.isFinite(acquired)) {
    return { stale: true, suspect: false, why: `the lock record's acquiredAt (${held.acquiredAt}) is not a timestamp` };
  }
  const namedHolderOnThisHost = held.holderPid !== undefined && held.host === opts.host;
  if (namedHolderOnThisHost && !pidAlive(held.holderPid!)) {
    return { stale: true, suspect: false, why: `holder pid ${held.holderPid} on this host is gone` };
  }
  const holderIsLive = namedHolderOnThisHost;

  const ageMs = opts.now - acquired;
  if (ageMs >= opts.ttlMs && !holderIsLive) {
    return {
      stale: true,
      suspect: false,
      why: `held ${Math.round(ageMs / 60_000)}m, past the ${Math.round(opts.ttlMs / 60_000)}m TTL`,
    };
  }

  if (held.heartbeatEveryMs !== undefined && held.heartbeatEveryMs > 0) {
    const { at, from } = lastAliveAt(held);
    const silentMs = opts.now - at;
    const staleAfterMs = staleAfterFor(held.heartbeatEveryMs);
    if (Number.isFinite(at) && silentMs >= staleAfterMs) {
      return {
        stale: false,
        suspect: true,
        why:
          `silent ${Math.round(silentMs / 60_000)}m since its last ${from}, past the ` +
          `${Math.round(staleAfterMs / 60_000)}m it promised to speak within`,
      };
    }
  }

  return { stale: false, suspect: false, why: `held by pid ${held.pid} on ${held.host} since ${held.acquiredAt}` };
}

/**
 * How long a promised heartbeat may go missing before the holder is suspect.
 *
 * Three cadences, not one. A holder that misses a single beat is a holder whose
 * timer was descheduled behind a slow `git commit`; a holder that misses three
 * in a row has stopped running. One beat of slack would make every busy machine
 * look hung, and the cost of that mistake is two agents writing at once.
 */
export function staleAfterFor(heartbeatEveryMs: number): number {
  return heartbeatEveryMs * 3;
}

/** Temp names are per-process and per-attempt; nothing ever reads them back. */
let tmpCounter = 0;

function linkInPlace(stateDir: string, lockFile: string, record: LockRecord): boolean {
  const tmp = path.join(stateDir, `.firing.lock.${record.pid}.${tmpCounter++}`);
  fs.writeFileSync(tmp, JSON.stringify(record) + "\n");
  try {
    fs.linkSync(tmp, lockFile);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    return false;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function acquireFiringLock(vaultDir: string, opts: AcquireOptions): AcquireResult {
  const stateDir = requireLoopStateDir(vaultDir);
  const lockFile = path.join(stateDir, "firing.lock");
  const now = opts.now ?? Date.now();
  const record: LockRecord = {
    pid: opts.pid ?? process.pid,
    ...(opts.holderPid !== undefined ? { holderPid: opts.holderPid } : {}),
    host: opts.host ?? os.hostname(),
    acquiredAt: new Date(now).toISOString(),
    ...(opts.heartbeatEveryMs !== undefined
      ? { heartbeatEveryMs: opts.heartbeatEveryMs, heartbeatAt: new Date(now).toISOString() }
      : {}),
    ...(opts.runId ? { runId: opts.runId } : {}),
  };

  if (linkInPlace(stateDir, lockFile, record)) return { ok: true, record, broke: null };

  const held = readFiringLock(vaultDir);
  const { stale, suspect, why } = staleness(held, { now, ttlMs: opts.ttlMs, host: record.host });
  // `suspect` is deliberately NOT enough here. A single reading cannot tell a
  // hung holder from one whose machine was asleep, and this call has taken only
  // one reading — see `waitForFiringLock`, which takes many and is allowed to.
  if (!stale) {
    return {
      ok: false,
      held,
      reason: suspect
        ? `another firing holds the lock and may be hung — ${why} (waiting is what settles it)`
        : `another firing holds the lock — ${why}`,
    };
  }

  if (!breakLock(lockFile, now, record.pid)) {
    return { ok: false, held: readFiringLock(vaultDir), reason: "another firing took the lock while this one was breaking a stale copy" };
  }

  if (linkInPlace(stateDir, lockFile, record)) return { ok: true, record, broke: { held, why } };
  return { ok: false, held: readFiringLock(vaultDir), reason: "another firing took the lock while this one was breaking a stale copy" };
}

/**
 * Remove a lock file, whoever holds it.
 *
 * Move it out of the way rather than deleting it in place. ENOENT means another
 * process broke it first, which is fine: the `link` afterwards is what actually
 * decides who runs.
 */
function breakLock(lockFile: string, now: number, pid: number): boolean {
  try {
    const sidelined = `${lockFile}.stale-${now}-${pid}`;
    fs.renameSync(lockFile, sidelined);
    fs.rmSync(sidelined, { force: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return true;
}

/**
 * Break the lock ONLY if it is still, byte for byte, the record that was judged.
 *
 * The judgement that licenses a break is made over a window — seconds or minutes
 * of watching a heartbeat not move. The holder can come back inside that window:
 * a machine wakes, a descheduled process runs again, and the record on disk
 * advances between the decision and the act. Re-reading and refusing on any
 * difference is what keeps the whole waiting policy from having a race at the
 * one instant it is destructive, and the refusal is free — the waiter simply
 * goes back to watching a holder that has just proved it is alive.
 *
 * Returns false when the record moved, was already broken, or was retaken.
 */
export function breakFiringLockIfUnchanged(vaultDir: string, judged: LockRecord, now: number): boolean {
  const lockFile = firingLockPath(vaultDir);
  if (lockFile === null) return false;
  const current = readFiringLock(vaultDir);
  if (current === null) return false;
  if (
    current.pid !== judged.pid ||
    current.acquiredAt !== judged.acquiredAt ||
    current.heartbeatAt !== judged.heartbeatAt ||
    current.runId !== judged.runId
  ) {
    return false;
  }
  return breakLock(lockFile, now, process.pid);
}

/**
 * Prove the holder is still making progress, by advancing `heartbeatAt`.
 *
 * Deliberately unconditional about *who* calls it. A firing is not one process —
 * `loop start` takes the lock and exits, the agent works, every MCP mutation
 * commits from somewhere else — so demanding the caller identify itself as the
 * holder would mean the only processes doing observable work are the ones
 * forbidden from saying so. Any write against a locked vault is that vault's
 * firing making progress, which is precisely what the heartbeat records.
 *
 * Atomic by temp-then-rename, for the same reason acquisition is atomic by
 * link: a reader must never see a half-written record and call it unreadable.
 *
 * Returns false when there is no lock to stamp.
 */
export function touchFiringLock(vaultDir: string, now: number = Date.now()): boolean {
  const dir = loopStateDir(vaultDir);
  if (dir === null) return false;
  const lockFile = path.join(dir, "firing.lock");
  const held = readFiringLock(vaultDir);
  if (held === null) return false;
  const next: LockRecord = { ...held, heartbeatAt: new Date(now).toISOString() };
  const tmp = path.join(dir, `.firing.lock.${process.pid}.${tmpCounter++}`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(next) + "\n");
    fs.renameSync(tmp, lockFile);
    return true;
  } catch {
    // A vault whose state dir vanished mid-firing, or a read-only mount. The
    // heartbeat is an optimisation on recovery speed, never a correctness
    // requirement — failing to stamp costs patience, not safety.
    fs.rmSync(tmp, { force: true });
    return false;
  }
}

/**
 * Name the run this lock is holding for.
 *
 * `loop start` and `loop seal` are separate processes, so the pid that acquired
 * the lock is gone by the time anything releases it. The run id is the handle
 * that survives, and stamping it is safe because the caller already holds the
 * lock: the rename replaces the name atomically, so no reader ever sees a half
 * record.
 */
export function stampFiringLock(vaultDir: string, record: LockRecord, runId: string): LockRecord {
  const stateDir = requireLoopStateDir(vaultDir);
  const lockFile = path.join(stateDir, "firing.lock");
  // Merge onto what is on DISK, not onto the caller's copy. The record handed in
  // was read at acquisition, and `touchFiringLock` may have advanced the
  // heartbeat since — writing the caller's copy back would rewind it, aging a
  // healthy holder by however long it had been working and handing the next
  // arrival evidence of a hang that never happened. Only when the lock on disk
  // is somebody else's, or gone, does the caller's copy win; that case is
  // already lost and the fields below are the ones this function was asked for.
  const onDisk = readFiringLock(vaultDir);
  const base = onDisk !== null && onDisk.acquiredAt === record.acquiredAt && onDisk.pid === record.pid ? onDisk : record;
  const next: LockRecord = { ...base, runId };
  const tmp = path.join(stateDir, `.firing.lock.${record.pid}.${tmpCounter++}`);
  fs.writeFileSync(tmp, JSON.stringify(next) + "\n");
  fs.renameSync(tmp, lockFile);
  return next;
}

/**
 * Release the lock, but only if it is still the one described.
 *
 * Every field given must match what is on disk. A lock that was broken as stale
 * and retaken belongs to the firing that took it, and deleting it here would be
 * the same bug as breaking a fresh one — so this reports false and leaves the
 * TTL to do its job.
 */
export function releaseFiringLock(
  vaultDir: string,
  match: Partial<Pick<LockRecord, "pid" | "acquiredAt" | "runId">>,
): boolean {
  const p = firingLockPath(vaultDir);
  if (p === null) return false;
  const held = readFiringLock(vaultDir);
  if (!held) return false;
  if (match.pid !== undefined && held.pid !== match.pid) return false;
  if (match.acquiredAt !== undefined && held.acquiredAt !== match.acquiredAt) return false;
  if (match.runId !== undefined && held.runId !== match.runId) return false;
  fs.rmSync(p, { force: true });
  return true;
}

/**
 * The clock a waiter reads and the sleep it takes between readings.
 *
 * Injectable because the property under test is measured in the fifteen minutes
 * a node fixed, and a suite that spent them would be a suite nobody runs. The
 * seam is honest: what the fake replaces is elapsed wall time, and every other
 * thing the waiter touches — the lock file, the holder process, `kill -0` — is
 * the real one.
 */
export interface WaitClock {
  now(): number;
  sleep(ms: number): void;
}

/** Blocks this thread. `loop start` is synchronous end to end and must stay so. */
export const REAL_WAIT_CLOCK: WaitClock = {
  now: () => Date.now(),
  sleep: (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  },
};

export interface WaitOptions extends AcquireOptions {
  /** How long to keep waiting before reporting the vault unavailable. */
  waitMs: number;
  /** How often to look. Also the yardstick for "my own clock jumped". */
  pollMs?: number;
  /**
   * How long a suspicion must survive unbroken observation before it may act.
   *
   * The gap between suspecting a hang and acting on it. Long enough that a
   * holder which is merely slow gets to prove otherwise, short enough that it
   * does not dominate the recovery time it is added to.
   */
  confirmMs?: number;
  clock?: WaitClock;
  /** Called for each reading, so a caller can report what the wait actually saw. */
  onObservation?: (o: WaitObservation) => void;
}

export interface WaitObservation {
  at: number;
  held: LockRecord | null;
  verdict: "acquired" | "live" | "suspect" | "broke" | "clock-jumped";
  why: string;
}

export type WaitResult =
  | { ok: true; record: LockRecord; broke: { held: LockRecord | null; why: string } | null; waitedMs: number }
  | { ok: false; held: LockRecord | null; reason: string; waitedMs: number };

const DEFAULT_POLL_MS = 2_000;
const DEFAULT_CONFIRM_MS = 60_000;

/**
 * Take the lock, waiting for the holder rather than proceeding without it.
 *
 * This is the whole solution in one function. A second agent that finds the lock
 * held does not give up and it does not barge: it waits, and while it waits it
 * is the only thing in the system in a position to tell a hung holder from a
 * healthy one, because that distinction exists only across time.
 *
 * Three things can end the wait:
 *
 *   - the holder releases and this call takes the lock;
 *   - the holder is conclusively gone (pid dead, TTL blown with nobody live),
 *     and {@link acquireFiringLock} breaks it on the first reading;
 *   - the holder's promised heartbeat fails to advance across `confirmMs` of
 *     continuous observation, at which point the lock is broken — but only if it
 *     is still the record that was watched.
 *
 * **The clock-jump rule is the part that is not obvious.** If two consecutive
 * readings are further apart than the poll interval can explain, this process
 * was not running in between — the machine slept, or the whole container was
 * frozen. Everything observed before that gap describes a world that was on
 * pause, including the holder, whose heartbeat could not possibly have advanced.
 * Acting on it would break a lock whose owner did nothing wrong, which is the
 * single failure this policy exists to avoid, so the observation window is
 * discarded and started over. The cost is bounded and stated: a machine that
 * sleeps repeatedly can defer recovery by one confirmation window per sleep.
 */
export function waitForFiringLock(vaultDir: string, opts: WaitOptions): WaitResult {
  const clock = opts.clock ?? REAL_WAIT_CLOCK;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const confirmMs = opts.confirmMs ?? DEFAULT_CONFIRM_MS;
  const host = opts.host ?? os.hostname();
  const started = clock.now();
  const observe = opts.onObservation ?? (() => {});

  // The window: which record we have been watching, and since when. Both are
  // cleared by anything that invalidates what we saw — the holder moving, or
  // our own clock jumping.
  let watching: LockRecord | null = null;
  let watchingSince = started;
  let lastPoll = started;
  // A break this loop made itself, remembered so the acquire that follows can
  // report it. Without this the eviction of a hung holder is invisible: the
  // acquire that comes after it finds a free lock and truthfully says nothing
  // was broken, and `loop start` prints no banner for the one recovery decision
  // an operator most needs to see happen.
  let brokeHere: { held: LockRecord | null; why: string } | null = null;

  for (;;) {
    const now = clock.now();
    const attempt = acquireFiringLock(vaultDir, { ...opts, now });
    if (attempt.ok) {
      const broke = attempt.broke ?? brokeHere;
      observe({ at: now, held: null, verdict: "acquired", why: broke?.why ?? "the lock was free" });
      return { ok: true, record: attempt.record, broke, waitedMs: now - started };
    }

    // Did WE stop running? A gap that the poll interval cannot account for means
    // this process was suspended, and nothing it watched across that gap is
    // evidence about the holder. Checked before the verdict, because the verdict
    // is exactly what it would corrupt.
    const gapMs = now - lastPoll;
    lastPoll = now;
    if (gapMs > pollMs * 2 + 1_000) {
      watching = null;
      observe({
        at: now,
        held: attempt.held,
        verdict: "clock-jumped",
        why: `${Math.round(gapMs / 1_000)}s passed between two readings ${Math.round(pollMs / 1_000)}s apart — this process was not running, so nothing it saw about the holder counts`,
      });
    } else {
      const held = attempt.held;
      const verdict = staleness(held, { now, ttlMs: opts.ttlMs, host });
      if (held !== null && verdict.suspect) {
        // A new record, or one whose heartbeat moved, restarts the window: the
        // holder just proved it is alive, which is the answer, not a delay.
        if (watching === null || watching.heartbeatAt !== held.heartbeatAt || watching.acquiredAt !== held.acquiredAt) {
          watching = held;
          watchingSince = now;
          observe({ at: now, held, verdict: "suspect", why: verdict.why });
        } else if (now - watchingSince >= confirmMs) {
          if (breakFiringLockIfUnchanged(vaultDir, held, now)) {
            observe({ at: now, held, verdict: "broke", why: verdict.why });
            brokeHere = { held, why: verdict.why };
            watching = null;
            continue; // Straight back to acquire; do not spend a poll interval.
          }
          // It moved between the decision and the act. That is the holder alive.
          watching = null;
          observe({ at: now, held, verdict: "live", why: "the record changed as the break was attempted — the holder is alive" });
        }
      } else {
        watching = null;
        observe({ at: now, held, verdict: "live", why: verdict.why });
      }
    }

    if (now - started >= opts.waitMs) {
      const waitedMs = now - started;
      return {
        ok: false,
        held: readFiringLock(vaultDir),
        // The acquire's own sentence first, then how long this call spent on it.
        // Giving up is still a refusal to run and the operator's question is the
        // same one it always was — *who has it* — so the wait is reported as a
        // suffix on that answer rather than as a replacement for it.
        reason:
          waitedMs === 0
            ? attempt.reason
            : `${attempt.reason}; gave up after ${Math.round(waitedMs / 1_000)}s of waiting`,
        waitedMs,
      };
    }
    clock.sleep(pollMs);
  }
}
