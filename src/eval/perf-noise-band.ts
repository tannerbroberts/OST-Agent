/**
 * Can a perf gate's failure be read as "the code got slower" or "this box is
 * slower" from the two numbers the gate has in hand?
 *
 * The solution under test is "a perf gate reports its measurement next to the
 * number the criterion recorded". Today a wall-clock gate asserts one thing —
 * `measured < BUDGET` — and that single comparison cannot separate a regression
 * from a busy machine, so every failure is arguable and the cheapest reading
 * wins. Z3's budget gate failed six CI runs out of six across three days and was
 * called flaky twice into the friction inbox; the real answer was a 2.6× drift
 * that a five-minute profile named. The proposal is to print, and assert
 * against, the figure the criterion recorded when it was last met, on the theory
 * that the *pair* carries the distinction.
 *
 * This module is that theory written as a rule, plus the one rival it has to
 * beat: the same pair with the run-to-run **spread** — the min and max the same
 * commit produces across repeated runs — added. Both rules are committed here so
 * a later edit shows up as a changed expectation rather than as a quietly
 * different finding, and `test/eval/perf-gate-noise-band.test.ts` replays a
 * corpus of cause-labelled failures through them.
 *
 * **Every threshold in this file was fixed before the corpus was cut.** They are
 * not readings off the data: `regressionMultiple` is the solution node's own
 * stated bar ("fail when measured exceeds recorded by more than ~2×, whatever
 * the budget says"), and `unstableRatio` comes from the Z3 criterion's recorded
 * range — 620–750 ms is 1.21× wide on an idle machine, so 1.5 is that with
 * margin. The corpus was harvested afterwards by
 * `scripts/harvest-perf-noise-corpus.ts`, and neither number has been moved
 * since. That ordering is the whole reason a separation rate off this fixture
 * means anything.
 */

/** What a gate that reports the pair puts in front of a reader. */
export interface PairReading {
  /** The statistic the gate asserts on, in ms. */
  measured: number;
  /** The low end of the figure the criterion recorded when it was last met, in ms. */
  recordedMin: number;
  /** The high end of the same, in ms. */
  recordedMax: number;
  /** The budget the criterion states, in ms. */
  budget: number;
}

/** The same, plus what repeated runs of the *same* commit cost at measure time. */
export interface SpreadReading extends PairReading {
  /** Fastest of the repeated runs, in ms. */
  spreadMin: number;
  /** Slowest of the repeated runs, in ms. */
  spreadMax: number;
}

/**
 * The pair, plus a control: the same call on a workload small enough that the
 * cost under suspicion cannot be in it.
 *
 * Not a synthetic CPU loop — the solution node is right to dismiss that, and this
 * is not it. It is the same code doing the same kind of work at a size where a
 * quadratic term is 1/400th of what it is at full size, timed on the same box in
 * the same trial. A busy machine moves both numbers; a regression moves one.
 */
export interface ControlReading extends PairReading {
  /** The control's measurement in this trial, in ms. */
  controlMeasured: number;
  /** What the control cost when the criterion was recorded, in ms. */
  recordedControlMin: number;
  recordedControlMax: number;
}

/** The two things a perf-gate failure can be. */
export type Cause = "regression" | "noise";

/**
 * A recorded gate failure with its cause known, because the cause was arranged.
 *
 * `runs` is every timed repetition of that trial and is deliberately not visible
 * to the pair classifier — it is exactly the information the rival rule gets and
 * this one does not. `cause` is never visible to either.
 */
export interface RecordedFailure extends SpreadReading, ControlReading {
  id: string;
  cause: Cause;
  /** How the failure was produced, in words, for the reader of the fixture. */
  condition: string;
  runs: number[];
  /** Every timed repetition of the control, alongside `runs`. */
  controlRuns: number[];
}

/**
 * The rule the solution proposes: a failure is a regression when the measurement
 * exceeds the recorded high by more than this multiple, and the machine's fault
 * otherwise.
 *
 * The multiple is wide on purpose and the solution says why: machines
 * legitimately differ by 2–3×, so a tight bar over the pair would fire on every
 * slow runner. The cost of that width is stated in the same node — it catches
 * step-changes and not slow creep.
 */
export const PAIR_RULE = {
  regressionMultiple: 2,
} as const;

/**
 * The rival: the pair, plus a stability test over the repeated runs.
 *
 * A machine that is busy is busy *unevenly* — the contention that made one run
 * slow is not there for the whole of the next — while code that got slower costs
 * the same every time. So a wide spread is read as the machine and a tight one
 * lets the pair's multiple decide.
 *
 * `unstableRatio` is slowest/fastest. 1.5 is the Z3 criterion's own idle range
 * (620–750 ms, 1.21×) with margin, fixed before the corpus existed.
 */
export const SPREAD_RULE = {
  regressionMultiple: 2,
  unstableRatio: 1.5,
} as const;

/**
 * The exploratory third arm, added after the two pre-registered rules came back
 * at chance on the corpus.
 *
 * It is **not** pre-registered and its separation rate is not a validated
 * finding: the rule was written knowing what the fixture looks like, which is the
 * exact thing that makes a number unbelievable. It is here because a negative
 * result that names no alternative leaves the next builder where this one
 * started, and because what it needs — a control measurement recorded next to
 * the criterion's figure — is a change to how criteria are recorded rather than a
 * cleverer reading of what they already say. Treat the number as a hypothesis
 * with a fixture attached, and settle it on a corpus cut after the rule.
 */
export const CONTROL_RULE = {
  /** How far the subject/control ratio may exceed its recorded value before it is the code. */
  ratioMultiple: 2,
} as const;

/**
 * The bar the assumption test fixed in advance: the pair alone must correctly
 * label at least 8 of 10 fixture failures. Below it, the pair is insufficient
 * and the solution gets rewritten around the spread rather than declared built.
 */
export const SEPARATION_BAR = { correct: 8, of: 10 } as const;

/** The solution's rule, given only what the solution renders. */
export function classifyByPair(r: PairReading): Cause {
  return r.measured > r.recordedMax * PAIR_RULE.regressionMultiple ? "regression" : "noise";
}

/** The rival's rule: an unstable machine is the machine, whatever the multiple says. */
export function classifyByPairAndSpread(r: SpreadReading): Cause {
  if (r.spreadMin > 0 && r.spreadMax / r.spreadMin > SPREAD_RULE.unstableRatio) return "noise";
  return r.measured > r.recordedMax * SPREAD_RULE.regressionMultiple ? "regression" : "noise";
}

/**
 * The exploratory rule: read the *shape* of the slowdown rather than its size.
 *
 * The subject-over-control ratio is what the box cannot change — it slows both
 * calls — and what a quadratic in the subject moves on its own.
 */
export function classifyByControl(r: ControlReading): Cause {
  const recordedRatio = r.recordedMax / r.recordedControlMin;
  const ratio = r.measured / r.controlMeasured;
  return ratio > recordedRatio * CONTROL_RULE.ratioMultiple ? "regression" : "noise";
}

/**
 * What the gate prints. The pair *is* the solution — everything else in this
 * module is the question of whether printing it settles anything.
 */
export function formatPairReading(r: PairReading): string {
  const ratio = (r.measured / r.recordedMax).toFixed(1);
  return `${ms(r.measured)} measured, ${ms(r.recordedMin)}–${ms(r.recordedMax)} recorded, budget ${ms(r.budget)} — ${ratio}× the recorded high`;
}

function ms(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")}ms`;
}

/** How a classifier did against known causes, split by cause so a degenerate one shows. */
export interface Separation {
  total: number;
  correct: number;
  /** Correct labels among the failures whose cause really was a regression. */
  regressionCorrect: number;
  regressionTotal: number;
  /** Correct labels among the failures the machine caused. */
  noiseCorrect: number;
  noiseTotal: number;
  /** Which way each case was called, in corpus order, for the reader. */
  calls: { id: string; cause: Cause; called: Cause }[];
  /** Against `SEPARATION_BAR`, scaled to the corpus actually replayed. */
  meetsBar: boolean;
}

/**
 * Score a classifier over the corpus.
 *
 * The classifier is handed a reading, never a `RecordedFailure`, so a rule
 * cannot reach `cause` even by accident — the projection happens here and the
 * types make the narrower one impossible to widen at the call site.
 */
export function separate<R extends PairReading>(
  corpus: RecordedFailure[],
  project: (f: RecordedFailure) => R,
  classify: (r: R) => Cause,
): Separation {
  const calls = corpus.map((f) => ({ id: f.id, cause: f.cause, called: classify(project(f)) }));
  const correct = calls.filter((c) => c.cause === c.called).length;
  const regression = calls.filter((c) => c.cause === "regression");
  const noise = calls.filter((c) => c.cause === "noise");
  return {
    total: calls.length,
    correct,
    regressionCorrect: regression.filter((c) => c.called === "regression").length,
    regressionTotal: regression.length,
    noiseCorrect: noise.filter((c) => c.called === "noise").length,
    noiseTotal: noise.length,
    calls,
    meetsBar: correct * SEPARATION_BAR.of >= SEPARATION_BAR.correct * calls.length,
  };
}

/** The pair alone — what the solution renders today. */
export function pairOnly(f: RecordedFailure): PairReading {
  return { measured: f.measured, recordedMin: f.recordedMin, recordedMax: f.recordedMax, budget: f.budget };
}

/** The pair plus the band the repeated runs describe. */
export function pairAndSpread(f: RecordedFailure): SpreadReading {
  return { ...pairOnly(f), spreadMin: f.spreadMin, spreadMax: f.spreadMax };
}

/** The pair plus the control taken on the same box in the same trial. */
export function pairAndControl(f: RecordedFailure): ControlReading {
  return {
    ...pairOnly(f),
    controlMeasured: f.controlMeasured,
    recordedControlMin: f.recordedControlMin,
    recordedControlMax: f.recordedControlMax,
  };
}
