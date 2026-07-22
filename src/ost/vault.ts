/**
 * Append-only vault operations over the filesystem.
 *
 * Every method here is add-only by construction: it creates a new node, appends
 * to a node, adds a link/status-transition/annotation, or reads. There is NO
 * delete, NO rename, and NO truncating rewrite. All paths are confined to the
 * vault root. This class is the ONLY thing that touches node files on disk, and
 * it is what the allowlist tool registry wraps — so the agent cannot express a
 * destructive operation because none exists here to call.
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { deserialize, serialize, type Layer, type NodeStatus, type OstNode } from "./node.js";
import { fileNameForTitle } from "./sanitize.js";

const VALID_LAYERS: readonly Layer[] = ["Outcome", "Opportunity", "Solution", "AssumptionTest"];

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export class Vault {
  readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
    fs.mkdirSync(this.root, { recursive: true });
  }

  /** Absolute path for a node title, asserted to stay within the vault root. */
  private nodePath(title: string): string {
    const p = path.resolve(this.root, fileNameForTitle(title));
    const rel = path.relative(this.root, p);
    if (rel.startsWith("..") || path.isAbsolute(rel) || rel.includes(path.sep)) {
      throw new Error(`refusing to write outside the vault: ${title}`);
    }
    return p;
  }

  has(title: string): boolean {
    return fs.existsSync(this.nodePath(title));
  }

  /** Read all node files at the vault root (skips non-node files and subdirs). */
  readTree(): OstNode[] {
    const entries = fs.readdirSync(this.root, { withFileTypes: true });
    const nodes: OstNode[] = [];
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const raw = fs.readFileSync(path.join(this.root, e.name), "utf8");
      const type = (matter(raw).data as Record<string, unknown>).type;
      if (typeof type !== "string" || !VALID_LAYERS.includes(type as Layer)) continue;
      nodes.push(deserialize(e.name.replace(/\.md$/, ""), raw));
    }
    return nodes;
  }

  read(title: string): OstNode {
    const p = this.nodePath(title);
    if (!fs.existsSync(p)) throw new Error(`no such node: ${title}`);
    return deserialize(title, fs.readFileSync(p, "utf8"));
  }

  /** Create a new node file. Throws if a file for this title already exists. */
  createNode(node: OstNode): void {
    const p = this.nodePath(node.title);
    if (fs.existsSync(p)) {
      throw new Error(`node already exists (create is non-overwriting): ${node.title}`);
    }
    fs.writeFileSync(p, serialize(node), "utf8");
  }

  /**
   * Append a prose section to an existing node's file. Strictly grows the file —
   * the prior bytes remain an exact prefix of the new content.
   */
  appendToNode(title: string, section: string): void {
    const p = this.nodePath(title);
    if (!fs.existsSync(p)) throw new Error(`no such node: ${title}`);
    const prev = fs.readFileSync(p, "utf8");
    const sep = prev.endsWith("\n") ? "\n" : "\n\n";
    fs.writeFileSync(p, prev + sep + section.trim() + "\n", "utf8");
  }

  /** Add a parent→child wikilink edge. Idempotent; adds the link at most once. */
  linkNodes(parent: string, child: string): void {
    const node = this.read(parent);
    if (node.links.includes(child)) return; // already linked — no-op
    node.links.push(child);
    fs.writeFileSync(this.nodePath(parent), serialize(node), "utf8");
  }

  /**
   * Set a node's status and append the transition to a `## History` section so
   * the prior value stays visible in the note (and always in git).
   */
  setStatus(title: string, status: NodeStatus, note?: string): void {
    const node = this.read(title);
    const prev = node.status ?? "(none)";
    node.status = status;
    const line = `- ${isoToday()} status: ${prev} → ${status}${note ? ` — ${note}` : ""}`;
    node.body = appendUnderHeading(node.body, "## History", line);
    fs.writeFileSync(this.nodePath(title), serialize(node), "utf8");
  }

  /** Attach a hygiene/issue annotation under a `## Issues` section. Add-only. */
  annotate(title: string, issue: string): void {
    const node = this.read(title);
    node.body = appendUnderHeading(node.body, "## Issues", `- ${isoToday()} ${issue}`);
    fs.writeFileSync(this.nodePath(title), serialize(node), "utf8");
  }
}

/** Append `line` under `heading`, creating the heading section if absent. */
function appendUnderHeading(body: string, heading: string, line: string): string {
  const trimmed = body.trimEnd();
  if (!trimmed.includes(`\n${heading}`) && !trimmed.startsWith(heading)) {
    return `${trimmed}\n\n${heading}\n${line}`;
  }
  return `${trimmed}\n${line}`;
}
