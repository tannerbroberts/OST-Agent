/**
 * Whether an answer written into a question's open field is something a run can
 * proceed on — for "Every forced choice carries an open field, and a written
 * answer is first-class".
 *
 * The solution's whole argument rests on one claim: a sentence the operator
 * writes is actionable without a further round-trip. `src/loop/questions.ts`
 * already shows the alternative failing — `readHindsight` tags an answer that
 * matches no offered option as `reframed` and stops there, which is the shape of
 * "the run could not use it, so it asked again". This module is the other half:
 * turning that same prose into something a run is entitled to act on.
 *
 * ## Why the parse is (deliberately) almost nothing
 *
 * A written sentence does not need to be mapped onto one of the enumerated
 * options to be a decision — if it did, the open field would just be a slower
 * way of picking one, which is the exact theatre the solution node warns
 * against ("the operator writes their answer, the run fails to parse a decision
 * out of it, and asks again — which is the observed failure with an extra
 * step"). So the contract here is minimal on purpose: any sentence that carries
 * real content over its own instruction, unparsed. The only question this
 * module answers is whether there is anything there at all — an empty field, or
 * one holding nothing but Claude Code's own "(No answer provided)" filler, is
 * not a decision, and the run still has to ask.
 *
 * `test/loop/free-text-answer-parsing.test.ts` replays the two rejections
 * `TRANSCRIPT:42dcb7b4-f01b-40bc-a211-ed4a44a74fd3` recorded, where the operator
 * wrote what they meant instead of picking an option — see
 * `test/fixtures/free-text-answers/PROVENANCE.md` for exactly where those two
 * sentences came from.
 */

/** A marker Claude Code itself writes when a rejected ask's clarification carries nothing. */
const NO_CONTENT_MARKERS = [/^\(no answer provided\)$/i];

export interface FreeTextAnswer {
  /** True when the run has something to proceed on and needs no follow-up question. */
  decided: boolean;
  /** The operator's own sentence, trimmed, when {@link decided} is true. */
  instruction?: string;
  why: string;
}

/**
 * Read one open-field answer. Never throws, never asks anything back — the
 * point of the field is that the run does not stop again once it has this.
 */
export function resolveFreeTextAnswer(raw: string): FreeTextAnswer {
  const text = raw.trim();
  if (text.length === 0) {
    return { decided: false, why: "the field was empty — nothing to proceed on" };
  }
  if (NO_CONTENT_MARKERS.some((m) => m.test(text))) {
    return { decided: false, why: "the field carried only Claude Code's own filler, not the operator's words" };
  }
  return {
    decided: true,
    instruction: text,
    why: "a written sentence is the decision itself; it needs no match against the offered options",
  };
}
