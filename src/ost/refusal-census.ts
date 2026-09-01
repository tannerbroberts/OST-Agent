/**
 * The count the refuse-an-unfixed-threshold rule wants before it wants an
 * implementation.
 *
 * The solution "Refuse to record a result against a threshold that was never
 * fixed" moves the threshold classifier from the read boundary (`ost-agent debt`
 * flags) to the write boundary (`ost-agent result` refuses). Its own node names
 * the risk that should decide it: a wrong flag costs a glance and a wrong refusal
 * costs the whole recording, and this would be the second required field added to
 * the one command its operator is already not running.
 *
 * So the assumption test beneath it asks for a *dry run over what already
 * exists*: replay the classifier over every assumption test in a vault, produce
 * the list a refusal would have blocked, and let a human judge each entry against
 * one question — is this test's threshold genuinely not a commitment, or did the
 * classifier misread a real pre-commitment? This module is that replay. It
 * changes nothing: `recordResult` is untouched, no node is written, no filing is
 * blocked. The output is a list with a pre-committed bar attached, and the bar
 * decides whether the refusal gets built at all.
 *
 * **Two readings, never one, because this tree has already recorded that its own
 * three consumers disagree.** `computeUnfixedThresholds` (what `debt` lists)
 * calls `instruction` and `absent` unfixed and lets `prose` through;
 * `renderRollup` and `confirmPermit` count `prose` as unfixed too. The solution
 * node says to reuse *the flag's* classification, so `flag` is the reading it
 * specifies — but a census that printed only that number would hide the fact that
 * the same rule under the other reading blocks a different set entirely. Both are
 * counted, side by side, and the difference between them is the cost of a
 * definition nobody has chosen.
 *
 * **The rate this census cannot compute, stated out loud.** The pre-committed
 * threshold is a *false-refusal* rate — misread real pre-commitments as a share of
 * everything blocked. Nothing here can produce that number: deciding whether a
 * blocked test's threshold is genuinely not a commitment is the judgement the test
 * reserves for a person ("a verdict here must not be recorded by compute"). So the
 * census produces the denominator, the worksheet and the arithmetic of the bar,
 * and stops. {@link formatReviewWorksheet} withholds the classifier's verdict for
 * the same reason the test says to judge blind — a label anchors the reader it was
 * meant to be checked by.
 */
import { thresholdKindOf, askedOf, type ThresholdKind, type ThresholdReading } from "../eval/coverage.js";
import { hasRecordedResult } from "../eval/evidence-debt.js";
import type { OstNode } from "./node.js";

/** The two places the line between "fixed" and "unfixed" is currently drawn in this repository. */
export const REFUSAL_READINGS = ["flag", "strict"] as const;

export type RefusalReading = (typeof REFUSAL_READINGS)[number];

/**
 * Which threshold kinds each reading refuses a filing against.
 *
 * - `flag` — what `ost-agent debt` calls unfixed today, and the one the solution
 *   node names ("reuse the classification from the flag at the write boundary").
 *   `prose` passes: a bar in words is a bar, and nagging about well-written
 *   thresholds is how a report gets turned off.
 * - `strict` — what `renderRollup` prints and what `confirmPermit` spends a build
 *   permit on. `bound` is the only kind that names something fixed in advance.
 */
export const REFUSED_KINDS: Record<RefusalReading, readonly ThresholdKind[]> = {
  flag: ["instruction", "absent"],
  strict: ["instruction", "absent", "prose"],
};

/** Would a refusal under this reading have stopped a filing against this kind of threshold? */
export function wouldRefuse(kind: ThresholdKind, reading: RefusalReading): boolean {
  return REFUSED_KINDS[reading].includes(kind);
}

/**
 * At most this share of what a refusal blocks may turn out to be a misread real
 * pre-commitment. Fixed by the assumption test before any count was run: at or
 * below 5% the refusal is defensible; above 5% the candidate is closed and the
 * flag stands as the permanent answer.
 */
export const FALSE_REFUSAL_BAR = 0.05;

/**
 * How many of `blocked` may be misreads and still clear the bar.
 *
 * Floored, not rounded: a bar of "at or below 5%" that admits 1 misread out of 10
 * has quietly become 10%. On a small blocked list this is 0, which is the honest
 * reading — a rule that blocks four things and gets one of them wrong is not a 5%
 * rule, and the arithmetic should say so rather than flatter it.
 */
export function misreadAllowance(blocked: number): number {
  return Math.floor(blocked * FALSE_REFUSAL_BAR);
}

/**
 * What a blocked count of this size lets the pre-committed bar say — including
 * "nothing", which is the answer that has to be spelled out.
 *
 * A rate over an empty set is not 0%, it is undefined, and a census that printed
 * `0 blocked … 0% misread` would read as the bar cleared. That is the exact
 * pathology the parent opportunity is about — a threshold nothing can come out a
 * failure against — reproduced by the instrument built to measure it. Under the
 * `flag` reading this is not hypothetical: it is what this vault returns today.
 */
export function bearingOnTheBar(blocked: number): string {
  if (blocked === 0) {
    return `nothing is blocked, so the ${FALSE_REFUSAL_BAR * 100}% bar has nothing to judge and cannot be cleared here`;
  }
  return `at ${FALSE_REFUSAL_BAR * 100}% at most ${misreadAllowance(blocked)} may be a misread`;
}

/** One filing a refusal would have stopped, with everything the reviewer needs. */
export interface BlockedFiling {
  /** The AssumptionTest a human would have been filing against. */
  test: string;
  kind: ThresholdKind;
  /** The pre-commitment paragraph the classifier read, or null when it found none. */
  asked: string | null;
  /**
   * Whether this test has never recorded a result. These are the filings the
   * operator would actually be making next; a test with a result already on it
   * would be blocked on its *second* filing, which is a smaller loss.
   */
  awaitingResult: boolean;
  /** What `ost-agent result` would have printed instead of filing. */
  refusal: string;
}

export interface RefusalCensus {
  reading: RefusalReading;
  /** Every AssumptionTest in the tree — the population `recordResult` accepts a filing against. */
  tests: number;
  /** Of those, how many have never recorded a result. */
  awaitingResult: number;
  /** Every filing the refusal would have stopped, in tree order. */
  blocked: BlockedFiling[];
  /** Blocked over tests, in [0, 1]. A tree with no tests is 0 — nothing was lost. */
  blockedShare: number;
  /** The full four-way classification, so a reader sees what the classifier did with everything. */
  byKind: Record<ThresholdKind, number>;
}

/**
 * What `ost-agent result` would print instead of filing, if the refusal existed.
 *
 * Written here rather than in `results.ts` on purpose: the point of this pass is
 * the count, and a refusal message living beside `recordResult` is one `if` away
 * from being wired. The wording follows the two refusals that command already
 * makes — name what is missing, say why it cannot be waived, and leave the caller
 * holding a one-edit fix rather than a wall.
 */
export function refusalFor(reading: ThresholdReading): string {
  const found =
    reading.kind === "absent"
      ? "it carries no pre-commitment at all"
      : reading.kind === "instruction"
        ? `its pre-commitment is still an instruction to pick a bar — "${reading.asked}"`
        : `its pre-commitment states no bar anything could come out short of — "${reading.asked}"`;
  return (
    `a result needs a threshold that was fixed before the run, and "${reading.title}" cannot supply one: ${found}. ` +
    "A result recorded against a bar nobody fixed cannot come out a failure, so it is not evidence. " +
    "Fix the bar on the node and file again."
  );
}

/**
 * Replay the refusal over a tree and count what it would have stopped.
 *
 * The population is every AssumptionTest, retracted ones included, because that is
 * exactly the set `recordResult` accepts a filing against today — it checks the
 * layer and nothing else. Narrowing the denominator here to the tests somebody is
 * "likely" to file against would be this census choosing its own number.
 */
export function censusRefusals(tree: readonly OstNode[], reading: RefusalReading): RefusalCensus {
  const readings: ThresholdReading[] = [];
  const awaiting = new Set<string>();
  for (const node of tree) {
    if (node.layer !== "AssumptionTest") continue;
    readings.push({ title: node.title, kind: thresholdKindOf(node), asked: askedOf(node) });
    if (!hasRecordedResult(node)) awaiting.add(node.title);
  }

  const byKind: Record<ThresholdKind, number> = { bound: 0, instruction: 0, prose: 0, absent: 0 };
  for (const r of readings) byKind[r.kind] += 1;

  const blocked = readings
    .filter((r) => wouldRefuse(r.kind, reading))
    .map((r): BlockedFiling => ({
      test: r.title,
      kind: r.kind,
      asked: r.asked,
      awaitingResult: awaiting.has(r.title),
      refusal: refusalFor(r),
    }));

  return {
    reading,
    tests: readings.length,
    awaitingResult: awaiting.size,
    blocked,
    blockedShare: readings.length === 0 ? 0 : blocked.length / readings.length,
    byKind,
  };
}

/** Both readings over one tree, which is the only form this census is meant to be read in. */
export function censusOfTree(tree: readonly OstNode[]): Record<RefusalReading, RefusalCensus> {
  return Object.fromEntries(REFUSAL_READINGS.map((r) => [r, censusRefusals(tree, r)])) as Record<
    RefusalReading,
    RefusalCensus
  >;
}

/**
 * The counts as a person reads them, with the denominator on every line and both
 * readings side by side. A blocked count printed without the definition that
 * produced it is the untrustworthy number this repository keeps finding in its own
 * sweeps.
 */
export function formatRefusalCensus(label: string, both: Record<RefusalReading, RefusalCensus>): string {
  const any = both.flag;
  const lines = [
    `${label} — filings a refuse-an-unfixed-threshold rule would have blocked:`,
    `  ${any.tests} assumption test(s)  (fixed ${any.byKind.bound}, stated in words ${any.byKind.prose}, ` +
      `still an instruction ${any.byKind.instruction}, none written ${any.byKind.absent})`,
    `  ${any.awaitingResult} of them have never recorded a result — those are the next filings.`,
  ];
  for (const reading of REFUSAL_READINGS) {
    const c = both[reading];
    const pct = c.tests === 0 ? "—" : `${Math.round(c.blockedShare * 1000) / 10}%`;
    const next = c.blocked.filter((b) => b.awaitingResult).length;
    lines.push(
      `  ${reading.padEnd(7)} (refuses ${REFUSED_KINDS[reading].join(", ")})  ` +
        `${String(c.blocked.length).padStart(4)}/${String(c.tests).padEnd(4)} blocked (${pct})` +
        `, ${next} of them never run` +
        `; ${bearingOnTheBar(c.blocked.length)}`,
    );
  }
  return lines.join("\n");
}

/**
 * The list a human judges, with the classifier's verdict deliberately absent.
 *
 * The assumption test says to judge from the node text, blind to the classifier's
 * reasoning, and it is right to: a reviewer shown `instruction` next to a
 * paragraph is being asked to ratify a label rather than to read a threshold, and
 * a census whose reviewer agrees with it by construction measures nothing. So each
 * entry carries the title and the paragraph that was read, and no kind, no rule
 * name and no refusal text.
 */
export function formatReviewWorksheet(label: string, census: RefusalCensus): string {
  const lines = [
    `${label} — ${census.blocked.length} filing(s) to judge, under the "${census.reading}" reading.`,
    "",
    "For each, from the node text alone: is this genuinely not a commitment, or did the",
    `classifier misread a real pre-commitment? ${bearingOnTheBar(census.blocked.length)}.`,
    "",
  ];
  if (census.blocked.length === 0) {
    lines.push("  Nothing is blocked under this reading, so there is nothing to judge.");
    return lines.join("\n");
  }
  census.blocked.forEach((b, i) => {
    lines.push(`${String(i + 1).padStart(4)}. ${b.test}${b.awaitingResult ? "" : "  (already has a result)"}`);
    lines.push(`      reads: ${b.asked ?? "— no pre-commitment paragraph found —"}`);
    lines.push("      verdict (not a commitment / misread): ");
  });
  return lines.join("\n");
}
