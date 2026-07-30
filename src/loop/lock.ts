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
 * than no lock.** Two independent conditions, either of which is enough:
 *
 *   - the holder's pid is gone *and* it was this host (pid liveness across hosts
 *     is meaningless, and pid reuse on a long-lived daemon means liveness alone
 *     can keep a dead lock forever — so it is the fast path, not the rule);
 *   - the lock is older than its TTL, which is the backstop that clears every
 *     other case including reuse, a different host, and an unreadable record.
 *
 * Breaking is a rename-then-unlink rather than a bare unlink, so a process that
 * loses the break race removes a file that is already out of the way instead of
 * deleting the winner's fresh lock. Whichever process wins is decided by the
 * single `link` that succeeds afterwards, never by who unlinked first.
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
 * Whether a held lock may be broken, and the sentence explaining why.
 *
 * An unreadable or absent record counts as stale on purpose: the file is there,
 * nothing can be learned from it, and the TTL cannot be applied to a timestamp
 * that will not parse. Leaving it would be a permanent red with no owner.
 */
export function staleness(
  held: LockRecord | null,
  opts: { now: number; ttlMs: number; host: string },
): { stale: boolean; why: string } {
  if (held === null) return { stale: true, why: "the lock record is unreadable" };
  const acquired = Date.parse(held.acquiredAt);
  if (!Number.isFinite(acquired)) return { stale: true, why: `the lock record's acquiredAt (${held.acquiredAt}) is not a timestamp` };
  const ageMs = opts.now - acquired;
  if (ageMs >= opts.ttlMs) {
    return { stale: true, why: `held ${Math.round(ageMs / 60_000)}m, past the ${Math.round(opts.ttlMs / 60_000)}m TTL` };
  }
  if (held.holderPid !== undefined && held.host === opts.host && !pidAlive(held.holderPid)) {
    return { stale: true, why: `holder pid ${held.holderPid} on this host is gone` };
  }
  return { stale: false, why: `held by pid ${held.pid} on ${held.host} since ${held.acquiredAt}` };
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
    ...(opts.runId ? { runId: opts.runId } : {}),
  };

  if (linkInPlace(stateDir, lockFile, record)) return { ok: true, record, broke: null };

  const held = readFiringLock(vaultDir);
  const { stale, why } = staleness(held, { now, ttlMs: opts.ttlMs, host: record.host });
  if (!stale) return { ok: false, held, reason: `another firing holds the lock — ${why}` };

  // Move it out of the way rather than deleting it in place. ENOENT means
  // another process broke it first, which is fine: the `link` below is what
  // actually decides who runs.
  try {
    const sidelined = `${lockFile}.stale-${now}-${record.pid}`;
    fs.renameSync(lockFile, sidelined);
    fs.rmSync(sidelined, { force: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  if (linkInPlace(stateDir, lockFile, record)) return { ok: true, record, broke: { held, why } };
  return { ok: false, held: readFiringLock(vaultDir), reason: "another firing took the lock while this one was breaking a stale copy" };
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
  const next: LockRecord = { ...record, runId };
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
