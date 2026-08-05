/**
 * Every node title must appear in exactly ONE `[[wikilink]]` anywhere in the vault.
 *
 * This is a stricter rule than `single-parent`, and the difference is the whole
 * point. `single-parent` counts structural edges — the contiguous link lines
 * directly under the tag line, which is all `Vault.readTree()` returns as
 * `links`. A `[[Some node]]` written inside a paragraph is not an edge by that
 * definition, so a tree can be a perfect one-parent tree and still have a node
 * mentioned in fifteen other nodes' prose.
 *
 * For a reader — and for Obsidian's graph, which draws every wikilink it finds
 * regardless of where it sits — those mentions ARE links. A grep for a filename
 * should find exactly one hit: its parent. That is what this measures.
 *
 * Counts `[[Title]]`, `[[Title|alias]]` and `[[Title#heading]]`, matched against
 * the sanitized title each file is keyed by, so an alias cannot hide a mention.
 */
import fs from "node:fs";
import path from "node:path";
import { Vault } from "../src/ost/vault.js";
import type { OstNode } from "../src/ost/node.js";

const dir = process.argv[2];
if (!dir) throw new Error("usage: audit-meta-vault-backlinks.ts <vault>");
const verbose = process.argv.includes("--verbose");

const tree = new Vault(dir, { create: false }).readTree();
const index = new Map<string, OstNode>(tree.map((n) => [n.title, n]));

/** Every wikilink in the file, with the line it sits on and whether it is a structural edge. */
interface Mention {
  target: string;
  inFile: string;
  line: number;
  /** True when it is one of the contiguous link lines the tree reads as an edge. */
  structural: boolean;
  /** The `##` section the mention sits under, or `(edge)`. */
  where: string;
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
const mentions: Mention[] = [];

for (const file of files) {
  const raw = fs.readFileSync(path.join(dir, file), "utf8");
  const title = file.slice(0, -3);
  const node = index.get(title);
  const lines = raw.split("\n");
  // Replicate the parser: after the frontmatter, the first content line is the
  // tag line and the contiguous `[[…]]` lines after it are the edges. Anything
  // further down is prose, however it is punctuated.
  const bodyStart = raw.startsWith("---") ? lines.indexOf("---", 1) + 1 : 0;
  let cursor = bodyStart;
  while (cursor < lines.length && lines[cursor].trim() === "") cursor++;
  if (lines[cursor]?.trimStart().startsWith("#")) cursor++; // the tag line
  let edgeEnd = cursor;
  while (edgeEnd < lines.length && /^\s*\[\[[^\]]+\]\]\s*$/.test(lines[edgeEnd])) edgeEnd++;
  let heading = "";
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^(##+ .*)$/);
    if (h) heading = h[1].trim();
    for (const m of lines[i].matchAll(/\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]/g)) {
      const target = m[1].trim();
      if (!index.has(target)) continue; // not a node — reported separately
      mentions.push({
        target,
        inFile: title,
        line: i + 1,
        structural: i >= cursor && i < edgeEnd,
        where: i >= cursor && i < edgeEnd ? "(edge)" : heading || "(body)",
      });
    }
  }
}

const byTarget = new Map<string, Mention[]>();
for (const m of mentions) {
  const list = byTarget.get(m.target);
  if (list) list.push(m);
  else byTarget.set(m.target, [m]);
}

const outcome = tree.find((n) => n.layer === "Outcome")!;
const offenders = tree
  .filter((n) => n.title !== outcome.title)
  .map((n) => ({ node: n, hits: byTarget.get(n.title) ?? [] }))
  .filter((x) => x.hits.length !== 1)
  .sort((a, b) => b.hits.length - a.hits.length);

const surplus = offenders.reduce((a, o) => a + Math.max(0, o.hits.length - 1), 0);
const byLayer = new Map<string, number>();
for (const o of offenders) byLayer.set(o.node.layer, (byLayer.get(o.node.layer) ?? 0) + 1);

console.log(`nodes: ${tree.length}   wikilink mentions resolving to a node: ${mentions.length}`);
console.log(`nodes whose title is NOT mentioned exactly once: ${offenders.length}`, Object.fromEntries(byLayer));
console.log(`surplus mentions to remove: ${surplus}`);
const surplusHits = offenders.flatMap((o) => {
  const edges = o.hits.filter((h) => h.structural);
  const keep = edges[0] ?? o.hits[0];
  return o.hits.filter((h) => h !== keep);
});
const bySection = new Map<string, number>();
for (const h of surplusHits) bySection.set(h.where, (bySection.get(h.where) ?? 0) + 1);
console.log("surplus by where it sits:");
for (const [k, v] of [...bySection].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);

if (verbose) {
  for (const o of offenders) {
    console.log(`\n[${o.node.layer}] ${o.node.title}  — ${o.hits.length} mention(s)`);
    for (const h of o.hits) console.log(`    ${h.structural ? "EDGE " : "prose"}  ${h.inFile}:${h.line}`);
  }
}
