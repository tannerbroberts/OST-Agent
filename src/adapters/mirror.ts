/**
 * The mirror: `.ost-agent/evidence/` read as a local replica of the systems the
 * adapters fetched from, with an age on every record.
 *
 * The evidence directory has always BEEN a mirror — every adapter is read-only and
 * writes what it fetched to disk, so nothing downstream ever touches a live system
 * (see `CONTRIBUTING.md`, "Adding a read-only source"). What it was missing is the
 * cost of that arrangement: a replica is correct only in proportion to how recently
 * it was filled, and until now nothing on a record said when that was.
 *
 * `timestamp` did not say it and cannot. It is the item's OWN time — a Jira issue's
 * `updated`, a Slack message's `ts`, an inbox file's mtime — which means it is
 * chosen by the producer. `touch -d 2030 note.md` in the drop folder is enough to
 * make a record look freshly captured, and the drop folder is the untrusted
 * builder's channel by design (DEC-1). So the fetch stamp is written by the
 * ingesting surface, from its own clock, exactly like the `actor` stamp and for
 * exactly the same reason: it is the one field on the record whose producer must
 * have no say in it (`writeEvidence`).
 *
 * **What this module does NOT decide is whether the staleness is acceptable.** That
 * depends on what a team is deciding with the data — a tree built from a week-old
 * Jira export is fine for finding an opportunity and useless for reporting a sprint
 * — and it is a person's call. What it decides is that the number exists, travels
 * with the read, and is loud when it crosses the bound the operator set.
 */
import { readEvidenceScan, type EvidenceRecord, type EvidenceScan } from "../processes/tree.js";

export const MS_PER_DAY = 86_400_000;

/**
 * What a read can honestly say about a record's age. Four answers, because
 * collapsing any two of them is a lie a consumer would act on.
 *
 * - `fresh` — stamped, and inside the operator's bound. The ONLY answer that
 *   licenses treating a mirrored read like a live one; see {@link isCertifiedFresh}.
 * - `stale` — stamped, and past the bound. The record is still served, and served
 *   marked: hiding it would be a second silent failure on top of the first.
 * - `undated` — no readable fetch stamp. Written before the stamp existed, or
 *   hand-edited. Its age is unknown, which is not the same as large, and not the
 *   same as small. The same third answer `CursorRecord` needed for the same reason:
 *   calling every pre-upgrade record stale would flag a healthy vault as rotten on
 *   the day it upgraded, and calling one fresh would be a claim nothing on disk
 *   supports.
 * - `unbounded` — stamped, but the operator has set no bound, so nothing here can
 *   say whether the age is too much. Deliberately NOT `fresh`: `evidence.staleAfterDays`
 *   has no default (the rule `loop.cadence` and `discovery.target` already keep — a
 *   number that decides "this data is too old to act on" is the operator's to set),
 *   and a missing knob must never read as a passing verdict.
 */
export type Freshness = "fresh" | "stale" | "undated" | "unbounded";

/** One record as the mirror serves it: the data, its age, and what that age means. */
export interface MirrorRead {
  readonly record: EvidenceRecord;
  /**
   * Milliseconds between the fetch stamp and `now`, or null when the record carries
   * no readable stamp. Floored at 0: the stamp is this process's own clock rather
   * than a producer's claim, so a stamp in the future is skew, and "negative age"
   * is not a thing a consumer should have to reason about.
   */
  readonly ageMs: number | null;
  readonly freshness: Freshness;
}

/** Everything {@link readMirror} was offered, in the shape {@link EvidenceScan} reports it. */
export interface MirrorScan {
  /** `.md` files present — the subject as it was found, unchanged from {@link EvidenceScan}. */
  readonly offered: number;
  readonly reads: MirrorRead[];
  readonly unreadable: string[];
  /** The bound this scan classified against, echoed so a caller can print it. */
  readonly staleAfterDays: number | null;
}

export interface MirrorOptions {
  /** `ost.config.yaml`'s `evidence.staleAfterDays`. Absent ⇒ every read is `unbounded`. */
  readonly staleAfterDays?: number | null;
  /** Injected so classification is deterministic under test, like every clock here. */
  readonly now?: Date;
}

/**
 * Age one fetch stamp against the bound.
 *
 * Exported because two callers classify without wanting a directory read: the
 * mirror scan below, and `ost_next_work`, which has already read the records for
 * other reasons and must not read them twice (a second read is a second walk, and a
 * second walk can disagree).
 */
export function classifyFreshness(
  fetchedAt: string | undefined,
  opts: MirrorOptions = {},
): { ageMs: number | null; freshness: Freshness } {
  const stamped = fetchedAt ? Date.parse(fetchedAt) : NaN;
  // Unparseable is `undated`, not `stale`. A damaged stamp says nothing about age,
  // and the one thing this may not do is invent a verdict from a field it could not
  // read — the same fail-closed-to-*unknown* move `actor` makes.
  if (!Number.isFinite(stamped)) return { ageMs: null, freshness: "undated" };
  const ageMs = Math.max(0, (opts.now ?? new Date()).getTime() - stamped);
  const bound = opts.staleAfterDays;
  if (bound == null) return { ageMs, freshness: "unbounded" };
  return { ageMs, freshness: ageMs >= bound * MS_PER_DAY ? "stale" : "fresh" };
}

/**
 * May a consumer treat this read as it would a live one?
 *
 * A predicate rather than `freshness !== "stale"`, because three of the four answers
 * are not-stale and only one of them is a licence. Written once, here, so no call
 * site gets to decide that `undated` is probably fine.
 */
export function isCertifiedFresh(freshness: Freshness): boolean {
  return freshness === "fresh";
}

/** Whole days, rounded down — how an age is written when a human reads it. */
export function ageInDays(ageMs: number): number {
  return Math.floor(ageMs / MS_PER_DAY);
}

/**
 * The phrase a surface puts next to a served record.
 *
 * Every answer gets one, including the good ones. A marker that appears only on bad
 * news reads as absence-of-marker on a surface that might simply not have looked —
 * which is the same ambiguity `ost_ingest_inbox` prints a line per channel to kill.
 */
export function freshnessNote(read: MirrorRead, staleAfterDays: number | null): string {
  switch (read.freshness) {
    case "stale":
      return `STALE — mirrored ${ageInDays(read.ageMs ?? 0)}d ago, past the ${staleAfterDays}d bound; re-fetch before relying on it`;
    case "fresh":
      return `fresh — mirrored ${ageInDays(read.ageMs ?? 0)}d ago, within the ${staleAfterDays}d bound`;
    case "unbounded":
      return `mirrored ${ageInDays(read.ageMs ?? 0)}d ago — no evidence.staleAfterDays is set, so nothing here calls that too old`;
    case "undated":
      return "age UNKNOWN — this record carries no fetch stamp, so it cannot be read as current";
  }
}

/** Read the mirror and report every record's age alongside it. */
export function readMirror(dir: string, opts: MirrorOptions = {}): MirrorScan {
  const scan: EvidenceScan = readEvidenceScan(dir);
  return {
    offered: scan.offered,
    unreadable: scan.unreadable,
    staleAfterDays: opts.staleAfterDays ?? null,
    reads: scan.records.map((record) => ({ record, ...classifyFreshness(record.fetchedAt, opts) })),
  };
}
