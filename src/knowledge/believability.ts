/**
 * The believability ladder — how much weight a claim has earned.
 *
 * A note the founder wrote at midnight and a customer renewing look identical
 * once they are files in a vault. This module gives every node a visible rung so
 * a reader can see which parts of the map are load-bearing and which are one
 * person's theory. The ordering is fixed and deliberately short: money and
 * retention above observed behavior, observed behavior above what people say,
 * what people say above expert opinion, and everything above bare assertion.
 *
 * Two rules keep it honest:
 * - a conclusion is only as believable as its weakest input ({@link weakestRung});
 * - anything unrecognised falls to the floor ({@link classifyProvenance}), because
 *   an unearned rung is worse than an obviously unproven one.
 *
 * This module holds the ladder and nothing about who earned what: standing is computed
 * from an actor's recorded history in `knowledge/actor-trust.ts`, which imports the
 * ladder and the "weaker of two" rule from here so there is exactly one of each.
 */

export interface Rung {
  id: string;
  label: string;
  definition: string;
}

export const BELIEVABILITY_LADDER = [
  {
    id: "money",
    label: "Money or retention",
    definition: "Someone paid, renewed, or kept using it — behavior with a cost attached.",
  },
  {
    id: "observed",
    label: "Observed behavior",
    definition: "What someone actually did, recorded as it happened rather than recalled afterwards.",
  },
  {
    id: "stated",
    label: "Stated intent or report",
    definition: "What someone said they need, did, or hit — a first-person account, not a measurement.",
  },
  {
    id: "expert",
    label: "Expert opinion",
    definition: "Judgement from someone with relevant experience, but not about their own behavior.",
  },
  {
    id: "assertion",
    label: "Founder or model assertion",
    definition: "A claim from inside the building — founder theory, or a model agreeing with it.",
  },
] as const satisfies readonly Rung[];

export type RungId = (typeof BELIEVABILITY_LADDER)[number]["id"];

/** The floor. Anything we cannot justify placing higher lands here. */
export const FLOOR_RUNG: RungId = "assertion";

const RANK = new Map<string, number>(BELIEVABILITY_LADDER.map((r, i) => [r.id, i]));

export function isRung(id: string): id is RungId {
  return RANK.has(id);
}

/** 0 is the strongest rung; larger is weaker. Unknown ids rank at the floor. */
export function rungRank(id: string): number {
  return RANK.get(id) ?? BELIEVABILITY_LADDER.length - 1;
}

/** A conclusion is only as believable as its weakest input. */
export function weakestRung(rungs: readonly string[]): RungId {
  let worst: RungId = BELIEVABILITY_LADDER[0].id;
  if (rungs.length === 0) return FLOOR_RUNG;
  for (const r of rungs) {
    const id = isRung(r) ? r : FLOOR_RUNG;
    if (rungRank(id) > rungRank(worst)) worst = id;
  }
  return worst;
}

/** The ladder, rendered for a system prompt: what the rungs are and how to pick one. */
export function believabilityBrief(): string {
  return [
    "Believability ladder (strongest first) — every node you create declares one:",
    ...BELIEVABILITY_LADDER.map((r) => `- ${r.id} (${r.label}): ${r.definition}`),
    "Pick the WEAKEST rung that honestly covers the node's sources: a conclusion is only as believable as its weakest input.",
    "'assertion' is the floor and always available — use it when a node rests on founder theory or on your own inference. Never claim a rung the sources have not earned.",
  ].join("\n");
}

export interface BelievabilityRollup {
  /** How many nodes sit on each rung. */
  counts: Record<RungId, number>;
  /** Nodes that declare no rung at all. */
  unlabelled: number;
  /** The weakest rung present — what the tree as a whole rests on. */
  weakest: RungId;
}

/** Summarize what a tree rests on: per-rung counts, unlabelled nodes, weakest rung. */
export function believabilityRollup(nodes: readonly { evidence?: string }[]): BelievabilityRollup {
  const counts = Object.fromEntries(BELIEVABILITY_LADDER.map((r) => [r.id, 0])) as Record<RungId, number>;
  let unlabelled = 0;
  const present: RungId[] = [];
  for (const n of nodes) {
    if (n.evidence && isRung(n.evidence)) {
      counts[n.evidence]++;
      present.push(n.evidence);
    } else {
      unlabelled++;
    }
  }
  return { counts, unlabelled, weakest: weakestRung(present) };
}

/**
 * Best-effort rung for an evidence item's provenance tag, WITHOUT a vault in hand.
 * Fail-closed: only provenance we can justify lands above the floor.
 *
 * A harvested session is observed behavior — it is a recording of what happened.
 * A friction note the agent filed about itself is a first-person report, so it
 * sits at 'stated' alongside tickets and interview notes, not at 'observed'.
 *
 * **`WEB:<host>` always lands on the floor here, and the missing parameter is the
 * point.** This used to take a `hostTrust` map and hand back whatever rung it held —
 * the last place in the repo where a rung was READ from storage rather than derived
 * from a history (B5b). Earned standing now comes from the actor ledger
 * (`knowledge/actor-trust.ts`: `sourceStanding`, which folds an actor's whole record
 * and clamps it to that kind's ceiling), and this function deliberately cannot reach
 * it: it has no vault directory, and giving it one would recreate the stored-value
 * read in a second spelling. Callers that hold a directory should prefer
 * `sourceStanding`; this is the honest answer available to callers that do not.
 */
export function classifyProvenance(source: string): RungId {
  const s = source.trim();
  if (!s) return FLOOR_RUNG;
  if (/^TRANSCRIPT:/i.test(s)) return "observed";
  // Keyed on the CHANNEL SEGMENT, not on the filename (B12). This rule used to read
  // `/^INBOX:.*friction/i` — it matched the word anywhere in the id, and the id is
  // `INBOX:${filename}` verbatim, so the one provenance rule that rose above the floor
  // on the untrusted builder's only channel read a string the builder chose:
  // `my-notes-on-friction.md` dropped into channel zero classified as a first-person
  // report. `INBOX:friction/` is minted by `channelIdPrefix(FRICTION_CHANNEL)` from the
  // channel's own name, `friction` is a RESERVED_CHANNEL_NAME so config cannot mint a
  // second one, a filename cannot contain `/` so channel zero can never carry the
  // segment, and the friction folder is `.ost-agent/friction` INSIDE the vault, which
  // the builder does not write. The rule is the same rule; its key is now unforgeable.
  //
  // The cost, stated rather than hidden: a filing made BEFORE the friction channel
  // existed lives in channel zero as `INBOX:<date>-friction-<slug>.md` and now reads
  // `assertion`. That is the honest answer — such an id is byte-for-byte something the
  // builder could have written — and the floor is where a source with no established
  // producer belongs.
  if (/^INBOX:friction\//i.test(s)) return "stated";
  if (/^(JIRA|CONFLUENCE|SLACK|INTERVIEW):/i.test(s)) return "stated";
  return FLOOR_RUNG;
}
