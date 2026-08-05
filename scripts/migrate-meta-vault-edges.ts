/**
 * Remove every edge in a vault that the OST hierarchy does not support.
 *
 * The meta vault accumulated 249 of them — Solution→Solution "see also" links,
 * AssumptionTests pointing back up at Opportunities, the root Outcome holding
 * direct edges to Solutions and tests. Each reads as a parent→child edge to
 * every walk in this repository (`subtree`, `rollup`, `lineage`), so a "related
 * to" link a human meant as a cross-reference is counted as structure.
 *
 * The legal set is the hierarchy itself. Note Solution→AssumptionTest is legal
 * HERE and removed by the interpose pass instead: this script only deletes
 * edges nothing should ever have drawn, and an un-migrated direct test edge is
 * still a real parent→child relation until its Assumption exists.
 *
 * Every removal writes a dated line into the parent's `## History` through
 * `Vault.detach`, so the tree records what went and why. Dry-run by default;
 * pass --apply to write.
 */
import { Vault } from "../src/ost/vault.js";
import type { Layer, OstNode } from "../src/ost/node.js";

const LEGAL = new Set<string>([
  "Outcome>Opportunity",
  "Opportunity>Opportunity",
  "Opportunity>Solution",
  "Solution>Assumption",
  "Solution>AssumptionTest", // legacy, removed by the interpose pass
  "Assumption>AssumptionTest",
]);

/** An Unknown attaches under any layer, and nothing attaches under it. */
const isUnknownEdge = (from: Layer, to: Layer): boolean => to === "Unknown" || from === "Unknown";

const WHY =
  "not a parent-child relation the OST hierarchy supports — every tree walk counted it as structure, " +
  "so a cross-reference read as a child";

function main(): void {
  const dir = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!dir) throw new Error("usage: migrate-meta-vault-edges.ts <vault> [--apply]");

  const vault = new Vault(dir, { create: false });
  const tree = vault.readTree();
  const index = new Map<string, OstNode>(tree.map((n) => [n.title, n]));

  const doomed: { parent: string; child: string; from: Layer; to: Layer }[] = [];
  for (const node of tree) {
    for (const link of node.links) {
      const child = index.get(link);
      if (!child) continue; // dangling — `check` reports it; deleting it is a different call
      if (isUnknownEdge(node.layer, child.layer)) continue;
      if (LEGAL.has(`${node.layer}>${child.layer}`)) continue;
      doomed.push({ parent: node.title, child: child.title, from: node.layer, to: child.layer });
    }
  }

  const byKind = new Map<string, number>();
  for (const d of doomed) byKind.set(`${d.from}→${d.to}`, (byKind.get(`${d.from}→${d.to}`) ?? 0) + 1);
  for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`  ${kind.padEnd(34)} ${n}`);
  console.log(`\n${doomed.length} illegal edge(s) over ${tree.length} node(s)`);

  // An edge whose child has no other legal parent would be orphaned by this —
  // reported rather than skipped, because an orphan is a repair a human makes
  // and a silent skip is a cleanup that quietly did not happen.
  const legalParents = (title: string): string[] =>
    tree.filter((p) => p.links.includes(title) && LEGAL.has(`${p.layer}>${index.get(title)!.layer}`)).map((p) => p.title);
  const orphaned = [...new Set(doomed.map((d) => d.child))].filter((c) => legalParents(c).length === 0);
  if (orphaned.length) {
    console.log(`\nWARNING — ${orphaned.length} node(s) would be left with no legal parent:`);
    for (const o of orphaned) console.log(`  ${index.get(o)!.layer.padEnd(15)} ${o}`);
  }

  if (!apply) {
    console.log("\ndry run — pass --apply to write");
    return;
  }
  for (const d of doomed) vault.detach(d.parent, d.child, WHY);
  console.log(`\napplied: ${doomed.length} edge(s) unlinked, each recorded in its parent's History`);
}

main();
