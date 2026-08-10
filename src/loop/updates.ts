/**
 * The update channel and the checkpoint barrier — a change announced from
 * outside lands *between* passes or it does not land.
 *
 * This is the push-shaped half of "improvements I ship never reach the agents
 * already running". The two pull-shaped mechanisms make propagation depend on
 * the operator remembering something; this one begins on the publisher's side,
 * which is the only way an urgent fix reaches an instance nobody has thought
 * about in weeks. The price is stated plainly at the bottom of this comment,
 * because it is the reason the rest of the file is shaped the way it is.
 *
 * **The barrier is the whole engineering claim, and it runs in both
 * directions.** An announcement may arrive at any moment, including the middle
 * of a pass, and the pass is a sequence of separate processes (`loop start`,
 * n × `loop step`, `loop seal`) writing an append-only ledger and a tree of
 * markdown files. A change applied between two of those steps lands on a
 * half-finished write by construction. So:
 *
 *   - an announcement is never applied while a run is open — the open marker
 *     (`open-run.json`) is checked first, and a pass in flight means `held`;
 *   - an apply takes the **firing lock**, so a pass cannot start underneath one;
 *   - the open marker is checked *again* under the lock, because between the
 *     first check and the acquire a `loop start` may have won the race. Without
 *     the second read the barrier has a window exactly the width of the lock
 *     acquire, which is the same shape of bug the lock's own zero-byte window
 *     was (`lock.ts`).
 *
 * Nothing is lost by holding: the spool is append-only and the announcement is
 * still the newest one at the next checkpoint. `loop start` applies before it
 * opens its run, so an operator who never adds a cron step still propagates —
 * which is the one property this candidate exists for.
 *
 * **Applying writes a version pin, and can do nothing else.** An announcement
 * carries a channel, a version and a couple of human-readable strings. It does
 * NOT carry a command, a path or a URL to run, and `readAnnouncements` projects
 * every line down to the known fields, so a hand-written spool entry with a
 * `run:` key in it reaches nobody. Applying replaces `applied.json` — one
 * rename, so a concurrent reader sees the old pin or the new one and never a
 * torn record — and that is the entire effect. This repository's guarantee is
 * that it holds no destructive capability (`CONTRIBUTING.md`, `src/security/
 * policy.ts`); an update channel that could hand an announced string to a shell
 * would be that guarantee's exact negation, arriving as a feature.
 *
 * **Where this lives, and the tension it is in.** The spool and the pin sit in
 * `.git/ost-agent/updates/`, for the reason `state.ts` gives: git will not track
 * anything inside its own directory, so a file here cannot be swept into the
 * next `git add -A` commit, and F6 holds — no surface the unattended agent can
 * reach can write what decides which version it runs. That closes the *agent*
 * side and states the other side rather than hiding it: the publisher writing
 * this spool from outside the operator's machine is not a bug in the design, it
 * is the design. F6's sentence is that a decider the agent can write decides
 * nothing; a push channel deliberately introduces a decider written by somebody
 * who is not the operator. Whether that trade is acceptable is a question about
 * people, and the assumption test under this solution is the thing that answers
 * it — not this file.
 *
 * **So the channel is opt-in and there is no default**, the same rule and for
 * the same reason as `loop.cadence`: a vault that has not named a channel is
 * subscribed to nothing, refuses to spool an announcement, and can never apply
 * one. Nothing here is on unless an operator typed it.
 */
import fs from "node:fs";
import path from "node:path";
import { readOpenRun } from "./health.js";
import { acquireFiringLock, releaseFiringLock } from "./lock.js";
import { loopStateDir, requireLoopStateDir } from "./state.js";

/** Where the spool and the pin live, or null when this vault is not a checkout. */
export function updatesDir(vaultDir: string): string | null {
  const state = loopStateDir(vaultDir);
  return state === null ? null : path.join(state, "updates");
}

/** The append-only spool a subscriber writes what it heard into. */
export function announcedPath(vaultDir: string): string | null {
  const dir = updatesDir(vaultDir);
  return dir === null ? null : path.join(dir, "announced.jsonl");
}

/** The version currently in force on this machine. One file, replaced by rename. */
export function appliedPath(vaultDir: string): string | null {
  const dir = updatesDir(vaultDir);
  return dir === null ? null : path.join(dir, "applied.json");
}

export interface UpdateAnnouncement {
  /** Which channel announced it. An announcement addressed elsewhere is ignored. */
  channel: string;
  version: string;
  /** When the publisher announced it, not when this machine heard it. */
  announcedAt: string;
  /** Who says so. Informational — nothing branches on it. */
  source?: string;
  notes?: string;
}

export interface AppliedUpdate extends UpdateAnnouncement {
  /** When this machine reached a checkpoint and took it. */
  appliedAt: string;
}

export interface UpdateSubscription {
  channel: string;
}

export type CheckpointOutcome =
  | { action: "unsubscribed"; reason: string }
  | { action: "none"; reason: string; applied: AppliedUpdate | null }
  | { action: "held"; reason: string; pending: UpdateAnnouncement }
  | { action: "applied"; reason: string; applied: AppliedUpdate };

/**
 * What a channel may be called, and what a version may look like.
 *
 * Both are deliberately narrow. A version reaches a launcher as a package
 * specifier and a channel names a file the vault opens, so neither may contain
 * a path separator, a `..`, whitespace or a shell metacharacter. A publisher
 * that cannot express its version inside this alphabet is a publisher whose
 * announcement this machine declines to understand, which is the safe direction.
 */
const CHANNEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/;

/**
 * The declared subscription, or null for "this vault is subscribed to nothing".
 *
 * All-or-nothing like `ceilingOf` and `questionBudgetOf` in `src/cli/loop.ts`: a
 * blank or malformed channel is not a subscription with a default, it is no
 * subscription. The failure this avoids is a vault that accepts updates because
 * somebody left a key half-typed.
 */
export function subscriptionOf(updates: { channel?: string | null } | null | undefined): UpdateSubscription | null {
  const channel = updates?.channel;
  if (typeof channel !== "string") return null;
  const trimmed = channel.trim();
  return CHANNEL_PATTERN.test(trimmed) ? { channel: trimmed } : null;
}

/**
 * Project one spool line down to the fields an announcement is allowed to have.
 *
 * Returns null for anything that does not validate. This is where "an
 * announcement cannot smuggle a command" is actually enforced: the object is
 * rebuilt field by field rather than spread, so an unknown key in the spool
 * cannot survive a read even if something wrote one.
 */
function projectAnnouncement(raw: unknown): UpdateAnnouncement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const channel = typeof r.channel === "string" ? r.channel.trim() : "";
  const version = typeof r.version === "string" ? r.version.trim() : "";
  const announcedAt = typeof r.announcedAt === "string" ? r.announcedAt : "";
  if (!CHANNEL_PATTERN.test(channel)) return null;
  if (!VERSION_PATTERN.test(version)) return null;
  if (!Number.isFinite(Date.parse(announcedAt))) return null;
  return {
    channel,
    version,
    announcedAt,
    ...(typeof r.source === "string" && r.source.length > 0 ? { source: r.source } : {}),
    ...(typeof r.notes === "string" && r.notes.length > 0 ? { notes: r.notes } : {}),
  };
}

export type AnnounceResult = { ok: true; announcement: UpdateAnnouncement } | { ok: false; reason: string };

/**
 * Record what the subscriber heard. Append-only, one JSON line, no verdict.
 *
 * Refused when this vault is subscribed to nothing, or when the announcement is
 * addressed to a channel it did not subscribe to — so an unsubscribed vault does
 * not merely decline to *apply* updates, it declines to accumulate them. The
 * write happens here and the decision happens in {@link applyAtCheckpoint};
 * nothing on this path can apply anything, which is what makes it safe for the
 * process listening to the channel to be the least-trusted thing in the loop.
 */
export function announceUpdate(
  vaultDir: string,
  input: { channel: string; version: string; announcedAt?: string; source?: string; notes?: string },
  opts: { subscription: UpdateSubscription | null; now?: number } = { subscription: null },
): AnnounceResult {
  const { subscription } = opts;
  if (subscription === null) {
    return {
      ok: false,
      reason:
        "this vault is subscribed to no update channel — declare `loop.updates.channel` in ost.config.yaml, " +
        "or leave it absent and the vault will never take an update it was pushed",
    };
  }
  const announcedAt = input.announcedAt ?? new Date(opts.now ?? Date.now()).toISOString();
  const announcement = projectAnnouncement({ ...input, announcedAt });
  if (announcement === null) {
    return { ok: false, reason: `not a usable announcement: channel ${JSON.stringify(input.channel)}, version ${JSON.stringify(input.version)}, announcedAt ${JSON.stringify(announcedAt)}` };
  }
  if (announcement.channel !== subscription.channel) {
    return { ok: false, reason: `addressed to channel "${announcement.channel}"; this vault subscribes to "${subscription.channel}"` };
  }
  const dir = path.join(requireLoopStateDir(vaultDir), "updates");
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, "announced.jsonl"), JSON.stringify(announcement) + "\n");
  return { ok: true, announcement };
}

/** Everything on the spool that parses, in the order it was written. */
export function readAnnouncements(vaultDir: string): UpdateAnnouncement[] {
  const p = announcedPath(vaultDir);
  if (p === null || !fs.existsSync(p)) return [];
  const out: UpdateAnnouncement[] = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // a corrupt line is not an announcement; it is also not a reason to stop
    }
    const a = projectAnnouncement(parsed);
    if (a !== null) out.push(a);
  }
  return out;
}

/** The pin, or null when this machine has never applied one. */
export function readAppliedUpdate(vaultDir: string): AppliedUpdate | null {
  const p = appliedPath(vaultDir);
  if (p === null || !fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
    const projected = projectAnnouncement(raw);
    if (projected === null) return null;
    const appliedAt = typeof raw.appliedAt === "string" ? raw.appliedAt : "";
    return Number.isFinite(Date.parse(appliedAt)) ? { ...projected, appliedAt } : null;
  } catch {
    return null;
  }
}

export interface PendingVerdict {
  pending: UpdateAnnouncement | null;
  /** Announcements stamped after `now`, ignored for the choice and reported here. */
  ignoredFuture: number;
  reason: string;
}

/**
 * Which announcement, if any, this machine is behind on.
 *
 * **Future stamps are ignored, not clamped**, exactly as in `cadence.ts` and for
 * the same reason: a single announcement stamped in the year 3000 would
 * otherwise be "the newest" forever, and every real announcement after it would
 * read as a downgrade. Ignoring it means the newest announcement that could
 * actually have happened decides, and the anomaly rides out with the verdict so
 * the operator sees the clock problem instead of inheriting its consequences.
 *
 * **An older announcement never rolls the pin back.** The spool is append-only
 * and arrival order is not announcement order — a subscriber that reconnects
 * after a gap replays what it missed, and one of those is older than what this
 * machine already runs. A pin that moved backwards on a replay would be an
 * update channel that downgrades an unattended agent, which is the failure this
 * whole node is judged on.
 */
export function pendingUpdate(input: {
  announcements: readonly UpdateAnnouncement[];
  applied: AppliedUpdate | null;
  subscription: UpdateSubscription;
  now: number;
}): PendingVerdict {
  const { announcements, applied, subscription, now } = input;
  const mine = announcements.filter((a) => a.channel === subscription.channel);
  const usable = mine.filter((a) => Date.parse(a.announcedAt) <= now);
  const ignoredFuture = mine.length - usable.length;

  let newest: UpdateAnnouncement | null = null;
  for (const a of usable) {
    // `>=` so that on a tie the LAST line written wins — the spool's own order
    // is the only tiebreak available, and it is the arrival order.
    if (newest === null || Date.parse(a.announcedAt) >= Date.parse(newest.announcedAt)) newest = a;
  }

  if (newest === null) {
    return { pending: null, ignoredFuture, reason: ignoredFuture > 0 ? `nothing announced that could have happened yet (${ignoredFuture} future-stamped, ignored)` : "nothing announced on this channel" };
  }
  if (applied === null) return { pending: newest, ignoredFuture, reason: `${newest.version} announced; nothing applied on this machine yet` };
  if (applied.version === newest.version) return { pending: null, ignoredFuture, reason: `up to date on ${applied.version}` };
  if (Date.parse(newest.announcedAt) < Date.parse(applied.announcedAt)) {
    return { pending: null, ignoredFuture, reason: `newest announcement (${newest.version}) is older than the applied ${applied.version} — a replayed announcement never rolls this machine back` };
  }
  return { pending: newest, ignoredFuture, reason: `${newest.version} announced ${newest.announcedAt}; this machine is on ${applied.version}` };
}

/** Temp names are per-process and per-attempt; nothing ever reads them back. */
let tmpCounter = 0;

/**
 * Replace the pin in one rename, so no reader ever sees a half-written pin.
 *
 * Same argument as `stampFiringLock`: write the whole record to a temp name and
 * publish it by rename. Create-then-write would leave a window in which the pin
 * exists and is zero bytes, and a launcher reading it there would find no version
 * at all on a machine that has one.
 */
function writePin(vaultDir: string, pin: AppliedUpdate): void {
  const dir = path.join(requireLoopStateDir(vaultDir), "updates");
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.applied.json.${process.pid}.${tmpCounter++}`);
  fs.writeFileSync(tmp, JSON.stringify(pin) + "\n");
  fs.renameSync(tmp, path.join(dir, "applied.json"));
}

export interface CheckpointOptions {
  subscription: UpdateSubscription | null;
  /** How long a firing lock may be held before it is assumed dead. */
  ttlMs: number;
  now?: number;
  /**
   * Set by a caller that already holds the firing lock — `loop start`, which
   * applies between taking the lock and opening its run. Re-acquiring there
   * would refuse against the caller's own lock and hold every update forever.
   */
  holdsLock?: boolean;
}

/**
 * Apply the pending update if — and only if — this moment is between passes.
 *
 * The order of the checks is the barrier. Read the open marker, then take the
 * lock, then read the open marker AGAIN: the second read is what closes the
 * window between the first read and the acquire, and it is the difference
 * between "applies between passes" and "applies between passes most of the
 * time". Everything that is not an apply leaves every byte on disk untouched.
 */
export function applyAtCheckpoint(vaultDir: string, opts: CheckpointOptions): CheckpointOutcome {
  const { subscription, ttlMs, holdsLock = false } = opts;
  const now = opts.now ?? Date.now();
  if (subscription === null) {
    return { action: "unsubscribed", reason: "no `loop.updates.channel` in ost.config.yaml — this vault takes no pushed updates" };
  }

  const applied = readAppliedUpdate(vaultDir);
  const verdict = pendingUpdate({ announcements: readAnnouncements(vaultDir), applied, subscription, now });
  if (verdict.pending === null) return { action: "none", reason: verdict.reason, applied };
  const pending = verdict.pending;

  // Cheap check first: an open run means a pass is in flight, and no lock state
  // can make that safe. It also covers the marker a crashed pass left behind —
  // held rather than swept, because sweeping is `loop start`'s job and a command
  // that applies updates has no business writing the health ledger.
  const openBefore = readOpenRun(vaultDir);
  if (openBefore !== null) {
    return { action: "held", reason: `pass ${openBefore.runId} is in flight — ${pending.version} waits for the next checkpoint`, pending };
  }

  if (holdsLock) {
    const pin: AppliedUpdate = { ...pending, appliedAt: new Date(now).toISOString() };
    writePin(vaultDir, pin);
    return { action: "applied", reason: `applied ${pin.version} at a checkpoint${applied ? ` (was ${applied.version})` : ""}`, applied: pin };
  }

  const lock = acquireFiringLock(vaultDir, { ttlMs, now, holderPid: process.pid });
  if (!lock.ok) {
    return { action: "held", reason: `a firing holds the lock — ${lock.reason}; ${pending.version} waits for the next checkpoint`, pending };
  }
  try {
    // The second read. A `loop start` that won the race for the lock before this
    // one took it has already opened its run by now, and applying on top of that
    // is precisely the half-finished write this barrier exists to prevent.
    const openAfter = readOpenRun(vaultDir);
    if (openAfter !== null) {
      return { action: "held", reason: `pass ${openAfter.runId} opened while this checkpoint was taking the lock — ${pending.version} waits`, pending };
    }
    const pin: AppliedUpdate = { ...pending, appliedAt: new Date(now).toISOString() };
    writePin(vaultDir, pin);
    return { action: "applied", reason: `applied ${pin.version} at a checkpoint${applied ? ` (was ${applied.version})` : ""}`, applied: pin };
  } finally {
    releaseFiringLock(vaultDir, { pid: lock.record.pid, acquiredAt: lock.record.acquiredAt });
  }
}

/**
 * One line for whichever surface prints it — `loop health`, `loop start`.
 *
 * Says what is running and what is waiting, because those are different facts
 * and an operator reading only the first cannot tell a vault that is up to date
 * from one that has been holding an update through every pass for a week.
 */
export function updateStatusLine(vaultDir: string, subscription: UpdateSubscription | null, now: number): string {
  if (subscription === null) return "update-channel: none — this vault takes no pushed updates";
  const applied = readAppliedUpdate(vaultDir);
  const verdict = pendingUpdate({ announcements: readAnnouncements(vaultDir), applied, subscription, now });
  const running = applied ? `${applied.version} (applied ${applied.appliedAt})` : "nothing applied yet";
  const waiting = verdict.pending ? `; ${verdict.pending.version} pending, applies at the next checkpoint` : "";
  const clock = verdict.ignoredFuture > 0 ? ` ⚠ ${verdict.ignoredFuture} future-stamped announcement(s) ignored — check this machine's clock` : "";
  return `update-channel: ${subscription.channel} — ${running}${waiting}${clock}`;
}
