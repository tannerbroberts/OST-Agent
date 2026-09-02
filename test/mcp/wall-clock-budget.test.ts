/**
 * Z3 — `ost_next_work` and `ost_check` complete within a fixed wall-clock budget
 * at 10,000 nodes.
 *
 * Measured at the TOOL, not at the function. `computeNextWork` is only most of
 * `ost_next_work`, and `ost_check` additionally reconciles against git's index —
 * an external process the criterion's sentence does not exempt. Timing the pure
 * function would pin a number nobody experiences.
 *
 * The algorithmic half of this criterion is pinned separately and more sharply
 * in `test/ost/dedupe-scale.test.ts`, which races the indexed near-duplicate scan
 * against the pre-Z3 all-pairs one in the same process. **That file is the one
 * that fails on a fast machine when the quadratic returns**; this one asserts the
 * budget the criterion actually names, and would need a machine ~3× slower than
 * this laptop before it noticed anything on its own. Both, because a ratio with
 * no absolute bound can drift upward forever and an absolute bound on a fast
 * machine can hide an order of magnitude.
 *
 * **This gate stays wall-clock on purpose, and is marked as such.** It went red
 * on two consecutive scheduled passes — 2004 ms and 2280 ms inside the full
 * suite, both passing with 18 seconds of margin re-run alone seconds later — and
 * the answer to that is not to loosen `BUDGET_MS`. The same criterion now has a
 * second instrument, `test/gate/operation-budget.test.ts`, which states it in
 * operations performed (file reads, directory listings, title comparisons) and
 * therefore cannot be failed by load at all. This one is kept because 2,000 ms
 * is a latency a person experiences, and an operation budget is blind to a
 * regression that makes each operation slower without changing how many there
 * are. Read the two together: red here beside green there is contention; red on
 * both is the code. `src/release/timed-checks.declared.ts` is where the set of
 * gates that can still be failed by a busy machine is enumerated.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { buildOstTools } from "../../src/security/tools.js";
import { buildLargeTree } from "../ost/fixture-vault.js";

/** The criterion's budget, per tool. */
const BUDGET_MS = 2000;

const OUTCOME = "Retention";
/** One Outcome plus 9,999 nodes beneath it. */
const SHAPE = { opportunities: 2000, solutions: 4000, assumptionTests: 3999 };

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-z3-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
}, 180_000);
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * Fastest of three runs.
 *
 * vitest runs test FILES in parallel, so a single timed run here shares a
 * machine with whatever else is mid-suite. The minimum is the sample least
 * contaminated by a co-scheduled file — and it is the honest statistic for the
 * question being asked, which is what the work costs, not what the CI box was
 * doing at the time. It cannot hide a real regression: a quadratic scan is slow
 * on every one of the three runs.
 */
async function fastestOf(runs: number, fn: () => Promise<unknown>): Promise<{ ms: number; last: unknown }> {
  let best = Number.POSITIVE_INFINITY;
  let last: unknown;
  for (let i = 0; i < runs; i++) {
    const start = Date.now();
    last = await fn();
    best = Math.min(best, Date.now() - start);
  }
  return { ms: best, last };
}

test(
  "ost_next_work and ost_check each answer a 10,000-node vault inside the budget",
  async () => {
    const ctx = buildPassContext(dir);
    buildLargeTree(ctx.vault, OUTCOME, SHAPE);
    expect(ctx.vault.readTree().length).toBe(10_000);

    const tools = buildOstTools({ vault: ctx.vault, dir, remote: { enabled: false }, passContext: ctx });
    const nextWork = tools.find((t) => t.name === "ost_next_work")!;
    const check = tools.find((t) => t.name === "ost_check")!;

    const work = await fastestOf(3, () => nextWork.run({}));
    const checked = await fastestOf(3, () => check.run({}));

    /*
     * Non-vacuity, and it is not a formality here.
     *
     * A tool that returned early — an empty tree, a skipped scan, a thrown-away
     * census — would be the fastest possible implementation and would sail past
     * a wall-clock bound. So both answers are inspected: `ost_next_work` must
     * have found real outstanding work over all 10,000 nodes, and `ost_check`
     * must have found real violations. This is the same trap W4 records and the
     * one Z1's pin was rewritten to avoid.
     */
    const parsed = JSON.parse(String(work.last)) as { done: boolean; truncated: { list: string; total: number }[] };
    expect(parsed.done).toBe(false);
    const hygiene = parsed.truncated.find((t) => t.list === "hygieneIssues");
    expect(hygiene?.total ?? 0).toBeGreaterThan(1000);
    expect(String(checked.last)).toMatch(/violation/i);

    expect(work.ms, `ost_next_work took ${work.ms}ms`).toBeLessThan(BUDGET_MS);
    expect(checked.ms, `ost_check took ${checked.ms}ms`).toBeLessThan(BUDGET_MS);
  },
  180_000,
);
