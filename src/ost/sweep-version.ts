/**
 * A sweep that can say whether anything changed — the precondition for asking a
 * pass to read it once.
 *
 * **The failure this exists to stop.** `ost_next_work` recomputes the outstanding
 * list from scratch on every call and hands the caller nothing to compare against,
 * so two identical answers are indistinguishable from two different ones and the
 * only way to find out whether the picture moved is to read the whole picture
 * again. A machine-recorded trace of this product's own use puts a number on what
 * that costs: `ost_next_work` was 82 of 240 calls on 2026-08-02, 111 of 356 on
 * 2026-08-04, 143 of 580 on 2026-08-18 — between an eighth and a third of every
 * pass, spent re-asking a question the pass had already asked. A caller with no
 * way to be told "nothing changed" has no reason not to re-ask, and telling it to
 * re-ask less is telling it to be less careful.
 *
 * So the sweep carries a {@link sweepVersion} token, and a caller that presents
 * the one it holds gets a {@link SweepDelta} back saying which buckets moved and
 * by how much.
 *
 * **The token is the state, and the server keeps none.** Everything a delta needs
 * — the per-bucket counts the caller last saw, and a digest of what was in them —
 * travels inside the token itself, so nothing here remembers a caller, expires,
 * or has to be reconciled across two processes reading one vault. A token from a
 * different vault, a different scope or a different build simply reads as a
 * different version.
 *
 * **What the counts can and cannot say.** Two different trees can hold the same
 * number of items in every bucket, so counts alone would report "unchanged" over
 * a picture that had entirely turned over. The digest is what makes `unchanged`
 * honest: it is taken over the identity of every item in every bucket, at full
 * size and before any display cap, so equal versions mean an equal outstanding
 * picture and not merely an equal-sized one. The reverse case is real too and is
 * reported rather than smoothed over — a version can move while every count stays
 * put, which is {@link SweepDelta.changedWithoutCountMoving}.
 *
 * **What this does NOT do.** It does not make re-asking cheap. Producing the
 * version requires producing the sweep, so a caller presenting `since` pays the
 * same computation it always did and saves only its own reasoning. Making the
 * unchanged answer cheap to *compute* is a separate candidate with a separate
 * instrument ("Time a candidate version computation against producing the full
 * sweep"), and a version that were cheap but coarse would be worse than the
 * re-reading it replaced. Cheap-and-coarse is the trade this module declines.
 */
import { createHash } from "node:crypto";

/**
 * Every bucket a sweep counts, in the order the token encodes them.
 *
 * The names are the `NextWork` field paths verbatim, so a `moved` entry can be
 * read straight back onto the response it came from. Order is part of the wire
 * format — see {@link SCHEMA_TAG} for why changing this list retires old tokens
 * rather than silently re-labelling their numbers.
 */
export const SWEEP_BUCKETS = [
  "unmappedEvidence",
  "agedOutEvidence",
  "underservedOpportunities",
  "solutionsMissingAssumptions",
  "solutionsMissingInstruments",
  "solutionsAwaitingObservation",
  "assumptionWork.runnable",
  "assumptionWork.awaitingOneCommand",
  "assumptionWork.blockedOnPermission",
  "assumptionWork.needsHumans",
  "outstandingAsks",
  "hygieneIssues",
  "openUnknowns",
  "retiredFromDuplicateScan",
  "withheldByDisposition",
  "suppressedByCondition",
] as const;

export type SweepBucket = (typeof SWEEP_BUCKETS)[number];

/** How many items each bucket held, over the FULL set and never the capped one. */
export type SweepCounts = Readonly<Record<SweepBucket, number>>;

/**
 * What separates two parts in a hashed stream.
 *
 * NUL rather than a space: titles, ids and issue text all contain spaces, so a
 * space-separated stream would let one item's tail and the next item's head hash
 * identically to a differently-split pair — two different pictures, one digest.
 * NUL appears in none of them.
 */
const SEPARATOR = "\u0000";

/** The format marker. Bumped only when the token's shape changes, not its contents. */
const FORMAT = "ost1";

/**
 * A short hash of {@link SWEEP_BUCKETS} itself, carried in every token.
 *
 * Without it, adding or reordering a bucket would leave old tokens parseable and
 * wrong: the same sixteen numbers read against a different list of names produce
 * a delta that names the wrong buckets, which is a report that looks like a
 * measurement. With it, a token issued under a different bucket list fails to
 * parse and comes back `unreadable` — the caller is told it cannot be compared,
 * which is the true answer.
 */
const SCHEMA_TAG = createHash("sha256").update(SWEEP_BUCKETS.join(SEPARATOR)).digest("hex").slice(0, 6);

/** How much of the content digest rides in the token. */
const DIGEST_CHARS = 16;

/**
 * Fold the identity of everything a sweep found into one digest.
 *
 * `parts` are canonical strings — an evidence id, a node title, a bucket tag —
 * taken over the full sets, in the order the walk that produced them emitted
 * them, so two runs over an unchanged tree hash alike.
 *
 * Takes an `Iterable` rather than an array so a caller can hand it a generator.
 * On this product's own 10,000-node stress fixture the material runs past twenty
 * thousand entries, and building that as one array of freshly concatenated
 * strings costs more than the hashing does.
 */
export function sweepContentDigest(parts: Iterable<string>): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update(SEPARATOR);
  }
  return hash.digest("hex");
}

/**
 * The token a sweep carries and a caller presents back.
 *
 * Shaped `ost1.<schema>.<counts>.<digest>` — printable, comparable with `===`,
 * and small enough to sit in a response and in a tool argument without either
 * noticing. `content` is a digest over the full item identities (see
 * {@link sweepContentDigest}); the counts are what makes a delta computable
 * without the server having stored anything.
 */
export function sweepVersion(counts: SweepCounts, content: string): string {
  const encoded = SWEEP_BUCKETS.map((b) => counts[b]).join("-");
  return `${FORMAT}.${SCHEMA_TAG}.${encoded}.${content.slice(0, DIGEST_CHARS)}`;
}

/**
 * Read a token back, or `null` when it is not one this build issued.
 *
 * Deliberately strict — a token from another format, another bucket list, or a
 * caller's imagination is `null` rather than a best effort, because the whole
 * value of a delta is that it was computed against something real. A `null` here
 * surfaces as {@link SweepDelta.state} `unreadable`, never as "nothing moved".
 */
export function parseSweepVersion(token: string): SweepCounts | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [format, schema, encoded, digest] = parts;
  if (format !== FORMAT || schema !== SCHEMA_TAG) return null;
  if (!/^[0-9a-f]+$/.test(digest)) return null;
  const numbers = encoded.split("-");
  if (numbers.length !== SWEEP_BUCKETS.length) return null;
  const counts: Record<string, number> = {};
  for (const [i, bucket] of SWEEP_BUCKETS.entries()) {
    if (!/^\d+$/.test(numbers[i])) return null;
    counts[bucket] = Number(numbers[i]);
  }
  return counts as SweepCounts;
}

/** One bucket whose count is not what the caller last saw. */
export interface BucketMove {
  bucket: SweepBucket;
  /** What the presented version said this bucket held. */
  was: number;
  /** What it holds now. */
  now: number;
  /** `now - was`; negative means work left the bucket. */
  change: number;
}

/**
 * What happened between the version a caller holds and the one it is being
 * handed.
 *
 * A discriminated `state` rather than a boolean, because the three ways a
 * comparison can fail to happen — nobody asked, the token was not ours, the
 * counts held still while the contents did not — are each a different fact, and
 * a boolean would flatten all of them into the one answer ("nothing moved") that
 * a caller would act on by not looking.
 */
export interface SweepDelta {
  /**
   * `not-asked` — no version was presented, so nothing was compared.
   * `unchanged` — the presented version IS the current one; `moved` is empty and
   *   that emptiness is a measurement.
   * `changed` — the picture moved; `moved` says which buckets and by how much.
   * `unreadable` — the presented token is not one this surface issued, so no
   *   comparison was possible; `moved` is empty and means nothing.
   */
  state: "not-asked" | "unchanged" | "changed" | "unreadable";
  /** The token the caller presented, echoed verbatim, or `null` when none was. */
  since: string | null;
  /** Non-empty only in the `changed` state. Order follows {@link SWEEP_BUCKETS}. */
  moved: BucketMove[];
  /**
   * `changed` with an empty `moved`: something left a bucket as something else
   * entered it, or an item's identity changed under a steady count.
   *
   * Named rather than left to be inferred from `moved.length === 0`, because that
   * emptiness is the one shape a caller would otherwise read as "unchanged" while
   * looking straight at a changed tree.
   */
  changedWithoutCountMoving: boolean;
  /** The one line a caller reads when it is not going to look at the fields. */
  note: string;
}

/**
 * Compare the version a caller presented against the one being returned.
 *
 * Both are tokens; nothing else is consulted and nothing is stored. Equality of
 * the whole token is what `unchanged` means, so a version that matches in its
 * counts but not in its content digest is `changed` — with `moved` empty and
 * {@link SweepDelta.changedWithoutCountMoving} set, which is the honest report of
 * a turnover that kept its size.
 */
export function sweepDelta(since: string | null | undefined, version: string): SweepDelta {
  if (since === null || since === undefined || since === "") {
    return {
      state: "not-asked",
      since: null,
      moved: [],
      changedWithoutCountMoving: false,
      note:
        "No prior version was presented, so nothing was compared. Hold this response's `version` and pass it as " +
        "`since` on the next call to be told what moved instead of re-reading the whole sweep.",
    };
  }
  if (since === version) {
    return {
      state: "unchanged",
      since,
      moved: [],
      changedWithoutCountMoving: false,
      note:
        "Nothing has changed since the version you presented — every bucket holds exactly the items it held, so the " +
        "sweep you are already holding is current and this response tells you nothing new.",
    };
  }
  const was = parseSweepVersion(since);
  if (was === null) {
    return {
      state: "unreadable",
      since,
      moved: [],
      changedWithoutCountMoving: false,
      note:
        "The `since` you presented is not a version this surface issued, so NOTHING was compared and the empty " +
        "`moved` list means nothing. Pass a `version` copied verbatim from an earlier response of this same tool.",
    };
  }
  const now = parseSweepVersion(version);
  // The version being returned is built two lines above the call site, so an
  // unparseable one is this module disagreeing with itself rather than a caller
  // error — loud, and never a silent "unchanged".
  if (now === null) throw new Error(`sweepDelta was handed a version it cannot parse: ${JSON.stringify(version)}`);

  const moved: BucketMove[] = [];
  for (const bucket of SWEEP_BUCKETS) {
    if (was[bucket] !== now[bucket]) {
      moved.push({ bucket, was: was[bucket], now: now[bucket], change: now[bucket] - was[bucket] });
    }
  }
  if (moved.length === 0) {
    return {
      state: "changed",
      since,
      moved,
      changedWithoutCountMoving: true,
      note:
        "The outstanding picture changed, but no bucket changed SIZE — something left a bucket as something else " +
        "entered it. Counts cannot show you this one; re-read the lists themselves.",
    };
  }
  return {
    state: "changed",
    since,
    moved,
    changedWithoutCountMoving: false,
    note:
      `${moved.length} bucket(s) moved since the version you presented: ` +
      moved.map((m) => `${m.bucket} ${m.was}→${m.now} (${m.change > 0 ? "+" : ""}${m.change})`).join(", ") +
      ". Every other bucket holds exactly what it held.",
  };
}
