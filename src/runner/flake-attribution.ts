/**
 * A failing run, run a second time, and the disagreement reported rather than
 * the first result.
 *
 * A wall-clock assertion on a shared box fails for two reasons that produce the
 * identical red: the code got slower, or the machine was busy. This repository
 * has paid for that ambiguity twice in one week — `test/mcp/wall-clock-budget.test.ts`
 * failed at 2004ms and again at 2280ms against a 2000ms budget on 2026-08-01,
 * passed alone seconds later both times, and was filed to the friction inbox
 * twice as "flaky". A human did the disambiguating run by hand, and got the
 * right answer by hand, twice. This module is that hand-check written down.
 *
 * **What it does not try to do is remove the flake.** The measurement will still
 * flake; the point is that the flake becomes self-labelling, so the verdict
 * carries its attribution instead of leaving the next reader to re-derive it
 * from two numbers and a memory.
 *
 * ## The re-run alone is not a fair judge, and the third input is why
 *
 * "Passed in isolation" does not mean "was a flake". An operation that is slow
 * *because* of a genuine regression under concurrency — lock contention, a
 * shared resource, a cache that thrashes only when something else is touching
 * it — passes in isolation for exactly the reason it failed in the suite. A
 * mechanism that reads the isolated pass as an acquittal files that case as
 * noise, silently, and the failure it introduces is quiet while the failure it
 * removes is loud. That is a strictly worse position than doing nothing, and a
 * two-arm version of {@link attributeRerun} would pass any test that only
 * checked a flake and a load-independent regression.
 *
 * So the disagreement is not resolved by the re-run. It is resolved by a
 * **control reading taken on the same box in each phase** — a number that rises
 * when the machine is busy and is otherwise stable. A busy machine moves the
 * control and the subject together; a regression in the code moves only the
 * subject. If the control was flat across both phases and the subject was slow
 * in only one of them, the box was not the difference and the conviction stands.
 *
 * That discriminator is not invented here. `../eval/perf-noise-band.ts` replays
 * a corpus of ten cause-labelled gate failures through three rules: the pair
 * (measurement beside the recorded figure) scores 5/10 and degenerately calls
 * everything a regression, the pair-plus-spread scores 5/10, and the rule that
 * reads a same-run control scores 10/10. `test/telemetry/same-run-baseline-ratio.test.ts`
 * reaches the same place from the other direction.
 *
 * ## Where the control comes from, and the arm for when it does not come at all
 *
 * A caller that can schedule around its subject supplies the control itself:
 * the elapsed cost of a fixed workload, timed by {@link probeElapsed} and run
 * **interleaved** with the subject rather than in a block before or after it.
 * That is the in-process case, and it is the only one that can reach the
 * `idle-control` conviction.
 *
 * A caller that waits on a child process cannot interleave with it, and this
 * module deliberately offers it nothing to fill the gap with. A load-average
 * probe for that case was written here and then removed: the child is itself
 * the dominant load on the box while it runs, the two phases rarely last the
 * same time, and a 1-minute average over each therefore differs for reasons
 * that have nothing to do with ambient contention. A control that is mostly a
 * reading of the subject is not a control, and shipping one would manufacture
 * exactly the confident wrong verdicts the `undetermined` arm exists to
 * prevent. {@link ../ost/instrument.ts} is that caller, and it gets the
 * agreement half of the mechanism and no more.
 *
 * When no control pair is available the verdict is
 * {@link FlakeAttribution `undetermined`}, and that arm is load-bearing rather
 * than a default. Answering "contention" with no control reading is the false
 * acquittal above, dressed as a finding; answering "regression" would throw
 * away the one thing the re-run did establish. `undetermined` keeps the
 * attribution information — failed once, passed once — and drops the verdict
 * nothing earned.
 *
 * ## On {@link CONTENTION_RATIO}
 *
 * Fixed at 1.5 before any of this module's scenarios were written, and taken
 * from `../eval/perf-noise-band.ts`'s `SPREAD_RULE.unstableRatio`, which took it
 * from the Z3 criterion's own recorded idle range (620–750ms, 1.21× wide) plus
 * margin. It is not read off the plants in `test/runner/flake-attribution.test.ts`
 * — those separate by 3× to 20×, so they exercise the rule's *direction* and
 * say nothing about where its boundary should sit. Treat the boundary as
 * inherited, not as validated here.
 */

/** The two things a timed failure can be, plus the honest refusal to say. */
export type FlakeAttribution =
  /**
   * The subject was slow for a reason the box does not explain — either it was
   * slow alone too, or it was slow only in the suite while the box stayed idle.
   */
  | {
      kind: "regression";
      /**
       * Convicted because the re-run failed too. The two routes are kept apart
       * because they mean different things to a reader: this one needs no
       * control reading and leaves the original red's meaning fully intact.
       */
      via: "agreement";
      firstMs: number;
      rerunMs: number;
      /** The bar in ms, when the bar was a duration rather than an exit code. */
      budgetMs?: number;
      control?: undefined;
    }
  | {
      kind: "regression";
      /**
       * Convicted although the re-run passed, because the control shows the box
       * was no busier when it failed. The case a re-run-only mechanism acquits.
       */
      via: "idle-control";
      firstMs: number;
      rerunMs: number;
      budgetMs?: number;
      control: ControlPair;
    }
  /** The subject passed alone, and the control shows the box really was busier during the suite. */
  | {
      kind: "contention";
      firstMs: number;
      rerunMs: number;
      budgetMs?: number;
      control: ControlPair;
    }
  /**
   * The subject passed alone and no control reading exists, so which kind of
   * failure this was is not established. Deliberately not an acquittal.
   */
  | {
      kind: "undetermined";
      firstMs: number;
      rerunMs: number;
      budgetMs?: number;
      reason: string;
    };

/** A control reading from each phase, in whatever unit the probe produced. */
export interface ControlPair {
  /** The control during the run that failed. */
  atFailure: number;
  /** The control during the second run. */
  atRerun: number;
  /** `atFailure / atRerun` — how much busier the box was when the subject failed. */
  ratio: number;
}

/**
 * One run of the subject, and how it came out.
 *
 * `failed` is the verdict and `elapsedMs` is only ever reported, never used to
 * decide. That split is what lets one rule serve both shapes of subject this
 * repository has: a timing assertion, where failing means the elapsed time
 * breached a budget, and an instrument command, where failing means a non-zero
 * exit and the elapsed time is just how long the child took. Deciding off
 * `elapsedMs` directly would quietly restrict the mechanism to the first.
 */
export interface Phase {
  /** Did the subject fail its bar in this run? */
  failed: boolean;
  /** Wall clock for this run, in ms. Reported in the verdict; never decides it. */
  elapsedMs: number;
  /** The bar, in ms, when the bar was a duration. Absent when it was an exit code. */
  budgetMs?: number;
  /**
   * A number that rises when the box is busy and is otherwise stable — elapsed
   * ms of a fixed workload, or a load average. Omitted when nothing sampled one.
   * Both phases must carry it, in the same unit, or there is no pair to compare.
   */
  control?: number;
}

/** A {@link Phase} for a timing assertion, where breaching the budget is the failure. */
export function timedPhase(measuredMs: number, budgetMs: number, control?: number): Phase {
  return { failed: measuredMs > budgetMs, elapsedMs: measuredMs, budgetMs, control };
}

/**
 * How much busier the box has to read during the failing phase before the box
 * is what explains the failure. See the note in the file header — inherited
 * from `../eval/perf-noise-band.ts`, not derived from this module's tests.
 */
export const CONTENTION_RATIO = 1.5;

/**
 * Attribute a timed failure, given the run that failed and one re-run alone.
 *
 * `inSuite` is the phase whose assertion failed. `inIsolation` is the same
 * subject run again with nothing else scheduled against it. The answer is one
 * of three, and which one depends on both the re-run and the control:
 *
 *   1. The re-run failed too → `regression` via `agreement`. The red stands
 *      with its original meaning fully intact; the second run cost one extra
 *      measurement and bought certainty.
 *   2. The re-run passed and the control was flat → `regression` via
 *      `idle-control`. The box was no busier when the subject failed, so the
 *      concurrency is the cause rather than the excuse. **This is the case a
 *      re-run-only mechanism gets wrong**, and gets wrong silently.
 *   3. The re-run passed and the control rose by more than
 *      {@link CONTENTION_RATIO} → `contention`.
 *
 * With no usable control pair, case 2 and case 3 are indistinguishable and the
 * answer is `undetermined` rather than a guess in either direction.
 */
export function attributeRerun(first: Phase, rerun: Phase): FlakeAttribution {
  const shared = {
    firstMs: first.elapsedMs,
    rerunMs: rerun.elapsedMs,
    budgetMs: first.budgetMs,
  };

  // The two runs agree. Nothing about the box is in question, so nothing about
  // the box needs reading — this arm is deliberately reachable without a control.
  if (rerun.failed) {
    return { kind: "regression", via: "agreement", ...shared };
  }

  const control = controlPair(first.control, rerun.control);
  if (control === undefined) {
    return {
      ...shared,
      kind: "undetermined",
      reason:
        "no control reading was taken in both phases, so a busy box and a slowdown that only appears " +
        "under concurrency are indistinguishable from these two runs alone",
    };
  }

  if (control.ratio > CONTENTION_RATIO) {
    return { kind: "contention", ...shared, control };
  }
  return { kind: "regression", via: "idle-control", ...shared, control };
}

/**
 * The control pair, or `undefined` when there is not one to build.
 *
 * A reading of zero on either side is refused rather than divided by or into: a
 * fixed workload that took no measurable time measured nothing, and a ratio
 * built out of it would be an infinity or a zero — a verdict at full confidence
 * resting on a missing number. Both sides must have really been sampled, or
 * there is no pair.
 */
function controlPair(atFailure: number | undefined, atRerun: number | undefined): ControlPair | undefined {
  if (atFailure === undefined || atRerun === undefined) return undefined;
  if (!(atFailure > 0) || !(atRerun > 0)) return undefined;
  return { atFailure, atRerun, ratio: atFailure / atRerun };
}

/**
 * The verdict in one line, in the shape the solution node asked for — the
 * numbers and the attribution together, so the reader is not left to re-derive
 * from a bare red what a human otherwise re-derives by hand.
 */
export function describeFlakeAttribution(a: FlakeAttribution): string {
  const against = a.budgetMs === undefined ? "" : ` against a ${ms(a.budgetMs)} budget`;
  const failed = `failed at ${ms(a.firstMs)}${against}`;
  switch (a.kind) {
    case "regression":
      return a.via === "agreement"
        ? `${failed}, failed again at ${ms(a.rerunMs)} — regression, not contention; ` +
            `the re-run agrees and the red stands.`
        : `${failed}, passed at ${ms(a.rerunMs)} on a second run — but the box was no busier ` +
            `when it failed (${ratio(a.control)}), so the machine is not what changed. ` +
            `A regression that only shows under concurrency, not contention.`;
    case "contention":
      return `${failed}, passed at ${ms(a.rerunMs)} on a second run, and the box read ` +
        `${ratio(a.control)} busier during the failure — contention, not regression.`;
    case "undetermined":
      return `${failed}, passed at ${ms(a.rerunMs)} on a second run; cause not determined — ${a.reason}.`;
  }
}

function ratio(c: ControlPair): string {
  return `${c.ratio.toFixed(2)}x`;
}

function ms(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")}ms`;
}

/**
 * Time a fixed workload — the in-process control.
 *
 * The workload must be the same one in both phases and must not touch whatever
 * the subject is suspected of. Run it interleaved with the subject rather than
 * in a separate block: contention rises and falls on a slower clock than a
 * single call, so a control measured seconds away from the subject can be a
 * real minimum from a moment that never co-occurred with it — the mistake
 * `test/telemetry/same-run-baseline-ratio.test.ts` records making, which
 * produced an 86x reading out of nothing but that mismatch.
 *
 * Async, and the workload it is handed should yield, because the contention
 * this is meant to read is contention for the event loop. A control that runs
 * to completion without yielding is scheduled once and then holds the thread —
 * it would cost the same beside three busy peers as beside none, and report an
 * idle box in the middle of the exact conditions it exists to detect.
 */
export async function probeElapsed(work: () => Promise<void> | void): Promise<number> {
  const start = Date.now();
  await work();
  return Date.now() - start;
}
