/**
 * The ageing rule, as a counter over past sweeps — and the backlog it fills.
 *
 * **The problem.** A queue that reports the same item on every pass has stopped
 * being information. This vault's `unmappedEvidence` list has carried the same
 * stranded records for weeks: every pass re-reads them, no pass can clear them,
 * and `done` is never reached because of items no pass was ever going to touch.
 * The candidate remedy is ageing — an item outstanding for N consecutive passes
 * with nothing done about it stops leading the list and moves to a backlog that
 * is still counted, still queryable, still there.
 *
 * **The risk that decides whether the remedy is any good, and why this module
 * only replays.** Ageing rewards neglect. The surest way out of the outstanding
 * list becomes being ignored long enough, and the items most likely to be
 * ignored are the hard ones — so the backlog it assembles may be exactly the
 * work that most needed attention. That is a claim about the *tree's own past*,
 * and no argument settles it: somebody has to look at what the rule would have
 * buried and say whether it mattered. So nothing here changes what a live sweep
 * reports. This applies the rule to sweeps that already happened and produces
 * the list a person judges. Adopting the rule is a separate decision, and it is
 * downstream of that judgement rather than upstream of it.
 *
 * **What "nothing was done about it" means, and why presence alone will not do.**
 * The obvious counter is "present on N passes in a row". It is wrong on exactly
 * the items you least want to bury: an opportunity that needs three solutions
 * and gained its second last pass is still on the queue, and a presence-only
 * counter reads that as another pass of neglect. So an observation carries a
 * {@link SweepItem.signature} — whatever about the item would change if somebody
 * worked on it, in one string — and a changed signature resets the streak. An
 * item with no signature is counted on presence alone, which is honest for the
 * queues where nothing partial exists (an evidence record is mapped or it is
 * not) and is the caller's declaration, not a default this module picked.
 *
 * **Counted, never deleted.** Every aged item comes back with the pass it aged
 * out on, how many untouched passes it took, and the item itself. The final
 * split is asserted to partition the last sweep exactly — nothing may be in
 * both halves and nothing in neither — because a backlog that loses an item is
 * a quiet deletion wearing a nicer word, and that is the one outcome the
 * mechanism cannot be allowed to have.
 */

/**
 * One item as some past sweep listed it.
 *
 * `key` identifies the item across passes — an evidence id, a node title.
 * `signature` is the caller's answer to "what would look different if somebody
 * had worked on this?", and is omitted when the honest answer is "nothing
 * short of it leaving the list".
 */
export interface SweepItem {
  readonly key: string;
  readonly signature?: string;
}

/** One past sweep: the queue as it stood at a point the replay can name. */
export interface SweepObservation {
  /** When it stood that way — ISO, from the commit, never from a clock here. */
  readonly at: string;
  /** How the replay reached it (a commit sha, a ledger line), so a reading can be re-taken. */
  readonly ref: string;
  readonly items: readonly SweepItem[];
}

/** An item the rule moved out of the default view, with everything needed to get it back. */
export interface AgedItem {
  readonly key: string;
  /** The item exactly as the final sweep listed it — the "recoverable" half of the backlog. */
  readonly item: SweepItem;
  /** `at` of the first sweep in the streak that buried it. */
  readonly untouchedSince: string;
  /** `at` of the sweep on which it crossed the threshold. */
  readonly agedOutAt: string;
  /** `ref` of that same sweep. */
  readonly agedOutRef: string;
  /** Consecutive untouched passes as of the final sweep — always >= the threshold. */
  readonly passesUntouched: number;
}

/**
 * An age-out or a return, recorded as it happened rather than inferred from the
 * ends.
 *
 * The returns are the point. "Aged out and never came back" and "aged out three
 * times because somebody kept half-touching it" look identical in a final split
 * and mean opposite things about the rule.
 */
export interface BacklogMovement {
  readonly kind: "aged-out" | "returned";
  readonly key: string;
  readonly at: string;
  readonly ref: string;
  /** For `aged-out`, the streak that buried it; for `returned`, the streak it had when it was freed. */
  readonly passesUntouched: number;
  /** For `returned` only: what brought it back. */
  readonly because?: "worked-on" | "left-the-queue";
}

export interface AgeingReplay {
  /** The threshold that was applied — N consecutive untouched passes. */
  readonly passes: number;
  /** How many past sweeps were replayed. The denominator every count below is taken over. */
  readonly observations: number;
  /** The window the replay covers, from the first sweep's `at` to the last. */
  readonly from: string;
  readonly to: string;
  /** Items on the final sweep — `active.length + backlog.count`, asserted. */
  readonly outstanding: number;
  /** What the default view would still have led with. */
  readonly active: readonly SweepItem[];
  /** What moved out of it, counted and recoverable. */
  readonly backlog: {
    readonly count: number;
    readonly items: readonly AgedItem[];
  };
  /** Every age-out and every return across the whole window, in order. */
  readonly movements: readonly BacklogMovement[];
}

/**
 * The smallest threshold that is a rule rather than a reflex.
 *
 * At N = 1 an item is buried the first time it is seen, which is not ageing —
 * it is a queue that reports nothing. Refused rather than clamped: a caller who
 * asked for 1 meant something, and quietly giving them 2 hides which.
 */
export const MIN_AGEING_PASSES = 2;

/**
 * Apply the ageing rule to a sequence of past sweeps, oldest first.
 *
 * Throws on an empty sequence. A replay over no sweeps would report an empty
 * backlog, and "the rule would have buried nothing" is the same sentence
 * whether the rule is safe or the replay looked at nothing — which is the
 * failure `ost/sweep.ts` exists to refuse, in a module that would otherwise
 * reproduce it.
 */
export function replayAgeingRule(
  observations: readonly SweepObservation[],
  opts: { passes: number },
): AgeingReplay {
  const { passes } = opts;
  if (!Number.isInteger(passes) || passes < MIN_AGEING_PASSES) {
    throw new Error(
      `an ageing threshold must be an integer of at least ${MIN_AGEING_PASSES} consecutive passes — got ${passes}; ` +
        `at 1 an item is backlogged the first time it is reported, which is not ageing`,
    );
  }
  if (observations.length === 0) {
    throw new Error(
      "cannot replay an ageing rule over 0 past sweeps — an empty backlog computed over nothing reads exactly like a rule that buried nothing",
    );
  }

  /** Per key, the state carried from the previous sweep it appeared on. */
  interface Streak {
    signature: string | undefined;
    /** Consecutive sweeps, ending at the previous one, on which it was present and untouched. */
    length: number;
    /** `at` of the sweep that started the current streak. */
    since: string;
    /** Has it already crossed the threshold within this streak? */
    backlogged: boolean;
  }

  const streaks = new Map<string, Streak>();
  const movements: BacklogMovement[] = [];

  for (const observation of observations) {
    const seen = new Set<string>();

    for (const item of observation.items) {
      seen.add(item.key);
      const prior = streaks.get(item.key);

      // A changed signature is work: the streak restarts at this sweep, and an
      // item already in the backlog is freed by it. This is the branch that
      // keeps a half-done opportunity out of the backlog.
      if (prior && prior.signature !== item.signature) {
        if (prior.backlogged) {
          movements.push({
            kind: "returned",
            key: item.key,
            at: observation.at,
            ref: observation.ref,
            passesUntouched: prior.length,
            because: "worked-on",
          });
        }
        streaks.set(item.key, { signature: item.signature, length: 1, since: observation.at, backlogged: false });
        continue;
      }

      const length = (prior?.length ?? 0) + 1;
      const since = prior?.since ?? observation.at;
      const wasBacklogged = prior?.backlogged ?? false;
      const backlogged = wasBacklogged || length >= passes;
      if (backlogged && !wasBacklogged) {
        movements.push({
          kind: "aged-out",
          key: item.key,
          at: observation.at,
          ref: observation.ref,
          passesUntouched: length,
        });
      }
      streaks.set(item.key, { signature: item.signature, length, since, backlogged });
    }

    // Leaving the queue is the strongest form of "something was done about it",
    // and it frees a backlogged item the same way work does. Recorded, because
    // an item that aged out and was then cleared anyway is evidence about the
    // rule that the final split cannot show.
    for (const [key, streak] of streaks) {
      if (seen.has(key)) continue;
      if (streak.backlogged) {
        movements.push({
          kind: "returned",
          key,
          at: observation.at,
          ref: observation.ref,
          passesUntouched: streak.length,
          because: "left-the-queue",
        });
      }
      streaks.delete(key);
    }
  }

  const final = observations[observations.length - 1];
  const active: SweepItem[] = [];
  const backlogItems: AgedItem[] = [];
  for (const item of final.items) {
    const streak = streaks.get(item.key);
    if (!streak?.backlogged) {
      active.push(item);
      continue;
    }
    const agedOut = lastAgeOut(movements, item.key);
    backlogItems.push({
      key: item.key,
      item,
      untouchedSince: streak.since,
      agedOutAt: agedOut?.at ?? final.at,
      agedOutRef: agedOut?.ref ?? final.ref,
      passesUntouched: streak.length,
    });
  }

  // The invariant the whole mechanism rests on. It is asserted rather than
  // trusted because a backlog that loses an item is indistinguishable, from the
  // outside, from a backlog that is working.
  const outstanding = final.items.length;
  if (active.length + backlogItems.length !== outstanding) {
    throw new Error(
      `ageing split lost an item: ${active.length} active + ${backlogItems.length} backlogged over ${outstanding} outstanding`,
    );
  }

  return {
    passes,
    observations: observations.length,
    from: observations[0].at,
    to: final.at,
    outstanding,
    active,
    backlog: { count: backlogItems.length, items: backlogItems },
    movements,
  };
}

/** The most recent age-out recorded for `key`, or undefined if the replay recorded none. */
function lastAgeOut(movements: readonly BacklogMovement[], key: string): BacklogMovement | undefined {
  for (let i = movements.length - 1; i >= 0; i--) {
    const m = movements[i];
    if (m.key === key && m.kind === "aged-out") return m;
  }
  return undefined;
}

/**
 * The operator's read of a replay, denominator first.
 *
 * The window and the sweep count lead every rendering on purpose: "6 items
 * would have aged out" is the sentence that cannot be checked, and "6 of 19,
 * over 8 sweeps between two dates" is the same finding with the thing that
 * would have shown a thin replay standing next to it.
 */
export function formatAgeingReplay(replay: AgeingReplay, queue: string): string[] {
  const lines: string[] = [
    `ageing replay — queue \`${queue}\`, ${replay.passes} consecutive untouched pass(es), over ${replay.observations} past sweep(s) from ${replay.from} to ${replay.to}.`,
    `  ${replay.backlog.count} of ${replay.outstanding} outstanding item(s) would have moved to the backlog; ${replay.active.length} would still lead the default view.`,
  ];
  if (replay.backlog.count === 0) {
    lines.push(`  Nothing would have aged out. Either the queue turns over, or ${replay.passes} passes is more than this window holds.`);
  }
  for (const aged of replay.backlog.items) {
    lines.push(`  [backlog] ${aged.key} — untouched since ${aged.untouchedSince}, ${aged.passesUntouched} pass(es), aged out ${aged.agedOutAt} (${aged.agedOutRef.slice(0, 8)})`);
  }
  const returns = replay.movements.filter((m) => m.kind === "returned");
  if (returns.length) {
    lines.push(`  ${returns.length} item(s) left the backlog again during the window — the rule is not one-way here:`);
    for (const r of returns) {
      lines.push(`    [returned] ${r.key} — ${r.because === "worked-on" ? "worked on" : "left the queue"} at ${r.at}, after ${r.passesUntouched} untouched pass(es)`);
    }
  }
  lines.push(
    `  Judge each backlogged item: was it genuinely unactionable, or was it hard and being avoided? The threshold this replay is evidence for is "at most 2 in 10 aged-out items are judged to have mattered".`,
  );
  return lines;
}
