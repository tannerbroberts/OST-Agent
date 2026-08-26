/**
 * When each structural rule came into force — the half of a tightening that
 * lets a check tell a tree that is *wrong* from a tree that is *old*.
 *
 * **The problem this answers.** A new invariant in `checkInvariants` applies to
 * the whole tree the instant it lands, including nodes written and finished
 * under the old rules. The evidence-class rule flagged all 57 then-existing
 * meta-vault nodes; `single-backlink` flagged 920. Work that was done reopens,
 * the gate goes red on the day the rule is most likely to be abandoned as
 * unusable, and the burden falls on whoever next runs `check`. Nothing anywhere
 * recorded which rules a node was built under, so nothing could tell the two
 * populations apart.
 *
 * This registry records, per rule, the day it began to bind. A violation by a
 * node created before that day is not a violation — it is a node that
 * {@link Standing | predates} the rule, reported in its own class.
 *
 * **Forward-only, with a bound.** Grandfathering with no expiry is how a
 * codebase ends up with three generations of conventions all live, which is the
 * stated way this design goes wrong. So the exemption is a grace period, not an
 * amnesty: {@link CLEARANCE_WINDOW_DAYS} after a rule lands, the predating
 * nodes it flagged bind like anything else. The window is the same number the
 * assumption test underneath this measures history against — "at least 60% of
 * the would-be-grandfathered nodes were brought into compliance within a month"
 * — so the design parameter and the thing that judges it are one constant.
 *
 * **Dates, and the one place this is weaker than it reads.** A rule's date is
 * the day its commit landed on `main`; a node's is its `created` frontmatter,
 * which is date-only. A rule that landed at 16:52 and a node stamped the same
 * day cannot be ordered, so the comparison is *strictly before* — a node
 * created on the day of a tightening is bound by it. That errs toward the rule
 * rather than toward the exemption, and a node with no `created` at all errs the
 * same way: it is **bound**, because an undated node is the one least able to
 * show it predates anything and a missing field must never be able to turn a red
 * gate green. Their number is reported separately by
 * `countUndatedOffenders` so the class stays visible without being exempt.
 *
 * **A rule with no entry here binds everything**, which is the fail-closed
 * direction: forgetting to register a tightening loses the exemption, never the
 * check. `test/ost/grandfathered-backlog-replay.test.ts` holds every rule
 * literal in `invariants.ts` to having an entry, so forgetting is loud.
 */

/** One rule, and the moment it began to bind. */
export interface RuleInception {
  /** The `Violation.rule` literal in `src/eval/invariants.ts`. */
  readonly rule: string;
  /**
   * ISO date (YYYY-MM-DD) the rule began to bind. Compared against a node's
   * `created` with `<`, so a node stamped this day is bound — see the module
   * comment for why the tie goes to the rule.
   */
  readonly inForceFrom: string;
  /** The commit on `main` that landed it — how a reader re-derives the date. */
  readonly commit: string;
  /** What tightened, in the words a reader needs to judge the exemption. */
  readonly note: string;
}

/**
 * How long a node gets to be old before it is simply wrong.
 *
 * Thirty days because that is the window the assumption test beneath this
 * solution measures clearance over. Changing it changes what the replay judges,
 * which is deliberate: the two must not be able to drift.
 */
export const CLEARANCE_WINDOW_DAYS = 30;

/**
 * Every structural rule, oldest first, with the commit that landed it.
 *
 * The six dated 2026-07-22 are the founding set — they predate every node in
 * every vault, so nothing is ever grandfathered under them and the entries exist
 * to make that a recorded fact rather than an absence.
 */
export const RULE_INCEPTIONS: readonly RuleInception[] = [
  {
    rule: "single-outcome",
    inForceFrom: "2026-07-22",
    commit: "192dc33",
    note: "founding set — exactly one root Outcome",
  },
  {
    rule: "dangling-link",
    inForceFrom: "2026-07-22",
    commit: "192dc33",
    note: "founding set — every [[link]] resolves to a node",
  },
  {
    rule: "opportunity-connected",
    inForceFrom: "2026-07-22",
    commit: "192dc33",
    note: "founding set — every Opportunity is reachable from the Outcome",
  },
  {
    rule: "solution-mapped",
    inForceFrom: "2026-07-22",
    commit: "192dc33",
    note: "founding set — every Solution sits under an Opportunity",
  },
  {
    rule: "assumption-mapped",
    inForceFrom: "2026-07-22",
    commit: "192dc33",
    note: "founding set — every Assumption sits under a Solution",
  },
  {
    rule: "no-self-validation",
    inForceFrom: "2026-07-22",
    commit: "192dc33",
    note: "founding set — an #unvalidated node may not also claim status: validated",
  },
  {
    rule: "evidence-class",
    inForceFrom: "2026-07-24",
    commit: "47066d5",
    note: "every node declares the rung it rests on — flagged all 57 then-existing meta-vault nodes with no remediation path, which is the friction that produced this whole branch",
  },
  {
    rule: "wrapped-wikilink",
    inForceFrom: "2026-07-26",
    commit: "1790775",
    note: "a wikilink a wrapped paragraph broke in two is an edge the author wrote that the graph does not have",
  },
  {
    rule: "lane-conflict",
    inForceFrom: "2026-07-26",
    commit: "d1442c3",
    note: "a test may not answer 'may an unattended pass run this?' twice, differently",
  },
  {
    rule: "rung-unearned",
    inForceFrom: "2026-07-29",
    commit: "102b90d",
    note: "a declared measurement rung must point at a measurement — deliberately kept a detector so nodes predating the write guard land here",
  },
  {
    rule: "outcome-files-categories",
    inForceFrom: "2026-08-04",
    commit: "6a4f32f",
    note: "the bucket layer became structural — only category Opportunities attach to the Outcome",
  },
  {
    rule: "test-mapped",
    inForceFrom: "2026-08-05",
    commit: "3078441",
    note: "the Assumption layer landed; an AssumptionTest hangs under an Assumption (a direct Solution edge is the bounded legacy read, see LEGACY_TEST_EDGE)",
  },
  {
    rule: "single-parent",
    inForceFrom: "2026-08-05",
    commit: "6953276",
    note: "the tree is a tree, not a graph — the meta vault held three solutions under two opportunities each",
  },
  {
    rule: "single-backlink",
    inForceFrom: "2026-08-05",
    commit: "8504ddf",
    note: "a title is wikilinked exactly once, by its parent — 2,214 prose links across 920 meta-vault nodes",
  },
];

/** By rule id, built once. */
const BY_RULE = new Map(RULE_INCEPTIONS.map((r) => [r.rule, r]));

/** What is recorded about when `rule` began to bind, or `undefined` if nothing is. */
export function ruleInception(rule: string): RuleInception | undefined {
  return BY_RULE.get(rule);
}

/**
 * The `n` most recently landed tightenings, newest first.
 *
 * Ordered by `commit` position in {@link RULE_INCEPTIONS} rather than by date
 * alone, because three of these landed on one afternoon and a date-only sort
 * would put them in an arbitrary order. The array is maintained oldest-first, so
 * the tail is the answer.
 */
export function lastTightenings(n: number): RuleInception[] {
  return RULE_INCEPTIONS.slice(Math.max(0, RULE_INCEPTIONS.length - n)).reverse();
}

/** `date` (YYYY-MM-DD) shifted by `days`, as YYYY-MM-DD. UTC, so no zone can move it. */
export function shiftDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(at.getTime())) throw new Error(`not an ISO date: ${date}`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
