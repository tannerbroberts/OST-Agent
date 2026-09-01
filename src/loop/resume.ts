/**
 * Resuming a killed pass from its own journal.
 *
 * `journal.ts` gives an interrupted run a durable account of what it finished.
 * This is what reads that account back: a restart replays the journal, skips
 * the steps whose completion is already recorded, settles the one step that was
 * in flight by looking at the vault, and carries on from there.
 *
 * ## The three dispositions, and why there are three rather than two
 *
 * A restart facing a step can be in exactly three states, and collapsing any
 * two of them is where a resumer loses work or duplicates it:
 *
 *   - **skipped** — a completion line names this step. It happened, in full,
 *     and re-running it is at best wasted work and at worst a second copy.
 *   - **verified** — no completion line, but the effect is already on disk. The
 *     process died in the window between the write landing and the append, or
 *     an earlier pass did the same thing. Nothing to do, and *nothing to record
 *     differently*: the completion line goes in now, because it is now true.
 *   - **ran** — no completion line and no effect. Do the work.
 *
 * The middle one is the whole reason this file exists. `journal.ts` records
 * completion *after* the fact on purpose, which means an interrupted run's last
 * step is systematically unrecorded — and a resumer that treats "unrecorded" as
 * "did not happen" re-runs it. For an append that is a duplicated section; for
 * a create it is a throw. So the journal's chosen understatement is paid for
 * exactly once, here, by asking the vault instead of the journal.
 *
 * ## What a step has to be for this to be safe
 *
 * {@link ResumableStep.applied} is not a convenience — it is the contract. A
 * step must be ONE atomic effect that its own `applied()` can see: with node
 * writes staged and renamed (`../fs/atomic-write.ts`), a killed step leaves the
 * vault either before or after that effect and never inside it, so `applied()`
 * is decisive. A step that writes two files can be killed between them, and
 * then `applied()` answers a question that has two answers.
 *
 * The solution node this implements names the risk plainly — *"every process
 * must be written to be replay-safe, which constrains how future work is built
 * and is easy to violate silently"*. The silence is the part worth removing, so
 * {@link runResumableSteps} checks `applied()` again after `apply()` returns and
 * throws when the effect it just performed is invisible to its own predicate.
 * A step whose replay-safety is wrong now fails the first time it runs, in
 * daylight, rather than the first time something kills it.
 */
import { appendStep, noteStepIntent, stepFailed } from "./health.js";
import { readJournal, type JournalEntry } from "./journal.js";
import { sweepAbandonedWrites } from "../fs/atomic-write.js";

/**
 * One replay-safe unit of work.
 *
 * `id` names the EFFECT, not the attempt — `append:Alpha#3`, not `step 4` —
 * because that is what a restart has to recognise across a process boundary. A
 * counter would collide the moment a pass changed shape between runs.
 */
export interface ResumableStep {
  readonly id: string;
  /** Where in the firing this sits, for the health ledger: `pass`, `check`. */
  readonly phase: string;
  /** What a human reads in the ledger to know what was done. */
  readonly command: string;
  /** True when this step's effect is already on disk. Must not write anything. */
  applied(): boolean;
  /** Perform the effect. One atomic write; see this file's header. */
  apply(): void;
}

export type StepDisposition = "skipped" | "verified" | "ran";

export interface StepOutcome {
  readonly id: string;
  readonly disposition: StepDisposition;
}

/**
 * What the journal says about work that is not accounted for by a seal.
 *
 * Scoped to the entries AFTER the last `seal` line, because a seal is what
 * closes an account: everything before it belongs to a run that finished and
 * said so, and carrying its completions forward would let a resumer skip work
 * a later pass legitimately means to do again.
 *
 * A `crash` line does NOT close the account, and that asymmetry is the point. A
 * crash line is written by the NEXT firing's sweep (`sweepCrashed`), after the
 * dead run's completions are already on the file — treating it as a boundary
 * would discard exactly the record the sweep exists to preserve, and every
 * restart would begin from nothing.
 */
export interface ResumeState {
  /** The run the unsealed work belongs to, when one line names it. */
  readonly runId?: string;
  /** Step ids with a zero-exit completion line. Done; do not run again. */
  readonly completed: readonly string[];
  /** Step ids announced but never completed — where the process actually stopped. */
  readonly inFlight: readonly string[];
  /** True when a run opened after the last seal, i.e. something did not finish. */
  readonly interrupted: boolean;
}

export function resumeState(dir: string): ResumeState {
  const entries = sinceLastSeal(readJournal(dir));
  const completed: string[] = [];
  const announced: string[] = [];
  let runId: string | undefined;
  let interrupted = false;
  for (const entry of entries) {
    if (entry.kind === "open") {
      runId = entry.runId;
      interrupted = true;
    }
    if (entry.kind === "intent" && !announced.includes(entry.stepId)) announced.push(entry.stepId);
    // A non-zero exit is a step that ran and FAILED, which is not a step that is
    // done: the next pass must attempt it again. Only a clean completion earns
    // a skip.
    if (entry.kind === "step" && entry.stepId && !stepFailed(entry) && !completed.includes(entry.stepId)) {
      completed.push(entry.stepId);
    }
  }
  return { ...(runId ? { runId } : {}), completed, inFlight: announced.filter((id) => !completed.includes(id)), interrupted };
}

function sinceLastSeal(entries: readonly JournalEntry[]): JournalEntry[] {
  let start = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].kind === "seal") {
      start = i + 1;
      break;
    }
  }
  return entries.slice(start);
}

/**
 * One line naming where an interrupted run stopped — the marker the friction
 * this whole branch answers said was missing ("a backgrounded session leaves no
 * marker of what it finished versus abandoned", meta vault, 2026-07-24).
 *
 * Deliberately says `may not have` about the in-flight step rather than picking
 * a side. From the journal alone that step's outcome is genuinely unknown, and
 * the thing that settles it is the vault, which this function does not read.
 */
export function resumeSummary(state: ResumeState): string {
  if (!state.interrupted) return "nothing to resume — the last run in the journal sealed";
  const finished = `${state.completed.length} step(s) finished`;
  const stopped =
    state.inFlight.length === 0
      ? "and nothing was in flight"
      : `and ${state.inFlight.join(", ")} was announced but never completed (it may or may not have landed)`;
  return `resuming ${state.runId ?? "an unnamed run"}: ${finished} ${stopped}`;
}

/**
 * Run `steps` in order, doing only what the journal and the vault say is left,
 * and record each one as it completes.
 *
 * The caller supplies the run: `startRun` before, `sealRun` after. This
 * deliberately does neither, because the bookends carry a firing's HEAD, its
 * ceiling and its verdict, and a helper that opened runs on the side would be a
 * second way to fire.
 *
 * Abandoned temporary writes are swept first. They are the residue of a killed
 * write's staging file, they can never be renamed into place (the only process
 * that could is gone), and leaving them turns an interrupted pass into a dirty
 * working tree in front of an auto-committing tool — see `state.ts` on what
 * `git add -A` does with a stranger's file.
 */
export function runResumableSteps(dir: string, steps: readonly ResumableStep[]): StepOutcome[] {
  sweepAbandonedWrites(dir);
  const state = resumeState(dir);
  const outcomes: StepOutcome[] = [];
  for (const step of steps) {
    if (state.completed.includes(step.id)) {
      outcomes.push({ id: step.id, disposition: "skipped" });
      continue;
    }
    // Announced before anything is attempted, so a kill inside `apply` leaves a
    // line naming what was underway. This is the only journal line in the
    // product written ahead of its event; `journal.ts` argues why it is allowed.
    noteStepIntent(dir, { stepId: step.id, phase: step.phase, command: step.command });
    const startedAt = Date.now();
    let disposition: StepDisposition;
    if (step.applied()) {
      disposition = "verified";
    } else {
      step.apply();
      if (!step.applied()) {
        throw new Error(
          `step "${step.id}" is not replay-safe: it ran, and its own \`applied()\` still reports the effect is absent. ` +
            "A restart would run it a second time. Make `applied()` recognise what `apply()` writes, or split the step " +
            "until each half is one atomic effect (src/loop/resume.ts).",
        );
      }
      disposition = "ran";
    }
    appendStep(dir, {
      phase: step.phase,
      command: step.command,
      stepId: step.id,
      exit: 0,
      durationMs: Date.now() - startedAt,
    });
    outcomes.push({ id: step.id, disposition });
  }
  return outcomes;
}
