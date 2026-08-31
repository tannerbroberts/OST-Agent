/**
 * Cut the recorded-decision corpus out of a vault.
 *
 * Run by hand, output committed under `test/fixtures/recorded-decisions/`. It
 * exists so the coverage `test/ost/recorded-decision-ordering.test.ts` measures
 * is a snapshot anyone can re-cut and disagree with, rather than a reading of a
 * path only the maintainer's machine has.
 *
 *   npx tsx scripts/harvest-recorded-decision-corpus.ts /Users/tanner/ost-agent-meta test/fixtures/recorded-decisions
 *
 * **Nothing is judged here.** The passages are whatever `extractDecisions` finds
 * and the row sets are read by the same functions the product uses —
 * `computeNextWork` for the under-served set, the Outcome node's own links for
 * the top-level set, the Opportunity layer for the widest. The script's whole
 * job is to reduce a vault of markdown to the lists the computation needs, so a
 * re-cut against a later vault changes the *fixture* and shows up as a changed
 * expectation rather than as a quietly different finding.
 *
 * The sweep is run and printed at cut time rather than only in the test, for the
 * reason `test/release/module-reachability.test.ts` records against the
 * unblock-leverage harvest: a script that only *imports* a module satisfies a
 * textual reachability walk while nothing ever executes it.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { computeNextWork } from "../src/mcp/next-work.js";
import { Vault } from "../src/ost/vault.js";
import {
  coverageOf,
  extractDecisions,
  formatDecisionSweep,
  type DecisionPassage,
} from "../src/ost/recorded-decisions.js";

/** The committed corpus, plus the provenance a reader needs to trust or re-cut it. */
export interface HarvestedDecisions {
  vault: string;
  /** The vault's git HEAD at harvest, so the cut is reproducible. */
  head: string;
  harvestedAt: string;
  /** Node counts by layer, asserted by the test so a re-cut cannot silently become a sample. */
  layers: Record<string, number>;
  passages: DecisionPassage[];
  /**
   * The three row sets, each a defensible reading of "the rows a ranking would
   * order". Committed together because the assumption test's denominator — 32
   * under-served rows — is the one thing about this measurement that has already
   * moved, and a corpus carrying only one reading would hide that it moved.
   */
  readings: {
    /** The assumption test's literal wording: opportunities with fewer than `min` solutions. */
    underserved: string[];
    /** The Outcome's own direct children — the rows the root's Prioritization section grades. */
    topLevel: string[];
    /** Every Opportunity in the tree. */
    allOpportunities: string[];
  };
}

/** `minSolutionsPerOpportunity`'s default, and what the meta vault's P3 process sets. */
const MIN_SOLUTIONS = 3;

function main(): void {
  const [vaultArg, outArg] = process.argv.slice(2);
  if (!vaultArg || !outArg) {
    console.error("usage: harvest-recorded-decision-corpus.ts <vault-dir> <out-dir>");
    process.exit(2);
  }
  const vaultDir = path.resolve(vaultArg);
  const outDir = path.resolve(outArg);

  const vault = new Vault(vaultDir, { create: false });
  const tree = vault.readTree();
  const layers: Record<string, number> = {};
  for (const n of tree) layers[n.layer] = (layers[n.layer] ?? 0) + 1;

  const root = tree.find((n) => n.layer === "Outcome");
  if (!root) throw new Error(`${vaultDir} holds no Outcome node — there is no tree to cut`);
  const opportunities = new Set(tree.filter((n) => n.layer === "Opportunity").map((n) => n.title));

  const corpus: HarvestedDecisions = {
    vault: vaultDir,
    head: execFileSync("git", ["-C", vaultDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    harvestedAt: new Date().toISOString().slice(0, 10),
    layers,
    passages: extractDecisions(tree),
    readings: {
      underserved: computeNextWork(vault, vaultDir, MIN_SOLUTIONS).underservedOpportunities.map((o) => o.title),
      topLevel: root.links.filter((t) => opportunities.has(t)),
      allOpportunities: [...opportunities],
    },
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "corpus.json"), JSON.stringify(corpus, null, 2) + "\n");

  console.log(
    formatDecisionSweep([
      coverageOf("underserved", corpus.readings.underserved, corpus.passages),
      coverageOf("top-level", corpus.readings.topLevel, corpus.passages),
      coverageOf("all-opportunities", corpus.readings.allOpportunities, corpus.passages),
    ]),
  );
  console.log(`wrote ${path.join(outDir, "corpus.json")} — ${corpus.passages.length} passage(s), HEAD ${corpus.head}`);
}

main();
