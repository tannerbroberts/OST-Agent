/**
 * Cut a corpus of perf-gate failures whose cause is known, by causing them.
 *
 * Run by hand, output committed to `test/fixtures/perf-gate-noise-band/`. The
 * question it feeds is whether the pair a perf gate can print — the measurement
 * and the figure the criterion recorded — tells "the code got slower" apart from
 * "this box is slower". Real failures arrive without labels, so the only way to
 * score a rule is to arrange the cause and then hide it.
 *
 *   npx tsx scripts/harvest-perf-noise-corpus.ts test/fixtures/perf-gate-noise-band
 *
 * Two things are arranged, and both are the real article rather than a stand-in:
 *
 *   - **the slowdown** is the one that actually happened. Between 2026-07-30 and
 *     08-05 three rules in `checkInvariants` answered "who links to this node?"
 *     with `tree.filter(...)` per node; it profiled at 44% of all CPU and drifted
 *     `ost_next_work` from ~620 ms to ~1,600 ms. `reinstatedQuadratic` below
 *     puts those scans back, around the same `computeNextWork` call the Z3 gate
 *     times, on the same 10,000-node tree that gate uses.
 *   - **the busy machine** is a busy machine. `spinners` forks child processes
 *     that do nothing but burn CPU, which is what a CI box running test files in
 *     parallel does to a benchmark sharing it.
 *
 * Nothing here is imported by `src/` or by a test. The fixture is the artefact,
 * and `PROVENANCE.md` next to it records the cut so anyone can disagree with the
 * rule rather than with the number.
 */
import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeNextWork } from "../src/mcp/next-work.js";
import type { RecordedFailure } from "../src/eval/perf-noise-band.js";
import type { OstNode } from "../src/ost/node.js";
import type { Vault } from "../src/ost/vault.js";
import { buildPassContext } from "../src/runner/context.js";
import { initVault } from "../src/runner/init.js";
import { buildLargeTree } from "../test/ost/fixture-vault.js";

const out = path.resolve(process.argv[2] ?? "test/fixtures/perf-gate-noise-band");

/**
 * The tree and the call the Z3 gate itself times: `ost_next_work` at 10,000
 * nodes, via the same `buildLargeTree` fixture `test/mcp/wall-clock-budget.test.ts`
 * and `test/ost/dedupe-scale.test.ts` share.
 *
 * Measured at this workload rather than at `checkInvariants` alone, and the
 * difference is not cosmetic: the invariants pass is ~13 ms of a ~260 ms call
 * here, so timing it by itself turns the reinstated quadratic into a 14–36×
 * cartoon. Against the call the criterion is actually written about it is ~3×,
 * which is the neighbourhood the real drift was in (620 → 1,600 ms) and the
 * region where reading a failure is genuinely hard.
 */
const SHAPE = { opportunities: 2000, solutions: 4000, assumptionTests: 3999 };
/**
 * A second, small tree, timed in the same trial as the big one.
 *
 * This is the **control arm**, and it is not the "calibrate the machine against a
 * synthetic CPU loop" idea the solution node dismisses — nothing synthetic is
 * timed. It is the same call, on the same code, on a tree small enough that a
 * quadratic term is 1/400th of what it is at 10,000 nodes. So a busy box moves
 * both numbers together and a quadratic moves only one, which is a distinction
 * neither the pair nor the spread has access to.
 *
 * Added after the first cut came back with both pre-registered rules at chance.
 * It is exploratory and labelled as such wherever its number is reported.
 */
const CONTROL_SHAPE = { opportunities: 100, solutions: 200, assumptionTests: 199 };
const OUTCOME = "Retention";
/** Fixed, because a benchmark that reads the clock for its inputs is not a benchmark. */
const NOW = () => new Date("2026-08-10T00:00:00Z");

/** The gate's statistic: fastest of three, as `test/mcp/wall-clock-budget.test.ts` takes it. */
const RUNS_PER_TRIAL = 3;

/**
 * The budget, as a multiple of the recorded high.
 *
 * 2.67 is the ratio Z3's own budget bears to the figure it recorded: 2,000 ms
 * against 620–750 ms. Picking the multiple off the real criterion rather than
 * choosing one here is what keeps the corpus's *failures* the same population of
 * failures the real gate produces — a tighter budget would fill it with trials
 * nobody would ever have argued about.
 */
const BUDGET_MULTIPLE = 2000 / 750;

/** How many failures of each cause the corpus wants. */
const WANTED = { noise: 5, regressionIdle: 3, regressionLoaded: 2 };

const CORES = os.cpus().length;

// ── the workload, fast and slow ─────────────────────────────────────────────

/**
 * The three scans the 08-05 tree-rule work added and the 08-06 fix removed.
 *
 * A faithful reconstruction rather than a fork of `checkInvariants`: the extra
 * cost the regression carried was exactly this — a full scan of the tree per
 * Solution, per Assumption and per AssumptionTest, with an `Array.includes`
 * inside each — so running it around the current call reproduces the shape and
 * the magnitude of what CI was timing. The result is discarded; the point is the
 * CPU, and `sink` keeps a compiler from deciding otherwise.
 *
 * `severity` repeats the scan, which is how the sweep reaches a drift steeper
 * than the historical one without inventing a different kind of slowdown.
 */
let sink = 0;
function reinstatedQuadratic(tree: OstNode[], severity: number): void {
  for (let pass = 0; pass < severity; pass++) {
    for (const n of tree) {
      if (n.layer !== "Solution" && n.layer !== "Assumption" && n.layer !== "AssumptionTest") continue;
      sink += tree.filter((p) => p.links.includes(n.title)).length;
    }
  }
}

interface Bench {
  vault: Vault;
  dir: string;
  tree: OstNode[];
}

function once(b: Bench, severity: number): number {
  const start = Date.now();
  if (severity > 0) reinstatedQuadratic(b.tree, severity);
  computeNextWork(b.vault, b.dir, 3, NOW);
  return Date.now() - start;
}

interface Trial {
  runs: number[];
  controlRuns: number[];
}

/**
 * One timed trial: `RUNS_PER_TRIAL` repetitions, all of them kept.
 *
 * The control is timed inside the same repetition, back to back with the subject,
 * so the two see the same machine — a control taken before or after the load was
 * applied would measure a different box and answer a different question.
 */
function trial(subject: Bench, control: Bench, severity: number): Trial {
  const runs: number[] = [];
  const controlRuns: number[] = [];
  for (let i = 0; i < RUNS_PER_TRIAL; i++) {
    runs.push(once(subject, severity));
    controlRuns.push(once(control, severity));
  }
  return { runs, controlRuns };
}

// ── the busy machine ────────────────────────────────────────────────────────

const SPINNER = `
let x = 0;
for (;;) { x = (x + Math.sqrt(x % 1e6)) % 1e9; }
`;

function spinners(count: number): ChildProcess[] {
  const file = path.join(os.tmpdir(), `ost-perf-spinner-${process.pid}.mjs`);
  fs.writeFileSync(file, SPINNER, "utf8");
  return Array.from({ length: count }, () => fork(file, { stdio: "ignore" }));
}

function stop(children: ChildProcess[]): void {
  for (const c of children) c.kill("SIGKILL");
}

/** Let the forked spinners actually get scheduled before timing anything. */
function settle(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── the tree ────────────────────────────────────────────────────────────────

async function bench(shape: typeof SHAPE): Promise<Bench> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-perf-noise-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
  const vault = buildPassContext(dir).vault;
  buildLargeTree(vault, OUTCOME, shape);
  return { vault, dir, tree: vault.readTree() };
}

const subject = await bench(SHAPE);
const control = await bench(CONTROL_SHAPE);
console.error(`tree: ${subject.tree.length} nodes, control ${control.tree.length}, on ${CORES} cores`);

// ── calibration: what the criterion would have recorded ─────────────────────

/**
 * The recorded figure, taken the way a criterion's is: the unchanged code on an
 * idle machine, across enough repetitions to have a range rather than a point.
 */
const CALIBRATION_TRIALS = 6;
const calibrationRuns: number[] = [];
const calibrationControlRuns: number[] = [];
for (let i = 0; i < CALIBRATION_TRIALS; i++) {
  const t = trial(subject, control, 0);
  calibrationRuns.push(...t.runs);
  calibrationControlRuns.push(...t.controlRuns);
}
const recordedMin = Math.min(...calibrationRuns);
const recordedMax = Math.max(...calibrationRuns);
const budget = Math.round(recordedMax * BUDGET_MULTIPLE);
/**
 * The control's own recorded range, and the ratio between the two.
 *
 * A criterion that recorded a control alongside its figure would have this for
 * free; none of them does today, which is itself part of the finding.
 */
const recordedControlMin = Math.min(...calibrationControlRuns);
const recordedControlMax = Math.max(...calibrationControlRuns);
const recordedRatioMax = recordedMax / recordedControlMin;
console.error(
  `recorded ${recordedMin}–${recordedMax}ms, control ${recordedControlMin}–${recordedControlMax}ms, ratio ≤${recordedRatioMax.toFixed(1)}, budget ${budget}ms`,
);

// ── the sweep ───────────────────────────────────────────────────────────────

const failures: RecordedFailure[] = [];
const attempts: { condition: string; trials: number; breaches: number }[] = [];

function record(id: string, cause: RecordedFailure["cause"], condition: string, t: Trial): void {
  failures.push({
    id,
    cause,
    condition,
    measured: Math.min(...t.runs),
    runs: t.runs,
    spreadMin: Math.min(...t.runs),
    spreadMax: Math.max(...t.runs),
    recordedMin,
    recordedMax,
    budget,
    controlMeasured: Math.min(...t.controlRuns),
    controlRuns: t.controlRuns,
    recordedControlMin,
    recordedControlMax,
  });
}

/**
 * Load is swept from light to heavy and the *first* breaches are the ones kept.
 *
 * That is the conservative cut: the least-loaded machine that can fail the gate
 * produces the smallest measurement, which is the noise case a pair-only rule
 * has the best chance of reading correctly. Filling the corpus with 8× oversubscription
 * would have made the rule look worse for free.
 */
async function sweepNoise(): Promise<void> {
  for (const factor of [1, 2, 3, 4, 6, 8]) {
    if (failures.filter((f) => f.cause === "noise").length >= WANTED.noise) return;
    const children = spinners(Math.round(CORES * factor));
    await settle(500);
    let trials = 0;
    let breaches = 0;
    for (let i = 0; i < 4; i++) {
      const t = trial(subject, control, 0);
      trials++;
      if (Math.min(...t.runs) > budget) {
        breaches++;
        record(`noise-${factor}x-${i}`, "noise", `unchanged code, ${Math.round(CORES * factor)} CPU spinners (${factor}× cores)`, t);
      }
      if (failures.filter((f) => f.cause === "noise").length >= WANTED.noise) break;
    }
    stop(children);
    attempts.push({ condition: `noise ${factor}× cores`, trials, breaches });
    await settle(300);
    console.error(`noise ${factor}×: ${breaches}/${trials} breached`);
  }
}

/**
 * The regression on an idle machine, swept by severity.
 *
 * Severity 1 is the drift that actually happened. Whether it breaches the budget
 * at all on an idle box is itself a finding — the Z3 entry records that it did
 * not locally, which is why nobody developing against it saw anything — so the
 * sweep goes up until the corpus has its three, and what severity they came from
 * is written next to each.
 */
async function sweepRegressionIdle(): Promise<void> {
  for (const severity of [1, 2, 3, 4]) {
    if (failures.filter((f) => f.id.startsWith("regression-idle")).length >= WANTED.regressionIdle) return;
    let trials = 0;
    let breaches = 0;
    for (let i = 0; i < 3; i++) {
      const t = trial(subject, control, severity);
      trials++;
      if (Math.min(...t.runs) > budget) {
        breaches++;
        record(`regression-idle-s${severity}-${i}`, "regression", `${severity}× the reinstated quadratic scan, idle machine`, t);
      }
      if (failures.filter((f) => f.id.startsWith("regression-idle")).length >= WANTED.regressionIdle) break;
    }
    attempts.push({ condition: `regression idle severity ${severity}`, trials, breaches });
    console.error(`regression idle s${severity}: ${breaches}/${trials} breached`);
  }
}

/**
 * The case that actually happened: the historical drift, on a box that is also busy.
 *
 * Severity 1 only, because the point of these two is that they are the real
 * event rather than a bigger version of it. They are the corpus's hard cases in
 * both directions — the machine is busy AND the code is slower — and any rule
 * that reads a busy machine as exculpatory will call them noise.
 */
async function sweepRegressionLoaded(): Promise<void> {
  for (const factor of [1, 2, 3]) {
    if (failures.filter((f) => f.id.startsWith("regression-loaded")).length >= WANTED.regressionLoaded) return;
    const children = spinners(Math.round(CORES * factor));
    await settle(500);
    let trials = 0;
    let breaches = 0;
    for (let i = 0; i < 3; i++) {
      const t = trial(subject, control, 1);
      trials++;
      if (Math.min(...t.runs) > budget) {
        breaches++;
        record(
          `regression-loaded-${factor}x-${i}`,
          "regression",
          `the historical drift (1× quadratic) on a box running ${Math.round(CORES * factor)} CPU spinners`,
          t,
        );
      }
      if (failures.filter((f) => f.id.startsWith("regression-loaded")).length >= WANTED.regressionLoaded) break;
    }
    stop(children);
    attempts.push({ condition: `regression loaded ${factor}× cores`, trials, breaches });
    await settle(300);
    console.error(`regression loaded ${factor}×: ${breaches}/${trials} breached`);
  }
}

await sweepNoise();
await sweepRegressionIdle();
await sweepRegressionLoaded();

// ── what the corpus cost to produce ─────────────────────────────────────────

const corpus = {
  takenOn: new Date().toISOString().slice(0, 10),
  machine: `${os.platform()} ${os.arch()}, ${CORES} cores`,
  nodes: subject.tree.length,
  controlNodes: control.tree.length,
  shape: SHAPE,
  controlShape: CONTROL_SHAPE,
  runsPerTrial: RUNS_PER_TRIAL,
  calibrationTrials: CALIBRATION_TRIALS,
  calibrationRuns,
  calibrationControlRuns,
  recordedMin,
  recordedMax,
  recordedControlMin,
  recordedControlMax,
  recordedRatioMax,
  budget,
  budgetMultiple: BUDGET_MULTIPLE,
  attempts,
  wanted: WANTED,
  found: {
    noise: failures.filter((f) => f.cause === "noise").length,
    regression: failures.filter((f) => f.cause === "regression").length,
  },
};

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "failures.json"), `${JSON.stringify(failures, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(out, "corpus.json"), `${JSON.stringify(corpus, null, 2)}\n`, "utf8");
fs.rmSync(subject.dir, { recursive: true, force: true });
fs.rmSync(control.dir, { recursive: true, force: true });

console.error(`wrote ${failures.length} failures to ${out}`);
for (const f of failures) console.error(`  ${f.id}: ${f.cause} — ${f.measured}ms of ${f.runs.join("/")}`);
