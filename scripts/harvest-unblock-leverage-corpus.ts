/**
 * Cut the unblock-leverage graph out of a vault.
 *
 * Run by hand, output committed under `test/fixtures/unblock-leverage/`. It
 * exists so the distribution `test/rank/unblock-leverage-distribution.test.ts`
 * measures is a snapshot anyone can re-cut and disagree with, rather than a
 * reading of a path only the maintainer's machine has. See that directory's
 * `PROVENANCE.md` for what the numbers came out as and what they do not settle.
 *
 *   npx tsx scripts/harvest-unblock-leverage-corpus.ts /Users/tanner/ost-agent-meta test/fixtures/unblock-leverage
 *
 * **Nothing is inferred here.** Every field is read off the vault by the same
 * functions the product uses — `resolveTestsUnderSolution` for coverage,
 * `prerequisiteEdges` for declared ordering, `hasRecordedResult` for whether a
 * test is answered. The script's whole job is to reduce 1,596 markdown files to
 * the four lists the computation needs, so that a re-cut against a later vault
 * changes the *fixture* and shows up as a changed expectation rather than as a
 * quietly different finding.
 *
 * Nothing in `src/` imports this. The fixture is the artefact.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { hasRecordedResult } from "../src/eval/evidence-debt.js";
import { resolveTestsUnderSolution } from "../src/ost/legacy-fallback.js";
import { prerequisiteEdges } from "../src/ost/prerequisites.js";
import { Vault } from "../src/ost/vault.js";
import {
  formatLeverageSweep,
  sweepReadings,
  type BranchFacts,
  type CandidateFacts,
  type LeverageGraph,
  type TestFacts,
} from "../src/ost/unblock-leverage.js";
import type { OstNode } from "../src/ost/node.js";

/** The committed graph, plus the provenance a reader needs to trust or re-cut it. */
export interface HarvestedGraph extends LeverageGraph {
  vault: string;
  /** The vault's git HEAD at harvest, so the cut is reproducible. */
  head: string;
  harvestedAt: string;
  /** Node counts by layer, asserted by the test so a re-cut cannot silently become a sample. */
  layers: Record<string, number>;
}

/**
 * Every assumption test transitively beneath an opportunity.
 *
 * Walks whatever links it finds rather than assuming the Opportunity →
 * Solution → Assumption → AssumptionTest shape, because this vault predates the
 * Assumption layer in places and a strict walk would silently under-count the
 * un-migrated branches. `seen` is per-call, so a node reachable twice within one
 * branch is counted once — but a test beneath two *different* opportunities is
 * counted for each, which is the double-count the branch reading is reported
 * with and never separated from.
 */
function testsBeneath(root: OstNode, index: Map<string, OstNode>): string[] {
  const seen = new Set<string>([root.title]);
  const out: string[] = [];
  const stack = [...root.links];
  while (stack.length > 0) {
    const title = stack.pop()!;
    if (seen.has(title)) continue;
    seen.add(title);
    const node = index.get(title);
    if (!node) continue;
    if (node.layer === "AssumptionTest") out.push(node.title);
    else stack.push(...node.links);
  }
  return out.sort();
}

function harvest(vaultDir: string): HarvestedGraph {
  const vault = new Vault(vaultDir, { create: false });
  const tree = vault.readTree();
  const index = new Map(tree.map((n) => [n.title, n]));

  const layers: Record<string, number> = {};
  for (const n of tree) layers[n.layer] = (layers[n.layer] ?? 0) + 1;

  const tests: TestFacts[] = tree
    .filter((n) => n.layer === "AssumptionTest")
    .map((t) => ({
      title: t.title,
      hasResult: hasRecordedResult(t),
      hasInstrument: typeof t.instrument === "string" && t.instrument.trim().length > 0,
      hasThreshold: typeof t.threshold === "string" && t.threshold.trim().length > 0,
    }));

  const candidates: CandidateFacts[] = tree
    .filter((n) => n.layer === "Solution")
    .map((s) => ({
      title: s.title,
      status: s.status,
      coverage: resolveTestsUnderSolution(s, index)
        .map((r) => r.test.title)
        .sort(),
    }));

  const branches: BranchFacts[] = tree
    .filter((n) => n.layer === "Opportunity")
    .map((o) => ({ title: o.title, tests: testsBeneath(o, index) }));

  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: vaultDir, encoding: "utf8" }).trim();

  return {
    vault: vaultDir,
    head,
    harvestedAt: new Date().toISOString().slice(0, 10),
    layers,
    tests,
    candidates,
    branches,
    prerequisites: prerequisiteEdges(tree),
  };
}

const [vaultDir, outDir] = process.argv.slice(2);
if (!vaultDir || !outDir) {
  console.error("usage: harvest-unblock-leverage-corpus.ts <vault-dir> <out-dir>");
  process.exit(2);
}

const graph = harvest(vaultDir);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "graph.json"), `${JSON.stringify(graph, null, 2)}\n`);
console.error(
  `harvested ${graph.candidates.length} candidates, ${graph.tests.length} tests, ` +
    `${graph.prerequisites.length} prerequisite edges from ${vaultDir} @ ${graph.head.slice(0, 8)}`,
);
// The verdict is printed at cut time, not left to be discovered later. Whoever
// re-cuts this corpus against a changed vault sees immediately whether the bar
// moved, so a re-harvest cannot quietly replace a refutation with a pass — or a
// pass with a refutation — while the assertions in the spec are updated to match
// whatever came out.
console.error(formatLeverageSweep(sweepReadings(graph)));
