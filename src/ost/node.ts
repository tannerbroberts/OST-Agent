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
import { isLane, type LaneId } from "../knowledge/lanes.js";

/** Tag form of the evidence class: `#evidence/observed`. */
const EVIDENCE_TAG = /^evidence\/(.+)$/;

export type Layer = "Outcome" | "Opportunity" | "Solution" | "AssumptionTest" | "Unknown";

export const LAYERS: readonly Layer[] = [
  "Outcome",
  "Opportunity",
  "Solution",
  "AssumptionTest",
  "Unknown",
] as const;

export type NodeStatus =
  | "unvalidated"
  | "validated"
  | "in-discovery"
  | "shipped"
  | "deferred";

/**
 * The marker every agent-created node carries until a human promotes it.
 *
 * `no-self-validation` fires on the contradiction between this tag and
 * `status: validated`, so the rule's precondition used to be set by the actor
 * the rule constrains: omit the tag at creation and the invariant was
 * unreachable forever. It is stamped server-side now and no allowlisted tool
 * can remove it — the only remover is `Vault.promoteToValidated`, off every
 * surface. One literal, because three places read it. (B2.)
 */
export const AGENT_IDEATED_TAG = "unvalidated";

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
  /**
   * For an AssumptionTest: which lane it costs — and therefore whether an
   * unattended pass may run it at all. Absent means unclassified, which the lane
   * rules treat as "not runnable by compute" rather than as a default.
   */
  lane?: LaneId;
  /**
   * For an AssumptionTest: the pre-committed bar, carried as a field set at
   * creation instead of scraped from a bold lead-in buried in the prose.
   * `askedOf` (`src/eval/coverage.ts`) reads this first and falls back to the
   * prose scan when it is absent — every test written before the field existed
   * keeps working exactly the way it always did.
   */
  threshold?: string;
  /** Extra tags beyond the layer tag (e.g. ["unvalidated"]). */
  tags: string[];
  /** Titles of child nodes, rendered as `[[wikilinks]]`. */
  links: string[];
  /** Prose body (may include `## History` / `## Issues` sections). */
  body: string;
}

const WIKILINK_LINE = /^\[\[(.+?)\]\]$/;

/**
 * Targets of `[[…]]` occurrences in prose whose contents contain a newline,
 * whitespace-flattened — i.e. the titles the author meant to link.
 *
 * Only a whole line of the form `[[Title]]` becomes an edge (see
 * {@link deserialize}), so a link that a hard-wrapped paragraph broke in two is
 * not a link at all: Obsidian renders it as bracketed text and the graph simply
 * lacks the line. It is neither an edge nor a *dangling* one, which is why
 * every other structural check is blind to it.
 *
 * `[^[\]]` inside the brackets stops an unclosed `[[` from swallowing the rest
 * of the body and reporting one enormous phantom title.
 */
export function wrappedLinkTargets(text: string): string[] {
  const targets: string[] = [];
  for (const m of text.matchAll(/\[\[([^[\]]*)\]\]/g)) {
    if (m[1].includes("\n")) targets.push(m[1].replace(/\s*\n\s*/g, " ").trim());
  }
  return targets;
}

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
  if (node.lane) data.lane = node.lane;
  if (node.threshold) data.threshold = node.threshold;

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
  // An unrecognised lane is dropped, not carried: a label nobody defined must
  // never be the reason an unattended pass decides it may run a test.
  if (typeof data.lane === "string" && isLane(data.lane)) node.lane = data.lane;
  if (typeof data.threshold === "string") node.threshold = data.threshold;
  return node;
}
