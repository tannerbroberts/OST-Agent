/**
 * Re-derive the record-replay corpus from a vault's real `runs.jsonl`.
 *
 * The fixture at `test/fixtures/record-replay/steps.json` holds the 10 most
 * recent non-zero-exit, non-refused steps from a real vault's loop health
 * ledger — see that directory's PROVENANCE.md for the cut. This script
 * re-runs the mechanical extraction so the corpus can be regenerated and
 * checked against the raw ledger instead of trusted:
 *
 *   npx tsx scripts/harvest-record-replay-corpus.ts /path/to/vault
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../src/adapters/transcript.js";
import { readRuns } from "../src/loop/health.js";
import { recentNonZeroExitSteps } from "../src/loop/replay.js";

const ARGV_ELEMENT_CAP = 200;

/** Redacted and length-capped, so a fixture element stays a real command shape
 * without carrying a full prompt (some recorded steps are `claude -p <prompt>`,
 * tens of kilobytes long) into the committed corpus. */
function reduceArgvElement(raw: string): string {
  const flat = redactSecrets(raw);
  return flat.length > ARGV_ELEMENT_CAP ? `${flat.slice(0, ARGV_ELEMENT_CAP)}…[truncated ${flat.length - ARGV_ELEMENT_CAP} chars]` : flat;
}

function main(): void {
  const vaultDir = process.argv[2];
  if (!vaultDir) {
    console.error("usage: npx tsx scripts/harvest-record-replay-corpus.ts /path/to/vault");
    process.exitCode = 1;
    return;
  }
  const runs = readRuns(vaultDir);
  const steps = recentNonZeroExitSteps(runs, 10).map((step) => ({
    phase: step.phase,
    command: reduceArgvElement(step.command),
    argv: step.argv?.map(reduceArgvElement),
    cwd: step.cwd,
    exit: step.exit,
    durationMs: step.durationMs,
    at: step.at,
  }));
  const outPath = path.join(import.meta.dirname, "../test/fixtures/record-replay/steps.json");
  fs.writeFileSync(outPath, JSON.stringify({ steps }, null, 2) + "\n");
  console.log(`wrote ${steps.length} steps to ${outPath}`);
}

main();
