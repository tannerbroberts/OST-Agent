/**
 * Reversibility classes — how expensive it is to undo an action, not how risky
 * it looks.
 *
 * DEC-3 admits a managed, fallible sponsor into the picture, and with it real
 * money and real legal entities. Today nothing in this repository distinguishes
 * "append a note" from "wire funds" — every safety property here is currently
 * carried by the fact that no irreversible verb exists on the tool surface at
 * all, which is exactly the property DEC-3 removes. An action needs a declared
 * class before it can be reasoned about.
 *
 * The safety rule is the same one `lanes.ts` and the believability ladder both
 * use: **the vocabulary fails closed.** An action whose class is missing or
 * unrecognised is treated as the least forgiving one, `irreversible` — guessing
 * reversible for something that turns out not to be is the one mistake this
 * product cannot survive; guessing irreversible for something that was actually
 * cheap to undo only costs a moment of caution.
 */

export interface ReversibilityDef {
  id: string;
  label: string;
  definition: string;
}

export const REVERSIBILITY = [
  {
    id: "reversible",
    label: "Reversible",
    definition:
      "Torres's two-way door: undoing it costs about what doing it cost. Appending a note, filing a draft, annotating a node — mistakes here are a correction away from gone.",
  },
  {
    id: "costly",
    label: "Costly to reverse",
    definition:
      "Technically undoable, but not cheaply — real time, money, or standing spent that undoing it does not fully recover. A published draft someone already read; a credential rotated under time pressure.",
  },
  {
    id: "irreversible",
    label: "Irreversible",
    definition:
      "Torres's one-way door: money sent, a message spoken in someone's name, consent granted, a person contacted. Nothing on this side of the line can be taken back, only apologised for.",
  },
] as const satisfies readonly ReversibilityDef[];

export type ReversibilityId = (typeof REVERSIBILITY)[number]["id"];

/**
 * Where an unclassified or unrecognised action belongs. Suggestion machinery
 * may only ever point here: erring toward caution costs a confirmation, erring
 * the other way costs the thing the confirmation was for.
 */
export const CAUTIOUS_REVERSIBILITY: ReversibilityId = "irreversible";

const BY_ID = new Map<string, ReversibilityDef>(REVERSIBILITY.map((r) => [r.id, r]));

export function isReversibility(id: string): id is ReversibilityId {
  return BY_ID.has(id);
}

export function reversibilityDef(id: ReversibilityId): ReversibilityDef {
  return BY_ID.get(id)!;
}

/**
 * The reversibility class of an action. Fails closed: a missing class, an
 * empty string, or a class invented by a future version all answer
 * `irreversible` rather than the more permissive `reversible`.
 */
export function reversibilityOf(id: string | undefined): ReversibilityId {
  if (!id) return CAUTIOUS_REVERSIBILITY;
  return isReversibility(id) ? id : CAUTIOUS_REVERSIBILITY;
}
