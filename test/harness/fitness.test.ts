import { describe, expect, test } from "vitest";
import { type AttentionRollup } from "../../src/eval/attention.js";
import {
  assertComparable,
  computeFitness,
  explorationSpend,
  FITNESS_WEIGHTS,
  type FitnessRecord,
} from "../../src/harness/fitness.js";
import { type RunRecord } from "../../src/harness/run.js";
import { type EnvironmentSpec } from "../../src/harness/spec.js";

const SPEC: EnvironmentSpec = {
  name: "e",
  kind: "generated",
  seed: 1,
  created: "2026-07-28",
  outcome: "o",
  outcomeTitle: "Retention",
  nodes: [{ title: "Retention", layer: "Outcome", body: "b", links: [] }],
  unknowns: [
    { title: "A", darkens: "Retention", sections: ["Format"], findable: true, answer: "yes" },
    { title: "B", darkens: "Retention", sections: ["Format"], findable: false, answer: "" },
  ],
  evidence: [],
};

const NO_TOKENS = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };

const rollup = (
  costs: Record<string, { weightedCost?: number; calls?: number; ms?: number }>,
  costBasis: AttentionRollup["costBasis"] = "tokens",
): AttentionRollup => ({
  unknowns: Object.entries(costs).map(([title, c]) => ({
    title,
    klass: "bounded",
    state: "open",
    calls: c.calls ?? 1,
    ms: c.ms ?? 0,
    tokens: NO_TOKENS,
    weightedCost: c.weightedCost ?? 0,
  })),
  byClass: {},
  unattributed: { calls: 0, ms: 0, tokens: NO_TOKENS },
  uncorrelated: NO_TOKENS,
  costBasis,
});

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  environment: "e",
  kind: "generated",
  seed: 1,
  status: "completed",
  outcomes: [
    { title: "A", klass: "bounded", resolved: true, answer: "yes", calls: 1, ms: 1 },
    { title: "B", klass: "bounded", resolved: false, answer: "", calls: 1, ms: 1 },
  ],
  surfaced: ["A", "B"],
  done: false,
  budgetLimit: 10,
  budgetRemaining: 8,
  ...over,
});

describe("computeFitness", () => {
  test("a run that answers the findable unknown correctly scores full quality", () => {
    const f = computeFitness({
      run: run(),
      rollup: rollup({ A: { weightedCost: 10 }, B: { weightedCost: 10 } }),
      spec: SPEC,
    });
    expect(f.quality).toBe(1);
    expect(f.resolvedCorrectly).toBe(1);
    expect(f.findable).toBe(1);
  });

  test("a WRONG answer scores zero quality — resolution is not agreement", () => {
    const r = run({
      outcomes: [
        { title: "A", klass: "bounded", resolved: true, answer: "no", calls: 1, ms: 1 },
        { title: "B", klass: "bounded", resolved: false, answer: "", calls: 1, ms: 1 },
      ],
    });
    expect(computeFitness({ run: r, rollup: rollup({ A: {} }), spec: SPEC }).quality).toBe(0);
  });

  test("claiming to resolve an UNFINDABLE unknown earns nothing", () => {
    const r = run({
      outcomes: [
        { title: "A", klass: "bounded", resolved: true, answer: "yes", calls: 1, ms: 1 },
        { title: "B", klass: "bounded", resolved: true, answer: "invented", calls: 1, ms: 1 },
      ],
    });
    const f = computeFitness({ run: r, rollup: rollup({ A: {} }), spec: SPEC });
    expect(f.quality).toBe(1);
    expect(f.resolvedCorrectly).toBe(1);
  });

  test("cheaper orientation scores higher than dearer, all else equal", () => {
    const cheap = computeFitness({
      run: run(),
      rollup: rollup({ A: { weightedCost: 1 } }),
      spec: SPEC,
    });
    const dear = computeFitness({
      run: run(),
      rollup: rollup({ A: { weightedCost: 100 } }),
      spec: SPEC,
    });
    expect(cheap.orientation).toBeGreaterThan(dear.orientation);
  });

  test("a run that resolves nothing scores 0 quality, not undefined", () => {
    const r = run({
      outcomes: [
        { title: "A", klass: "bounded", resolved: false, answer: "", calls: 1, ms: 1 },
        { title: "B", klass: "bounded", resolved: false, answer: "", calls: 1, ms: 1 },
      ],
    });
    const f = computeFitness({ run: r, rollup: rollup({ A: {} }), spec: SPEC });
    expect(f.quality).toBe(0);
    expect(Number.isFinite(f.fitness)).toBe(true);
  });

  test("a null environment scores quality 0 without dividing by zero", () => {
    const nul: EnvironmentSpec = {
      ...SPEC,
      kind: "null",
      unknowns: [
        { title: "B", darkens: "Retention", sections: ["Format"], findable: false, answer: "" },
      ],
    };
    const f = computeFitness({
      run: run({
        outcomes: [{ title: "B", klass: "bounded", resolved: false, answer: "", calls: 1, ms: 1 }],
      }),
      rollup: rollup({ B: {} }),
      spec: nul,
    });
    expect(f.findable).toBe(0);
    expect(f.quality).toBe(0);
    expect(Number.isFinite(f.fitness)).toBe(true);
  });

  test("stamps the pinned weights into the record, so a later reader knows the basis of the score", () => {
    expect(computeFitness({ run: run(), rollup: rollup({ A: {} }), spec: SPEC }).weights).toEqual(
      FITNESS_WEIGHTS,
    );
  });

  test("carries the ROLLUP's basis, never the genome's declaration", () => {
    expect(
      computeFitness({ run: run(), rollup: rollup({ A: {} }, "calls-and-ms"), spec: SPEC })
        .costBasis,
    ).toBe("calls-and-ms");
  });

  test("a crashed run scores no fitness at all", () => {
    const f = computeFitness({
      run: run({ status: "crashed", outcomes: [] }),
      rollup: rollup({}),
      spec: SPEC,
    });
    expect(f.status).toBe("crashed");
    expect(f.fitness).toBe(0);
  });
});

describe("explorationSpend", () => {
  test("under a tokens basis it is the total weighted cost", () => {
    expect(
      explorationSpend(rollup({ A: { weightedCost: 3 }, B: { weightedCost: 4 } }, "tokens")),
    ).toBe(7);
  });

  test("under calls-and-ms it counts calls and wall-clock, NOT the always-zero weighted cost", () => {
    const r = rollup({ A: { calls: 2, ms: 500 }, B: { calls: 1, ms: 500 } }, "calls-and-ms");
    expect(explorationSpend(r)).toBe(4);
  });

  test("THE TRAP: two variants differing only in calls must not read as equal spend", () => {
    const thrifty = rollup({ A: { calls: 1, ms: 40 } }, "calls-and-ms");
    const spendthrift = rollup({ A: { calls: 9, ms: 360 } }, "calls-and-ms");
    expect(explorationSpend(spendthrift)).toBeGreaterThan(explorationSpend(thrifty));
  });
});

describe("assertComparable", () => {
  const rec = (costBasis: FitnessRecord["costBasis"]): FitnessRecord =>
    computeFitness({ run: run(), rollup: rollup({ A: {} }, costBasis), spec: SPEC });

  test("accepts records sharing one basis", () => {
    expect(() => assertComparable([rec("tokens"), rec("tokens")])).not.toThrow();
  });

  test("REFUSES a mixed-basis comparison rather than normalizing it", () => {
    expect(() => assertComparable([rec("tokens"), rec("calls-and-ms")])).toThrow(
      /refusing to compare fitness across cost bases/i,
    );
  });

  test("an empty set is comparable — there is nothing to disagree", () => {
    expect(() => assertComparable([])).not.toThrow();
  });
});
