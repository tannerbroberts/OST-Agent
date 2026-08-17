/**
 * Cheapest-disconfirmer-first ordering — the mechanism for the tree node
 * "Cheapest-disconfirmer first — rank tests by how fast they could kill the
 * idea": order a test queue not by importance but by expected time-to-kill,
 * running first whatever could eliminate the most candidates for the least
 * effort. Optimises for shrinking the consideration set quickly rather than
 * for building confidence in a favourite — a deliberate inversion of the
 * usual instinct to test the most promising idea first.
 *
 * **What this cannot do, and the node says so itself.** Nothing here can
 * honestly estimate how many candidates a test would eliminate, or how much
 * effort it costs, from nothing — that is a person's judgement about the
 * world. Both numbers are supplied by the caller; this module's whole job is
 * sorting on the ratio instead of on importance. A candidate whose test comes
 * back disconfirming eliminates itself at minimum, so `eliminates` is always
 * at least 1 for a candidate worth queuing at all — the value only grows past
 * 1 when killing it would also kill others resting on the same assumption.
 */

export interface DisconfirmerCandidate {
  /** The test (or the candidate it would kill), as it appears in the queue. */
  title: string;
  /** Supplied estimate: how many candidates a disconfirming result would eliminate. */
  eliminates: number;
  /** Supplied estimate: effort to run the test, in one unit shared across the queue. */
  effort: number;
  /** The score the naive queue sorts on — kept so a fixture can show the two orders disagree. */
  importance: number;
}

function requirePositiveEffort(candidates: readonly DisconfirmerCandidate[]): void {
  for (const c of candidates) {
    if (!(c.effort > 0)) {
      throw new Error(
        `"${c.title}" has non-positive effort (${c.effort}) — candidates-eliminated-per-effort is undefined for it`,
      );
    }
  }
}

/** The order this solution exists to invert: highest importance first. */
export function orderByImportance(candidates: readonly DisconfirmerCandidate[]): string[] {
  return [...candidates]
    .sort((a, b) => b.importance - a.importance || a.title.localeCompare(b.title))
    .map((c) => c.title);
}

/**
 * The inversion this node is built on: highest eliminates-per-effort first,
 * ties broken by title so the order is deterministic rather than input-order
 * dependent. Throws on non-positive effort rather than dividing by zero — a
 * supplied estimate that claims free elimination is a bad estimate, not an
 * infinite priority.
 */
export function orderByDisconfirmer(candidates: readonly DisconfirmerCandidate[]): string[] {
  requirePositiveEffort(candidates);
  return [...candidates]
    .sort((a, b) => b.eliminates / b.effort - a.eliminates / a.effort || a.title.localeCompare(b.title))
    .map((c) => c.title);
}
