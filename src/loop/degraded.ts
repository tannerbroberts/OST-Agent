/**
 * The degraded verdict — a firing that ran without the means to do its job, and
 * is not allowed to report a clean one.
 *
 * **The failure this exists to stop, observed rather than imagined.** The meta
 * vault fired twenty-two scheduled maintenance passes whose MCP tool surface was
 * never present. Every one of them ran, exited 0, and sealed a verdict that read
 * fine. Nothing they reported was false: `check` really did pass, `status` and
 * `debt` really were consistent, the tree really had not drifted. The missing
 * sentence was "and the mapping, ideation and assumption work this pass exists
 * for did not happen" — so twenty-two firings of true statements added up to a
 * false impression, and the operator had no way to tell a pass that found nothing
 * to do from a pass that could not do anything.
 *
 * `no-op` is the verdict those firings earned under {@link computeVerdict}, and
 * `no-op` is exactly the rounding: it means "nothing to do", which is a fact
 * about the tree. "Could not do it" is a fact about the firing, and the two want
 * different words. That is the whole of this module — a degraded firing gets its
 * own name in the vocabulary, and outranks the two verdicts a reader relaxes at.
 *
 * **Nothing here asks the pass whether it was degraded.** The candidate this
 * implements was written to be enforced by the agent's own honesty about its own
 * limits, and its own assumption test says plainly that this is the one thing
 * that cannot be assumed: an agent that will quietly report clean when it did
 * nothing is not an agent that will correctly classify itself as degraded. So the
 * evidence is the same shape as every other input to a verdict in this directory
 * — things the firing could not assert about itself:
 *
 *   - the vault's own mechanical tool trace, written by the dispatcher at call
 *     time and unwritable by the reasoning that would want to look clean;
 *   - the source surface `buildPassContext` reports it could and could not build;
 *   - whether the config the operator wrote was readable at all;
 *   - the run record's `fallback` stamp, written by `loop fallback` when the
 *     loop itself routed the read-only half through the command line — the
 *     loop's observation of the pass, never the pass's account of itself.
 *
 * A pass that says nothing about itself is classified the same way as one that
 * claims it did everything, which is the property that makes this worth having.
 */
import { buildPassContext } from "../runner/context.js";
import { readUsageEvents } from "../telemetry/preflight.js";
import type { LoopRunRecord } from "./health.js";

/**
 * The degradation modes this codebase can actually produce, one name each.
 *
 * Named rather than counted because the contract is that a degraded firing says
 * *what it could not attempt*; a bare "degraded" would be a second way of saying
 * nothing. Each kind below corresponds to a real branch in this repository, and
 * the two that look like degradation and are not are called out in
 * {@link observeDegradation}.
 */
export type DegradationKind =
  /** The pass phase ran and no tool invocation was traced while it did. */
  | "no-tool-calls"
  /**
   * The MCP surface was absent and the loop routed the read-only half of the
   * pass through the command line (`loop fallback`). Reports were produced;
   * nothing was authored. Derived from the run record's `fallback` stamp, which
   * only the loop writes.
   */
  | "mcp-absent-fallback"
  /** A source the operator's config asked for could not be built this firing. */
  | "unreadable-source"
  /** `ost.config.yaml` was present and unreadable, so the firing ran on defaults. */
  | "config-fallback"
  /** The surface itself could not be inspected — unknown, which is not clean. */
  | "unobservable-surface";

export interface Degradation {
  readonly kind: DegradationKind;
  /** What the firing could not attempt, in the operator's terms. One line. */
  readonly detail: string;
}

/**
 * What a firing had, as observed from outside it.
 *
 * Kept as a plain value with no reader attached so the classification below is a
 * pure fold that a test can drive directly — the observation half is
 * {@link observeDegradation}, and separating them is what lets each degradation
 * mode be injected without standing up the surface that produces it.
 */
export interface SurfaceObservation {
  /** Tool invocations traced inside this firing's own window. */
  readonly toolCalls: number;
  /** Sources the config asked for and this firing could not build, with reasons. */
  readonly unreadableSources: readonly { readonly name: string; readonly reason: string }[];
  /** Present when `ost.config.yaml` existed and could not be read. */
  readonly configProblem?: string;
  /** Present when the surface could not be inspected at all. */
  readonly observationFailure?: string;
}

/** Which phase is the pass — the one whose absence of tool calls means anything. */
const PASS_PHASE = "pass";

/**
 * The surface the MCP-absent fallback dispatches under, and the ONE surface
 * {@link countToolCallsSince} does not count.
 *
 * The fallback runs the same traced tools the MCP server would have, so its
 * calls land in the same trace. Counting them would let the fallback satisfy
 * the no-tool-calls rule on the pass's behalf — a firing whose pass reached
 * nothing would seal `no-op` because the loop's own rescue path made four
 * calls afterwards. That is the exact false clean this module exists to stop,
 * produced by the mechanism meant to soften it. So the fallback's calls are
 * evidence that the pass did NOT reach the tree, and are excluded here by
 * name; the fallback declares itself to the verdict through the run record's
 * `fallback` stamp instead, which only `loop fallback` writes.
 */
export const FALLBACK_SURFACE = "cli-fallback";

/**
 * Classify one firing against what it was observed to have.
 *
 * The `no-tool-calls` rule is the load-bearing one and it deserves its
 * assumption stated out loud: **a pass that does its job cannot make zero tool
 * calls.** Every route into the tree — reading it, mapping evidence, ideating,
 * surfacing an assumption — is a tool invocation, and `.claude/commands/ost-pass.md`
 * opens on `ost_next_work` before it decides anything. So zero traced calls
 * across the whole firing is not a pass that found nothing; it is a pass that
 * never reached the tree. That inference is the reason this can be mechanical at
 * all, and it is the first thing to re-check if the pass ever gains a route to
 * the tree that leaves no trace.
 *
 * **The limit that comes with it, stated rather than left to be discovered.**
 * The trace is written by the dispatcher, so the agent cannot forge a line — but
 * it can produce one by making a single real call and then doing nothing else.
 * So this separates a firing whose surface was ABSENT from one whose surface was
 * PRESENT; it does not separate work done from work shirked. The absent case is
 * the one that happened twenty-two times, and it is the one a mechanism can
 * settle. The other is a question about an agent's diligence, and no count of
 * calls answers it — `computeVerdict`'s committed-delta is what speaks to that.
 *
 * The rule is deliberately not conditioned on the pass step's exit code. A red
 * pass phase already seals `unhealthy` and outranks this; naming the degradation
 * anyway costs nothing and means the record says *why* the phase had nothing to
 * work with.
 */
export function assessDegradation(run: LoopRunRecord, observed: SurfaceObservation): Degradation[] {
  const degradations: Degradation[] = [];

  if (observed.observationFailure !== undefined) {
    degradations.push({
      kind: "unobservable-surface",
      detail:
        `this firing's tool surface could not be inspected (${observed.observationFailure}) — ` +
        `what it was able to attempt is unknown, and unknown is not clean.`,
    });
  }

  if (run.steps.some((s) => s.phase === PASS_PHASE) && observed.toolCalls === 0) {
    degradations.push({
      kind: "no-tool-calls",
      detail:
        `the ${PASS_PHASE} phase ran and not one tool invocation was traced while it did — ` +
        `the mapping, ideation and assumption work this pass exists for did not happen.`,
    });
  }

  if (run.fallback) {
    const ran = run.fallback.verbs.filter((v) => v.ok).map((v) => v.verb);
    const failed = run.fallback.verbs.filter((v) => !v.ok).map((v) => `${v.verb} (${v.error ?? "failed"})`);
    degradations.push({
      kind: "mcp-absent-fallback",
      detail:
        `the MCP surface was absent, so the read-only half of the pass was routed through the command line — ` +
        `ran: ${ran.length > 0 ? ran.join(", ") : "nothing"}` +
        (failed.length > 0 ? `; failed: ${failed.join(", ")}` : "") +
        `. Nothing was authored: the mapping, ideation and assumption work did not happen.`,
    });
  }

  for (const source of observed.unreadableSources) {
    degradations.push({
      kind: "unreadable-source",
      detail: `the declared source \`${source.name}\` could not be read this firing: ${source.reason}`,
    });
  }

  if (observed.configProblem !== undefined) {
    degradations.push({
      kind: "config-fallback",
      detail:
        `this firing ran on default configuration because the vault's own could not be read: ` +
        `${observed.configProblem}`,
    });
  }

  return degradations;
}

/** One line, so a multi-line adapter message cannot forge structure in a report. */
function oneLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").trim();
}

/**
 * Count tool invocations traced since this firing opened.
 *
 * Every surface counts, not just the MCP one. The trace is written by whatever
 * dispatched the call (`withUsageTracing`), and a rule that admitted only
 * `surface: "mcp"` would call a firing degraded the day a second dispatcher
 * appears — a check that fails on capability it did not anticipate is the one
 * this file is replacing.
 *
 * The one exception is {@link FALLBACK_SURFACE}, excluded by name for the
 * reason given there: its calls are made by the loop after the pass has
 * already failed to reach the tree, and counting them would let the rescue
 * path vouch for the pass.
 *
 * The window is open-ended at the top because the overlap lock means only one
 * firing is live at a time: everything traced since `startedAt` belongs to this
 * one. Events with an unparseable timestamp are not counted — a line that cannot
 * be placed in time cannot be evidence that the pass reached the tree.
 */
export function countToolCallsSince(vaultDir: string, startedAt: string): number {
  const from = Date.parse(startedAt);
  if (!Number.isFinite(from)) return 0;
  return readUsageEvents(vaultDir).filter((e) => {
    const at = Date.parse(e.ts);
    return Number.isFinite(at) && at >= from && e.surface !== FALLBACK_SURFACE;
  }).length;
}

/**
 * Observe what this firing had, from the vault rather than from the firing.
 *
 * **Two things that look like degradation and are not, deliberately excluded.** A
 * source the operator turned OFF is not a degradation — it is the configuration
 * working, and `buildPassContext` already keeps "off by choice" and "asked for
 * and broken" as different facts precisely so a reader like this one can tell
 * them apart. And an absent web search provider is not one either: `ost_search_web`
 * answers at call time by delegating to the host's own search, which is the normal
 * path in Claude Code rather than a lost capability.
 *
 * The context is rebuilt here rather than captured at `loop start`, and the limit
 * that entails is worth stating: this reads the surface as it stands at seal time,
 * not as it stood during the pass. In an unattended firing the two are the same
 * process tree with the same environment, so the approximation is tight — but a
 * credential that expired mid-firing would be seen here and not there. It is the
 * conservative direction: it can only add a degradation, never hide one.
 */
export function observeSurface(vaultDir: string, run: LoopRunRecord): SurfaceObservation {
  const toolCalls = countToolCallsSince(vaultDir, run.startedAt);
  try {
    const ctx = buildPassContext(vaultDir, { tolerateInvalidConfig: true });
    return {
      toolCalls,
      unreadableSources: ctx.unavailableSources
        .filter((s) => s.kind === "unavailable")
        .map((s) => ({ name: s.name, reason: s.reason })),
      ...(ctx.configProblem ? { configProblem: oneLine(ctx.configProblem) } : {}),
    };
  } catch (e) {
    // Never throws out of a seal. A firing whose surface cannot be inspected still
    // has to land a record — and it lands one that says so, which is the whole
    // contract: silence about what could not be checked is what this replaces.
    return { toolCalls, unreadableSources: [], observationFailure: oneLine(e) };
  }
}

/** Observe the surface and classify in one call — what `loop seal` uses. */
export function observeDegradation(vaultDir: string, run: LoopRunRecord): Degradation[] {
  return assessDegradation(run, observeSurface(vaultDir, run));
}

/**
 * The lines a degraded firing prints instead of a clean report.
 *
 * The vocabulary is the point of the whole candidate: a degraded pass "may report
 * only what it actually verified, must name what it could not attempt, and is
 * barred from emitting the words that mean the tree is fine." So the header says
 * what happened, every mode gets its own line, and the closing line says outright
 * that this firing is not evidence the tree is fine — because the reader who
 * needs it most is a cron mail skimmed in four seconds.
 */
export function degradedReport(degradations: readonly Degradation[]): string[] {
  if (degradations.length === 0) return [];
  return [
    `⚠ degraded: this firing did not have what it needed to do its job.`,
    ...degradations.map((d) => `  - ${d.kind}: ${d.detail}`),
    `  A degraded firing reports only what it verified. It is not evidence that the tree is fine.`,
  ];
}
