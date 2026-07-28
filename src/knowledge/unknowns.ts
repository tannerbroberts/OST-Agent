/**
 * The unknown model — what darkness declares about itself.
 *
 * An unknown carries a contract in three body sections: Format (the shape a
 * valid answer takes), Methodology (how it would be collected), Rationale
 * (which node and metric it serves). Format is the stopping condition: an
 * unknown that can state what an answer looks like knows when it is done.
 *
 * The class is DERIVED from contract completeness, never stored. That is
 * deliberate on two counts: replacing the classifier reclassifies every
 * existing node with no migration, and completeness is mechanically checkable
 * rather than a judgement about how mysterious something feels — the same
 * crudeness as `hasRecordedResult`.
 *
 * As of Phase 2 that replacement no longer requires editing this file. The
 * classifier is an INTERPRETER over a rule list carried in `genome.yaml`:
 * first match wins, a rule matches when every section it names as `present`
 * is declared and every section it names as `absent` is not, and no match at
 * all falls to `fallback`. Rule order is the precedence, the class vocabulary
 * travels with the rules — a genome that could only emit three compiled-in
 * labels could not express the two-class allele the design expects to win —
 * and `contractSections` order is what `contractGaps` reports back, so a
 * session is told what to declare in the order the genome asks for it.
 *
 * `UnknownClass` is therefore `string`, not a union. Zod cannot hand back a
 * compile-time union from a file read at runtime, and faking one would put the
 * vocabulary back in the compiler — exactly the trait-excluded-from-evolution
 * this phase exists to undo. `UNKNOWN_CLASSES` survives as the DEFAULT
 * vocabulary, which is all it ever really was.
 */
import { defaultGenome } from "../genome/load.js";
import type { ClassifierGene, ResolutionGene } from "../genome/schema.js";
import type { OstNode } from "../ost/node.js";

/** A class name is genome data now — no compile-time union can enumerate them. */
export type UnknownClass = string;

/**
 * A terminal (or non-terminal) label for an unknown. A `string`, not a union:
 * the vocabulary is genome data now, and zod cannot hand a compile-time union
 * back from a YAML file parsed at runtime. The default gene's three values —
 * `open`, `satisfied`, `abandoned` — are the v1 vocabulary, not the ceiling.
 */
export type ResolutionState = string;

/**
 * The v1 classifier, read from the genome schema's own defaults rather than
 * restated here. One place a default lives, so a hand-kept copy cannot drift
 * out from under the file that governs behaviour.
 */
export const DEFAULT_CLASSIFIER: ClassifierGene = defaultGenome().classifier;

/**
 * The v1 resolution gene, sourced from the schema so the default lives in
 * exactly one place. Imports run knowledge → genome and never back (the genome
 * module knows nothing about unknowns).
 */
export const DEFAULT_RESOLUTION: ResolutionGene = defaultGenome().resolution;

/** The DEFAULT class vocabulary. A loaded genome may name a different one. */
export const UNKNOWN_CLASSES: readonly string[] = Object.freeze([...DEFAULT_CLASSIFIER.classes]);

/** The contract's sections, in the order a session should declare them. */
export const CONTRACT_SECTIONS: readonly string[] = Object.freeze([...DEFAULT_CLASSIFIER.contractSections]);

/**
 * Section names arrive from YAML now, so they are escaped before they reach a
 * pattern. For every default name this is a no-op; for a genome that names a
 * section `C++ interop` it is the difference between a probe and a crash.
 */
function escapeForPattern(heading: string): string {
  return heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the body carries a `## <heading>` section. Anchored to a heading so prose cannot fake one. */
function hasSection(body: string, heading: string): boolean {
  return new RegExp(String.raw`^##\s+${escapeForPattern(heading)}\b`, "im").test(body);
}

/** Which contract sections this unknown has not declared, in the order the genome lists them. */
export function contractGaps(node: OstNode, sections: readonly string[] = CONTRACT_SECTIONS): string[] {
  return sections.filter((s) => !hasSection(node.body, s));
}

/**
 * Class by the genome's rules, top to bottom, first match wins.
 *
 * The v1 default reproduces the branch this replaced: no Format → unbounded
 * (you cannot say what an answer looks like); Format and Methodology →
 * bounded (open the cabinet); Format alone → unreached (you know the answer's
 * shape and nothing emits it). A rule naming neither `present` nor `absent`
 * would match every node and swallow the list, which is why the schema refuses
 * to load one — the interpreter can then stay this small.
 */
export function classifyUnknown(node: OstNode, classifier: ClassifierGene = DEFAULT_CLASSIFIER): UnknownClass {
  for (const rule of classifier.rules) {
    const present = rule.present.every((s) => hasSection(node.body, s));
    const absent = rule.absent.every((s) => !hasSection(node.body, s));
    if (present && absent) return rule.class;
  }
  return classifier.fallback;
}

/**
 * Resolution is recorded, never claimed — an interpreter over the resolution
 * gene's rule list.
 *
 * A rule matches when the node's `status` appears in the rule's `status` list,
 * OR — when the rule names a `section` — when the body carries that `## <name>`
 * heading. The first matching rule wins; nothing matches, the `fallback` does.
 *
 * RULE ORDER IS THE PRECEDENCE, and that sentence is the gene's load-bearing
 * property. The machine this replaced checked abandonment first, in a statement
 * order no reader could reorder by accident, so that a human's `deferred`
 * outranked an agent's drafted `## Answer`. That guarantee now lives in the
 * position of two entries in a YAML list. Swap them and an abandoned unknown
 * with a stray answer reads as satisfied — no error, no warning, a corrupted
 * fitness record that announces nothing. It is the one mutation the schema
 * cannot catch, so it is the one the tests pin.
 *
 * The check remains mechanical, on the same precedent as `hasRecordedResult`
 * (`eval/evidence-debt.ts`): satisfaction means a heading exists or a status was
 * set, never that an answer was checked against its declared Format. That is a
 * floor, not a verdict. The fail-closed direction is pinned in the schema, not
 * here: a rule that matched on nothing would fire on every node including one
 * with no answer at all, so satisfaction can never be claimed on absence.
 *
 * `answerSection` is the gene's canonical name for the heading that means "an
 * answer exists". The interpreter reads only `rules`, so renaming it there is
 * what changes behaviour — but the default rule set names it, which keeps the
 * rename a one-line edit and is asserted as an invariant by the tests.
 */
export function resolutionState(
  node: OstNode,
  resolution: ResolutionGene = DEFAULT_RESOLUTION,
): ResolutionState {
  for (const rule of resolution.rules) {
    const byStatus = node.status !== undefined && rule.status.includes(node.status);
    const bySection = rule.section !== undefined && hasSection(node.body, rule.section);
    if (byStatus || bySection) return rule.state;
  }
  return resolution.fallback;
}
