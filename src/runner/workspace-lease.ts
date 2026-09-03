/**
 * The workspace lease — who owns a shared workspace right now, and how the next
 * run finds out the last one is gone.
 *
 * The candidate this implements is "The workspace is leased, and the next run
 * reclaims a lease whose holder is gone" — the third answer to a firing that
 * died at time zero because the previous firing's residue was still at
 * `/tmp/ost-main`. Its two siblings are already here and neither is this:
 * `workspace-reconcile.ts` converges on whatever it finds at a fixed path, and
 * `workspace.ts` gives every run a path of its own. Reconciliation keeps the
 * warm workspace and cannot tell a live run from a dead one; per-run naming is
 * safe under overlap and throws the warm workspace away every firing. Leasing is
 * the expensive third bet: keep the shared path, and make ownership explicit.
 *
 * ## The whole candidate turns on one word in the existing precedent
 *
 * This product already runs a lease one level up — `loop.lockTtlMinutes: 60`,
 * commented in the vault's own config as "a firing still holding the lock after
 * this is **assumed** dead". *Assumed* is the admission the assumption beneath
 * this module was written to attack: if the only way to know a holder is gone is
 * that its TTL expired, then leasing does not remove the failure this
 * opportunity is about, it merely bounds it at an hour. A run that dies at
 * minute one would still block the workspace for fifty-nine more.
 *
 * So {@link leaseLiveness} does not return a boolean. It returns a verdict **and
 * the evidence class that produced it**, and {@link Liveness.assumed} says
 * outright whether the verdict rests on an observation of the holder or on a
 * clock. `pid-gone` is knowing; `ttl-expired` is assuming. The distinction is
 * the deliverable — a green run of
 * `test/runner/workspace-lease-liveness.test.ts` means a killed holder was
 * detected in milliseconds with `assumed: false`, not that it was eventually
 * timed out.
 *
 * ## The asymmetry, and why the TTL is subordinate to the pid rather than beside it
 *
 * The two ways this can be wrong do not cost the same. A missed death delays one
 * firing. A false reclaim takes the workspace out from under a healthy run
 * mid-build, which is the destructive failure reconciliation was rejected for,
 * reintroduced through the front door. The assumption test prices that in and
 * admits no failures of the second kind at all.
 *
 * Hence the rule that looks like an omission and is the design: **a named holder
 * pid answering `kill -0` on this host suppresses the TTL entirely.** The TTL is
 * a proxy for "nobody is home"; a live pid is the thing itself, and a proxy does
 * not get to overrule an observation. Without that rule a machine that slept
 * through the TTL would wake with its own healthy holder reclaimable by the next
 * arrival — a false reclaim manufactured by the recovery policy. What remains
 * for an observably-live holder is {@link "suspect"}, which this module reports
 * and never acts on.
 *
 * ## What is deliberately NOT settled here
 *
 *  - **A hung holder.** A live pid that stopped working is `suspect`, and
 *    {@link acquireWorkspaceLease} refuses rather than reclaiming: one reading
 *    cannot separate a hang from a machine that was asleep, and the sleeping
 *    machine is the case where acting is destructive. Resolving it needs an
 *    observation window (the loop lock's `waitForFiringLock` is the shape) or a
 *    human. Neither is built here, and a `suspect` verdict is a stop, not a
 *    delay that clears itself.
 *  - **A recycled pid.** A dead holder whose pid has been reissued reads as
 *    live. That error is one-directional — it makes this module *too patient*,
 *    never too eager — so it cannot produce the failure that would refute the
 *    assumption. Under the TTL-suppression rule above it is also unbounded,
 *    which is the honest cost of preferring patience, and it is why `suspect`
 *    exists as a reportable state rather than being folded into `live`.
 *  - **A zombie holder.** `kill -0` succeeds against a process that has exited
 *    but not been reaped, so a holder whose own parent is still running and not
 *    reaping reads as live until it is. In this product's deployment the
 *    observer is a different firing entirely, not the holder's parent, so the
 *    window is whatever the holder's parent takes to reap — usually `init`, and
 *    immediate. It is stated because it is the one case where "the process
 *    exists" and "the process is running" come apart, and the whole module rests
 *    on treating them as the same question.
 *  - **What to do with the dead run's leftovers.** Reclaiming transfers
 *    *ownership*, and this module never touches the workspace's contents. That
 *    is `reconcileWorkspace`'s job and it is a separate decision with a separate
 *    safety argument; composing them is the caller's, and doing it here would
 *    bury a destructive act inside a bookkeeping call.
 *
 * ## Why the lease file sits beside the workspace and not inside it
 *
 * A lease stored under the directory it leases cannot survive the reset it
 * authorises: the reclaiming run wipes the workspace and destroys the record of
 * its own ownership in the same `rm`. So the lease for `<dir>` is `<dir>.lease`,
 * a sibling — outside everything a reclaim may legitimately destroy, and
 * reachable when the workspace does not exist yet, which is the state the very
 * first run finds.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface WorkspaceLeaseRecord {
  /**
   * What makes THIS claim distinguishable from the next one, so a holder can
   * only ever release its own.
   *
   * It exists because the obvious identity is not one. `(pid, acquiredAt)` looks
   * unique and is not: a caller that takes a lease, releases it, and takes it
   * again inside the same millisecond — or two runs driven from one process, or
   * any caller passing a fixed `now` — produces byte-identical records, and
   * {@link releaseWorkspaceLease} would then let the first run unlink the second
   * run's lease and hand the workspace to a third arrival mid-build. That is the
   * destructive failure this whole module exists to prevent, reached by the
   * bookkeeping rather than by the recovery policy.
   *
   * A counter rather than a random value or a timestamp: `pid` separates
   * processes, the counter separates claims within one, and neither depends on
   * `Math.random` or clock resolution — both of which this repository's tests
   * are required not to depend on.
   */
  token: string;
  /** The process that wrote the record. Informational — for `loop start`-shaped callers it is gone in milliseconds. */
  pid: number;
  /**
   * The process that owns the workspace, when the caller can name one.
   *
   * Liveness is only ever checked against this. The caller that takes a lease is
   * often not the caller that holds it — `examples/automation/build-pass.sh`
   * passes `--holder-pid $$` for exactly this reason — so treating the writing
   * pid as the holder would make every lease read pid-dead the moment its
   * acquiring command exited. Absent, liveness is unobservable and the TTL is
   * the only rule left, which is the honest reading of a holder nobody named.
   */
  holderPid?: number;
  host: string;
  acquiredAt: string;
  /**
   * The cadence this holder promises to prove it is alive at, in milliseconds.
   *
   * Present means the holder opted into being watchable. Absent means it made no
   * promise, so silence is not evidence of anything and only pid liveness and
   * the TTL apply.
   */
  heartbeatEveryMs?: number;
  /** When the holder last proved it was still making progress, distinct from when it started. */
  heartbeatAt?: string;
  runId?: string;
}

/** How a liveness verdict was reached. The point of the module is that these are not interchangeable. */
export type LivenessEvidence =
  /** A named holder pid on this host does not answer `kill -0`. Knowing, not assuming. */
  | "pid-gone"
  /** A named holder pid on this host answers `kill -0`, within whatever cadence it promised. */
  | "pid-alive"
  /** The holder is observably alive and observably silent past the cadence it promised. */
  | "heartbeat-silent"
  /** Liveness is unobservable (no named holder, or another host) and the lease outlived its TTL. */
  | "ttl-expired"
  /** Liveness is unobservable and the lease is still inside its TTL. */
  | "within-ttl"
  /** There is a lease file and nothing can be learned from it. */
  | "unreadable";

export interface Liveness {
  /**
   * `dead` licenses a reclaim. `live` forbids one. `suspect` forbids one *and*
   * says the refusal will not clear itself — see the module header.
   */
  verdict: "live" | "dead" | "suspect";
  evidence: LivenessEvidence;
  /**
   * True when the verdict rests on a clock rather than on an observation of the
   * holder. This is the field the assumption beneath this module is about: a
   * `dead` verdict with `assumed: true` is the timeout leasing was supposed to
   * improve on, and one with `assumed: false` is the improvement.
   */
  assumed: boolean;
  why: string;
}

export interface LeaseOptions {
  /** How long an *unobservable* holder may hold before it is assumed dead. Never overrides a live pid. */
  ttlMs: number;
  now?: number;
  pid?: number;
  /** The process that owns the workspace, if the caller can name one. */
  holderPid?: number;
  host?: string;
  /** The cadence this holder promises to heartbeat at, if it can promise one. */
  heartbeatEveryMs?: number;
  runId?: string;
}

export type AcquireLeaseResult =
  | {
      ok: true;
      dir: string;
      record: WorkspaceLeaseRecord;
      /** What was displaced, and on what evidence. `null` when the workspace was simply free. */
      reclaimed: { held: WorkspaceLeaseRecord | null; liveness: Liveness } | null;
    }
  | { ok: false; dir: string; held: WorkspaceLeaseRecord | null; liveness: Liveness; reason: string };

/** `<dir>.lease` — a sibling, so a reclaiming run can reset `<dir>` without destroying the record of its own claim. */
export function workspaceLeasePath(dir: string): string {
  return `${path.resolve(dir)}.lease`;
}

/** The current holder, or null when no lease is there or its record will not parse. */
export function readWorkspaceLease(dir: string): WorkspaceLeaseRecord | null {
  const p = workspaceLeasePath(dir);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as WorkspaceLeaseRecord;
    return typeof parsed?.pid === "number" && typeof parsed?.acquiredAt === "string"
      ? { ...parsed, token: typeof parsed.token === "string" ? parsed.token : "" }
      : null;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists and belongs to someone else — that is alive.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * How long a promised heartbeat may go missing before its holder is suspect.
 *
 * Three cadences, not one, and the same number the firing lock uses. A holder
 * that misses one beat is a holder descheduled behind a slow `git commit`; a
 * holder that misses three has stopped. One beat of slack would make every busy
 * machine look hung, and this module's expensive mistake is on that side.
 */
export function staleAfterFor(heartbeatEveryMs: number): number {
  return heartbeatEveryMs * 3;
}

/** The last instant this holder is known to have been doing something, and which fact says so. */
export function lastAliveAt(held: WorkspaceLeaseRecord): { at: number; from: "heartbeat" | "acquisition" } {
  const beat = held.heartbeatAt === undefined ? NaN : Date.parse(held.heartbeatAt);
  if (Number.isFinite(beat)) return { at: beat, from: "heartbeat" };
  return { at: Date.parse(held.acquiredAt), from: "acquisition" };
}

/**
 * Is this holder still there, and did we find that out or infer it?
 *
 * The order of the rules is the argument. Direct observation of the holder is
 * consulted first and, when available, is the *whole* answer: the TTL is never
 * reached for a pid this host can interrogate, in either direction. It decides
 * only the cases where nothing can be observed — an unnamed holder, or one on
 * another machine, where a pid number means nothing.
 */
export function leaseLiveness(
  held: WorkspaceLeaseRecord | null,
  opts: { now: number; ttlMs: number; host: string },
): Liveness {
  if (held === null) {
    return { verdict: "dead", evidence: "unreadable", assumed: false, why: "the lease record is unreadable" };
  }
  const acquired = Date.parse(held.acquiredAt);
  if (!Number.isFinite(acquired)) {
    return {
      verdict: "dead",
      evidence: "unreadable",
      assumed: false,
      why: `the lease record's acquiredAt (${held.acquiredAt}) is not a timestamp`,
    };
  }

  const observable = held.holderPid !== undefined && held.host === opts.host;
  if (observable) {
    const holderPid = held.holderPid!;
    if (!pidAlive(holderPid)) {
      return {
        verdict: "dead",
        evidence: "pid-gone",
        assumed: false,
        why: `holder pid ${holderPid} on this host is gone`,
      };
    }
    // Live, and therefore not reclaimable — whatever the clock says. See the
    // header: the TTL is a proxy for "nobody is home" and this is the thing
    // itself. What remains is whether the holder is still doing anything.
    if (held.heartbeatEveryMs !== undefined && held.heartbeatEveryMs > 0) {
      const { at, from } = lastAliveAt(held);
      const silentMs = opts.now - at;
      const staleAfterMs = staleAfterFor(held.heartbeatEveryMs);
      if (Number.isFinite(at) && silentMs >= staleAfterMs) {
        return {
          verdict: "suspect",
          evidence: "heartbeat-silent",
          assumed: true,
          why:
            `holder pid ${holderPid} is alive but silent ${Math.round(silentMs / 60_000)}m since its last ${from}, ` +
            `past the ${Math.round(staleAfterMs / 60_000)}m it promised to speak within`,
        };
      }
    }
    return {
      verdict: "live",
      evidence: "pid-alive",
      assumed: false,
      why: `holder pid ${holderPid} on this host is running`,
    };
  }

  const ageMs = opts.now - acquired;
  const unobservable = held.holderPid === undefined ? "no holder pid was named" : `the holder is on ${held.host}`;
  if (ageMs >= opts.ttlMs) {
    return {
      verdict: "dead",
      evidence: "ttl-expired",
      assumed: true,
      why:
        `held ${Math.round(ageMs / 60_000)}m, past the ${Math.round(opts.ttlMs / 60_000)}m TTL — assumed dead ` +
        `rather than observed, because ${unobservable}`,
    };
  }
  return {
    verdict: "live",
    evidence: "within-ttl",
    assumed: true,
    why: `held ${Math.round(ageMs / 60_000)}m of a ${Math.round(opts.ttlMs / 60_000)}m TTL, and ${unobservable}`,
  };
}

/** Temp names are per-process and per-attempt; nothing ever reads them back. */
let tmpCounter = 0;

/** Claim ordinals within this process. With `pid` in front, `pid:n` names one claim and no other. */
let claimCounter = 0;

/**
 * Write the record to a temp file and `link` it into place.
 *
 * Not `writeFileSync(…, {flag:"wx"})`: create and write are two syscalls, and
 * between them the lease exists and is zero bytes. A second run landing in that
 * window reads `""`, fails to parse it, classes the lease unreadable, and
 * reclaims a workspace whose holder is very much alive — the one outcome this
 * module exists to prevent, caused by the module itself. Linking a complete
 * temp file makes the name appear already whole or not at all, and `link` fails
 * `EEXIST` in the kernel. Same reasoning, same shape, as `src/loop/lock.ts`.
 */
function linkInPlace(leaseFile: string, record: WorkspaceLeaseRecord): boolean {
  const tmp = path.join(path.dirname(leaseFile), `.${path.basename(leaseFile)}.${record.pid}.${tmpCounter++}`);
  fs.writeFileSync(tmp, JSON.stringify(record) + "\n");
  try {
    fs.linkSync(tmp, leaseFile);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    return false;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Move a lease out of the way rather than unlinking it in place.
 *
 * Two runs can decide to break the same dead lease at the same instant. Renaming
 * first means the loser removes a file that is already out of the way instead of
 * deleting the winner's fresh lease; who actually gets the workspace is settled
 * by the single `link` that succeeds afterwards, never by who unlinked first.
 */
function breakLease(leaseFile: string, now: number, pid: number): void {
  try {
    const sidelined = `${leaseFile}.stale-${now}-${pid}`;
    fs.renameSync(leaseFile, sidelined);
    fs.rmSync(sidelined, { force: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

/**
 * Take the lease on `dir`, reclaiming it from a holder that is gone.
 *
 * Acts on `dead` and on nothing else. `suspect` — a live pid that has stopped
 * speaking — is refused with its reason carried out to the caller, because a
 * single reading cannot tell a hang from a suspended machine and the wrong guess
 * destroys a healthy run's work.
 *
 * The workspace directory itself is neither created nor inspected nor touched.
 * This call transfers ownership; deciding what to do with what the dead holder
 * left is `reconcileWorkspace`'s question and the caller's to ask.
 */
export function acquireWorkspaceLease(dir: string, opts: LeaseOptions): AcquireLeaseResult {
  const resolved = path.resolve(dir);
  const leaseFile = workspaceLeasePath(resolved);
  fs.mkdirSync(path.dirname(leaseFile), { recursive: true });
  const now = opts.now ?? Date.now();
  const host = opts.host ?? os.hostname();
  const writerPid = opts.pid ?? process.pid;
  const record: WorkspaceLeaseRecord = {
    token: `${writerPid}:${claimCounter++}`,
    pid: writerPid,
    ...(opts.holderPid !== undefined ? { holderPid: opts.holderPid } : {}),
    host,
    acquiredAt: new Date(now).toISOString(),
    ...(opts.heartbeatEveryMs !== undefined
      ? { heartbeatEveryMs: opts.heartbeatEveryMs, heartbeatAt: new Date(now).toISOString() }
      : {}),
    ...(opts.runId ? { runId: opts.runId } : {}),
  };

  if (linkInPlace(leaseFile, record)) return { ok: true, dir: resolved, record, reclaimed: null };

  const held = readWorkspaceLease(resolved);
  const liveness = leaseLiveness(held, { now, ttlMs: opts.ttlMs, host });
  if (liveness.verdict !== "dead") {
    return {
      ok: false,
      dir: resolved,
      held,
      liveness,
      reason:
        liveness.verdict === "suspect"
          ? `the workspace is leased and its holder may be hung — ${liveness.why}`
          : `the workspace is leased — ${liveness.why}`,
    };
  }

  breakLease(leaseFile, now, record.pid);
  if (linkInPlace(leaseFile, record)) return { ok: true, dir: resolved, record, reclaimed: { held, liveness } };
  return {
    ok: false,
    dir: resolved,
    held: readWorkspaceLease(resolved),
    liveness,
    reason: "another run took the lease while this one was reclaiming a dead copy",
  };
}

/**
 * Prove the holder is still making progress, by advancing `heartbeatAt`.
 *
 * Atomic by temp-then-rename, for the same reason acquisition is atomic by
 * link: a reader must never see a half-written record and call it unreadable,
 * because "unreadable" licenses a reclaim.
 *
 * Returns false when there is no lease to stamp, or when stamping failed. A
 * failed heartbeat costs patience, never safety — the worst it can do is leave a
 * healthy holder looking `suspect`, which this module refuses to act on.
 */
export function touchWorkspaceLease(dir: string, now: number = Date.now()): boolean {
  const leaseFile = workspaceLeasePath(dir);
  const held = readWorkspaceLease(dir);
  if (held === null) return false;
  const next: WorkspaceLeaseRecord = { ...held, heartbeatAt: new Date(now).toISOString() };
  const tmp = path.join(path.dirname(leaseFile), `.${path.basename(leaseFile)}.${process.pid}.${tmpCounter++}`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(next) + "\n");
    fs.renameSync(tmp, leaseFile);
    return true;
  } catch {
    fs.rmSync(tmp, { force: true });
    return false;
  }
}

/**
 * Give the lease back, if it is still ours.
 *
 * Releasing is what makes the fast path fast: a run that ends cleanly leaves
 * nothing for the next one to reason about, and every liveness rule above is the
 * recovery path for runs that do not get to do this. It refuses to release a
 * lease that has been reclaimed and retaken in the meantime — by then the
 * workspace belongs to somebody else, and unlinking would hand it to a third
 * arrival while the second is still building in it.
 *
 * The comparison is on {@link WorkspaceLeaseRecord.token} and nothing else, for
 * the reason that field documents: the record's visible contents are not an
 * identity, and matching on them let a stale holder release a live claim.
 */
export function releaseWorkspaceLease(dir: string, record: WorkspaceLeaseRecord, now: number = Date.now()): boolean {
  const current = readWorkspaceLease(dir);
  if (current === null) return false;
  // An empty token is a record written before tokens existed, or a truncated
  // one. It matches nothing: refusing to release costs a lease that ages out on
  // its own rules, and releasing wrongly costs somebody's build.
  if (record.token === "" || current.token !== record.token) return false;
  breakLease(workspaceLeasePath(dir), now, record.pid);
  return true;
}

/** One line a caller can print, saying what happened and — the point — on what evidence. */
export function formatLeaseOutcome(result: AcquireLeaseResult): string {
  if (!result.ok) return `lease refused: ${result.reason}`;
  if (result.reclaimed === null) return `lease taken on ${result.dir} (it was free)`;
  const { liveness } = result.reclaimed;
  const how = liveness.assumed ? "assumed dead" : "observed dead";
  return `lease reclaimed on ${result.dir} — previous holder ${how}: ${liveness.why}`;
}
