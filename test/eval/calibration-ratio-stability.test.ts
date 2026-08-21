/**
 * "Load the machine deliberately and check that the calibration ratio holds
 * while the raw number does not" — the AssumptionTest beneath "Gate on a ratio
 * against a calibration run taken on the same machine at the same time".
 *
 * The solution: a perf gate stops reading milliseconds and reads a ratio.
 * Immediately before the real measurement, the same run times a fixed workload
 * of known cost — the calibration — on the same machine under the same load,
 * and gates on measurement ÷ calibration. A box twice as busy makes both
 * numbers twice as large and leaves the ratio alone. The assumption that makes
 * that true is that the two workloads respond to contention the same way, and
 * this file loads the machine on purpose to find out.
 *
 * Four load levels, idle to one CPU spinner per core, the code unchanged
 * throughout. At each level the subject — `computeNextWork` on the 10,000-node
 * tree Z3 (`test/mcp/wall-clock-budget.test.ts`) times — is measured nine
 * times, each time immediately after its calibration. Two clauses, fixed by
 * the test node before anything was measured:
 *
 *   - the raw measurement spreads by **more than 50%** across the levels, and
 *   - the ratio against the calibration spreads by **less than 10%**.
 *
 * Both are asserted, and the first is the one people skip. A quiet machine
 * produces a stable ratio and a stable raw number alike; only the raw number
 * moving makes a flat ratio evidence of anything.
 *
 * ## What was measured before this design was fixed (2026-08-20, one machine)
 *
 * Every run below is this subject, these levels, this statistic, on a 10-core
 * Apple M4 (4 performance + 6 efficiency cores). The first clause held on every
 * run — the raw number spread 100–300% — so every number here is about the
 * second.
 *
 * **A fixed CPU loop, the calibration the solution node describes, does not
 * track the subject.** A deterministic arithmetic loop of fixed iteration
 * count (~230 ms) read a ratio spread of **123%, 36%, 10.6% and 18.1%** across
 * four runs. The subject is not a single thread (its CPU-to-wall ratio idle is
 * 1.08–1.12 — V8's parallel GC helpers), so the first spinners cost it
 * something a single-threaded loop never had: at five spinners it slowed 1.8×
 * while a 26 ms loop moved 8%. Past saturation the direction reverses — ten
 * thousand file reads keep entering the kernel, and the scheduler does not
 * decay such a thread the way it decays a pure spinner; at twenty spinners a
 * 234 ms loop slowed 4.2× and the subject 3×. That is the solution node's own
 * "much less true once disk is involved" caveat, confirmed in the direction it
 * did not predict: the real work is *favoured* under load, not penalised.
 *
 * **A calibration of the same shape tracks it only when the cores are
 * homogeneous.** The same call on a smaller tree from the same fixture — same
 * mix of CPU and file reads, same GC, same treatment by the scheduler — is the
 * mechanism the sibling "Budget against a same-run baseline instead of against
 * the clock" already built (`test/telemetry/same-run-baseline-ratio.test.ts`).
 * At a fifth the scale (2,000 nodes, ~300 ms) it read **4.3%, 5.2% and 10.4%**
 * in three hand runs and then **32.5%, 26.6% and 27.9%** in three runs of this
 * file. The per-pair readings on the red runs name the cause: at five spinners
 * the calibration was bimodal — ~340 ms or ~700 ms, a clean 2× — because once
 * the four performance cores are taken, each call lands on a performance or an
 * efficiency core at the scheduler's discretion, and a 300 ms call is a single
 * draw of that lottery where a 1,500 ms call averages several. Two adjacent
 * calls on the same machine at the same time were not running at the same
 * speed, and a ratio cannot cancel what the two sides do not share.
 *
 * Throughout those six runs the machine was carrying a virtual machine and a
 * JVM that held the four performance cores between them, so this process ran
 * on efficiency cores the whole time: the subject read ~1,450 ms idle against
 * the 249–267 ms `test/fixtures/perf-gate-noise-band/PROVENANCE.md` recorded
 * for the identical call on the identical tree on this identical machine ten
 * days earlier — and the commit from that day, timed the same afternoon, read
 * the same ~1,360 ms. When the two processes went quiet the subject fell to
 * 270 ms and the fixed CPU loop from 234 ms to 81 ms, a 2.9× change in the
 * cost of a fixed workload with nothing in the code changed. That is the
 * opportunity's whole complaint, observed on the criterion's own recorded
 * figure.
 *
 * **The design this file ships — half scale — holds when the cores are
 * homogeneous and is closest when they are not.** A 5,000-node calibration
 * (~700 ms idle) is long enough to average over several placements. On the
 * loaded machine it read **17.1% and 12.6%** — still red, by the smallest
 * margin of anything tried; on the quiet machine it read green on two
 * consecutive runs. Its cost is sensitivity: a same-shape calibration only sees
 * a regression that is *superlinear* in tree size (a linear slowdown moves both
 * sides equally), and at half scale a quadratic term is a quarter of the
 * subject's rather than a four-hundredth. The fixed CPU loop would see a
 * linear slowdown — and is the arm that does not track contention. Nothing
 * tried here sees both.
 *
 * ## Why the top level is one spinner per core, not two
 *
 * Two per core satisfies the raw-spread clause by a wider margin (270–300%)
 * and makes every reading noisy: paired ratios at that level ran 3.5–8.5 in one
 * run. One spinner per core already oversubscribes the box (this process, the
 * spinners and whatever else the machine is doing), slows the subject 2× on its
 * own, and leaves the ratio readable. The levels were fixed before the
 * assertions were run against them; they are parameters of the experiment,
 * not of the claim.
 *
 * ## Where it runs, and where it must not
 *
 * This file forks spinners on purpose, so it is both victim and culprit inside
 * the ordinary suite: its "idle" level is not idle beside 270 other files, and
 * its spinners would knock over every other timing assertion in the run.
 * `vitest.config.ts` excludes it unless it is named on the command line —
 * `npx vitest run test/eval/calibration-ratio-stability.test.ts`, the form its
 * instrument takes — so `npx vitest run` never collects it and never reports a
 * green it did not measure.
 *
 * ## What green does not settle
 *
 * One machine, one kind of induced load, and — the finding above — one state
 * of that machine. Green here says the ratio held while the box's spare cores
 * were of one kind. On a heterogeneous-core laptop whose fast cores are taken
 * by something else, it does not hold for any calibration tried, and the gate
 * built on it would fail for a reason that has nothing to do with the code,
 * which the solution node itself names as the position worse than an absolute
 * number. Disk contention, memory pressure and thermal throttling were not
 * induced and respond differently from CPU spinners.
 */
import os from "node:os";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { bench, median, removeBench, settle, spinners, spread, stopSpinners, type Bench } from "../perf/contention.js";

const OUTCOME = "Retention";
/** The 10,000-node tree the Z3 wall-clock gate times. */
const SUBJECT_SHAPE = { opportunities: 2000, solutions: 4000, assumptionTests: 3999 };
/** The same call at half the scale: 5,000 nodes, same fixture, same seed. */
const CALIBRATION_SHAPE = { opportunities: 1000, solutions: 2000, assumptionTests: 1999 };
/** Fixed, per `buildLargeTree`'s contract: a benchmark that reads the clock for its inputs is not one. */
const NOW = () => new Date("2026-08-10T00:00:00Z");

const CORES = os.cpus().length;
/** Idle, then a quarter, half and all of the cores taken by spinners. */
const LOAD_LEVELS = [0, Math.ceil(CORES / 4), Math.ceil(CORES / 2), CORES];
const PAIRS_PER_LEVEL = 9;

/** The two clauses, as the test node fixed them. */
const RAW_SPREAD_FLOOR = 0.5;
const RATIO_SPREAD_CEILING = 0.1;

interface Pair {
  calibrationMs: number;
  subjectMs: number;
}

interface LevelReading {
  spinners: number;
  pairs: Pair[];
  /** Median subject time at this level. */
  rawMs: number;
  /** Median calibration time at this level. */
  calibrationMs: number;
  /** Median of the nine paired ratios — not the ratio of the two medians. */
  ratio: number;
}

function timed(b: Bench): number {
  const start = performance.now();
  computeNextWork(b.vault, b.dir, 3, NOW);
  return performance.now() - start;
}

/**
 * Calibration first, subject immediately after, ratio read pair by pair.
 *
 * Same-run only cancels contention if the two measurements share a contention
 * window — adjacent in time relative to how fast the load itself changes, not
 * merely in the same process. `test/telemetry/same-run-baseline-ratio.test.ts`
 * learned that the hard way (an 86× reading from two "fastest of five" blocks
 * that never co-occurred). The median of the paired ratios rejects a burst that
 * lands between one pair's two calls without the directional bias of taking
 * each side's minimum separately.
 */
function readLevel(subject: Bench, calibration: Bench): Pair[] {
  const pairs: Pair[] = [];
  for (let i = 0; i < PAIRS_PER_LEVEL; i++) {
    const calibrationMs = timed(calibration);
    const subjectMs = timed(subject);
    pairs.push({ calibrationMs, subjectMs });
  }
  return pairs;
}

function summarise(count: number, pairs: Pair[]): LevelReading {
  return {
    spinners: count,
    pairs,
    rawMs: median(pairs.map((p) => p.subjectMs)),
    calibrationMs: median(pairs.map((p) => p.calibrationMs)),
    ratio: median(pairs.map((p) => p.subjectMs / p.calibrationMs)),
  };
}

/**
 * Every reading, not just the medians: a red that shows only four medians
 * cannot tell a level that shifted as a whole from one where a few pairs
 * landed on a slower core.
 */
function describeLevels(levels: LevelReading[]): string {
  return levels
    .map((l) => {
      const pairs = l.pairs.map((p) => `${p.subjectMs.toFixed(0)}/${p.calibrationMs.toFixed(0)}=${(p.subjectMs / p.calibrationMs).toFixed(2)}`).join(" ");
      return `${l.spinners} spinners: ${l.rawMs.toFixed(0)}ms raw, ${l.calibrationMs.toFixed(0)}ms calibration, ${l.ratio.toFixed(2)}× [${pairs}]`;
    })
    .join("\n");
}

// ── the sweep, run once, read by every assertion below ───────────────────────

let subject: Bench | undefined;
let calibration: Bench | undefined;
const levels: LevelReading[] = [];

beforeAll(async () => {
  subject = await bench(SUBJECT_SHAPE, OUTCOME, "ost-calibration-subject-");
  calibration = await bench(CALIBRATION_SHAPE, OUTCOME, "ost-calibration-control-");
  expect(subject.tree.length).toBe(10_000);
  expect(calibration.tree.length).toBe(5_000);

  /*
   * Non-vacuity. A call that returned early — nothing outstanding, nothing
   * scanned — would be the fastest implementation and the most stable ratio,
   * and would mean nothing. Both trees must hand the call real work.
   */
  expect(computeNextWork(subject.vault, subject.dir, 3, NOW).done).toBe(false);
  expect(computeNextWork(calibration.vault, calibration.dir, 3, NOW).done).toBe(false);

  for (const count of LOAD_LEVELS) {
    const children = spinners(count);
    // Forked node processes take a moment to start spinning; a level read
    // before they do is a lighter level than the one it claims to be.
    await settle(count > 0 ? 1500 : 300);
    try {
      levels.push(summarise(count, readLevel(subject, calibration)));
    } finally {
      stopSpinners(children);
      await settle(300);
    }
  }
}, 900_000);

afterAll(() => {
  removeBench(subject);
  removeBench(calibration);
  // The readings, on green as well as on red: an exit code alone cannot be
  // compared against the next run's, and the instrument log keeps the line.
  if (levels.length > 0) {
    const raw = spread(levels.map((l) => l.rawMs));
    const ratio = spread(levels.map((l) => l.ratio));
    console.info(`calibration-ratio-stability: raw spread ${(raw * 100).toFixed(1)}%, ratio spread ${(ratio * 100).toFixed(1)}%\n${describeLevels(levels)}`);
  }
});

// ── the design, before any number is read off it ─────────────────────────────

describe("the bars are the ones the test node fixed, not ones chosen after", () => {
  test("raw spread over 50%, ratio spread under 10%", () => {
    expect(RAW_SPREAD_FLOOR).toBe(0.5);
    expect(RATIO_SPREAD_CEILING).toBe(0.1);
  });

  test("four load levels, idle to one spinner per core, strictly increasing", () => {
    expect(LOAD_LEVELS).toHaveLength(4);
    expect(LOAD_LEVELS[0]).toBe(0);
    expect(LOAD_LEVELS[3]).toBe(CORES);
    for (let i = 1; i < LOAD_LEVELS.length; i++) expect(LOAD_LEVELS[i]).toBeGreaterThan(LOAD_LEVELS[i - 1]);
  });

  test("the calibration is the same call at half the scale, not a synthetic loop", () => {
    const nodes = (s: typeof SUBJECT_SHAPE) => 1 + s.opportunities + s.solutions + s.assumptionTests;
    expect(nodes(SUBJECT_SHAPE) / nodes(CALIBRATION_SHAPE)).toBe(2);
  });
});

// ── what was measured ────────────────────────────────────────────────────────

describe("every level was actually read", () => {
  test("four levels, nine pairs each, every timing positive", () => {
    expect(levels.map((l) => l.spinners)).toEqual(LOAD_LEVELS);
    for (const l of levels) {
      expect(l.pairs).toHaveLength(PAIRS_PER_LEVEL);
      for (const p of l.pairs) {
        expect(p.subjectMs).toBeGreaterThan(0);
        expect(p.calibrationMs).toBeGreaterThan(0);
      }
    }
  });

  test("the calibration is smaller than the subject at every level — a ratio near 1 would be two readings of the same thing", () => {
    for (const l of levels) expect(l.ratio, describeLevels(levels)).toBeGreaterThan(1.5);
  });
});

// ── the two clauses ──────────────────────────────────────────────────────────

describe("with the code unchanged across four load levels", () => {
  test("the raw measurement spreads by more than 50% — the load was real", () => {
    const raw = spread(levels.map((l) => l.rawMs));
    expect(raw, `raw spread ${(raw * 100).toFixed(1)}% — ${describeLevels(levels)}`).toBeGreaterThan(RAW_SPREAD_FLOOR);
  });

  test("and the heaviest level is the slowest one, so the spread is the load and not a burst at idle", () => {
    const heaviest = levels[levels.length - 1];
    const idle = levels[0];
    expect(heaviest.rawMs, describeLevels(levels)).toBeGreaterThan(idle.rawMs * (1 + RAW_SPREAD_FLOOR));
  });

  test("the ratio against the calibration spreads by less than 10% — the calibration moved with it", () => {
    const ratio = spread(levels.map((l) => l.ratio));
    expect(ratio, `ratio spread ${(ratio * 100).toFixed(1)}% — ${describeLevels(levels)}`).toBeLessThan(RATIO_SPREAD_CEILING);
  });
});
