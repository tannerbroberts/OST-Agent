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
import { findNearDuplicateIssues } from "../ost/dedupe.js";
import { laneConflicts } from "../ost/lanes.js";
import { wrappedLinkTargets, type OstNode } from "../ost/node.js";
import type { Vault } from "../ost/vault.js";
import { classifyUnknown, contractGaps, resolutionState, type UnknownClass } from "../knowledge/unknowns.js";
import { computeAttention } from "../eval/attention.js";
import { defaultGenome } from "../genome/load.js";
import type { Genome, PivotGene } from "../genome/schema.js";

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
   * work but, under the default genome, deliberately NOT part of `done`: an
   * unbounded unknown has no stopping condition, so counting it toward
   * completion would wedge every pass forever. `done` means maintenance is
   * complete; exploration is discretionary and budget-governed.
   *
   * `pivot.unknownsBlockDone` is the allele that may overturn that — a variant
   * that refuses to call a tree maintained while it still cannot see. It is
   * `false` in v1 because the argument above is the one we can defend today,
   * not because it is unfalsifiable.
   *
   * This list may be TRUNCATED by `pivot.maxOpenUnknownsSurfaced`. `done` never
   * is: it is computed over every open unknown, before the cap applies.
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
 * Order the open unknowns the way the genome asked.
 *
 * `tree-order` is the identity — the order the tree walk produced, which is
 * what every pass before the genome saw. `class-priority` sorts by the position
 * of each unknown's class in `classPriority`, with any class the list does not
 * name sorted last; `Array.prototype.sort` is stable (ES2019), so two unknowns
 * of the same class keep their tree order and the gene stays a coarse
 * re-ordering rather than a shuffle.
 *
 * `cost-to-resolve` sorts dearest-first, because the design ranks by measured
 * cost-to-resolve and the expensive darkness is what a session most needs to see
 * before it commits. The cost index is built by the caller and passed in, and
 * only on this branch — under any other allele `ost_next_work` must not pay a
 * whole-ledger and usage-log read on every call, which is the cost that
 * deferred this allele in the first place. If no index is supplied the order is
 * left alone rather than guessed at.
 *
 * The sort key inside that index switches on the MEASURED cost basis, and that
 * is not a detail. `weightedCost` is purely token-derived, so wherever nothing
 * correlated tokens it is 0 for every unknown — ranking on it would silently
 * reproduce tree order while claiming to rank by cost, which is worse than not
 * implementing the allele at all, because it does not announce itself.
 */
function rankOpenUnknowns(
  open: OpenUnknown[],
  pivot: PivotGene,
  costOf?: ReadonlyMap<string, number>,
): OpenUnknown[] {
  if (pivot.ranking === "class-priority") {
    const rank = (klass: UnknownClass): number => {
      const at = pivot.classPriority.indexOf(klass);
      return at === -1 ? pivot.classPriority.length : at;
    };
    return [...open].sort((a, b) => rank(a.klass) - rank(b.klass));
  }
  if (pivot.ranking === "cost-to-resolve" && costOf) {
    // Stable sort, so unknowns of equal cost keep their tree order — the same
    // property `class-priority` leans on.
    return [...open].sort((a, b) => (costOf.get(b.title) ?? 0) - (costOf.get(a.title) ?? 0));
  }
  return open;
}

/**
 * Per-unknown cost, on whichever basis the rollup actually measured.
 *
 * Built only on the `cost-to-resolve` branch. Under `tokens` the scalar is the
 * weighted token cost; under `calls-and-ms` it is calls plus wall-clock in
 * seconds, because the token dimension is structurally zero there and would
 * rank nothing.
 */
function costIndex(
  tree: readonly OstNode[],
  dir: string,
  genome: Genome,
): ReadonlyMap<string, number> {
  const rollup = computeAttention(tree, dir, {
    weightedTokenSpend: genome.weightedTokenSpend,
    classifier: genome.classifier,
    resolution: genome.resolution,
    attribution: genome.attribution,
    costBasis: genome.tokenSplit.costBasis,
  });
  const tokenBasis = rollup.costBasis === "tokens";
  return new Map(
    rollup.unknowns.map((u) => [u.title, tokenBasis ? u.weightedCost : u.calls + u.ms / 1000]),
  );
}

/**
 * Compute the outstanding maintenance work for the tree in `vault` (dir holds the
 * `.ost-agent/` evidence + state sidecar). `min` is minSolutionsPerOpportunity —
 * an operator knob from `ost.config.yaml`, not an allele. `genome` carries the
 * alleles: how darkness is classed, when it is resolved, and whether it blocks
 * `done`. Both are positional and defaulted, so an absent genome.yaml and a
 * three-argument call behave exactly as they did before Phase 2.
 */
export function computeNextWork(vault: Vault, dir: string, min: number, genome: Genome = defaultGenome()): NextWork {
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

  // Classification and resolution are genome-driven: `class-priority` ranking
  // orders by `klass`, and a klass derived from a compiled-in classifier while
  // the genome declares a different vocabulary would rank against classes that
  // do not exist.
  const allOpenUnknowns: OpenUnknown[] = rankOpenUnknowns(
    tree
      .filter((n) => n.layer === "Unknown" && resolutionState(n, genome.resolution) === "open")
      .map((u) => ({
        title: u.title,
        klass: classifyUnknown(u, genome.classifier),
        darkens: tree.find((p) => p.layer !== "Unknown" && p.links.includes(u.title))?.title ?? null,
        gaps: contractGaps(u, genome.classifier.contractSections),
      })),
    genome.pivot,
    // Lazily, and only where it is read: the default genome must not pay for a
    // ledger walk on every `ost_next_work`.
    genome.pivot.ranking === "cost-to-resolve" ? costIndex(tree, dir, genome) : undefined,
  );

  // The cap is a display limit, never an amnesty: `done` is computed over every
  // open unknown, and the hidden count is named in the summary. A cap that
  // silently shortened the list would read as "that is all the darkness there is".
  const cap = genome.pivot.maxOpenUnknownsSurfaced;
  const openUnknowns = cap > 0 ? allOpenUnknowns.slice(0, cap) : allOpenUnknowns;
  const hidden = allOpenUnknowns.length - openUnknowns.length;
  const blocksDone = genome.pivot.unknownsBlockDone;

  const done =
    unmappedEvidence.length === 0 &&
    underservedOpportunities.length === 0 &&
    solutionsMissingAssumptions.length === 0 &&
    hygieneIssues.length === 0 &&
    (!blocksDone || allOpenUnknowns.length === 0);

  const parts: string[] = [];
  if (unmappedEvidence.length) parts.push(`${unmappedEvidence.length} unmapped evidence item(s) → map into #Opportunity nodes`);
  if (underservedOpportunities.length) parts.push(`${underservedOpportunities.length} opportunity(ies) with < ${min} solutions → ideate #Solution nodes`);
  if (solutionsMissingAssumptions.length) parts.push(`${solutionsMissingAssumptions.length} solution(s) with no assumption test → surface #AssumptionTest nodes`);
  if (hygieneIssues.length) parts.push(`${hygieneIssues.length} hygiene issue(s) → annotate (never delete)`);
  if (allOpenUnknowns.length)
    parts.push(
      `${allOpenUnknowns.length} open unknown(s) → explore (${blocksDone ? "blocks done" : "does not block done"})`,
    );

  const truncationNote = hidden
    ? ` Showing ${openUnknowns.length} of ${allOpenUnknowns.length} — ${hidden} more open unknown(s) not listed (pivot.maxOpenUnknownsSurfaced=${cap}).`
    : "";
  const summary = done
    ? allOpenUnknowns.length
      ? `Tree is fully maintained — nothing to do. ${allOpenUnknowns.length} open unknown(s) remain to explore (does not block done).${truncationNote}`
      : "Tree is fully maintained — nothing to do."
    : `Outstanding: ${parts.join("; ")}.${truncationNote}`;

  return { done, summary, unmappedEvidence, underservedOpportunities, solutionsMissingAssumptions, hygieneIssues, openUnknowns };
}
