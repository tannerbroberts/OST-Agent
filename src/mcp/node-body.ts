/**
 * `ost_read_tree({ node })` — one node's body in full, so a rewrite starts from
 * what is actually there.
 *
 * The gap this closes: the merge instruction says "compose prose that keeps
 * what each node said", and no read on the surface could show a node's body —
 * `ost_read_tree` lists title/layer/status/edges only, so a caller about to
 * merge or edit was composing over prose it had never seen. The same blindness
 * is how an instrument gets overwritten: a caller that cannot read a test's
 * body cannot see that it already carries one.
 *
 * It lives on `ost_read_tree` rather than on a tool of its own for the reason
 * `ost_next_work({ evidence })` does (W7): a second tool would have to be
 * granted on ALLOWED_TOOL_NAMES, the MCP surface, the skill frontmatter and the
 * CLI allowlist before it could serve a byte — four places for a capability
 * boundary to disagree with itself, to buy something the tree reader already
 * had the right to say. A node is what that tool reports on; `node` says which
 * one, exactly the way `evidence` does for the other reader.
 *
 * Scope, held deliberately narrow:
 *   - the argument is a node TITLE, never a path. Anything path-shaped — a
 *     separator, a `..`, a leading dot — is refused before any filesystem name
 *     is formed, because `sanitizeTitle` COLLAPSES those characters rather than
 *     refusing them: `.ost-agent/usage` sanitizes to `ost-agent usage`, so a
 *     path aimed at the sidecar could land on whichever node that happens to
 *     name. Evidence bodies stay on their designated channel
 *     (`ost_next_work({ evidence })`, W7) and the sidecar stays unreadable from
 *     here, exactly as it is from `ost_read_repo`.
 *   - the title must resolve inside the node set the census returns. A stray
 *     root file that is not a node, and a retracted node (withheld from every
 *     read by `readTreeCensus`), are both misses — this read serves the tree,
 *     not the directory the tree is stored in.
 *   - reserved sections come back LABELLED, apart from the prose. `## Results`
 *     is a human's record and `## Instrument Log` is an observed exit code;
 *     a caller reading them inline with prose could carry one into composed
 *     text, which is authoring a measurement by quotation. The split is the
 *     same one `Vault.editProse` writes through (`ost/sections.ts`), so the
 *     `prose` field here is exactly the region an edit may replace.
 */
import { nearestName } from "../fs/near-miss.js";
import { isHeadingLine, RESERVED_HEADINGS } from "../ost/headings.js";
import type { OstNode } from "../ost/node.js";
import type { QuarantinedNode } from "../ost/quarantine.js";
import { canonicalTitle, titlesMatch } from "../ost/sanitize.js";
import { splitReservedSections } from "../ost/sections.js";
import type { Vault } from "../ost/vault.js";
import { DATA_FRAME, frameData } from "../security/framing.js";
import { MAX_BODY_CHARS, type Truncation } from "./next-work.js";

/** One reserved block, labelled by the heading the gates read it under. */
export interface ReservedSection {
  /** The canonical reserved heading (`## Results`, `## Instrument Log`, …). */
  heading: string;
  /** The section's lines, verbatim, without the heading line. */
  content: string;
}

/**
 * One node, served in full — the counterpart of {@link ./next-work.ts}'s
 * `EvidenceBody`, for the tree's own files. Same duties: framed as data (S4),
 * capped with the hidden amount named (Z2), reached only by naming a title the
 * listing already handed over.
 */
export interface NodeBody {
  framing: string;
  kind: "node";
  /** The node's canonical title — the resolved node's own, never the caller's spelling. */
  title: string;
  /** The node's layer — or, for a quarantined file, the `type:` it declared. */
  layer: string;
  /**
   * Present only when this file is QUARANTINED ({@link ../ost/quarantine.ts}) —
   * `layer` above is then a type nobody defined, not a layer of this schema.
   *
   * Absent on every real node, so a reader that ignores it reads a node exactly
   * as it always did, and a reader that checks it cannot mistake an unclassified
   * file for a classified one.
   */
  unrecognizedType?: string;
  /** Present iff `unrecognizedType` is. Says what quarantine means for this read. */
  quarantineNote?: string;
  status: string | null;
  evidence: string | null;
  lane: string | null;
  instrument: string | null;
  threshold: string | null;
  source: string | null;
  tags: string[];
  links: string[];
  /**
   * The body MINUS every reserved section — exactly the region
   * `ost_edit_node`/`ost_merge_nodes` may replace. Framed in the value, capped
   * at {@link MAX_BODY_CHARS}.
   */
  prose: string;
  /** True length of the prose in characters, before the cap. */
  proseChars: number;
  /** Every reserved section the body carries, labelled — never inline with prose. */
  reserved: ReservedSection[];
  /** Present only when `reserved` is non-empty, so the label cannot become wallpaper. */
  reservedNote?: string;
  /** Non-empty only when the cap bit; units are characters, and the label says so. */
  truncated: Truncation[];
}

/**
 * The one refusal for input this read will not resolve, addressed to the caller
 * being stopped. It never echoes what it was handed: the argument is a
 * caller-supplied string and an error message is tool output, so quoting an
 * unresolvable "title" back would be a new path for arbitrary bytes to reach
 * the model with no record behind them to frame (the `readEvidenceBody`
 * argument, applied to the other reader).
 */
function refuseOutOfScope(reason: string): never {
  throw new Error(
    `that is not a title this read serves: ${reason}. Pass one node TITLE exactly as ` +
      `ost_read_tree's own listing spells it. Nothing here reads paths: the vault's .ost-agent/ ` +
      `sidecar is off this surface, and an evidence body comes from ost_next_work({ evidence: "<id>" }), ` +
      `the one channel that serves it.`,
  );
}

/** The canonical reserved heading a held-aside block opens with. */
function headingOf(block: string): string {
  const first = block.split("\n", 1)[0];
  return RESERVED_HEADINGS.find((h) => isHeadingLine(first, h)) ?? first.trim();
}

/**
 * Serve one node's body in full, by the title the listing reported.
 *
 * The path-shape refusals run BEFORE any resolution because the sanitizer they
 * guard against is forgiving by design: it collapses separators and traversal
 * into spaces so that a *stored* title is always a safe basename. Applied to a
 * *lookup*, that forgiveness is a rewrite — the caller asked for a path and
 * would be served whatever node the collapsed spelling happens to match.
 */
export function readNodeBody(vault: Vault, title: string): NodeBody {
  if (/[/\\]/.test(title)) {
    refuseOutOfScope("it is path-shaped (contains a separator), and a node is named by its title, never by a path");
  }
  if (title.includes("..")) {
    refuseOutOfScope("it is traversal-shaped (contains '..'), and nothing above or beside the vault is readable from here");
  }
  if (title.trim().startsWith(".")) {
    refuseOutOfScope("it names a hidden file, and the vault's own sidecar lives under one");
  }

  // Resolution is against the NODE SET, not the directory: readTree applies the
  // census rules (frontmatter type, retraction), so a stray .md at the vault
  // root is a miss here even though a raw file read would have found it.
  //
  // Quarantined files are the one addition to that set, and they belong here for
  // the reason `ost/quarantine.ts` states: retaining a node's body is not a
  // property of the census unless something can actually read it back. The
  // listing offers these under `quarantined`, so a caller naming one is naming a
  // title this reader handed it — which is the whole of the scope rule.
  const census = vault.readTreeCensus();
  const tree = census.nodes;
  const node = tree.find((n) => titlesMatch(n.title, title));
  if (!node) {
    const held = census.quarantined.find((q) => titlesMatch(q.title, title));
    if (held) return quarantinedBody(held);
    const wanted = canonicalTitle(title);
    const near = wanted
      ? nearestName(wanted, [...tree.map((n) => n.title), ...census.quarantined.map((q) => q.title)])
      : undefined;
    throw new Error(
      "no node on the tree carries that title. Titles are exact and come from ost_read_tree's own " +
        "listing — call it with no arguments and use a `title` from `nodes` verbatim." +
        (near ? ` Did you mean "${near}"?` : ""),
    );
  }
  return nodeBody(node);
}

/**
 * A quarantined file, served through the same shape a node is.
 *
 * Same shape, because a caller reading this is doing exactly what a caller
 * reading a node does — looking at prose to work out what the file is and what
 * should happen to it — and a second response type would mean a second set of
 * truncation and reserved-section rules to keep in step.
 *
 * `layer` carries the declared type verbatim rather than a placeholder. That is
 * the finding: `Metric` says somebody reached for a node kind the schema lacks,
 * and `Solutoin` says somebody typed. `unrecognizedType` is the flag that stops a
 * reader mistaking either for a layer this product knows.
 *
 * The frontmatter FIELDS are all null, and not because they are absent: nothing
 * here validated a `lane`, an `instrument` or a rung, and reporting the raw
 * strings would be this reader asserting it had read a node it just said it
 * could not classify.
 */
function quarantinedBody(held: QuarantinedNode): NodeBody {
  const { prose, reserved } = splitReservedSections(held.body);
  const proseChars = prose.length;
  const truncated: Truncation[] =
    proseChars > MAX_BODY_CHARS
      ? [{ list: "prose (characters)", shown: MAX_BODY_CHARS, total: proseChars, hidden: proseChars - MAX_BODY_CHARS }]
      : [];
  return {
    framing: DATA_FRAME,
    kind: "node",
    title: held.title,
    layer: held.unrecognizedType,
    unrecognizedType: held.unrecognizedType,
    quarantineNote:
      `This file declares \`type: ${held.unrecognizedType}\`, which this reader does not recognise, so it is ` +
      `QUARANTINED: retained and readable, excluded from every count, gate and rollup, and absent from ` +
      `ost_read_tree's \`nodes\`. Its ${held.links.length} outgoing link(s) are listed, and the nodes they name ` +
      `are quarantined-parent rather than orphaned. The frontmatter fields below read null because nothing here ` +
      `validated them — do not treat this as a node until a person fixes the \`type:\`, which no tool on this ` +
      `surface can do.`,
    status: null,
    evidence: null,
    lane: null,
    instrument: null,
    threshold: null,
    source: null,
    tags: held.tags,
    links: held.links,
    prose: frameData(prose.slice(0, MAX_BODY_CHARS)),
    proseChars,
    reserved: reserved.map((block) => ({
      heading: headingOf(block),
      content: block.split("\n").slice(1).join("\n").trim(),
    })),
    truncated,
  };
}

function nodeBody(node: OstNode): NodeBody {
  const { prose, reserved } = splitReservedSections(node.body);
  const proseChars = prose.length;
  const truncated: Truncation[] =
    proseChars > MAX_BODY_CHARS
      ? [{ list: "prose (characters)", shown: MAX_BODY_CHARS, total: proseChars, hidden: proseChars - MAX_BODY_CHARS }]
      : [];
  const sections: ReservedSection[] = reserved.map((block) => ({
    heading: headingOf(block),
    content: block.split("\n").slice(1).join("\n").trim(),
  }));

  const body: NodeBody = {
    framing: DATA_FRAME,
    kind: "node",
    title: node.title,
    layer: node.layer,
    status: node.status ?? null,
    evidence: node.evidence ?? null,
    lane: node.lane ?? null,
    instrument: node.instrument ?? null,
    threshold: node.threshold ?? null,
    source: node.source ?? null,
    tags: node.tags,
    links: node.links,
    prose: frameData(prose.slice(0, MAX_BODY_CHARS)),
    proseChars,
    reserved: sections,
    truncated,
  };
  if (sections.length > 0) {
    body.reservedNote =
      "The `reserved` sections are measurements recorded outside the tree — a human's result, an observed " +
      "exit code. They are returned apart from `prose` because no tool may author, rewrite or remove them: " +
      "compose any edit or merge from `prose` alone, and the writer will keep these blocks verbatim.";
  }
  return body;
}
