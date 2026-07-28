/**
 * `genome.yaml` schema + defaults — the policy the kernel interprets.
 *
 * Every field has a default, and the defaults ARE today's behavior: a vault
 * with no genome.yaml behaves exactly as it did before Phase 2. That is not a
 * convenience, it is the regression contract (design, "Testing → Regression").
 * The design rule this file exists to satisfy is blunt: anything compiled in is
 * a trait excluded from evolution. A policy expressed as a TypeScript table
 * cannot breed.
 *
 * Unlike `ost.config.yaml`, this schema is STRICT at every level. Config strips
 * undeclared keys on purpose (see `config/schema.ts`), so a pre-runner vault
 * keeps loading. A genome has no legacy vaults to protect — it did not exist
 * until now — and it is the artifact a harness mutates. A misspelled allele
 * silently dropped would read as "behaviour unchanged", which is the one
 * failure mode that corrupts a fitness record without announcing itself.
 *
 * The gene interfaces below are hand-written rather than inferred, and the
 * schema is annotated with them. Nine other modules are written against these
 * names; they must be readable without running zod's inference, and any drift
 * between the schema and the contract must be a compile error HERE rather than
 * a mystery at a call site.
 *
 * This module imports nothing from the rest of the repo, and must not start.
 * The direction is knowledge → genome and eval → genome; a genome that read the
 * tree could not be evaluated independently of one.
 */
import { z } from "zod";

/** Relative cost per token tier. Ratios, not currency. */
export interface TokenWeightsGene {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

/** One classifier rule: every `present` section must exist, every `absent` one must not. */
export interface ClassifierRule {
  class: string;
  present: string[];
  absent: string[];
}

export interface ClassifierGene {
  /** The contract's sections, in the order a session should declare them. Order is returned by `contractGaps`. */
  contractSections: string[];
  /** The class vocabulary. Data, so that dropping a class is an allele rather than a rewrite. */
  classes: string[];
  /** The floor, applied when no rule matches. */
  fallback: string;
  /** Evaluated top to bottom; first match wins. */
  rules: ClassifierRule[];
}

/** One resolution rule: any listed `status`, or the presence of `section`, matches. */
export interface ResolutionRule {
  state: string;
  status: string[];
  section?: string;
}

export interface ResolutionGene {
  answerSection: string;
  fallback: string;
  /** Order IS the precedence: abandonment before satisfaction. */
  rules: ResolutionRule[];
}

export interface BudgetsGene {
  /** `null` ⇒ use the operator's `config.web.lookupBudget`. Only an explicit number overrides it. */
  sharedPool: number | null;
  /** `{}` ⇒ class-blind, one shared counter — exactly today. */
  perClass: Record<string, number>;
  onExhaustion: "instruct" | "record-unknown";
}

export interface PivotGene {
  unknownsBlockDone: boolean;
  /** 0 = unlimited. */
  maxOpenUnknownsSurfaced: number;
  ranking: "tree-order" | "cost-to-resolve" | "class-priority";
  classPriority: string[];
}

export interface AttributionGene {
  staleAttribution: "drop" | "unattributed";
}

export interface TokenSplitGene {
  enabled: boolean;
  source: "transcript";
  /** `""` ⇒ derive from the VAULT dir, never the product repo. */
  transcriptDir: string;
  method: "proportional-by-calls" | "proportional-by-ms" | "winner-take-all" | "none";
  residual: "unattributed" | "proportional" | "nearest-preceding";
  costBasis: "tokens" | "calls-and-ms";
}

export interface Genome {
  version: number;
  tokenWeights: TokenWeightsGene;
  classifier: ClassifierGene;
  resolution: ResolutionGene;
  budgets: BudgetsGene;
  pivot: PivotGene;
  attribution: AttributionGene;
  tokenSplit: TokenSplitGene;
}

// What attention costs. Output is the dear one, a cache write costs a little
// more than fresh input, a cache read roughly a tenth — the published pricing
// order, carried as ratios so the weighting can be varied without a currency.
const TokenWeightsSchema = z
  .object({
    input: z.number().nonnegative().default(1),
    output: z.number().nonnegative().default(5),
    cacheCreate: z.number().nonnegative().default(1.25),
    cacheRead: z.number().nonnegative().default(0.1),
  })
  .strict()
  .default({});

const ClassifierRuleSchema = z
  .object({
    class: z.string().min(1),
    present: z.array(z.string().min(1)).default([]),
    absent: z.array(z.string().min(1)).default([]),
  })
  .strict()
  // A rule predicated on nothing matches every node, including one that
  // declares nothing at all — the fallback's job, not a rule's.
  .refine((r) => r.present.length > 0 || r.absent.length > 0, {
    message: "a classifier rule needs at least one `present` or `absent` section",
  });

// The v1 default reproduces `classifyUnknown` exactly: no Format → unbounded;
// Format and Methodology → bounded; Format alone → unreached.
const ClassifierSchema = z
  .object({
    contractSections: z.array(z.string().min(1)).default(["Format", "Methodology", "Rationale"]),
    classes: z.array(z.string().min(1)).min(1).default(["bounded", "unreached", "unbounded"]),
    fallback: z.string().min(1).default("unbounded"),
    rules: z.array(ClassifierRuleSchema).default([
      { class: "unbounded", present: [], absent: ["Format"] },
      { class: "bounded", present: ["Format", "Methodology"], absent: [] },
      { class: "unreached", present: ["Format"], absent: [] },
    ]),
  })
  .strict()
  .default({})
  // The compensating guard for widening `UnknownClass` to `string`: zod cannot
  // yield a compile-time union from runtime YAML, so exhaustiveness moves here.
  // A rule emitting a class outside the vocabulary would produce a `byClass`
  // bucket no reader expects, and would do it silently.
  .refine(
    (c) => c.rules.every((r) => c.classes.includes(r.class)) && c.classes.includes(c.fallback),
    { message: "every rule's `class` and the `fallback` must appear in `classes`" },
  );

const ResolutionRuleSchema = z
  .object({
    state: z.string().min(1),
    status: z.array(z.string().min(1)).default([]),
    section: z.string().min(1).optional(),
  })
  .strict()
  // Pinned, NOT an allele: satisfaction is never claimed on the absence of
  // evidence. A rule matching on nothing would fire on an unknown with no
  // answer at all, which is the one direction the ladder never runs.
  .refine((r) => r.status.length > 0 || r.section !== undefined, {
    message: "a resolution rule needs a `status` list or a `section` probe",
  });

// Order IS precedence. Abandonment is checked first so a deferred unknown reads
// as abandoned even when an answer was drafted — the human's call outranks the
// draft, and the spend that bought nothing stays visible.
const ResolutionSchema = z
  .object({
    answerSection: z.string().min(1).default("Answer"),
    fallback: z.string().min(1).default("open"),
    rules: z.array(ResolutionRuleSchema).default([
      { state: "abandoned", status: ["deferred"] },
      { state: "satisfied", status: ["validated"], section: "Answer" },
    ]),
  })
  .strict()
  .default({});

// `sharedPool: null` is the deliberate fork: `config.web.lookupBudget` stays
// THE operator's number, and the genome does not shadow it until an allele
// explicitly names one. Two numbers that can silently disagree would be worse
// than an unevolved budget.
const BudgetsSchema = z
  .object({
    sharedPool: z.number().int().positive().nullable().default(null),
    perClass: z.record(z.string(), z.number().int().nonnegative()).default({}),
    onExhaustion: z.enum(["instruct", "record-unknown"]).default("instruct"),
  })
  .strict()
  .default({});

// v1 never pivots. An unbounded unknown has no stopping condition, so counting
// it toward `done` would wedge every pass forever; exploration is reported and
// discretionary, exactly as it is today.
const PivotSchema = z
  .object({
    unknownsBlockDone: z.boolean().default(false),
    maxOpenUnknownsSurfaced: z.number().int().nonnegative().default(0), // 0 = unlimited
    ranking: z.enum(["tree-order", "cost-to-resolve", "class-priority"]).default("tree-order"),
    classPriority: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .default({});

const AttributionSchema = z
  .object({
    staleAttribution: z.enum(["drop", "unattributed"]).default("drop"),
  })
  .strict()
  .default({});

// OFF in v1. Nothing correlates tokens today, so `enabled: false` is what
// "behavior matches today's" means: tokens stay {0,0,0,0} and weighted cost
// stays 0. `costBasis` rides on every rollup so a comparison that mixes bases
// can be refused rather than silently normalized.
const TokenSplitSchema = z
  .object({
    enabled: z.boolean().default(false),
    source: z.enum(["transcript"]).default("transcript"),
    transcriptDir: z.string().default(""),
    method: z
      .enum(["proportional-by-calls", "proportional-by-ms", "winner-take-all", "none"])
      .default("proportional-by-calls"),
    residual: z.enum(["unattributed", "proportional", "nearest-preceding"]).default("unattributed"),
    costBasis: z.enum(["tokens", "calls-and-ms"]).default("tokens"),
  })
  .strict()
  .default({});

export const GenomeSchema: z.ZodType<Genome, z.ZodTypeDef, unknown> = z
  .object({
    version: z.number().int().positive().default(1),
    tokenWeights: TokenWeightsSchema,
    classifier: ClassifierSchema,
    resolution: ResolutionSchema,
    budgets: BudgetsSchema,
    pivot: PivotSchema,
    attribution: AttributionSchema,
    tokenSplit: TokenSplitSchema,
  })
  .strict();
