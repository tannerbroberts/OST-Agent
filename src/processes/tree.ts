/**
 * Shared helpers over the tree and the vault's `.ost-agent/` sidecar state:
 * evidence capture, the P2 "mapped" set, and layer-aware child counting.
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { redactSecrets } from "../adapters/transcript.js";
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

/**
 * Persist an evidence item as a provenance-tagged Markdown file (idempotent).
 *
 * Redaction happens HERE rather than in each adapter, because this is the single
 * funnel every evidence record passes through on its way to a file `git add -A`
 * will stage and the unattended script will push — the same argument
 * `assertWritableContent` won at the node-write boundary. Per-adapter redaction is
 * fail-open by construction and had already failed that way: four body-carrying
 * paths called `redactSecrets` and `InboxSource` did not, so the untrusted
 * builder's *only* channel (DEC-1) was the one that wrote credentials to disk
 * verbatim. Slack message text and Jira descriptions — both plain adapter bodies,
 * both places people paste tokens — are the next two to arrive, and neither should
 * have to remember.
 *
 * A first-party channel gets redacted too, and that is correct rather than
 * collateral: trust decides which believability rung a body earns, never whether a
 * live credential belongs in a pushed repository.
 *
 * `id` and `source` are deliberately left alone. They are keys — the cursor, the
 * on-disk filename and `classifyProvenance` all match them verbatim — and
 * rewriting a key to fix a display problem is how one record becomes two.
 */
export function writeEvidence(dir: string, rec: EvidenceRecord): boolean {
  const d = evidenceDir(dir);
  fs.mkdirSync(d, { recursive: true });
  const p = path.join(d, `${safeName(rec.id)}.md`);
  if (fs.existsSync(p)) return false;
  const content = matter.stringify(redactSecrets(rec.body).trim() + "\n", {
    id: rec.id,
    source: rec.source,
    title: redactSecrets(rec.title),
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
    let parsed: ReturnType<typeof matter>;
    try {
      parsed = matter(fs.readFileSync(path.join(d, name), "utf8"));
    } catch {
      // One unparseable file costs one record, never the read. Missing frontmatter
      // already degrades to defaults below; unparseable frontmatter used to throw out
      // of this loop and take `ost_next_work` — the only tool the unattended sweep
      // gates on — down with it. The evidence directory is fed by an untrusted builder
      // by design, so that was a reachable denial of service on the whole sweep.
      //
      // The file itself is untouched and still in git: what is dropped is its
      // appearance in this list, not the record.
      continue;
    }
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
