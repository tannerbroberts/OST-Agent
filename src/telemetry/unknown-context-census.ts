/**
 * The price of refusing on unknown context: how many recorded steps the rule
 * would have deleted, and whether any of them was a failure somebody acted on.
 *
 * This is the counter beneath "Measure how much signal a refuse-on-unknown-context
 * rule would delete", the assumption test under "Refuse to record a step whose
 * context could not be determined". The solution node is explicit that it wants a
 * count before it wants an implementation, because the candidate throws
 * information away on purpose: *a failure with unknown context is still a signal
 * that something broke, and refusing to record it loses that.*
 *
 * ## The bar, copied from the node rather than restated
 *
 * Fewer than 5 of the last 100 recorded steps would have been refused, **and**
 * none of the refused set turns out to be a failure somebody later acted on.
 * Both clauses are here rather than one, for the node's own reason: if the five
 * refused records happen to be the five that mattered, the rule is bad at 5%, and
 * leaving that clause to a reader is how a rate gets mistaken for a verdict.
 *
 * ## What "acted on" is allowed to mean here
 *
 * Three shapes, each observable and none of them a judgement call:
 *
 * - a **corrected re-run** — a later step, same phase, exit 0, running the same
 *   payload under a different command line. Somebody diagnosed the failure and
 *   re-invoked it;
 * - a **repeat re-run** — the same command line again, and it passed. Weaker, so
 *   it is named separately rather than pooled, and a reader can discount it;
 * - a **citing commit** — a commit in the vault, inside the window after the
 *   step, that added or removed the failed step's payload text somewhere other
 *   than the health record itself. The exclusion is load-bearing: `runs.jsonl` is
 *   committed, so without it the commit that *recorded* the failure would score
 *   as a commit that addressed it.
 *
 * ## What it came back with, and where that leaves this module
 *
 * Zero. Over the ledger `readRuns` opens — 347 runs, 625 steps, 82 failures, on
 * 2026-08-31 — nothing would have been refused, so the rate clause clears at 0%
 * and the second clause has no subject at all. {@link readCensus} calls that
 * `undecidable` rather than `cleared`, and the finding is sharper than "cheap":
 * the refusal is free because it is inert. Nothing here is wired into
 * `appendStep` and nothing should be until a writer exists that can produce a
 * step with an unknown context.
 *
 * ## The half of this that no count reaches
 *
 * A rate over a short ledger is not the rate the node named. This vault has fewer
 * than a hundred recorded steps, and {@link UnknownContextCensus.shortSample}
 * says so at every surface rather than letting the count read as "the last 100".
 * Likewise, an empty refused-failure set satisfies the second clause vacuously —
 * `secondClause` reports `vacuous` rather than `clear`, because a clause that
 * never fired has not been passed.
 */
import { stepFailed } from "../loop/health.js";
import {
  contextGaps,
  refusalFor,
  type ContextGap,
  type ContextReading,
  type RecordedStep,
} from "./step-context.js";

/** The last hundred, as the node's threshold words it. */
export const CENSUS_WINDOW = 100;

/** Fewer than 5 in 100 — held as the share it is, so a short ledger cannot borrow the bigger denominator. */
export const REFUSAL_SHARE_BAR = 0.05;

/** How long after a failing step a follow-up still counts as a follow-up. */
export const FOLLOW_UP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A step with the run it belongs to and its position from the newest end. */
export interface CensusStep extends RecordedStep {
  readonly runId: string;
  readonly ordinal: number;
}

export interface RefusedStep {
  readonly step: CensusStep;
  readonly gaps: readonly ContextGap[];
  /** What the refusal would have printed — the node's "one edit, not one bisection" requirement. */
  readonly refusal: string;
  readonly failed: boolean;
}

export type FollowUpKind = "corrected-rerun" | "repeat-rerun" | "citing-commit";

export interface FollowUp {
  readonly kind: FollowUpKind;
  readonly at: string;
  readonly detail: string;
}

export interface ActedOnRefusal {
  readonly refused: RefusedStep;
  readonly followUps: readonly FollowUp[];
}

export interface UnknownContextCensus {
  readonly reading: ContextReading;
  /** Every step on the ledger. */
  readonly recorded: number;
  /** The window actually counted over — `min(recorded, 100)`. */
  readonly sampled: number;
  /** True when the ledger is shorter than the hundred the threshold names. */
  readonly shortSample: boolean;
  readonly refused: readonly RefusedStep[];
  readonly refusedShare: number;
  readonly byGap: Readonly<Record<ContextGap, number>>;
  /** Failing steps in the sample, and the refused subset of them. */
  readonly failures: number;
  readonly refusedFailures: readonly RefusedStep[];
}

/**
 * Every step across the runs, newest first.
 *
 * `readRuns` already sorts runs newest-first and each run's `steps` oldest-first,
 * so the flatten reverses within a run. Ties on `at` keep ledger order, which is
 * the order a reader of `runs.jsonl` sees.
 */
export function stepsNewestFirst(runs: readonly { runId: string; steps?: readonly RecordedStep[] }[]): CensusStep[] {
  const flat: Omit<CensusStep, "ordinal">[] = [];
  for (const run of runs) for (const step of [...(run.steps ?? [])].reverse()) flat.push({ ...step, runId: run.runId });
  return flat.map((s, ordinal) => ({ ...s, ordinal }));
}

/**
 * Whether this step failed, asked of the repository's one definition.
 *
 * `stepFailed` lives in `src/loop/health.ts` and is typed on the single field it
 * reads, so this file never restates that comparison — `test/runner/suite-result-consumer-census.test.ts`
 * counts the files that compare a step exit to zero, and a second definition is
 * exactly the drift that census exists to catch. A step with no recorded exit has
 * not been shown to have failed, so it is not counted as one.
 */
function failed(step: RecordedStep): boolean {
  return typeof step.exit === "number" && stepFailed({ exit: step.exit });
}

const NO_GAPS: Record<ContextGap, number> = {
  "no-command": 0,
  "no-cwd": 0,
  "cwd-not-absolute": 0,
  "no-argv": 0,
  "empty-argv": 0,
};

/** Replay the refusal over the last {@link CENSUS_WINDOW} steps and count what it would have deleted. */
export function censusUnknownContext(steps: readonly CensusStep[], reading: ContextReading): UnknownContextCensus {
  const sample = steps.slice(0, CENSUS_WINDOW);
  const byGap = { ...NO_GAPS };
  const refused: RefusedStep[] = [];
  for (const step of sample) {
    const gaps = contextGaps(step, reading);
    if (gaps.length === 0) continue;
    for (const g of gaps) byGap[g] += 1;
    refused.push({
      step,
      gaps,
      refusal: refusalFor(step, reading) ?? "",
      failed: failed(step),
    });
  }
  return {
    reading,
    recorded: steps.length,
    sampled: sample.length,
    shortSample: sample.length < CENSUS_WINDOW,
    refused,
    refusedShare: sample.length === 0 ? 0 : refused.length / sample.length,
    byGap,
    failures: sample.filter((s) => failed(s)).length,
    refusedFailures: refused.filter((r) => r.failed),
  };
}

/**
 * The command with its shell wrapper and any directory correction stripped off.
 *
 * This is what makes a corrected re-run detectable at all: the recorded fix for a
 * wrong-directory failure is the same command with `cd …​ &&` in front of it, so
 * comparing command strings finds nothing and comparing payloads finds it exactly.
 * Only the prefixes a shell invocation actually carries are stripped, and each is
 * anchored — a `cd` in the middle of a pipeline is part of the payload.
 */
export function payloadOf(command: string): string {
  let s = command.trim();
  s = s.replace(/^(?:bash|sh|zsh)\s+-[a-z]*c\s+/, "");
  // Repeated because a real invocation stacks them: `bash -c set -o pipefail; cd … && npx …`.
  for (;;) {
    const shorter = s
      .replace(/^set\s+-[a-zA-Z-]+\s+\w+\s*;\s*/, "")
      .replace(/^set\s+-[a-zA-Z]+\s*;\s*/, "")
      .replace(/^cd\s+\S+\s*&&\s*/, "");
    if (shorter === s) return s;
    s = shorter;
  }
}

export interface CitingCommit {
  readonly sha: string;
  readonly at: string;
  readonly subject: string;
}

/**
 * What a repository can show about work that followed a failing step.
 *
 * An interface rather than a git call, so the census stays a pure function over
 * things a caller supplies and the spec can drive it from a fixture. The shipped
 * implementation is {@link ../git/follow-up-sight.js}.
 */
export interface FollowUpSight {
  citingCommits(payload: string, sinceISO: string, untilISO: string): Promise<CitingCommit[]>;
}

/** Payloads shorter than this are too generic to pickaxe — `npm test` would cite half the history. */
export const MIN_PICKAXE_LENGTH = 8;

/**
 * For each refused failure, everything that happened afterwards which counts as
 * somebody acting on it.
 *
 * The second clause of the node's threshold, and the one that makes this a test
 * rather than a rate. A refused failure with no follow-up is a record nobody
 * used; a refused failure with one is signal the rule would have destroyed.
 */
export async function traceActedOn(
  census: UnknownContextCensus,
  allSteps: readonly CensusStep[],
  sight: FollowUpSight | null,
  windowMs: number = FOLLOW_UP_WINDOW_MS,
): Promise<ActedOnRefusal[]> {
  const out: ActedOnRefusal[] = [];
  for (const refused of census.refusedFailures) {
    const at = refused.step.at;
    if (!at || !Number.isFinite(Date.parse(at))) continue;
    const from = Date.parse(at);
    const until = new Date(from + windowMs).toISOString();
    const payload = payloadOf(refused.step.command ?? "");
    const followUps: FollowUp[] = [];

    for (const later of allSteps) {
      if (later === refused.step) continue;
      const lat = later.at;
      if (!lat || !Number.isFinite(Date.parse(lat))) continue;
      const t = Date.parse(lat);
      if (t <= from || t > from + windowMs) continue;
      if (later.phase !== refused.step.phase) continue;
      // A follow-up has to have SUCCEEDED, so `!failed` is not enough: a step
      // with no recorded exit has not been shown to have passed either.
      if (typeof later.exit !== "number" || failed(later)) continue;
      if (payloadOf(later.command ?? "") !== payload || payload === "") continue;
      followUps.push({
        kind: later.command === refused.step.command ? "repeat-rerun" : "corrected-rerun",
        at: lat,
        detail: `\`${later.command}\` (${later.phase}) exited 0`,
      });
    }

    if (sight && payload.length >= MIN_PICKAXE_LENGTH) {
      for (const c of await sight.citingCommits(payload, at, until)) {
        followUps.push({ kind: "citing-commit", at: c.at, detail: `${c.sha.slice(0, 8)} ${c.subject}` });
      }
    }

    if (followUps.length > 0) {
      followUps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      out.push({ refused, followUps });
    }
  }
  return out;
}

export type CensusVerdict = "cleared" | "not-cleared" | "undecidable";
export type ClauseState = "clear" | "breached" | "vacuous";

export interface CensusReading {
  readonly verdict: CensusVerdict;
  readonly rateClause: ClauseState;
  readonly secondClause: ClauseState;
  readonly because: string;
}

/**
 * The node's rule, applied. Nothing here chooses a bar; it reads the two the
 * threshold fixed and reports which of them held.
 *
 * `undecidable` is not a soft pass. A census over zero steps has not shown the
 * rule to be cheap — it has shown that nothing was measured, and the one thing a
 * rate over an empty set must never do is print `0%` and read as cleared.
 * `vacuous` is the same caution one clause down: a refused set with no failures
 * in it satisfies "none of the refused set was acted on" by never firing.
 */
export function readCensus(census: UnknownContextCensus, actedOn: readonly ActedOnRefusal[]): CensusReading {
  if (census.sampled === 0) {
    return {
      verdict: "undecidable",
      rateClause: "vacuous",
      secondClause: "vacuous",
      because: "no steps are recorded, so the refusal was never replayed against anything — a rate over an empty ledger cannot be cleared",
    };
  }
  const rateClause: ClauseState = census.refusedShare < REFUSAL_SHARE_BAR ? "clear" : "breached";
  const secondClause: ClauseState =
    actedOn.length > 0 ? "breached" : census.refusedFailures.length === 0 ? "vacuous" : "clear";
  const pct = (census.refusedShare * 100).toFixed(1);
  const denominator = census.shortSample ? `${census.sampled} recorded (the ledger is shorter than the 100 the threshold names)` : "the last 100";
  const rateSays =
    rateClause === "clear"
      ? `${census.refused.length} of ${denominator} would have been refused — ${pct}%, under the 5% bar`
      : `${census.refused.length} of ${denominator} would have been refused — ${pct}%, over the 5% bar`;
  const secondSays =
    secondClause === "breached"
      ? `${actedOn.length} of the refused set is a failure somebody acted on`
      : secondClause === "vacuous"
        ? "no refused step failed, so the second clause never fired and cannot be counted as passed"
        : "no refused failure has a follow-up";
  const verdict: CensusVerdict = rateClause === "clear" && secondClause === "clear" ? "cleared" : rateClause === "clear" && secondClause === "vacuous" ? "undecidable" : "not-cleared";
  return { verdict, rateClause, secondClause, because: `${rateSays}; ${secondSays}` };
}

/** The count as a person reads it — the deliverable this whole module exists to produce. */
export function formatUnknownContextCensus(
  name: string,
  census: UnknownContextCensus,
  actedOn: readonly ActedOnRefusal[],
): string {
  const reading = readCensus(census, actedOn);
  const lines: string[] = [
    `${name} — refuse-on-unknown-context, priced (reading: ${census.reading})`,
    `  ${census.refused.length}/${census.sampled} steps refused (${(census.refusedShare * 100).toFixed(1)}%), ` +
      `${census.recorded} recorded in all${census.shortSample ? " — SHORT SAMPLE, the threshold names 100" : ""}`,
    `  ${census.refusedFailures.length}/${census.failures} failing steps would have been refused`,
  ];
  const gaps = Object.entries(census.byGap).filter(([, n]) => n > 0);
  if (gaps.length > 0) lines.push(`  why: ${gaps.map(([g, n]) => `${g} ×${n}`).join(", ")}`);
  if (actedOn.length === 0) {
    lines.push(
      census.refusedFailures.length === 0
        ? "  second clause: nothing to judge — no refused step failed"
        : "  second clause: no refused failure has a follow-up",
    );
  } else {
    lines.push(`  second clause BREACHED — ${actedOn.length} refused failure(s) somebody acted on:`);
    for (const a of actedOn) {
      lines.push(`    ${a.refused.step.at} ${a.refused.refusal}`);
      for (const f of a.followUps) lines.push(`      → ${f.kind} ${f.at} — ${f.detail}`);
    }
  }
  lines.push(`  verdict: ${reading.verdict} — ${reading.because}`);
  return lines.join("\n");
}
