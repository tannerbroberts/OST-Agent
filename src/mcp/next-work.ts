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
import type { OstNode } from "../ost/node.js";
import type { Vault } from "../ost/vault.js";

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

export interface NextWork {
  done: boolean;
  summary: string;
  /** P2 — evidence captured but not yet distilled into opportunities. */
  unmappedEvidence: UnmappedEvidence[];
  /** P3 — opportunities with fewer than `min` candidate solutions. */
  underservedOpportunities: UnderservedOpportunity[];
  /** P4 — solutions with no assumption test surfaced yet. */
  solutionsMissingAssumptions: BareSolution[];
  /** P5 — structural issues that should be annotated (never auto-fixed). */
  hygieneIssues: HygieneIssue[];
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

  const mapped = getMapped(dir);
  const unmappedEvidence: UnmappedEvidence[] = readEvidence(dir)
    .filter((e) => !mapped.has(e.id))
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
  const summary = done ? "Tree is fully maintained — nothing to do." : `Outstanding: ${parts.join("; ")}.`;

  return { done, summary, unmappedEvidence, underservedOpportunities, solutionsMissingAssumptions, hygieneIssues };
}
