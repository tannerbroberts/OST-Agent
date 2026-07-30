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
import type { Actor } from "../adapters/source.js";
import { checkInvariants } from "../eval/invariants.js";
import { scanNearDuplicates } from "../ost/dedupe.js";
import { withoutRetiredNodes } from "../ost/census.js";
import type { OstNode } from "../ost/node.js";
import type { Vault } from "../ost/vault.js";
import { classifyUnknown, contractGaps, resolutionState, type UnknownClass } from "../knowledge/unknowns.js";

export interface UnmappedEvidence {
  id: string;
  source: string;
  title: string;
  excerpt: string;
  /**
   * Which channel produced it, stamped at capture. Surfaced because a mapping session
   * weighs a first-party transcript rollup and an anonymous drop-folder note
   * differently, and `source` cannot carry that: for the inbox it is a filename the
   * producer chose. `unknown` means the record predates the stamp.
   */
  actor: Actor;
}
export interface UnderservedOpportunity {
  title: string;
  /** How many solutions it actually has. Never capped — this is the count `needed` is compared against. */
  solutions: number;
  needed: number;
  /**
   * A SAMPLE of the existing solution titles, at most
   * {@link MAX_LISTED_CHILDREN}. `solutions` above is the true number, so this
   * list can be short without hiding anything: an opportunity with 4,000
   * children would otherwise put 4,000 titles into one response entry, and one
   * entry is enough to blow a whole response budget on its own (Z2).
   */
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

/** A node the duplicate scan did not see, because it has left the live tree. */
export interface RetiredNode {
  /** The node's title (the archive's file basename, when it was archived). */
  node: string;
  /** What retired it — a status, or the archive directory. */
  reason: string;
}

/**
 * One list that was shortened for display, and by how much.
 *
 * The point of the shape is that the *total* travels with the sample. A capped
 * list that reported only what it showed would read as the whole truth — "that
 * is all the darkness there is" — which turns a display limit into an amnesty.
 * Every number here is taken over the full set, before any cap.
 */
export interface Truncation {
  /** The `NextWork` field this describes. */
  list: string;
  shown: number;
  total: number;
  hidden: number;
}

export interface NextWork {
  done: boolean;
  summary: string;
  /**
   * P2 — evidence captured but not yet distilled into opportunities.
   * May be capped; see {@link NextWork.truncated}.
   */
  unmappedEvidence: UnmappedEvidence[];
  /** P3 — opportunities with fewer than `min` candidate solutions. May be capped. */
  underservedOpportunities: UnderservedOpportunity[];
  /** P4 — solutions with no assumption test surfaced yet. May be capped. */
  solutionsMissingAssumptions: BareSolution[];
  /** Structural issues that should be annotated (never auto-fixed). May be capped. */
  hygieneIssues: HygieneIssue[];
  /**
   * Darkness the tree has declared and not yet resolved. Reported as available
   * work but deliberately NOT part of `done`: an unbounded unknown has no
   * stopping condition, so counting it toward completion would wedge every pass
   * forever. `done` means maintenance is complete; exploration is discretionary
   * and budget-governed.
   *
   * May be capped. `done` never is: it is computed over every open unknown,
   * before the cap applies.
   */
  openUnknowns: OpenUnknown[];
  /**
   * Nodes withheld from the near-duplicate scan because they are retired (Z4).
   * Named rather than counted, and named here rather than nowhere: a node that
   * leaves a denominator silently is how a count starts lying. May be capped.
   */
  retiredFromDuplicateScan: RetiredNode[];
  /**
   * Every list above that was shortened, with the count it was shortened from.
   *
   * Empty on an ordinary tree. Non-empty means the response is a window onto a
   * larger set — and the numbers here, not the array lengths, are what `done`
   * and the summary were computed from.
   */
  truncated: Truncation[];
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
function detectHygiene(tree: OstNode[], live: OstNode[], limit: number): { issues: HygieneIssue[]; total: number } {
  const index = byTitle(tree);

  // Parsed once per node rather than once per issue. On a duplicated tree one
  // node carries thousands of issues, and re-splitting its body for each of them
  // made the suppression step quadratic in the size of the thing it was
  // suppressing — the same shape of defect as the dedupe scan itself (Z3).
  const annotatedCache = new Map<string, Set<string>>();
  const alreadyAnnotated = (title: string, issue: string): boolean => {
    let set = annotatedCache.get(title);
    if (set === undefined) {
      const node = index.get(title);
      set = node ? annotatedIssues(node.body) : new Set<string>();
      annotatedCache.set(title, set);
    }
    return set.has(issue.trim());
  };

  const issues: HygieneIssue[] = [];
  let total = 0;
  /*
   * Count everything, materialize a bounded prefix.
   *
   * `total` is what `done` reads, so suppression has to happen HERE and not
   * after the cap: an issue the node has already been annotated with is not
   * outstanding, and counting it would mean a swept tree could never reach
   * `done`. Equally, the cap must not touch `total`, or annotating the visible
   * 25 of 125,750 duplicates would report the tree clean. Cap the display,
   * count the full set — the pattern `openUnknowns` already used.
   */
  const take = (issue: HygieneIssue): void => {
    if (alreadyAnnotated(issue.title, issue.issue)) return;
    total++;
    if (issues.length < limit) issues.push(issue);
  };

  // The mandate is the one node guaranteed to exist, so it is where a violation
  // that names no node of its own gets attached — an issue with no node is an
  // issue no one can annotate, and therefore a wedge.
  const outcome = tree.find((n) => n.layer === "Outcome")?.title;
  for (const v of checkInvariants(tree)) {
    if (v.rule in NOT_DONE_BLOCKING) continue;
    const title = v.node ?? outcome;
    if (!title) continue; // nothing to hang it on; the parity test is what keeps this unreachable
    take({ title, issue: `${HYGIENE_LABELS[v.rule] ?? v.rule}: ${v.detail}`, rule: v.rule });
  }
  // Likely duplicates (same-layer near-identical titles) — flagged for a human,
  // never merged. Taken over `live`, the tree with retired nodes withheld (Z4);
  // every rule above is taken over the whole tree, because those are the ones a
  // retirement must never be able to clear.
  //
  // Pulled from a generator so a 5,000-node duplicated vault costs the ~25
  // objects it displays instead of the 12.5M pairs it contains.
  for (const d of scanNearDuplicates(live)) take({ ...d, rule: "near-duplicate" });
  return { issues, total };
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
 * How many items any one list in this response may show.
 *
 * A single number rather than a knob per list, because the property being bought
 * is a bound on the WHOLE response and one generous list is enough to lose it.
 * Sized against the worst case rather than the typical one: node titles are
 * clamped to 200 characters (`ost/sanitize.ts`), evidence excerpts to 280, and
 * an invariant detail can run several hundred more, so 25 items across six lists
 * is a few tens of KB even when every string is at its maximum — comfortably
 * inside the 200 KB the criterion names, with the pretty-printing
 * `ost_next_work` applies included.
 *
 * This is a DISPLAY limit and nothing else. `done`, every count in `summary` and
 * every number in `truncated` are computed over the full set. A cap that changed
 * a verdict would be a cap that reads as amnesty, which is precisely the failure
 * the criterion is about.
 *
 * The throughput cost is real and is the intended trade: `/ost-pass` clears 25
 * items, re-reads, and clears 25 more. It already loops.
 */
export const MAX_ITEMS_PER_LIST = 25;

/** How many child titles one entry may name. See {@link UnderservedOpportunity.existingSolutions}. */
export const MAX_LISTED_CHILDREN = 5;

/**
 * Cap one list, recording what was hidden.
 *
 * Returns the sample and pushes a {@link Truncation} onto `into` only when
 * something was actually hidden — an empty `truncated` array is a response that
 * shows everything, which is a fact worth being able to read off directly.
 */
function capList<T>(list: T[], name: string, into: Truncation[], limit = MAX_ITEMS_PER_LIST, total = list.length): T[] {
  const shown = list.slice(0, limit);
  if (total > shown.length) into.push({ list: name, shown: shown.length, total, hidden: total - shown.length });
  return shown;
}

/**
 * Compute the outstanding maintenance work for the tree in `vault` (dir holds the
 * `.ost-agent/` evidence + state sidecar). `min` is minSolutionsPerOpportunity,
 * an operator knob from `ost.config.yaml`.
 */
export function computeNextWork(vault: Vault, dir: string, min: number): NextWork {
  // ONE parse. The census is read rather than `readTree()` so the retired
  // accounting Z4 needs comes from the same walk that produced the nodes —
  // a second read would be a second walk, and a second walk can disagree.
  const census = vault.readTreeCensus();
  const tree = census.nodes;
  const index = byTitle(tree);

  // The duplicate scan, and only the duplicate scan, is taken over the live set.
  // Everything below — including every term of `done` — reads `tree`.
  const liveCensus = withoutRetiredNodes(census);
  const allRetired: RetiredNode[] = liveCensus.retired.map((r) => ({
    node: r.file.replace(/\.md$/, ""),
    reason: r.reason,
  }));

  /*
   * Parent lookups, indexed.
   *
   * These two were `tree.find(...)` inside a `.map(...)` — a scan of the whole
   * tree per solution and per unknown, i.e. two more quadratic passes sitting
   * beside the one Z3 names. Built by walking the tree ONCE in order and keeping
   * the FIRST parent seen, which is exactly what `find` returned.
   */
  const firstOpportunityParent = new Map<string, string>();
  const firstNonUnknownParent = new Map<string, string>();
  for (const p of tree) {
    const isOpportunity = p.layer === "Opportunity";
    const isNonUnknown = p.layer !== "Unknown";
    if (!isOpportunity && !isNonUnknown) continue;
    for (const l of p.links) {
      if (isOpportunity && !firstOpportunityParent.has(l)) firstOpportunityParent.set(l, p.title);
      if (isNonUnknown && !firstNonUnknownParent.has(l)) firstNonUnknownParent.set(l, p.title);
    }
  }

  // Evidence counts as mapped if any node in the tree cites it as its `source` — that is
  // how a session records the mapping, via ost_create_node's `source`. `mapped.json` is
  // read too, because vaults mapped before the batch runner was deleted recorded it there
  // and nowhere else; deriving "mapped" from the tree as well is what lets /ost-pass reach
  // done on a vault the session mapped itself.
  const mapped = getMapped(dir);
  const citedSources = new Set(tree.map((n) => n.source).filter((s): s is string => !!s));
  const allUnmappedEvidence: UnmappedEvidence[] = readEvidence(dir)
    .filter((e) => !mapped.has(e.id) && !citedSources.has(e.id))
    .map((e) => ({ id: e.id, source: e.source, title: e.title, excerpt: e.body.slice(0, 280), actor: e.actor }));

  const allUnderservedOpportunities: UnderservedOpportunity[] = tree
    .filter((n) => n.layer === "Opportunity")
    .map((o) => {
      const existing = childrenOfLayer(o, index, "Solution");
      // `solutions` is the real count and `existingSolutions` a sample of it —
      // the one comparison that matters (`solutions < min`) is made on the count.
      return {
        title: o.title,
        solutions: existing.length,
        needed: min,
        existingSolutions: existing.slice(0, MAX_LISTED_CHILDREN),
      };
    })
    .filter((o) => o.solutions < min);

  const allSolutionsMissingAssumptions: BareSolution[] = tree
    .filter((n) => n.layer === "Solution")
    .filter((s) => childrenOfLayer(s, index, "AssumptionTest").length === 0)
    .map((s) => ({ title: s.title, opportunity: firstOpportunityParent.get(s.title) ?? null }));

  const hygiene = detectHygiene(tree, liveCensus.nodes, MAX_ITEMS_PER_LIST);

  // Tree order — the order the walk produced.
  const allOpenUnknowns: OpenUnknown[] = tree
    .filter((n) => n.layer === "Unknown" && resolutionState(n) === "open")
    .map((u) => ({
      title: u.title,
      klass: classifyUnknown(u),
      darkens: firstNonUnknownParent.get(u.title) ?? null,
      gaps: contractGaps(u),
    }));

  // Every cap is a display limit, never an amnesty: `done` and every count below
  // are taken over the full sets, and each hidden count is named — both in
  // `truncated` and in the summary a human reads. A cap that silently shortened
  // a list would read as "that is all there is".
  const truncated: Truncation[] = [];
  const unmappedEvidence = capList(allUnmappedEvidence, "unmappedEvidence", truncated);
  const underservedOpportunities = capList(allUnderservedOpportunities, "underservedOpportunities", truncated);
  const solutionsMissingAssumptions = capList(allSolutionsMissingAssumptions, "solutionsMissingAssumptions", truncated);
  // `hygiene.issues` is already bounded at the source (it is never fully
  // materialized), so the total has to come from the scan rather than from the
  // array's length — the one list here whose full set is never in memory.
  const hygieneIssues = capList(hygiene.issues, "hygieneIssues", truncated, MAX_ITEMS_PER_LIST, hygiene.total);
  const openUnknowns = capList(allOpenUnknowns, "openUnknowns", truncated);
  const retiredFromDuplicateScan = capList(allRetired, "retiredFromDuplicateScan", truncated);

  const done =
    allUnmappedEvidence.length === 0 &&
    allUnderservedOpportunities.length === 0 &&
    allSolutionsMissingAssumptions.length === 0 &&
    hygiene.total === 0;

  const parts: string[] = [];
  if (allUnmappedEvidence.length) parts.push(`${allUnmappedEvidence.length} unmapped evidence item(s) → map into #Opportunity nodes`);
  if (allUnderservedOpportunities.length) parts.push(`${allUnderservedOpportunities.length} opportunity(ies) with < ${min} solutions → ideate #Solution nodes`);
  if (allSolutionsMissingAssumptions.length) parts.push(`${allSolutionsMissingAssumptions.length} solution(s) with no assumption test → surface #AssumptionTest nodes`);
  if (hygiene.total) parts.push(`${hygiene.total} hygiene issue(s) → annotate (never delete)`);
  if (allOpenUnknowns.length)
    parts.push(`${allOpenUnknowns.length} open unknown(s) → explore (does not block done)`);

  const truncationNote = truncated.length
    ? ` Lists are capped at ${MAX_ITEMS_PER_LIST}: ` +
      truncated.map((t) => `${t.list} showing ${t.shown} of ${t.total} (${t.hidden} not listed)`).join("; ") +
      `. Every count above is over the full set.`
    : "";
  // Retirement is reported whether or not it truncated anything, because the
  // thing worth saying is that the duplicate scan had a smaller denominator than
  // the gates did — a silent exclusion is the defect, not a long list.
  const retirementNote = allRetired.length
    ? ` ${allRetired.length} retired node(s) were withheld from the duplicate scan only (every gate still counts them): ` +
      `${retiredFromDuplicateScan.map((r) => r.node).join(", ")}${allRetired.length > retiredFromDuplicateScan.length ? ", …" : ""}.`
    : "";
  const summary = done
    ? allOpenUnknowns.length
      ? `Tree is fully maintained — nothing to do. ${allOpenUnknowns.length} open unknown(s) remain to explore (does not block done).${truncationNote}${retirementNote}`
      : `Tree is fully maintained — nothing to do.${retirementNote}`
    : `Outstanding: ${parts.join("; ")}.${truncationNote}${retirementNote}`;

  return {
    done,
    summary,
    unmappedEvidence,
    underservedOpportunities,
    solutionsMissingAssumptions,
    hygieneIssues,
    openUnknowns,
    retiredFromDuplicateScan,
    truncated,
  };
}
