/**
 * Shared helpers over the tree and the vault's `.ost-agent/` sidecar state:
 * evidence capture, the P2 "mapped" set, and layer-aware child counting.
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { Layer, OstNode } from "../ost/node.js";

export interface EvidenceRecord {
  id: string;
  source: string;
  title: string;
  timestamp: string;
  body: string;
}

function evidenceDir(dir: string): string {
  return path.join(dir, ".ost-agent", "evidence");
}
function stateFile(dir: string, name: string): string {
  return path.join(dir, ".ost-agent", "state", name);
}
function safeName(id: string): string {
  return id.replace(/\.(md|txt|markdown)$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

/** Persist an evidence item as a provenance-tagged Markdown file (idempotent). */
export function writeEvidence(dir: string, rec: EvidenceRecord): boolean {
  const d = evidenceDir(dir);
  fs.mkdirSync(d, { recursive: true });
  const p = path.join(d, `${safeName(rec.id)}.md`);
  if (fs.existsSync(p)) return false;
  const content = matter.stringify(rec.body.trim() + "\n", {
    id: rec.id,
    source: rec.source,
    title: rec.title,
    timestamp: rec.timestamp,
  });
  fs.writeFileSync(p, content, "utf8");
  return true;
}

/** Read all captured evidence records. */
export function readEvidence(dir: string): EvidenceRecord[] {
  const d = evidenceDir(dir);
  if (!fs.existsSync(d)) return [];
  const out: EvidenceRecord[] = [];
  for (const name of fs.readdirSync(d)) {
    if (!name.endsWith(".md")) continue;
    const parsed = matter(fs.readFileSync(path.join(d, name), "utf8"));
    const data = parsed.data as Record<string, unknown>;
    out.push({
      id: String(data.id ?? name),
      source: String(data.source ?? ""),
      title: String(data.title ?? name.replace(/\.md$/, "")),
      timestamp: String(data.timestamp ?? ""),
      body: parsed.content.trim(),
    });
  }
  return out;
}

export function getMapped(dir: string): Set<string> {
  const p = stateFile(dir, "mapped.json");
  if (!fs.existsSync(p)) return new Set();
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as { mapped?: string[] };
    return new Set(parsed.mapped ?? []);
  } catch {
    return new Set();
  }
}

export function setMapped(dir: string, mapped: Set<string>): void {
  const p = stateFile(dir, "mapped.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ mapped: [...mapped] }, null, 2), "utf8");
}

/** Index a node list by title. */
export function byTitle(nodes: OstNode[]): Map<string, OstNode> {
  return new Map(nodes.map((n) => [n.title, n]));
}

/** Titles of a node's children that belong to a given layer. */
export function childrenOfLayer(node: OstNode, index: Map<string, OstNode>, layer: Layer): string[] {
  return node.links.filter((t) => index.get(t)?.layer === layer);
}
