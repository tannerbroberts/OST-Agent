/**
 * The stall detector — has this vault been firing without moving the tree?
 *
 * The per-firing half of F4 already holds: a firing that changes no commit seals
 * `no-op`, never `healthy` (`computeVerdict`, `health.ts`). This is the other
 * half. A single `no-op` is ordinary — a cron that ticks between two bits of new
 * input fires, finds nothing, and says so. A *run* of them is a vault that is
 * spending its schedule and producing nothing, and the failure this closes is
 * that each such firing exits 0 and reads, one at a time, exactly like a
 * productive one. Read as a streak they stop reading that way.
 *
 * **Only `healthy` resets the streak, and that rule is the whole detector.** The
 * obvious counter — count `no-op`, reset on anything else — is defeated by two
 * records that are not progress but are also not `no-op`:
 *
 *   - a `crashed` firing (an unsealed marker the next `loop start` swept), and
 *   - an `unhealthy` one (a red or skipped phase).
 *
 * A dead vault does not fail politely in one verdict. It alternates: a dry pass,
 * a timeout the next `loop start` records as `crashed`, another dry pass. A
 * counter that reset on `crashed` would see that vault as never stuck, which is
 * the measurement hazard the readiness entry for F4 names by hand. So the
 * question is not "how many `no-op`s in a row" but "how many firings since the
 * tree last actually moved" — and the tree moves iff a firing seals `healthy`
 * (`computeVerdict` returns it only when HEAD before and after differ, which D5
 * makes trustworthy by refusing to fire against a dirty tree).
 *
 * **It does not latch, by construction.** Nothing is stored; this is a fold over
 * the ledger recomputed on every read. The next `healthy` firing drops the
 * streak to zero with no file for a human to edit — which is the point. Gate F
 * requires an escalation that reports rather than refusing to fire, and a signal
 * that clears itself the moment the vault does something is exactly that. The way
 * out is "make the vault produce a commit", and on a live vault S1 guarantees an
 * unattended firing on a `done` tree produces its own next evidence — so a
 * healthy vault seals `healthy` and never trips this at all. A tripped stall is
 * therefore a vault that has genuinely stopped, not a quiet one.
 */
import type { LoopRunRecord } from "./health.js";

/**
 * Consecutive firings without progress before the loop escalates.
 *
 * Three, matching F4's check ("run three consecutive firings … a run of them
 * escalates"). Low on purpose: the cost of escalating a still-recovering vault is
 * one stderr line an operator reads and ignores, and the cost of the other
 * direction is a dead vault burning its schedule unremarked — the same asymmetry
 * the lane vocabulary is built around.
 */
export const STALL_STREAK_THRESHOLD = 3;

export interface StallAssessment {
  /** True once the streak has reached the threshold. */
  stalled: boolean;
  /**
   * Consecutive most-recent sealed firings that did not advance the tree —
   * everything back to (and not including) the last `healthy` one.
   */
  streak: number;
  threshold: number;
  /**
   * `startedAt` of the oldest firing in the current streak — since when the tree
   * has not moved. Absent when the streak is empty.
   */
  since?: string;
  /** One line, in the operator's terms, for whichever surface prints it. */
  reason: string;
}

/**
 * Fold the ledger — newest first, the order {@link readRuns} returns — into a
 * stall assessment.
 *
 * A record whose verdict is absent (a corrupt line whose out-of-vocabulary
 * verdict {@link readRuns} dropped) is skipped, not counted: it is neither
 * progress that clears the streak nor evidence of a firing that did nothing. It
 * is simply unknown, and an unknown record must not be able to manufacture an
 * escalation any more than it may hide one.
 */
export function assessStall(
  runs: readonly LoopRunRecord[],
  threshold: number = STALL_STREAK_THRESHOLD,
): StallAssessment {
  let streak = 0;
  let since: string | undefined;
  for (const run of runs) {
    if (run.verdict === undefined) continue; // unknown — neither progress nor stall
    if (run.verdict === "healthy") break; // the tree moved here; the streak ends
    streak++;
    since = run.startedAt; // overwritten toward the oldest — ends at the streak's start
  }

  const stalled = streak >= threshold;
  const reason = stalled
    ? `${streak} consecutive firing(s) since ${since} advanced nothing (escalates at ${threshold}) — ` +
      `this vault is firing on schedule and the tree is not moving. Not a refusal: it keeps firing. ` +
      `The way out is a firing that produces a commit; the streak clears itself the moment one does.`
    : streak > 0
      ? `${streak} firing(s) without progress since the last healthy one (escalates at ${threshold})`
      : "the last firing advanced the tree";

  return { stalled, streak, threshold, ...(since !== undefined ? { since } : {}), reason };
}
