/**
 * "Replay the stored measurements and check whether they came from comparable
 * conditions" — the AssumptionTest beneath "Compare against the recent history
 * of this same gate on this same machine".
 *
 * A history-based gate is only as good as its history's provenance. This
 * replays `test/fixtures/perf-gate-noise-band/` — the only committed,
 * machine-readable store of real gate timings this project retains — and
 * checks the precondition for comparing against history at all: does every
 * stored measurement carry enough recorded context (a machine, a condition) to
 * say whether it is a fair baseline?
 *
 * It does not settle the harder question the solution node itself defers:
 * whether the threshold drawn from this history would be *right*. See
 * `src/eval/gate-condition-comparability.ts` for what "recoverable" means here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  acrossMachineSpread,
  groupByMachine,
  loadRetainedMeasurements,
  provenanceRecoverableFraction,
  withinMachineSpread,
} from "../../src/eval/gate-condition-comparability.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "perf-gate-noise-band");

const measurements = loadRetainedMeasurements(fixtureDir);

test("the retained corpus is non-empty, so the check below is over real measurements", () => {
  expect(measurements.length).toBeGreaterThan(0);
});

test("provenance is recoverable for at least 80% of stored measurements — the threshold's first half", () => {
  const fraction = provenanceRecoverableFraction(measurements);
  expect(fraction).toBeGreaterThanOrEqual(0.8);
});

test("every measurement traces to a machine string, read from corpus.json's own machine field", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8"));
  for (const m of measurements) {
    expect(m.machine).toBe(raw.machine);
  }
});

/**
 * This is the finding, not a formality: the assumption test's threshold also
 * needs within-machine spread under half of across-machine spread, and this
 * repository's only retained gate history has never spanned a second machine.
 * `acrossMachineSpread` returns `undefined` rather than a number that would
 * quietly pass any comparison — the second half of the threshold is not yet
 * decidable from what this project has recorded, which is exactly the case the
 * assumption test's own "what it will not cover" section names.
 */
test("the retained history spans exactly one machine, so the across-machine half of the threshold is not yet computable", () => {
  const groups = groupByMachine(measurements);
  expect(groups.size).toBe(1);
  expect(acrossMachineSpread(measurements)).toBeUndefined();
});

test("within-machine spread is at least computable from what is retained today", () => {
  expect(withinMachineSpread(measurements)).toBeGreaterThan(0);
});
