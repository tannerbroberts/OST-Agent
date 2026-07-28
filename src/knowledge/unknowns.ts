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
import type { ClassifierGene } from "../genome/schema.js";
import type { OstNode } from "../ost/node.js";

/** A class name is genome data now — no compile-time union can enumerate them. */
export type UnknownClass = string;

export type ResolutionState = "open" | "satisfied" | "abandoned";

/**
 * The v1 classifier, read from the genome schema's own defaults rather than
 * restated here. One place a default lives, so a hand-kept copy cannot drift
 * out from under the file that governs behaviour.
 */
export const DEFAULT_CLASSIFIER: ClassifierGene = defaultGenome().classifier;

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
 * A mechanical presence check, on the same precedent as `hasRecordedResult`
 * (`eval/evidence-debt.ts`): satisfied means an `## Answer` heading exists or a
 * human moved the node to `validated`, never that the answer was checked
 * against its declared Format. That is a floor, not a verdict — an agent can
 * still write `## Answer` on nothing, or set `status: validated` on its own
 * node, and this function will call it satisfied either way. Abandonment is
 * checked first so that a deferred unknown reads as abandoned even if an
 * answer was drafted — the human's call outranks the draft.
 */
export function resolutionState(node: OstNode): ResolutionState {
  if (node.status === "deferred") return "abandoned";
  if (node.status === "validated" || hasSection(node.body, "Answer")) return "satisfied";
  return "open";
}
