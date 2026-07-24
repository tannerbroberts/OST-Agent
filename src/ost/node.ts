/**
 * OST node model + Obsidian-graph-compatible (de)serialization.
 *
 * On-disk shape (one file per node; filename = title):
 *
 *   ---
 *   type: Solution
 *   status: unvalidated
 *   source: JIRA:PROJ-1234
 *   created: 2026-07-22
 *   confidence: low
 *   ---
 *   #Solution #unvalidated
 *   [[An assumption this depends on]]
 *   [[Another assumption]]
 *
 *   Prose description of the node.
 *
 *   ## History
 *   - 2026-07-22 created (unvalidated)
 *
 * The first content line is the type tag(s) (Obsidian colors the graph by tag);
 * the contiguous `[[wikilink]]` lines that follow are the node's child edges; the
 * remainder is the prose body (which may contain its own sections/links).
 */
import matter from "gray-matter";
import { isRung, type RungId } from "../knowledge/believability.js";

/** Tag form of the evidence class: `#evidence/observed`. */
const EVIDENCE_TAG = /^evidence\/(.+)$/;

export type Layer = "Outcome" | "Opportunity" | "Solution" | "AssumptionTest";

export const LAYERS: readonly Layer[] = [
  "Outcome",
  "Opportunity",
  "Solution",
  "AssumptionTest",
] as const;

export type NodeStatus =
  | "unvalidated"
  | "validated"
  | "in-discovery"
  | "shipped"
  | "deferred";

export interface OstNode {
  /** Node title; also the basis for the filename. */
  title: string;
  /** Which OST layer this node belongs to. */
  layer: Layer;
  status?: NodeStatus;
  /** Provenance — e.g. "JIRA:PROJ-1234", "INBOX:note.md". */
  source?: string;
  /** ISO date (YYYY-MM-DD) the node was created. */
  created?: string;
  /** Agent-set qualitative confidence for ideated nodes. */
  confidence?: string;
  /**
   * Which rung of the believability ladder this node rests on. Rendered both in
   * frontmatter and as an `#evidence/<rung>` tag, so the weight of a claim is
   * visible everywhere the node appears — including Obsidian's graph.
   */
  evidence?: RungId;
  /** Extra tags beyond the layer tag (e.g. ["unvalidated"]). */
  tags: string[];
  /** Titles of child nodes, rendered as `[[wikilinks]]`. */
  links: string[];
  /** Prose body (may include `## History` / `## Issues` sections). */
  body: string;
}

const WIKILINK_LINE = /^\[\[(.+?)\]\]$/;

/** UTC calendar date (YYYY-MM-DD) for a Date. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Render an {@link OstNode} to its Markdown file contents. */
export function serialize(node: OstNode): string {
  const data: Record<string, string> = { type: node.layer };
  if (node.status) data.status = node.status;
  if (node.source) data.source = node.source;
  if (node.created) data.created = node.created;
  if (node.confidence) data.confidence = node.confidence;
  if (node.evidence) data.evidence = node.evidence;

  // The evidence tag is derived from `evidence`, never carried in `tags`, so a
  // round-trip cannot render it twice.
  const extraTags = node.tags.filter((t) => !EVIDENCE_TAG.test(t));
  const tagLine = [
    "#" + node.layer,
    ...extraTags.map((t) => "#" + t),
    ...(node.evidence ? [`#evidence/${node.evidence}`] : []),
  ].join(" ");
  const linkLines = node.links.map((l) => `[[${l}]]`);

  const bodyText = node.body.trim();
  const parts = [tagLine, ...linkLines];
  let content = parts.join("\n");
  if (bodyText.length > 0) {
    content += "\n\n" + bodyText;
  }
  content += "\n";

  // gray-matter renders `---\n<frontmatter>\n---\n<content>`.
  return matter.stringify(content, data);
}

/** Parse Markdown file contents (with the given title) back into an {@link OstNode}. */
export function deserialize(title: string, markdown: string): OstNode {
  const parsed = matter(markdown);
  const data = parsed.data as Record<string, unknown>;

  const layer = data.type as Layer;
  if (!LAYERS.includes(layer)) {
    throw new Error(`node "${title}" has invalid or missing type: ${String(data.type)}`);
  }

  const lines = parsed.content.replace(/^\n+/, "").split("\n");

  // First non-empty line is the tag line.
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  const tagLine = i < lines.length ? lines[i].trim() : "";
  i++;

  const allTags = [...tagLine.matchAll(/#(\S+)/g)].map((m) => m[1]);
  // Everything except the layer tag becomes an extra tag (dedupe, drop the layer).
  // The evidence tag is lifted back onto `evidence` rather than left in `tags`.
  const tags = allTags.filter((t) => t !== layer && !EVIDENCE_TAG.test(t));
  const taggedRung = allTags.map((t) => EVIDENCE_TAG.exec(t)?.[1]).find((r): r is string => !!r);

  // Contiguous wikilink-only lines immediately after the tag line are child edges.
  const links: string[] = [];
  while (i < lines.length) {
    const m = lines[i].trim().match(WIKILINK_LINE);
    if (!m) break;
    links.push(m[1]);
    i++;
  }

  const body = lines.slice(i).join("\n").trim();

  const node: OstNode = { title, layer, tags, links, body };
  if (typeof data.status === "string") node.status = data.status as NodeStatus;
  if (typeof data.source === "string") node.source = data.source;
  // YAML parses an unquoted ISO date (2026-07-22) as a Date — coerce back.
  if (data.created instanceof Date) node.created = isoDate(data.created);
  else if (typeof data.created === "string") node.created = data.created;
  if (typeof data.confidence === "string") node.confidence = data.confidence;
  const rung = typeof data.evidence === "string" ? data.evidence : taggedRung;
  if (rung && isRung(rung)) node.evidence = rung;
  return node;
}
