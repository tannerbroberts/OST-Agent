/**
 * Is the run that is open right now still moving, or has it stopped?
 *
 * `stall.ts` answers a different question with a similar name. It folds the
 * *ledger* — a run of sealed firings that advanced nothing — and by
 * construction it can only speak about firings that already ended. The state
 * an operator actually worries about is the one it cannot see: a firing that
 * opened, and has neither sealed nor died in a way anything noticed. That run
 * holds the lock, spends the schedule, and reads from every existing surface
 * as "last-fired: 40 minutes ago, unsealed" — the same line a healthy run
 * forty minutes into real work prints.
 *
 * This module is the candidate definition of progress that separates those
 * two, written to be *replayable*: every input it takes is something the
 * record already contains, so the definition can be scored against runs that
 * already happened rather than only against runs it is allowed to kill. See
 * `test/loop/stall-definition-replay.test.ts` and
 * `test/fixtures/stall-definition/PROVENANCE.md`.
 *
 * ## Progress is a mark, and the journal alone does not emit enough of them
 *
 * The obvious definition — silence in `journal.jsonl` — does not work, and the
 * record says so numerically. A discovery firing writes `open`, then one
 * `step` line when the pass process exits, then `seal`. Between the first and
 * second there is exactly nothing, for the entire duration of the only step,
 * so "time since the last journal line" is "time since the run opened" for the
 * whole run. Over the meta vault's 282 recorded firings that demonstrably
 * moved the tree, the longest such journal-only silence is **244.6 minutes**,
 * and the longest silence in a firing that failed is 316.9. Those overlap, so
 * no threshold on journal silence separates them: it is not that the bar is
 * hard to place, it is that the two populations are not distinguishable by
 * this measurement at all.
 *
 * What does separate them is already on disk and is not in the journal.
 * Every mutating tool commits (`git add -A`, `src/git/safe-git.ts`), so a
 * commit in the vault during a run is the pass demonstrating it did something,
 * timestamped, durable, and readable by a watchdog that is outside the process
 * and cannot see into it. Fold commits in beside the journal lines and the
 * longest silence in a firing that moved the tree drops from 244.6 minutes to
 * **95.3**, while the failed firings still run to 230.5. That gap is where a
 * threshold can stand.
 *
 * A {@link ProgressMark} is therefore either kind, and the definition is one
 * sentence: **an open run is stalled when nothing it could have produced has
 * appeared for longer than {@link PROGRESS_SILENCE_BUDGET_MS}.**
 *
 * ## Why the budget is where it is, and what that costs
 *
 * {@link PROGRESS_SILENCE_BUDGET_MS} is not chosen for how fast it detects. It
 * is placed above the longest silence any firing that *demonstrably moved the
 * tree* ever showed, because the node this serves pre-committed to that
 * asymmetry: one false restart of healthy work is worse than no supervisor,
 * since it burns compute while looking alive. The calibration is asserted in
 * the replay test rather than trusted here, so a corpus that grows a longer
 * live silence fails the build instead of quietly turning into a false alarm.
 *
 * The price is stated plainly because it is the finding: a healthy firing in
 * this vault has gone 95 minutes without producing anything observable, so no
 * watchdog reading these signals can promise to notice a dead run in under
 * that. Sub-hour detection is not a tuning question — it needs the pass to
 * emit a heartbeat it currently does not emit.
 *
 * ## What this does not license
 *
 * Detection, not restart. The solution node's own text draws that line and the
 * record supports it: the corpus contains **no run any recorder ever labelled
 * stalled** — no `crashed` verdict, no `crash` journal line, no unsealed
 * journal — so the false-alarm half of the pre-committed threshold is measured
 * against 282 real runs and the detection half is measured against
 * reconstructed deaths of real runs ({@link truncateAtMark}). A definition
 * whose sensitivity has never met an actual stall is a reporter's input, not a
 * killer's.
 */

/**
 * How a run demonstrated it was doing something at a moment in time.
 *
 * `journal` is a line in `journal.jsonl` for this run. `commit` is a commit in
 * the vault inside the run's window — the effect of a mutating tool call, and
 * the only progress signal that arrives *during* a pass rather than after it.
 */
export type ProgressMarkKind = "journal" | "commit";

export interface ProgressMark {
  readonly kind: ProgressMarkKind;
  /** Epoch milliseconds. */
  readonly atMs: number;
}

/**
 * A run as the record has it — enough to replay the definition over it, and
 * nothing that requires the process still to exist.
 */
export interface ObservedRun {
  readonly runId: string;
  readonly startedAtMs: number;
  /**
   * When the run sealed, or absent when it never did. Absent is the shape a
   * killed process leaves behind, and the only shape a live watchdog ever
   * sees while it still has a decision to make.
   */
  readonly sealedAtMs?: number;
  /** Every mark inside the run's window, ascending. `startedAtMs` is itself a mark. */
  readonly marks: readonly ProgressMark[];
}

export type LivenessState = "sealed" | "alive" | "stalled";

export interface RunLiveness {
  readonly state: LivenessState;
  /** How long since the last thing this run produced. Zero for a sealed run. */
  readonly silenceMs: number;
  /** The mark the silence is measured from — the run's start when it produced nothing. */
  readonly lastProgressAtMs: number;
  readonly budgetMs: number;
  /** One line, in the operator's terms, for whichever surface prints it. */
  readonly reason: string;
}

/**
 * The longest a run may produce nothing before it is called stalled.
 *
 * Two hours. Derived, not picked: the longest silence any of the meta vault's
 * 282 tree-moving firings ever showed is 95.3 minutes (2026-08-30T05-44-18Z,
 * a 155-minute firing that sealed `healthy`), and this sits above it with
 * about 25% of headroom. `test/loop/stall-definition-replay.test.ts` asserts
 * that relationship against the committed corpus, so the margin is structural
 * rather than a number somebody remembered.
 *
 * Raising it costs detection latency directly. Lowering it below the corpus
 * maximum buys latency by manufacturing false alarms, which is the one trade
 * the node this serves pre-committed against.
 */
export const PROGRESS_SILENCE_BUDGET_MS = 120 * 60_000;

/** The most recent mark at or before `nowMs`, falling back to the run's start. */
export function lastProgressAtMs(run: ObservedRun, nowMs: number): number {
  let last = run.startedAtMs;
  for (const mark of run.marks) {
    if (mark.atMs > nowMs) break;
    if (mark.atMs > last) last = mark.atMs;
  }
  return last;
}

/**
 * The definition itself.
 *
 * A sealed run is never stalled, however long ago it sealed — it finished, and
 * a watchdog that confuses "over" with "stuck" restarts completed work. That
 * is checked before anything else and before the clock is consulted at all.
 */
export function assessRunLiveness(
  run: ObservedRun,
  nowMs: number,
  budgetMs: number = PROGRESS_SILENCE_BUDGET_MS,
): RunLiveness {
  if (run.sealedAtMs !== undefined && run.sealedAtMs <= nowMs) {
    return {
      state: "sealed",
      silenceMs: 0,
      lastProgressAtMs: run.sealedAtMs,
      budgetMs,
      reason: `sealed at ${new Date(run.sealedAtMs).toISOString()} — finished, not stuck`,
    };
  }
  const last = lastProgressAtMs(run, nowMs);
  const silenceMs = Math.max(0, nowMs - last);
  const minutes = (ms: number): string => (ms / 60_000).toFixed(0);
  if (silenceMs > budgetMs) {
    return {
      state: "stalled",
      silenceMs,
      lastProgressAtMs: last,
      budgetMs,
      reason:
        `${run.runId} has produced nothing for ${minutes(silenceMs)} minute(s) (budget ${minutes(budgetMs)}) — ` +
        `last sign of progress ${new Date(last).toISOString()}. It holds the lock and is spending the schedule. ` +
        `This is a report, not a kill: no run in the recorded sample was ever observed to stall, ` +
        `so the threshold is calibrated against healthy runs only.`,
    };
  }
  return {
    state: "alive",
    silenceMs,
    lastProgressAtMs: last,
    budgetMs,
    reason: `${minutes(silenceMs)} minute(s) since the last sign of progress (stalls at ${minutes(budgetMs)})`,
  };
}

/**
 * The longest stretch this run went without a mark while it was alive —
 * bookended by its start and, when it sealed, by its seal.
 *
 * This is the number the calibration is read off. Because
 * {@link assessRunLiveness} is monotone in `nowMs` between two consecutive
 * marks, "was never flagged at any instant of its life" and
 * "longestLiveSilenceMs <= budget" are the same statement; the replay test
 * checks the first and reports the second.
 */
export function longestLiveSilenceMs(run: ObservedRun): number {
  const ends = [run.startedAtMs, ...run.marks.map((m) => m.atMs)];
  if (run.sealedAtMs !== undefined) ends.push(run.sealedAtMs);
  ends.sort((a, b) => a - b);
  let longest = 0;
  for (let i = 1; i < ends.length; i++) longest = Math.max(longest, ends[i] - ends[i - 1]);
  return longest;
}

/**
 * The journal a real run would have left had its process died right after mark
 * `index` — the same marks, up to that one, and no seal.
 *
 * This is how the detection half of the threshold is exercised, and the
 * substitution is worth naming rather than hiding: the corpus contains no run
 * that was ever *observed* to stall, so there is no recorded positive to
 * replay. A truncation is not a synthetic run — every mark in it is a mark
 * that really happened, in the order and at the times it really happened — but
 * it models one specific way of dying: a process that stops emitting. It does
 * not model a process that keeps emitting while making no real progress, which
 * is the failure mode the node calls "restarts a subtly broken pass forever",
 * and nothing here detects that.
 */
export function truncateAtMark(run: ObservedRun, index: number): ObservedRun {
  return {
    runId: `${run.runId}#died-after-mark-${index}`,
    startedAtMs: run.startedAtMs,
    marks: run.marks.slice(0, index + 1),
  };
}

/**
 * Assemble the run a watchdog is looking at right now from the three things on
 * disk: the open-run marker, the journal, and the vault's commit times.
 *
 * Null when the marker's `startedAt` does not parse — a run whose start is
 * unreadable has no silence to measure, and guessing one would be inventing the
 * very number the decision turns on. The caller reports that as unknown rather
 * than as either answer.
 *
 * The commit times are passed in rather than read here, and `undefined` from
 * {@link commitTimesSince} must never reach this as `[]`: "git could not be
 * read" and "the run has committed nothing" produce the same mark list and
 * opposite correct actions.
 */
export function observeOpenRun(
  open: { readonly runId: string; readonly startedAt: string },
  journal: readonly { readonly runId: string; readonly at: string }[],
  commitTimesMs: readonly number[],
): ObservedRun | null {
  const startedAtMs = Date.parse(open.startedAt);
  if (!Number.isFinite(startedAtMs)) return null;
  const marks: ProgressMark[] = [];
  for (const entry of journal) {
    if (entry.runId !== open.runId) continue;
    const atMs = Date.parse(entry.at);
    if (Number.isFinite(atMs) && atMs >= startedAtMs) marks.push({ kind: "journal", atMs });
  }
  for (const atMs of commitTimesMs) {
    if (Number.isFinite(atMs) && atMs >= startedAtMs) marks.push({ kind: "commit", atMs });
  }
  marks.sort((a, b) => a.atMs - b.atMs);
  return { runId: open.runId, startedAtMs, marks };
}

/**
 * What the recorder wrote about a finished run, in the recorder's own words,
 * plus the one thing it writes by writing nothing.
 *
 * `unsealed` is not a verdict `health.ts` can produce — it is the absence of
 * one, which is precisely what a run that stopped without anything noticing
 * leaves behind. Together with `crashed` (the sweeper found an unsealed marker)
 * these are the only two shapes in which the record has ever been able to say
 * "this run stopped", and {@link observedStalls} counts them.
 */
export type RecordedOutcome = "healthy" | "unhealthy" | "no-op" | "crashed" | "degraded" | "unsealed";

export interface RecordedRun extends ObservedRun {
  readonly outcome: RecordedOutcome;
}

/**
 * The runs in a corpus that the record itself says stopped rather than
 * finished — the only positives a replay may honestly count as known stalls.
 *
 * Kept as a function rather than a comment because the count is the finding:
 * on the corpus committed with this repository it returns zero, and the day it
 * does not, the replay test's calibration has a real positive to face.
 */
export function observedStalls(runs: readonly RecordedRun[]): RecordedRun[] {
  return runs.filter((run) => run.outcome === "crashed" || run.outcome === "unsealed");
}

/**
 * Every run in the corpus that demonstrably moved the tree — the negatives the
 * "zero false alarms" half of the threshold is measured over.
 *
 * `healthy` is not a synonym for "finished fine": `computeVerdict` returns it
 * only when HEAD differs before and after, so each of these is a firing that
 * produced a commit and was therefore unambiguously working the whole time it
 * was open. That is why they, and not the whole ledger, are the false-alarm
 * set — an `unhealthy` firing might have been working and might have been hung,
 * and the record does not say which.
 */
export function treeMovingRuns(runs: readonly RecordedRun[]): RecordedRun[] {
  return runs.filter((run) => run.outcome === "healthy");
}
