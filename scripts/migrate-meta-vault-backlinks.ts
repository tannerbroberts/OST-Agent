/**
 * One backlink per node: every title is `[[wikilinked]]` exactly once in the
 * whole vault, by its parent, and mentioned everywhere else as plain text.
 *
 * `single-parent` was not enough, and the gap is worth stating precisely.
 * That rule counts EDGES — the contiguous `[[…]]` lines directly under the tag
 * line, which is all `Vault.readTree()` returns as `links`. A wikilink written
 * inside a paragraph is not an edge by that definition, so the tree could be a
 * perfect one-parent tree while a node was still linked from fifteen other
 * files. Obsidian's graph does not make that distinction: it draws every
 * wikilink it finds, wherever it sits. A grep for a filename should find one
 * hit, and it found 2,214 across 920 nodes.
 *
 * **Nothing is deleted.** A surplus `[[Some node]]` becomes `"Some node"`, so
 * the sentence still says what it said and still names what it named — it just
 * stops being an edge. Three places this touches, and each is a deliberate call:
 *
 *   - **`## Definition of done`** (220). The ruleset used to require this link:
 *     "a definition of done kept one node away is a definition of done nobody
 *     reads." The requirement stands; the wikilink does not. The title is still
 *     printed, and the instrument command beneath it is unchanged.
 *   - **`## History`** (703). Append-only means the record may not be rewritten
 *     or removed, and this does neither: the dated line keeps every word. Only
 *     the bracket syntax changes, so provenance is intact and the graph stops
 *     showing a node's own re-parenting as an inbound edge.
 *   - **Body prose and `## Issues`** (263). Cross-references — "this tree
 *     already carries a whole opportunity about X", "possible duplicate of Y".
 *     These are the real cost: they were genuinely useful as links, and they are
 *     exactly what the one-backlink rule forbids.
 *
 * Dry-run by default; pass --apply to write.
 */
import fs from "node:fs";
import path from "node:path";
import { Vault } from "../src/ost/vault.js";
import type { OstNode } from "../src/ost/node.js";

const WIKILINK = /\[\[([^\]|#]+?)(?:([|#])([^\]]*))?\]\]/g;

/** The line range the parser reads as this file's child edges. */
function edgeRange(lines: string[], raw: string): [number, number] {
  const bodyStart = raw.startsWith("---") ? lines.indexOf("---", 1) + 1 : 0;
  let start = bodyStart;
  while (start < lines.length && lines[start].trim() === "") start++;
  if (lines[start]?.trimStart().startsWith("#")) start++; // the tag line
  let end = start;
  while (end < lines.length && /^\s*\[\[[^\]]+\]\]\s*$/.test(lines[end])) end++;
  return [start, end];
}

function main(): void {
  const dir = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!dir) throw new Error("usage: migrate-meta-vault-backlinks.ts <vault> [--apply]");

  const tree = new Vault(dir, { create: false }).readTree();
  const index = new Map<string, OstNode>(tree.map((n) => [n.title, n]));

  let filesTouched = 0;
  let delinked = 0;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    const lines = raw.split("\n");
    const [edgeStart, edgeEnd] = edgeRange(lines, raw);
    let changed = false;

    for (let i = 0; i < lines.length; i++) {
      if (i >= edgeStart && i < edgeEnd) continue; // the one edge block — untouched
      const before = lines[i];
      lines[i] = before.replace(WIKILINK, (whole, target: string, sep: string | undefined, rest: string | undefined) => {
        // Only real nodes are backlinks. `[[wiki-link]]`, `[[X]]` and other
        // prose placeholders resolve to nothing and are left exactly as they are.
        if (!index.has(target.trim())) return whole;
        // An alias is what the sentence chose to call it — keep the reader's words.
        const shown = sep === "|" && rest?.trim() ? rest.trim() : target.trim();
        delinked++;
        return `"${shown}"`;
      });
      if (lines[i] !== before) changed = true;
    }

    if (!changed) continue;
    filesTouched++;
    if (apply) fs.writeFileSync(path.join(dir, file), lines.join("\n"), "utf8");
  }

  console.log(`${delinked} surplus wikilink(s) de-linked across ${filesTouched} file(s)`);
  if (!apply) console.log("dry run — pass --apply to write");
}

main();
