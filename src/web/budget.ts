/**
 * The lookup budget — why looking outward stays a tool and not a habit.
 *
 * One counter is shared by `ost_search_web` and `ost_read_web`, created once
 * per PassContext (so: per MCP session, per pass). Exhaustion is not an
 * error: the tools answer with an instruction to work from what was already
 * read and to record what is still unknown on the tree, where the next
 * session will find it. Looking is cheap to start and expensive to binge.
 */

export const DEFAULT_LOOKUP_BUDGET = 10;

export interface LookupBudget {
  /** Spend one lookup. False when the budget is exhausted. */
  take(): boolean;
  remaining(): number;
  limit: number;
}

export function createLookupBudget(limit = DEFAULT_LOOKUP_BUDGET): LookupBudget {
  let used = 0;
  return {
    limit,
    take: () => (used < limit ? (used++, true) : false),
    remaining: () => limit - used,
  };
}

/** What a tool answers once the budget is spent — an instruction, not a refusal. */
export function budgetSpentMessage(limit: number): string {
  return (
    `Lookup budget spent (${limit} web lookups this session). ` +
    `Work from what you have already read and cite it. If something essential is still unknown, ` +
    `record it as an open question on the relevant node (ost_annotate or a note in the body) ` +
    `so the next session can pick it up with a fresh budget.`
  );
}
