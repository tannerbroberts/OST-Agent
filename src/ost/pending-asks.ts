/**
 * The standing queue of pending asks — everything a run could not answer itself,
 * durable across runs, aged, with the command that would clear it.
 *
 * The run that files an ask is gone before the operator ever looks; the queue is
 * what survives it. Membership is derived, never stored: a test is in the queue
 * iff it is a live AssumptionTest with no recorded result AND either its lane
 * says a person is what it is waiting on, or an ask for it is on the ledger.
 * Clearing is therefore automatic — recording a result (or re-classifying to
 * `compute-only`) drops the entry without anyone marking anything, the same
 * no-second-place-to-disagree rule `knowledge/asks.ts` states for the ledger.
 *
 * Deliberately NOT in the queue: unlabelled tests. The fail-closed lane rule
 * treats them as humans-required for *running*, but nobody has asked the
 * operator for them yet — they are triage backlog, already surfaced on
 * `assumptionWork.needsHumans`. A queue that mirrored that list would be the
 * second inbox the solution node warns against.
 */
import { computeMayRun, isLane, type LaneId } from "../knowledge/lanes.js";
import { defaultClearingCommand, latestAsk, readAskLedger, type AskLedger } from "../knowledge/asks.js";
import { hasRecordedResult } from "../eval/evidence-debt.js";
import type { OstNode } from "./node.js";

/** One entry of the standing queue, oldest ask first. */
export interface PendingAsk {
  /** Title of the AssumptionTest the ask is about. */
  test: string;
  /** The test's labelled lane, or `null` when the entry exists only via the ledger. */
  lane: LaneId | null;
  /** ISO timestamp of the most recent ask on record, or `null` when none is. */
  askedAt: string | null;
  /**
   * Whole days since `askedAt`, or `null` when `askedAt` is `null` — a test
   * classified before asks were persisted. Unknown, not zero: reporting `0`
   * would read as asked moments ago, the silent-clock failure P2 closes.
   */
  ageDays: number | null;
  /** Why the ask was filed, from its latest ledger record ("" when none is). */
  why: string;
  /**
   * The command that would clear this ask — the filing's own, or the universal
   * fallback of recording a result. Never null: a queue entry with no way to
   * act on it is furniture by construction.
   */
  command: string;
}

/**
 * Assemble the queue from a tree and its ask ledger. `now` is injected for the
 * same reason `appendAsk` takes it: an assertion about age cannot race the wall
 * clock. Oldest first, unknown-age last — the longest-unanswered ask is the one
 * the operator is most likely to have forgotten, so it leads even on a capped
 * display.
 */
export function pendingAskQueue(
  tree: readonly OstNode[],
  ledger: AskLedger,
  now: () => Date = () => new Date(),
): PendingAsk[] {
  const nowMs = now().getTime();
  const queue: PendingAsk[] = [];
  for (const t of tree) {
    if (t.layer !== "AssumptionTest" || hasRecordedResult(t)) continue;
    const lane: LaneId | null = t.lane && isLane(t.lane) ? t.lane : null;
    const ask = latestAsk(ledger, t.title);
    const waitsOnPerson = lane !== null && !computeMayRun(lane);
    if (!waitsOnPerson && !ask) continue;
    queue.push({
      test: t.title,
      lane,
      askedAt: ask?.ts ?? null,
      ageDays: ask ? Math.floor((nowMs - new Date(ask.ts).getTime()) / 86_400_000) : null,
      why: ask?.why ?? "",
      command: ask?.command ?? defaultClearingCommand(t.title),
    });
  }
  return queue.sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
}

/** Read the ledger and assemble the queue in one call — the CLI's entry point. */
export function readPendingAskQueue(dir: string, tree: readonly OstNode[], now: () => Date = () => new Date()): PendingAsk[] {
  return pendingAskQueue(tree, readAskLedger(dir), now);
}
