/**
 * The canary harness — run a changed process alongside the one already in
 * production, over the same input, and hand a human both outputs to judge.
 *
 * "Canary the changed process against the old one" claims exactly one
 * advantage over every other way of shipping a workflow change: no
 * interruption, because the old process never stops. That claim has two
 * parts, and both are load-bearing here:
 *
 * 1. **Identical input.** The incumbent and the candidate must run over the
 *    same input, not two references to a value one of them could mutate out
 *    from under the other. `runCanary` clones the input once per process so
 *    a spec can prove the two runs were comparable on that axis, which is the
 *    one axis a spec CAN prove — whether the outputs are commensurable is a
 *    judgement this module does not make.
 * 2. **A failing or diverging candidate never reaches the incumbent's
 *    result.** `runCanary` returns the incumbent's output as `incumbent`
 *    regardless of what the candidate does. A candidate that throws is
 *    caught and reported as `candidate.error`; it is never rethrown, and it
 *    never replaces `incumbent`. The only thing that changes based on the
 *    candidate is what gets shown to the human doing the comparison.
 *
 * What a green suite here does NOT settle, per the node's own accounting:
 * whether the two outputs are comparable enough to judge, and whether a
 * human can pick a winner in a couple of minutes. Both are usability and
 * feasibility questions for a person with a clock, not something this
 * harness can determine by running twice.
 */

/** One process under comparison: takes an input, produces an output. */
export type CanaryProcess<In, Out> = (input: In) => Out | Promise<Out>;

export type CanaryOutcome<Out> = { readonly ok: true; readonly output: Out } | { readonly ok: false; readonly error: string };

export interface CanaryResult<In, Out> {
  /** The input both processes ran over — captured once, before either clone. */
  readonly input: In;
  /** The incumbent's output. This is the only result production ever sees. */
  readonly incumbent: Out;
  /** The candidate's outcome — an output, or the error it threw instead of one. */
  readonly candidate: CanaryOutcome<Out>;
  /** True when the candidate errored, or produced an output unequal to the incumbent's. */
  readonly diverged: boolean;
}

async function runOne<In, Out>(process: CanaryProcess<In, Out>, input: In): Promise<CanaryOutcome<Out>> {
  try {
    return { ok: true, output: await process(input) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run `incumbent` and `candidate` in parallel over deep-cloned copies of the
 * same `input`, and report both outputs without letting the candidate touch
 * the incumbent's.
 *
 * The incumbent is the process already trusted in production: if it throws,
 * `runCanary` rethrows rather than inventing a result, because a harness that
 * swallowed the incumbent's own failure would be hiding the one output the
 * comparison exists to protect. The candidate's failure is the case this
 * harness is built for, and it never propagates — it is captured in
 * `candidate.error` and folded into `diverged`.
 */
export async function runCanary<In, Out>(
  input: In,
  incumbent: CanaryProcess<In, Out>,
  candidate: CanaryProcess<In, Out>,
): Promise<CanaryResult<In, Out>> {
  const incumbentInput = structuredClone(input);
  const candidateInput = structuredClone(input);

  const [incumbentOutcome, candidateOutcome] = await Promise.all([
    runOne(incumbent, incumbentInput),
    runOne(candidate, candidateInput),
  ]);

  if (!incumbentOutcome.ok) {
    throw new Error(`canary: incumbent process failed — ${incumbentOutcome.error}`);
  }

  const diverged = !candidateOutcome.ok || JSON.stringify(candidateOutcome.output) !== JSON.stringify(incumbentOutcome.output);

  return { input, incumbent: incumbentOutcome.output, candidate: candidateOutcome, diverged };
}

/**
 * The side-by-side view a human judges: both outputs, printed next to each
 * other rather than summarised into a verdict this harness has no standing
 * to make.
 */
export function renderCanary<In, Out>(result: CanaryResult<In, Out>): string {
  const lines: string[] = [];
  lines.push(`canary: input ${JSON.stringify(result.input)}`);
  lines.push(`  incumbent: ${JSON.stringify(result.incumbent)}`);
  if (result.candidate.ok) {
    lines.push(`  candidate: ${JSON.stringify(result.candidate.output)}`);
    lines.push(result.diverged ? "  DIVERGED — outputs differ, incumbent's result stands unless a human adopts the candidate" : "  MATCH — outputs identical");
  } else {
    lines.push(`  candidate: ERROR — ${result.candidate.error}`);
    lines.push("  incumbent's result is untouched by the candidate's failure");
  }
  return lines.join("\n");
}
