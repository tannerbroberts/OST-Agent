/**
 * Reconstructing an executable invocation from a recorded step.
 *
 * `LoopStepRecord` (`health.ts`) carries `cwd` and `argv` precisely so a
 * recorded failure can be re-run from the record alone — see "Every recorded
 * step carries the directory and argv it actually ran with" in the vault.
 * This module is the mechanism that claim describes: given a step, say
 * whether the record actually carries enough to rebuild the invocation, and
 * hand back the pair if so.
 *
 * **What this does not settle.** A green {@link reconstructInvocation} says
 * the fields are present and well-formed enough to spawn a process with. It
 * does not say re-running that process reproduces the original exit code —
 * environment variables, the node/pnpm version, `node_modules` state, and
 * elapsed-time dependence all move the exit code too, and none of them are
 * recorded. That judgement is the assumption test's, and it stays with a
 * person who runs the reconstructed command and looks.
 *
 * **`refused` steps are excluded from {@link recentNonZeroExitSteps}.** A
 * step the loop refused (`refused: "spend-ceiling"`) never spawned a child at
 * all — `cwd`/`argv` are stamped from the CLI's own state before the ceiling
 * check runs, not observed from a process that ran and failed. Such a step
 * always reconstructs perfectly and never tells you anything about whether a
 * record is sufficient to reproduce a failure, because nothing failed: the
 * command was never attempted. Counting it toward "non-zero exits" would let
 * a firing that halted itself on purpose stand in for a command that actually
 * broke.
 */
import { stepFailed, type LoopRunRecord, type LoopStepRecord } from "./health.js";

export interface ReconstructedInvocation {
  cwd: string;
  argv: string[];
}

/**
 * Null unless the step carries both a non-empty `cwd` and a non-empty
 * `argv` — the two fields necessary to spawn the same command in the same
 * place again. `argv[0]` is the executable; a record with fields present but
 * `argv` empty cannot be spawned, so it is treated the same as absent.
 */
export function reconstructInvocation(step: LoopStepRecord): ReconstructedInvocation | null {
  if (typeof step.cwd !== "string" || step.cwd.length === 0) return null;
  if (!Array.isArray(step.argv) || step.argv.length === 0) return null;
  if (!step.argv.every((a) => typeof a === "string")) return null;
  return { cwd: step.cwd, argv: [...step.argv] };
}

/**
 * The `limit` most recent steps, across all runs, that exited non-zero and
 * were not a refusal — newest first by the step's own `at`, not the run's
 * `startedAt`, because two steps in the same run are not simultaneous.
 */
export function recentNonZeroExitSteps(runs: readonly LoopRunRecord[], limit = 10): LoopStepRecord[] {
  const failures = runs
    .flatMap((run) => run.steps)
    .filter((step) => stepFailed(step) && step.refused === undefined);
  failures.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return failures.slice(0, limit);
}
