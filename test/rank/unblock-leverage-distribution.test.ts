/**
 * The unblock-leverage sweep: if every candidate build were ordered by how many
 * blocked assumption tests it would make readable, would that order separate
 * them — or declare them equal?
 *
 * The solution under test is "Rank every node by how many blocked tests one
 * build would unblock", and it names this check itself: *"If most tests turn out
 * to be independent, leverage is near-uniform and the ranking says nothing… The
 * assumption test under this node checks the ratio before anyone builds the
 * graph machinery."* The bar was fixed on 2026-08-06, before anything was swept:
 * **the top-ranked build unblocks at least 3× the median build's count, and the
 * top decile accounts for at least 25% of all unblockings.**
 *
 * ## This command being green does not mean the assumption held
 *
 * It came out **refuted**, and under all three readings of "readable" rather
 * than one. The command is green because the sweep has been run and pinned,
 * which is what an instrument on a measurement can mean — the convention
 * `test/telemetry/quarantine-expiry-period.test.ts`,
 * `test/friction/path-failure-attribution.test.ts` and
 * `test/telemetry/preflight-uncertainty-census.test.ts` already run under, all of
 * whose censuses also came out against their solution and whose nodes are still
 * `#unvalidated`. Whoever reads this exit code must read `meetsBar` with it,
 * which is why it is asserted `false` by name below for every reading rather
 * than left to be inferred from a table.
 *
 * ## The controls are what carry this file
 *
 * A sweep that returned "flat" for everything would refute this ranking no
 * matter what was in the tree, and so would an off-by-one in the decile
 * arithmetic. So the planted graphs below run first and in both directions: a
 * tree built to have a head is measured as having one, a tree built to be
 * uniform is measured as uniform, and each rule of the propagation —
 * conjunctive, transitive, unheld by a dangling edge — is shown firing on a
 * graph built to carry it. Only then is the verdict over the real tree worth
 * reading.
 *
 * The computation is `src/ost/unblock-leverage.ts`; the tree is committed at
 * `test/fixtures/unblock-leverage/graph.json`, cut by
 * `scripts/harvest-unblock-leverage-corpus.ts`, and `PROVENANCE.md` there records
 * the vault and commit it came from and what a re-cut would change.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  branchCounts,
  formatLeverageSweep,
  LEVERAGE_READINGS,
  leverageDistribution,
  sweepReadings,
  unblockCounts,
  unblockedBy,
  UNBLOCK_LEVERAGE_RULE,
  WIDEST_READING,
  type CandidateFacts,
  type LeverageGraph,
  type TestFacts,
} from "../../src/ost/unblock-leverage.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = path.join(repoRoot, "test", "fixtures", "unblock-leverage", "graph.json");

interface HarvestedGraph extends LeverageGraph {
  vault: string;
  head: string;
  harvestedAt: string;
  layers: Record<string, number>;
}

const graph: HarvestedGraph = JSON.parse(fs.readFileSync(fixture, "utf8"));

// ── the rule, before any tree is swept against it ───────────────────────────

describe("the bar was fixed before the sweep, and is a transcription rather than a choice", () => {
  test("both clauses are the assumption test's own numbers", () => {
    // From the `threshold:` field of "Compute the unblock-count distribution
    // over this vault and require it to be non-flat", 2026-08-06.
    expect(UNBLOCK_LEVERAGE_RULE.minMaxToMedianRatio).toBe(3);
    expect(UNBLOCK_LEVERAGE_RULE.minTopDecileShare).toBe(0.25);
    expect(UNBLOCK_LEVERAGE_RULE.topFraction).toBe(0.1);
  });

  test("both clauses must hold — the ratio alone can be cleared by one outlier", () => {
    // 20 candidates, nineteen of them unblocking one test each and one
    // unblocking four. The ratio clause passes at 4:1; the field is still flat.
    const counts = [4, ...Array<number>(19).fill(1)];
    const d = leverageDistribution(counts);
    expect(d.clauses.ratio).toBe(true);
    expect(d.clauses.topDecile).toBe(false);
    expect(d.meetsBar).toBe(false);
  });
});

// ── controls: the arithmetic separates a head from a flat field ─────────────

/** Build a graph out of shorthand, so a planted case reads as its own shape. */
function planted(spec: {
  tests: Array<Partial<TestFacts> & { title: string }>;
  candidates: Array<Partial<CandidateFacts> & { title: string }>;
  prerequisites?: Array<{ test: string; prerequisite: string }>;
}): LeverageGraph {
  return {
    tests: spec.tests.map((t) => ({ hasResult: false, hasInstrument: true, hasThreshold: true, ...t })),
    candidates: spec.candidates.map((c) => ({ coverage: [], ...c })),
    branches: [],
    prerequisites: spec.prerequisites ?? [],
  };
}

describe("a tree with a head is measured as having one", () => {
  /**
   * The tetrix shape, planted: one instrument every other test is waiting on.
   * Twenty tests declare the hub as their prerequisite, and each of them also
   * hangs under a solution of its own — so the coverage edge is present and
   * losing to the prerequisite edge, which is the whole claim the ranking makes.
   */
  const hub = planted({
    tests: [
      { title: "hub" },
      ...Array.from({ length: 20 }, (_, i) => ({ title: `waiting-${i}` })),
      ...Array.from({ length: 9 }, (_, i) => ({ title: `lone-${i}` })),
    ],
    candidates: [
      { title: "build-the-hub", coverage: ["hub"] },
      ...Array.from({ length: 20 }, (_, i) => ({ title: `owner-${i}`, coverage: [`waiting-${i}`] })),
      ...Array.from({ length: 9 }, (_, i) => ({ title: `unrelated-${i}`, coverage: [`lone-${i}`] })),
    ],
    prerequisites: Array.from({ length: 20 }, (_, i) => ({ test: `waiting-${i}`, prerequisite: "hub" })),
  });

  test("the hub build carries its own test and everything waiting on it", () => {
    expect(unblockedBy(hub, hub.candidates[0], WIDEST_READING)).toHaveLength(21);
  });

  test("a solution that merely OWNS a waiting test unblocks nothing while the hub is open", () => {
    // The conjunctive rule. Shipping `owner-3` does not make `waiting-3`
    // readable — it is still waiting on `hub`, which nobody has answered — and
    // crediting it would count the same unblocking under two builds.
    expect(unblockedBy(hub, hub.candidates[1], WIDEST_READING)).toEqual([]);
  });

  test("and the distribution clears both clauses of the bar", () => {
    const d = leverageDistribution(unblockCounts(hub, WIDEST_READING));
    expect(d.max).toBe(21);
    expect(d.meetsBar).toBe(true);
    expect(d.clauses).toEqual({ ratio: true, topDecile: true });
  });
});

describe("a tree built to be uniform is measured as uniform", () => {
  const flat = planted({
    tests: Array.from({ length: 40 }, (_, i) => ({ title: `t-${i}` })),
    candidates: Array.from({ length: 40 }, (_, i) => ({ title: `s-${i}`, coverage: [`t-${i}`] })),
  });

  test("every candidate unblocks exactly one, and the bar is missed on both clauses", () => {
    const d = leverageDistribution(unblockCounts(flat, WIDEST_READING));
    expect(d.histogram).toEqual([[1, 40]]);
    expect(d.maxToMedianRatio).toBe(1);
    expect(d.topDecileShare).toBeCloseTo(0.1, 10);
    expect(d.clauses).toEqual({ ratio: false, topDecile: false });
    expect(d.meetsBar).toBe(false);
  });
});

describe("a field that unblocks nothing clears nothing, whatever the arithmetic says", () => {
  test("an all-answered tree reports ratio 0 rather than Infinity, and misses the bar", () => {
    const answered = planted({
      tests: Array.from({ length: 10 }, (_, i) => ({ title: `t-${i}`, hasResult: true })),
      candidates: Array.from({ length: 10 }, (_, i) => ({ title: `s-${i}`, coverage: [`t-${i}`] })),
    });
    const d = leverageDistribution(unblockCounts(answered, WIDEST_READING));
    expect(d.totalUnblockings).toBe(0);
    // The trap this guards: `Infinity >= 3` is true, and a zero median with a
    // zero max would otherwise clear the ratio clause on a division by zero.
    expect(d.maxToMedianRatio).toBe(0);
    expect(d.meetsBar).toBe(false);
  });
});

describe("each rule of the propagation fires on a graph built to carry it", () => {
  test("transitive: a chain of prerequisites is followed to its end", () => {
    const chain = planted({
      tests: [{ title: "a" }, { title: "b" }, { title: "c" }],
      candidates: [{ title: "build-a", coverage: ["a"] }],
      prerequisites: [
        { test: "b", prerequisite: "a" },
        { test: "c", prerequisite: "b" },
      ],
    });
    expect(unblockedBy(chain, chain.candidates[0], WIDEST_READING)).toEqual(["a", "b", "c"]);
  });

  test("conjunctive: two open prerequisites need one build that answers both", () => {
    const both = planted({
      tests: [{ title: "p" }, { title: "q" }, { title: "u" }],
      candidates: [
        { title: "half", coverage: ["p"] },
        { title: "whole", coverage: ["p", "q"] },
      ],
      prerequisites: [
        { test: "u", prerequisite: "p" },
        { test: "u", prerequisite: "q" },
      ],
    });
    expect(unblockedBy(both, both.candidates[0], WIDEST_READING)).toEqual(["p"]);
    expect(unblockedBy(both, both.candidates[1], WIDEST_READING)).toEqual(["p", "q", "u"]);
  });

  test("an already-answered prerequisite holds nothing back", () => {
    const done = planted({
      tests: [{ title: "p", hasResult: true }, { title: "u" }],
      candidates: [{ title: "s", coverage: ["u"] }],
      prerequisites: [{ test: "u", prerequisite: "p" }],
    });
    expect(unblockedBy(done, done.candidates[0], WIDEST_READING)).toEqual(["u"]);
  });

  test("an edge naming nothing in the tree orders nothing — it neither confers leverage nor withholds it", () => {
    // The asymmetry `src/ost/prerequisites.ts` argues for at length: a typo'd
    // title must not silently remove a test from anybody's count.
    const dangling = planted({
      tests: [{ title: "u" }],
      candidates: [{ title: "s", coverage: ["u"] }],
      prerequisites: [{ test: "u", prerequisite: "a test nobody wrote" }],
    });
    expect(unblockedBy(dangling, dangling.candidates[0], WIDEST_READING)).toEqual(["u"]);
  });

  test("a cycle among declared edges terminates instead of spinning, and unblocks neither member", () => {
    // Nothing outside the vault's write path refuses a cycle, and a snapshot is
    // not a write path — so the fixed point has to survive one.
    const cyclic = planted({
      tests: [{ title: "x" }, { title: "y" }],
      candidates: [{ title: "s", coverage: [] }],
      prerequisites: [
        { test: "x", prerequisite: "y" },
        { test: "y", prerequisite: "x" },
      ],
    });
    expect(unblockedBy(cyclic, cyclic.candidates[0], WIDEST_READING)).toEqual([]);
  });
});

// ── the real tree ───────────────────────────────────────────────────────────

describe("the corpus is the whole tree, not a sample of it", () => {
  test("it is the meta vault at a named commit, with every layer counted", () => {
    expect(graph.vault).toBe("/Users/tanner/ost-agent-meta");
    expect(graph.head).toBe("14a00434dcca324560ee49c9d8c78f82837a8619");
    expect(graph.layers).toEqual({
      Outcome: 1,
      Opportunity: 163,
      Solution: 441,
      Assumption: 495,
      AssumptionTest: 494,
      Unknown: 2,
    });
    // Every Solution is a candidate and every AssumptionTest is in the field —
    // no filtering happened between the vault and this file.
    expect(graph.candidates).toHaveLength(graph.layers.Solution);
    expect(graph.tests).toHaveLength(graph.layers.AssumptionTest);
  });

  test("no candidate was dropped for being awkward: every solution carries at least one test", () => {
    expect(graph.candidates.filter((c) => c.coverage.length === 0)).toEqual([]);
  });
});

describe("the sweep over the real tree — REFUTED, under every reading", () => {
  const readings = sweepReadings(graph);

  test("the widest reading: 494 unblockings over 441 candidates, and the bar is missed", () => {
    const d = readings.unanswered;
    expect(d.candidates).toBe(441);
    expect(d.totalUnblockings).toBe(494);
    expect(d.median).toBe(1);
    expect(d.max).toBe(3);
    // The ratio clause is cleared, and only just — 3 over a median of 1, which
    // is the bar exactly rather than a margin above it.
    expect(d.maxToMedianRatio).toBe(3);
    expect(d.clauses.ratio).toBe(true);
    // The decile clause is what refuses it: the top 45 candidates carry 92 of
    // 494 unblockings, against a bar of 25%.
    expect(d.topDecileCandidates).toBe(45);
    expect(d.topDecileShare).toBeCloseTo(92 / 494, 10);
    expect(d.clauses.topDecile).toBe(false);

    // Read this, not the exit code.
    expect(d.meetsBar).toBe(false);
  });

  test("the shape under it: 390 of 441 candidates unblock exactly one test", () => {
    expect(readings.unanswered.histogram).toEqual([
      [1, 390],
      [2, 49],
      [3, 2],
    ]);
  });

  test("a perfectly uniform tree of this size would score 10.2% — the measured 18.6% sits between that and the bar", () => {
    // Stated so "flat" is a number rather than a word. A field where every
    // candidate unblocks exactly one puts 45/441 of the total in the top decile.
    const uniform = leverageDistribution(Array<number>(441).fill(1));
    expect(uniform.topDecileShare).toBeCloseTo(45 / 441, 10);
    expect(readings.unanswered.topDecileShare).toBeGreaterThan(uniform.topDecileShare);
    expect(readings.unanswered.topDecileShare).toBeLessThan(UNBLOCK_LEVERAGE_RULE.minTopDecileShare);
  });

  test("the two narrower readings miss BOTH clauses, so the verdict does not turn on the arguable call", () => {
    // Requiring an instrument, and then a fixed bar as well, is the stricter
    // reading of "becomes readable" — a test with no command is not made
    // machine-readable by shipping anything, and one with no threshold cannot
    // come out a failure. Both drop the maximum to 2, which fails the ratio too.
    expect(readings.instrumented.max).toBe(2);
    expect(readings.instrumented.maxToMedianRatio).toBe(2);
    expect(readings.instrumented.clauses).toEqual({ ratio: false, topDecile: false });
    expect(readings["pre-committed"].max).toBe(2);
    expect(readings["pre-committed"].clauses).toEqual({ ratio: false, topDecile: false });

    expect(readings.instrumented.meetsBar).toBe(false);
    expect(readings["pre-committed"].meetsBar).toBe(false);
  });

  test("every reading declared is swept, so none was quietly left out of the verdict", () => {
    expect(Object.keys(readings)).toEqual(LEVERAGE_READINGS.map((r) => r.id));
    expect(Object.values(readings).every((d) => d.meetsBar === false)).toBe(true);
    // The formatted sweep is what a human reads; it must say MISSES for each.
    expect(formatLeverageSweep(readings).match(/MISSES/g)).toHaveLength(LEVERAGE_READINGS.length);
  });
});

describe("why it is flat, and it is the shape the assumption predicted", () => {
  test("the tree declares ZERO prerequisite edges, so the only edge available is parent-child", () => {
    // `src/ost/prerequisites.ts` shipped the field an ordering claim lives in.
    // Nothing has written one. Coverage is therefore the whole graph — and
    // coverage is fan-out, not leverage: it can only ever count a solution's own
    // children, which is why the maximum here is 3 rather than the 4-spanning-a-
    // top-level-opportunity the tetrix instance reported.
    expect(graph.prerequisites).toEqual([]);
  });

  test("494 tests under 441 solutions is the near-1:1 shape a flat distribution comes from", () => {
    expect(graph.tests.length / graph.candidates.length).toBeCloseTo(1.12, 2);
  });

  test("and no test in the tree has a recorded result, so 'blocked' and 'exists' are the same set here", () => {
    // The widest reading is therefore reading the whole test population. That is
    // a fact about how little of this tree has been answered, and it is why the
    // stricter readings — which do discriminate — are the ones worth weighing.
    expect(graph.tests.filter((t) => t.hasResult)).toEqual([]);
  });
});

describe("the one reading that clears the bar is not a reading of builds", () => {
  test("opportunities separate sharply — and an opportunity is a problem, not a thing anyone ships", () => {
    const d = leverageDistribution(branchCounts(graph, WIDEST_READING));
    expect(d.candidates).toBe(163);
    expect(d.max).toBe(85);
    expect(d.meetsBar).toBe(true);

    // Reported rather than hidden, and disqualified by its own total: 1,015
    // unblockings over a tree holding 494 tests. Opportunities nest, so a test
    // beneath a sub-opportunity is counted again for every ancestor. That is
    // hierarchy depth, not leverage, and no build corresponds to a row of it.
    expect(d.totalUnblockings).toBe(1015);
    expect(d.totalUnblockings).toBeGreaterThan(graph.tests.length);
  });
});
