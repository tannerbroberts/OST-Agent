/**
 * Re-derive the unknown-context corpus from a vault's real `runs.jsonl`.
 *
 * The fixture at `test/fixtures/unknown-context-price/runs-current.jsonl` holds
 * the newest runs of a vault's loop health ledger, enough to cover the hundred
 * steps "Measure how much signal a refuse-on-unknown-context rule would delete"
 * counts over — see that directory's PROVENANCE.md for the cut and for the second,
 * legacy corpus beside it. This script re-runs the mechanical extraction, so the
 * projection can be regenerated and checked against the raw ledger rather than
 * trusted:
 *
 *   npx tsx scripts/harvest-unknown-context-corpus.ts /path/to/vault
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact, and
 * `test/telemetry/unknown-context-refusal-cost.test.ts` re-checks it against the
 * live ledger wherever one is reachable.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../src/adapters/transcript.js";
import { gitFollowUpSight } from "../src/git/follow-up-sight.js";
import { readRuns, type LoopStepRecord } from "../src/loop/health.js";
import { CONTEXT_READINGS } from "../src/telemetry/step-context.js";
import {
  censusUnknownContext,
  formatUnknownContextCensus,
  stepsNewestFirst,
  traceActedOn,
  CENSUS_WINDOW,
} from "../src/telemetry/unknown-context-census.js";

/**
 * Long enough to keep a command recognisable, short enough that the corpus is a
 * fixture rather than a 42 MB copy of the ledger — nearly all of which is the
 * `claude -p "<the whole brief>"` string on every `pass` step.
 *
 * The cap cannot move a count. The predicate reads whether `cwd` is present and
 * absolute, whether `argv` is present and non-empty, and whether `command` is
 * non-empty; truncating a present string leaves it present and non-empty.
 */
const TEXT_CAP = 160;

function reduce(raw: string): string {
  const flat = redactSecrets(raw);
  return flat.length > TEXT_CAP ? `${flat.slice(0, TEXT_CAP)}…[truncated ${flat.length - TEXT_CAP} chars]` : flat;
}

async function main(): Promise<void> {
  const vaultDir = process.argv[2];
  if (!vaultDir) {
    console.error("usage: npx tsx scripts/harvest-unknown-context-corpus.ts /path/to/vault");
    process.exitCode = 1;
    return;
  }
  // `readRuns` already sorts newest-first. Take whole runs from that end until the
  // census window is covered, so no run is half-present — a partial run would make
  // the projection's step order differ from the ledger's.
  const kept: { runId: string; startedAt: string; cliVersion: string; verdict?: string; steps: Partial<LoopStepRecord>[] }[] = [];
  let steps = 0;
  for (const run of readRuns(vaultDir)) {
    kept.push({
      runId: run.runId,
      startedAt: run.startedAt,
      cliVersion: run.cliVersion,
      ...(run.verdict ? { verdict: run.verdict } : {}),
      steps: run.steps.map((step) => ({
        phase: step.phase,
        command: reduce(step.command),
        ...(step.argv ? { argv: step.argv.map(reduce) } : {}),
        ...(step.cwd !== undefined ? { cwd: step.cwd } : {}),
        exit: step.exit,
        durationMs: step.durationMs,
        at: step.at,
        ...(step.refused ? { refused: step.refused } : {}),
      })),
    });
    steps += run.steps.length;
    if (steps >= CENSUS_WINDOW) break;
  }
  const outPath = path.join(import.meta.dirname, "../test/fixtures/unknown-context-price/runs-current.jsonl");
  fs.writeFileSync(outPath, kept.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`wrote ${kept.length} run(s), ${steps} step(s) to ${outPath}`);

  // And run the census the cut exists for, over the untruncated ledger, printing
  // the price at cut time. Not decoration: a corpus regenerated without anyone
  // looking at what it now says is a corpus that can drift under a stale finding,
  // and the number is what a person re-reads the node against.
  const all = stepsNewestFirst(readRuns(vaultDir));
  const sight = gitFollowUpSight(vaultDir);
  for (const reading of CONTEXT_READINGS) {
    const census = censusUnknownContext(all, reading);
    console.log(formatUnknownContextCensus(path.basename(path.resolve(vaultDir)), census, await traceActedOn(census, all, sight)));
  }
}

await main();
