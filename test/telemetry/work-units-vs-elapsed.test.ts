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
 * Fastest of `runs` per size, with the runs INTERLEAVED across sizes.
 *
 * Minimum-of-N is the same statistic `wall-clock-budget.test.ts` uses, for the
 * same reason: vitest runs test files in parallel and the minimum is the sample
 * least contaminated by a co-scheduled file. But taking all N samples for one
 * size before moving to the next does not survive that contention, and this
 * instrument was red on `main` because of it — under a full `npx vitest run`,
 * size 2400's whole five-sample window landed inside another file's heavy phase
 * (538ms) while 4800's did not (515ms), and the monotonicity assertion read a
 * scheduling accident as a size inversion. Reproduced at the base commit with
 * no source change, so it was the measurement, not the code under it.
 *
 * Round-robin fixes it at the measurement rather than at the bound: every size
 * is sampled once per round, so a contended round taxes all six equally and the
 * per-size minimum is taken over the same set of windows. Every bound below is
 * unchanged.
 *
 * **The slowest round is kept too, and it is not decoration.** Round-robin
 * equalises contention *on average*, and that was enough at the top of the range
 * where a size step is worth ~250 ms. It is not enough at the bottom, where 150
 * and 300 nodes answer in 16-21 ms and one scheduler slice is a quarter of the
 * gap: on 2026-08-31, under a full 328-file run, size 300 came in at 16 ms
 * against size 150's 21 ms and the zero-tolerance monotonicity assertion read
 * that as an inversion, while the two bounds below that DO carry stated headroom
 * — correlation ≥ 0.9 and ratio spread < 4× — both passed comfortably in the same
 * trial. That is the signature of a comparison below its instrument's
 * resolution, not of a size inversion. `min` and `max` here are what let the
 * assertion say so with a number the same trial produced, rather than with a
 * constant somebody picked.
 */
function fastestInterleaved(
  fixtures: readonly { size: number; ctx: PassContext; dir: string }[],
  runs: number,
): { size: number; workUnits: number; ms: number; slowestMs: number }[] {
  const best = fixtures.map((f) => ({
    size: f.size,
    workUnits: 0,
    ms: Number.POSITIVE_INFINITY,
    slowestMs: 0,
  }));
  for (let round = 0; round < runs; round++) {
    for (let i = 0; i < fixtures.length; i++) {
      const m = measureNextWork(fixtures[i].ctx, fixtures[i].dir, 3);
      best[i].ms = Math.min(best[i].ms, m.elapsedMs);
      best[i].slowestMs = Math.max(best[i].slowestMs, m.elapsedMs);
      best[i].workUnits = m.workUnits; // identical every rep on an unchanged fixture — asserted separately below
    }
  }
  return best;
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
    // Every fixture is built before any of them is timed, so the measurement
    // rounds below see six vaults in the same state rather than one being
    // constructed while another is being clocked.
    const fixtures: { size: number; ctx: PassContext; dir: string }[] = [];
    for (const size of SIZES) {
      const ctx = await fixtureAt(size);
      fixtures.push({ size, ctx, dir: ctx.vault.root });
    }

    const points = fastestInterleaved(fixtures, 5);
    for (const p of points) {
      expect(p.workUnits).toBe(p.size); // non-vacuity: the count tracks real files, not a constant
    }

    // Monotonic: a larger fixture never answers faster than a smaller one — by
    // more than this trial's own demonstrated noise at the two sizes being
    // compared. The tolerance is the wider of the two run-to-run spreads, which
    // is a number this run measured rather than a constant, so it tightens on an
    // idle box and only widens on the box that earned it. An inversion larger
    // than the spread that produced it is still a failure, which is the case
    // this clause exists for; one smaller than it is a comparison the instrument
    // cannot resolve, and asserting on it reports scheduling as a regression.
    for (let i = 1; i < points.length; i++) {
      const noise = Math.max(points[i].slowestMs - points[i].ms, points[i - 1].slowestMs - points[i - 1].ms);
      expect(
        points[i].ms,
        `size ${points[i].size} (${points[i].ms}ms) should not be faster than size ${points[i - 1].size} (${points[i - 1].ms}ms) by more than the ${noise}ms run-to-run spread this trial measured`,
      ).toBeGreaterThanOrEqual(points[i - 1].ms - noise);
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
    // The failure message carries the measurement, not just the derived number.
    // Two failures of this clause on 2026-09-02 were only diagnosable by pairing
    // the ratios back to the elapsed times that produced them, which the message
    // did not print — 0.0400 and 0.2933 at the same size on two runs of the same
    // commit is a fact about 6 ms versus 44 ms, and unreadable without them.
    const detail = points.map((p) => `${p.size}: ${p.ms}-${p.slowestMs}ms → ${(p.ms / p.workUnits).toFixed(4)}`).join(", ");
    expect(spread, `ms/workUnit by size (fastest-slowest of ${5} rounds): ${detail}`).toBeLessThan(4);
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
