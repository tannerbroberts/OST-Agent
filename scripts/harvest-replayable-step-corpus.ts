/**
 * Cut the replayable-step corpus from a vault's real `runs.jsonl`.
 *
 * The fixture at `test/fixtures/replayable-steps/steps.json` holds EVERY step
 * recorded in a thirty-day window — not a sample, not the failures, not a
 * curated ten. The assumption test beneath "Replay a recorded failure in its
 * recorded context on demand" asks what share of recorded steps a fixed rule
 * clears, and any selection applied on the way in is a thumb on that share.
 *
 *   npx tsx scripts/harvest-replayable-step-corpus.ts /path/to/vault 2026-09-01
 *
 * The second argument is the window's exclusive end, so the cut is repeatable:
 * without it the corpus would move every time anyone re-ran the script.
 *
 * Nothing here is imported by src/ or by a test, and nothing here classifies
 * anything — `src/loop/replayable.ts` holds the rule and was committed before
 * this script existed. The fixture is the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../src/adapters/transcript.js";
import { readRuns } from "../src/loop/health.js";

const ARGV_ELEMENT_CAP = 200;
const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Redacted and length-capped — several recorded steps are `claude -p <prompt>`
 * invocations tens of kilobytes long. The cap is applied from the END of each
 * element, so the head the rule reads (the verb, its subcommand and its first
 * flags) always survives intact. */
function reduceArgvElement(raw: string): string {
  const flat = redactSecrets(raw);
  return flat.length > ARGV_ELEMENT_CAP
    ? `${flat.slice(0, ARGV_ELEMENT_CAP)}…[truncated ${flat.length - ARGV_ELEMENT_CAP} chars]`
    : flat;
}

function main(): void {
  const [vaultDir, cutAt] = process.argv.slice(2);
  if (!vaultDir || !cutAt) {
    console.error("usage: npx tsx scripts/harvest-replayable-step-corpus.ts /path/to/vault <YYYY-MM-DD>");
    process.exitCode = 1;
    return;
  }
  const endMs = Date.parse(`${cutAt}T00:00:00.000Z`);
  if (Number.isNaN(endMs)) {
    console.error(`unparseable cut date: ${cutAt}`);
    process.exitCode = 1;
    return;
  }
  const startMs = endMs - WINDOW_DAYS * DAY_MS;

  const runs = readRuns(vaultDir);
  const steps = runs
    .flatMap((run) => run.steps.map((step) => ({ runId: run.runId, step })))
    .filter(({ step }) => {
      const at = Date.parse(step.at);
      return !Number.isNaN(at) && at >= startMs && at < endMs;
    })
    .sort((a, b) => Date.parse(a.step.at) - Date.parse(b.step.at))
    .map(({ runId, step }) => ({
      runId,
      phase: step.phase,
      command: reduceArgvElement(step.command),
      argv: step.argv?.map(reduceArgvElement),
      cwd: step.cwd,
      exit: step.exit,
      at: step.at,
      ...(step.refused ? { refused: step.refused } : {}),
    }));

  const outDir = path.join(import.meta.dirname, "../test/fixtures/replayable-steps");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "steps.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        windowDays: WINDOW_DAYS,
        windowStart: new Date(startMs).toISOString(),
        windowEnd: new Date(endMs).toISOString(),
        steps,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${steps.length} steps to ${outPath}`);
}

main();
