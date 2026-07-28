/**
 * Run the harness over the built-in environment set.
 *
 * A thin main() by design: `tsconfig.json` has `"include": ["src/**\/*"]`, so
 * tsc does not type-check `scripts/` — anything implemented here is code CI
 * never checks. All real logic lives in `src/harness/`.
 *
 * Deterministic: no dates, no randomness, stable ordering. The output is a pure
 * function of the environment set and the genome.
 *
 * Usage: `npm run harness -- <output-vault-dir>`. Each environment is planted
 * in its own throwaway temp vault; only the fitness records survive, appended
 * to `<output-vault-dir>/.ost-agent/harness/runs.jsonl`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeAttention } from "../src/eval/attention.js";
import { defaultGenome } from "../src/genome/load.js";
import { BUILT_IN_ENVIRONMENTS } from "../src/harness/environments.js";
import { assertComparable, computeFitness, type FitnessRecord } from "../src/harness/fitness.js";
import { recordRun } from "../src/harness/record.js";
import { runEnvironment } from "../src/harness/run.js";
import { Vault } from "../src/ost/vault.js";

/** Fixed, because a clock read here would make two identical populations differ. */
const RUN_AT = "2026-07-28T00:00:00.000Z";

function main(): void {
  const out = process.argv[2] ?? process.cwd();
  const genome = defaultGenome();
  const records: FitnessRecord[] = [];

  for (const spec of BUILT_IN_ENVIRONMENTS) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-harness-"));
    try {
      const run = runEnvironment({ spec, genome, dir, startedAt: RUN_AT });
      const rollup = computeAttention(new Vault(dir).readTree(), dir);
      const fitness = computeFitness({ run, rollup, spec });
      recordRun(out, fitness);
      records.push(fitness);
      process.stdout.write(
        `${spec.name}\t${fitness.status}\tfitness=${fitness.fitness.toFixed(4)}\tspend=${fitness.explorationSpend.toFixed(3)}\tbasis=${fitness.costBasis}\n`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // Fail loudly rather than quietly averaging incomparable measurements.
  assertComparable(records);
  process.stdout.write(`\n${records.length} run(s) → ${out}\n`);
}

// Run as a script, but stay importable by tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
