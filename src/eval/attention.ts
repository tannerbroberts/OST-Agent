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
 * field), or neither — an `unknown` field naming a title not on this tree, whose
 * fate is the `attribution.staleAttribution` allele: dropped (the default, and
 * what this always did) or folded into unattributed.
 *
 * Phase 2 adds a token dimension the tool tracer cannot see. Transcript
 * correlation (`eval/correlate.ts`) arrives as a third additive source beside
 * the ledger and the trace, and with it a FOURTH bucket the call-based split
 * has no room for: transcript spend inside no tool window at all — the
 * thinking, the reading, the assistant turn that emits the call. That is not
 * the same ignorance as "a call with no OST_UNKNOWN", and folding the two
 * together would inflate the unattributed share with spend no call ever
 * bracketed, so they are reported apart. Every rollup carries the basis its
 * numbers actually rest on, because a comparison across bases must be refused
 * rather than silently normalized, and a refusal needs something to read.
 *
 * The basis is a property of what this rollup ACTUALLY RECEIVED, not of what
 * the genome wished for. No `correlated` map reaches `computeAttention` =>
 * `costBasis` is `"calls-and-ms"`, whatever `tokenSplit.costBasis` declares.
 * Under the default genome `tokenSplit.enabled` is false, the correlator never
 * runs, and nothing passes `correlated` — so every production rollup reports
 * `calls-and-ms` until an explicit non-default genome turns the split on.
 */
import { defaultGenome } from "../genome/load.js";
import type { AttributionGene, ClassifierGene, ResolutionGene, TokenWeightsGene } from "../genome/schema.js";
import { classifyUnknown, resolutionState, DEFAULT_CLASSIFIER, DEFAULT_RESOLUTION, type ResolutionState, type UnknownClass } from "../knowledge/unknowns.js";
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
  unattributed: { calls: number; ms: number; tokens: TokenTiers };
  /**
   * Transcript spend inside no tool window at all — the fourth bucket. Neither
   * attributable nor the same as an unmarked call, so it is neither credited
   * nor folded into `unattributed`.
   */
  uncorrelated: TokenTiers;
  /** What these numbers rest on. A comparison across bases is refused, not normalized. */
  costBasis: "tokens" | "calls-and-ms";
}

/**
 * What one bucket of the trace cost. `tokens` is always `{0,0,0,0}` as read
 * from the usage log — the tool tracer never saw a token — and is filled only
 * where the correlator has something to say. One shape for both sources is
 * what lets correlated tokens merge INTO these buckets rather than shadow them.
 */
interface CallCost {
  calls: number;
  ms: number;
  tokens: TokenTiers;
}

function emptyCallCost(): CallCost {
  return { calls: 0, ms: 0, tokens: emptyTiers() };
}

interface UsageRollup {
  /** Per-unknown calls/ms/tokens, for titles present in `knownTitles` only. */
  byUnknown: Map<string, CallCost>;
  /** Spend the trace could not attribute to any unknown. */
  unattributed: CallCost;
}

/**
 * One line of the usage trace, parsed whole.
 *
 * `ts` is the START of the call (`withUsageTracing` stamps `new Date(started)`
 * and appends on finish, so the file is ordered by finish time — a reader must
 * sort, never assume file order), and `session`/`tool` are the other fields a
 * split policy joins on. The rollup itself needs only `unknown` and `ms`; the
 * shape is declared complete and exported so the correlator reads the same
 * record rather than keeping a second, drifting private copy of it.
 */
export interface TracedCall {
  ts?: string;
  tool?: string;
  session?: string;
  unknown?: string;
  ms?: number;
}

/**
 * One pass over the usage trace, splitting every event three ways: attributed
 * to a known unknown, unattributed (no `unknown` field), or — an event naming
 * an unknown that is not (or no longer) on the tree — whatever
 * `staleAttribution` says, which by default is neither.
 *
 * Read once and shared by every caller in {@link computeAttention} so the log
 * is never parsed twice for the same rollup.
 */
function rollUpUsage(
  vaultDir: string,
  knownTitles: ReadonlySet<string>,
  staleAttribution: AttributionGene["staleAttribution"] = "drop",
): UsageRollup {
  const byUnknown = new Map<string, CallCost>();
  const unattributed = emptyCallCost();
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
      const event = JSON.parse(trimmed) as TracedCall;
      const ms = typeof event.ms === "number" && Number.isFinite(event.ms) ? event.ms : 0;
      if (!event.unknown) {
        unattributed.calls++;
        unattributed.ms += ms;
        continue;
      }
      if (!knownTitles.has(event.unknown)) {
        // A marker naming a title not on this tree. `drop` (the default, and
        // exactly today) counts it neither way: crediting a title that does not
        // exist would be a fabrication, and folding it into `unattributed` would
        // conflate "said nothing" with "said something stale". `unattributed` is
        // the other honest reading — a renamed or deleted unknown still cost
        // what it cost, and losing that spend flatters the unattributed share.
        if (staleAttribution === "unattributed") {
          unattributed.calls++;
          unattributed.ms += ms;
        }
        continue;
      }
      const bucket = byUnknown.get(event.unknown) ?? emptyCallCost();
      bucket.calls++;
      bucket.ms += ms;
      byUnknown.set(event.unknown, bucket);
    } catch {
      // a corrupt trace line is not attributable either way
    }
  }
  return { byUnknown, unattributed };
}

/**
 * Fold the correlator's per-unknown tokens into the same buckets the trace
 * filled, so a downstream reader sees one cost per unknown rather than two
 * half-costs it has to add itself.
 *
 * A correlated title the tree does not carry gets exactly the treatment its
 * traced calls get: dropped by default, because crediting a title that does
 * not exist is a fabrication, or folded into `unattributed` when the
 * attribution gene says so. The two must agree — an allele that moved a
 * ghost's calls but not its tokens would make the unattributed share depend on
 * which dimension you asked in.
 */
function mergeCorrelated(
  usage: UsageRollup,
  knownTitles: ReadonlySet<string>,
  correlated: Map<string, TokenTiers> | undefined,
  stale: AttributionGene["staleAttribution"],
): void {
  if (!correlated) return;
  for (const [title, tokens] of correlated) {
    if (!knownTitles.has(title)) {
      if (stale === "unattributed") usage.unattributed.tokens = addTiers(usage.unattributed.tokens, tokens);
      continue;
    }
    const bucket = usage.byUnknown.get(title) ?? emptyCallCost();
    bucket.tokens = addTiers(bucket.tokens, tokens);
    usage.byUnknown.set(title, bucket);
  }
}

/**
 * What this rollup's numbers actually rest on — a property of what it
 * RECEIVED, never of what the genome declared.
 *
 * The genome may declare `tokens`, but a declaration is not data: with no
 * correlated map supplied every token is zero, and a fitness comparison on
 * that basis would read the silence as "this variant spent nothing". So the
 * rule is unconditional: `opts.correlated === undefined` => `"calls-and-ms"`,
 * regardless of `tokenSplit.costBasis` or of `opts.costBasis`. Under the
 * default genome (`tokenSplit.enabled: false`) the correlator never runs and
 * no caller passes `correlated`, so every production rollup reports
 * `calls-and-ms` until an explicit non-default genome turns the split on.
 * Supplying an EMPTY map is not the same as supplying none — it says the
 * correlator ran and found no attributable spend, which is a token measurement
 * of zero rather than the absence of a measurement.
 */
function resolveCostBasis(opts: AttentionOptions): "tokens" | "calls-and-ms" {
  if (opts.correlated === undefined) return "calls-and-ms";
  return opts.costBasis ?? "calls-and-ms";
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
  /**
   * Per-unknown token spend from the transcript correlator (`correlateTokens`).
   * Absent means no correlation was attempted — which is the default genome,
   * where `tokenSplit.enabled` is false and this argument is never passed.
   */
  correlated?: Map<string, TokenTiers>;
  /**
   * `CorrelationResult.residual` — transcript spend the correlator could place
   * in NO tool window at all. Reported as its own bucket, never merged.
   */
  residual?: TokenTiers;
  /** The basis the genome declares; downgraded when nothing correlated. */
  costBasis?: "tokens" | "calls-and-ms";
}

/** Per-unknown and per-class attention across the tree in `vaultDir`. */
export function computeAttention(
  tree: readonly OstNode[],
  vaultDir: string,
  opts: AttentionOptions = {},
): AttentionRollup {
  const weights = opts.weights ?? DEFAULT_TOKEN_WEIGHTS;
  const classifier = opts.classifier ?? DEFAULT_CLASSIFIER;
  const resolution = opts.resolution ?? DEFAULT_RESOLUTION;
  const darkNodes = tree.filter((n) => n.layer === "Unknown");
  const knownTitles = new Set(darkNodes.map((n) => n.title));
  const stale = opts.attribution?.staleAttribution ?? "drop";
  const usage = rollUpUsage(vaultDir, knownTitles, stale);
  mergeCorrelated(usage, knownTitles, opts.correlated, stale);

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
      tokens = addTiers(tokens, traced.tokens);
    }
    return {
      title: node.title,
      klass: classifyUnknown(node, classifier),
      state: resolutionState(node, resolution),
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

  return {
    unknowns,
    byClass,
    unattributed: usage.unattributed,
    uncorrelated: opts.residual ?? emptyTiers(),
    costBasis: resolveCostBasis(opts),
  };
}
