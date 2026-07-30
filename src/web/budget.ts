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
 * A refill bounds a burst, not a lifetime. That was the hole P8 named
 * (`docs/reference/v1-readiness.md`): at the shipped 10-per-hour rate a process
 * that lives for a day spends around 240 lookups and one that lives a week
 * spends seven times that, so a number the operator wrote as a *cap* behaved as
 * a *rate*. Two days of simulated clock tell the two apart — one day cannot,
 * because 10-with-refill and 240-lifetime both sum to 240 over 24 hours.
 *
 * So there are now two counters and they are different things:
 *
 *   - the **burst allowance** (`limit`) refills at `refillPerHour`. It paces a
 *     single pass: no session spends more than `limit` in quick succession, and
 *     a runaway loop is throttled rather than merely eventually stopped.
 *   - the **lifetime total** (`lifetimeLimit`) never refills. It is the answer
 *     to "how much outward reach does this process get, in total, ever" — the
 *     question a burst rate cannot answer at all.
 *
 * `lifetimeLimit` defaults to `limit`, which is the fail-closed reading of the
 * operator's one number: `web.lookupBudget: 10` means "ten lookups", not "ten
 * per hour forever", and P8's check is exactly that total-over-all-time equals
 * `limit`. **That is a deliberate, stated narrowing of the long-watch
 * behaviour**: a process meant to run for weeks needs the total raised, and
 * raising it is one operator key rather than a property of how long the process
 * happened to stay up. Until `web.lookupLifetimeBudget` exists in the config
 * schema, a long watch is configured in code by passing `lifetimeLimit`
 * explicitly — the mechanism is here and only the config surface is missing.
 *
 * A refund is credited against the lifetime **a bounded number of times**, and that
 * bound is what makes the total a total. `refund()` exists so that a lookup which
 * yielded nothing — every source down — costs nothing, and crediting only the burst
 * would let other people's outages permanently drain the operator's ceiling. But an
 * unbounded credit is not a refund, it is a reset: take/fail/refund/retry spends the
 * lifetime and immediately un-spends it, so an agent facing a source that keeps
 * failing makes unboundedly many real outward attempts while `lifetimeRemaining()`
 * never moves. That is the same spin `src/security/tools.ts` already refuses to fund
 * in the all-cooling branch ("retrying immediately will not help"), arriving by the
 * other door. So the lifetime pool grants at most `lifetimeLimit` refunds ever: an
 * ordinary run, where failures are rare, never notices the allowance, and the worst
 * case is bounded at `2 × lifetimeLimit` outward attempts rather than at infinity.
 * The burst counter is still refunded every time — pacing should not punish an
 * outage, and the burst is bounded by its own capacity regardless.
 *
 * Both bind at once when they differ: with `limit: 10, refillPerHour: 10,
 * lifetimeLimit: 25` a session spends 10 now, 10 an hour later and 5 an hour
 * after that, and then nothing, ever. The pacing is the burst's, the ceiling is
 * the lifetime's. `refillPerHour: 0` still reproduces the original
 * non-refilling counter exactly.
 */

export const DEFAULT_LOOKUP_BUDGET = 10;
export const DEFAULT_REFILL_PER_HOUR = 10;

const MS_PER_HOUR = 60 * 60 * 1000;

export interface LookupBudget {
  /** Spend one lookup. False when either pool is exhausted; a false take costs nothing. */
  take(): boolean;
  /**
   * Return a token spent on a lookup that yielded nothing (e.g. every source failed).
   * Always credits the burst; credits the lifetime at most `lifetimeLimit` times, so
   * a failing source cannot be retried forever.
   */
  refund(): void;
  /** Lookups available right now — the smaller of what the burst and the lifetime allow. */
  remaining(): number;
  /** Lookups this budget will ever hand out again, refill or no. */
  lifetimeRemaining(): number;
  /** Milliseconds until at least one lookup is available; 0 if one is, Infinity if never. */
  msUntilNext(): number;
  /** The burst allowance — the operator's `web.lookupBudget`. */
  limit: number;
  /** The total this budget will hand out over all time. */
  lifetimeLimit: number;
}

export interface LookupBudgetOptions {
  /** Lookups restored per hour. 0 disables refill — one burst per process. */
  refillPerHour?: number;
  /**
   * Total lookups over the whole life of this budget, never refilled. Defaults to
   * `limit`, i.e. the operator's number is read as a cap rather than a rate. Pass
   * `Infinity` for the pre-P8 behaviour where only the burst rate bounded anything.
   */
  lifetimeLimit?: number;
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
  const lifetimeLimit = opts.lifetimeLimit ?? limit;
  const now = opts.now ?? (() => Date.now());

  // `used` is fractional once refill is in play; `remaining()` floors it, so a
  // partially-restored token is never reported as spendable.
  let used = 0;
  // `spentEver` is the lifetime counter. It is deliberately NOT touched by
  // refill(): that is the whole distinction between a rate and a total, and the
  // single line that P8 says was missing.
  let spentEver = 0;
  // How many refunds the lifetime pool has already funded. Capped at `lifetimeLimit`
  // so that take/fail/refund cannot loop forever — see the header. `Infinity` in,
  // `Infinity` out: a budget with no lifetime has nothing to protect.
  let lifetimeRefunds = 0;
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
    lifetimeLimit,
    take: () => {
      // Lifetime is checked first and cheaply: once it is spent no amount of
      // elapsed clock changes the answer, so there is nothing to recompute.
      if (spentEver >= lifetimeLimit) return false;
      refill();
      if (used > limit - 1) return false;
      used++;
      spentEver++;
      return true;
    },
    refund: () => {
      // A lookup that yielded nothing should cost neither counter. Refunding the
      // burst but not the lifetime would make failed sources permanently drain the
      // total, which is the one way an agent could be starved by other people's
      // outages rather than by its own spending. The burst is therefore always
      // credited; the lifetime is credited only while the allowance lasts, because
      // an unbounded lifetime credit turns take/fail/retry into an infinite supply
      // of outward attempts against a number the operator wrote as a cap.
      refill();
      used = Math.max(0, used - 1);
      if (lifetimeRefunds < lifetimeLimit) {
        lifetimeRefunds++;
        spentEver = Math.max(0, spentEver - 1);
      }
    },
    remaining: () => {
      refill();
      return Math.min(Math.floor(limit - used), Math.max(0, lifetimeLimit - spentEver));
    },
    lifetimeRemaining: () => Math.max(0, lifetimeLimit - spentEver),
    msUntilNext: () => {
      // Infinity here is what stops budgetSpentMessage promising a wait that will
      // never end: with the lifetime spent, "another lookup in 6 minutes" is a lie.
      if (spentEver >= lifetimeLimit) return Infinity;
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
  //
  // The count is deliberately *not* labelled "in this burst" any more. Since P8 the
  // same number is also the lifetime total by default, so naming one pool would be
  // wrong roughly half the time — and the caller cannot disambiguate: `ost_read_web`
  // calls this without an `msUntilNext` at all (src/security/tools.ts). What is
  // honest without knowing which pool ran out is the number and the wait, and the
  // wait already distinguishes them: a finite wait means the burst, no wait at all
  // means nothing more is coming.
  const wait =
    Number.isFinite(msUntilNext) && msUntilNext > 0
      ? ` Another lookup becomes available in about ${Math.max(1, Math.round(msUntilNext / 60_000))} minutes.`
      : "";
  return (
    `Lookup budget spent (${limit} web lookups).${wait} ` +
    `Work from what you have already read and cite it. If something essential is still unknown, ` +
    `record it as an open question on the relevant node (ost_annotate or a note in the body) ` +
    `so the next session can pick it up with a fresh budget.`
  );
}
