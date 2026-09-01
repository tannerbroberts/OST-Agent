/**
 * The refuse-when-unclear rule — when a source cannot be read into exactly one
 * answer, the agent produces no recommendation at all.
 *
 * **The failure this defends against.** `ost-agent lanes` printed a paste-ready
 * `lane … --set compute-only` and offered the test's own sentence as the reason.
 * The sentence was real, correctly transcribed and from the right node. It also
 * read `Lane: compute-only for the census, humans-required for the fixing`, and
 * the recommendation quoted only as far as `compute-only`. Pasting it would have
 * moved the human half of a split test into compute's reach, using the test's own
 * words as the argument for doing so. A quote is the strongest signal of
 * groundedness this interface has, so it is also the most efficient way to be
 * confidently wrong.
 *
 * The sibling solutions in the tree answer that by showing the reader more —
 * fuller quotes, surrounding context, distinct marking for machine-selected
 * excerpts. This module takes the other route: it refuses to put the problem in
 * front of the reader in an actionable shape at all. A solution that relies on
 * that same reader reading more carefully is defending against the failure with
 * the thing that failed.
 *
 * **What this module is NOT, and the boundary is deliberate.** Nothing here is
 * wired into a rendering surface. The assumption test beneath the solution
 * ("Count how many of this vault's recommendations would go silent under a
 * refuse-when-unclear rule") says the cost has to be measured before the rule is
 * applied, because recommendations are the product's actual output and a rule
 * that suppresses most of them is a way of turning the tool off while appearing
 * careful. So this is a decider and {@link ../ost/recommendation-census.ts} is a
 * counter, and neither changes what any surface prints today.
 *
 * **The granularity is the sentence, and that choice has a cost.** A source is
 * read as the whole sentence(s) the answer sits in — the unit
 * {@link ../ost/lanes.ts sentencesAround} already produces and the unit a human
 * reader actually reads. A qualification anywhere in that sentence counts, even
 * when a careful parse would attach it to a different clause. That over-suppresses
 * on long sentences; the alternative (clause attachment) under-suppresses on
 * exactly the shape that caused the incident, where the qualification sits in a
 * trailing clause the reader's eye skips. The census is what says whether the cost
 * of the safe direction is affordable.
 */

/** Every way a source can fail to read into one answer. Closed, so the rule cannot grow a silent branch. */
export const CLARITY_RULES = [
  /** Nothing was quoted — a recommendation with no source does not read cleanly, it does not read at all. */
  "empty-source",
  /** The sentence names more than one candidate answer, so picking one is a choice the source did not make. */
  "multiple-answers",
  /** The sentence splits its claim across cases — `for the census, … for the fixing` — and the answer covers one of them. */
  "scoped-qualification",
  /** The claim is contingent on something the sentence does not settle. */
  "conditional-claim",
  /** The claim is not asserted flatly — `mostly`, `probably`, `seems`. */
  "hedged-claim",
  /** The answer's own words are negated where they sit. */
  "negated-answer",
] as const;

export type ClarityRule = (typeof CLARITY_RULES)[number];

/**
 * A source a recommendation was read out of.
 *
 * Two kinds, and the distinction decides whether this rule has anything to say.
 * A `prose` source is human writing that had to be *read* into an answer, which
 * is where a half-reading can happen. A `structural` source is a fact about the
 * tree — a set intersection, a string equality against the files on disk, a
 * missing parent link — where nothing was excerpted and there is no clipped
 * qualification to miss. Structural sources always read cleanly, and saying so
 * is not a loophole: it is the reason the assumption test insists the count be
 * kept per surface, since a rule that leaves structural findings intact while
 * silencing every prose-read hint would look affordable on a pooled number.
 */
export type RecommendationSource =
  | {
      kind: "prose";
      /** The whole sentence(s) the answer was read from — never a bare fragment. */
      quote: string;
      /** Where the answer's own words sit inside `quote`, for the negation check. */
      span?: { start: number; end: number };
      /** Every answer this read could have produced, when it draws from a vocabulary. */
      alternatives?: readonly string[];
    }
  | {
      kind: "structural";
      /** What was computed, in the computation's own terms — for the auditor. */
      derivation: string;
    };

/** Why a source was refused, and what a human would have to settle to unblock it. */
export interface AmbiguityReport {
  rule: ClarityRule;
  /** The source as read, whole — the refusal shows its work or it is just a shrug. */
  quote: string;
  /** The words that made it unclear, quoted back. */
  trigger: string;
  /** What a person would have to decide before any recommendation is possible here. */
  settle: string;
}

export type ClarityVerdict = { reads: "cleanly" } | { reads: "unclear"; report: AmbiguityReport };

/**
 * Phrases that split a claim across cases. Each one says the sentence is true of
 * some situations and not others, so an answer read out of it covers a subset
 * the recommendation does not name.
 *
 * Deliberately literal and short. Every entry is a connective whose whole job is
 * to introduce an exception; nothing here fires on a sentence that merely
 * contains a contrast.
 */
const SCOPE_SPLITS: readonly RegExp[] = [
  /\bbut not\b/i,
  /\band not\b/i,
  /\bexcept(?:ing)?\b/i,
  /\bother than\b/i,
  /\bapart from\b/i,
  /\bonly for\b/i,
  /\bnot for\b/i,
];
// `rather than` and `whereas` were here and were removed after the first census
// run over the live vault showed what they caught. Neither introduces an
// exception — they substitute one thing for another and contrast two things, and
// both are ordinary connective tissue in this vault's argumentative prose. They
// fired on sentences whose claim was not scoped at all, which is the failure this
// module is least able to afford: a rule that suppresses a clean source teaches
// the reader that ambiguity reports are noise.

/**
 * Phrases that make the claim contingent. `when` and `while` are deliberately
 * absent: in this vault's prose they carry a temporal sense far more often than a
 * conditional one, and a marker that fires on every other sentence measures the
 * prose style rather than the ambiguity.
 */
const CONDITIONALS: readonly RegExp[] = [
  /\bif\b/i,
  /\bunless\b/i,
  /\bdepending on\b/i,
  /\bprovided that\b/i,
  /\b(?:so|as) long as\b/i,
  /\bassuming\b/i,
];

/** Phrases that decline to assert the claim outright. */
const HEDGES: readonly RegExp[] = [
  /\bmostly\b/i,
  /\bmainly\b/i,
  /\blargely\b/i,
  /\bbroadly\b/i,
  /\busually\b/i,
  /\bgenerally\b/i,
  /\btypically\b/i,
  /\bprobably\b/i,
  /\bpossibly\b/i,
  /\bperhaps\b/i,
  /\bmaybe\b/i,
  /\barguably\b/i,
  /\bpresumably\b/i,
  /\broughly\b/i,
  /\bsomewhat\b/i,
  /\bmore or less\b/i,
  /\bin principle\b/i,
  /\btends? to\b/i,
  /\bseems?\b/i,
  /\bappears? to\b/i,
  /\b(?:may|might|could) be\b/i,
];

/**
 * Negations checked in a window *before* the answer rather than across the whole
 * sentence. Bare `not`/`no` are the commonest words in this vault's argumentative
 * prose — a sentence-wide check on them would suppress nearly everything and
 * measure nothing. Position is what makes them meaningful.
 *
 * **Preceding only, and that is a rule rather than a knob.** English negation is
 * pre-posed: `no interview`, `does not try to survey`, `nothing about
 * usability`. A negation *after* the marker almost always belongs to the next
 * clause — the first census run over the live vault caught `it is usability, and
 * no exit code…`, where `no` sits eighteen characters past the marker and negates
 * something else entirely. Looking only backwards drops that class without
 * touching a single one of the true positives, all of which were pre-posed.
 */
const NEGATIONS: readonly RegExp[] = [/\bnot\b/i, /\bno\b/i, /\bnever\b/i, /\bwithout\b/i, /\bnothing\b/i];

/** How far before the answer a negation still governs it. Characters, not tokens — the quote is raw prose. */
const NEGATION_WINDOW = 40;

/**
 * Read a source into at most one answer.
 *
 * Order is fixed and reported first-match-wins, strongest signal first: naming
 * two answers is the observed incident and outranks everything; a split scope is
 * the same failure one step less explicit; a condition and a hedge each weaken
 * the claim without splitting it; a negation on the answer's own words is last
 * because it is the narrowest check.
 *
 * `cleanly` is a statement about the source, never about the recommendation being
 * right. A sentence can read perfectly and still say something false, and the
 * assumption test says so in as many words: this is a cost measurement, not a
 * benefit one.
 */
export function readSource(source: RecommendationSource): ClarityVerdict {
  if (source.kind === "structural") return { reads: "cleanly" };

  const quote = source.quote.trim();
  if (!quote) {
    return {
      reads: "unclear",
      report: {
        rule: "empty-source",
        quote: "",
        trigger: "",
        settle: "quote the sentence this was read from, or say what was computed instead of quoted",
      },
    };
  }

  const named = (source.alternatives ?? []).filter((a) => matchesWord(quote, a));
  if (named.length > 1) {
    return {
      reads: "unclear",
      report: {
        rule: "multiple-answers",
        quote,
        trigger: named.join(", "),
        settle: `the sentence names ${named.length} answers (${named.join(", ")}) — a person has to say which one it means, or split the claim into one node per answer`,
      },
    };
  }

  const split = firstMatch(quote, SCOPE_SPLITS);
  if (split) {
    return {
      reads: "unclear",
      report: {
        rule: "scoped-qualification",
        quote,
        trigger: split,
        settle: `"${split}" carves the claim into cases — a person has to say which case this recommendation is about`,
      },
    };
  }

  const conditional = firstMatch(quote, CONDITIONALS);
  if (conditional) {
    return {
      reads: "unclear",
      report: {
        rule: "conditional-claim",
        quote,
        trigger: conditional,
        settle: `the claim holds only "${conditional}" something the sentence leaves open — a person has to settle whether it holds here`,
      },
    };
  }

  const hedge = firstMatch(quote, HEDGES);
  if (hedge) {
    return {
      reads: "unclear",
      report: {
        rule: "hedged-claim",
        quote,
        trigger: hedge,
        settle: `"${hedge}" declines to assert the claim — a person has to decide whether it is true of this case`,
      },
    };
  }

  if (source.span) {
    const from = Math.max(0, source.span.start - NEGATION_WINDOW);
    const negation = firstMatch(quote.slice(from, source.span.end), NEGATIONS);
    if (negation) {
      return {
        reads: "unclear",
        report: {
          rule: "negated-answer",
          quote,
          trigger: negation,
          settle: `"${negation}" sits on the words this was read from — a person has to say whether the sentence asserts the answer or denies it`,
        },
      };
    }
  }

  return { reads: "cleanly" };
}

function firstMatch(text: string, patterns: readonly RegExp[]): string | undefined {
  for (const p of patterns) {
    const hit = p.exec(text);
    if (hit) return hit[0].toLowerCase();
  }
  return undefined;
}

/** Whole-word containment, so the lane `one-command` is not found inside a sentence about `one command line`. */
function matchesWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\w-])${escaped}(?:$|[^\\w-])`, "i").test(text);
}

/**
 * What a surface prints in place of the recommendation it refused. The shape
 * matters as much as the refusal: an ambiguity report that does not name a
 * settlement is a dead end, and a reader with a dead end goes back to trusting
 * the quote.
 */
export function renderAmbiguity(report: AmbiguityReport): string {
  if (report.rule === "empty-source") {
    return `No recommendation — nothing was quoted to read it out of. ${report.settle}.`;
  }
  return (
    `No recommendation — this source does not read into one answer (${report.rule}). ` +
    `It says: "${report.quote}". What has to be settled: ${report.settle}.`
  );
}
