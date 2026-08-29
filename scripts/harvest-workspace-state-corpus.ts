/**
 * Cut the workspace-state coverage corpus out of this project's recorded failures.
 *
 * Run by hand, output committed to `test/fixtures/workspace-state-probe/`. It exists
 * so the cut is a rule anyone can re-run and disagree with, rather than a selection
 * somebody made — see that directory's `PROVENANCE.md` for the rule and its limits.
 *
 *   npx tsx scripts/harvest-workspace-state-corpus.ts test/fixtures/workspace-state-probe
 *
 * Unlike the workspace-map harvest, this one reads **no machine state at all**. Its
 * whole input is the committed `test/fixtures/path-failure-attribution/failures.jsonl`
 * — 719 failing tool calls already redacted and bounded — so it is reproducible on any
 * checkout, by anyone, forever. Starting there rather than re-reading transcripts also
 * means this census and the path-failure census cannot disagree about what failed.
 *
 * Nothing here is imported by src/ or by a test. The fixtures are the artefact.
 */
import fs from "node:fs";
import path from "node:path";
import type { FailingCall } from "../src/telemetry/path-failure-attribution.js";
import {
  classifyEnvironmentFailure,
  formatWorkspaceStateCensus,
  workspaceStateCoverage,
  WORKSPACE_STATE_RULE,
  type ClassifiedEnvironmentFailure,
} from "../src/runner/workspace-state-probe.js";

const [, , outArg] = process.argv;
if (!outArg) {
  console.error("usage: harvest-workspace-state-corpus.ts <out-dir>");
  process.exit(2);
}
const outDir = path.resolve(outArg);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const upstream = fs
  .readFileSync(path.join(repoRoot, "test/fixtures/path-failure-attribution/failures.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as FailingCall);

const classified: ClassifiedEnvironmentFailure[] = [];
const excludedCounts = new Map<string, number>();
let notEnvironment = 0;

for (const call of upstream) {
  const result = classifyEnvironmentFailure(call);
  if (result === null) {
    notEnvironment++;
    continue;
  }
  if ("excluded" in result) {
    excludedCounts.set(result.excluded, (excludedCounts.get(result.excluded) ?? 0) + 1);
    continue;
  }
  classified.push(result);
}

// Keep the excluded list in the rule's own order so the file is diffable.
const excluded = WORKSPACE_STATE_RULE.notAboutState
  .map(({ id }) => ({ id, n: excludedCounts.get(id) ?? 0 }))
  .filter((e) => e.n > 0);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "failures.json"), JSON.stringify(classified, null, 1) + "\n");

const meta = {
  upstreamFailures: upstream.length,
  environmentFailures: classified.length,
  stateShaped: classified.filter((c) => !c.pathShaped).length,
  pathShaped: classified.filter((c) => c.pathShaped).length,
  excluded: Object.fromEntries(excluded.map((e) => [e.id, e.n])),
  notEnvironment,
};
fs.writeFileSync(path.join(outDir, "corpus.json"), JSON.stringify(meta, null, 1) + "\n");

// Score once here too, so the harvest prints the number it just froze.
const census = workspaceStateCoverage(classified, { callsRead: upstream.length, excluded });
console.log(JSON.stringify(meta, null, 1));
console.log("");
console.log(formatWorkspaceStateCensus(census));
