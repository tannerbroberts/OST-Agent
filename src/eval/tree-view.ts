/**
 * The rendered tree, and what moved in it since the reader last looked.
 *
 * This is the mechanism of the tree node "Rendered tree view with diff since
 * last visit", and it is deliberately only half of what that node is for. The
 * other half — whether a rendered tree orients a reader faster than the files do
 * — is a claim about a person and no exit code observes it. What is buildable
 * here is the feasibility claim beside it: **a per-visit diff is derivable from
 * the vault alone.** A green test on this file settles that and nothing else; it
 * is not evidence that anybody was oriented.
 *
 * ## Why the diff is not a file diff
 *
 * The naive implementation compares the bytes of the vault at two moments, and
 * it fails on the case that matters. A merge deletes the loser's file, rewrites
 * the survivor's, and rewrites every node that linked to the loser — so a
 * byte-level reader reports one deletion plus N unrelated edits, which is
 * technically accurate and useless. The reader wanted one line: *these two nodes
 * became one.*
 *
 * So the diff is computed from the vault's own semantics. Every write in
 * {@link ../ost/vault.ts} records what it did in the node's `## History`
 * section — `status: a → b`, `merged "X" into this node and deleted its file`,
 * `link "X" repointed to "Y" — that node was merged away` — and those lines are
 * what this reads. The frontmatter carries the fields, the History carries the
 * events, and between them a change can be named as the thing that happened
 * rather than as the bytes it moved.
 *
 * ## The consequence rule, which is where the false positives were
 *
 * A node whose *entire* change is the downstream effect of another change in the
 * same interval is not an independent change. Two shapes, both routine:
 *
 *   - a parent gains a `[[wikilink]]` because a child was created beneath it;
 *   - a node's link to a merged-away duplicate is repointed at the survivor.
 *
 * Both leave a file genuinely modified, and a reader told about them is being
 * told the same event twice with the second telling stripped of its reason. They
 * are attached to the event that caused them (`consequences`) and never listed
 * as changes of their own. The bar the assumption test sets is zero false
 * positives, and this rule is the whole of how that is met — everything else the
 * diff does is comparing fields.
 *
 * What this cannot do, stated because it bounds the feature: a snapshot stores
 * prose as a hash, so the diff knows prose was rewritten and never what it now
 * says. Naming the words is git's job.
 */
import { BELIEVABILITY_LADDER, type RungId } from "../knowledge/believability.js";
import { byTitle } from "../processes/tree.js";
import type { OstNode } from "../ost/node.js";
import { fingerprintTree, type NodeFingerprint, type VisitSnapshot } from "../ost/visit.js";
import { MAX_ITEMS_PER_LIST } from "./render.js";

/**
 * What kind of thing happened to a node, in the vocabulary a reader thinks in.
 *
 * `merged` and `removed` are separate because they are different events wearing
 * the same filesystem shape — a file that is gone. One consolidated two claims
 * into one and the tree still holds it; the other took a claim away.
 */
export type ChangeKind = "created" | "merged" | "removed" | "status" | "evidence" | "measured" | "edited";

/** The order a reader reads them in, and the order a node with several is classified by. */
const KIND_ORDER: readonly ChangeKind[] = ["created", "merged", "removed", "status", "evidence", "measured", "edited"];

const KIND_MARK: Record<ChangeKind, string> = {
  created: "+",
  merged: "⤳",
  removed: "−",
  status: "~",
  evidence: "~",
  measured: "✓",
  edited: "·",
};

export interface TreeChange {
  /** The node the event happened to. For a merge that is the SURVIVOR — the loser has no file left to name. */
  title: string;
  kind: ChangeKind;
  /** The specifics, already worded for a reader: `status: unvalidated → validated`. */
  details: string[];
  /**
   * Nodes whose only change was caused by this one — see the consequence rule in
   * the file header. Named here so the information is not lost, and never
   * promoted to a change of its own.
   */
  consequences: string[];
}

export interface TreeDiff {
  reader: string;
  /** When the reader last looked, or null if they never have. */
  since: string | null;
  /** Every change, most-structural first. Empty means nothing moved. */
  changes: TreeChange[];
  /** How many nodes were compared — the denominator behind "and nothing else moved". */
  compared: number;
}

/** The History entry a merge writes on the survivor, naming the node it absorbed. */
const MERGED_IN = /^\S+\s+merged "(.+?)" into this node\b/;
/** The History entry a merge writes on every node that pointed at the loser. */
const REPOINTED = /^\S+\s+link "(.+?)" repointed to "(.+?)"/;

/** Entries in `now` that were not in `before`, as a multiset difference. */
function addedEntries(before: readonly string[], now: readonly string[]): string[] {
  const remaining = new Map<string, number>();
  for (const line of before) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  const added: string[] = [];
  for (const line of now) {
    const left = remaining.get(line) ?? 0;
    if (left > 0) remaining.set(line, left - 1);
    else added.push(line);
  }
  return added;
}

function changed(before: string | undefined, now: string | undefined): boolean {
  return (before ?? "") !== (now ?? "");
}

function transition(field: string, before: string | undefined, now: string | undefined): string {
  return `${field}: ${before ?? "(none)"} → ${now ?? "(none)"}`;
}

function setDiff(before: readonly string[], now: readonly string[]): { added: string[]; removed: string[] } {
  const wasThere = new Set(before);
  const isThere = new Set(now);
  return {
    added: now.filter((t) => !wasThere.has(t)),
    removed: before.filter((t) => !isThere.has(t)),
  };
}

/**
 * What changed in `tree` since `visit`.
 *
 * `visit` of `undefined` is a reader who has never looked: the result carries no
 * changes and `since: null`, which the renderer says out loud rather than
 * printing an empty change list that reads as "nothing happened".
 */
export function diffSinceVisit(tree: readonly OstNode[], visit: VisitSnapshot | undefined, reader: string): TreeDiff {
  const now = fingerprintTree(tree);
  if (!visit) {
    return { reader, since: null, changes: [], compared: Object.keys(now).length };
  }
  const before = visit.nodes;

  const created = Object.keys(now).filter((t) => !(t in before));
  const gone = Object.keys(before).filter((t) => !(t in now));

  // Pass 1 — the events. A gone node is a merge if some surviving node's History
  // gained a line saying it absorbed it; only then is the deletion one event
  // rather than two. Anything else that vanished is a removal, and is reported
  // as one rather than quietly dropped.
  const events = new Map<string, TreeChange>();
  const event = (title: string, kind: ChangeKind): TreeChange => {
    const existing = events.get(title);
    if (existing) {
      if (KIND_ORDER.indexOf(kind) < KIND_ORDER.indexOf(existing.kind)) existing.kind = kind;
      return existing;
    }
    const fresh: TreeChange = { title, kind, details: [], consequences: [] };
    events.set(title, fresh);
    return fresh;
  };

  /** loser title → survivor title, read off the survivors' own History lines. */
  const absorbedBy = new Map<string, string>();
  for (const [title, fp] of Object.entries(now)) {
    const prior = before[title];
    if (!prior) continue;
    for (const line of addedEntries(prior.history, fp.history)) {
      const match = MERGED_IN.exec(line);
      if (match) absorbedBy.set(match[1], title);
    }
  }

  for (const title of created) {
    event(title, "created").details.push(`new ${now[title].layer}`);
  }
  for (const title of gone) {
    const survivor = absorbedBy.get(title);
    if (survivor && survivor in now) {
      event(survivor, "merged").details.push(`absorbed "${title}" — the two are now one node`);
    } else {
      // A file that went away with nothing claiming it. Recorded as its own kind
      // because "gone, and nobody said why" is exactly the state a reader of a
      // shared vault needs to see rather than have smoothed over.
      const orphan: TreeChange = { title, kind: "removed", details: ["no longer in the tree"], consequences: [] };
      events.set(title, orphan);
    }
  }

  // Pass 2 — field-level changes on the nodes that survived, and the consequence
  // rule that keeps the merge from being reported N+1 times.
  const consequenceOf = new Map<string, string>();
  for (const [title, fp] of Object.entries(now)) {
    const prior = before[title];
    if (!prior) continue;

    const details: string[] = [];
    if (changed(prior.status, fp.status)) details.push(transition("status", prior.status, fp.status));
    if (changed(prior.evidence, fp.evidence)) details.push(transition("evidence", prior.evidence, fp.evidence));
    if (changed(prior.instrument, fp.instrument)) details.push(transition("instrument", prior.instrument, fp.instrument));
    if (changed(prior.lane, fp.lane)) details.push(transition("lane", prior.lane, fp.lane));
    const measured = prior.measurements !== fp.measurements;
    const prose = prior.prose !== fp.prose;
    const links = setDiff(prior.links, fp.links);
    const linksMoved = links.added.length > 0 || links.removed.length > 0;

    // Is every part of this node's change explained by another event? Links that
    // appeared must point at something created or at a merge survivor; links that
    // vanished must point at something merged away or removed; and the History
    // lines that came with them must be repoint lines for those same merges.
    const explainedAdds = links.added.every((t) => created.includes(t) || [...absorbedBy.values()].includes(t));
    const explainedDrops = links.removed.every((t) => absorbedBy.has(t) || gone.includes(t));
    const addedHistory = addedEntries(prior.history, fp.history);
    const explainedHistory = addedHistory.every((line) => {
      const match = REPOINTED.exec(line);
      return match !== null && absorbedBy.get(match[1]) === match[2];
    });
    const onlyConsequence =
      linksMoved &&
      !prose &&
      !measured &&
      details.length === 0 &&
      !events.has(title) &&
      explainedAdds &&
      explainedDrops &&
      explainedHistory;

    if (onlyConsequence) {
      // Attribute it to the event that caused it: the merge it repointed toward,
      // or the node it gained an edge to.
      const cause =
        links.removed.map((t) => absorbedBy.get(t)).find((t): t is string => t !== undefined) ??
        links.added.find((t) => created.includes(t)) ??
        links.added[0];
      if (cause) consequenceOf.set(title, cause);
      continue;
    }

    if (prose) details.push("prose rewritten");
    if (measured) details.push("a measurement was recorded (## Results / ## Instrument Log)");
    if (linksMoved) {
      for (const t of links.added) details.push(`gained a child: "${t}"`);
      for (const t of links.removed) details.push(`lost a child: "${t}"`);
    }
    if (details.length === 0) continue;

    const kind: ChangeKind = changed(prior.status, fp.status)
      ? "status"
      : changed(prior.evidence, fp.evidence)
        ? "evidence"
        : measured
          ? "measured"
          : "edited";
    const change = event(title, kind);
    change.details.push(...details);
  }

  for (const [title, cause] of consequenceOf) {
    const change = events.get(cause);
    if (change) change.consequences.push(title);
    // A cause with no event of its own cannot happen — every entry in
    // `consequenceOf` names a created node, a merge survivor or a removal, and
    // all three are in `events`. If it ever does, the node is simply not
    // reported, which is the safe direction for a zero-false-positive bar.
  }

  const changes = [...events.values()].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.title.localeCompare(b.title),
  );
  for (const change of changes) change.consequences.sort();

  return { reader, since: visit.at, changes, compared: Object.keys(now).length };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** How deep beneath the Outcome the shape is drawn when the caller says nothing. */
export const DEFAULT_DEPTH = 2;

const RUNG_LABEL = new Map<string, string>(BELIEVABILITY_LADDER.map((r) => [r.id, r.label]));

/**
 * The strength mark beside a node — the ladder rendered as five distinguishable
 * glyphs so a reader can see where a branch is thin without reading a word.
 *
 * Filled is strong. An unlabelled node gets `?`, never the floor's glyph: "no
 * rung recorded" and "the weakest rung" are different states and a view that
 * drew them the same would be the tree's own inflation, in a picture.
 */
function strengthMark(rung: RungId | undefined): string {
  switch (rung) {
    case "money":
      return "█";
    case "observed":
      return "▓";
    case "stated":
      return "▒";
    case "expert":
      return "░";
    case "assertion":
      return "·";
    default:
      return "?";
  }
}

interface Sizes {
  opportunities: number;
  solutions: number;
  tests: number;
}

/** Everything reachable beneath `title`, counted by layer. Cycle-safe. */
function subtreeSizes(title: string, index: Map<string, OstNode>): Sizes {
  const sizes: Sizes = { opportunities: 0, solutions: 0, tests: 0 };
  const seen = new Set<string>([title]);
  const queue = [...(index.get(title)?.links ?? [])];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const node = index.get(next);
    if (!node) continue;
    if (node.layer === "Opportunity") sizes.opportunities += 1;
    else if (node.layer === "Solution") sizes.solutions += 1;
    else if (node.layer === "AssumptionTest") sizes.tests += 1;
    queue.push(...node.links);
  }
  return sizes;
}

function sizeSummary(sizes: Sizes): string {
  const parts: string[] = [];
  if (sizes.opportunities > 0) parts.push(`${sizes.opportunities} opportunity`);
  if (sizes.solutions > 0) parts.push(`${sizes.solutions} solution`);
  if (sizes.tests > 0) parts.push(`${sizes.tests} test`);
  return parts.length > 0 ? parts.join(", ") : "nothing beneath it";
}

export interface TreeViewOptions {
  /** How many levels beneath the Outcome to draw. */
  depth?: number;
  /** Cap on children drawn per node; the remainder is counted out loud. */
  perLevel?: number;
  /**
   * Whether the caller is about to move this reader's marker.
   *
   * Passed in rather than assumed because a first visit's closing line is a
   * promise about the next one — "the next visit can say what moved" — and under
   * `--no-record` that promise is false. A view that made it anyway would train a
   * reader to distrust the only sentence in the output they cannot check.
   */
  recording?: boolean;
}

/**
 * The whole view: what moved, then the shape it moved in.
 *
 * The diff comes first on purpose. A reader opening this has a question — "what
 * happened since Tuesday" — and the tree is the context for the answer, not the
 * answer. Putting the shape first would make them scroll past 37 buckets to find
 * three lines.
 */
export function renderTreeView(tree: readonly OstNode[], diff: TreeDiff, opts: TreeViewOptions = {}): string {
  const index = byTitle([...tree]);
  const outcome = tree.find((n) => n.layer === "Outcome");
  const out: string[] = [];

  out.push(`Tree view — ${outcome ? outcome.title : "(this vault has no Outcome node)"}`);
  out.push(renderDiffBlock(diff, opts.recording ?? true));
  out.push("");
  out.push(renderShape(outcome, index, diff, opts));
  return out.join("\n");
}

/** The "since your last visit" block, on its own so a caller can print just the answer. */
export function renderDiffBlock(diff: TreeDiff, recording = true): string {
  const out: string[] = [];
  if (diff.since === null) {
    out.push("");
    out.push(`First visit${diff.reader ? ` for ${diff.reader}` : ""} — nothing to compare against yet.`);
    out.push(
      recording
        ? `This visit is being recorded, so the next one can say what moved. ${diff.compared} node(s) seen.`
        : `This visit is NOT being recorded (--no-record), so the next one will be a first visit too. ` +
            `${diff.compared} node(s) seen.`,
    );
    return out.join("\n");
  }

  out.push("");
  if (diff.changes.length === 0) {
    out.push(`Since your last visit (${diff.since}): nothing moved. ${diff.compared} node(s) compared.`);
    return out.join("\n");
  }

  out.push(`Since your last visit (${diff.since}) — ${diff.changes.length} change(s):`);
  // The list is capped and the hidden count is named, on the rule the analysis
  // renders already follow: a shortened list that does not say so reads as "that
  // is all there is", which is the one thing a change list must never imply.
  for (const change of diff.changes.slice(0, MAX_ITEMS_PER_LIST)) {
    out.push(`  ${KIND_MARK[change.kind]} ${change.kind.padEnd(8)} "${change.title}"`);
    for (const detail of change.details) out.push(`      ${detail}`);
    if (change.consequences.length > 0) {
      // Named as a consequence, never as a change: see the consequence rule.
      out.push(
        `      and as a consequence, ${change.consequences.length} node(s) had a link rewritten: ` +
          change.consequences.map((t) => `"${t}"`).join(", "),
      );
    }
  }
  const hidden = diff.changes.length - Math.min(diff.changes.length, MAX_ITEMS_PER_LIST);
  if (hidden > 0) out.push(`  … and ${hidden} more change(s) not shown`);
  out.push(`  Nothing else moved — ${diff.compared} node(s) compared.`);
  return out.join("\n");
}

function renderShape(
  outcome: OstNode | undefined,
  index: Map<string, OstNode>,
  diff: TreeDiff,
  opts: TreeViewOptions,
): string {
  const depth = opts.depth ?? DEFAULT_DEPTH;
  const perLevel = opts.perLevel ?? MAX_ITEMS_PER_LIST;
  const marks = new Map(diff.changes.map((c) => [c.title, KIND_MARK[c.kind]]));
  const out: string[] = [];

  out.push("The shape, outcome first (◻ = a node that moved since your last visit):");
  if (!outcome) {
    out.push("  (no Outcome node — nothing to draw from)");
    return out.join("\n");
  }
  out.push(`  ${outcome.title}`);

  const seen = new Set<string>([outcome.title]);
  const walk = (title: string, level: number, indent: string): void => {
    if (level > depth) return;
    const node = index.get(title);
    if (!node) return;
    const children = node.links.filter((t) => index.has(t));
    for (const child of children.slice(0, perLevel)) {
      const childNode = index.get(child)!;
      if (seen.has(child)) continue;
      seen.add(child);
      const sizes = subtreeSizes(child, index);
      const mark = marks.has(child) ? `◻${marks.get(child)!} ` : "";
      out.push(
        `${indent}${strengthMark(childNode.evidence)} ${mark}${child}` +
          ` — ${childNode.layer}, ${RUNG_LABEL.get(childNode.evidence ?? "") ?? "no rung recorded"}` +
          (level < depth ? `, ${sizeSummary(sizes)}` : ""),
      );
      walk(child, level + 1, `${indent}  `);
    }
    const hidden = children.length - Math.min(children.length, perLevel);
    if (hidden > 0) out.push(`${indent}… and ${hidden} more beneath "${title}" not shown`);
  };
  walk(outcome.title, 1, "    ");
  return out.join("\n");
}
