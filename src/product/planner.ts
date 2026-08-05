/**
 * The planner — the order candidate work should be taken in, and the declared
 * resources that conditioned it.
 *
 * Until now this repository emitted a priority order and cited nothing.
 * `ost-agent buildable` prints every solution a builder could start on **in tree
 * order**, an unattended loop reads that list top-down, and tree order is the
 * order files happened to be walked in. That is not a neutral ranking; it is a
 * ranking that conditions on nothing and admits to nothing, and the cost of it is
 * on the record: the cold-offer test was sequenced RUN FIRST on 2026-07-24 and
 * killed on 2026-07-25 with "that isn't going to fly" — a day spent drafting
 * outreach for an operator who was never going to send it, and who had never been
 * asked.
 *
 * So the rule here is one sentence: **no order without a citation.** There is
 * exactly one function that returns a ranking ({@link rankBuildableWork}), it
 * returns {@link PriorityOrder}, and `PriorityOrder` carries the citation as a
 * required field. A caller cannot obtain the order and drop the citation on the
 * floor without deleting a field it has to name; and the citation names the
 * BLANKS as loudly as the declarations, so a resource nobody declared reads as an
 * unstated assumption about the operator rather than as a silent default.
 *
 * ## How the order is computed
 *
 * Two terms, in this precedence, with tree order as the stable tiebreak:
 *
 *   1. **Affordability** — how many of the candidate's demands the manifest says
 *      the operator cannot pay for. Work whose declared resources are all present
 *      comes first; work with one unmet demand next; and so on. This is a
 *      partition, not a weight, because a weight would mean inventing exchange
 *      rates between an hour and a credential, and nobody has measured those.
 *   2. **Merit** — the believability rung the solution rests on, strongest first.
 *      Resource-independent: it is a property of the evidence, not of the
 *      operator.
 *
 * Term 1 is the only one the manifest touches. **With every resource blank,
 * nothing has an unmet demand and the order collapses to merit-then-tree-order**
 * — which on a tree whose solutions all rest on the same rung is exactly the
 * order `buildable` prints today. That equality is deliberate and is asserted by
 * the spec: the baseline this is compared against has to be the order the product
 * actually emits, or the comparison is between two rankings this file invented.
 *
 * ## What a demand is, and what it is not
 *
 * A demand is read off the candidate's own text and the tree's own fields. It is
 * never inferred from the manifest — the manifest says what is *available*, the
 * candidate says what is *needed*, and the planner only ever joins them. Two of
 * the four detectors are not this file's work at all: `suggestCaution` (an
 * existing triage aid, with its own vocabulary of outside-person markers) answers
 * the social-reach question, and `computeMayRun` (the lane vocabulary's own
 * fail-closed rule) answers the human-hours one.
 *
 * **The detectors are coarse and the coarseness is visible in the output.** Every
 * unmet demand quotes the phrase or the field that produced it, so a deferral a
 * reader disagrees with can be argued with in one glance rather than accepted
 * because a tool said so. A node that mentions publishing in passing and gets
 * deferred behind a withheld publish credential is a false positive this design
 * accepts and prints, rather than a false positive it hides.
 */
import { buildableSolutions } from "../eval/buildable.js";
import { computeMayRun } from "../knowledge/lanes.js";
import { rungRank, FLOOR_RUNG } from "../knowledge/believability.js";
import { suggestCaution } from "../ost/lanes.js";
import type { OstNode } from "../ost/node.js";
import { testsUnderSolution } from "../processes/tree.js";
import {
  blankResources,
  declaredResources,
  resourceDef,
  summarizeDeclared,
  type ResourceId,
  type ResourceManifest,
} from "./manifest.js";

/** One thing a candidate needs that the manifest says is not available. */
export interface UnmetDemand {
  resource: ResourceId;
  /** What the candidate needs, quoting whatever said so. */
  demand: string;
  /** The declared fact that makes it unavailable, in the operator's own numbers. */
  declared: string;
}

export interface RankedCandidate {
  /** 1-based position in the emitted order. */
  rank: number;
  solution: string;
  /** The assumption test carrying the red instrument — the definition of done. */
  test: string;
  instrument: string;
  /** The rung the solution rests on; the merit term, and resource-independent. */
  evidence: string;
  /** Empty when everything this candidate needs is declared available. */
  unmet: UnmetDemand[];
}

/** One resource the operator declared, and what it did to this order. */
export interface CitedResource {
  resource: ResourceId;
  /** The declared value, in one line. */
  value: string;
  /** How many candidates it deferred. Zero is a real answer and is printed as one. */
  conditioned: number;
}

/** One resource nobody declared, and the ranking it is therefore not doing. */
export interface CitedBlank {
  resource: ResourceId;
  /** What a declaration would have conditioned — the cost of the silence. */
  wouldHaveConditioned: string;
}

/**
 * The citation an order may not be emitted without.
 *
 * Both halves are always present, including on an empty tree and on a vault with
 * no manifest at all. "Which resources conditioned this?" must never be a
 * question whose answer depends on what the tree happened to contain.
 */
export interface ResourceCitation {
  declared: CitedResource[];
  blank: CitedBlank[];
  /**
   * Set when a manifest file exists and could not be read. The order was then
   * computed as if nothing were declared, which is the honest reading of an
   * unusable file and is said out loud rather than inferred from empty output.
   */
  problem?: string;
}

/**
 * A priority order and the resources that conditioned it, inseparably.
 *
 * This shape is the whole enforcement mechanism. There is no exported function
 * that returns `RankedCandidate[]` on its own.
 */
export interface PriorityOrder {
  ranked: RankedCandidate[];
  citation: ResourceCitation;
}

/**
 * A sum of money named in the text.
 *
 * Deliberately literal — a currency symbol against a digit, or a number against
 * a currency word. It does not read "cheap", "budget" or "afford" as capital
 * demands, because those are the words this repository's own nodes use about
 * tokens and attention, and a detector that fired on them would defer nearly
 * everything and mean nothing.
 */
const MONEY_NAMED =
  /(?:[$£€]\s?\d[\d,]*(?:\.\d+)?)|(?:\b\d[\d,]*(?:\.\d+)?\s?(?:dollars?|usd|eur|gbp|pounds?|euros?)\b)/i;

/** Escape a manifest-supplied credential name for use inside a word-bounded match. */
function literal(name: string): RegExp {
  return new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i");
}

/**
 * The text a candidate's demands are read from: the solution's own statement,
 * plus every assumption test beneath it.
 *
 * Both halves, because the two say different things. The solution says what
 * would be built; the test says what running it would cost — and it is the test
 * that names the interviews, the credential and the sum.
 */
function candidateText(solution: OstNode, tests: readonly OstNode[]): string {
  return [solution.title, solution.body ?? "", ...tests.map((t) => `${t.title}\n${t.body ?? ""}`)].join("\n");
}

/**
 * Does any test beneath this candidate need a person in the loop?
 *
 * Answered by the lane vocabulary's own rule and not by a second one written
 * here: `computeMayRun` is true for exactly one lane and fails closed on a
 * missing or unrecognised label, so an unclassified test counts as needing a
 * person. That is the safe direction, and it is the direction that makes this
 * detector nearly useless on a tree whose tests are unlabelled — see the note
 * in the spec, which measures how many candidates it separates.
 */
export function personInTheLoop(tests: readonly OstNode[]): string | undefined {
  const needs = tests.find((t) => !computeMayRun(t.lane));
  if (!needs) return undefined;
  return needs.lane
    ? `"${needs.title}" is lane ${needs.lane}, which compute may not run`
    : `"${needs.title}" carries no lane, and an unclassified test is never runnable by compute`;
}

/**
 * Does any test beneath this candidate need people outside the building?
 *
 * `suggestCaution` and nothing else. It is an existing triage aid with an
 * existing vocabulary written for a different purpose, which is precisely why it
 * is used here: a set of outside-person markers chosen while looking at the
 * candidates being ranked would be a detector fitted to its own answer.
 */
export function outsidePeople(tests: readonly OstNode[]): string | undefined {
  for (const t of tests) {
    const hint = suggestCaution(t);
    if (hint) return `"${t.title}" ${hint.why}`;
  }
  return undefined;
}

/** A sum of money this candidate names, or nothing. */
export function capitalNamed(text: string): string | undefined {
  const hit = MONEY_NAMED.exec(text);
  return hit ? `names a sum to spend: "${hit[0].trim()}"` : undefined;
}

/**
 * Which of the operator's declared credential names this candidate's text uses.
 *
 * The vocabulary is the manifest's, entirely. With no credentials declared there
 * is nothing to match, and the planner therefore cannot know that a candidate
 * needs a credential — which is correct, and is the blank being reported rather
 * than a gap being papered over.
 */
export function credentialDemands(text: string, names: readonly string[]): string[] {
  return names.filter((n) => literal(n).test(text));
}

/** Every unmet demand of one candidate, in {@link RESOURCES} order. */
function unmetDemands(solution: OstNode, tests: readonly OstNode[], m: ResourceManifest): UnmetDemand[] {
  const text = candidateText(solution, tests);
  const unmet: UnmetDemand[] = [];

  // Capital: a sum is named and none is declared available. A declared amount
  // above zero is treated as "there is money" and nothing finer — comparing the
  // named sum against the declared one would be arithmetic over a phrase found
  // in prose, which is a precision this input cannot carry.
  if (m.capital && m.capital.amount === 0) {
    const named = capitalNamed(text);
    if (named) {
      unmet.push({ resource: "capital", demand: named, declared: summarizeDeclared(m, "capital")! });
    }
  }

  // Human hours: a person is needed and none are declared.
  if (m.hours && m.hours.perWeek === 0) {
    const needs = personInTheLoop(tests);
    if (needs) {
      unmet.push({ resource: "hours", demand: needs, declared: summarizeDeclared(m, "hours")! });
    }
  }

  // Social reach: outside people are needed and the operator will not contact them.
  if (m.socialReach && !m.socialReach.contactStrangers) {
    const needs = outsidePeople(tests);
    if (needs) {
      unmet.push({ resource: "social-reach", demand: needs, declared: summarizeDeclared(m, "social-reach")! });
    }
  }

  // Credentials: the candidate names one the operator withheld. A name that is
  // both withheld and granted is treated as withheld — the restrictive reading
  // is the only safe one when the operator has contradicted themselves.
  if (m.credentials) {
    for (const name of credentialDemands(text, m.credentials.withheld)) {
      unmet.push({
        resource: "credentials",
        demand: `names the withheld credential "${name}"`,
        declared: summarizeDeclared(m, "credentials")!,
      });
    }
  }

  // `compute` has no per-candidate demand signal and therefore never appears
  // here. That is not an omission to fix quietly: every candidate on this
  // surface is a spec run, nothing in the tree says what one costs, and a
  // fabricated cost model would make the citation claim a conditioning that did
  // not happen. It is declared, cited, and reported as having conditioned
  // nothing — which is a measurement, not a gap.
  return unmet;
}

/** Title → node, for the one lookup this module makes. */
function indexByTitle(tree: readonly OstNode[]): Map<string, OstNode> {
  const index = new Map<string, OstNode>();
  for (const n of tree) index.set(n.title, n);
  return index;
}

function testsUnder(index: Map<string, OstNode>, solution: OstNode): OstNode[] {
  return testsUnderSolution(solution, index);
}

/**
 * Rank the work a builder could start on today, conditioned on what the operator
 * declared — and say which declarations did the conditioning.
 *
 * The candidate set is `buildableSolutions` exactly: this ranks the queue, it
 * does not decide who is in it. A solution with no red instrument is not
 * demoted here, it is simply not buildable, and that is a different gate's call.
 */
export function rankBuildableWork(tree: readonly OstNode[], m: ResourceManifest, problem?: string): PriorityOrder {
  const index = indexByTitle(tree);
  const candidates = buildableSolutions(tree);

  const scored = candidates.map((c, treeOrder) => {
    const solution = index.get(c.solution)!;
    const tests = testsUnder(index, solution);
    return {
      treeOrder,
      candidate: c,
      solution,
      unmet: unmetDemands(solution, tests, m),
      merit: rungRank(solution.evidence ?? FLOOR_RUNG),
    };
  });

  // Affordability, then merit, then the order the tree walk produced. The last
  // term is what makes this deterministic on a tree where the first two tie —
  // which, on a vault whose solutions all rest on the same rung and whose tests
  // are unlabelled, is most of them.
  scored.sort((a, b) => a.unmet.length - b.unmet.length || a.merit - b.merit || a.treeOrder - b.treeOrder);

  const ranked: RankedCandidate[] = scored.map((s, i) => ({
    rank: i + 1,
    solution: s.candidate.solution,
    test: s.candidate.test,
    instrument: s.candidate.instrument,
    evidence: s.solution.evidence ?? FLOOR_RUNG,
    unmet: s.unmet,
  }));

  const conditioned = new Map<ResourceId, number>();
  for (const r of ranked) {
    for (const u of r.unmet) conditioned.set(u.resource, (conditioned.get(u.resource) ?? 0) + 1);
  }

  return {
    ranked,
    citation: {
      declared: declaredResources(m).map((id) => ({
        resource: id,
        value: summarizeDeclared(m, id)!,
        conditioned: conditioned.get(id) ?? 0,
      })),
      blank: blankResources(m).map((id) => ({
        resource: id,
        wouldHaveConditioned: resourceDef(id).conditions,
      })),
      ...(problem ? { problem } : {}),
    },
  };
}

/**
 * The order as an operator reads it: the citation FIRST, then the ranking.
 *
 * The citation leads because it is the thing a reader would otherwise skip, and
 * because an order presented before its conditions reads as arithmetic rather
 * than as a judgement made under stated assumptions.
 */
export function formatPriorityOrder(order: PriorityOrder): string {
  const lines: string[] = [];
  const { declared, blank, problem } = order.citation;

  lines.push(`Priority order over ${order.ranked.length} buildable solution(s), conditioned on:`);
  if (problem) lines.push(`  ⚠ ${problem}`);
  if (!declared.length) {
    lines.push("  (nothing — no resource is declared, so this order conditions on no fact about the operator)");
  }
  for (const d of declared) {
    const effect = d.conditioned === 0 ? "conditioned nothing here" : `deferred ${d.conditioned} candidate(s)`;
    lines.push(`  ${d.resource}: ${d.value} — ${effect}`);
  }
  if (blank.length) {
    lines.push("");
    lines.push(`UNDECLARED — ${blank.length} resource(s) this order is guessing about:`);
    for (const b of blank) lines.push(`  ${b.resource}: blank. Declared, it would ${b.wouldHaveConditioned}.`);
    lines.push(`  Declare them in \`ost.resources.yaml\`; a blank is not a zero and is not being read as one.`);
  }
  lines.push("");
  for (const r of order.ranked) {
    lines.push(`${r.rank}. ${r.solution}`);
    lines.push(`     ${r.instrument}  (${r.test})`);
    for (const u of r.unmet) lines.push(`     deferred — ${u.resource}: ${u.demand}; declared ${u.declared}`);
  }
  if (!order.ranked.length) lines.push("(nothing is buildable — no solution carries an instrument observed red)");
  lines.push("");
  lines.push(
    "This order says which work the declared resources can pay for. It does not say the work is worth doing " +
      "(that is `ost-agent gate`), and it cannot tell whether the manifest is still true — nothing here checks.",
  );
  return lines.join("\n");
}
