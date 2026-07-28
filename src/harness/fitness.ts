/**
 * What a run was worth — two normalised terms, combined 1:1.
 *
 * ORIENTATION is derived from exploration spend and inverted: cheaper is
 * better. It is squashed into [0, 1] so a 3-unknown vault and a 10-unknown one
 * produce comparable numbers, which is what makes replication across
 * environments mean anything.
 *
 * QUALITY is agreement with the environment's answer key, and the key lives
 * OUTSIDE the vault. It is deliberately NOT `resolutionState`: that function
 * calls itself "a floor, not a verdict", and a `## Answer` heading is one
 * allowlisted `ost_append_to_node` away — scoring on it would let a run mark its
 * own homework. Claiming to have resolved an unfindable unknown therefore earns
 * exactly nothing.
 *
 * THE WEIGHTS ARE PINNED AND ARE NOT A GENE. The design lists fitness weighting
 * as unspecified and as a candidate gene; breeding it in v1 is unidentifiable,
 * because the weight and the genes it weights are confounded in a single
 * scalar. They ship as a constant, are stamped into every record so a later
 * reader knows what a number was scored under, and are revisited in Phase 4.
 *
 * THE REFUSAL. `assertComparable` throws on a mixed-basis set rather than
 * normalising, per the design's error handling. The authority is
 * `rollup.costBasis` and never `genome.tokenSplit.costBasis`: `resolveCostBasis`
 * downgrades unconditionally when nothing correlated, so the genome's field is a
 * DECLARATION and the rollup's is a MEASUREMENT. Reading the declaration would
 * be how a fitness record starts lying about itself.
 */
import type { AttentionRollup } from "../eval/attention.js";
import type { RunRecord } from "./run.js";
import { answerKey, findableCount, type EnvironmentSpec } from "./spec.js";

/**
 * The bootstrap weighting between orientation speed and observation quality.
 * NOT a gene — see the module docstring. Chosen by hand because the design says
 * bootstrapping it requires a starting value chosen by hand.
 */
export const FITNESS_WEIGHTS = { orientation: 0.5, quality: 0.5 } as const;

export interface FitnessRecord {
  environment: string;
  kind: EnvironmentSpec["kind"];
  seed: number;
  status: RunRecord["status"];
  /** The combined scalar, in [0, 1]. */
  fitness: number;
  orientation: number;
  quality: number;
  /** Total attention spent across all unknowns, on the basis the rollup measured. */
  explorationSpend: number;
  /** The MEASURED basis, from the rollup. Never the genome's declaration. */
  costBasis: AttentionRollup["costBasis"];
  weights: { orientation: number; quality: number };
  resolvedCorrectly: number;
  findable: number;
  /** A variant that cannot say what it spent attention on is measurably worse. */
  unattributedShare: number;
}

/**
 * Total attention spent across every unknown — the design's "exploration
 * spend", and the quantity the null-environment guard is stated over.
 *
 * The basis switch is load-bearing, not defensive. `weightedCost` is purely
 * token-derived, and a model-free run correlates no tokens, so under
 * `calls-and-ms` it is 0 for EVERY unknown. Summing it would report that a
 * thrifty variant and a spendthrift one spent exactly the same — which would
 * make the null-environment guard pass while comparing nothing at all. Under
 * `calls-and-ms` the spend is therefore tool calls plus wall-clock, with ms
 * carried in seconds so the two terms are commensurable and calls dominate.
 */
export function explorationSpend(rollup: AttentionRollup): number {
  if (rollup.costBasis === "tokens") {
    return rollup.unknowns.reduce((sum, u) => sum + u.weightedCost, 0);
  }
  return rollup.unknowns.reduce((sum, u) => sum + u.calls + u.ms / 1000, 0);
}

/**
 * Map total spend into [0, 1], cheaper being higher, with no tuning constant
 * that could itself be bred. `1 / (1 + spend)` is monotone decreasing, hits 1
 * at zero spend and approaches 0 without reaching it — so "spent nothing" is
 * distinguishable from "spent little", which is exactly the distinction a null
 * environment needs.
 */
function orientationScore(spend: number): number {
  return 1 / (1 + Math.max(0, spend));
}

export function computeFitness(args: {
  run: RunRecord;
  rollup: AttentionRollup;
  spec: EnvironmentSpec;
}): FitnessRecord {
  const { run, rollup, spec } = args;
  const key = answerKey(spec);
  const findable = findableCount(spec);

  // Agreement, not resolution. An answer that does not match the key scores
  // nothing, and an unfindable unknown is not in the key at all — so a run that
  // invents an answer for one earns nothing by it.
  const resolvedCorrectly = run.outcomes.filter(
    (o) => o.resolved && key.has(o.title) && key.get(o.title) === o.answer,
  ).length;

  // A null environment has findable === 0. Quality is 0 rather than 1 or NaN:
  // there was nothing to observe, so no observation quality was demonstrated.
  const quality = findable === 0 ? 0 : resolvedCorrectly / findable;
  const spend = explorationSpend(rollup);
  const orientation = orientationScore(spend);

  const attributed = rollup.unknowns.reduce((sum, u) => sum + u.calls, 0);
  const unattributed = rollup.unattributed.calls;
  const total = attributed + unattributed;
  const unattributedShare = total === 0 ? 0 : unattributed / total;

  // A crashed run says nothing about the genome loaded into it, so it carries
  // no score rather than a zero that would drag a variant's mean down as though
  // the genome had been measured and found wanting.
  const fitness =
    run.status === "crashed"
      ? 0
      : FITNESS_WEIGHTS.orientation * orientation + FITNESS_WEIGHTS.quality * quality;

  return {
    environment: run.environment,
    kind: run.kind,
    seed: run.seed,
    status: run.status,
    fitness,
    orientation,
    quality,
    explorationSpend: spend,
    costBasis: rollup.costBasis,
    weights: { ...FITNESS_WEIGHTS },
    resolvedCorrectly,
    findable,
    unattributedShare,
  };
}

/**
 * Refuse a comparison that mixes cost bases, rather than silently normalising
 * one into the other. Tokens and calls-and-ms are not the same quantity in
 * different units; they are different measurements, and averaging them would
 * produce a number with no referent.
 */
export function assertComparable(records: readonly FitnessRecord[]): void {
  const bases = new Set(records.map((r) => r.costBasis));
  if (bases.size > 1) {
    throw new Error(
      `refusing to compare fitness across cost bases: ${[...bases].sort().join(", ")} — these are different measurements, not different units`,
    );
  }
}
