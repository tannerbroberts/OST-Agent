/**
 * The lines a failed firing prints so a machine cannot mistake it for a quiet one.
 *
 * **The friction, observed mechanically on 2026-07-25.** `P2_map` died on an auth
 * error, exited 0, wrote a commit and printed a tidy summary. On a nightly cron
 * that firing would have no-opped forever while looking perfectly healthy. The
 * exit-code half of the answer shipped in v0.5.0 and holds: a failed phase's code
 * survives `loop step`, and a run with a failed step seals `unhealthy` and exits
 * non-zero. This is the other half, and until now it did not exist.
 *
 * **What was actually missing, measured rather than assumed.** `loop seal` already
 * printed a per-step checklist — `✗ pass (exit 3)` — but three things were wrong
 * with it as the thing a scheduler reads:
 *
 *   - It is on stdout, above twenty lines of sense census, so the one red line is
 *     the fifth-from-top of a screenful in a mail nobody reads to the end. Every
 *     other line in this loop that must not be scrolled past — the degraded
 *     banner, the stall escalation, a loud goal drift — is on stderr.
 *   - It is a list, not a summary: green and red steps are formatted alike, and
 *     the reader has to do the finding.
 *   - Nothing anywhere says which node the firing was on when it died, so the
 *     first question a human asks next ("what was it in the middle of?") is
 *     answerable only by hand, out of the vault's trace.
 *
 * **A pure fold, deliberately.** Everything here is computed from a
 * `LoopRunRecord` the loop wrote and a {@link NodeTouch} the trace reader
 * observed; this module opens nothing and decides nothing. It is filed PURE in
 * `test/release/gate-f-deciders.test.ts`, and it should stay that way: a report
 * whose inputs are handed to it cannot quietly become a gate.
 *
 * **What it must not do, and the negative controls that hold it to that.** A
 * failure banner printed over every seal would say nothing. `degraded` in
 * particular is not a failure — it has its own exit code precisely so a wrapper
 * can tell "the tree came back red" from "the pass never reached the tree" — so
 * it gets no banner here. `test/runner/pass-exit-code.test.ts` asserts the
 * silence as hard as it asserts the speech.
 */
import { REQUIRED_PHASES, stepFailed, type LoopRunRecord } from "./health.js";
// Type-only: the observation is made by `src/telemetry/node-touch.ts` and handed
// in, so nothing here reaches the trace and the PURE filing stays true.
import type { NodeTouch } from "../telemetry/node-touch.js";

/** The verdicts that mean this firing failed, as opposed to could not, or need not. */
const FAILED_VERDICTS = new Set(["unhealthy", "crashed"]);

/**
 * Where the firing died, in the terms the ledger recorded it.
 *
 * A run can be `unhealthy` two ways and they want different sentences. A phase
 * that exited non-zero is the ordinary one and names itself. The other is
 * omission — every step green and a required phase that never ran, which is H4's
 * case and reads as a silent success to anyone who only counted red lines. Left
 * as one branch each rather than collapsed into "something went wrong", because
 * "the check never ran" and "the check failed" send a reader to different places.
 */
function whereItDied(run: LoopRunRecord): string[] {
  const failed = run.steps.filter(stepFailed);
  if (failed.length > 0) {
    const first = failed[0];
    const rest = failed.length > 1 ? ` (and ${failed.length - 1} later phase(s) also failed)` : "";
    return [
      `  died in phase \`${first.phase}\` — exit ${first.exit}${rest}`,
      `    ${first.command}${first.cwd ? ` (in ${first.cwd})` : ""}`,
    ];
  }
  const ran = new Set(run.steps.map((s) => s.phase));
  const missing = REQUIRED_PHASES.filter((p) => !ran.has(p));
  if (missing.length > 0) {
    return [
      `  no phase failed — required phase(s) never ran: ${missing.map((p) => `\`${p}\``).join(", ")}`,
      `    A phase that was skipped leaves no red line to find, which is why this one is spelled out.`,
    ];
  }
  // Reachable only if `computeVerdict` grows a third route to a failed verdict.
  // Says so rather than guessing: an unexplained failure is a real state and a
  // summary that invented a phase for it would be worse than one that admits it.
  return [`  the verdict is \`${run.verdict}\` and no step or missing phase explains it — read the record.`];
}

/** The last node the firing reached, or the fact that it reached none. */
function whatItTouched(touch: NodeTouch | undefined): string {
  if (!touch) {
    return "  last node touched: none — no traced tool call changed a node file in this run";
  }
  return `  last node touched: ${touch.file} — ${touch.tool} at ${touch.at}`;
}

/**
 * The summary, or nothing at all.
 *
 * Empty for every verdict that is not a failure, which is the assertion that
 * makes the non-empty case worth reading. Callers print these on stderr: this is
 * the line a cron's mail must not bury, and the loop's own convention for such a
 * line is already stderr.
 */
export function failureSummary(run: LoopRunRecord, touch: NodeTouch | undefined): string[] {
  if (!run.verdict || !FAILED_VERDICTS.has(run.verdict)) return [];
  return [
    `✗ FAILED: run ${run.runId} sealed ${run.verdict}.`,
    ...whereItDied(run),
    whatItTouched(touch),
    `  A failed firing proves nothing about the tree — not that it is fine, and not that it is broken.`,
  ];
}
