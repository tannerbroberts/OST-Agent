/**
 * Counting the operations a call performs, so a gate can be stated in work done
 * rather than in wall-clock time.
 *
 * **What this is for.** `test/mcp/wall-clock-budget.test.ts` asserts that
 * `ost_next_work` answers a 10,000-node vault in under 2,000 ms. It flaked twice
 * in consecutive scheduled passes — 2004 ms and 2280 ms inside the full suite,
 * both passing with 18 seconds of margin when re-run in isolation seconds later.
 * Nothing regressed either time; the box was busy. A threshold that fires on
 * machine load spends the operator's attention and teaches them to discount red,
 * which is worse than having no gate at all.
 *
 * A budget in *operations* cannot fail that way. Load changes how long a read
 * takes; it does not change how many reads the algorithm performs. So the two
 * counters below are the load-independent half of the same criterion: they count
 * the file reads a call makes and the title comparisons the near-duplicate scan
 * performs, and both numbers are a function of the code and the fixture alone.
 *
 * **What it is not.** This does not replace a wall-clock bound where the
 * criterion is genuinely about latency a person experiences — a regression that
 * makes each operation slower without changing how many there are is invisible
 * here, by construction. The two gates are complements, and
 * `test/gate/operation-budget.test.ts` says which half is which.
 *
 * **The cost, stated where it can be read.** Operation counting needs a seam the
 * wall-clock version did not, and a bug in the seam is a bug in every gate built
 * on it at once. Two things hold that down: the counters are incremented at the
 * exact `fs` call sites they claim to count (never derived from a separate walk
 * that could drift from them), and the spec asserts a non-vacuous count against a
 * fixture of known size, so a seam that silently stopped counting reads as a
 * failure rather than as a comfortable zero.
 */

/** The operations a budget may be stated in. */
export type OperationKind =
  /** One file read off disk — one `fs.readFileSync` at a counted call site. */
  | "fileRead"
  /** One directory listing — one `fs.readdirSync` at a counted call site. */
  | "directoryScan"
  /** One title-pair similarity computation inside the near-duplicate scan. */
  | "titleComparison";

export const OPERATION_KINDS: readonly OperationKind[] = ["fileRead", "directoryScan", "titleComparison"];

export type OperationCounts = Record<OperationKind, number>;

/** A ceiling per kind. Kinds left out are unbudgeted, not budgeted at zero. */
export type OperationBudget = Partial<Record<OperationKind, number>>;

export interface BudgetOverrun {
  kind: OperationKind;
  counted: number;
  budget: number;
}

export interface BudgetVerdict {
  ok: boolean;
  /** Every kind that exceeded its ceiling, in {@link OPERATION_KINDS} order. */
  overruns: BudgetOverrun[];
  counts: OperationCounts;
}

function emptyCounts(): OperationCounts {
  return { fileRead: 0, directoryScan: 0, titleComparison: 0 };
}

/**
 * Open recorders, innermost last.
 *
 * A stack rather than a single slot so a nested measurement does not silently
 * steal its parent's operations: {@link countOperation} increments every open
 * recorder, so an inner count is also part of the outer one, which is what
 * "operations this call performed" means.
 */
const open: OperationCounts[] = [];

/**
 * Record one operation of `kind` against every open recorder.
 *
 * Called from the hot paths in `src/ost/vault.ts` and `src/ost/dedupe.ts`. With
 * no recorder open — which is every path the product takes in production — this
 * is a length check on an empty array and nothing else, so instrumenting a loop
 * that runs ten thousand times costs nothing a measurement could see.
 */
export function countOperation(kind: OperationKind, n = 1): void {
  if (open.length === 0) return;
  for (const counts of open) counts[kind] += n;
}

/**
 * Run `fn` and return what it produced alongside the operations it performed.
 *
 * Attribution is by wall-clock window, not by call graph: every counted
 * operation that happens while this is open is attributed to it. That is exact
 * for the synchronous, single-call measurements a gate takes, and it is the
 * reason {@link recordOperationsAsync} carries the warning it does.
 */
export function recordOperations<T>(fn: () => T): { value: T; counts: OperationCounts } {
  const counts = emptyCounts();
  open.push(counts);
  try {
    return { value: fn(), counts };
  } finally {
    open.pop();
  }
}

/**
 * The awaitable form, for tools whose entry point is async.
 *
 * Same window semantics, and the caveat that follows from them: anything else
 * awaiting concurrently in the same process will have its operations counted
 * here too. A gate measures one call at a time, which is why that is acceptable
 * rather than merely unavoidable.
 */
export async function recordOperationsAsync<T>(fn: () => Promise<T>): Promise<{ value: T; counts: OperationCounts }> {
  const counts = emptyCounts();
  open.push(counts);
  try {
    return { value: await fn(), counts };
  } finally {
    open.pop();
  }
}

/** The verdict a budget returns on a measurement. Pure — no clock is read. */
export function checkOperationBudget(counts: OperationCounts, budget: OperationBudget): BudgetVerdict {
  const overruns: BudgetOverrun[] = [];
  for (const kind of OPERATION_KINDS) {
    const ceiling = budget[kind];
    if (ceiling === undefined) continue;
    if (counts[kind] > ceiling) overruns.push({ kind, counted: counts[kind], budget: ceiling });
  }
  return { ok: overruns.length === 0, overruns, counts };
}

/**
 * The verdict as a sentence, with every counted number in it.
 *
 * A gate that reports only pass/fail makes the reader re-run it to find out how
 * close it was, which is the habit the wall-clock flake trained. The measurement
 * goes next to the verdict.
 */
export function describeBudgetVerdict(verdict: BudgetVerdict, budget: OperationBudget): string {
  const parts = OPERATION_KINDS.map((kind) => {
    const ceiling = budget[kind];
    return `${kind} ${verdict.counts[kind]}${ceiling === undefined ? " (unbudgeted)" : `/${ceiling}`}`;
  });
  return `${verdict.ok ? "within budget" : "OVER BUDGET"}: ${parts.join(", ")}`;
}
