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

/**
 * One resolution rule: any listed `status`, or the presence of `section`, matches.
 *
 * `requires` and `nonAnswers` grade the `section` probe and nothing else. Both
 * are OPTIONAL and both are opt-in: a rule naming neither decides exactly what
 * it decided before they existed, which is what lets a caller's hand-built
 * policy keep its behaviour across this change.
 */
export interface ResolutionRule {
  state: string;
  status: string[];
  section?: string;
  /**
   * Sections that must ALSO be declared for the `section` probe to count. An
   * answer with no declared stopping condition is not a resolution — the
   * default policy requires `Format` for exactly that reason.
   */
  requires?: readonly string[];
  /**
   * Contents the `section` probe refuses to read as an answer, compared after
   * normalization. Omitted means any heading counts — today's floor.
   */
  nonAnswers?: readonly string[];
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
 * Contents that record the ABSENCE of an answer rather than a terse one.
 *
 * Every entry is a token a session writes when it has nothing: `n/a`, `tbd`, a
 * bare dash. None of them is a short answer — that distinction is the whole
 * list's justification, and it is why the list is deliberately tiny. A grader
 * with no judgement can rule on "is this the literal string `n/a`". It cannot
 * rule on "is this a good answer", and a longer list is precisely where it
 * would start pretending it could: add `no`, `zero`, `never` and the grader
 * begins rejecting real answers to real questions. Keep it under sixteen; if a
 * candidate entry needs a paragraph of argument, it belongs to a human review,
 * not here.
 *
 * Comparison is against {@link normalizeAnswer}'s output, so case, surrounding
 * emphasis and a trailing period do not launder an entry past the list.
 */
export const NON_ANSWERS: readonly string[] = Object.freeze([
  "n/a",
  "na",
  "none",
  "unknown",
  "tbd",
  "tbc",
  "-",
  "–",
  "—",
  "?",
  "not applicable",
  "not known",
  "no answer",
  "nothing",
]);

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
 *
 * The satisfied rule grades its `## Answer`: it must sit beside a declared
 * `## Format`, and it must not be one of {@link NON_ANSWERS}. The abandoned
 * rule is deliberately UNGRADED — `deferred` closes anything, because giving up
 * is always available and gating it would be a way to trap a session in an
 * unknown it has already decided not to pay for.
 */
export const DEFAULT_RESOLUTION: ResolutionPolicy = {
  answerSection: "Answer",
  fallback: "open",
  rules: [
    { state: "abandoned", status: ["deferred"] },
    {
      state: "satisfied",
      status: ["validated"],
      section: "Answer",
      requires: ["Format"],
      nonAnswers: NON_ANSWERS,
    },
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

/**
 * The content of EVERY `## <heading>` block in the body, in body order. A block
 * runs from its heading line to the next heading of any level.
 *
 * Union, never first-wins. The vault is append-only: a session that wrote a bad
 * `## Answer` cannot go back and rewrite it, it can only append a better one.
 * Grading the first block alone would therefore make a single `n/a` an
 * unclearable stopping state — the node could never reach satisfied by any move
 * the tool surface offers (R2). Reading all of them is what keeps the way out
 * open.
 */
function sectionBlocks(body: string, heading: string): string[] {
  const opens = new RegExp(String.raw`^##\s+${escapeForPattern(heading)}\b`, "i");
  const anyHeading = /^#{1,6}\s/;
  const blocks: string[] = [];
  let current: string[] | undefined;
  for (const line of body.split(/\r?\n/)) {
    if (opens.test(line)) {
      if (current !== undefined) blocks.push(current.join("\n"));
      current = [];
    } else if (current !== undefined && anyHeading.test(line)) {
      blocks.push(current.join("\n"));
      current = undefined;
    } else if (current !== undefined) {
      current.push(line);
    }
  }
  if (current !== undefined) blocks.push(current.join("\n"));
  return blocks;
}

/**
 * A crude comparison form for a section's content: leading list, emphasis,
 * quote and heading punctuation stripped, lowercased, whitespace collapsed, one
 * trailing period dropped. Crude on `hasRecordedResult`'s precedent — it exists
 * so `- **N/A**.` cannot walk past a list that spells `n/a`, not to understand
 * anything.
 *
 * It MUST NOT eat digits or currency symbols. `$0`, `0` and `0 per day` are
 * answers — to "what does it cost", "how many complained", "what is the
 * throughput" — and a normalizer that reduced them to nothing would turn the
 * grader into a machine that rejects the truth for being small.
 */
function normalizeAnswer(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[-*+>#`_"'\s]+/, "")
    .replace(/[*`_"'\s]+$/, "")
    .toLowerCase()
    .replace(/\.$/, "")
    .trim();
}

/**
 * True when SOME block under `heading` normalizes to something non-empty that
 * is not a declared non-answer. Some, not the first — see {@link sectionBlocks}.
 */
function carriesAnswer(body: string, heading: string, nonAnswers: readonly string[]): boolean {
  const refused = new Set(nonAnswers.map(normalizeAnswer));
  return sectionBlocks(body, heading).some((block) => {
    const normalized = normalizeAnswer(block);
    return normalized.length > 0 && !refused.has(normalized);
  });
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
 * A rule may grade its `section` probe with `requires` and `nonAnswers`. What
 * that buys, stated exactly: a satisfying `## Answer` must sit beside every
 * section in `requires` — the default names `Format`, so an answer with no
 * declared stopping condition no longer closes anything — and must not
 * normalize to one of `nonAnswers`, so `n/a`, `TBD` and an empty heading are
 * read as the absences they are rather than as answers.
 *
 * What that does NOT buy, and must not be read as buying: the `Format` is
 * checked for EXISTENCE and never for MEANING. A Format reading "a dollar
 * figure with a date" beside an Answer reading "sail west" is satisfied here.
 * Nothing in this module parses a Format, and nothing compares an answer's
 * shape to one. The check stays mechanical, on `hasRecordedResult`'s precedent
 * (`eval/evidence-debt.ts`) — a floor that a recorded absence no longer clears,
 * not a verdict on whether the answer is any good.
 *
 * `byStatus` is deliberately ungraded, and B2 is what makes that safe rather
 * than residual. A human's explicit `validated` is authoritative and stays so;
 * gating the status path would also break the first-match-wins contract this
 * interpreter states above. When this was written, `ost_set_status validated`
 * was a route the AGENT held — which would have made an ungraded status path a
 * hole. It is not: `validated` is off every tool's status enum, and the only
 * writer is a human running `ost-agent promote`.
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
    const bySection =
      rule.section !== undefined &&
      hasSection(node.body, rule.section) &&
      (rule.requires ?? []).every((s) => hasSection(node.body, s)) &&
      (rule.nonAnswers === undefined || carriesAnswer(node.body, rule.section, rule.nonAnswers));
    if (byStatus || bySection) return rule.state;
  }
  return resolution.fallback;
}
