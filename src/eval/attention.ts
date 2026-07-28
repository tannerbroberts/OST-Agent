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
 * tiers at write time would bake in a cost model; here it is read-time policy,
 * and as of Phase 2 the numbers themselves are an allele — `tokenWeights` in
 * `genome.yaml` — rather than a constant this module owns. `DEFAULT_TOKEN_WEIGHTS`
 * below is a READER of the genome's defaults, not a second copy of them: a vault
 * with no genome.yaml and a vault carrying the shipped default resolve through
 * the same parse and therefore cannot disagree.
 *
 * Cost per unknown is the SUM of two independent sources, read from the trace
 * they each actually land in: the attention ledger (`recordAttention`, keyed
 * per unknown) and the usage trace (`withUsageTracing`, every allowlisted tool
 * call, self-attributed via OST_UNKNOWN). Most calls travel through the usage
 * trace alone — the ledger has no production writer yet — so deriving
 * calls/ms from the trace as well as the ledger is what makes per-unknown cost
 * non-zero in practice. The usage log is read exactly once per rollup and
 * split three ways: attributed (a known unknown), unattributed (no `unknown`
 * field), or neither (an `unknown` field naming a title not on this tree,
 * which is not credited to anything rather than guessed at).
 */
import { defaultGenome } from "../genome/load.js";
import type { AttributionGene, ClassifierGene, ResolutionGene, TokenWeightsGene } from "../genome/schema.js";
import { classifyUnknown, resolutionState, DEFAULT_CLASSIFIER, type ResolutionState, type UnknownClass } from "../knowledge/unknowns.js";
import type { OstNode } from "../ost/node.js";
import { addTiers, emptyTiers, readAttention, type TokenTiers } from "../telemetry/attention.js";
import { usageLogPath } from "../telemetry/usage.js";
import fs from "node:fs";

/**
 * The cost model, structurally identical to the genome's `tokenWeights` gene
 * because it IS that gene. The alias is kept exported so every existing
 * importer compiles unchanged while the numbers move out of TypeScript.
 */
export type TokenWeights = TokenWeightsGene;

/**
 * Relative cost per tier, tracking published pricing ratios: output is the
 * dear one, a cache write costs a little more than fresh input, and a cache
 * read is roughly a tenth. These are ratios, not currency.
 *
 * Read from the genome schema's defaults rather than restated here. There is
 * exactly one literal `5` for the cost of an output token in this repo and it
 * lives in `GenomeSchema`; this const is how the rest of `eval/` reaches it.
 */
export const DEFAULT_TOKEN_WEIGHTS: TokenWeights = defaultGenome().tokenWeights;

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
  /** Keyed by the genome's class vocabulary — every declared class gets a bucket, earned or not. */
  byClass: Record<string, ClassRollup>;
  /** Spend the trace could not attribute to any unknown. */
  unattributed: { calls: number; ms: number };
}

interface CallCost {
  calls: number;
  ms: number;
}

interface UsageRollup {
  /** Per-unknown calls/ms, for titles present in `knownTitles` only. */
  byUnknown: Map<string, CallCost>;
  /** Spend the trace could not attribute to any unknown. */
  unattributed: CallCost;
}

/**
 * One pass over the usage trace, splitting every event three ways: attributed
 * to a known unknown, unattributed (no `unknown` field), or — an event naming
 * an unknown that is not (or no longer) on the tree — neither, since crediting
 * it to a title that does not exist would be a fabrication and folding it into
 * `unattributed` would conflate "said nothing" with "said something stale".
 *
 * Read once and shared by every caller in {@link computeAttention} so the log
 * is never parsed twice for the same rollup.
 */
function rollUpUsage(vaultDir: string, knownTitles: ReadonlySet<string>): UsageRollup {
  const byUnknown = new Map<string, CallCost>();
  const unattributed: CallCost = { calls: 0, ms: 0 };
  const file = usageLogPath(vaultDir);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { byUnknown, unattributed };
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as { unknown?: string; ms?: number };
      const ms = typeof event.ms === "number" && Number.isFinite(event.ms) ? event.ms : 0;
      if (!event.unknown) {
        unattributed.calls++;
        unattributed.ms += ms;
        continue;
      }
      if (!knownTitles.has(event.unknown)) continue; // stale/foreign attribution: not counted either way
      const bucket = byUnknown.get(event.unknown) ?? { calls: 0, ms: 0 };
      bucket.calls++;
      bucket.ms += ms;
      byUnknown.set(event.unknown, bucket);
    } catch {
      // a corrupt trace line is not attributable either way
    }
  }
  return { byUnknown, unattributed };
}

function emptyClassRollup(): ClassRollup {
  return { count: 0, satisfied: 0, abandoned: 0, open: 0, weightedCost: 0 };
}

/**
 * A bucket per class the genome declares, whether or not any node earned it.
 * A class that appears with zero is a measured zero; a class that is simply
 * absent from the record is indistinguishable from a class that was never
 * declared, and fitness has to be able to tell those apart.
 */
function emptyByClass(classes: readonly string[]): Record<string, ClassRollup> {
  return Object.fromEntries(classes.map((c) => [c, emptyClassRollup()]));
}

/**
 * Which alleles this rollup is computed under. An object rather than more
 * positionals: the third argument is already load-bearing at nine call sites,
 * and later genes (the classifier, the resolution machine, correlated token
 * cost) need to arrive here too without any of them becoming a fourth slot
 * whose meaning depends on argument order.
 *
 * Every field is optional and every omission means "the shipped default",
 * which is what makes a vault with no genome.yaml behave exactly as it did.
 */
export interface AttentionOptions {
  /** The cost model. Omitted ⇒ {@link DEFAULT_TOKEN_WEIGHTS}, i.e. the genome's default. */
  weights?: TokenWeightsGene;
  /** The classification thresholds. Declared here; read from Task 4 onward. */
  classifier?: ClassifierGene;
  /** The resolution machine's parameters. Declared here; read from Task 5 onward. */
  resolution?: ResolutionGene;
  /** How spend is attributed to unknowns. Declared here; read from Task 7 onward. */
  attribution?: AttributionGene;
}

/** Per-unknown and per-class attention across the tree in `vaultDir`. */
export function computeAttention(
  tree: readonly OstNode[],
  vaultDir: string,
  opts: AttentionOptions = {},
): AttentionRollup {
  const weights = opts.weights ?? DEFAULT_TOKEN_WEIGHTS;
  const classifier = opts.classifier ?? DEFAULT_CLASSIFIER;
  const darkNodes = tree.filter((n) => n.layer === "Unknown");
  const usage = rollUpUsage(vaultDir, new Set(darkNodes.map((n) => n.title)));

  const unknowns: UnknownAttention[] = darkNodes.map((node) => {
    // Ledger spend (`recordAttention`, e.g. explicit harness bookkeeping) and
    // usage-trace spend (every allowlisted tool call, stamped by
    // `withUsageTracing` via OST_UNKNOWN) are two independent sources of the
    // same cost — additive, never one replacing the other.
    let calls = 0;
    let ms = 0;
    let tokens = emptyTiers();
    for (const entry of readAttention(vaultDir, node.title)) {
      if (entry.kind !== "spend") continue;
      calls += entry.calls ?? 0;
      ms += entry.ms ?? 0;
      if (entry.tokens) tokens = addTiers(tokens, entry.tokens);
    }
    const traced = usage.byUnknown.get(node.title);
    if (traced) {
      calls += traced.calls;
      ms += traced.ms;
    }
    return {
      title: node.title,
      klass: classifyUnknown(node, classifier),
      state: resolutionState(node),
      calls,
      ms,
      tokens,
      weightedCost: weightedTokenCost(tokens, weights),
    };
  });

  const byClass = emptyByClass(classifier.classes);
  for (const u of unknowns) {
    // A class outside the declared vocabulary cannot arrive from a loaded
    // genome — the schema refuses one — but a hand-built gene may carry one,
    // and dropping the spend on the floor would be worse than naming it.
    const bucket = (byClass[u.klass] ??= emptyClassRollup());
    bucket.count++;
    bucket.weightedCost += u.weightedCost;
    if (u.state === "satisfied") bucket.satisfied++;
    else if (u.state === "abandoned") bucket.abandoned++;
    else bucket.open++;
  }

  return { unknowns, byClass, unattributed: usage.unattributed };
}
