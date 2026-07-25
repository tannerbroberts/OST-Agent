/**
 * Assumption-test lanes — how many human minutes a test actually costs.
 *
 * A backlog of assumption tests is not one queue. Some are replays and audits
 * over artifacts already sitting in the repo; some need a person for one
 * keystroke; some are blocked on a credential nobody delegated; and some need
 * real outside people and can never be anything else. Treated as one queue they
 * all wait on the scarcest resource in the list, which is the operator, and the
 * cheap ones never get run.
 *
 * Labelling each test with its lane lets an unattended pass run the lane that
 * costs nobody anything, and lets the rest be presented to a person already
 * sorted by what they are actually waiting on.
 *
 * The safety rule is the whole design: **exactly one lane is runnable by
 * compute, and anything unrecognised is not it.** A test mislabelled as
 * `compute-only` and then run by an agent would put fabricated evidence into the
 * tree, which is the one failure this product cannot survive. So the vocabulary
 * fails closed — the same rule the believability ladder uses for its floor.
 */

export interface LaneDef {
  id: string;
  label: string;
  definition: string;
  /** May an unattended pass run this test itself? True for exactly one lane. */
  computeMayRun: boolean;
}

export const LANES = [
  {
    id: "compute-only",
    label: "Compute only",
    definition:
      "Runs entirely over artifacts that already exist — replays, audits, paper-classifications of recorded history. No outside person, and nothing to fabricate because the inputs are already on disk.",
    computeMayRun: true,
  },
  {
    id: "one-command",
    label: "One command",
    definition:
      "Compute can prepare the entire verdict; the human's whole role is reading a paragraph and running one pre-filled `ost-agent result` line. The judgement is theirs, the work is not.",
    computeMayRun: false,
  },
  {
    id: "pending-permission",
    label: "Pending permission",
    definition:
      "The work is finished and what is missing is a credential or a consent — publishing, granting access, speaking in someone's name. Not a decision with evidence behind it, so it must not be filed as one.",
    computeMayRun: false,
  },
  {
    id: "humans-required",
    label: "Humans required",
    definition:
      "Real people outside the building are irreducibly in the loop — interviews, recruiting, offers, anything where a person's reaction is the measurement.",
    computeMayRun: false,
  },
] as const satisfies readonly LaneDef[];

export type LaneId = (typeof LANES)[number]["id"];

/**
 * Where an unclassified or unrecognised test belongs. Suggestion machinery may
 * only ever point here: erring toward a person costs time, erring the other way
 * costs the tree its credibility.
 */
export const CAUTIOUS_LANE: LaneId = "humans-required";

const BY_ID = new Map<string, LaneDef>(LANES.map((l) => [l.id, l]));

export function isLane(id: string): id is LaneId {
  return BY_ID.has(id);
}

export function laneDef(id: LaneId): LaneDef {
  return BY_ID.get(id)!;
}

/**
 * May an unattended pass run a test in this lane? Fails closed: an unknown lane,
 * a missing lane, or a lane invented by a future version all answer `false`.
 */
export function computeMayRun(id: string | undefined): boolean {
  if (!id) return false;
  return BY_ID.get(id)?.computeMayRun === true;
}
