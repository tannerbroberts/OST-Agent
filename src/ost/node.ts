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
import { parseFrontmatter } from "./frontmatter.js";
import { isAuthorship, type Authorship } from "./authorship.js";
import { isRung, type RungId } from "../knowledge/believability.js";
import { isLane, type LaneId } from "../knowledge/lanes.js";

/** Tag form of the evidence class: `#evidence/observed`. */
const EVIDENCE_TAG = /^evidence\/(.+)$/;

/**
 * The OST layers, root-first.
 *
 * `Assumption` sits between a Solution and its tests: a solution depends on
 * beliefs, and each belief is what a test is trying to falsify. Before it
 * existed a solution linked its tests directly, which conflated the two — the
 * belief being risked and the instrument measuring it were the same node, so a
 * solution resting on four beliefs measured by one test looked identically
 * covered to one resting on a single belief.
 *
 * Writes are strict (an AssumptionTest attaches under an Assumption) but reads
 * are tolerant: `testsUnder` still resolves a legacy Solution→AssumptionTest
 * edge, because vaults written before this layer existed must not go red on a
 * shape nobody has migrated yet.
 */
export type Layer = "Outcome" | "Opportunity" | "Solution" | "Assumption" | "AssumptionTest" | "Unknown";

export const LAYERS: readonly Layer[] = [
  "Outcome",
  "Opportunity",
  "Solution",
  "Assumption",
  "AssumptionTest",
  "Unknown",
] as const;

/**
 * The status vocabulary, as a runtime list so a caller validating a
 * status-shaped input (e.g. a suppression condition naming the status it holds
 * on) can fail closed against the same set the type checks — one vocabulary,
 * not a union here and a hand-copied array drifting somewhere else.
 */
export const NODE_STATUSES = ["unvalidated", "validated", "in-discovery", "shipped", "deferred"] as const;

export type NodeStatus = (typeof NODE_STATUSES)[number];

export function isNodeStatus(v: unknown): v is NodeStatus {
  return typeof v === "string" && (NODE_STATUSES as readonly string[]).includes(v);
}

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

/**
 * Whether the surface that wrote an instrument could actually see the
 * repository it names — `grounded` when at least one configured product repo
 * resolved to a readable directory at the moment of the write, `blind` when
 * none did.
 *
 * The value is derived from the surface's own grant table
 * ({@link ../product/repo.ts#repoSight}) and never accepted from the caller:
 * the party being graded must not set its own grade. A grounded instrument and
 * a guessed one used to be the same string in the same field; this is the
 * column that makes them countable.
 */
export type RepoSight = "grounded" | "blind";

/** Type guard for {@link RepoSight} — an unrecognised value is dropped, not carried. */
export function isRepoSight(value: unknown): value is RepoSight {
  return value === "grounded" || value === "blind";
}

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
  /**
   * For an AssumptionTest: the command whose exit code answers the test — the
   * executable half of the threshold above.
   *
   * Carried verbatim, and validated only when it is read
   * ({@link ../knowledge/instruments.ts}), so a node written by an older version
   * or by hand round-trips unchanged instead of being silently dropped. A
   * declaration that does not parse is not an instrument, but it is still what
   * the author wrote, and the reader says so by name.
   */
  instrument?: string;
  /**
   * For an AssumptionTest: whether the pass that wrote the instrument could
   * see the repository. Stamped server-side from the grant table whenever an
   * allowlisted tool writes the `instrument` field; absent on nodes whose
   * instrument predates the flag, which reads as "unlabelled", never as either
   * verdict.
   */
  sight?: RepoSight;
  /**
   * For an AssumptionTest: the titles of tests that must be answered *before*
   * this one — the one edge in this schema that is not parent-child.
   *
   * A strict OST is a tree and real discovery is not: "you cannot run the
   * community-seeding test until arrivals are measurable" is an ordering claim
   * that spans branches, and with nowhere to put it an agent invented
   * `#prerequisite` tags and wrote the dependency out longhand in the prose.
   * That is a schema gap announcing itself, and this field is where it lands.
   *
   * Deliberately a frontmatter list rather than a `[[wikilink]]` line. A link
   * line is a *child* edge here, and every structural rule reads it that way —
   * `single-parent`, `single-backlink` and `test-mapped` would all fire on a
   * prerequisite written as an edge, so the validator would call a real
   * dependency an orphan or a second parent. Keeping the two link kinds in
   * different fields is what lets it learn the difference; the cost is that
   * Obsidian's graph does not draw these, which is a real loss and the reason
   * `ost-agent prerequisites` prints them.
   *
   * Absent (rather than `[]`) on every node that declares none, so a reader
   * cannot tell "no prerequisites" apart from "written before the field
   * existed" — and nothing here needs to: no prerequisites is what both mean
   * for ordering. What is NOT permitted is a cycle; see
   * {@link ./prerequisites.ts}.
   */
  prerequisites?: string[];
  /**
   * For a Solution: the observation that would end this candidate, written at
   * creation — before anyone is attached to it.
   *
   * Carried as a field rather than a sentence in the prose for the same reason
   * `threshold` is: a commitment nothing can read is a commitment nobody has to
   * honour. Paired with {@link killBy}, and the pair is what
   * {@link ./kill-criteria.ts} sweeps.
   *
   * Absent on every Solution written before the field existed. That is
   * `unlabelled` — reported by the sweep as a candidate it cannot judge, never
   * folded into "no kill is due".
   */
  killIf?: string;
  /**
   * For a Solution: the ISO date (YYYY-MM-DD) by which {@link killIf} is to be
   * checked. The half a machine can evaluate; the condition itself is a
   * person's reading.
   */
  killBy?: string;
  /**
   * Whose prose this node holds — `machine`, `human`, or `mixed` once both have
   * written in it. Folded by {@link ../ost/authorship.ts#foldAuthorship} at every
   * write in {@link ./vault.ts}, never replaced, and never accepted from the
   * caller: `human` is set only by the CLI writes that carry a named person's
   * attribution, which no allowlisted tool can reach.
   *
   * Absent means nobody recorded anything — a node predating the field, or a file
   * a person hand-wrote beside the vault's own writer. That is `unlabelled` in
   * the census and never either verdict, on the same posture as `sight`.
   */
  authorship?: Authorship;
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

/**
 * A frontmatter value read as a list of node titles.
 *
 * Tolerant in one direction only. A bare string is accepted, because
 * `prerequisites: Some other test` is what a person writes when there is exactly
 * one and YAML gives them no reason to think otherwise. Anything that is not a
 * string is DROPPED rather than coerced: `prerequisites: 3` naming node "3" is a
 * title nobody wrote, and an ordering edge invented by a parser is worse than an
 * ordering edge missing. Blanks go, and duplicates collapse — declaring the same
 * prerequisite twice is one claim, not two.
 */
function readTitleList(value: unknown): string[] {
  const raw = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const titles = raw.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter((t) => t.length > 0);
  return [...new Set(titles)];
}

/** UTC calendar date (YYYY-MM-DD) for a Date. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Render an {@link OstNode} to its Markdown file contents. */
export function serialize(node: OstNode): string {
  // `string[]` for `prerequisites` alone — the one field here that is a set of
  // titles rather than a single value. YAML renders it as a block list, which is
  // what a person hand-editing the file will expect to write.
  const data: Record<string, string | string[]> = { type: node.layer };
  if (node.status) data.status = node.status;
  if (node.source) data.source = node.source;
  if (node.created) data.created = node.created;
  if (node.confidence) data.confidence = node.confidence;
  if (node.evidence) data.evidence = node.evidence;
  if (node.lane) data.lane = node.lane;
  if (node.threshold) data.threshold = node.threshold;
  if (node.instrument) data.instrument = node.instrument;
  if (node.sight) data.sight = node.sight;
  // Omitted when empty rather than written as `[]` — see the field doc; an empty
  // list and an absent field say the same thing about ordering, and only one of
  // them adds a line to every test file in the vault.
  if (node.prerequisites && node.prerequisites.length > 0) data.prerequisites = [...node.prerequisites];
  if (node.killIf) data.killIf = node.killIf;
  if (node.killBy) data.killBy = node.killBy;
  if (node.authorship) data.authorship = node.authorship;

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

/**
 * A node's outgoing links, parsed from arbitrary Markdown content, or null
 * when it does not parse as a node at all.
 *
 * `deserialize` throws on unparseable content, which is right for a live vault
 * read (an unreadable node file is the caller's problem to report) and wrong
 * for scanning historical git blobs, where most candidates are expected not to
 * parse (a config file, a README, a commit predating this schema) and "did not
 * parse" is simply "not a match" rather than an error. This is the one door
 * {@link deserialize} may be called through outside a live vault read
 * (`test/ost/retraction-consumers.test.ts` holds every OTHER caller to
 * `src/ost/`), so a historical scan still goes through the same parser a live
 * read does rather than growing a second one.
 */
export function tryOutgoingLinks(title: string, markdown: string): string[] | null {
  try {
    return deserialize(title, markdown).links;
  } catch {
    return null;
  }
}

/**
 * The three things a node file's CONTENT (everything below the frontmatter)
 * carries: its tag line, its child edges, and its prose.
 *
 * Split out of {@link deserialize} because {@link ./quarantine.ts} has to read
 * exactly this much out of a file whose `type:` the reader does NOT recognise —
 * and reading it with a second, near-identical parser is how a quarantined node
 * would come to disagree with a live one about its own edges. The layer is a
 * parameter rather than a lookup because the only thing the layer decides here
 * is which tag to drop from `tags`; a quarantined file passes its declared type,
 * so `#Metric` is dropped from a `type: Metric` file the same way `#Solution` is
 * dropped from a Solution.
 */
export function parseNodeContent(
  content: string,
  layerTag: string,
): { tags: string[]; links: string[]; body: string; taggedRung: string | undefined } {
  const lines = content.replace(/^\n+/, "").split("\n");

  // First non-empty line is the tag line.
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  const tagLine = i < lines.length ? lines[i].trim() : "";
  i++;

  const allTags = [...tagLine.matchAll(/#(\S+)/g)].map((m) => m[1]);
  // Everything except the layer tag becomes an extra tag (dedupe, drop the layer).
  // The evidence tag is lifted back onto `evidence` rather than left in `tags`.
  const tags = allTags.filter((t) => t !== layerTag && !EVIDENCE_TAG.test(t));
  const taggedRung = allTags.map((t) => EVIDENCE_TAG.exec(t)?.[1]).find((r): r is string => !!r);

  // Contiguous wikilink-only lines immediately after the tag line are child edges.
  const links: string[] = [];
  while (i < lines.length) {
    const m = lines[i].trim().match(WIKILINK_LINE);
    if (!m) break;
    links.push(m[1]);
    i++;
  }

  return { tags, links, body: lines.slice(i).join("\n").trim(), taggedRung };
}

/** Parse Markdown file contents (with the given title) back into an {@link OstNode}. */
export function deserialize(title: string, markdown: string): OstNode {
  const parsed = parseFrontmatter(markdown);
  const data = parsed.data as Record<string, unknown>;

  const layer = data.type as Layer;
  if (!LAYERS.includes(layer)) {
    throw new Error(`node "${title}" has invalid or missing type: ${String(data.type)}`);
  }

  const { tags, links, body, taggedRung } = parseNodeContent(parsed.content, layer);

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
  // Kept verbatim even when it does not parse: the reader names an unusable
  // declaration rather than pretending the author never made one.
  if (typeof data.instrument === "string") node.instrument = data.instrument;
  // Same posture as `lane`: a sight value nobody defined must never be the
  // reason an instrument counts as grounded.
  if (isRepoSight(data.sight)) node.sight = data.sight;
  const prerequisites = readTitleList(data.prerequisites);
  if (prerequisites.length > 0) node.prerequisites = prerequisites;
  if (typeof data.killIf === "string") node.killIf = data.killIf;
  // An unquoted ISO date is a Date to YAML, exactly as `created` is — coerced
  // back so the field a person typed and the field a writer stamped read the
  // same. Anything else is kept verbatim: a malformed kill date is named by the
  // sweep rather than silently dropped, which would read as "no date was set".
  if (data.killBy instanceof Date) node.killBy = isoDate(data.killBy);
  else if (typeof data.killBy === "string") node.killBy = data.killBy;
  // Same posture again, and here it is the load-bearing one: an unrecognised
  // authorship value must never be the reason a node reads as a person's work.
  if (isAuthorship(data.authorship)) node.authorship = data.authorship;
  return node;
}
