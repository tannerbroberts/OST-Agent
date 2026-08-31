/**
 * Backpressure on instrumenting — why readiness cannot outrun execution.
 *
 * The tree this product tends has one measured pathology that no amount of
 * correct work fixes: on 2026-08-04 a quarter of a day's tool calls were
 * `ost_set_instrument` (88 of 356), and against that every bucket in the
 * rollup read `tested 0`. Writing a test is cheap, giving it a threshold is
 * done, giving it a command is being done at scale — and executing it is on
 * nobody's surface, because recording a result is a human's `ost-agent
 * result`. So readiness is the only thing that accumulates, and it accumulates
 * forever.
 *
 * This is the valve. A pass may attach instruments up to an allowance, and the
 * allowance is a fixed floor plus a multiple of the results actually recorded
 * in the tree. With nothing ever executed the allowance stops at the floor, and
 * the next attach is refused with a message that names the shortage — how many
 * commands the tree already carries and how many results answer them — rather
 * than a generic error a reader would file as a bug.
 *
 * **Three properties, and each is a thing this could have got wrong.**
 *
 *   - **The floor is never zero.** A ration that refuses everything leaves a
 *     pass unable to do any useful work, and a fresh vault — no tests, no
 *     results, nothing to execute yet — would be unworkable from its first
 *     call. The floor is what a pass gets unconditionally.
 *   - **The allowance opens in proportion, not in steps.** Each recorded result
 *     buys {@link INSTRUMENTS_PER_RESULT} more attaches, so a tree that starts
 *     executing stops feeling this at all. Nothing here punishes a tree that is
 *     keeping up; it binds exactly on the one that is not.
 *   - **It is charged per pass, and that is a deliberate, stated narrowing.**
 *     The counter lives for one built tool surface — one MCP session, one
 *     unattended pass — so a pass gets the floor, spends it, and is refused.
 *     What it does NOT do is bound the tree's *stock* of unrun commands, and
 *     the difference is the one `web/budget.ts` had to learn the hard way when
 *     a number the operator wrote as a cap behaved as a rate.
 *
 * **Why the rate and not the stock, decided rather than defaulted into.** A
 * stock ceiling — "the tree may hold no more than floor + k × results
 * instruments, ever" — reads more literally off the title, and it was measured
 * against the vault that commissioned this before being rejected: that vault
 * carries 232 instrumented tests and has never recorded a result, so a stock
 * ceiling refuses the 233rd attach and every attach after it, permanently, no
 * matter what any pass does. That is the "ration that refuses everything" the
 * assumption beneath this names as the failure mode, and it is unreachable from
 * the tool surface: no agent can record a result, so no agent could ever earn
 * its way back. The rate reading paces the pass that is over-producing without
 * ever wedging it, which is the middle the assumption claims exists.
 *
 * Nothing here judges whether withholding the work helps. If execution is
 * blocked on something structural rather than on anyone's willingness — and the
 * opportunity above this has measured that it is — then a valve makes the
 * shortage legible and gives nobody an hour back. That is a call for a human
 * with the evidence in front of them; this file only makes the valve open and
 * close correctly.
 */
import { hasRecordedResult } from "../eval/evidence-debt.js";
import { entriesUnder, RESULTS_HEADING } from "./headings.js";
import { sightCensus } from "./instrument.js";
import type { OstNode } from "./node.js";

/**
 * Attaches a pass gets before any result has ever been recorded.
 *
 * Five, because that is enough to instrument the tests one pass realistically
 * authors and nowhere near the eighty-eight that named the problem. It is the
 * number a fresh vault runs on, so it can never be zero.
 */
export const INSTRUMENT_FLOOR = 5;

/** How far each recorded result opens the allowance. */
export const INSTRUMENTS_PER_RESULT = 3;

/** What the tree looks like at the moment an attach is charged. */
export interface InstrumentShortage {
  /** Results recorded across the tree — the number the allowance rides on. */
  results: number;
  /** AssumptionTests already carrying a command, parseable or not. */
  instrumented: number;
  /** Of those, the ones no result answers — the readiness that has outrun execution. */
  unanswered: number;
}

export interface InstrumentRation {
  /**
   * Charge one attach. False when the allowance is spent; a false take costs
   * nothing, so a refused call does not deepen the shortage it reports.
   */
  take(): boolean;
  /** Attaches charged to this pass so far. */
  spent(): number;
  /** What the tree permits right now — floor + perResult × results. */
  allowance(): number;
  /** Attaches still available. Never negative. */
  remaining(): number;
  /** The tree as this ration currently reads it. */
  shortage(): InstrumentShortage;
  floor: number;
  perResult: number;
}

/**
 * Results recorded across the tree, counted as entries rather than as tests.
 *
 * Deliberately not {@link hasRecordedResult}, which answers a different
 * question — "has this test been run at all" — and says yes to a human's
 * promotion to `validated`. The allowance rides on runs: a test run three times
 * opens it three times, and a promotion opens it not at all, because a
 * promotion is a judgement about a claim rather than an execution that happened.
 *
 * The heading is read through `ost/headings.ts` for the reason every other
 * reader of a reserved section is: the guard that refuses the heading and the
 * reader that honours it disagreeing about where it starts is the whole failure
 * mode.
 */
export function countRecordedResults(tree: readonly OstNode[]): number {
  return tree
    .filter((n) => n.layer === "AssumptionTest")
    .reduce((total, test) => total + entriesUnder(test.body ?? "", RESULTS_HEADING).length, 0);
}

/** The two counts the refusal has to be able to quote, read off the tree. */
export function instrumentShortage(tree: readonly OstNode[]): InstrumentShortage {
  const carriers = tree.filter((n) => n.layer === "AssumptionTest" && typeof n.instrument === "string");
  return {
    results: countRecordedResults(tree),
    // Reuses the census rather than re-filtering, so "how many instruments does
    // this tree carry" has one answer here, in `debt` and in `status`.
    instrumented: sightCensus(tree).total,
    unanswered: carriers.filter((n) => !hasRecordedResult(n)).length,
  };
}

export interface InstrumentRationOptions {
  floor?: number;
  perResult?: number;
}

/**
 * The pass's ration. `readTree` is called on demand rather than captured once,
 * so a result recorded while a long session is running opens the allowance for
 * that session instead of on the next one.
 */
export function createInstrumentRation(
  readTree: () => readonly OstNode[],
  opts: InstrumentRationOptions = {},
): InstrumentRation {
  const floor = opts.floor ?? INSTRUMENT_FLOOR;
  const perResult = opts.perResult ?? INSTRUMENTS_PER_RESULT;
  let used = 0;

  const allowance = (): number => floor + perResult * countRecordedResults(readTree());

  return {
    floor,
    perResult,
    take: () => {
      if (used >= allowance()) return false;
      used++;
      return true;
    },
    spent: () => used,
    allowance,
    remaining: () => Math.max(0, allowance() - used),
    shortage: () => instrumentShortage(readTree()),
  };
}

/**
 * What a refusal says. Not a generic error, on purpose: a pass that is told
 * "refused" reads it as a bug in the tool and works around it, and a reader of
 * the trace six weeks later cannot tell the two apart. This says which resource
 * ran out, quotes the imbalance in the tree's own numbers, and names the one
 * command that opens the valve — which is a human's, and stated as one.
 */
export function rationRefusal(test: string, ration: InstrumentRation, atBirth = false): string {
  const s = ration.shortage();
  const opening =
    s.results === 0
      ? `no result has ever been recorded in this tree, so the allowance is at its floor of ${ration.floor}`
      : `${s.results} result(s) are recorded, which allows ${ration.allowance()}`;
  // The birth door has an escape the other one does not, and it is the wrong
  // one: `ost_create_node` requires an AssumptionTest to declare an instrument
  // OR a person, so a pass refused here can get its node written by calling the
  // test humans-required. That would trade a queue nothing executes for a queue
  // no compute may ever touch, which is strictly worse — so the refusal says so
  // rather than leaving a pass to find the door on its own.
  const doNotLaunder = atBirth
    ? `\nDo NOT get past this by declaring \`humansRequired\` on a test a spec would settle. That lane means a ` +
      `person outside the building is the measurement, no unattended pass may ever run it, and mislabelling one ` +
      `costs an operator time it will never get back. Write the test when the allowance is there.`
    : "";
  return (
    `refusing to instrument "${test}": this pass has attached ${ration.spent()} instrument(s) and ${opening}. ` +
    `The tree already carries ${s.instrumented} command(s), ${s.unanswered} of which no result answers — ` +
    `attaching another adds readiness to a queue nothing has executed, which is the shortage this ration ` +
    `exists to make visible rather than an error in your call.\n` +
    `The allowance opens by ${ration.perResult} for each result recorded, and recording one is a person's ` +
    `\`ost-agent result\` — it is not on this surface and never will be. Until then, spend the pass on work ` +
    `that does not need a command: map evidence, ideate against under-served opportunities, or annotate what ` +
    `you would have instrumented so the next pass finds it.${doNotLaunder}`
  );
}
