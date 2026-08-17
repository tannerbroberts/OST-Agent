/**
 * Can a history-based perf gate say what conditions its own stored
 * measurements came from?
 *
 * "Compare against the recent history of this same gate on this same machine"
 * proposes replacing an absolute threshold with a distribution built from a
 * gate's own past runs. That only works if the past runs are comparable — same
 * machine, similar load — and today nothing checks that; a run is just a
 * number. This module is the read-side of that check: given whatever timing
 * measurements this project has already retained, can each one be traced to
 * the machine and condition it was taken under, and does the retained history
 * even span more than one machine?
 *
 * The measurements read here are `test/fixtures/perf-gate-noise-band/`, cut by
 * `scripts/harvest-perf-noise-corpus.ts` — the only committed, machine-readable
 * store of real gate timings this repository has. Provenance is resolved "from
 * whatever the record holds" (the assumption test's own words): each failure
 * carries its own `condition`, and `corpus.json` carries the `machine` the
 * whole batch was taken on. No new benchmark runs happen here — this reads data
 * that already exists.
 */
import fs from "node:fs";
import path from "node:path";

/** One retained timing measurement, with whatever provenance can be recovered for it. */
export interface GateMeasurement {
  id: string;
  measuredMs: number;
  machine: string | undefined;
  condition: string | undefined;
}

interface StoredFailure {
  id: string;
  measured: number;
  condition: string;
}

interface StoredCorpus {
  machine: string;
  calibrationRuns: number[];
  calibrationControlRuns: number[];
}

/**
 * Load the retained corpus and attach the batch's machine to every measurement
 * in it — the failures (each already labelled with its own condition) plus the
 * raw calibration runs the recorded range was drawn from (labelled "idle
 * calibration", the condition `PROVENANCE.md` documents them under).
 */
export function loadRetainedMeasurements(fixtureDir: string): GateMeasurement[] {
  const failures: StoredFailure[] = JSON.parse(fs.readFileSync(path.join(fixtureDir, "failures.json"), "utf8"));
  const corpus: StoredCorpus = JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8"));

  const fromFailures: GateMeasurement[] = failures.map((f) => ({
    id: f.id,
    measuredMs: f.measured,
    machine: corpus.machine,
    condition: f.condition,
  }));

  const fromCalibration: GateMeasurement[] = corpus.calibrationRuns.map((ms, i) => ({
    id: `calibration-${i}`,
    measuredMs: ms,
    machine: corpus.machine,
    condition: "idle calibration",
  }));

  return [...fromFailures, ...fromCalibration];
}

/** A measurement whose machine and condition are both known. */
export function provenanceRecoverable(m: GateMeasurement): boolean {
  return m.machine !== undefined && m.condition !== undefined;
}

/** The fraction of measurements whose provenance is recoverable. */
export function provenanceRecoverableFraction(measurements: readonly GateMeasurement[]): number {
  if (measurements.length === 0) return 0;
  return measurements.filter(provenanceRecoverable).length / measurements.length;
}

/** Measurements grouped by the machine they were taken on. Undefined machines fall into "unknown". */
export function groupByMachine(measurements: readonly GateMeasurement[]): Map<string, GateMeasurement[]> {
  const groups = new Map<string, GateMeasurement[]>();
  for (const m of measurements) {
    const key = m.machine ?? "unknown";
    const group = groups.get(key) ?? [];
    group.push(m);
    groups.set(key, group);
  }
  return groups;
}

function spread(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

/** The spread of measurements within a single machine's own readings, averaged over every machine present. */
export function withinMachineSpread(measurements: readonly GateMeasurement[]): number {
  const groups = [...groupByMachine(measurements).values()];
  const spreads = groups.filter((g) => g.length > 0).map((g) => spread(g.map((m) => m.measuredMs)));
  return spreads.reduce((a, b) => a + b, 0) / spreads.length;
}

/**
 * The spread across machines' own central tendencies (median), or `undefined`
 * when fewer than two machines are represented — the comparison the second
 * half of the assumption's threshold needs and this retained history cannot
 * yet supply.
 */
export function acrossMachineSpread(measurements: readonly GateMeasurement[]): number | undefined {
  const groups = [...groupByMachine(measurements).values()];
  if (groups.length < 2) return undefined;
  const medians = groups.map((g) => {
    const sorted = [...g.map((m) => m.measuredMs)].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  });
  return spread(medians);
}
