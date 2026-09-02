/**
 * The tree's long-horizon state, computed rather than narrated.
 *
 * This replaces a habit rather than a function. Every pass used to append a prose
 * ledger to the Outcome node — "Evidence dispositions — fourth pass of the day",
 * "Target selection — why one row and not nineteen" — and after twenty of them
 * the root was 89KB of narration that no program could read and no human would.
 * Worse, it was the same facts restated: each ledger re-derived from prose what
 * the tree already knew structurally, because nothing could ask the tree directly.
 *
 * So the long-horizon record is the tree, and this is the reader. Every figure
 * below is DERIVED from what nodes already carry — an observed exit code, a
 * human's recorded verdict, a declared rung, a stated threshold. Nothing here is
 * a score anybody typed.
 *
 * **That constraint is the design, not an accident of what was easy.** The
 * obvious alternative is a `confidence:` or `impact:` field the pass fills in,
 * and this codebase spends most of its guards refusing exactly that shape:
 * `unearnedRungs` recomputes a declared believability rung against what the
 * node's sources actually support, `## Results` is unwritable by any agent, and
 * a build permit needs an exit code somebody watched. A number the agent writes
 * about its own work is the "trust me bro" claim the whole product argues
 * against, and putting one on the top-level view would make it the first thing
 * anybody read.
 *
 * What each figure is read off, so the provenance is legible from here:
 *
 *   - **executed / dissent** — `## Results`, human-only. The count of tests whose
 *     question somebody actually answered, and the only figure here that moves
 *     when one does. `refuted` is dissent in the only form the tree can prove: a
 *     run that came back against the claim.
 *   - **ready to run** — a parseable `instrument:`, and how many of those
 *     `## Instrument Log` records as green from an exit code `ost-agent verify`
 *     watched. Real work, and reported as its own quantity rather than folded
 *     into the one above: a spec that passes is a fact about this repository, not
 *     an answer to the question the test asks about the world.
 *   - **corroborators** — distinct `source` values, which the ingesting surface
 *     stamps and no node can author for itself.
 *   - **actors** — how many distinct standing rows those sources speak from
 *     (`sourceTrustKey`, keyed on the `actor` the FETCHING surface stamped). A
 *     source count on its own is a count of recordings, and this line is the one
 *     place a human reads a bucket's support at a glance: without it, thirty of
 *     the agent's own transcripts filed under one need render identically to
 *     thirty customers saying the same thing.
 *   - **fidelity** — whether a test states a fixed bar (`thresholdKindOf`). A test
 *     with no bar cannot come out a failure, so a bucket full of them is
 *     measuring nothing however green it looks.
 *   - **weakest rung** — the ladder's floor across the subtree, because a bucket
 *     is only as believed as its least-supported claim.
 *
 * **Why no line says `built` any more, and why execution comes first.** Until
 * 2026-09-01 each bucket opened with `built 13% (3/24 runnable), tested 0` — a
 * percentage over instrument coverage, carrying the one word in this vocabulary
 * that means the work is done, followed by the count of answered questions in
 * the position a reader skips. Both halves were wrong in the same direction.
 * Every automated hand that can touch a test can only ever make it more ready to
 * run: writing the spec, attaching the command and watching the exit code are all
 * reachable by an unattended pass, while recording a result is a human's
 * `ost-agent result` and nothing else. So the percentage was the one dimension
 * that was free to move, and a day spent attaching commands rendered as a day of
 * progress against a figure — `tested 0` on every bucket, for the life of the
 * tree — that has never moved at all.
 *
 * The fix is accounting, not mechanism: it runs nothing, unblocks nothing, and
 * after it ships exactly as many tests have been answered as before. What it
 * refuses is letting the artifact flatter the work. Readiness is kept in full —
 * it is real work and dropping it would trade one distortion for another — but
 * it is named readiness, it carries no `built`, and it sits behind the number
 * that says whether anybody has learned anything.
 */
import type { Actor } from "../adapters/source.js";
import { authorshipCensus, type AuthorshipCensus } from "../ost/authorship.js";
import type { OstNode } from "../ost/node.js";
import { byTitle } from "../processes/tree.js";
import { keyString, sourceTrustKey } from "../knowledge/actor-trust.js";
import { weakestRung, type RungId } from "../knowledge/believability.js";
import { hasRecordedResult } from "./evidence-debt.js";
import { recordedVerdict } from "../knowledge/actor-trust.js";
import { nodeInstrument, observedGreen } from "../ost/instrument.js";
import { thresholdKindOf } from "./coverage.js";

export interface BucketRollup {
  /** The Opportunity that hangs directly off the Outcome — a category, after the bucket migration. */
  title: string;
  opportunities: number;
  solutions: number;
  tests: number;
  /** Tests naming a runnable command, and how many of those now pass. */
  instrumented: number;
  green: number;
  /**
   * Tests carrying a human-recorded result, split by what it said — the
   * bucket's executed count, and the only one of these figures that says a
   * question got answered rather than prepared.
   */
  tested: number;
  refuted: number;
  /** Distinct `source` values beneath this bucket — how many recordings it rests on. */
  corroborators: number;
  /**
   * The distinct standing rows those sources speak from, as sorted `kind:id`, or
   * `null` when the caller supplied no stamp map and could establish none.
   *
   * This is what {@link corroborators} was being read as and never was. A source
   * is one recording; an actor is one voice, and the map from the first to the
   * second is {@link sourceTrustKey} over the `actor` the fetching surface
   * stamped — never over a prefix in the id, which the citing node chose.
   *
   * A source naming no actor at all (`agent-run:…`, a hand-written note, an
   * unresolvable citation) contributes no entry rather than an anonymous one:
   * "nobody stamped this" is not a voice, and counting it as one is the same
   * inflation in a quieter form. So `actors` can be shorter than
   * `corroborators`, and empty while `corroborators` is large — both of which
   * the renderer says out loud.
   */
  actors: string[] | null;
  /** Tests stating a fixed bar. A test without one cannot come out a failure. */
  withFixedThreshold: number;
  /** The ladder's floor across the subtree. */
  weakestRung: RungId | null;
}

export interface TreeRollup {
  outcome: string | null;
  buckets: BucketRollup[];
  /**
   * Opportunities the Outcome does not reach through other Opportunities.
   *
   * Non-empty means the bucket layer is incomplete — an opportunity nobody filed.
   * Reported rather than hidden, because a rollup that silently omitted them
   * would read as complete coverage of a tree it had only partly walked.
   */
  unfiled: string[];
  /** Nodes the Outcome links that are not Opportunities — the shape the migration removes. */
  nonOpportunityChildren: string[];
  totals: { nodes: number; opportunities: number; solutions: number; tests: number };
  /**
   * The tree's execution state, counted over the tree rather than summed from
   * the buckets.
   *
   * Summing buckets would be wrong and quietly so: `subtree` is multi-parent
   * safe on purpose, so a node reachable from two buckets is counted under both,
   * and adding the rows up would inflate every figure here by however much the
   * taxonomy overlaps. These are counted once each over `tree`.
   *
   * It sits at the top level because the question is about the whole tree: has
   * this thing answered anything yet, or only got ready to.
   */
  execution: { tests: number; executed: number; refuted: number; instrumented: number; green: number };
  /**
   * How much of this tree a person actually wrote.
   *
   * Read off `authorship`, which the vault's writers stamp and no tool argument
   * can set — the same provenance discipline as every other figure here. It
   * belongs at the top level rather than per bucket because the question it
   * answers is about the tree as a whole: a reader deciding how much of what
   * they are about to read is the agent talking to itself.
   */
  authorship: AuthorshipCensus;
}

/**
 * The ladder's floor across a subtree, or null when nothing declared one.
 *
 * `weakestRung` is the existing answer and is reused rather than reimplemented —
 * the first draft here inverted the comparison and reported the STRONGEST rung
 * in the subtree, which is the most flattering possible reading of a tree and
 * exactly the number a top-level view must not invent. The ladder runs strongest
 * (`money`, rank 0) to weakest (`assertion`), so the sign is easy to get wrong
 * once and impossible to notice afterwards.
 *
 * Null rather than the floor for "nobody declared anything": `weakestRung([])`
 * answers `assertion`, which would report an unlabelled subtree as though it had
 * been assessed and found weak.
 */
function weakest(rungs: (RungId | undefined)[]): RungId | null {
  const declared = rungs.filter((r): r is RungId => r !== undefined);
  return declared.length === 0 ? null : weakestRung(declared);
}

/**
 * Every node reachable from `start` by following links downward.
 *
 * Cycle-safe and multi-parent-safe: a node reachable from two buckets is counted
 * under both, which is the intended reading. The operator's own rule for the
 * taxonomy is that overlap should be small, not zero — so the rollup has to be
 * able to show overlap rather than silently assigning each node one home.
 */
export function subtree(start: string, index: Map<string, OstNode>): OstNode[] {
  const seen = new Set<string>();
  const out: OstNode[] = [];
  const queue = [start];
  while (queue.length > 0) {
    const title = queue.shift() as string;
    if (seen.has(title)) continue;
    seen.add(title);
    const node = index.get(title);
    if (!node) continue; // dangling link — `check` reports it; this counts what exists
    out.push(node);
    for (const link of node.links) queue.push(link);
  }
  return out;
}

/**
 * The voices behind a set of sources, or null when nothing could establish them.
 *
 * Deliberately keyed on the stamped `actor` rather than on the source string: the
 * whole point of the number is that the party who benefits from it being large is
 * the party that writes `source`, and `sourceTrustKey` is the existing resolution
 * that cannot be written from that side.
 */
function actorsBehind(sources: Iterable<string>, stamps: ReadonlyMap<string, Actor> | undefined): string[] | null {
  if (stamps === undefined) return null;
  const keys = new Set<string>();
  for (const source of sources) {
    const key = sourceTrustKey(source, stamps);
    if (key) keys.add(keyString(key));
  }
  return [...keys].sort();
}

function rollUpBucket(bucket: OstNode, index: Map<string, OstNode>, stamps?: ReadonlyMap<string, Actor>): BucketRollup {
  const nodes = subtree(bucket.title, index);
  const tests = nodes.filter((n) => n.layer === "AssumptionTest");
  const instrumented = tests.filter((t) => nodeInstrument(t) !== undefined);
  const sources = new Set(nodes.map((n) => n.source).filter((s): s is string => typeof s === "string" && s.trim() !== ""));

  return {
    title: bucket.title,
    // Minus one: the bucket itself is in its own subtree and is not one of the
    // needs it files. A bucket reporting "1 opportunity" when it holds none was
    // the first thing this got wrong.
    opportunities: nodes.filter((n) => n.layer === "Opportunity").length - 1,
    solutions: nodes.filter((n) => n.layer === "Solution").length,
    tests: tests.length,
    instrumented: instrumented.length,
    green: instrumented.filter(observedGreen).length,
    tested: tests.filter(hasRecordedResult).length,
    refuted: tests.filter((t) => recordedVerdict(t) === "refuted").length,
    corroborators: sources.size,
    actors: actorsBehind(sources, stamps),
    // `bound` is the only kind that names a number fixed in advance; `prose`,
    // `instruction` and `absent` all leave the bar to be decided after the run,
    // which is the same as having none.
    withFixedThreshold: tests.filter((t) => thresholdKindOf(t) === "bound").length,
    weakestRung: weakest(nodes.map((n) => n.evidence)),
  };
}

/**
 * Execution and readiness over the whole tree, each node counted once.
 *
 * Same reads as {@link rollUpBucket} performs per bucket, deliberately — one
 * definition of "executed" for the tree line and the bucket lines, so the two
 * cannot drift into disagreeing about what the word means.
 */
function executionCensus(tree: readonly OstNode[]): TreeRollup["execution"] {
  const tests = tree.filter((n) => n.layer === "AssumptionTest");
  const instrumented = tests.filter((t) => nodeInstrument(t) !== undefined);
  return {
    tests: tests.length,
    executed: tests.filter(hasRecordedResult).length,
    refuted: tests.filter((t) => recordedVerdict(t) === "refuted").length,
    instrumented: instrumented.length,
    green: instrumented.filter(observedGreen).length,
  };
}

/**
 * `stamps` is `evidenceActors(dir)` — id → the actor the fetching surface stamped.
 *
 * Optional rather than required, and the omission is reported rather than assumed
 * away: `composeStandingBriefing` is a pure function of `(tree, today)` by contract,
 * so a caller with no vault directory genuinely cannot establish who spoke. It gets
 * `actors: null` and a line that says the actors are unestablished — which is a
 * weaker claim than the bare source count it replaces, and weaker is the right
 * direction for a number nobody can check.
 */
export function rollupTree(tree: readonly OstNode[], stamps?: ReadonlyMap<string, Actor>): TreeRollup {
  const index = byTitle([...tree]);
  const outcome = tree.find((n) => n.layer === "Outcome") ?? null;

  const buckets = (outcome?.links ?? [])
    .map((t) => index.get(t))
    .filter((n): n is OstNode => n !== undefined && n.layer === "Opportunity")
    .map((b) => rollUpBucket(b, index, stamps));

  const filed = new Set<string>();
  for (const link of outcome?.links ?? []) {
    const node = index.get(link);
    if (node?.layer === "Opportunity") for (const n of subtree(link, index)) filed.add(n.title);
  }

  return {
    outcome: outcome?.title ?? null,
    buckets,
    unfiled: tree.filter((n) => n.layer === "Opportunity" && !filed.has(n.title)).map((n) => n.title).sort(),
    nonOpportunityChildren: (outcome?.links ?? [])
      .filter((t) => {
        const n = index.get(t);
        return n !== undefined && n.layer !== "Opportunity";
      })
      .sort(),
    totals: {
      nodes: tree.length,
      opportunities: tree.filter((n) => n.layer === "Opportunity").length,
      solutions: tree.filter((n) => n.layer === "Solution").length,
      tests: tree.filter((n) => n.layer === "AssumptionTest").length,
    },
    execution: executionCensus(tree),
    authorship: authorshipCensus(tree),
  };
}

/**
 * The two clauses every bucket line opens with, in this order and never the
 * other.
 *
 * Split into one function so the ordering is a property of the code rather than
 * of whoever last edited the template: whatever else the line grows, execution
 * is emitted before readiness because {@link executionClause} is called before
 * {@link readinessClause}.
 */
function executionClause(b: BucketRollup): string {
  return `executed ${b.tested} of ${b.tests}${b.refuted > 0 ? ` (${b.refuted} refuted)` : ""}`;
}

/**
 * Readiness, whole and unpercentaged.
 *
 * Both numbers are kept — instrumenting a test and watching its exit code are
 * real work, and dropping them to make the point about execution would trade one
 * distorted line for another. What is gone is the ratio between them wearing the
 * word `built`.
 */
function readinessClause(b: BucketRollup): string {
  return `ready to run ${b.instrumented} of ${b.tests} (${b.green} observed green)`;
}

/**
 * How the support clause reads — "N source(s)" was the whole bug.
 *
 * The number is a count of recordings and was being read as a count of voices,
 * which is the one misreading a top-level view must not invite: the party able to
 * drive it up is the agent, one filing at a time, and a bucket showing "40
 * source(s), rests on assertion" argues for itself out of its own transcripts.
 * So the clause never states a source count without stating, in the same breath,
 * how many actors it came from — and says so even when it cannot tell.
 */
function support(b: BucketRollup): string {
  if (b.actors === null) return `${b.corroborators} source(s) from unestablished actors`;
  return `${b.corroborators} source(s) from ${b.actors.length} actor(s)`;
}

/**
 * The clause said out loud when the source count is not the corroboration it looks
 * like, or "" when it is. Said as a fraction of what is there, in the style of the
 * fixed-bar line, and never said for a single source — one recording from one actor
 * is not a finding.
 */
function actorWarning(b: BucketRollup): string {
  if (b.actors === null || b.corroborators < 2) return "";
  if (b.actors.length === 1) {
    return (
      `    all ${b.corroborators} source(s) speak from one actor (${b.actors[0]}) — ` +
      `that is one actor recorded ${b.corroborators} times, not ${b.corroborators} independent voices`
    );
  }
  if (b.actors.length === 0) {
    return `    none of the ${b.corroborators} source(s) names an actor any surface stamped — the count is provenance, not corroboration`;
  }
  return "";
}

/**
 * The human-written share, and — when it is true — the fact that the marker is
 * not discriminating anything.
 *
 * The second line is the assumption this field was built under, said out loud
 * rather than left for somebody to notice: a marker that reads the same on every
 * node a reader sees carries no information, which is what already happened to
 * `#unvalidated` in this vault (211 of 219). Stating it here is the cheap half
 * of that test, run on every rollup and costing nobody anything — and it is the
 * half that says whether the expensive half (five operators, an hour each) is
 * worth running at all.
 */
function authorshipLines(c: AuthorshipCensus): string[] {
  if (c.total === 0) return [];
  const lines = [
    `Authorship: ${c.humanWritten}/${c.total} node(s) carry human-written prose ` +
      `(machine-only ${c.machine}, unlabelled ${c.unlabelled} — written before authorship was recorded)`,
  ];
  const labelled = c.total - c.unlabelled;
  const uniform = [c.machine, c.human, c.mixed].some((n) => n === labelled);
  if (labelled >= 10 && uniform) {
    lines.push(
      `  every one of those ${labelled} labelled node(s) reads the same — a marker true of all of them ` +
        `is not telling a reader which is which`,
    );
  }
  return lines;
}

/**
 * The tree's execution state, said before anything else it might be mistaken for.
 *
 * Placed above the buckets rather than inside them because it is one fact about
 * the whole tree and a reader should meet it before the thirty-seven lines that
 * each look like progress. The second sentence is said only when it is true, and
 * when it is true it is the most important thing on the page: a tree where
 * nothing has been executed has learned nothing, however much of it is ready to.
 */
function executionLines(e: TreeRollup["execution"]): string[] {
  if (e.tests === 0) return [];
  const lines = [
    `Executed: ${e.executed} of ${e.tests} test(s) carry a result somebody recorded` +
      `${e.refuted > 0 ? ` (${e.refuted} refuted)` : ""} — the only count here that moves when a question is answered`,
  ];
  lines.push(
    `  Readiness, kept separate: ${e.instrumented} of ${e.tests} name a runnable command, ` +
      `${e.green} of those observed green — real work, and not an answer to anything`,
  );
  if (e.executed === 0) {
    lines.push(
      `  not one test in this tree has been executed, so nothing below is a build percentage — ` +
        `every automated hand can only raise readiness, and recording a result is a human's \`ost-agent result\``,
    );
  }
  return lines;
}

/**
 * The top-level view, as the thing a loop reads on the way in.
 *
 * One line per bucket, widest signal first, and every number traceable to a
 * section of a node rather than to anybody's judgement. Deliberately plain text:
 * the two consumers are a shell script that pastes it into a prompt and an
 * operator reading a notification, and neither wants a table it has to parse.
 */
export function renderRollup(rollup: TreeRollup): string {
  const lines: string[] = [];
  lines.push(`Outcome: ${rollup.outcome ?? "(none — this vault has no root)"}`);
  lines.push(
    `Tree: ${rollup.totals.nodes} nodes — ${rollup.totals.opportunities} opportunity, ` +
      `${rollup.totals.solutions} solution, ${rollup.totals.tests} test`,
  );
  lines.push(...executionLines(rollup.execution));
  lines.push(...authorshipLines(rollup.authorship));
  lines.push("");

  if (rollup.buckets.length === 0) {
    lines.push("No buckets: the Outcome links no Opportunity, so there is no top-level view to roll up.");
  } else {
    lines.push(`Buckets (${rollup.buckets.length}), each with what is beneath it:`);
    for (const b of rollup.buckets) {
      lines.push(`  ${b.title}`);
      lines.push(
        `    ${b.opportunities} opportunity, ${b.solutions} solution, ${b.tests} test` +
          ` — ${executionClause(b)}, ${readinessClause(b)}` +
          `, ${support(b)}, rests on ${b.weakestRung ?? "nothing declared"}`,
      );
      const warning = actorWarning(b);
      if (warning !== "") lines.push(warning);
      // Said only when it is true, and said as a fraction of the tests that could
      // carry a bar — "0 of 0" reads as a problem and is not one.
      if (b.tests > 0 && b.withFixedThreshold < b.tests) {
        lines.push(`    ${b.tests - b.withFixedThreshold} of ${b.tests} test(s) state no fixed bar — those cannot come out a failure`);
      }
    }
  }

  // Both of these are how the bucket layer decays, so they are named rather than
  // left to a later `check`. An unfiled opportunity is invisible in every line
  // above: it belongs to no bucket, so no bucket counts it.
  if (rollup.nonOpportunityChildren.length > 0) {
    lines.push("");
    lines.push(
      `${rollup.nonOpportunityChildren.length} node(s) hang off the Outcome that are not Opportunities — ` +
        `only category opportunities belong there: ${rollup.nonOpportunityChildren.join(", ")}`,
    );
  }
  if (rollup.unfiled.length > 0) {
    lines.push("");
    lines.push(
      `${rollup.unfiled.length} opportunity(s) are in no bucket, so nothing above counts them: ` +
        rollup.unfiled.join(", "),
    );
  }

  return lines.join("\n");
}
