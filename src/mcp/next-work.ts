/**
 * ost_next_work — surface, read-only, exactly what a maintenance pass still has
 * to do. It holds the deterministic definition-of-done for each stage of tree
 * maintenance, so the connected session never has to re-derive it.
 *
 * It is the orchestration seam for the MCP path: this is where a session finds
 * out what is left, and the only place that answer is computed.
 *
 * Purely a reader — it reads the tree + the `.ost-agent/` sidecar and reports.
 * It never mutates, so it carries no commit.
 */
import { byTitle, childrenOfLayer, getMapped, readEvidence } from "../processes/tree.js";
import { checkInvariants } from "../eval/invariants.js";
import { findNearDuplicateIssues } from "../ost/dedupe.js";
import type { OstNode } from "../ost/node.js";
import type { Vault } from "../ost/vault.js";
import { classifyUnknown, contractGaps, resolutionState, type UnknownClass } from "../knowledge/unknowns.js";

export interface UnmappedEvidence {
  id: string;
  source: string;
  title: string;
  excerpt: string;
}
export interface UnderservedOpportunity {
  title: string;
  solutions: number;
  needed: number;
  existingSolutions: string[];
}
export interface BareSolution {
  title: string;
  opportunity: string | null;
}
export interface HygieneIssue {
  title: string;
  issue: string;
  /**
   * The `checkInvariants` rule this issue is the `next_work` face of, so the two
   * gates can be joined by something other than string matching. `near-duplicate`
   * is the one value with no invariant behind it — see {@link HYGIENE_ONLY_RULES}.
   */
  rule: string;
}
export interface OpenUnknown {
  title: string;
  /** Derived class; `class` is reserved. */
  klass: UnknownClass;
  /** The node this darkness attaches under, when it has a parent. */
  darkens: string | null;
  /** Contract sections not yet declared — what to write to make it actionable. */
  gaps: string[];
}

export interface NextWork {
  done: boolean;
  summary: string;
  /** P2 — evidence captured but not yet distilled into opportunities. */
  unmappedEvidence: UnmappedEvidence[];
  /** P3 — opportunities with fewer than `min` candidate solutions. */
  underservedOpportunities: UnderservedOpportunity[];
  /** P4 — solutions with no assumption test surfaced yet. */
  solutionsMissingAssumptions: BareSolution[];
  /** Structural issues that should be annotated (never auto-fixed). */
  hygieneIssues: HygieneIssue[];
  /**
   * Darkness the tree has declared and not yet resolved. Reported as available
   * work but deliberately NOT part of `done`: an unbounded unknown has no
   * stopping condition, so counting it toward completion would wedge every pass
   * forever. `done` means maintenance is complete; exploration is discretionary
   * and budget-governed.
   *
   * This list may be TRUNCATED by {@link MAX_OPEN_UNKNOWNS_SURFACED}. `done`
   * never is: it is computed over every open unknown, before the cap applies.
   */
  openUnknowns: OpenUnknown[];
}

/**
 * Rules `checkInvariants` can emit that deliberately do **not** block `done`,
 * each paired with the reason it does not.
 *
 * This map and {@link HYGIENE_LABELS} together are R4's parity decision: every
 * rule literal in `src/eval/invariants.ts` is either computed here as a hygiene
 * issue or declared here as a non-blocker, and `test/mcp/rule-parity.test.ts`
 * fails the build if a rule is in neither (or in both). Before this, the two
 * gates were two hand-written detectors, and four of the nine rules were red in
 * `ost_check` while `done` stayed true — a legacy or human-authored node was
 * enough, no forging required. The unattended pass reads only `done`; a human
 * reads `check`; two gates that can disagree permanently mean neither is a
 * health signal, and there is no third thing to break the tie.
 *
 * **The bar for adding an entry here is high, and it is a property of the tool
 * surface, not of the rule's importance:** a `done`-blocker the agent has no way
 * to clear is a permanent wedge, because `done` is the unattended loop's only
 * stopping condition. That is the whole argument for the one entry below.
 */
export const NOT_DONE_BLOCKING: Readonly<Record<string, string>> = {
  "single-outcome":
    "names no node, so there is nothing to annotate — and no tool on either surface can " +
    "remove the second Outcome (test/eval/clearability.test.ts pins both halves of that). " +
    "Blocking `done` on it would wedge every unattended pass forever on a defect the pass " +
    "cannot touch. It stays a hard `ost_check` violation and a mandatory human interrupt.",
};

/**
 * How each blocking rule is named in a hygiene issue. The reported string is
 * `${label}: ${violation.detail}`, so the detail is written once, in
 * `checkInvariants`, and both gates quote it identically.
 */
export const HYGIENE_LABELS: Readonly<Record<string, string>> = {
  "dangling-link": "dangling link",
  "wrapped-wikilink": "wrapped wikilink",
  "opportunity-connected": "orphan opportunity",
  "solution-mapped": "orphan solution",
  "assumption-mapped": "orphan assumption test",
  "evidence-class": "unclassed evidence",
  "no-self-validation": "self-validated",
  "lane-conflict": "lane conflict",
  "rung-unearned": "unearned rung",
};

/**
 * Issues `next_work` raises that no invariant emits. The asymmetry is safe in
 * this direction only: `next_work` may be *stricter* than `check` without either
 * gate lying, because a stricter `done` never reports complete over a red tree.
 * The reverse — `check` stricter than `done` — is the R4 defect.
 */
export const HYGIENE_ONLY_RULES = ["near-duplicate"] as const;

/**
 * The structural issues P5_hygiene annotates, derived from `checkInvariants`
 * rather than re-implemented beside it.
 *
 * Deriving is the point. The two detectors used to be written twice and drifted
 * in two ways at once: four rules existed only in `checkInvariants`, and the
 * orphan-opportunity check here tested *direct* parenting where the invariant
 * tests reachability from the Outcome — so a chain hanging off an orphan read as
 * connected on one gate and adrift on the other. Neither gap was hidden; both
 * were remembered rather than computed.
 */
function detectHygiene(tree: OstNode[]): HygieneIssue[] {
  const index = byTitle(tree);
  const issues: HygieneIssue[] = [];
  // The mandate is the one node guaranteed to exist, so it is where a violation
  // that names no node of its own gets attached — an issue with no node is an
  // issue no one can annotate, and therefore a wedge.
  const outcome = tree.find((n) => n.layer === "Outcome")?.title;
  for (const v of checkInvariants(tree)) {
    if (v.rule in NOT_DONE_BLOCKING) continue;
    const title = v.node ?? outcome;
    if (!title) continue; // nothing to hang it on; the parity test is what keeps this unreachable
    issues.push({ title, issue: `${HYGIENE_LABELS[v.rule] ?? v.rule}: ${v.detail}`, rule: v.rule });
  }
  // likely duplicates (same-layer near-identical titles) — flagged for a human, never merged
  for (const d of findNearDuplicateIssues(tree)) issues.push({ ...d, rule: "near-duplicate" });
  // suppress ones already annotated into the node body (idempotent, matches P5)
  return issues.filter(({ title, issue }) => {
    const node = index.get(title);
    return node ? !annotatedIssues(node.body).has(issue.trim()) : true;
  });
}

/**
 * The issues a node has actually been annotated with — the dated lines
 * {@link Vault.annotate} writes under `## Issues`, and nothing else.
 *
 * This replaces a whole-body `body.includes(issue)`, which made every free-text write
 * parameter a `done`-forging primitive: any prose quoting an issue string cleared it,
 * and `done` is the only gate the unattended loop reads. Reading the structural line
 * instead means the only thing that clears a hygiene issue is the tool for clearing
 * hygiene issues — which is what P5 already claims.
 *
 * It stays deliberately loose about the date: `ost_annotate` stamps today's, and an
 * issue re-annotated on a later day must still count as annotated.
 */
function annotatedIssues(body: string): Set<string> {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === "## Issues");
  if (start === -1) return new Set();
  const annotated = new Set<string>();
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (/^#{1,6}\s/.test(trimmed)) break; // the section ends at the next heading
    const entry = /^-\s+\d{4}-\d{2}-\d{2}\s+(.+)$/.exec(trimmed);
    if (entry) annotated.add(entry[1].trim());
  }
  return annotated;
}

/**
 * How many open unknowns one response may list. `0` is unlimited, which is what
 * ships — and what makes this response one of the two uncapped surfaces a large
 * tree can blow up (`docs/reference/v1-readiness.md`, Z2). The cap mechanism
 * below is the correct shape and is deliberately left switched off rather than
 * turned on inside an unrelated change: cap the display, compute `done` over the
 * full set, and name the hidden count so a cap can never read as amnesty.
 */
export const MAX_OPEN_UNKNOWNS_SURFACED = 0;

/**
 * Compute the outstanding maintenance work for the tree in `vault` (dir holds the
 * `.ost-agent/` evidence + state sidecar). `min` is minSolutionsPerOpportunity,
 * an operator knob from `ost.config.yaml`.
 */
export function computeNextWork(vault: Vault, dir: string, min: number): NextWork {
  const tree = vault.readTree();
  const index = byTitle(tree);

  // Evidence counts as mapped if any node in the tree cites it as its `source` — that is
  // how a session records the mapping, via ost_create_node's `source`. `mapped.json` is
  // read too, because vaults mapped before the batch runner was deleted recorded it there
  // and nowhere else; deriving "mapped" from the tree as well is what lets /ost-pass reach
  // done on a vault the session mapped itself.
  const mapped = getMapped(dir);
  const citedSources = new Set(tree.map((n) => n.source).filter((s): s is string => !!s));
  const unmappedEvidence: UnmappedEvidence[] = readEvidence(dir)
    .filter((e) => !mapped.has(e.id) && !citedSources.has(e.id))
    .map((e) => ({ id: e.id, source: e.source, title: e.title, excerpt: e.body.slice(0, 280) }));

  const underservedOpportunities: UnderservedOpportunity[] = tree
    .filter((n) => n.layer === "Opportunity")
    .map((o) => {
      const existing = childrenOfLayer(o, index, "Solution");
      return { title: o.title, solutions: existing.length, needed: min, existingSolutions: existing };
    })
    .filter((o) => o.solutions < min);

  const solutionsMissingAssumptions: BareSolution[] = tree
    .filter((n) => n.layer === "Solution")
    .filter((s) => childrenOfLayer(s, index, "AssumptionTest").length === 0)
    .map((s) => ({
      title: s.title,
      opportunity: tree.find((p) => p.layer === "Opportunity" && p.links.includes(s.title))?.title ?? null,
    }));

  const hygieneIssues = detectHygiene(tree);

  // Tree order — the order the walk produced.
  const allOpenUnknowns: OpenUnknown[] = tree
    .filter((n) => n.layer === "Unknown" && resolutionState(n) === "open")
    .map((u) => ({
      title: u.title,
      klass: classifyUnknown(u),
      darkens: tree.find((p) => p.layer !== "Unknown" && p.links.includes(u.title))?.title ?? null,
      gaps: contractGaps(u),
    }));

  // The cap is a display limit, never an amnesty: `done` is computed over every
  // open unknown, and the hidden count is named in the summary. A cap that
  // silently shortened the list would read as "that is all the darkness there is".
  const cap = MAX_OPEN_UNKNOWNS_SURFACED;
  const openUnknowns = cap > 0 ? allOpenUnknowns.slice(0, cap) : allOpenUnknowns;
  const hidden = allOpenUnknowns.length - openUnknowns.length;

  const done =
    unmappedEvidence.length === 0 &&
    underservedOpportunities.length === 0 &&
    solutionsMissingAssumptions.length === 0 &&
    hygieneIssues.length === 0;

  const parts: string[] = [];
  if (unmappedEvidence.length) parts.push(`${unmappedEvidence.length} unmapped evidence item(s) → map into #Opportunity nodes`);
  if (underservedOpportunities.length) parts.push(`${underservedOpportunities.length} opportunity(ies) with < ${min} solutions → ideate #Solution nodes`);
  if (solutionsMissingAssumptions.length) parts.push(`${solutionsMissingAssumptions.length} solution(s) with no assumption test → surface #AssumptionTest nodes`);
  if (hygieneIssues.length) parts.push(`${hygieneIssues.length} hygiene issue(s) → annotate (never delete)`);
  if (allOpenUnknowns.length)
    parts.push(`${allOpenUnknowns.length} open unknown(s) → explore (does not block done)`);

  const truncationNote = hidden
    ? ` Showing ${openUnknowns.length} of ${allOpenUnknowns.length} — ${hidden} more open unknown(s) not listed (cap=${cap}).`
    : "";
  const summary = done
    ? allOpenUnknowns.length
      ? `Tree is fully maintained — nothing to do. ${allOpenUnknowns.length} open unknown(s) remain to explore (does not block done).${truncationNote}`
      : "Tree is fully maintained — nothing to do."
    : `Outstanding: ${parts.join("; ")}.${truncationNote}`;

  return { done, summary, unmappedEvidence, underservedOpportunities, solutionsMissingAssumptions, hygieneIssues, openUnknowns };
}
