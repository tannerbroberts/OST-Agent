/**
 * The unknown-context predicate: given one recorded step, could the recorder
 * have said where it ran?
 *
 * This is the decider half of "Refuse to record a step whose context could not
 * be determined". It is deliberately *only* the decider — nothing in this
 * repository consults it at a write boundary, and the assumption test beneath
 * that solution ("Measure how much signal a refuse-on-unknown-context rule would
 * delete") is the reason: the node asks for a price before an implementation,
 * because the rule it proposes throws information away on purpose.
 *
 * **Where this is parked, and why.** The price came back zero, and not the way
 * the node hoped. Over the ledger `readRuns` actually opens — 347 runs, 625
 * steps, 82 of them failures, on 2026-08-31 — this predicate refuses nothing at
 * all, because `loop step` is the only writer of a step record and it captures
 * `process.cwd()` and the argv unconditionally before it spawns anything. The
 * refusal is not a cheap safety net; it is inert. So this module is measured and
 * unwired, and it comes off that footing when something can actually write a
 * step with an undeterminable context — a second recorder, a record arriving
 * from another machine, an import path. See
 * `test/telemetry/unknown-context-refusal-cost.test.ts` and
 * `test/fixtures/unknown-context-price/PROVENANCE.md` for the count and the
 * corpora it was taken over.
 *
 * ## What "could not be determined" is allowed to mean
 *
 * The rule under test is a **precondition at the write boundary**. It runs
 * inside `appendStep`, which records what its caller handed it; it has no way to
 * re-derive a working directory for a command that already finished. So the
 * only question it can ask is *was I handed a context*, and the only evidence it
 * can ask it of is the fields on the record. That is what this file implements,
 * and stating it plainly matters, because it is also the limit the census
 * downstream runs into: a step missing `cwd` because its writer had no such
 * field is indistinguishable here from a step missing `cwd` because the world
 * genuinely could not say. The rule cannot tell those apart. Neither can this.
 *
 * ## Two readings, and why both are computed
 *
 * The solution node says "where a step ran", which is `cwd` alone. The
 * opportunity it sits under asks for "enough of its context that I can reproduce
 * it without guessing", which is `cwd` *and* `argv` — `LoopStepRecord.command`
 * is documented lossy in `src/loop/health.ts` ("it cannot tell one spaced
 * argument from two"), so a record with no `argv` cannot be replayed from
 * itself. Reporting one number under an unstated reading is how a rate gets
 * mistaken for a verdict, so both are computed and `reproducible` is a superset
 * of `where` by construction — an invariant the spec pins.
 */

/**
 * The shape this predicate reads, stated inline rather than imported from
 * `src/loop/health.ts`.
 *
 * Structural, for the same reason `health.ts` states `ToolSurfaceObservation`
 * and `GoalContractRecord` inline rather than importing them: the predicate must
 * be runnable over a step from anywhere — a fixture, a replayed line, a record
 * read out of a vault by something that does not import the loop — without
 * dragging the health record's writer in behind it. TypeScript's structural
 * typing makes the two agree with neither file importing the other.
 */
export interface RecordedStep {
  readonly phase?: string;
  readonly command?: string;
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly exit?: number;
  readonly at?: string;
}

/**
 * `where` is the solution node's own wording — the directory and nothing else.
 * `reproducible` adds the argv the parent opportunity needs. Every reading is a
 * superset of the one before it; {@link contextGaps} is what enforces that.
 */
export const CONTEXT_READINGS = ["where", "reproducible"] as const;
export type ContextReading = (typeof CONTEXT_READINGS)[number];

/**
 * Why a step's context could not be established, one reason per missing thing.
 *
 * Named rather than boolean because the refusal message has to say what it
 * found — a refusal reading only "unknown context" sends its reader back to the
 * ledger to work out which field.
 */
export type ContextGap = "no-command" | "no-cwd" | "cwd-not-absolute" | "no-argv" | "empty-argv";

const GAP_TEXT: Record<ContextGap, string> = {
  "no-command": "no command was recorded",
  "no-cwd": "no working directory was recorded",
  "cwd-not-absolute": "the recorded working directory is not an absolute path",
  "no-argv": "no argv was recorded, and the command string cannot be split back into one",
  "empty-argv": "the recorded argv is empty",
};

/**
 * A POSIX or Windows absolute path. Checked here rather than with
 * `path.isAbsolute`, which answers for the platform the census happens to run
 * on: a record written on Linux and read on a Mac is the ordinary case for this
 * ledger, and a predicate that changed its answer with the reader would make the
 * rate a property of the machine.
 */
function absolute(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");
}

/** Every reason this step's context could not be established, under `reading`. */
export function contextGaps(step: RecordedStep, reading: ContextReading): ContextGap[] {
  const gaps: ContextGap[] = [];
  if (typeof step.command !== "string" || step.command.trim() === "") gaps.push("no-command");
  if (typeof step.cwd !== "string" || step.cwd.trim() === "") gaps.push("no-cwd");
  else if (!absolute(step.cwd)) gaps.push("cwd-not-absolute");
  if (reading === "reproducible") {
    if (!Array.isArray(step.argv)) gaps.push("no-argv");
    else if (step.argv.length === 0) gaps.push("empty-argv");
  }
  return gaps;
}

/** Whether the recorder could have said where this step ran, under `reading`. */
export function contextDeterminable(step: RecordedStep, reading: ContextReading): boolean {
  return contextGaps(step, reading).length === 0;
}

/**
 * What the refusal would print, or `null` when it would not fire.
 *
 * The node's requirement, and the one thing about the candidate that is cheap to
 * get right whatever the price turns out to be: name the step and say what was
 * missing, so the caller's fix is one edit rather than one bisection.
 */
export function refusalFor(step: RecordedStep, reading: ContextReading): string | null {
  const gaps = contextGaps(step, reading);
  if (gaps.length === 0) return null;
  const phase = step.phase ? `\`${step.phase}\`` : "an unnamed phase";
  const command = typeof step.command === "string" && step.command.trim() !== "" ? `\`${step.command}\`` : "no command";
  return `refusing to record ${phase} (${command}): ${gaps.map((g) => GAP_TEXT[g]).join("; ")}`;
}
