/**
 * A node whose `type:` this reader does not recognise — retained rather than
 * dropped.
 *
 * **The defect this exists for, measured rather than supposed.** One node in
 * this project's own vault had its `type:` changed from `Opportunity` to
 * `Metric` by hand. `readTreeCensus` filed it under `skipped` and every reader
 * downstream simply stopped seeing it: the node vanished from `readTree`, and
 * with it went its outgoing edges, so the branch beneath it re-appeared as four
 * orphan Opportunities, three orphan Solutions and one dangling link from the
 * Outcome. Nine findings, one cause, and not one of them said *a node is
 * missing*. An agent reading only the tool surface could not recover the fact
 * that a large branch existed on disk that it could not see — it would run a
 * full pass against a tree with a hole in it and report success.
 *
 * Silence is the bug. The unknown type is only the trigger: the same shape
 * arrives from version skew (a node kind a later release writes), from another
 * tool editing the vault, and from a typo.
 *
 * **What quarantine means here, stated as the three properties the tests pin:**
 *
 *   1. **Retained.** The file's title, body and outgoing links survive the read
 *      and are reachable on the tool surface, together with the type value that
 *      was not understood — because an operator reaching for a type the schema
 *      lacks is a product signal worth reading, not an error to normalize away.
 *   2. **Excluded from counts and gates, rather than miscounted.** A quarantined
 *      file is NOT an {@link ../ost/node.ts#OstNode} and never enters
 *      `readTree()`. Nothing that counts nodes, rolls up believability or checks
 *      an invariant sees it, so it generates no bogus finding of its own — the
 *      reader cannot classify it, so it must not pretend to judge it either.
 *   3. **Named, with the symptoms attributed to it.** Its edges are read for one
 *      purpose only: so that the nodes beneath it are reported as
 *      *quarantined-parent* rather than as orphans, and so a link INTO it is not
 *      called dangling. That is the difference between a diagnosis and nine
 *      symptoms.
 *
 * **What quarantine deliberately does not do:** it does not block `done`. The
 * solution node's own definition of done says "excluded from counts and gates",
 * and a gate the agent cannot clear — no allowlisted tool can rewrite a `type:`,
 * and `ost_annotate` cannot even read a file this class holds — would wedge every
 * unattended pass on a defect only a human at an editor can fix. It is reported
 * loudly instead, on `ost_check`, `ost_read_tree` and `ost_next_work`.
 */
import { parseNodeContent } from "./node.js";

/** A markdown file the walk read as a node but could not classify. */
export interface QuarantinedNode {
  /** Basename as it appeared on disk, so the census can name it beside its other drops. */
  file: string;
  /** The node's title — the filename without `.md`, exactly as a real node's would be. */
  title: string;
  /**
   * The `type:` value the frontmatter declared, verbatim.
   *
   * Carried rather than collapsed to "unknown" because it is the whole signal: a
   * `Metric` is somebody reaching for a node kind the schema lacks, and a
   * `Solutoin` is a typo. Those are different findings and only the value tells
   * them apart.
   */
  unrecognizedType: string;
  /** Extra tags from the tag line, read exactly as a live node's are. */
  tags: string[];
  /** Outgoing child edges — the reason the branch beneath it is not orphaned. */
  links: string[];
  /** Prose body, retained in full; served by `ost_read_tree({ node })`. */
  body: string;
}

/**
 * Build the quarantine record for a file whose frontmatter parsed but whose
 * `type:` is not a layer.
 *
 * `parseNodeContent` is the SAME parser a live node goes through, given the
 * declared type as the layer tag, so a quarantined node's edges are the edges it
 * would have had if the type had been recognised. Deriving them a second way is
 * how a quarantined node would come to disagree with itself about its own
 * branch.
 */
export function quarantineNode(file: string, markdown: string, declaredType: string, content: string): QuarantinedNode {
  const { tags, links, body } = parseNodeContent(content, declaredType);
  return { file, title: file.replace(/\.md$/, ""), unrecognizedType: declaredType, tags, links, body };
}

/** The reason string the census files a quarantined file under. */
export function quarantineReason(q: QuarantinedNode): string {
  return (
    `unrecognised type ${JSON.stringify(q.unrecognizedType)} — QUARANTINED, not dropped: ` +
    `its title, body and ${q.links.length} outgoing link(s) are retained and reachable, and it is ` +
    `excluded from every count and gate rather than miscounted. Fix the \`type:\` to bring it back ` +
    `into the tree; no tool on the agent's surface can.`
  );
}

/** Titles held in quarantine, for readers asking "is this link's target merely unclassified?". */
export function quarantinedTitles(quarantined: readonly QuarantinedNode[]): Set<string> {
  return new Set(quarantined.map((q) => q.title));
}

/**
 * Child title → the quarantined node that holds it.
 *
 * The one index that turns nine symptoms into one cause: a Solution whose only
 * parent is quarantined is not an orphan, it is *quarantined-parent*, and the
 * repair is on the parent's `type:` rather than on the child's edges. First
 * writer wins, so a child claimed by two quarantined files is attributed to the
 * one the walk saw first rather than reported twice.
 */
export function quarantinedParents(quarantined: readonly QuarantinedNode[]): Map<string, QuarantinedNode> {
  const held = new Map<string, QuarantinedNode>();
  for (const q of quarantined) for (const child of q.links) if (!held.has(child)) held.set(child, q);
  return held;
}
