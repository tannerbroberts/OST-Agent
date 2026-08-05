/**
 * The meta vault's real link structure, read the way the product reads it.
 *
 * A file-level regex over `[[...]]` is NOT this: only the contiguous wikilink
 * lines directly under the tag line are edges (`src/ost/node.ts`), and every
 * node here carries prose that cites other nodes. Counting those as structure
 * overstated the illegal-edge count by two orders of magnitude the first time
 * this was measured.
 */
import { Vault } from "../src/ost/vault.js";
import type { OstNode } from "../src/ost/node.js";

const dir = process.argv[2];
if (!dir) throw new Error("usage: audit-meta-vault.ts <vault>");

const tree = new Vault(dir, { create: false }).readTree();
const index = new Map<string, OstNode>(tree.map((n) => [n.title, n]));

const byLayer = new Map<string, number>();
for (const n of tree) byLayer.set(n.layer, (byLayer.get(n.layer) ?? 0) + 1);
console.log("layers:", Object.fromEntries([...byLayer].sort((a, b) => b[1] - a[1])));

const edges = new Map<string, number>();
let dangling = 0;
for (const n of tree) {
  for (const l of n.links) {
    const c = index.get(l);
    if (!c) { dangling++; continue; }
    const k = `${n.layer}→${c.layer}`;
    edges.set(k, (edges.get(k) ?? 0) + 1);
  }
}
console.log("\nEDGES:");
for (const [k, v] of [...edges].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(34)} ${v}`);
console.log(`  ${"(dangling)".padEnd(34)} ${dangling}`);

const outcome = tree.find((n) => n.layer === "Outcome")!;
const tops = new Set(outcome.links.filter((l) => index.get(l)?.layer === "Opportunity"));
const kids = (n: OstNode): { o: number; s: number } => ({
  o: n.links.filter((l) => index.get(l)?.layer === "Opportunity").length,
  s: n.links.filter((l) => index.get(l)?.layer === "Solution").length,
});

const opps = tree.filter((n) => n.layer === "Opportunity");
const mixed = opps.filter((n) => { const k = kids(n); return k.o > 0 && k.s > 0; });
const buckets = opps.filter((n) => { const k = kids(n); return k.o > 0 && k.s === 0; });
const leaves = opps.filter((n) => { const k = kids(n); return k.o === 0 && k.s > 0; });
const childless = opps.filter((n) => { const k = kids(n); return k.o === 0 && k.s === 0; });

console.log(`\nOPPORTUNITIES (${opps.length}): ${buckets.length} pure bucket, ${leaves.length} pure leaf, ${mixed.length} MIXED, ${childless.length} childless`);
console.log(`top-level (off the Outcome): ${tops.size}`);
if (mixed.length) {
  console.log("\nMixed — holds both Opportunity and Solution children:");
  for (const m of mixed) {
    const k = kids(m);
    console.log(`  ${String(k.o).padStart(2)}opp/${String(k.s).padStart(2)}sol  ${tops.has(m.title) ? "[top] " : "      "}${m.title}`);
  }
}

const sols = tree.filter((n) => n.layer === "Solution");
const withDirectTests = sols.filter((s) => s.links.some((l) => index.get(l)?.layer === "AssumptionTest"));
console.log(`\nSOLUTIONS (${sols.length}): ${withDirectTests.length} link an AssumptionTest directly (the interpose pass's work)`);
const testCount = withDirectTests.reduce((a, s) => a + s.links.filter((l) => index.get(l)?.layer === "AssumptionTest").length, 0);
console.log(`  direct Solution→AssumptionTest edges: ${testCount}`);
