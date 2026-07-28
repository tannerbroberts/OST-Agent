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
 */
import type { BudgetsGene } from "../genome/schema.js";

export const DEFAULT_LOOKUP_BUDGET = 10;

export interface LookupBudget {
  /**
   * Spend one lookup, optionally on behalf of an unknown's class. False when
   * the shared pool is exhausted, or when `perClass` caps that class and the
   * cap is reached. A false take costs nothing.
   */
  take(klass?: string): boolean;
  /** Lookups left in the shared pool. Per-class caps do not narrow this number. */
  remaining(): number;
  limit: number;
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
): LookupBudget {
  const gene: BudgetsGene =
    typeof policy === "number"
      ? { sharedPool: policy, perClass: {}, onExhaustion: "instruct" }
      : policy;
  const limit = gene.sharedPool ?? operatorLimit ?? DEFAULT_LOOKUP_BUDGET;
  const perClass = gene.perClass ?? {};

  let used = 0;
  const usedByClass = new Map<string, number>();

  return {
    limit,
    take: (klass?: string) => {
      if (used >= limit) return false;
      if (klass !== undefined) {
        const cap = perClass[klass];
        if (cap !== undefined) {
          const spent = usedByClass.get(klass) ?? 0;
          if (spent >= cap) return false;
          usedByClass.set(klass, spent + 1);
        }
      }
      used++;
      return true;
    },
    remaining: () => limit - used,
  };
}

/** What a tool answers once the budget is spent — an instruction, not a refusal. */
export function budgetSpentMessage(
  limit: number,
  onExhaustion: BudgetsGene["onExhaustion"] = "instruct",
): string {
  if (onExhaustion === "record-unknown") {
    return (
      `Lookup budget spent (${limit} web lookups this session). ` +
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
    `Lookup budget spent (${limit} web lookups this session). ` +
    `Work from what you have already read and cite it. If something essential is still unknown, ` +
    `record it as an open question on the relevant node (ost_annotate or a note in the body) ` +
    `so the next session can pick it up with a fresh budget.`
  );
}
