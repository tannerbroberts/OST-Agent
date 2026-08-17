/**
 * Report whether this project's retained gate-timing measurements carry
 * enough context to compare against as history.
 *
 * Run by hand, or by whatever eventually builds a history-based perf gate on
 * "Compare against the recent history of this same gate on this same
 * machine". `test/telemetry/gate-condition-comparability.test.ts` pins the
 * same read as a fixed assertion; this prints the numbers behind it, since a
 * plain exit code does not say what a machine or a spread looked like.
 *
 *   npx tsx scripts/check-gate-condition-comparability.ts test/fixtures/perf-gate-noise-band
 */
import path from "node:path";
import {
  acrossMachineSpread,
  groupByMachine,
  loadRetainedMeasurements,
  provenanceRecoverableFraction,
  withinMachineSpread,
} from "../src/eval/gate-condition-comparability.js";

const fixtureDir = path.resolve(process.argv[2] ?? "test/fixtures/perf-gate-noise-band");
const measurements = loadRetainedMeasurements(fixtureDir);
const machines = groupByMachine(measurements);
const across = acrossMachineSpread(measurements);

console.log(`${measurements.length} retained measurement(s) read from ${fixtureDir}`);
console.log(`provenance recoverable: ${(provenanceRecoverableFraction(measurements) * 100).toFixed(0)}%`);
console.log(`machines represented: ${[...machines.keys()].join(", ")} (${machines.size})`);
console.log(`within-machine spread: ${withinMachineSpread(measurements).toFixed(1)}ms`);
console.log(
  across === undefined
    ? "across-machine spread: not computable — fewer than two machines are represented in the retained history"
    : `across-machine spread: ${across.toFixed(1)}ms`,
);
