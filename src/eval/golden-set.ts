/**
 * The golden-set scorer — one number per tree, so trees can be compared.
 *
 * Everything else under `eval/` answers a yes/no question about one node or
 * one edge: is this link dangling, did this test record a result, does this
 * rung outrun its backing. None of it says how GOOD a tree is, so nothing
 * could say whether a change to the agent made its trees better or worse.
 * That is the gap the golden set fills: a set of committed fixtures — trees
 * known to be good and trees deliberately broken in named ways — and a scorer
 * that must put every good one above every broken one. The committed spec
 * (`test/eval/golden-set-discrimination.test.ts`) asserts that per pair, not
 * on the means, because a harness whose averages separate while individual
 * pairs overlap has discriminated nothing.
 *
 * The score is five dimensions, each the fraction of some population that is
 * in order, averaged. The dimensions are the breakages the assumption test
 * names — a solution written as an opportunity, a node with no grounding, a
 * solution with no assumption beneath it — plus the two floors this product
 * already gates on: structural invariants and fixed bars. They are drawn from
 * what the product already checks wherever it already checks it, so the
 * scorer cannot disagree with `ost-agent check` about what a violation is.
 *
 * What a score does NOT mean, stated so nobody reads it as more: a high score
 * says the tree is free of the breakages this file knows how to look for. The
 * degraded fixtures are broken in ways their author imagined, and a margin
 * over them is no evidence the scorer recognises a bad tree nobody planted.
 * Whether the score tracks anything a human would call quality is the
 * humans-required half of the assumption test, and nothing here grades it.
 */
import type { OstNode } from "../ost/node.js";
import { byTitle, testsUnderSolution } from "../processes/tree.js";
import { thresholdKindOf } from "./coverage.js";
import { checkInvariants } from "./invariants.js";
import { solutionProse } from "./judge-panel.js";

/** The dimensions, in the order a report prints them. */
export const SCORE_DIMENSIONS = ["structure", "need-shaped", "grounded", "tested", "fixed-bars"] as const;

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

export interface DimensionScore {
  readonly dimension: ScoreDimension;
  /** In [0, 1]; 1 is every member of the population in order. */
  readonly value: number;
  /** How many were in order. */
  readonly inOrder: number;
  /** The population the dimension was read over. Zero reads as a zero score, never as a clean one. */
  readonly of: number;
  /** The members that were NOT in order, by title — what to go fix. */
  readonly failing: readonly string[];
}

export interface TreeScore {
  /** Sweep discipline: a score over nothing must be visible as such. */
  readonly subject: { readonly offered: number; readonly read: number };
  readonly dimensions: readonly DimensionScore[];
  /** The arithmetic mean of the dimensions, in [0, 1]. */
  readonly score: number;
  /** The dimension with the lowest value — the first thing a reader should look at. */
  readonly weakest: ScoreDimension;
}

/**
 * What an Opportunity's wording reads as.
 *
 * The ruleset says an opportunity is "an unmet customer need, pain point, or
 * desire from the customer's perspective, never a solution, feature, or
 * business ask". This is the shallow, mechanical reading of that sentence:
 * a title that opens on a build verb or names a feature is solution-shaped;
 * a title or argument in the first person, or naming a lack, is need-shaped.
 * Anything else is `unclear`, and scores half — the rule must not punish a
 * need it merely failed to recognise, because that is how a scorer gets
 * ignored.
 */
export type OpportunityShape = "need" | "solution" | "unclear";

/**
 * Verbs that open a piece of work rather than a need. A closed list on purpose:
 * "Trust an unmonitored agent enough to walk away" and "Give me the most
 * efficient mapping" open on verbs and are needs, so an open-ended imperative
 * test would misfile real opportunities as solutions.
 */
const BUILD_VERBS = new Set([
  "add",
  "build",
  "create",
  "implement",
  "ship",
  "write",
  "integrate",
  "expose",
  "generate",
  "automate",
  "provide",
  "render",
  "emit",
  "display",
  "store",
  "cache",
  "deploy",
  "install",
  "migrate",
  "refactor",
  "wire",
  "introduce",
  "enable",
  "launch",
  "publish",
  "schedule",
  "configure",
  "embed",
  "export",
  "import",
  "sync",
  "offer",
]);

/** Nouns that name a thing to be built rather than a need to be met. */
const FEATURE_NOUNS =
  /\b(button|dashboard|api|endpoint|command|flag|cli|widget|integration|plugin|webhook|notification|database|modal|page|screen|script|cron|toggle|setting|feature|template|dropdown|slider|chatbot|leaderboard)\b/i;

/**
 * The customer's voice, or a lack. First-person pronouns are the strongest
 * signal — an opportunity is stated "from the customer's perspective" — and
 * the rest are the words a need is usually made of.
 */
const NEED_MARKERS =
  /\b(i|i'm|i've|i'd|my|me|we|we're|our|us)\b|\b(can't|cannot|can not|don't|doesn't|won't|never|need|needs|want|wants|wish|hard|harder|worry|worrying|worried|afraid|fear|unsure|no idea|no way to|too (?:far|slow|long|many|much|late)|takes too|nothing tells|without knowing|struggle|struggles|frustrat\w*|painful|confus\w*)\b/i;

/** Markdown emphasis and code stripped, so the markers see words. */
function plain(text: string): string {
  return text.replace(/\*\*|\*|`|\[\[|\]\]/g, "");
}

/** Read an Opportunity's shape from its title first, its argument second. */
export function opportunityShape(node: OstNode): OpportunityShape {
  const title = plain(node.title);
  const opener = title.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z']/g, "") ?? "";
  const titleSolution = BUILD_VERBS.has(opener) || FEATURE_NOUNS.test(title);
  const titleNeed = NEED_MARKERS.test(title);
  // A solution-shaped title is a solution however the body justifies it:
  // "Add a dashboard" is a feature even when the paragraph beneath it says why.
  if (titleSolution && !titleNeed) return "solution";
  if (titleNeed || NEED_MARKERS.test(plain(solutionProse(node.body)))) return "need";
  return "unclear";
}

const SHAPE_SCORE: Record<OpportunityShape, number> = { need: 1, unclear: 0.5, solution: 0 };

/**
 * One dimension, read over a population. `value` is the sum of per-member
 * scores over the population size, so a dimension may fail a member partially
 * (an `unclear` opportunity) while the report still names it.
 */
function dimension(
  name: ScoreDimension,
  members: readonly { title: string; score: number }[],
): DimensionScore {
  const total = members.reduce((sum, m) => sum + m.score, 0);
  return {
    dimension: name,
    value: members.length === 0 ? 0 : total / members.length,
    inOrder: members.filter((m) => m.score >= 1).length,
    of: members.length,
    failing: members.filter((m) => m.score < 1).map((m) => m.title),
  };
}

/**
 * Score a tree.
 *
 * Pure over the tree it is handed — reads nothing, writes nothing — and every
 * population is explicit in the report, so a fixture with no tests cannot
 * score full marks on `fixed-bars` by having nothing to get wrong: an empty
 * population is a zero, the same posture `ost/sweep.ts` takes for a sweep
 * over nothing.
 */
export function scoreTree(tree: readonly OstNode[]): TreeScore {
  const nodes = [...tree];
  const index = byTitle(nodes);

  // 1. Structure — the invariants `ost-agent check` gates on, read as a
  //    fraction of nodes rather than a count so a 9-node fixture and a
  //    9,000-node vault are on the same scale. The population is the tree;
  //    a node is "in order" when no violation names it. A violation naming no
  //    node (single-outcome) is charged to the whole tree.
  const violations = checkInvariants(nodes);
  const violatedTitles = new Set(violations.filter((v) => v.node).map((v) => v.node!));
  const treeWide = violations.some((v) => !v.node);
  const structure = dimension(
    "structure",
    nodes.map((n) => ({ title: n.title, score: treeWide || violatedTitles.has(n.title) ? 0 : 1 })),
  );

  // 2. Need-shaped — every Opportunity states a need, not a feature.
  const needShaped = dimension(
    "need-shaped",
    nodes
      .filter((n) => n.layer === "Opportunity")
      .map((n) => ({ title: n.title, score: SHAPE_SCORE[opportunityShape(n)] })),
  );

  // 3. Grounded — every node beneath the Outcome points at where it came from
  //    and declares what it rests on. The Outcome is exempt: the mandate is the
  //    human's to declare, not to source.
  const grounded = dimension(
    "grounded",
    nodes
      .filter((n) => n.layer !== "Outcome")
      .map((n) => ({ title: n.title, score: n.source?.trim() && n.evidence ? 1 : 0 })),
  );

  // 4. Tested — every Solution has an assumption test beneath it. Read through
  //    `testsUnderSolution`, the same walk the build gate uses, so a legacy
  //    Solution→AssumptionTest edge counts here exactly as it counts there.
  const tested = dimension(
    "tested",
    nodes
      .filter((n) => n.layer === "Solution")
      .map((n) => ({ title: n.title, score: testsUnderSolution(n, index).length > 0 ? 1 : 0 })),
  );

  // 5. Fixed bars — every AssumptionTest fixed a bar before any run. `prose`
  //    counts: "the piece survives a page reload" is a commitment in words, and
  //    `coverage.ts` is explicit about not nagging it.
  const fixedBars = dimension(
    "fixed-bars",
    nodes
      .filter((n) => n.layer === "AssumptionTest")
      .map((n) => {
        const kind = thresholdKindOf(n);
        return { title: n.title, score: kind === "bound" || kind === "prose" ? 1 : 0 };
      }),
  );

  const dimensions = [structure, needShaped, grounded, tested, fixedBars];
  const score = dimensions.reduce((sum, d) => sum + d.value, 0) / dimensions.length;
  const weakest = dimensions.reduce((w, d) => (d.value < w.value ? d : w)).dimension;
  return { subject: { offered: tree.length, read: nodes.length }, dimensions, score, weakest };
}

const pct = (value: number): string => `${Math.round(value * 100)}%`;

/**
 * The report an operator reads: the score, then every dimension with its
 * population and what failed it. The failing titles are the point — a score
 * with no names attached is a grade nobody can act on.
 */
export function renderScore(report: TreeScore): string {
  const { offered, read } = report.subject;
  if (read === 0) {
    return `score: BLIND — read 0 of ${offered} node(s), so no score exists.`;
  }
  const lines: string[] = [];
  lines.push(`score: ${pct(report.score)} over ${read} node(s); weakest dimension ${report.weakest}.`);
  for (const d of report.dimensions) {
    const population = d.of === 0 ? "nothing to read — scores 0" : `${d.inOrder} of ${d.of} in order`;
    lines.push(`  ${d.dimension.padEnd(11)} ${pct(d.value).padStart(4)}  (${population})`);
    for (const title of d.failing) lines.push(`    - ${title}`);
  }
  return lines.join("\n");
}
