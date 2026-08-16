/**
 * "Measure whether work count actually tracks elapsed time across vault
 * sizes" — the AssumptionTest beneath "Assert on work units instead of
 * milliseconds".
 *
 * `measureNextWork` below counts the files `computeNextWork` reads (one per
 * node at the vault root, plus one per evidence record) as its work unit —
 * the operation's own I/O, not a separately-derived guess about vault size.
 * It stays local to this test rather than living in `src/telemetry/`: it has
 * exactly one caller, this instrument, and a `src/` module with only a test
 * caller is the dead-code shape `test/release/module-reachability.test.ts`
 * exists to catch. It is measured with a second, untimed pass over the same
 * (unchanged) vault rather than plumbed out of `computeNextWork` itself, so
 * the widely-consumed `NextWork` shape gains no new field for a metric only
 * this instrument reads — and it counts via `fs.readdirSync` rather than
 * `Vault.readTreeCensus`, because this is a raw I/O count, not a read of node
 * content a retracted node could bend, so it is not one of the consumers
 * `test/ost/retraction-consumers.test.ts` audits.
 *
 * Two properties, read separately per the node:
 *
 *   1. **Correlation.** Across vault-size fixtures, elapsed time rises with
 *      work units, and the ratio of the two stays within a committed bound —
 *      not merely trending together, which a machine running one thing
 *      slower throughout would also produce.
 *   2. **Stability.** Work units are IDENTICAL across repeated runs of the
 *      same fixture. This is the half that makes a work-unit gate
 *      reproducible, and it holds independently of how tight the
 *      correlation is — a fixture re-read twice cannot see a different
 *      number of files without the vault changing underneath it.
 *
 * Deliberately blind, by the design this instrument is measuring, to a
 * regression that makes each unit of work slower without changing how many
 * files get read (a pathological regex, a synchronous block) — planting one
 * and confirming the gate stays green is the negative-case experiment the
 * assumption test describes for a human research pass, not a property this
 * automated regression instrument asserts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import type { PassContext } from "../../src/processes/types.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { readEvidence } from "../../src/processes/tree.js";
import { buildLargeTree, type LargeTreeShape } from "../ost/fixture-vault.js";

const OUTCOME = "Retention";

/** `.md` files at the vault root — the same set `readTreeCensus` reads one of per node. */
function nodeFileCount(vaultRoot: string): number {
  return fs.readdirSync(vaultRoot, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".md")).length;
}

/**
 * Run `computeNextWork` once, timed, then measure the work it did.
 *
 * The measuring pass runs after the clock stops, so a slow disk cannot widen
 * `elapsedMs` on the metric's own account. It reads the same files
 * `computeNextWork` just read, on a vault this call does not mutate, so the
 * count it returns is deterministic for a given vault regardless of what the
 * timed pass measured.
 */
function measureNextWork(ctx: PassContext, dir: string, min: number): { workUnits: number; elapsedMs: number } {
  const start = Date.now();
  computeNextWork(ctx.vault, dir, min);
  const elapsedMs = Date.now() - start;
  const workUnits = nodeFileCount(ctx.vault.root) + readEvidence(dir).length;
  return { workUnits, elapsedMs };
}

/**
 * Six sizes spanning a 32x range, roughly doubling — wide enough that a real
 * divergence between work count and elapsed time (an accidental quadratic,
 * say) would show up as a large ratio swing rather than getting lost in
 * per-run noise between two adjacent sizes.
 */
const SIZES = [150, 300, 600, 1200, 2400, 4800];

/** Same proportions `buildLargeTree`'s other consumers (Z2, Z3) use. */
function shapeFor(total: number): LargeTreeShape {
  const opportunities = Math.max(1, Math.round(total * 0.2));
  const solutions = Math.max(1, Math.round(total * 0.4));
  const assumptionTests = Math.max(0, total - opportunities - solutions);
  return { opportunities, solutions, assumptionTests };
}

let dirs: string[] = [];
beforeEach(() => {
  dirs = [];
});
afterEach(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

async function fixtureAt(size: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-work-units-"));
  dirs.push(dir);
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
  const ctx = buildPassContext(dir);
  buildLargeTree(ctx.vault, OUTCOME, shapeFor(size - 1), 7);
  return ctx;
}

/**
 * Fastest of `runs` — the same statistic `wall-clock-budget.test.ts` uses,
 * for the same reason: vitest runs test files in parallel, and the minimum
 * is the sample least contaminated by a co-scheduled file.
 */
function fastest(ctx: PassContext, dir: string, runs: number) {
  let bestMs = Number.POSITIVE_INFINITY;
  let workUnits = 0;
  for (let i = 0; i < runs; i++) {
    const m = measureNextWork(ctx, dir, 3);
    bestMs = Math.min(bestMs, m.elapsedMs);
    workUnits = m.workUnits; // identical every rep on an unchanged fixture — asserted separately below
  }
  return { ms: bestMs, workUnits };
}

/** Pearson correlation coefficient. */
function correlation(xs: number[], ys: number[]): number {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  return cov / Math.sqrt(varX * varY);
}

test(
  "elapsed time correlates with work units across vault sizes, above a committed bound",
  async () => {
    const points: { size: number; workUnits: number; ms: number }[] = [];
    for (const size of SIZES) {
      const ctx = await fixtureAt(size);
      const dir = ctx.vault.root;
      const { ms, workUnits } = fastest(ctx, dir, 5);
      expect(workUnits).toBe(size); // non-vacuity: the count tracks real files, not a constant
      points.push({ size, workUnits, ms });
    }

    // Monotonic: a larger fixture never answers faster than a smaller one.
    for (let i = 1; i < points.length; i++) {
      expect(points[i].ms, `size ${points[i].size} (${points[i].ms}ms) should not be faster than size ${points[i - 1].size} (${points[i - 1].ms}ms)`).toBeGreaterThanOrEqual(
        points[i - 1].ms,
      );
    }

    // Correlation. Measured at ~0.999 on an idle laptop for this codebase
    // (near-linear: computeNextWork's cost is dominated by a handful of
    // fixed-count passes over the tree). 0.9 leaves generous room for
    // machine noise while still failing on a fixture where work units and
    // time have genuinely decoupled.
    const r = correlation(
      points.map((p) => p.workUnits),
      points.map((p) => p.ms),
    );
    expect(r, `correlation was ${r}`).toBeGreaterThan(0.9);

    // Ratio bound: ms per work unit must not vary by more than 4x across the
    // whole range. Measured at ~1.2x on an idle laptop; 4x still catches a
    // genuine super-linear regression (an O(n log n) drift across this 32x
    // size range would only move the ratio ~1.7x) without being sensitive to
    // ordinary machine load.
    const ratios = points.map((p) => p.ms / p.workUnits);
    const spread = Math.max(...ratios) / Math.max(Math.min(...ratios), 1e-9);
    expect(spread, `ms/workUnit ratios were ${ratios.map((x) => x.toFixed(4)).join(", ")}`).toBeLessThan(4);
  },
  120_000,
);

test(
  "work units are identical across repeated runs of the same fixture",
  async () => {
    const ctx = await fixtureAt(600);
    const dir = ctx.vault.root;

    const counts = Array.from({ length: 5 }, () => measureNextWork(ctx, dir, 3).workUnits);
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBe(600);
  },
  60_000,
);
