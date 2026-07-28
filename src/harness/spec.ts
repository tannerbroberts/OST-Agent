/**
 * What an environment IS, declaratively — a vault, a set of planted unknowns,
 * the channels their answers are (or are not) discoverable in, and the answer
 * key. For generated environments the design is explicit that "the spec IS the
 * key", so this one value is both the thing that plants the world and the thing
 * that grades the run.
 *
 * The key never reaches the vault directory. `generateEnvironment` writes
 * nodes, config and evidence and never writes a spec, so answer-key leakage —
 * which the design names as an error mode that INVALIDATES a run — is
 * foreclosed structurally rather than by remembering to be careful.
 *
 * `findable` is the field that makes a null environment a real test. A null
 * environment is a spec whose unknowns are all unfindable; it is NOT an empty
 * vault. An empty vault has no Unknown layer, so the rollup is empty and the
 * mandatory guard passes vacuously — the worst possible outcome for the one
 * test the design added specifically to stop selection for hyperactive
 * exploration.
 *
 * `created` is a fixed date on the spec because `serialize` stamps it into
 * frontmatter. A generator calling `new Date()` would emit vaults that differ
 * between days and fitness records that cannot be reproduced.
 *
 * This module imports nothing from the rest of the repo and must stay a leaf: a
 * spec that read the tree could not describe an environment independently of
 * one.
 */
import { z } from "zod";

/** A planted `#Unknown`, plus whether its answer is discoverable and what it is. */
export interface PlantedUnknown {
  title: string;
  /** The node that carries the `[[link]]` to this unknown. Direction is settled: the parent holds the edge. */
  darkens: string;
  /** Which contract sections the body declares — this is what decides `classifyUnknown`. */
  sections: string[];
  /** Whether any planted channel contains the answer. `false` is what a null environment is made of. */
  findable: boolean;
  /** The expected answer. Required when `findable`, empty when not. Never written to the vault. */
  answer: string;
}

/** A planted non-Unknown node. */
export interface PlantedNode {
  title: string;
  layer: "Outcome" | "Opportunity" | "Solution";
  body: string;
  /** Titles this node links to. The generator adds unknown edges on top of these. */
  links: string[];
}

/** A planted evidence item, landing in `.ost-agent/evidence/`. */
export interface PlantedEvidence {
  id: string;
  source: string;
  title: string;
  body: string;
}

export interface EnvironmentSpec {
  name: string;
  kind: "generated" | "null" | "adversarial" | "replay";
  seed: number;
  /** Fixed ISO date (YYYY-MM-DD) stamped into every planted node. */
  created: string;
  outcome: string;
  outcomeTitle: string;
  nodes: PlantedNode[];
  unknowns: PlantedUnknown[];
  evidence: PlantedEvidence[];
}

const PlantedUnknownSchema = z
  .object({
    title: z.string().min(1),
    darkens: z.string().min(1),
    sections: z.array(z.string().min(1)).default([]),
    findable: z.boolean(),
    answer: z.string().default(""),
  })
  .strict()
  // A findable unknown with no answer would put an empty string in the key and
  // score every run as having matched it.
  .refine((u) => !u.findable || u.answer.length > 0, {
    message: "a findable unknown must declare its answer",
  });

const PlantedNodeSchema = z
  .object({
    title: z.string().min(1),
    layer: z.enum(["Outcome", "Opportunity", "Solution"]),
    body: z.string().min(1),
    links: z.array(z.string().min(1)).default([]),
  })
  .strict();

const PlantedEvidenceSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    title: z.string().min(1),
    body: z.string().min(1),
  })
  .strict();

export const EnvironmentSpecSchema: z.ZodType<EnvironmentSpec, z.ZodTypeDef, unknown> = z
  .object({
    name: z.string().min(1),
    kind: z.enum(["generated", "null", "adversarial", "replay"]),
    seed: z.number().int().nonnegative(),
    created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "created must be an ISO date (YYYY-MM-DD)"),
    outcome: z.string().min(1),
    outcomeTitle: z.string().min(1),
    nodes: z.array(PlantedNodeSchema).min(1),
    unknowns: z.array(PlantedUnknownSchema).default([]),
    evidence: z.array(PlantedEvidenceSchema).default([]),
  })
  .strict()
  // The edge has to have a source. `darkens` naming a node that was never
  // planted produces an unknown nothing links to, which resolves `darkens: null`
  // at `computeNextWork` and silently degrades every coverage metric.
  .refine((s) => s.unknowns.every((u) => s.nodes.some((n) => n.title === u.darkens)), {
    message: "every unknown's `darkens` must name a planted node",
  })
  // Two unknowns with one title share one attention ledger file, so their spend
  // would merge and neither could be scored.
  .refine((s) => new Set(s.unknowns.map((u) => u.title)).size === s.unknowns.length, {
    message: "unknown titles must be unique",
  });

/** Unknown title ⇒ expected answer, for findable unknowns only. The grading key. */
export function answerKey(spec: EnvironmentSpec): Map<string, string> {
  return new Map(spec.unknowns.filter((u) => u.findable).map((u) => [u.title, u.answer]));
}

/** How many unknowns a run could resolve at all. The denominator for observation quality. */
export function findableCount(spec: EnvironmentSpec): number {
  return spec.unknowns.filter((u) => u.findable).length;
}
