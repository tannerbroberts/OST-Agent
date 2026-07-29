/**
 * The lookup budget — why looking outward stays a tool and not a habit.
 *
 * One counter is shared by `ost_search_web` and `ost_read_web`, created once
 * per PassContext (so: per MCP session, per pass). Exhaustion is not an
 * error: the tools answer with an instruction to work from what was already
 * read and to record what is still unknown on the tree, where the next
 * session will find it. Looking is cheap to start and expensive to binge.
 *
 * How much to look is the operator's number, and theirs alone:
 * `web.lookupBudget` in `ost.config.yaml`. It was briefly shadowable by a
 * `budgets` gene in `genome.yaml`, which is exactly the arrangement in which a
 * vault carries two budget numbers that can silently disagree — and the
 * evolvable one outranked the operator's. Removed with the rest of the genome.
 *
 * A per-class cap went with it. The gene's default was an empty map, i.e. one
 * shared class-blind counter, so nothing ever charged a class — but computing
 * which class to charge cost a full vault directory scan on every single web
 * lookup. Deleting an always-empty policy deleted the parse with it.
 *
 * The pool refills. `lookupBudget` is the burst capacity — no session can
 * spend more than that in quick succession, so a runaway loop is still
 * bounded — and `refillPerHour` is the sustained rate. Without a rate this is
 * a counter scoped to the process, and the process may live for weeks: a
 * per-session cap on an unbounded session is a per-lifetime cap, so an agent
 * running a long watch would spend its ten lookups in the first hour and go
 * blind for the rest of the run. Refill is computed on demand from elapsed
 * time, never by a timer, so an idle process and a busy one behave
 * identically, and the clock is injectable so tests never sleep. Setting the
 * rate to 0 restores the non-refilling counter exactly.
 *
 * A refill bounds a burst, not a lifetime: at the shipped 10-per-hour rate a
 * process that lives for a day may spend around 240 lookups, and one that
 * lives a week may spend seven times that. Naming a total ceiling is a V1
 * criterion (`docs/reference/v1-readiness.md`, P8), and `refillPerHour: 0`
 * is the hard cap that exists today.
 */

export const DEFAULT_LOOKUP_BUDGET = 10;
export const DEFAULT_REFILL_PER_HOUR = 10;

const MS_PER_HOUR = 60 * 60 * 1000;

export interface LookupBudget {
  /** Spend one lookup. False when the pool is exhausted; a false take costs nothing. */
  take(): boolean;
  /** Return a token spent on a lookup that yielded nothing (e.g. every source failed). */
  refund(): void;
  /** Lookups left in the pool. */
  remaining(): number;
  /** Milliseconds until at least one lookup is available; 0 if one is, Infinity if never. */
  msUntilNext(): number;
  limit: number;
}

export interface LookupBudgetOptions {
  /** Lookups restored per hour. 0 disables refill — one burst per process. */
  refillPerHour?: number;
  now?: () => number;
}

/**
 * Build the session's budget. `limit` is the operator's `web.lookupBudget`.
 */
export function createLookupBudget(
  limit: number = DEFAULT_LOOKUP_BUDGET,
  opts: LookupBudgetOptions = {},
): LookupBudget {
  const refillPerHour = opts.refillPerHour ?? DEFAULT_REFILL_PER_HOUR;
  const now = opts.now ?? (() => Date.now());

  // `used` is fractional once refill is in play; `remaining()` floors it, so a
  // partially-restored token is never reported as spendable.
  let used = 0;
  let last = now();

  function refill(): void {
    const t = now();
    if (refillPerHour > 0 && t > last) {
      used = Math.max(0, used - ((t - last) / MS_PER_HOUR) * refillPerHour);
    }
    last = t;
  }

  return {
    limit,
    take: () => {
      refill();
      if (used > limit - 1) return false;
      used++;
      return true;
    },
    refund: () => {
      refill();
      used = Math.max(0, used - 1);
    },
    remaining: () => {
      refill();
      return Math.floor(limit - used);
    },
    msUntilNext: () => {
      refill();
      if (used <= limit - 1) return 0;
      if (refillPerHour <= 0) return Infinity;
      return Math.ceil(((used - (limit - 1)) / refillPerHour) * MS_PER_HOUR);
    },
  };
}

/**
 * What a tool answers once the budget is spent — an instruction, not a refusal.
 *
 * A second wording shipped behind a genome allele: instead of "note the gap in
 * prose", it asked for an `#Unknown` node carrying a Format/Methodology/
 * Rationale contract — a machine-readable artifact the next pass could classify
 * and cost, rather than a sentence that goes nowhere. Which produces better
 * trees is a measurement nobody ever ran, and with the genome gone there is no
 * switch to hold both, so the shipped wording stays and the other is recoverable
 * from git history. Making the contract-shaped instruction the default is a
 * one-function change and a real decision, not a refactor.
 */
export function budgetSpentMessage(limit: number, msUntilNext: number = Infinity): string {
  // "Stop looking" is the wrong instruction for a session that outlives its
  // own burst. Naming the wait makes it "stop looking for now", which an
  // agent on a long watch can actually act on.
  const wait =
    Number.isFinite(msUntilNext) && msUntilNext > 0
      ? ` Another lookup becomes available in about ${Math.max(1, Math.round(msUntilNext / 60_000))} minutes.`
      : "";
  return (
    `Lookup budget spent (${limit} web lookups in this burst).${wait} ` +
    `Work from what you have already read and cite it. If something essential is still unknown, ` +
    `record it as an open question on the relevant node (ost_annotate or a note in the body) ` +
    `so the next session can pick it up with a fresh budget.`
  );
}
