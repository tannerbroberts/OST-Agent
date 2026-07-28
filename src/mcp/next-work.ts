/**
 * ost_next_work — surface, read-only, exactly what a maintenance pass still has
 * to do. This exposes the deterministic definition-of-done logic that lives in
 * the discovery processes (registry.ts) to *whatever brain is driving the tree*,
 * so a Claude Code session (or a headless pass) never has to re-derive it.
 *
 * It is the orchestration seam for the MCP path: `anthropicDriver` gets its
 * work-list computed inside each ProcessDef; a session gets it from here.
 *
 * Purely a reader — it reads the tree + the `.ost-agent/` sidecar and reports.
 * It never mutates, so it carries no commit.
 */
import { byTitle, childrenOfLayer, getMapped, readEvidence } from "../processes/tree.js";
import { findNearDuplicateIssues } from "../ost/dedupe.js";
import { laneConflicts } from "../ost/lanes.js";
import { wrappedLinkTargets, type OstNode } from "../ost/node.js";
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
   * stopping condition, so counting it toward completion would wedge every
   * pass forever. `done` means maintenance is complete; exploration is
   * discretionary and budget-governed.
   */
  openUnknowns: OpenUnknown[];
}

/** Detect the same structural issues P5_hygiene annotates — dangling links + orphans. */
function detectHygiene(tree: OstNode[]): HygieneIssue[] {
  const index = byTitle(tree);
  const issues: HygieneIssue[] = [];
  const outcomeLinks = new Set(tree.find((n) => n.layer === "Outcome")?.links ?? []);
  for (const n of tree) {
    for (const link of n.links) {
      if (!index.has(link)) issues.push({ title: n.title, issue: `dangling link: [[${link}]] has no node` });
    }
    for (const target of wrappedLinkTargets(n.body)) {
      issues.push({ title: n.title, issue: `wrapped wikilink: [[${target}]] is split across a line break — it renders as text, not an edge` });
    }
    if (n.layer === "Opportunity" && !outcomeLinks.has(n.title)) {
      // only flag as an orphan if no opportunity parents it either (nested opportunities are valid)
      const parented = tree.some((p) => p.layer === "Opportunity" && p.links.includes(n.title));
      if (!parented) issues.push({ title: n.title, issue: "orphan opportunity: not linked under the outcome" });
    }
    if (n.layer === "Solution") {
      const parents = tree.filter((p) => p.layer === "Opportunity" && p.links.includes(n.title));
      if (parents.length === 0) issues.push({ title: n.title, issue: "orphan solution: not linked under any opportunity" });
    }
  }
  // a test that names one lane in its label and another in its prose: the tree
  // answering "may compute run this?" twice, differently. Annotated, never
  // resolved — picking the permissive side is a human's call by construction.
  for (const c of laneConflicts(tree)) {
    issues.push({
      title: c.test,
      issue: `lane conflict: labelled ${c.labelled} but its prose says "${c.quote}" — a person decides which is stale`,
    });
  }
  // likely duplicates (same-layer near-identical titles) — flagged for a human, never merged
  issues.push(...findNearDuplicateIssues(tree));
  // suppress ones already annotated into the node body (idempotent, matches P5)
  return issues.filter(({ title, issue }) => {
    const node = index.get(title);
    return node ? !node.body.includes(issue) : true;
  });
}

/**
 * Compute the outstanding maintenance work for the tree in `vault` (dir holds the
 * `.ost-agent/` evidence + state sidecar). `min` is minSolutionsPerOpportunity.
 */
export function computeNextWork(vault: Vault, dir: string, min: number): NextWork {
  const tree = vault.readTree();
  const index = byTitle(tree);

  // Evidence counts as mapped if the batch P2_map runner recorded it in mapped.json,
  // OR any node in the tree cites it as its `source`. The MCP-driven path attaches the
  // evidence id via ost_create_node's `source` but never writes mapped.json, so deriving
  // "mapped" from the tree too keeps this read-only report self-consistent no matter which
  // driver did the mapping — otherwise a session-driven /ost-pass can never reach done.
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

  const openUnknowns: OpenUnknown[] = tree
    .filter((n) => n.layer === "Unknown" && resolutionState(n) === "open")
    .map((u) => ({
      title: u.title,
      klass: classifyUnknown(u),
      darkens: tree.find((p) => p.layer !== "Unknown" && p.links.includes(u.title))?.title ?? null,
      gaps: contractGaps(u),
    }));

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
  if (openUnknowns.length) parts.push(`${openUnknowns.length} open unknown(s) → explore (does not block done)`);
  const summary = done
    ? openUnknowns.length
      ? `Tree is fully maintained — nothing to do. ${openUnknowns.length} open unknown(s) remain to explore (does not block done).`
      : "Tree is fully maintained — nothing to do."
    : `Outstanding: ${parts.join("; ")}.`;

  return { done, summary, unmappedEvidence, underservedOpportunities, solutionsMissingAssumptions, hygieneIssues, openUnknowns };
}
