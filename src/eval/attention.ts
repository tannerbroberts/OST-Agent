/**
 * The attention rollup — what darkness cost, and what it bought.
 *
 * Deterministic and read-only, like the rest of `eval/`: no model, no writes.
 * It answers one question per unknown and per class — how much attention was
 * spent, and did it terminate — which is the question a session needs to
 * decide where to look next, and the same question a selection harness needs
 * as fitness input. One instrument, two altitudes.
 *
 * The token weighting lives here rather than in the store on purpose. Summing
 * tiers at write time would bake in a cost model; here it is a parameter, and
 * in Phase 2 it becomes an allele of the genome rather than a constant.
 */
import { classifyUnknown, resolutionState, UNKNOWN_CLASSES, type ResolutionState, type UnknownClass } from "../knowledge/unknowns.js";
import type { OstNode } from "../ost/node.js";
import { addTiers, emptyTiers, readAttention, type TokenTiers } from "../telemetry/attention.js";
import { usageLogPath } from "../telemetry/usage.js";
import fs from "node:fs";

export interface TokenWeights {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

/**
 * Relative cost per tier, tracking published pricing ratios: output is the
 * dear one, a cache write costs a little more than fresh input, and a cache
 * read is roughly a tenth. These are ratios, not currency.
 */
export const DEFAULT_TOKEN_WEIGHTS: TokenWeights = {
  input: 1,
  output: 5,
  cacheCreate: 1.25,
  cacheRead: 0.1,
};

export function weightedTokenCost(tokens: TokenTiers, weights: TokenWeights = DEFAULT_TOKEN_WEIGHTS): number {
  return (
    tokens.input * weights.input +
    tokens.output * weights.output +
    tokens.cacheCreate * weights.cacheCreate +
    tokens.cacheRead * weights.cacheRead
  );
}

export interface UnknownAttention {
  title: string;
  /** `class` is reserved; the derived class is carried as `klass`. */
  klass: UnknownClass;
  state: ResolutionState;
  calls: number;
  ms: number;
  tokens: TokenTiers;
  weightedCost: number;
}

export interface ClassRollup {
  count: number;
  satisfied: number;
  abandoned: number;
  open: number;
  weightedCost: number;
}

export interface AttentionRollup {
  unknowns: UnknownAttention[];
  byClass: Record<UnknownClass, ClassRollup>;
  /** Spend the trace could not attribute to any unknown. */
  unattributed: { calls: number; ms: number };
}

/** Tool calls in the usage trace that carry no `unknown` attribution. */
function unattributedSpend(vaultDir: string): { calls: number; ms: number } {
  const file = usageLogPath(vaultDir);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { calls: 0, ms: 0 };
  }
  let calls = 0;
  let ms = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as { unknown?: string; ms?: number };
      if (event.unknown) continue;
      calls++;
      ms += typeof event.ms === "number" && Number.isFinite(event.ms) ? event.ms : 0;
    } catch {
      // a corrupt trace line is not attributable either way
    }
  }
  return { calls, ms };
}

function emptyByClass(): Record<UnknownClass, ClassRollup> {
  return Object.fromEntries(
    UNKNOWN_CLASSES.map((c) => [c, { count: 0, satisfied: 0, abandoned: 0, open: 0, weightedCost: 0 }]),
  ) as Record<UnknownClass, ClassRollup>;
}

/** Per-unknown and per-class attention across the tree in `vaultDir`. */
export function computeAttention(
  tree: readonly OstNode[],
  vaultDir: string,
  weights: TokenWeights = DEFAULT_TOKEN_WEIGHTS,
): AttentionRollup {
  const unknowns: UnknownAttention[] = tree
    .filter((n) => n.layer === "Unknown")
    .map((node) => {
      let calls = 0;
      let ms = 0;
      let tokens = emptyTiers();
      for (const entry of readAttention(vaultDir, node.title)) {
        if (entry.kind !== "spend") continue;
        calls += entry.calls ?? 0;
        ms += entry.ms ?? 0;
        if (entry.tokens) tokens = addTiers(tokens, entry.tokens);
      }
      return {
        title: node.title,
        klass: classifyUnknown(node),
        state: resolutionState(node),
        calls,
        ms,
        tokens,
        weightedCost: weightedTokenCost(tokens, weights),
      };
    });

  const byClass = emptyByClass();
  for (const u of unknowns) {
    const bucket = byClass[u.klass];
    bucket.count++;
    bucket.weightedCost += u.weightedCost;
    if (u.state === "satisfied") bucket.satisfied++;
    else if (u.state === "abandoned") bucket.abandoned++;
    else bucket.open++;
  }

  return { unknowns, byClass, unattributed: unattributedSpend(vaultDir) };
}
