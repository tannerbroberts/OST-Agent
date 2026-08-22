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
 *   - **built** — `## Instrument Log`, written only by `ost-agent verify` from an
 *     exit code it watched. Green over instrumented, so it means "of the runnable
 *     definitions of done beneath this bucket, this many now pass".
 *   - **tested / dissent** — `## Results`, human-only. `refuted` is dissent in the
 *     only form the tree can prove: a run that came back against the claim.
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
 */
import type { Actor } from "../adapters/source.js";
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
  /** Tests carrying a human-recorded result, split by what it said. */
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
  };
}

function pct(part: number, whole: number): string {
  return whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;
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
  lines.push("");

  if (rollup.buckets.length === 0) {
    lines.push("No buckets: the Outcome links no Opportunity, so there is no top-level view to roll up.");
  } else {
    lines.push(`Buckets (${rollup.buckets.length}), each with what is beneath it:`);
    for (const b of rollup.buckets) {
      lines.push(`  ${b.title}`);
      lines.push(
        `    ${b.opportunities} opportunity, ${b.solutions} solution, ${b.tests} test` +
          ` — built ${pct(b.green, b.instrumented)} (${b.green}/${b.instrumented} runnable)` +
          `, tested ${b.tested}${b.refuted > 0 ? ` (${b.refuted} refuted)` : ""}` +
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
