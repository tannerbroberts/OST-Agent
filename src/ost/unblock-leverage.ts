/**
 * Unblocking leverage — how many blocked assumption tests one build would make
 * readable, and whether that number separates the candidates at all.
 *
 * The solution this serves is "Rank every node by how many blocked tests one
 * build would unblock", and its own body names the check that has to come first:
 * *"If most tests turn out to be independent, leverage is near-uniform and the
 * ranking says nothing."* That is the assumption test
 * `test/rank/unblock-leverage-distribution.test.ts` pins, and this module is the
 * computation it reads. Nothing here ranks anything or writes anything — it
 * counts, and reports the distribution of the counts against a bar fixed before
 * the sweep ({@link UNBLOCK_LEVERAGE_RULE}).
 *
 * ## What counts as unblocking, and why there are only two edges
 *
 * A candidate build is a **Solution** — the layer a pass can pick up and ship,
 * and the one the node says to order ("for each candidate build"). A test is
 * **blocked** when it has no recorded result; which further conditions count is
 * the reading ({@link LEVERAGE_READINGS}), because "readable" has more than one
 * defensible meaning and the verdict should not turn on which one is picked.
 *
 * Two edges make a blocked test readable, and both are read off structure the
 * tree already holds. Neither is inferred from prose, for the reason
 * {@link ./prerequisites.ts} states at length: an ordering claim guessed at from
 * a paragraph is a claim nobody made and nobody can argue with.
 *
 *   1. **Coverage.** Shipping a solution makes the tests beneath it readable.
 *      In a vault written to this repository's definition-of-done convention
 *      this is literally true — a test under a solution carries an instrument
 *      that is red *because* the solution is not built — but it is fan-out, not
 *      leverage: it can only ever count a solution's own children.
 *   2. **Prerequisite.** A test that declares another as its prerequisite
 *      becomes readable once every prerequisite it declares is answered. So
 *      shipping the solution that answers test P also unblocks whatever was
 *      waiting on P, and on whatever that unblocks in turn. This is the edge the
 *      leverage claim actually rests on, and the only one that can reach across
 *      the tree.
 *
 * The propagation is **transitive and conjunctive**, which is the solution
 * node's reading ("the size of the transitive set a node unblocks") and
 * deliberately not the one {@link ./prerequisites.ts:unmetPrerequisites} takes.
 * That function answers "may the sweep offer this test today", where a single
 * hop is the weakest claim consistent with what the author wrote; this one
 * answers "what would ship if this landed", where withholding a test whose
 * second prerequisite is still open would overstate the build's reach. A test
 * with two prerequisites is unblocked by a build only when the build answers
 * both.
 *
 * ## The graph is data, not a vault read
 *
 * {@link LeverageGraph} is plain, serialisable facts so the same computation
 * runs over a live vault and over a committed snapshot of one. The sweep this
 * module exists for is measured against a fixture
 * (`test/fixtures/unblock-leverage/`) cut by
 * `scripts/harvest-unblock-leverage-corpus.ts`, because a test that reads a path
 * only the maintainer's machine has is a test that skips on CI — and a skipped
 * file reports green, which is the failure `vitest.config.ts` refuses by name.
 */

/** The bar, fixed by the assumption test before anything was swept. */
export interface UnblockLeverageRule {
  /**
   * The top-ranked build must unblock at least this many times the median
   * build's count. Below it, the head of the order is not distinguishable from
   * its middle.
   */
  minMaxToMedianRatio: number;
  /**
   * The top decile of candidates must carry at least this share of all
   * unblockings. The ratio alone can be cleared by a single outlier over an
   * otherwise-uniform field; this clause is what asks for a *distribution* with
   * a head rather than one lucky node.
   */
  minTopDecileShare: number;
  /** What "top decile" means, stated rather than assumed. */
  topFraction: number;
}

/**
 * Transcribed from the threshold on "Compute the unblock-count distribution over
 * this vault and require it to be non-flat", 2026-08-06: *"The top-ranked build
 * unblocks at least 3x the median build's count, and the top decile accounts for
 * at least 25% of all unblockings."*
 *
 * Committed as data so a later edit to the bar is a visible diff rather than a
 * quietly different finding.
 */
export const UNBLOCK_LEVERAGE_RULE: UnblockLeverageRule = {
  minMaxToMedianRatio: 3,
  minTopDecileShare: 0.25,
  topFraction: 0.1,
};

/** One assumption test, reduced to what decides whether a build could unblock it. */
export interface TestFacts {
  title: string;
  /** A recorded result — the test is answered, so no build unblocks it. */
  hasResult: boolean;
  /** An `instrument:` command. Without one, nothing shipping makes it machine-readable. */
  hasInstrument: boolean;
  /** A `threshold:` bar. Without one it cannot come out a failure, so a run of it settles nothing. */
  hasThreshold: boolean;
}

/** One candidate build: a Solution, and the tests its own subtree covers. */
export interface CandidateFacts {
  title: string;
  status?: string;
  /** Titles of the assumption tests beneath it, via an Assumption or a legacy direct edge. */
  coverage: string[];
}

/**
 * One Opportunity and every test transitively beneath it.
 *
 * Not a candidate build — an opportunity is a problem, not a thing anyone ships
 * — and carried only so the sweep can report what happens when the candidate
 * layer is widened. See the note on {@link branchCounts}.
 */
export interface BranchFacts {
  title: string;
  tests: string[];
}

/** A declared ordering edge: `test` cannot be answered until `prerequisite` is. */
export interface LeverageEdge {
  test: string;
  prerequisite: string;
}

/** Everything the computation needs, in a shape that survives JSON. */
export interface LeverageGraph {
  tests: TestFacts[];
  candidates: CandidateFacts[];
  branches: BranchFacts[];
  prerequisites: LeverageEdge[];
}

/**
 * Which blocked tests a build is credited with unblocking.
 *
 * Three readings rather than one, for the same reason the pass-shape corpus
 * measures its label predicate both ways: the question is whether the finding
 * survives the arguable calls, and a single reading cannot answer that.
 */
export interface LeverageReading {
  id: string;
  /** What the reading claims, in the words a reader of the sweep needs. */
  describes: string;
  /** Is this test one a build could be credited with unblocking? */
  blocked: (t: TestFacts) => boolean;
}

export const LEVERAGE_READINGS: readonly LeverageReading[] = [
  {
    id: "unanswered",
    describes: "every test with no recorded result — the widest reading, and the one the node's own wording takes",
    blocked: (t) => !t.hasResult,
  },
  {
    id: "instrumented",
    describes: "unanswered tests carrying an instrument — a test with no command is not made readable by shipping anything",
    blocked: (t) => !t.hasResult && t.hasInstrument,
  },
  {
    id: "pre-committed",
    describes: "unanswered, instrumented, and carrying a fixed bar — the only tests whose run could come out a failure",
    blocked: (t) => !t.hasResult && t.hasInstrument && t.hasThreshold,
  },
] as const;

/** The reading a caller gets when it does not choose: the node's own wording. */
export const WIDEST_READING = LEVERAGE_READINGS[0];

/**
 * The tests one candidate would unblock, as titles in a stable order.
 *
 * A blocked test `T` is in the set when **both** hold:
 *
 *   - every prerequisite `T` declares is *satisfied* — already answered, or in
 *     this same set, or naming nothing in the graph; and
 *   - `T` is either covered by this candidate, or waiting on something that is.
 *
 * The first clause is what makes the reading conjunctive, and it applies to
 * covered tests too. Shipping the solution a test hangs under does not make that
 * test readable while it is still waiting on an answer from somewhere else, and
 * crediting the build with it anyway would be counting the same unblocking
 * twice — once for the solution that covers the test and once for the one that
 * clears its prerequisite.
 *
 * A prerequisite naming nothing in the graph holds nothing back, the same
 * asymmetry {@link ./prerequisites.ts:unknownPrerequisites} takes and for the
 * same reason: a typo must not silently confer leverage or withhold it.
 */
export function unblockedBy(graph: LeverageGraph, candidate: CandidateFacts, reading: LeverageReading): string[] {
  const facts = new Map(graph.tests.map((t) => [t.title, t]));
  const blocked = (title: string): boolean => {
    const t = facts.get(title);
    return t !== undefined && reading.blocked(t);
  };

  // Edges grouped by the blocked end, so the fixed point walks waiting tests
  // rather than re-scanning every edge for every addition.
  const waitingOn = new Map<string, string[]>();
  for (const { test, prerequisite } of graph.prerequisites) {
    const already = waitingOn.get(test);
    if (already) already.push(prerequisite);
    else waitingOn.set(test, [prerequisite]);
  }

  const covered = new Set(candidate.coverage);
  const opened = new Set<string>();
  const satisfied = (p: string): boolean => opened.has(p) || !facts.has(p) || facts.get(p)!.hasResult;

  const admits = (title: string): boolean => {
    if (opened.has(title) || !blocked(title)) return false;
    const prerequisites = waitingOn.get(title) ?? [];
    if (!prerequisites.every(satisfied)) return false;
    return covered.has(title) || prerequisites.some((p) => opened.has(p));
  };

  // At most one test enters per round, so the walk terminates in |tests| rounds
  // even if the declared edges contain a cycle — which they may, since nothing
  // outside the write path refuses one and a snapshot is not a write path.
  const reachable = [...new Set([...candidate.coverage, ...waitingOn.keys()])];
  for (let round = 0; round < graph.tests.length; round++) {
    let grew = false;
    for (const title of reachable) {
      if (!admits(title)) continue;
      opened.add(title);
      grew = true;
    }
    if (!grew) break;
  }

  return [...opened].sort();
}

/** The unblock count for every candidate, in graph order. */
export function unblockCounts(graph: LeverageGraph, reading: LeverageReading = WIDEST_READING): number[] {
  return graph.candidates.map((c) => unblockedBy(graph, c, reading).length);
}

/**
 * The same count for every Opportunity, over the tests transitively beneath it.
 *
 * Reported by the sweep and never mistaken for the claim. An opportunity is not
 * a build, and because opportunities nest, a test beneath a sub-opportunity is
 * counted again for every ancestor — so the total here exceeds the number of
 * tests in the tree, which a leverage total cannot do. It is here because it is
 * the one reading of this vault that clears the bar, and a sweep that reported
 * only the readings that failed would be hiding that.
 */
export function branchCounts(graph: LeverageGraph, reading: LeverageReading = WIDEST_READING): number[] {
  const facts = new Map(graph.tests.map((t) => [t.title, t]));
  return graph.branches.map(
    (b) => b.tests.filter((title) => { const t = facts.get(title); return t !== undefined && reading.blocked(t); }).length,
  );
}

/** The shape of a set of counts, and the verdict against the rule. */
export interface LeverageDistribution {
  candidates: number;
  totalUnblockings: number;
  median: number;
  max: number;
  /**
   * `max / median`, or `Infinity` when the median is 0 and something is above
   * it. `0` when nothing is unblocked at all — an empty graph separates nothing,
   * and must not clear a ratio bar by dividing zero by zero.
   */
  maxToMedianRatio: number;
  /** How many candidates the top decile holds — `ceil(candidates × topFraction)`, at least 1. */
  topDecileCandidates: number;
  /** That decile's share of all unblockings, in [0, 1]. */
  topDecileShare: number;
  /** Unblock count → how many candidates carry it, ascending. */
  histogram: Array<[count: number, candidates: number]>;
  /** Both clauses of the rule, together. Read this, not the exit code. */
  meetsBar: boolean;
  /** Each clause on its own, so a near miss says which half it missed. */
  clauses: { ratio: boolean; topDecile: boolean };
}

/**
 * Summarise counts against the rule.
 *
 * The median is the lower of the two middle values on an even-sized field
 * (`asc[floor(n/2)]` on 0-based indices is the upper one; this takes the lower),
 * which is the conservative choice here: a lower median makes the ratio *easier*
 * to clear, so a refusal computed this way is not an artefact of the tie-break.
 */
export function leverageDistribution(
  counts: readonly number[],
  rule: UnblockLeverageRule = UNBLOCK_LEVERAGE_RULE,
): LeverageDistribution {
  const candidates = counts.length;
  const asc = [...counts].sort((a, b) => a - b);
  const desc = [...counts].sort((a, b) => b - a);
  const totalUnblockings = counts.reduce((sum, c) => sum + c, 0);
  const median = candidates === 0 ? 0 : candidates % 2 === 1 ? asc[(candidates - 1) / 2] : asc[candidates / 2 - 1];
  const max = desc[0] ?? 0;

  const maxToMedianRatio = median > 0 ? max / median : max > 0 ? Infinity : 0;
  const topDecileCandidates = candidates === 0 ? 0 : Math.max(1, Math.ceil(candidates * rule.topFraction));
  const topDecileTotal = desc.slice(0, topDecileCandidates).reduce((sum, c) => sum + c, 0);
  const topDecileShare = totalUnblockings > 0 ? topDecileTotal / totalUnblockings : 0;

  const byCount = new Map<number, number>();
  for (const c of counts) byCount.set(c, (byCount.get(c) ?? 0) + 1);
  const histogram = [...byCount.entries()].sort((a, b) => a[0] - b[0]) as Array<[number, number]>;

  const clauses = {
    ratio: maxToMedianRatio >= rule.minMaxToMedianRatio,
    topDecile: topDecileShare >= rule.minTopDecileShare,
  };
  return {
    candidates,
    totalUnblockings,
    median,
    max,
    maxToMedianRatio,
    topDecileCandidates,
    topDecileShare,
    histogram,
    // An empty field clears nothing, whatever the arithmetic says about a ratio
    // over zero. Stated here rather than left to `Infinity >= 3`.
    meetsBar: totalUnblockings > 0 && clauses.ratio && clauses.topDecile,
    clauses,
  };
}

/** Every reading's verdict over one graph, keyed by reading id. */
export function sweepReadings(
  graph: LeverageGraph,
  rule: UnblockLeverageRule = UNBLOCK_LEVERAGE_RULE,
): Record<string, LeverageDistribution> {
  const out: Record<string, LeverageDistribution> = {};
  for (const reading of LEVERAGE_READINGS) out[reading.id] = leverageDistribution(unblockCounts(graph, reading), rule);
  return out;
}

/** One line per reading, for a human reading the sweep rather than the assertions. */
export function formatLeverageSweep(readings: Record<string, LeverageDistribution>): string {
  const rows = Object.entries(readings).map(([id, d]) => {
    const ratio = Number.isFinite(d.maxToMedianRatio) ? d.maxToMedianRatio.toFixed(2) : "∞";
    const share = (d.topDecileShare * 100).toFixed(1);
    return `  ${d.meetsBar ? "meets" : "MISSES"} bar — ${id}: ${d.candidates} candidates, ${d.totalUnblockings} unblockings, median ${d.median}, max ${d.max}, max/median ${ratio}, top ${d.topDecileCandidates} carry ${share}%`;
  });
  return rows.join("\n");
}
