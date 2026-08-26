/**
 * The conflict-mechanicality census: how much of what a human-only merge rule
 * would send to an operator is trivia.
 *
 * The rule under measurement is "No agent resolves a conflict it did not create;
 * the merge is handed back to a human". Its argument is that a merge conflict is
 * two intentions disagreeing and an agent has access to one of them, so a
 * resolution is a guess that *looks* resolved. The objection, written into the
 * solution node itself, is a cost: most conflicts in an append-only Markdown
 * vault may be mechanical, and an operator sent enough trivia stops reading it.
 * This module turns that objection into a number.
 *
 * **The classification is over a conflict hunk, in diff3 form.** Two sides and
 * the base they both came from is the only view in which "did they disagree, or
 * did they each add something the other never touched" is answerable. Two-side
 * conflict markers — the default style — cannot distinguish a rewrite from an
 * insertion, because the text that was there before is not in them.
 *
 * **The verdict is binary on purpose, and the hesitation is recorded beside it.**
 * The assumption test's design says the mechanical/contested line "is drawn by a
 * person who may be more confident than a rule could be. Where they hesitate is
 * worth recording separately, since those are the cases that decide the
 * boundary." So {@link classifyHunk} always answers `mechanical` or `contested`
 * — a census with an `unknown` bucket has not measured the cost of anything —
 * and sets {@link ConflictVerdict.hesitation} on the cases where the rule knows
 * its answer rests on a judgement rather than on the text. The census reports
 * the ratio twice, once with the hesitant conflicts on each side, so a reader
 * sees the error bar instead of a single number that hides it.
 *
 * What this does not settle, stated rather than implied: whether the price is
 * worth paying. That is the operator's call, and the safety argument for the
 * human-only rule does not depend on the count coming out low.
 */

/**
 * The bar, fixed by the assumption test before anything was counted.
 *
 * Verbatim from the `threshold:` field of "Count how many vault conflicts are
 * mechanical, to see what a human-only rule would actually cost": *"At most 5
 * mechanical conflicts per genuinely contested one, and under 3 escalations per
 * week."* Both halves are cost claims about the operator's inbox: the ratio says
 * how much of what arrives is trivia, the rate says how often anything arrives
 * at all.
 */
export const CONFLICT_MECHANICALITY_RULE = {
  /** At most this many mechanical conflicts per genuinely contested one. */
  maxMechanicalPerContested: 5,
  /** Strictly fewer than this many conflicts reach the operator per week. */
  maxEscalationsPerWeek: 3,
  /**
   * Blank lines are ignored when asking whether two insertions overlap. Both
   * sides adding a blank line is not two intentions colliding, and counting it
   * as one would call every paragraph-adjacent insertion contested.
   */
  ignoreBlankLines: true,
  /**
   * Lines are compared with runs of whitespace collapsed. A vault is Markdown
   * written by several writers; a trailing space is not a disagreement.
   */
  normalizeWhitespace: true,
} as const;

/** One conflict hunk, as diff3 presents it: two sides and the base they share. */
export interface ConflictHunk {
  /** Lines from the side the merge was made *into*. */
  ours: string[];
  /**
   * Lines from the common ancestor. Empty for an add/add conflict, where the
   * region did not exist before — see {@link classifyHunk}, which treats an
   * empty base as the one place insertion order is a real choice.
   */
  base: string[];
  /** Lines from the side being merged *in*. */
  theirs: string[];
}

/** Why a hunk landed where it did, in the terms of the merge rather than the code. */
export type MechanicalReason =
  | "both sides wrote the same text"
  | "only one side changed this region"
  | "both sides only added lines, and no line was added twice";

export type ContestedReason =
  | "both sides added the same line, so a union duplicates it and a dedupe picks one writer's copy"
  | "at least one side rewrote or removed text the other side kept";

/** The classification of one hunk, with the judgement it rests on when it rests on one. */
export interface ConflictVerdict {
  verdict: "mechanical" | "contested";
  reason: MechanicalReason | ContestedReason;
  /**
   * Set when the rule's answer turns on a judgement a person might make
   * differently, `null` when the text decides it on its own. Counted and
   * reported separately by {@link conflictMechanicalityCensus}, and never
   * allowed to become a third verdict.
   */
  hesitation: string | null;
}

function normalize(line: string): string {
  return CONFLICT_MECHANICALITY_RULE.normalizeWhitespace ? line.replace(/\s+/g, " ").trim() : line;
}

function sameLines(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((line, i) => normalize(line) === normalize(b[i]));
}

/**
 * True when every line of `base` still appears in `side`, in order.
 *
 * This is the whole test for "that side only added things". A line that was
 * *rewritten* stops being present, so the subsequence fails — which is what
 * separates an append from an edit, and greedy matching finds a subsequence
 * whenever one exists, so the cheap scan is also the exact answer.
 */
function isSubsequence(base: string[], side: string[]): boolean {
  let b = 0;
  for (const line of side) {
    if (b < base.length && normalize(base[b]) === normalize(line)) b++;
  }
  return b === base.length;
}

/**
 * The lines `side` has beyond `base`, as a multiset.
 *
 * Only meaningful when {@link isSubsequence} holds, and then it is well defined
 * regardless of which alignment produced it: the alignment consumes exactly one
 * occurrence of each base line, so what remains is `side` minus `base`, counted.
 */
function addedLines(base: string[], side: string[]): string[] {
  const budget = new Map<string, number>();
  for (const line of base) {
    const key = normalize(line);
    budget.set(key, (budget.get(key) ?? 0) + 1);
  }
  const added: string[] = [];
  for (const line of side) {
    const key = normalize(line);
    const left = budget.get(key) ?? 0;
    if (left > 0) budget.set(key, left - 1);
    else added.push(key);
  }
  return added;
}

function meaningful(lines: string[]): string[] {
  return CONFLICT_MECHANICALITY_RULE.ignoreBlankLines ? lines.filter((l) => normalize(l) !== "") : lines;
}

/**
 * Classify one hunk as mechanically resolvable or genuinely contested.
 *
 * The order of the cases is the argument:
 *
 *  1. **The two sides agree.** Nothing to decide; either side is the resolution.
 *  2. **One side is the base.** Only one writer touched the region, so the other
 *     one's text is the resolution and no intention is being guessed at.
 *  3. **Both sides only added, and added different lines.** This is the case the
 *     objection is about — "two appends to different sections, a link added on
 *     both sides" — and a union preserves both intentions exactly. It is
 *     mechanical, with one hesitation: when the base region is empty, both
 *     insertions land at the same point and their *order* is a choice the rule
 *     makes and neither writer expressed.
 *  4. **Both sides only added, and added a line in common.** Not mechanical: a
 *     union duplicates the shared line and a dedupe silently keeps one writer's
 *     copy and discards the other's, which is a resolution that looks resolved.
 *  5. **Anything else** — a rewrite, a deletion, a move — is two intentions over
 *     the same text, which is exactly what the human-only rule exists for.
 */
export function classifyHunk(hunk: ConflictHunk): ConflictVerdict {
  const { ours, base, theirs } = hunk;

  if (sameLines(ours, theirs)) {
    return { verdict: "mechanical", reason: "both sides wrote the same text", hesitation: null };
  }
  if (sameLines(ours, base) || sameLines(theirs, base)) {
    return { verdict: "mechanical", reason: "only one side changed this region", hesitation: null };
  }

  if (isSubsequence(base, ours) && isSubsequence(base, theirs)) {
    const ourAdds = meaningful(addedLines(base, ours));
    const theirAdds = meaningful(addedLines(base, theirs));
    const theirCounts = new Map<string, number>();
    for (const line of theirAdds) theirCounts.set(line, (theirCounts.get(line) ?? 0) + 1);
    const shared = ourAdds.filter((line) => {
      const left = theirCounts.get(line) ?? 0;
      if (left > 0) {
        theirCounts.set(line, left - 1);
        return true;
      }
      return false;
    });

    if (shared.length > 0) {
      return {
        verdict: "contested",
        reason: "both sides added the same line, so a union duplicates it and a dedupe picks one writer's copy",
        hesitation: `${shared.length} line(s) were added by both sides; a person may read that as one intention written twice`,
      };
    }
    return {
      verdict: "mechanical",
      reason: "both sides only added lines, and no line was added twice",
      hesitation:
        meaningful(base).length === 0
          ? "the base region is empty, so both insertions land at the same point and their order is a choice neither writer made"
          : null,
    };
  }

  return {
    verdict: "contested",
    reason: "at least one side rewrote or removed text the other side kept",
    hesitation: null,
  };
}

/** One conflicted path in one replayed merge, with every hunk git left in it. */
export interface FileConflict {
  /** Which pair of refs was replayed, for tracing a verdict back to the history. */
  merge: string;
  /** Repo-relative path git reported as unmerged. */
  file: string;
  /** ISO date of the later of the two sides, used for the per-week rate. */
  date: string;
  hunks: ConflictHunk[];
}

export interface FileVerdict {
  merge: string;
  file: string;
  date: string;
  verdict: "mechanical" | "contested";
  /** The reason of the hunk that decided the file — the first contested one, or the last mechanical one. */
  reason: MechanicalReason | ContestedReason;
  hunks: number;
  /** Distinct hesitations raised by the hunks of this file, in order. */
  hesitations: string[];
}

/**
 * The verdict for a whole conflicted file: mechanical only when *every* hunk in
 * it is.
 *
 * The unit an operator handles is the file, not the hunk — they open it, read
 * it, and resolve it — so one contested hunk makes the whole file a human's
 * problem however many trivial ones surround it. Rolling up the other way would
 * count a file with nine trivial hunks and one rewrite as nine-tenths trivia,
 * which is not a cost anybody pays.
 */
export function classifyFileConflict(conflict: FileConflict): FileVerdict {
  const verdicts = conflict.hunks.map(classifyHunk);
  const contested = verdicts.find((v) => v.verdict === "contested");
  const decided = contested ?? verdicts[verdicts.length - 1];
  const hesitations: string[] = [];
  for (const v of verdicts) {
    if (v.hesitation && !hesitations.includes(v.hesitation)) hesitations.push(v.hesitation);
  }
  return {
    merge: conflict.merge,
    file: conflict.file,
    date: conflict.date,
    verdict: contested ? "contested" : "mechanical",
    reason: decided?.reason ?? "both sides wrote the same text",
    hunks: conflict.hunks.length,
    hesitations,
  };
}

export interface CensusActivity {
  /** Merges actually performed in the history, whether or not they conflicted. */
  mergesObserved: number;
  /** How many of those stopped on a conflict when replayed. */
  mergesConflicted: number;
  /** Span of the observed history, in weeks, used for the per-week rate. */
  weeks: number;
}

export interface ConflictMechanicalityCensus {
  conflicts: FileVerdict[];
  mechanical: number;
  contested: number;
  /** Conflicts whose verdict rested on a judgement the rule admits could go the other way. */
  hesitant: number;
  /**
   * Mechanical per contested, `null` when nothing was contested — a ratio with a
   * zero denominator is not a large number, it is an unmeasured one.
   */
  ratio: number | null;
  /**
   * The same ratio with every hesitant conflict moved to the other side. The
   * pair is the error bar the assumption test's design asked for; a reader who
   * only gets `ratio` cannot tell a firm 4:1 from one that is 4:1 because the
   * rule guessed.
   */
  ratioIfHesitationsFlip: number | null;
  /** Conflicts an operator would see per week under the human-only rule — all of them. */
  escalationsPerWeek: number;
  activity: CensusActivity;
  /** True when both halves of {@link CONFLICT_MECHANICALITY_RULE} hold. */
  withinBar: boolean;
}

/**
 * The ratio with every hesitant conflict decided the other way.
 *
 * Each side is flipped, not just one: a hesitant *mechanical* conflict moves to
 * contested and a hesitant *contested* one moves to mechanical, at the same
 * time. Flipping only one direction would report an error bar that happens to
 * point the way the rule already leans — on this vault's corpus every hesitation
 * sits on the contested side, so a one-directional flip returns the unflipped
 * number and looks like a ratio nothing could move.
 */
function flipRatio(conflicts: FileVerdict[]): number | null {
  let m = 0;
  let c = 0;
  for (const conflict of conflicts) {
    const hesitant = conflict.hesitations.length > 0;
    const flipped = hesitant
      ? conflict.verdict === "mechanical"
        ? "contested"
        : "mechanical"
      : conflict.verdict;
    if (flipped === "mechanical") m++;
    else c++;
  }
  return c === 0 ? null : m / c;
}

/**
 * Roll the classified conflicts up into the two numbers the bar is read off.
 *
 * `escalationsPerWeek` counts **every** conflict, not only the contested ones,
 * because that is what the rule under measurement costs: a human-only rule hands
 * back every conflict it meets, and the mechanical ones are precisely the trivia
 * the objection is about. The ratio is what says how much of that inbox is
 * trivia; the rate is what says whether the inbox is small enough to read.
 */
export function conflictMechanicalityCensus(
  conflicts: FileVerdict[],
  activity: CensusActivity,
): ConflictMechanicalityCensus {
  const mechanical = conflicts.filter((c) => c.verdict === "mechanical").length;
  const contested = conflicts.filter((c) => c.verdict === "contested").length;
  const hesitant = conflicts.filter((c) => c.hesitations.length > 0).length;
  const ratio = contested === 0 ? null : mechanical / contested;
  const escalationsPerWeek = activity.weeks > 0 ? conflicts.length / activity.weeks : conflicts.length;
  const ratioIfHesitationsFlip = flipRatio(conflicts);
  const withinBar =
    (ratio === null || ratio <= CONFLICT_MECHANICALITY_RULE.maxMechanicalPerContested) &&
    escalationsPerWeek < CONFLICT_MECHANICALITY_RULE.maxEscalationsPerWeek;
  return {
    conflicts,
    mechanical,
    contested,
    hesitant,
    ratio,
    ratioIfHesitationsFlip,
    escalationsPerWeek,
    activity,
    withinBar,
  };
}

/** A human-readable census, for the harvest script and for a failure message. */
export function formatConflictMechanicalityCensus(census: ConflictMechanicalityCensus): string {
  const ratio = census.ratio === null ? "undefined (nothing was contested)" : census.ratio.toFixed(2);
  const flip =
    census.ratioIfHesitationsFlip === null ? "undefined" : census.ratioIfHesitationsFlip.toFixed(2);
  const byPath = new Map<string, number>();
  for (const c of census.conflicts) byPath.set(c.file, (byPath.get(c.file) ?? 0) + 1);
  const paths = [...byPath.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([file, n]) => `    ${n}  ${file}`)
    .join("\n");
  return [
    `conflicts classified: ${census.conflicts.length}` +
      ` (${census.mechanical} mechanical, ${census.contested} contested, ${census.hesitant} resting on a judgement)`,
    `  mechanical per contested: ${ratio} (bar: <= ${CONFLICT_MECHANICALITY_RULE.maxMechanicalPerContested})`,
    `  the same ratio if every hesitation flipped: ${flip}`,
    `  escalations per week: ${census.escalationsPerWeek.toFixed(2)}` +
      ` (bar: < ${CONFLICT_MECHANICALITY_RULE.maxEscalationsPerWeek})`,
    `  history: ${census.activity.mergesConflicted} of ${census.activity.mergesObserved} merges conflicted` +
      ` over ${census.activity.weeks.toFixed(1)} week(s)`,
    `  where the conflicts are:`,
    paths,
  ].join("\n");
}

// ── reading git's own conflict output ───────────────────────────────────────

const DIFF3_OURS = /^<{7}(?:\s|$)/;
const DIFF3_BASE = /^\|{7}(?:\s|$)/;
const DIFF3_SPLIT = /^={7}(?:\s|$)/;
const DIFF3_THEIRS = /^>{7}(?:\s|$)/;

/**
 * Lift the hunks out of `git merge-file -p --diff3` output.
 *
 * Only the diff3 style is read. The two-sided default drops the base, and
 * without the base "both sides added something" and "both sides rewrote the same
 * paragraph" are the same picture — which is the distinction this whole census
 * turns on. A hunk missing its `|||||||` section is therefore refused rather
 * than parsed with an assumed-empty base, because an assumed-empty base reads
 * every rewrite as an add/add and reports it mechanical.
 */
export function parseDiff3(text: string): ConflictHunk[] {
  const lines = text.split(/\r?\n/);
  const hunks: ConflictHunk[] = [];
  let section: "none" | "ours" | "base" | "theirs" = "none";
  let current: ConflictHunk | null = null;
  let sawBase = false;

  for (const line of lines) {
    if (section === "none") {
      if (DIFF3_OURS.test(line)) {
        current = { ours: [], base: [], theirs: [] };
        section = "ours";
        sawBase = false;
      }
      continue;
    }
    if (DIFF3_BASE.test(line) && section === "ours") {
      section = "base";
      sawBase = true;
      continue;
    }
    if (DIFF3_SPLIT.test(line) && (section === "base" || section === "ours")) {
      section = "theirs";
      continue;
    }
    if (DIFF3_THEIRS.test(line) && section === "theirs") {
      if (current && sawBase) hunks.push(current);
      else if (current) {
        throw new Error(
          "refusing to classify a conflict hunk with no base section: " +
            "run `git merge-file -p --diff3`, since a two-sided hunk cannot tell a rewrite from an insertion",
        );
      }
      current = null;
      section = "none";
      continue;
    }
    if (current) {
      if (section === "ours") current.ours.push(line);
      else if (section === "base") current.base.push(line);
      else if (section === "theirs") current.theirs.push(line);
    }
  }
  return hunks;
}
