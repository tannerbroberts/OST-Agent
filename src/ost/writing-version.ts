/**
 * Which build wrote this vault state — stamped on the way past, and refused
 * rather than guessed when nothing fresh says.
 *
 * **The failure this exists for.** The same vault, at the same instant, read 9
 * items outstanding under `ost-agent@0.1.3` and 27 under the build of the day.
 * Nothing about the vault had changed; the newer build decided done-ness by a
 * rule the older one never applied. The vault gave no sign its history had been
 * reinterpreted, so work that was genuinely finished became indistinguishable
 * from work that never was. Naming the re-opened class requires knowing which
 * accounting produced it, and that is a fact about the *writer*, which no vault
 * here has ever recorded.
 *
 * **What a walk of this repository's own vault found, and why it shapes the
 * design.** Over the hundred states in `test/fixtures/writing-version/`
 * (2026-08-31 → 2026-09-01), exactly one machine-written file names a version:
 * `.ost-agent/health/runs.jsonl`, whose last record is `cliVersion 0.21.0`
 * written 2026-07-27. It is thirty-five days and two minor releases out of date
 * across every one of those hundred states, and it is byte-identical in all of
 * them — the loop that wrote it stopped, and nothing noticed. A resolver that
 * simply read the newest version it could find would therefore have answered
 * `0.21.0`, unambiguously, a hundred times, and been wrong a hundred times.
 * Which is worse than answering nothing: an unresolved state sends a reader to
 * look, and a confidently stale one does not.
 *
 * So the freshness clause is the load-bearing part of {@link
 * resolveWritingVersion}, not a refinement of it. A stamp is evidence about the
 * moment it was written and about no later moment, and this module will say
 * "unresolved, and here is the dead stamp I found" rather than promote a stamp
 * past its own staleness.
 *
 * **Why the stamp carries an accounting fingerprint and not only a version.**
 * `VERSION` in this repository has read `0.23.0` since 2026-07-28 while 205 pull
 * requests merged, several of which moved what counts as
 * done — the Assumption layer among them. A semver stamp would have been
 * perfectly fresh, perfectly correct, and blind to every accounting change it
 * was added to catch. {@link ACCOUNTING_RULES} names the rules that decide
 * done-ness, {@link accountingFingerprint} hashes them, and a change to any one
 * of them moves the stamp whether anyone remembers to bump a version or not.
 * The same fact is why `legacy-fallback.ts` had to express its boundary as a
 * date: a version that does not move cannot mark anything.
 *
 * **What this does NOT settle.** That an operator wants to be told, reads what
 * they are told, or resolves the eighteen items once they can see them. This
 * makes the boundary visible; whether visibility is the right answer is a
 * question about a person and no exit code confers it.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { VERSION } from "../index.js";
import { LEGACY_TEST_EDGE } from "./legacy-fallback.js";
import { OLD_ACCOUNTING } from "./accounting-reconstruction.js";

/** Where the stamp lives, relative to the vault root. */
export const WRITING_VERSION_PATH = ".ost-agent/state/writing-version.json";

/** The one legacy stamp that predates this module, and the only version signal old vaults carry. */
export const LEGACY_HEALTH_LOG = ".ost-agent/health/runs.jsonl";

/**
 * A stamp is evidence about when it was written. Past this, it is a fact about
 * history rather than about the current writer, and {@link resolveWritingVersion}
 * stops reading it as an answer.
 *
 * Seven days, against a refresh interval of twelve hours: fourteen refreshes
 * have to be missed before a live vault goes unresolved, so this fires on a
 * writer that has *stopped* rather than on one that was merely quiet over a
 * weekend. The health log this replaces was thirty-five days dead when it was
 * found, so the window does not need to be tight to catch the case that
 * happened.
 */
export const STAMP_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How often a stamp is rewritten when nothing about the writer changed.
 *
 * Not every commit. Every commit would mean the stamp file is always dirty,
 * which would turn `gitCommit`'s "nothing to commit" no-op into a real commit
 * carrying nothing but a moved timestamp — and this product commits per write,
 * so that is a permanent stream of empty history. Twice a day keeps the stamp
 * far inside {@link STAMP_STALE_AFTER_MS} at a cost of two lines a day.
 */
export const STAMP_REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * The rules that decide whether a piece of work counts as done, stated as text.
 *
 * Stated rather than computed, because the fingerprint's job is to move when the
 * *meaning* moves. A hash over the implementation would move on a rename and sit
 * still through a rewrite of the rule in the same words; a hash over the rules
 * as written moves exactly when an author changes what they say done means,
 * which is the event a reader has to be told about.
 */
export const ACCOUNTING_RULES: readonly string[] = [
  OLD_ACCOUNTING.rule,
  `a solution counts as tested when an Assumption beneath it carries an AssumptionTest (introduced ${LEGACY_TEST_EDGE.introducedIn})`,
  `${LEGACY_TEST_EDGE.signal} is read as a fallback for tests created before ${LEGACY_TEST_EDGE.boundary}, and not at all from ${LEGACY_TEST_EDGE.droppedIn}`,
];

/** A short, stable digest of {@link ACCOUNTING_RULES} — the thing a version was supposed to be. */
export function accountingFingerprint(rules: readonly string[] = ACCOUNTING_RULES): string {
  return createHash("sha256").update(rules.join("\n")).digest("hex").slice(0, 12);
}

/** Who was writing, and from when. */
export interface WritingVersionStamp {
  version: string;
  /** {@link accountingFingerprint} at the time — moves when done-ness changes, whether or not `version` did. */
  accounting: string;
  /** When this identity first wrote to this vault. */
  since: string;
}

/** The stamp file's shape. `history` only ever grows; a rewrite that shortened it is a bug a test holds. */
export interface WritingVersionState {
  current: WritingVersionStamp;
  /** Refreshed on every write, so the stamp's own age is readable without consulting git. */
  lastWrittenAt: string;
  /** Every identity that has written here, oldest first, including `current`. */
  history: WritingVersionStamp[];
}

/** Absolute path of the stamp in `dir`. */
export function writingVersionPath(dir: string): string {
  return path.join(dir, WRITING_VERSION_PATH);
}

/** The stamp as stored, or null when this vault has never been stamped. */
export function readWritingVersion(dir: string): WritingVersionState | null {
  const file = writingVersionPath(dir);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as WritingVersionState;
    if (!parsed?.current?.version || !parsed.lastWrittenAt || !Array.isArray(parsed.history)) return null;
    return parsed;
  } catch {
    // An unreadable stamp is not a version. Saying nothing is the honest answer,
    // and the caller reports it as unresolved rather than crashing a commit.
    return null;
  }
}

/** What a stamping call did. */
export interface StampResult {
  /** Whether the file was written. False on the ordinary path, where the stamp is fresh and unchanged. */
  wrote: boolean;
  /** The identity now recorded as current. */
  current: WritingVersionStamp;
  /** The identity this replaced, when the writer changed — the boundary a report names. */
  changedFrom?: WritingVersionStamp;
}

/**
 * Record who is writing, if the vault does not already say so freshly.
 *
 * Called from `gitCommit`, which is the funnel every mutation this product makes
 * goes through, so a vault this product has written to cannot end up unstamped
 * by anyone forgetting a call site.
 */
export function stampWritingVersion(
  dir: string,
  opts: { now: string; version?: string; accounting?: string },
): StampResult {
  const identity = { version: opts.version ?? VERSION, accounting: opts.accounting ?? accountingFingerprint() };
  const existing = readWritingVersion(dir);

  if (existing) {
    const same = existing.current.version === identity.version && existing.current.accounting === identity.accounting;
    const age = Date.parse(opts.now) - Date.parse(existing.lastWrittenAt);
    if (same && Number.isFinite(age) && age >= 0 && age < STAMP_REFRESH_AFTER_MS) {
      return { wrote: false, current: existing.current };
    }
    const current = same ? existing.current : { ...identity, since: opts.now };
    const history = same ? existing.history : [...existing.history, { ...identity, since: opts.now }];
    write(dir, { current, lastWrittenAt: opts.now, history });
    return { wrote: true, current, ...(same ? {} : { changedFrom: existing.current }) };
  }

  const current: WritingVersionStamp = { ...identity, since: opts.now };
  write(dir, { current, lastWrittenAt: opts.now, history: [current] });
  return { wrote: true, current };
}

function write(dir: string, state: WritingVersionState): void {
  const file = writingVersionPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf8");
}

/** Where an answer came from, or why there is none. */
export type WritingVersionSource = "stamp" | "legacy-health-log";

/** What the vault can say about who wrote it. */
export interface WritingVersionResolution {
  resolved: boolean;
  version: string | null;
  accounting: string | null;
  source: WritingVersionSource | null;
  /** The sentence a report prints. Always set — an unresolved state says why, which is the point. */
  reason: string;
  /** How far past {@link STAMP_STALE_AFTER_MS} the freshest signal was, when that is what refused it. */
  staleByMs?: number;
}

/**
 * Resolve the writing version of the vault state in `dir` as of `asOf`.
 *
 * `asOf` is the moment the state is being asked about — the commit's own
 * timestamp when walking history, or now when asking about the working tree. It
 * is a parameter rather than a clock read because a stamp's freshness is
 * relative to the state it sits in, and a walk of a hundred past commits judged
 * against today's date would call every one of them stale.
 */
export function resolveWritingVersion(dir: string, opts: { asOf: string }): WritingVersionResolution {
  const asOf = Date.parse(opts.asOf);
  const stamp = readWritingVersion(dir);

  if (stamp) {
    const age = asOf - Date.parse(stamp.lastWrittenAt);
    if (age <= STAMP_STALE_AFTER_MS) {
      return {
        resolved: true,
        version: stamp.current.version,
        accounting: stamp.current.accounting,
        source: "stamp",
        reason: `written by ${stamp.current.version} (accounting ${stamp.current.accounting}), stamped ${stamp.lastWrittenAt}`,
      };
    }
    return {
      resolved: false,
      version: null,
      accounting: null,
      source: null,
      staleByMs: age - STAMP_STALE_AFTER_MS,
      reason:
        `unresolved: the stamp says ${stamp.current.version} but was last written ${stamp.lastWrittenAt}, ` +
        `${days(age)} before this state — a stamp is evidence about when it was written and not about later`,
    };
  }

  const legacy = readLegacyHealthVersion(dir);
  if (legacy) {
    const age = asOf - Date.parse(legacy.at);
    if (age <= STAMP_STALE_AFTER_MS) {
      return {
        resolved: true,
        version: legacy.version,
        accounting: null,
        source: "legacy-health-log",
        reason: `written by ${legacy.version}, read from ${LEGACY_HEALTH_LOG} at ${legacy.at} — no accounting fingerprint, so a change in what done means is invisible here`,
      };
    }
    return {
      resolved: false,
      version: null,
      accounting: null,
      source: null,
      staleByMs: age - STAMP_STALE_AFTER_MS,
      reason:
        `unresolved: the only version signal here is ${LEGACY_HEALTH_LOG}, whose last record is ${legacy.version} ` +
        `at ${legacy.at} — ${days(age)} before this state. That loop stopped writing; its last answer is history, not the writer.`,
    };
  }

  return {
    resolved: false,
    version: null,
    accounting: null,
    source: null,
    reason: "unresolved: nothing machine-written in this state names a version, so which build wrote it cannot be said",
  };
}

function days(ms: number): string {
  const d = Math.floor(ms / (24 * 60 * 60 * 1000));
  return d >= 1 ? `${d} day(s)` : `${Math.max(1, Math.round(ms / (60 * 60 * 1000)))} hour(s)`;
}

/**
 * The last `cliVersion` the pre-stamp health loop recorded, with when it recorded it.
 *
 * Read because it is the only version signal vaults written before this module
 * carry, and read *with its timestamp* because that is the whole difference
 * between using it and being misled by it.
 */
function readLegacyHealthVersion(dir: string): { version: string; at: string } | null {
  const file = path.join(dir, LEGACY_HEALTH_LOG);
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const record = JSON.parse(lines[i]) as { cliVersion?: string; startedAt?: string };
      if (record.cliVersion && record.startedAt) return { version: record.cliVersion, at: record.startedAt };
    } catch {
      // One unreadable line costs that line, not the read — the same stance the
      // accounting ledger takes, and for the same reason.
    }
  }
  return null;
}

/**
 * The resolution as a line, plus the boundary when one is recorded.
 *
 * This is the "explicitly" half of reporting an accounting change: a count that
 * moved is not a finding until a reader is told which two writers produced the
 * two answers.
 */
export function formatWritingVersion(dir: string, opts: { asOf: string }): string {
  const resolution = resolveWritingVersion(dir, opts);
  const lines = [`writing version: ${resolution.reason}`];

  const stamp = readWritingVersion(dir);
  if (stamp && stamp.history.length > 1) {
    const previous = stamp.history[stamp.history.length - 2];
    lines.push(
      `  the accounting changed at ${stamp.current.since}: ${previous.version}/${previous.accounting} → ` +
        `${stamp.current.version}/${stamp.current.accounting}. Counts either side of that line were produced by different rules.`,
    );
    if (previous.version === stamp.current.version) {
      lines.push(
        "  note that the version did not move across that boundary — what done means changed inside one release, " +
          "which is the case a semver stamp alone cannot report.",
      );
    }
  }
  return lines.join("\n");
}
