/**
 * One genome against one environment, deterministically and without a model.
 *
 * The model-free choice is not a simplification, it is the measurement. Every
 * gene in the genome is deterministic policy over vault data; none needs a
 * model to observe its effect. Put a model in the loop and its stochasticity
 * becomes the dominant variance term, swamping every gene effect at any n we
 * can afford — the "confident garbage" the design warns about. So a run is a
 * scripted action sequence over the real kernel, and what varies between runs
 * is the genome and the environment, nothing else.
 *
 * What the run simulates: a session picking up the darkness the kernel surfaced
 * and spending its lookup budget on it. `computeNextWork` decides what is
 * surfaced and in what order (the `pivot` gene); `createLookupBudget` decides
 * how much looking is allowed (the `budgets` gene); the spec — never a model —
 * decides whether the answer was there to find. Every gene that governs any of
 * that is exercised by production code.
 *
 * Failure classification follows the health-record precedent the design cites:
 * a run that did not reach a terminal record is `crashed`, NOT a run that
 * scored zero. Collapsing the two would let a broken harness read as a bad
 * genome, which is the one confusion that would quietly poison selection.
 */
import { writeGenome } from "../genome/write.js";
import type { Genome } from "../genome/schema.js";
import { computeNextWork } from "../mcp/next-work.js";
import { buildPassContext } from "../runner/context.js";
import { recordAttention, type AttentionEntry } from "../telemetry/attention.js";
import { createLookupBudget } from "../web/budget.js";
import { generateEnvironment } from "./generate.js";
import { answerKey, type EnvironmentSpec } from "./spec.js";

/** What became of one planted unknown. */
export interface UnknownOutcome {
  title: string;
  klass: string;
  resolved: boolean;
  /** What the run recorded as the answer. Empty when it resolved nothing. */
  answer: string;
  calls: number;
  ms: number;
}

/** The mechanical record of one run. Fitness is computed from this plus the key. */
export interface RunRecord {
  environment: string;
  kind: EnvironmentSpec["kind"];
  seed: number;
  status: "completed" | "crashed";
  error?: string;
  outcomes: UnknownOutcome[];
  /** The titles the kernel actually surfaced, in the genome's ranked order. */
  surfaced: string[];
  done: boolean;
  budgetLimit: number;
  budgetRemaining: number;
}

/** Fixed per-lookup cost. Constant across variants, so cost differences come from POLICY, not noise. */
const CALLS_PER_LOOKUP = 1;
const MS_PER_LOOKUP = 40;

export function runEnvironment(args: {
  spec: EnvironmentSpec;
  genome: Genome;
  dir: string;
  /** ISO timestamp stamped on every ledger entry. Passed in, never read from the clock. */
  startedAt: string;
}): RunRecord {
  const { spec, genome, dir, startedAt } = args;
  const base = {
    environment: spec.name,
    kind: spec.kind,
    seed: spec.seed,
  };

  try {
    generateEnvironment(spec, dir);
    // The genome must be on disk BEFORE the context is built: it is read exactly
    // once, at `buildPassContext`, and never re-read. Writing it afterwards
    // would measure the default genome while claiming to measure the variant.
    writeGenome(dir, genome);

    // `skipSources: true` so the ambient environment cannot decide whether a run
    // starts — otherwise a missing ATLASSIAN_* or SLACK_BOT_TOKEN throws out of
    // context construction and a fitness record depends on the operator's shell.
    const ctx = buildPassContext(dir, { skipSources: true });
    const work = computeNextWork(ctx.vault, dir, 3, ctx.genome);
    const budget = createLookupBudget(ctx.genome.budgets, ctx.config.web.lookupBudget);
    const key = answerKey(spec);

    const outcomes: UnknownOutcome[] = [];
    for (const open of work.openUnknowns) {
      // The same spend site the tool surface uses, with the same class argument,
      // so `budgets.perClass` is exercised rather than approximated.
      const allowed = budget.take(open.klass);
      const calls = allowed ? CALLS_PER_LOOKUP : 0;
      const ms = allowed ? MS_PER_LOOKUP : 0;

      // An entry is written whether or not the lookup was allowed, so a visit
      // that bought nothing is still visible — abandonment that hid its own
      // cost would defeat the ledger's purpose. But a REFUSED lookup costs
      // zero, and it must: if every visit recorded a call regardless, two
      // variants with wildly different budgets would record identical spend,
      // and the null-environment guard would pass vacuously while appearing to
      // compare thrift against extravagance.
      const spend: AttentionEntry = {
        ts: startedAt,
        unknown: open.title,
        kind: "spend",
        calls,
        ms,
      };
      recordAttention(dir, spend);

      const answer = allowed ? (key.get(open.title) ?? "") : "";
      const resolved = answer.length > 0;
      if (resolved) {
        ctx.vault.appendUnderSection(open.title, "Answer", answer);
        recordAttention(dir, {
          ts: startedAt,
          unknown: open.title,
          kind: "resolution",
          state: "satisfied",
        });
      }

      outcomes.push({ title: open.title, klass: open.klass, resolved, answer, calls, ms });
    }

    return {
      ...base,
      status: "completed",
      outcomes,
      surfaced: work.openUnknowns.map((u) => u.title),
      done: work.done,
      budgetLimit: budget.limit,
      budgetRemaining: budget.remaining(),
    };
  } catch (err) {
    // Crashed, not failed. A run with no terminal record says nothing about the
    // genome that was loaded into it.
    return {
      ...base,
      status: "crashed",
      error: err instanceof Error ? err.message : String(err),
      outcomes: [],
      surfaced: [],
      done: false,
      budgetLimit: 0,
      budgetRemaining: 0,
    };
  }
}
