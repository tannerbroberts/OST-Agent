/**
 * The check ruleset, versioned — so a tightening published today does not
 * retroactively fail a tree that has not adopted it.
 *
 * **The failure this exists for.** `checkInvariants` is what CI, the loop and
 * `done` gate on, and it has been tightened eleven times in forty days. Every
 * one of those tightenings applied instantly and to everything: the
 * `evidence-class` rule landed on 2026-07-24 and flagged all 57 then-existing
 * nodes at once, none of which had been out of compliance the day before. The
 * work was finished; the standard moved underneath it, and the tree carried no
 * record of which standard it had been finished under.
 *
 * A vault now declares the ruleset version it is on ({@link
 * ../ost/declared-ruleset.ts}) and `checkInvariants` evaluates against that
 * version. Adopting a newer one is an explicit act — the operator moves the
 * declaration, sees exactly what newly fails, and does that work when they
 * choose to.
 *
 * **What this file is, structurally.** The version history below is the real
 * history of `src/eval/invariants.ts` and the three modules it delegates
 * verdicts to (`ost/lanes.ts`, `eval/rungs.ts`, `ost/prerequisites.ts`), read
 * out of git rather than remembered: every entry names the commit it was taken
 * from, so a reader can check it with `git show`. A boundary is recorded when
 * the set of nodes that FAIL moved. A commit that changed a violation's wording,
 * or refactored a detector without changing its verdict, is recorded in
 * {@link VERDICT_PRESERVING_COMMITS} instead — it is not a ruleset version,
 * because nothing came out of compliance across it.
 *
 * **The cost this design is betting on, stated so it can be measured.** The
 * objection to versioned rules is that they multiply: every rule has to keep
 * working under every version anyone is still on, and the checking code
 * accumulates conditionals for standards nobody has used in months. The bet here
 * is that the accumulation is driven by IN-PLACE changes and not by the churn:
 *
 *   - A rule ADDED or REMOVED in a version costs no conditional of its own. The
 *     lineage below says when it was live and one shared filter applies that to
 *     every rule at once. Ten of the twelve recorded boundaries are this shape.
 *   - A rule whose VERDICT changed while keeping its id is the expensive shape:
 *     the checking code has to branch. Each one is a {@link CheckBehaviourFlag},
 *     and there are two in the whole recorded history.
 *
 * So the standing cost is three conditionals — two flags and the shared lineage
 * filter — and it covers all twelve versions rather than the two that are live.
 * `test/knowledge/versioned-rule-cost.test.ts` is the instrument that measures
 * that claim rather than taking it, including the part that could be a lie: it
 * proves by execution that every rule declaring no flag really does return the
 * same verdicts under both live versions.
 *
 * **What this does NOT settle.** Whether an operator whose tree is stranded out
 * of compliance would rather be grandfathered than migrated. Two vaults reporting
 * clean under different declared versions are not held to the same standard, and
 * this file makes that visible rather than making it not true. Which of the two
 * an operator wants is a preference about their own work, and no exit code
 * confers it.
 */

/**
 * A rule whose verdict changed in place, and the flag the checking code branches
 * on to reproduce both meanings.
 *
 * Kept as an explicit named union rather than a `string` so that adding a
 * behavioural change means adding a member here — the count this file's whole
 * argument rests on cannot grow by accident.
 */
export type CheckBehaviourFlag = "assumption-layer" | "quarantine-tolerance";

/** One boundary at which the set of nodes that fail `checkInvariants` moved. */
export interface CheckRulesetVersion {
  /** Date-shaped, with a letter when a day carried more than one boundary. Ordering is array order, never string compare. */
  id: string;
  /** The commit this boundary was read out of — `git show <sha>` is the check. */
  commit: string;
  /** What moved, in the words of the change that moved it. */
  summary: string;
  /** Rule ids that began to fire at this version. */
  adds: readonly string[];
  /** Rule ids that stopped firing at this version. */
  removes: readonly string[];
  /**
   * Behaviour that changed in place at this version: the rules whose verdict
   * moved while keeping their id, and the flag the checking code reads.
   * This is the shape that costs a conditional.
   */
  changes: readonly { flag: CheckBehaviourFlag; rules: readonly string[] }[];
}

/**
 * Every version of the check ruleset, oldest first.
 *
 * Read out of `git log -- src/eval/invariants.ts` on 2026-09-02, plus the three
 * modules `checkInvariants` delegates verdicts to. The span is 2026-07-22 →
 * 2026-08-31, which is what {@link RECORDED_SPAN_DAYS} states and what the
 * extrapolation divides by.
 */
export const CHECK_RULESET_VERSIONS: readonly CheckRulesetVersion[] = [
  {
    id: "2026-07-22a",
    commit: "192dc33",
    summary: "the first structural invariants — the deterministic floor beneath the faithfulness judge",
    adds: [
      "single-outcome",
      "outcome-identity",
      "dangling-link",
      "opportunity-connected",
      "solution-mapped",
      "assumption-mapped",
      "no-self-validation",
    ],
    removes: [],
    changes: [],
  },
  {
    id: "2026-07-22b",
    commit: "d633ac2",
    summary: "the outcome became a tunable steering knob, so its identity stopped being an invariant",
    adds: [],
    removes: ["outcome-identity"],
    changes: [],
  },
  {
    id: "2026-07-24",
    commit: "47066d5",
    summary: "every node declares the rung it rests on",
    adds: ["evidence-class"],
    removes: [],
    changes: [],
  },
  {
    id: "2026-07-26a",
    commit: "1790775",
    summary: "refuse a wikilink a wrapped paragraph broke in two",
    adds: ["wrapped-wikilink"],
    removes: [],
    changes: [],
  },
  {
    id: "2026-07-26b",
    commit: "d1442c3",
    summary: "a lane declared twice is a check failure",
    adds: ["lane-conflict"],
    removes: [],
    changes: [],
  },
  {
    id: "2026-07-29",
    commit: "102b90d",
    summary: "a declared measurement rung is a claim the tree checks, not a word the agent picks",
    adds: ["rung-unearned"],
    removes: [],
    changes: [],
  },
  {
    id: "2026-08-04",
    commit: "6a4f32f",
    summary: "the bucket layer became structural — the Outcome files categories, never work",
    adds: ["outcome-files-categories"],
    removes: [],
    changes: [],
  },
  {
    id: "2026-08-05a",
    commit: "3078441",
    summary:
      "the Assumption layer landed: `assumption-mapped` stopped meaning an orphan AssumptionTest and started " +
      "meaning an orphan Assumption, and the orphan test it used to name became `test-mapped`",
    adds: ["test-mapped"],
    removes: [],
    // The one boundary where a rule id survived with a different meaning. A
    // lineage entry cannot express it — the id is live on both sides — so the
    // checking code branches.
    changes: [{ flag: "assumption-layer", rules: ["assumption-mapped"] }],
  },
  {
    id: "2026-08-05b",
    commit: "6953276",
    summary: "the tree is a tree, not a graph",
    adds: ["single-parent"],
    removes: [],
    changes: [],
  },
  {
    id: "2026-08-05c",
    commit: "8504ddf",
    summary: "a title is wikilinked once, by its parent",
    adds: ["single-backlink"],
    removes: [],
    changes: [],
  },
  {
    id: "2026-08-30",
    commit: "5b880bf",
    summary: "prerequisite edges between assumption tests",
    adds: ["prerequisite-unknown", "prerequisite-cycle"],
    removes: [],
    changes: [],
  },
  {
    id: "2026-08-31",
    commit: "ace390c",
    summary:
      "a node whose `type:` nobody recognises is quarantined instead of dropped, so five rules stopped " +
      "reporting the symptoms of one unreadable file",
    adds: [],
    removes: [],
    // Five rules, ONE conditional. The change was already written as a parameter
    // with a default of `[]` — "so every caller that has no census behaves
    // exactly as it did" — so reproducing the older verdicts is a decision about
    // what to pass, taken once, rather than a branch inside each rule. This is
    // the single most load-bearing observation in the cost measurement, and it
    // was true by accident: the parameter was added for callers, not for versions.
    changes: [
      {
        flag: "quarantine-tolerance",
        rules: ["dangling-link", "opportunity-connected", "solution-mapped", "assumption-mapped", "test-mapped"],
      },
    ],
  },
] as const;

/**
 * Commits that touched the checking code without moving any verdict, kept so the
 * extrapolation's denominator is honest.
 *
 * Six of the eighteen commits over the recorded span are these. They matter
 * because the naive way to estimate "how often do the rules tighten" is to count
 * commits, and that would have put the year's conditional cost at 100 rather
 * than 18 — the rate that decides the answer is the rate of VERDICT changes, and
 * a third of the traffic here is not that.
 */
export const VERDICT_PRESERVING_COMMITS: readonly { commit: string; date: string; why: string }[] = [
  { commit: "c24493a", date: "2026-07-22", why: "hard-baked connectivity and typing; the rule set was untouched" },
  { commit: "15012dc", date: "2026-07-29", why: "made the two health gates compute one rule set; no rule changed" },
  { commit: "5241ffe", date: "2026-07-30", why: "`unearnedRungs` split per-node so the write boundary shares it — same logic, same verdicts" },
  { commit: "d00b020", date: "2026-08-06", why: "the `parentsOf` index shared across four rules; a pure performance change" },
  { commit: "998b781", date: "2026-08-19", why: "`lane-conflict` quotes the whole sentence beside the fragment — the message moved, the verdict did not" },
  { commit: "985713d", date: "2026-08-31", why: "threshold counting in `lanes.ts`; `laneConflicts` itself is byte-identical across it" },
];

/** The oldest and newest recorded versions, and the span the extrapolation divides by. */
export const RECORDED_SPAN = { from: "2026-07-22", to: "2026-08-31" } as const;

/** Elapsed days between {@link RECORDED_SPAN}'s ends. Stated rather than computed from a clock — a test that reads today's date measures the calendar. */
export const RECORDED_SPAN_DAYS = 40;

/** The newest version — what a vault gets when it has never declared one. */
export const LATEST_CHECK_RULESET = CHECK_RULESET_VERSIONS[CHECK_RULESET_VERSIONS.length - 1].id;

/** Where a version sits in the sequence, or -1 for an id nothing here recorded. */
export function checkRulesetOrdinal(id: string): number {
  return CHECK_RULESET_VERSIONS.findIndex((v) => v.id === id);
}

/** The recorded version with this id, or null. */
export function checkRulesetVersion(id: string): CheckRulesetVersion | null {
  return CHECK_RULESET_VERSIONS.find((v) => v.id === id) ?? null;
}

/**
 * Every rule live at `id`, replayed from the lineage.
 *
 * Replayed rather than stored per version, so the two cannot drift: the adds and
 * removes above are the single statement of when a rule was live, and this is
 * the only thing that reads them.
 */
export function rulesLiveIn(id: string): Set<string> {
  const upTo = checkRulesetOrdinal(id);
  const live = new Set<string>();
  // An unrecognised id is treated as the latest rather than as an empty rule
  // set: a declaration nobody can resolve must not be a way to check nothing.
  // `resolveDeclaredRuleset` refuses it before it reaches here; this is the
  // second door, and it fails toward the standard rather than away from it.
  const end = upTo === -1 ? CHECK_RULESET_VERSIONS.length - 1 : upTo;
  for (let i = 0; i <= end; i++) {
    for (const rule of CHECK_RULESET_VERSIONS[i].adds) live.add(rule);
    for (const rule of CHECK_RULESET_VERSIONS[i].removes) live.delete(rule);
  }
  return live;
}

/** Was `flag`'s newer behaviour in force at `id`? */
export function behaviourLiveIn(flag: CheckBehaviourFlag, id: string): boolean {
  const at = CHECK_RULESET_VERSIONS.findIndex((v) => v.changes.some((c) => c.flag === flag));
  if (at === -1) return true; // a flag nothing records is not a version boundary
  const upTo = checkRulesetOrdinal(id);
  return upTo === -1 ? true : upTo >= at;
}

/** What supporting two (or more) live versions costs the checking code. */
export interface VersionCost {
  /** The versions this cost covers, oldest first. */
  versions: readonly string[];
  /** Flags whose value differs across them — one conditional each. */
  flags: readonly CheckBehaviourFlag[];
  /**
   * Rules that are live in some of these versions and not others. They cost NO
   * conditional — the shared lineage filter covers all of them — and are
   * reported because "how many rules are affected" and "how many conditionals it
   * takes" are the two numbers this measurement exists to keep apart.
   */
  rulesGatedByLineage: readonly string[];
  /** Rules whose verdict differs across these versions, per flag. Also not a per-rule cost. */
  rulesChanged: readonly string[];
  /** `flags.length` plus one for the shared lineage filter — the number the node's bar is set against. */
  conditionals: number;
}

/**
 * The conditional cost of holding `ids` live at once.
 *
 * One conditional per differing behavioural flag, plus one for the shared
 * lineage filter. The filter is counted even when no rule differs, because it is
 * written and maintained whether or not any given pair of versions exercises it
 * — counting it only when it fires would be the optimistic reading of the number
 * this whole measurement exists to be pessimistic about.
 */
export function versionCost(ids: readonly string[]): VersionCost {
  const ordered = [...ids].sort((a, b) => checkRulesetOrdinal(a) - checkRulesetOrdinal(b));
  const flags: CheckBehaviourFlag[] = [];
  const rulesChanged = new Set<string>();
  for (const version of CHECK_RULESET_VERSIONS) {
    for (const change of version.changes) {
      const values = new Set(ordered.map((id) => behaviourLiveIn(change.flag, id)));
      if (values.size > 1) {
        flags.push(change.flag);
        for (const rule of change.rules) rulesChanged.add(rule);
      }
    }
  }

  const perVersion = ordered.map((id) => rulesLiveIn(id));
  const everLive = new Set<string>();
  for (const set of perVersion) for (const rule of set) everLive.add(rule);
  const gated = [...everLive].filter((rule) => perVersion.some((set) => !set.has(rule))).sort();

  return {
    versions: ordered,
    flags,
    rulesGatedByLineage: gated,
    rulesChanged: [...rulesChanged].sort(),
    conditionals: flags.length + 1,
  };
}

/** What a year of tightenings at the observed rate would cost. */
export interface YearProjection {
  /** Behavioural flags recorded over {@link RECORDED_SPAN_DAYS}. */
  flagsObserved: number;
  /** Ruleset boundaries recorded over the same span, of every shape, not counting the baseline. */
  boundariesObserved: number;
  /** `flagsObserved` scaled to 365 days. */
  flagsPerYear: number;
  /** `flagsPerYear` plus the shared lineage filter — conditionals standing after a year in which nothing is ever retired. */
  conditionals: number;
}

/**
 * A year of tightenings at the rate the recorded span actually shows, assuming
 * NOTHING is ever retired.
 *
 * That assumption is the pessimistic one and it is deliberate. Under the design
 * this file implements only two versions need be live at once, so adopting a new
 * one retires the branch behind the old — the standing cost stays at
 * {@link versionCost}'s two or three and does not grow with time at all. This
 * number is the other end: what the code would carry if every branch ever
 * written were kept. It is the number the node's bar is set against, because
 * "stays maintainable" is a claim about the bad case.
 */
export function yearProjection(): YearProjection {
  const flagsObserved = CHECK_RULESET_VERSIONS.reduce((n, v) => n + v.changes.length, 0);
  const flagsPerYear = (flagsObserved * 365) / RECORDED_SPAN_DAYS;
  return {
    flagsObserved,
    boundariesObserved: CHECK_RULESET_VERSIONS.length - 1,
    flagsPerYear,
    conditionals: flagsPerYear + 1,
  };
}
