/**
 * The lookup budget — why looking outward stays a tool and not a habit.
 *
 * One counter is shared by `ost_search_web` and `ost_read_web`, created once
 * per PassContext (so: per MCP session, per pass). Exhaustion is not an
 * error: the tools answer with an instruction to work from what was already
 * read and to record what is still unknown on the tree, where the next
 * session will find it. Looking is cheap to start and expensive to binge.
 *
 * How much to look, and what to say when the looking stops, are policy — and
 * policy compiled in is a trait excluded from evolution. Both now come from
 * the genome's `budgets` gene. Two properties are held deliberately fixed
 * across that extraction. First, the operator keeps their number: a
 * `sharedPool` of `null` — the default — means "whatever `web.lookupBudget`
 * says in ost.config.yaml", so a vault with no genome.yaml spends exactly what
 * it spent before, and no vault ever carries two budget numbers that can
 * silently disagree. Only an explicit non-null `sharedPool` overrides the
 * operator, and that is the harness's business, not a vault's. Second, an
 * empty `perClass` map ignores the class argument entirely: one shared,
 * class-blind counter, indistinguishable from the counter that shipped.
 *
 * `perClass` names exceptions rather than a whitelist. A class the map does
 * not mention is bounded only by the shared pool; a class it caps is bounded
 * by both, and the shared pool always wins, so a generous per-class cap can
 * never mint lookups the session was not granted. A refused take — for either
 * reason — spends nothing.
 *
 * `onExhaustion` is the more interesting allele. `instruct` is what the tools
 * have always said: work from what you have, and note the gap in prose. That
 * gap then goes nowhere, which is the loop this whole phase exists to close.
 * `record-unknown` instead asks for an `#Unknown` node carrying a
 * Format/Methodology/Rationale contract — a machine-readable artifact the
 * next pass can classify, budget, and eventually cost. Which of the two
 * actually produces better trees is a measurement, not an opinion, so both
 * ship and the genome decides.
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
 * Per-class usage decays at the same rate as the shared pool, for the same
 * reason: a class cap that never recovers would permanently close that class
 * off partway into a long run, which is the very failure the refill exists to
 * prevent.
 */
import type { BudgetsGene } from "../genome/schema.js";

export const DEFAULT_LOOKUP_BUDGET = 10;
export const DEFAULT_REFILL_PER_HOUR = 10;

const MS_PER_HOUR = 60 * 60 * 1000;

export interface LookupBudget {
  /**
   * Spend one lookup, optionally on behalf of an unknown's class. False when
   * the shared pool is exhausted, or when `perClass` caps that class and the
   * cap is reached. A false take costs nothing.
   */
  take(klass?: string): boolean;
  /** Return a token spent on a lookup that yielded nothing (e.g. every source failed). */
  refund(klass?: string): void;
  /** Lookups left in the shared pool. Per-class caps do not narrow this number. */
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
 * Build the session's budget. `policy` accepts a bare number as a positional
 * shorthand for a class-blind pool of that size (every pre-genome call site
 * keeps working), or the genome's `budgets` gene. `operatorLimit` is
 * `config.web.lookupBudget` — consulted only when the gene declines to have an
 * opinion by leaving `sharedPool` null, which is the default.
 */
export function createLookupBudget(
  policy: number | BudgetsGene = DEFAULT_LOOKUP_BUDGET,
  operatorLimit?: number,
  opts: LookupBudgetOptions = {},
): LookupBudget {
  const gene: BudgetsGene =
    typeof policy === "number"
      ? { sharedPool: policy, perClass: {}, onExhaustion: "instruct" }
      : policy;
  const limit = gene.sharedPool ?? operatorLimit ?? DEFAULT_LOOKUP_BUDGET;
  const perClass = gene.perClass ?? {};
  const refillPerHour = opts.refillPerHour ?? DEFAULT_REFILL_PER_HOUR;
  const now = opts.now ?? (() => Date.now());

  // `used` is fractional once refill is in play; `remaining()` floors it, so a
  // partially-restored token is never reported as spendable.
  let used = 0;
  const usedByClass = new Map<string, number>();
  let last = now();

  function refill(): void {
    const t = now();
    if (refillPerHour > 0 && t > last) {
      const credit = ((t - last) / MS_PER_HOUR) * refillPerHour;
      used = Math.max(0, used - credit);
      for (const [k, spent] of usedByClass) usedByClass.set(k, Math.max(0, spent - credit));
    }
    last = t;
  }

  return {
    limit,
    take: (klass?: string) => {
      refill();
      if (used > limit - 1) return false;
      if (klass !== undefined) {
        const cap = perClass[klass];
        if (cap !== undefined) {
          const spent = usedByClass.get(klass) ?? 0;
          if (spent > cap - 1) return false;
          usedByClass.set(klass, spent + 1);
        }
      }
      used++;
      return true;
    },
    refund: (klass?: string) => {
      refill();
      used = Math.max(0, used - 1);
      if (klass !== undefined && usedByClass.has(klass)) {
        usedByClass.set(klass, Math.max(0, (usedByClass.get(klass) ?? 0) - 1));
      }
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

/** What a tool answers once the budget is spent — an instruction, not a refusal. */
export function budgetSpentMessage(
  limit: number,
  onExhaustion: BudgetsGene["onExhaustion"] = "instruct",
  msUntilNext: number = Infinity,
): string {
  // "Stop looking" is the wrong instruction for a session that outlives its
  // own burst. Naming the wait makes it "stop looking for now", which an
  // agent on a long watch can actually act on.
  const wait =
    Number.isFinite(msUntilNext) && msUntilNext > 0
      ? ` Another lookup becomes available in about ${Math.max(1, Math.round(msUntilNext / 60_000))} minutes.`
      : "";
  if (onExhaustion === "record-unknown") {
    return (
      `Lookup budget spent (${limit} web lookups in this burst).${wait} ` +
      `Stop looking outward and file what is still dark, so it can be picked up rather than forgotten: ` +
      `call ost_create_node with layer "Unknown", parent set to the node the gap darkens, and a body carrying ` +
      `## Format (the shape a valid answer must take — this is the stopping condition), ` +
      `## Methodology (the mechanism that would collect it), and ` +
      `## Rationale (a wikilink to the darkened node and the metric it serves). ` +
      `Then work from what you have already read and cite it. The next session sees the unknown in ost_next_work ` +
      `and picks it up with a fresh budget.`
    );
  }
  return (
    `Lookup budget spent (${limit} web lookups in this burst).${wait} ` +
    `Work from what you have already read and cite it. If something essential is still unknown, ` +
    `record it as an open question on the relevant node (ost_annotate or a note in the body) ` +
    `so the next session can pick it up with a fresh budget.`
  );
}
