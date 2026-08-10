/**
 * Replay recorded perf failures with the pair alone and check whether they separate.
 *
 * The solution under test is "a perf gate reports its measurement next to the
 * number the criterion recorded". Its claim is that a wall-clock failure becomes
 * readable once the gate prints a second number it already has — `1,603ms
 * measured, 620–750ms recorded, budget 2,000ms` naming a regression and `900ms
 * measured, 620–750ms recorded` on a slow runner naming a slow runner. The
 * assumption test beneath it fixed the bar before anyone measured: **the pair
 * alone must correctly label at least 8 of 10 fixture failures**, and below that
 * the node is rewritten around the run-to-run spread rather than declared built.
 *
 * ## The command being green does not mean the assumption held
 *
 * It came out **refuted**, twice over. Against a corpus of ten perf-gate failures
 * whose causes were arranged and then hidden:
 *
 *   - the pair alone scores **5 of 10** against a bar of 8, and the way it fails
 *     is worse than the number: it labels every single failure a regression, so
 *     it separates nothing at all;
 *   - the pre-registered rival — the pair plus the spread — scores **5 of 10**
 *     too, so the rewrite the assumption test prescribed for this case does not
 *     follow either. A busy machine turns out to be *steadily* busy, and the
 *     jitter that rule was built to notice is not there;
 *   - a third arm, added after those two came back at chance, scores **10 of
 *     10**: time a second, much smaller call on the same box in the same trial
 *     and read the ratio between them. It is exploratory, it was written knowing
 *     what this fixture looks like, and it is labelled as such everywhere its
 *     number appears.
 *
 * `separation.pair.meetsBar` is asserted `false` by name below, on the convention
 * `test/friction/path-failure-attribution.test.ts` runs under: an instrument over
 * a measurement is green when the measurement has been taken and pinned, and
 * whoever reads this exit code has to read that flag with it.
 *
 * ## Why the pair cannot work, as arithmetic rather than as a result
 *
 * A gate fires when `measured > budget`. Z3's budget is 2,000 ms against a
 * recorded 620–750 ms — 2.67× the recorded high — and the pair rule calls a
 * failure a regression at 2×. So *every* failure the gate can produce already
 * exceeds the pair's threshold, and the second number decides nothing the first
 * one had not decided. This is not a fact about the fixture; it holds for any
 * criterion whose budget sits at more than twice its recorded figure, which is
 * every criterion in `docs/reference/v1-readiness.md` that carries both.
 *
 * ## What the fixture is and what it cannot settle
 *
 * `test/fixtures/perf-gate-noise-band/` — cut by
 * `scripts/harvest-perf-noise-corpus.ts`, provenance in `PROVENANCE.md` next to
 * it. The regressions are the drift that actually happened (the `tree.filter`
 * scans of 2026-08-05, reinstated around the same `computeNextWork` call the Z3
 * gate times); the noise is real CPU contention from forked spinners.
 *
 * Manufactured causes are the only kind a classifier can be scored against, and
 * they are also the limitation: the contention here is *continuous*, where a real
 * CI box's is bursty, and that difference is exactly what the spread arm is
 * sensitive to. The threshold sweeps below are the guard — they report what the
 * best possible threshold on each reading could have scored, so this file cannot
 * be waved off as one badly chosen constant.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  CONTROL_RULE,
  PAIR_RULE,
  SEPARATION_BAR,
  SPREAD_RULE,
  classifyByControl,
  classifyByPair,
  classifyByPairAndSpread,
  formatPairReading,
  pairAndControl,
  pairAndSpread,
  pairOnly,
  separate,
  type RecordedFailure,
} from "../../src/eval/perf-noise-band.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "perf-gate-noise-band");

const corpus: RecordedFailure[] = JSON.parse(fs.readFileSync(path.join(fixtureDir, "failures.json"), "utf8"));
const cut = JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8"));

const separation = {
  pair: separate(corpus, pairOnly, classifyByPair),
  spread: separate(corpus, pairAndSpread, classifyByPairAndSpread),
  control: separate(corpus, pairAndControl, classifyByControl),
};

// ── the rules, before any number is read off them ────────────────────────────

describe("the thresholds were fixed before the corpus was cut", () => {
  test("the pair's multiple is the one the solution node states, not one chosen after", () => {
    expect(PAIR_RULE.regressionMultiple).toBe(2);
  });

  test("the spread's stability threshold comes from the criterion's own idle range", () => {
    // Z3 recorded 620–750 ms on an idle machine: 1.21× wide. 1.5 is that with margin.
    expect(SPREAD_RULE.unstableRatio).toBe(1.5);
    expect(750 / 620).toBeLessThan(SPREAD_RULE.unstableRatio);
  });

  test("the bar is the one the assumption test fixed: 8 of 10", () => {
    expect(SEPARATION_BAR).toEqual({ correct: 8, of: 10 });
  });
});

// ── controls, in both directions, before the corpus is read ──────────────────

describe("the rules fire and decline to fire on cases built to make them", () => {
  const base = { recordedMin: 620, recordedMax: 750, budget: 2000 };

  test("the pair calls a large multiple of the recorded high a regression", () => {
    expect(classifyByPair({ ...base, measured: 1601 })).toBe("regression");
  });

  test("and calls a measurement inside the recorded band the machine", () => {
    expect(classifyByPair({ ...base, measured: 900 })).toBe("noise");
    expect(classifyByPair({ ...base, measured: 1500 })).toBe("noise");
  });

  test("the spread rule exonerates an unstable machine the pair would convict", () => {
    const unstable = { ...base, measured: 1800, spreadMin: 1800, spreadMax: 3600 };
    expect(classifyByPair(unstable)).toBe("regression");
    expect(classifyByPairAndSpread(unstable)).toBe("noise");
  });

  test("and still convicts a steady slowdown", () => {
    expect(classifyByPairAndSpread({ ...base, measured: 1800, spreadMin: 1800, spreadMax: 1810 })).toBe("regression");
  });

  test("the control rule reads a box that slowed both calls as the box", () => {
    // Everything is 3× slower, subject and control alike: the ratio is unchanged.
    const control = { ...base, recordedControlMin: 10, recordedControlMax: 12 };
    expect(classifyByControl({ ...control, measured: 2250, controlMeasured: 36 })).toBe("noise");
    // Only the subject moved: the ratio triples.
    expect(classifyByControl({ ...control, measured: 2250, controlMeasured: 12 })).toBe("regression");
  });

  test("no rule can reach the cause, because the projection it is handed has no cause on it", () => {
    const f = corpus[0];
    expect(Object.keys(pairOnly(f))).toEqual(["measured", "recordedMin", "recordedMax", "budget"]);
    expect(Object.keys(pairAndSpread(f))).not.toContain("cause");
    expect(Object.keys(pairAndControl(f))).not.toContain("cause");
    expect(Object.keys(pairAndSpread(f))).not.toContain("runs");
  });
});

// ── the corpus ──────────────────────────────────────────────────────────────

describe("the corpus is ten gate failures, balanced, each one real", () => {
  test("ten of them, five per cause", () => {
    expect(corpus).toHaveLength(SEPARATION_BAR.of);
    expect(corpus.filter((f) => f.cause === "noise")).toHaveLength(5);
    expect(corpus.filter((f) => f.cause === "regression")).toHaveLength(5);
  });

  test("every case is a failure — the gate actually fired on all ten", () => {
    for (const f of corpus) expect(f.measured).toBeGreaterThan(f.budget);
  });

  test("the regressions include the case that actually happened: slow code on a busy box", () => {
    const loaded = corpus.filter((f) => f.cause === "regression" && /spinners/.test(f.condition));
    expect(loaded.length).toBeGreaterThanOrEqual(2);
  });

  test("the machine's recorded range is tight, so the pair is being given its best case", () => {
    // A wide recorded band would make the pair's threshold generous by accident.
    expect(cut.recordedMax / cut.recordedMin).toBeLessThan(1.2);
  });

  /**
   * The arithmetic that decides this before any classifier runs.
   *
   * The budget is 2.67× the recorded high, taken off Z3's own 2,000 ms against
   * 620–750 ms. Breaching it therefore entails breaching 2× the recorded high,
   * so the pair rule has no case left to decide.
   */
  test("breaching the budget already entails breaching the pair's threshold", () => {
    expect(cut.budget / cut.recordedMax).toBeGreaterThan(PAIR_RULE.regressionMultiple);
    for (const f of corpus) expect(classifyByPair(pairOnly(f))).toBe("regression");
  });
});

// ── the finding ─────────────────────────────────────────────────────────────

describe("the pair alone does not separate the fixture", () => {
  test("5 of 10, against a pre-committed bar of 8", () => {
    expect(separation.pair.correct).toBe(5);
    expect(separation.pair.total).toBe(10);
  });

  test("meetsBar is false — read this with the exit code", () => {
    expect(separation.pair.meetsBar).toBe(false);
  });

  test("it is degenerate, not merely inaccurate: every failure is called a regression", () => {
    expect(separation.pair.regressionCorrect).toBe(5);
    expect(separation.pair.noiseCorrect).toBe(0);
    expect(new Set(separation.pair.calls.map((c) => c.called))).toEqual(new Set(["regression"]));
  });

  test("what the gate would print for a case it gets wrong", () => {
    const wrong = corpus.find((f) => f.cause === "noise")!;
    expect(formatPairReading(pairOnly(wrong))).toMatch(/measured, .* recorded, budget .* — \d\.\d× the recorded high/);
    // Three numbers, all correct, and the reading they support is the wrong one.
    expect(classifyByPair(pairOnly(wrong))).toBe("regression");
    expect(wrong.cause).toBe("noise");
  });
});

describe("the prescribed rewrite does not follow: the spread does not rescue it", () => {
  test("the pair plus the spread scores the same 5 of 10", () => {
    expect(separation.spread.correct).toBe(5);
    expect(separation.spread.meetsBar).toBe(false);
  });

  /**
   * The reason, and it is the one thing in this file that surprised the pass
   * that ran it. The rule assumed contention is uneven — that the load which
   * made one run slow is gone by the next. Twenty spinners on ten cores are not
   * uneven; they are a steady tax. Repeat runs under load vary by at most 1.26×,
   * which is inside the band an idle machine's own recorded range justifies.
   */
  test("because a busy machine is steadily busy: no noise case is unstable enough to notice", () => {
    const noiseSpreads = corpus.filter((f) => f.cause === "noise").map((f) => f.spreadMax / f.spreadMin);
    expect(Math.max(...noiseSpreads)).toBeLessThan(SPREAD_RULE.unstableRatio);
  });
});

// ── the guards against "you picked the wrong constant" ───────────────────────

/**
 * What the *best possible* threshold on each reading could have scored, swept
 * over the fixture with the labels in hand.
 *
 * A rule fitted this way is not a rule anybody could have written in advance —
 * the labels are the thing a real failure does not come with — so these numbers
 * are upper bounds on what the reading contains, not proposals.
 */
function bestOver(range: number[], rule: (f: RecordedFailure, t: number) => "regression" | "noise") {
  let best = { threshold: 0, correct: 0 };
  for (const t of range) {
    const correct = corpus.filter((f) => rule(f, t) === f.cause).length;
    if (correct > best.correct) best = { threshold: Number(t.toFixed(3)), correct };
  }
  return best;
}

const steps = (from: number, to: number, step: number) =>
  Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);

describe("the finding survives the choice of constant", () => {
  test("no multiple on the pair reaches the bar honestly — and the one that comes closest misreads the real incident", () => {
    const best = bestOver(steps(0.5, 8, 0.01), (f, t) => (f.measured > f.recordedMax * t ? "regression" : "noise"));
    expect(best.correct).toBe(9);
    expect(best.threshold).toBeCloseTo(3.87, 1);

    // The one perf failure on record whose cause is known because it was
    // profiled and fixed: Z3 on CI, 2026-08-06 — 2,045-2,183 ms against a
    // recorded 620-750 ms, and a real 2.6x regression
    // (docs/reference/v1-readiness.md, Z3). The fitted threshold calls it noise.
    const real = { measured: 2045, recordedMin: 620, recordedMax: 750, budget: 2000 };
    expect(classifyByPair(real)).toBe("regression");
    expect(real.measured > real.recordedMax * best.threshold).toBe(false);
  });

  test("the spread does carry the signal, but only at a threshold this fixture cannot justify", () => {
    const best = bestOver(steps(1, 2, 0.001), (f, t) =>
      f.spreadMax / f.spreadMin > t ? "noise" : f.measured > f.recordedMax * PAIR_RULE.regressionMultiple ? "regression" : "noise",
    );
    expect(best.correct).toBe(10);
    // 1.03 — three percent of run-to-run variation, tighter than the idle range
    // the criterion itself recorded (620–750 ms is 21%). It is fitted to a
    // fixture whose load is continuous, and on bursty contention it would call
    // every failure noise.
    expect(best.threshold).toBeLessThan(1.05);
    expect(best.threshold).toBeLessThan(cut.recordedMax / cut.recordedMin);
  });
});

// ── the exploratory arm ─────────────────────────────────────────────────────

/**
 * A control measurement separates the fixture completely, at the multiple it was
 * given and at every multiple over a wide band around it.
 *
 * **This is not a validated finding and must not be reported as one.** The rule
 * was written after the two pre-registered ones came back at chance, by someone
 * who had already seen the corpus. What earns it a place here is that the thing
 * it needs is not a cleverer reading of numbers already recorded — it is one more
 * number recorded next to them, which is a change to how a criterion is closed
 * and belongs in the tree as its own question.
 */
describe("exploratory: a control measured on the same box in the same trial", () => {
  test("10 of 10, at the multiple the rule was given", () => {
    expect(CONTROL_RULE.ratioMultiple).toBe(2);
    expect(separation.control.correct).toBe(10);
    expect(separation.control.noiseCorrect).toBe(5);
    expect(separation.control.regressionCorrect).toBe(5);
  });

  test("and it is not knife-edge: the two populations do not touch", () => {
    const ratio = (f: RecordedFailure) => f.measured / f.controlMeasured;
    const noiseHigh = Math.max(...corpus.filter((f) => f.cause === "noise").map(ratio));
    const regressionLow = Math.min(...corpus.filter((f) => f.cause === "regression").map(ratio));
    expect(noiseHigh).toBeLessThan(regressionLow);
    // A gap of nearly 2x, where the pair's two populations overlap outright.
    expect(regressionLow / noiseHigh).toBeGreaterThan(1.7);
  });

  test("the pair's own populations overlap, which is why no threshold on it can be clean", () => {
    const noiseHigh = Math.max(...corpus.filter((f) => f.cause === "noise").map((f) => f.measured));
    const regressionLow = Math.min(...corpus.filter((f) => f.cause === "regression").map((f) => f.measured));
    expect(noiseHigh).toBeGreaterThan(regressionLow);
  });
});
