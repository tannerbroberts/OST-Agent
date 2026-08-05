/**
 * How many parents does each node have?
 *
 * The OST hierarchy already constrains which LAYER may parent which, but it has
 * never constrained the COUNT: `ost_link_nodes` is idempotent per edge and says
 * nothing about a second edge from a different parent, and `checkInvariants`
 * asks only that a node have *at least one* correctly-layered parent. So a tree
 * can be perfectly legal and still be a DAG rather than a tree.
 *
 * This reports every node with more than one parent, grouped by layer, with the
 * parents named — because deciding which edge to keep is a judgement per node
 * and the titles are what that judgement is made on.
 */
import { Vault } from "../src/ost/vault.js";
import type { OstNode } from "../src/ost/node.js";

const dir = process.argv[2];
if (!dir) throw new Error("usage: audit-meta-vault-parents.ts <vault>");
const verbose = process.argv.includes("--verbose");

const tree = new Vault(dir, { create: false }).readTree();
const index = new Map<string, OstNode>(tree.map((n) => [n.title, n]));

const parents = new Map<string, string[]>();
for (const n of tree) {
  for (const l of n.links) {
    if (!index.has(l)) continue;
    (parents.get(l) ?? parents.set(l, []).get(l)!).push(n.title);
  }
}

const multi = tree
  .filter((n) => (parents.get(n.title)?.length ?? 0) > 1)
  .sort((a, b) => (parents.get(b.title)!.length - parents.get(a.title)!.length) || a.title.localeCompare(b.title));

const byLayer = new Map<string, number>();
for (const n of multi) byLayer.set(n.layer, (byLayer.get(n.layer) ?? 0) + 1);

const rootless = tree.filter((n) => n.layer !== "Outcome" && !(parents.get(n.title)?.length));

console.log(`nodes: ${tree.length}`);
console.log(`multi-parent: ${multi.length}`, Object.fromEntries(byLayer));
console.log(`no parent (excluding the Outcome): ${rootless.length}`);
// Total extra edges = how many must be cut to make this a tree.
const extra = multi.reduce((a, n) => a + parents.get(n.title)!.length - 1, 0);
console.log(`edges to cut for a strict tree: ${extra}`);

if (verbose) {
  for (const n of multi) {
    console.log(`\n[${n.layer}] ${n.title}`);
    for (const p of parents.get(n.title)!) console.log(`    ← [${index.get(p)!.layer}] ${p}`);
  }
}
