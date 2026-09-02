/**
 * Generate the startup workspace inventory for a directory, and take the
 * fit-and-coverage census over the committed path-failure corpus.
 *
 *   npx tsx scripts/report-workspace-inventory.ts [workspace-dir] [--inventory]
 *
 * `test/preflight/workspace-inventory-fits-and-covers.test.ts` pins this
 * measurement over *this* repository, which is the census's largest limit: one
 * workspace, one operator, and a conclusion about "an inventory of a large
 * repository" drawn from a single medium one. This script is how the same
 * measurement gets taken somewhere else — point it at another checkout and read
 * whether the fit half survives a tree with more in it.
 *
 * The corpus does not move when the workspace does, and that is the point of
 * running it this way rather than re-harvesting: the failures stay the ones this
 * project actually suffered, and what changes is how much of them a given
 * workspace's layout could ever have named. A repository large enough to breach
 * the budget while covering no more of the corpus is the result that would
 * settle the solution, and no argument from the sofa produces it.
 *
 * `--inventory` prints the artefact itself rather than the census, which is what
 * a run would be handed if the tree ever decides to hand it one. It does not
 * today: the census came out refuted and wiring a refuted artefact into every
 * pass's opening context is a decision for the vault, not for this script.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatInventoryCoverageCensus,
  generateWorkspaceInventory,
  inventoryCoverageCensus,
  renderWorkspaceInventory,
} from "../src/runner/workspace-inventory.js";
import type { FailingCall } from "../src/telemetry/path-failure-attribution.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const showInventory = args.includes("--inventory");
const target = path.resolve(args.find((a) => !a.startsWith("--")) ?? process.cwd());

if (!fs.existsSync(target)) {
  console.error(`no such workspace: ${target}`);
  process.exit(2);
}

const inventory = generateWorkspaceInventory(target);

if (showInventory) {
  console.log(renderWorkspaceInventory(inventory));
  process.exit(0);
}

const corpusFile = path.join(repoRoot, "test", "fixtures", "path-failure-attribution", "failures.jsonl");
const corpus = fs
  .readFileSync(corpusFile, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as FailingCall);

const census = inventoryCoverageCensus(corpus, inventory);
console.log(`Workspace: ${target}`);
console.log(`Corpus:    ${path.relative(repoRoot, corpusFile)} (${census.failures} failing call(s))`);
console.log("");
console.log(formatInventoryCoverageCensus(census));

// Green whichever way it came out. This prints a measurement; the verdict is in
// the text, and an exit code cannot carry the difference between "refuted" and
// "could not be taken".
