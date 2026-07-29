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
 * overridable per call.
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
 * fate is the `staleAttribution` option: dropped (the default) or folded into
 * unattributed.
 *
 * There is a token dimension the tool tracer cannot see, and nothing fills it.
 * The `correlated` parameter is the seam a transcript correlator would arrive
 * through, along with a FOURTH bucket the call-based split has no room for:
 * transcript spend inside no tool window at all — the thinking, the reading,
 * the assistant turn that emits the call. That is not the same ignorance as "a
 * call with no OST_UNKNOWN", and folding the two together would inflate the
 * unattributed share with spend no call ever bracketed, so they are reported
 * apart. Every rollup carries the basis its numbers actually rest on, because a
 * comparison across bases must be refused rather than silently normalized.
 *
 * The basis is a property of what this rollup ACTUALLY RECEIVED, not of what a
 * caller asked for. No `correlated` map reaches `computeAttention` =>
 * `costBasis` is `"calls-and-ms"`, whatever the caller declared — and since
 * nothing in the repo passes `correlated`, that is every rollup today.
 */
import {
  classifyUnknown,
  resolutionState,
  DEFAULT_CLASSIFIER,
  DEFAULT_RESOLUTION,
  type ResolutionPolicy,
  type ResolutionState,
  type UnknownClass,
  type UnknownClassifier,
} from "../knowledge/unknowns.js";
import type { OstNode } from "../ost/node.js";
import { addTiers, emptyTiers, readAttention, type TokenTiers } from "../telemetry/attention.js";
import { usageLogPath } from "../telemetry/usage.js";
import fs from "node:fs";

/** Relative cost per token tier. Ratios, not currency. */
export interface WeightedTokenSpend {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

/** What to do with a spend marker naming a title no longer on the tree. */
export type StaleAttribution = "drop" | "unattributed";

/**
 * Relative cost per tier, tracking published pricing ratios: output is the
 * dear one, a cache write costs a little more than fresh input, and a cache
 * read is roughly a tenth. These are ratios, not currency.
 *
 * Nothing writes token counts today — the tool tracer never sees a token — so
 * this model prices a quantity that is structurally zero on every live path,
 * and `resolveCostBasis` downgrades every production rollup to `calls-and-ms`
 * accordingly. It is kept because the shape of the ledger is right and the
 * numbers are the published ratios; it is not evidence that anything is being
 * weighed.
 */
export const DEFAULT_WEIGHTED_TOKEN_SPEND: WeightedTokenSpend = {
  input: 1,
  output: 5,
  cacheCreate: 1.25,
  cacheRead: 0.1,
};

export function weightedTokenCost(tokens: TokenTiers, weightedTokenSpend: WeightedTokenSpend = DEFAULT_WEIGHTED_TOKEN_SPEND): number {
  return (
    tokens.input * weightedTokenSpend.input +
    tokens.output * weightedTokenSpend.output +
    tokens.cacheCreate * weightedTokenSpend.cacheCreate +
    tokens.cacheRead * weightedTokenSpend.cacheRead
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
  /** Keyed by the classifier's vocabulary — every declared class gets a bucket, earned or not. */
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
  staleAttribution: StaleAttribution = "drop",
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
  stale: StaleAttribution,
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
 * RECEIVED, never of what a caller declared.
 *
 * A caller may ask for `tokens`, but a request is not data: with no correlated
 * map supplied every token is zero, and a comparison on that basis would read
 * the silence as "this spent nothing". So the rule is unconditional:
 * `opts.correlated === undefined` => `"calls-and-ms"`, regardless of
 * `opts.costBasis`. Nothing in the repo passes `correlated`, so every rollup
 * today reports `calls-and-ms`.
 *
 * Supplying an EMPTY map is not the same as supplying none — it says a
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
 * A bucket per declared class, whether or not any node earned it. A class that
 * appears with zero is a measured zero; a class simply absent from the record
 * is indistinguishable from one that was never declared, and a reader has to be
 * able to tell those apart.
 */
function emptyByClass(classes: readonly string[]): Record<string, ClassRollup> {
  return Object.fromEntries(classes.map((c) => [c, emptyClassRollup()]));
}

/**
 * Which policy this rollup is computed under. An object rather than more
 * positionals: the third argument is already load-bearing at nine call sites,
 * and each of these needs to arrive without becoming a fourth slot whose
 * meaning depends on argument order.
 *
 * Every field is optional and every omission means the shipped default.
 */
export interface AttentionOptions {
  /** The cost model. Omitted ⇒ {@link DEFAULT_WEIGHTED_TOKEN_SPEND}. */
  weightedTokenSpend?: WeightedTokenSpend;
  /** The classification rules. Omitted ⇒ {@link DEFAULT_CLASSIFIER}. */
  classifier?: UnknownClassifier;
  /** The resolution rules. Omitted ⇒ {@link DEFAULT_RESOLUTION}. */
  resolution?: ResolutionPolicy;
  /** How spend naming an off-tree title is attributed. Omitted ⇒ dropped. */
  attribution?: { staleAttribution: StaleAttribution };
  /**
   * Per-unknown token spend from a transcript correlator. Absent means no
   * correlation was attempted, which is every caller in the repo today.
   */
  correlated?: Map<string, TokenTiers>;
  /**
   * `CorrelationResult.residual` — transcript spend the correlator could place
   * in NO tool window at all. Reported as its own bucket, never merged.
   */
  residual?: TokenTiers;
  /** The basis the caller asks for; downgraded when nothing correlated. */
  costBasis?: "tokens" | "calls-and-ms";
}

/** Per-unknown and per-class attention across the tree in `vaultDir`. */
export function computeAttention(
  tree: readonly OstNode[],
  vaultDir: string,
  opts: AttentionOptions = {},
): AttentionRollup {
  const weightedTokenSpend = opts.weightedTokenSpend ?? DEFAULT_WEIGHTED_TOKEN_SPEND;
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
      weightedCost: weightedTokenCost(tokens, weightedTokenSpend),
    };
  });

  const byClass = emptyByClass(classifier.classes);
  for (const u of unknowns) {
    // A hand-built classifier may emit a class outside its own declared
    // vocabulary, and dropping the spend on the floor would be worse than
    // naming it.
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
