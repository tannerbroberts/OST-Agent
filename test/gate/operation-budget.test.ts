/**
 * "A load-independent gate keeps its verdict when the machine is saturated" —
 * the AssumptionTest beneath "State timing gates as work completed rather than
 * wall-clock, so a busy machine cannot fail one".
 *
 * **The failure this exists to remove.** `test/mcp/wall-clock-budget.test.ts`
 * pins Z3 — `ost_next_work` and `ost_check` answer a 10,000-node vault inside
 * 2,000 ms. It went red on two consecutive scheduled passes, at 2004 ms and at
 * 2280 ms, inside the full suite; both times it passed with 18 seconds of margin
 * when re-run alone, seconds later. Nothing had regressed either time. A gate
 * that fires on machine load costs the operator the one thing an unattended gate
 * is supposed to save them, and it trains them to read red as noise.
 *
 * **The conversion.** The same criterion, stated in work performed: one file
 * read per node file, one directory listing, and a bounded number of title
 * comparisons in the near-duplicate scan. Those numbers are a function of the
 * code and the fixture. A busy machine changes how long each one takes and
 * changes none of them.
 *
 * **Both halves of the pre-committed bar are asserted here, and the second is
 * the one that matters.** A gate that always passes is trivially
 * load-independent, so it is not enough to show the converted gate keeps its
 * green under saturation. Every condition below is run twice — once on an idle
 * process and once against `os.cpus().length` forked CPU spinners — and the
 * conditions include two *regressed* ones, which must come out red idle and red
 * saturated. That is the shape that separates "the verdict is a function of the
 * code" from "the verdict is a constant".
 *
 * The regressions are executed, not asserted about:
 *
 *   - **The pre-Z3 near-duplicate scan.** All pairs within a layer, scored
 *     through `similarity` — the exported entry point the product's mapping path
 *     uses, so the comparisons it performs go through the same counter the
 *     indexed scan's do. At 1,200 nodes it performs 258,121 comparisons against
 *     the indexed scan's 319.
 *   - **A second pass over the node set.** `computeNextWork` documents that it
 *     parses the census ONCE; a caller that read the tree again would double the
 *     file reads without changing the answer, which is precisely the regression a
 *     "one read per node file" budget guards and the one a wall-clock bound on a
 *     fast machine can hide.
 *
 * **What this does NOT replace.** A regression that makes each operation slower
 * without changing how many there are is invisible to an operation budget, by
 * construction. `test/mcp/wall-clock-budget.test.ts` stays, and stays
 * wall-clock, because the 2,000 ms in Z3's sentence is a latency a person
 * experiences. The two gates are complements: this one cannot be failed by load,
 * that one cannot be passed by an algorithm that does less work more slowly.
 *
 * **Why this file forks spinners and what that costs.** `spinners()` loads the
 * whole box, so while the saturated leg runs it is contending with whatever
 * other test files vitest has co-scheduled. The window is kept to the smallest
 * that still makes the point — the load is applied around the measurements and
 * killed immediately after — and `test/eval/calibration-ratio-stability.test.ts`
 * is the precedent for the alternative, which is a `SUITE_EXCLUSIONS` entry.
 * That list is human-only (`src/release/gate-coverage.ts`), so this file is not
 * on it.
 */
import os from "node:os";
import { afterEach, beforeEach, expect, test } from "vitest";
import { buildPassContext } from "../../src/runner/context.js";
import { buildOstTools } from "../../src/security/tools.js";
import { similarity } from "../../src/ost/dedupe.js";
import type { Vault } from "../../src/ost/vault.js";
import {
  checkOperationBudget,
  countOperation,
  describeBudgetVerdict,
  recordOperations,
  recordOperationsAsync,
  type OperationBudget,
  type OperationCounts,
} from "../../src/telemetry/operation-budget.js";
import { bench, removeBench, settle, spinners, stopSpinners, type Bench } from "../perf/contention.js";
import type { LargeTreeShape } from "../ost/fixture-vault.js";

const OUTCOME = "Retention";

/** Z3's own size and shape, so this reads against `wall-clock-budget.test.ts`. */
const SCALE_SIZE = 10_000;
const SCALE_SHAPE: LargeTreeShape = { opportunities: 2000, solutions: 4000, assumptionTests: 3999 };

/** The size the regressed conditions run at, so the all-pairs scan stays cheap. */
const SMALL_SIZE = 1_200;
const SMALL_SHAPE: LargeTreeShape = { opportunities: 240, solutions: 480, assumptionTests: 479 };

/**
 * The budget, as one rule rather than a constant per fixture.
 *
 * `fileRead: nodes` is the "one pass over the node set" invariant stated as a
 * ceiling — one read per node file and not one more. `directoryScan: 1` is the
 * same invariant for the root listing. `titleComparison: 10 * nodes` is the
 * near-duplicate scan's candidate work; it is a ceiling, not a model, and the
 * numbers it was set against are these, measured on this seeded fixture:
 *
 *              indexed scan   ceiling   pre-Z3 all-pairs
 *   1,200            319       12,000            258,121
 *  10,000         49,298      100,000         17,991,001
 *
 * So it clears the shipped algorithm by 2× at the size the criterion names and
 * refuses the quadratic one by 180×. It is pinned at exactly the two sizes this
 * file measures — the candidate count grows faster than linearly even under the
 * indexed scan (`src/ost/dedupe.ts` says why), so this rule is not a claim about
 * arbitrary n.
 */
function budgetFor(nodes: number): OperationBudget {
  return { fileRead: nodes, directoryScan: 1, titleComparison: 10 * nodes };
}

let benches: Bench[] = [];
beforeEach(() => {
  benches = [];
});
afterEach(() => {
  for (const b of benches) removeBench(b);
});

/** A seeded vault of `shape`, removed by the `afterEach` above. */
async function fixtureAt(shape: LargeTreeShape): Promise<Bench> {
  const b = await bench(shape, OUTCOME, "ost-op-budget-");
  benches.push(b);
  return b;
}

/** The two tools Z3's sentence names, bound to one fixture. */
function toolsFor(b: Bench): { nextWork: () => Promise<unknown>; check: () => Promise<unknown> } {
  const ctx = buildPassContext(b.dir);
  const tools = buildOstTools({ vault: ctx.vault, dir: b.dir, remote: { enabled: false }, passContext: ctx });
  const nextWork = tools.find((t) => t.name === "ost_next_work")!;
  const check = tools.find((t) => t.name === "ost_check")!;
  return { nextWork: () => nextWork.run({}), check: () => check.run({}) };
}

/**
 * One thing a gate is taken over, run under whatever load the caller arranged.
 *
 * `expectOk` is declared with the condition rather than derived from the run,
 * so a regressed condition that came out green fails here instead of quietly
 * being recorded as the new truth.
 */
interface Condition {
  name: string;
  nodes: number;
  expectOk: boolean;
  measure: () => Promise<OperationCounts>;
}

/** The pre-Z3 all-pairs scan, over the live titles of a vault, layer by layer. */
function allPairsScan(vault: Vault): void {
  const byLayer = new Map<string, string[]>();
  for (const n of vault.readTree()) {
    if (n.layer === "Outcome") continue;
    const list = byLayer.get(n.layer) ?? [];
    list.push(n.title);
    byLayer.set(n.layer, list);
  }
  for (const titles of byLayer.values()) {
    const sorted = [...titles].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) similarity(sorted[i], sorted[j]);
    }
  }
}

/** Run every condition once and return its counts, in order. */
async function measureAll(conditions: readonly Condition[]): Promise<OperationCounts[]> {
  const out: OperationCounts[] = [];
  for (const c of conditions) out.push(await c.measure());
  return out;
}

/**
 * Run `conditions` idle, then again against a fully saturated box, and assert
 * the two runs agree on every count and every verdict.
 *
 * The spinners are checked for liveness on both sides of the loaded run. That is
 * the non-vacuity guard for the load itself: a `fork` that failed, or children
 * that exited early, would make "saturated" a label on a second idle run and the
 * agreement below would prove nothing. It is deliberately a check on the
 * processes rather than on elapsed time — asserting that the loaded run was
 * *slower* would put a wall-clock claim inside the test whose entire subject is
 * that wall-clock claims are not dependable, which is the mistake this file
 * exists to stop making. The two elapsed figures are reported in the failure
 * message instead, where a reader can weigh them without a threshold deciding
 * anything.
 */
async function assertVerdictSurvivesSaturation(conditions: readonly Condition[]): Promise<void> {
  const idleStart = Date.now();
  const idle = await measureAll(conditions);
  const idleMs = Date.now() - idleStart;

  const children = spinners(os.cpus().length);
  let loaded: OperationCounts[];
  let loadedMs: number;
  try {
    await settle(150);
    expect(
      children.filter((c) => !c.killed && c.exitCode === null).length,
      "spinners did not start — the loaded run would have been a second idle one",
    ).toBe(children.length);

    const loadedStart = Date.now();
    loaded = await measureAll(conditions);
    loadedMs = Date.now() - loadedStart;

    expect(
      children.filter((c) => !c.killed && c.exitCode === null).length,
      "spinners died mid-run — the box was not saturated for the whole measurement",
    ).toBe(children.length);
  } finally {
    stopSpinners(children);
  }

  const where = `${children.length} spinners; idle leg ${idleMs}ms, loaded leg ${loadedMs}ms`;
  for (let i = 0; i < conditions.length; i++) {
    const c = conditions[i];
    const budget = budgetFor(c.nodes);
    const idleVerdict = checkOperationBudget(idle[i], budget);
    const loadedVerdict = checkOperationBudget(loaded[i], budget);

    expect(
      loaded[i],
      `${c.name}: operation counts moved under load (${where})\n  idle:   ${JSON.stringify(idle[i])}\n  loaded: ${JSON.stringify(loaded[i])}`,
    ).toEqual(idle[i]);

    expect(
      loadedVerdict.ok,
      `${c.name}: verdict changed under load (${where})\n  idle:   ${describeBudgetVerdict(idleVerdict, budget)}\n  loaded: ${describeBudgetVerdict(loadedVerdict, budget)}`,
    ).toBe(idleVerdict.ok);

    expect(
      idleVerdict.ok,
      `${c.name}: expected ${c.expectOk ? "within budget" : "OVER BUDGET"} — ${describeBudgetVerdict(idleVerdict, budget)}`,
    ).toBe(c.expectOk);
  }
}

test("the counter records what it says it counts, and only while a recorder is open", () => {
  // Nothing counted with no recorder open: the seam must be inert on every path
  // the product takes in production.
  countOperation("fileRead", 99);

  const outer = recordOperations(() => {
    countOperation("fileRead", 2);
    const inner = recordOperations(() => {
      countOperation("titleComparison", 3);
      countOperation("directoryScan");
    });
    expect(inner.counts).toEqual({ fileRead: 0, directoryScan: 1, titleComparison: 3 });
    return "value";
  });

  // The inner window's operations are part of the outer one — "what this call
  // performed" includes what the calls inside it performed.
  expect(outer.value).toBe("value");
  expect(outer.counts).toEqual({ fileRead: 2, directoryScan: 1, titleComparison: 3 });

  // Closed again, so the 99 above and this one both land nowhere.
  countOperation("fileRead", 99);
  expect(recordOperations(() => undefined).counts).toEqual({ fileRead: 0, directoryScan: 0, titleComparison: 0 });

  const budget: OperationBudget = { fileRead: 2, titleComparison: 2 };
  const verdict = checkOperationBudget(outer.counts, budget);
  expect(verdict.ok).toBe(false);
  expect(verdict.overruns).toEqual([{ kind: "titleComparison", counted: 3, budget: 2 }]);
  // `directoryScan` is unbudgeted here, not budgeted at zero — a kind left out
  // of a budget must not be able to fail it.
  expect(describeBudgetVerdict(verdict, budget)).toContain("directoryScan 1 (unbudgeted)");
});

test(
  "Z3's criterion, stated in operations, returns the same verdict idle and under saturation",
  async () => {
    const b = await fixtureAt(SCALE_SHAPE);
    expect(b.tree.length).toBe(SCALE_SIZE);
    const { nextWork, check } = toolsFor(b);

    /*
     * Non-vacuity, and it is the same trap the wall-clock pin records: a tool
     * that returned early — an empty tree, a skipped scan — would perform the
     * fewest possible operations and sail past any budget. So both answers are
     * inspected before either measurement is trusted, exactly as
     * `wall-clock-budget.test.ts` inspects them.
     */
    const conditions: Condition[] = [
      {
        name: "ost_next_work at 10,000 nodes",
        nodes: SCALE_SIZE,
        expectOk: true,
        measure: async () => {
          const { value, counts } = await recordOperationsAsync(() => nextWork());
          const parsed = JSON.parse(String(value)) as { done: boolean; truncated: { list: string; total: number }[] };
          expect(parsed.done).toBe(false);
          expect(parsed.truncated.find((t) => t.list === "hygieneIssues")?.total ?? 0).toBeGreaterThan(1000);
          return counts;
        },
      },
      {
        name: "ost_check at 10,000 nodes",
        nodes: SCALE_SIZE,
        expectOk: true,
        measure: async () => {
          const { value, counts } = await recordOperationsAsync(() => check());
          expect(String(value)).toMatch(/violation/i);
          return counts;
        },
      },
    ];

    await assertVerdictSurvivesSaturation(conditions);

    // The counts themselves, pinned. A seam that silently stopped counting would
    // satisfy every agreement assertion above with a comfortable row of zeroes,
    // and that is the failure mode the solution node names as this approach's
    // whole cost: a bug in the counter is a bug in every gate built on it.
    const { counts } = await recordOperationsAsync(() => nextWork());
    expect(counts.fileRead).toBe(SCALE_SIZE);
    expect(counts.directoryScan).toBe(1);
    expect(counts.titleComparison).toBeGreaterThan(1000);
  },
  120_000,
);

test(
  "a regressed gate is red idle and red under saturation, and the unregressed one beside it is green",
  async () => {
    const b = await fixtureAt(SMALL_SHAPE);
    expect(b.tree.length).toBe(SMALL_SIZE);
    const { nextWork } = toolsFor(b);
    const ctx = buildPassContext(b.dir);

    const conditions: Condition[] = [
      {
        name: "ost_next_work at 1,200 nodes (unregressed)",
        nodes: SMALL_SIZE,
        expectOk: true,
        measure: async () => (await recordOperationsAsync(() => nextWork())).counts,
      },
      {
        name: "regressed: a second pass over the node set",
        nodes: SMALL_SIZE,
        expectOk: false,
        measure: async () =>
          (
            await recordOperationsAsync(async () => {
              await nextWork();
              ctx.vault.readTree(); // the re-read `computeNextWork` documents it does not do
            })
          ).counts,
      },
      {
        name: "regressed: the pre-Z3 all-pairs near-duplicate scan",
        nodes: SMALL_SIZE,
        expectOk: false,
        measure: async () => recordOperations(() => allPairsScan(ctx.vault)).counts,
      },
    ];

    await assertVerdictSurvivesSaturation(conditions);
  },
  120_000,
);
