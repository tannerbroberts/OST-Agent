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
 * Both the classifier and the resolution rule are INTERPRETERS over a rule
 * list: first match wins, a classifier rule matches when every section it names
 * as `present` is declared and every section it names as `absent` is not, and
 * no match at all falls to `fallback`. Rule order is the precedence, and
 * `contractSections` order is what `contractGaps` reports back, so a session is
 * told what to declare in the order this module asks for it.
 *
 * The rule lists were briefly an evolvable `genome.yaml` and are now constants
 * again. Nothing varied them but a breeding harness that could never promote a
 * winner, and a policy file at the vault root that no tool could read or repair
 * was a denial-of-service surface with nothing on the other side of it. The
 * interpreters stay, because a rule list is a clearer statement of the policy
 * than the branch it replaced, and because both functions still take the policy
 * as a parameter — which is what lets a test vary one without a file.
 *
 * `UnknownClass` stays `string` rather than a union: the classes are data on
 * {@link DEFAULT_CLASSIFIER}, callers may pass their own vocabulary, and the
 * exhaustiveness a union would buy is not worth re-plumbing every reader.
 */
import type { OstNode } from "../ost/node.js";

/** One classifier rule: every `present` section must exist, every `absent` one must not. */
export interface ClassifierRule {
  class: string;
  present: string[];
  absent: string[];
}

export interface UnknownClassifier {
  /** The contract's sections, in the order a session should declare them. Returned by `contractGaps`. */
  contractSections: string[];
  /** The class vocabulary. */
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

export interface ResolutionPolicy {
  answerSection: string;
  fallback: string;
  /** Order IS the precedence: abandonment before satisfaction. */
  rules: ResolutionRule[];
}

/** A derived class name for an unknown. */
export type UnknownClass = string;

/**
 * A terminal (or non-terminal) label for an unknown. The three values the
 * default policy emits — `open`, `satisfied`, `abandoned` — are the vocabulary,
 * not a ceiling: a caller may supply its own.
 */
export type ResolutionState = string;

/**
 * The classifier: no Format → unbounded (you cannot say what an answer looks
 * like); Format and Methodology → bounded (open the cabinet); Format alone →
 * unreached (you know the answer's shape and nothing emits it).
 *
 * A rule naming neither `present` nor `absent` would match every node and
 * swallow the list — that is the fallback's job, not a rule's.
 */
export const DEFAULT_CLASSIFIER: UnknownClassifier = {
  contractSections: ["Format", "Methodology", "Rationale"],
  classes: ["bounded", "unreached", "unbounded"],
  fallback: "unbounded",
  rules: [
    { class: "unbounded", present: [], absent: ["Format"] },
    { class: "bounded", present: ["Format", "Methodology"], absent: [] },
    { class: "unreached", present: ["Format"], absent: [] },
  ],
};

/**
 * How an unknown terminates. ORDER IS PRECEDENCE: abandonment is checked first,
 * so a human's `deferred` outranks an agent's drafted `## Answer`, and the spend
 * that bought nothing stays visible. Swap the two entries and an abandoned
 * unknown with a stray answer reads as satisfied — no error, no warning. The
 * tests pin the order for that reason.
 *
 * Neither rule may match on absence: a rule with no `status` list and no
 * `section` probe would fire on an unknown with no answer at all, which is the
 * one direction the ladder never runs.
 */
export const DEFAULT_RESOLUTION: ResolutionPolicy = {
  answerSection: "Answer",
  fallback: "open",
  rules: [
    { state: "abandoned", status: ["deferred"] },
    { state: "satisfied", status: ["validated"], section: "Answer" },
  ],
};

/** The class vocabulary. */
export const UNKNOWN_CLASSES: readonly string[] = Object.freeze([...DEFAULT_CLASSIFIER.classes]);

/** The contract's sections, in the order a session should declare them. */
export const CONTRACT_SECTIONS: readonly string[] = Object.freeze([...DEFAULT_CLASSIFIER.contractSections]);

/**
 * Section names are escaped before they reach a pattern. For every default name
 * this is a no-op; for a caller that names a section `C++ interop` it is the
 * difference between a probe and a crash.
 */
function escapeForPattern(heading: string): string {
  return heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the body carries a `## <heading>` section. Anchored to a heading so prose cannot fake one. */
function hasSection(body: string, heading: string): boolean {
  return new RegExp(String.raw`^##\s+${escapeForPattern(heading)}\b`, "im").test(body);
}

/** Which contract sections this unknown has not declared, in the order the classifier lists them. */
export function contractGaps(node: OstNode, sections: readonly string[] = CONTRACT_SECTIONS): string[] {
  return sections.filter((s) => !hasSection(node.body, s));
}

/** Class by the classifier's rules, top to bottom, first match wins. */
export function classifyUnknown(node: OstNode, classifier: UnknownClassifier = DEFAULT_CLASSIFIER): UnknownClass {
  for (const rule of classifier.rules) {
    const present = rule.present.every((s) => hasSection(node.body, s));
    const absent = rule.absent.every((s) => !hasSection(node.body, s));
    if (present && absent) return rule.class;
  }
  return classifier.fallback;
}

/**
 * Resolution is recorded, never claimed — an interpreter over the resolution
 * policy's rule list.
 *
 * A rule matches when the node's `status` appears in the rule's `status` list,
 * OR — when the rule names a `section` — when the body carries that `## <name>`
 * heading. The first matching rule wins; nothing matches, the `fallback` does.
 * Rule order is the precedence (see {@link DEFAULT_RESOLUTION}).
 *
 * The check is mechanical, on the same precedent as `hasRecordedResult`
 * (`eval/evidence-debt.ts`): satisfaction means a heading exists or a status was
 * set, never that an answer was checked against its declared Format. That is a
 * floor, not a verdict — and closing that gap is a named V1 criterion
 * (`docs/reference/v1-readiness.md`, B9).
 *
 * `answerSection` is the canonical name for the heading that means "an answer
 * exists". The interpreter reads only `rules`, so renaming it there is what
 * changes behaviour — the default rule set names it, which keeps the rename a
 * one-line edit and is asserted as an invariant by the tests.
 */
export function resolutionState(
  node: OstNode,
  resolution: ResolutionPolicy = DEFAULT_RESOLUTION,
): ResolutionState {
  for (const rule of resolution.rules) {
    const byStatus = node.status !== undefined && rule.status.includes(node.status);
    const bySection = rule.section !== undefined && hasSection(node.body, rule.section);
    if (byStatus || bySection) return rule.state;
  }
  return resolution.fallback;
}
