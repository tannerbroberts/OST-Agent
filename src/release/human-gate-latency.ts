/**
 * What a human gate costs, measured rather than assumed.
 *
 * A **human gate** is an artefact that reached a state where the only remaining
 * work is one action by a person: a release prepared and waiting to be tagged, a
 * test run whose verdict only `ost-agent result` can file, a paste-ready command
 * sitting in a draft. Until this module existed nothing in the repository knew
 * what one was — no code paired a became-ready instant with a human-acted
 * instant, so there was no latency series to take a median of, and every
 * solution that puts a human on the critical path was making an unpriced bet.
 *
 * The one rule that makes the number honest: **a wait that is still open is
 * counted, at its running duration, not dropped.** A computation that quietly
 * excluded open gates would report a flattering median taken from exactly the
 * gates that closed — and the gates that never close are the finding. So
 * {@link scoreGates} takes an `asOf` instant and scores an open gate against it.
 *
 * The bar in {@link HUMAN_GATE_BAR} is not this module's opinion. It is the
 * threshold the assumption test "Measure how long the last human-gated release
 * actually waited" fixed on 2026-08-02, before anybody counted, and it is
 * carried here as data so that moving it is a visible diff rather than a
 * different arithmetic.
 */

/**
 * The pre-committed threshold, exactly as the assumption test states it: median
 * human-gate latency at or under 7 days, with fewer than 25% of gates still
 * open. Both clauses must hold; either alone is the flattering half.
 */
export const HUMAN_GATE_BAR = { medianDays: 7, maxOpenShare: 0.25 } as const;

/**
 * The three kinds of artefact this project has left waiting on a person. Named
 * rather than free-form because the median over all of them is dominated by
 * whichever class is most numerous, and a reader has to be able to take the
 * classes apart again.
 */
export type HumanGateKind =
  /** A version cut on `main` and waiting for a person to tag it. */
  | "release"
  /** A test run whose verdict is waiting for `ost-agent result`. */
  | "result-filing"
  /** A paste-ready command drafted for a person and waiting to be pasted. */
  | "verdict-draft";

export const HUMAN_GATE_KINDS: readonly HumanGateKind[] = ["release", "result-filing", "verdict-draft"];

/** One artefact that waited on a person, with both ends of the wait. */
export interface HumanGate {
  kind: HumanGateKind;
  /** What the person was asked to act on — a version, a test title, a command. */
  subject: string;
  /** ISO instant the artefact became ready for the human act. */
  readyAt: string;
  /** ISO instant the person acted; `null` while the wait is still open. */
  actedAt: string | null;
  /**
   * Set when `actedAt` is the *earliest instant the act could have happened*
   * rather than when it did. A lightweight git tag carries no date of its own —
   * `creatordate` falls back to the commit it points at — so a tagged release
   * can only be scored at a lower bound of zero. Kept as a flag rather than
   * folded into the number, because a zero that means "we cannot tell" and a
   * zero that means "same minute" are different claims and only one of them is
   * a measurement.
   */
  actedAtIsLowerBound?: boolean;
  /** Free-text provenance for the pair; carried into the corpus, never scored. */
  note?: string;
}

export interface ScoredGate extends HumanGate {
  /** True when nobody has acted yet. Scored, never dropped. */
  open: boolean;
  /**
   * Days from ready to acted, or from ready to `asOf` while still open.
   * Negative pairings are refused by {@link scoreGate} rather than clamped: a
   * human act that predates the thing it acted on is a broken pairing, and
   * silently flooring it to zero would hide the break inside a good-looking
   * median.
   */
  waitDays: number;
}

export interface GateLatency {
  gates: ScoredGate[];
  /** Every gate, open and closed. The denominator for `openShare`. */
  total: number;
  openCount: number;
  /** `openCount / total`; `0` for an empty set. */
  openShare: number;
  /** Median over ALL gates, open ones at their running duration. */
  medianWaitDays: number;
  /**
   * Median over only the gates that closed — reported beside the real median so
   * a reader can see the size of the difference the open ones make, and never
   * substituted for it.
   */
  medianClosedWaitDays: number | null;
  clearsMedian: boolean;
  clearsOpenShare: boolean;
  /** Both clauses. This is the verdict the assumption test asked for. */
  clearsBar: boolean;
}

const DAY_MS = 86_400_000;

/**
 * Middle value, or the mean of the two middle values for an even count. Stated
 * because "median" over an even set is a convention, and the verdict turns on
 * which one is used.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function instant(iso: string, what: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`${what} is not a parseable instant: ${JSON.stringify(iso)}`);
  return ms;
}

/**
 * Score one gate against the instant the measurement was taken.
 *
 * `asOfMs` is required rather than defaulted to now, so the same corpus scores
 * to the same numbers on every machine and every run — a measurement that
 * silently reads the clock is a measurement that cannot be checked.
 */
export function scoreGate(gate: HumanGate, asOfMs: number): ScoredGate {
  const readyMs = instant(gate.readyAt, `${gate.kind} "${gate.subject}" readyAt`);
  const endMs = gate.actedAt === null ? asOfMs : instant(gate.actedAt, `${gate.kind} "${gate.subject}" actedAt`);
  if (endMs < readyMs) {
    throw new Error(
      `${gate.kind} "${gate.subject}": the human acted at ${gate.actedAt ?? "asOf"} , before it was ready at ${gate.readyAt}`,
    );
  }
  return { ...gate, open: gate.actedAt === null, waitDays: (endMs - readyMs) / DAY_MS };
}

/** Score a whole set and take the two statistics the pre-committed bar names. */
export function scoreGates(gates: readonly HumanGate[], asOf: string): GateLatency {
  const asOfMs = instant(asOf, "asOf");
  const scored = gates.map((g) => scoreGate(g, asOfMs));
  const openCount = scored.filter((g) => g.open).length;
  const total = scored.length;
  const openShare = total === 0 ? 0 : openCount / total;
  const medianWaitDays = median(scored.map((g) => g.waitDays));
  const closed = scored.filter((g) => !g.open).map((g) => g.waitDays);
  const clearsMedian = total > 0 && medianWaitDays <= HUMAN_GATE_BAR.medianDays;
  const clearsOpenShare = total > 0 && openShare < HUMAN_GATE_BAR.maxOpenShare;
  return {
    gates: scored,
    total,
    openCount,
    openShare,
    medianWaitDays,
    medianClosedWaitDays: closed.length === 0 ? null : median(closed),
    clearsMedian,
    clearsOpenShare,
    clearsBar: clearsMedian && clearsOpenShare,
  };
}

/**
 * The same scoring, one class at a time.
 *
 * The candidate this measures is about *releases*, but releases are a handful of
 * gates beside hundreds of result filings, so the pooled median is a statement
 * about the most numerous class. Splitting is not a way to find a class that
 * clears the bar and quote that one — it is the only way to read what the pooled
 * number is made of. Every kind is present in the result, including the ones
 * with no gates at all, so a class that vanishes from the corpus is visible as
 * an empty set rather than as a missing key.
 */
export function scoreGatesByKind(
  gates: readonly HumanGate[],
  asOf: string,
): Record<HumanGateKind, GateLatency> {
  const out = {} as Record<HumanGateKind, GateLatency>;
  for (const kind of HUMAN_GATE_KINDS) {
    out[kind] = scoreGates(
      gates.filter((g) => g.kind === kind),
      asOf,
    );
  }
  return out;
}

/**
 * One line per statistic, for a script or an operator who wants the number
 * without loading the corpus into a test runner.
 */
export function summarise(latency: GateLatency): string {
  const pct = (latency.openShare * 100).toFixed(1);
  const closed =
    latency.medianClosedWaitDays === null
      ? "no gate has closed"
      : `median over closed gates only ${latency.medianClosedWaitDays.toFixed(2)}d`;
  return [
    `${latency.total} gate(s), ${latency.openCount} still open (${pct}%)`,
    `median wait ${latency.medianWaitDays.toFixed(2)}d (bar: <= ${HUMAN_GATE_BAR.medianDays}d)`,
    closed,
    latency.clearsBar ? "CLEARS the bar" : "MISSES the bar",
  ].join(" — ");
}
