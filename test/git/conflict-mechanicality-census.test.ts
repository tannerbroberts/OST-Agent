/**
 * What a human-only merge rule would actually cost, as a number.
 *
 * The solution under measurement is "No agent resolves a conflict it did not
 * create; the merge is handed back to a human". Its own prose states the
 * objection: *"Most conflicts in an append-only Markdown vault are mechanical and
 * safely resolved. A rule that treats all of them as human-only will send a great
 * deal of trivia to the operator, and an operator who is sent enough trivia stops
 * reading it."* That is a cost claim, and this file is the price tag.
 *
 * **Threshold, verbatim from the assumption test's `threshold:` field:** *"At most
 * 5 mechanical conflicts per genuinely contested one, and under 3 escalations per
 * week."* Both halves are asserted below, against the corpus in
 * `test/fixtures/conflict-mechanicality/` — see its `PROVENANCE.md` for how the
 * cut was made and how to re-cut it.
 *
 * **Green means every conflict in the history carries one of two verdicts**, so
 * the cost is a number rather than a worry. It does not mean the price is worth
 * paying: that is the operator's call, and the safety argument for the rule does
 * not depend on the count coming out low. A census with an `unknown` bucket would
 * have measured nothing, so `classifyHunk` always answers, and where its answer
 * rests on a judgement a person might make differently it says so in
 * `hesitation` — counted separately, never a third verdict.
 *
 * The suite is offline and deterministic: it reads the committed corpus, not the
 * vault. `scripts/harvest-conflict-corpus.ts` is what touches a vault, and it
 * does so through a `--mirror` clone in a temp directory.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  classifyFileConflict,
  classifyHunk,
  conflictMechanicalityCensus,
  CONFLICT_MECHANICALITY_RULE,
  formatConflictMechanicalityCensus,
  parseDiff3,
  type FileVerdict,
} from "../../src/git/conflict-mechanicality.js";

const FIXTURES = new URL("../fixtures/conflict-mechanicality/", import.meta.url).pathname;

const read = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const readJson = <T>(name: string): T => JSON.parse(read(name)) as T;
const readJsonl = <T>(name: string): T[] =>
  read(name)
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);

interface Corpus {
  repo: string;
  head: string;
  commits: number;
  weeks: number;
  mergesObserved: number;
  mergesConflicted: number;
  branchPairs: number;
  branchPairsConflicted: number;
  branches: number;
  slices: number;
}

interface Slice {
  slice: string;
  class: string;
  merge: string;
  file: string;
  bytes: number;
  wholeFileBytes: number;
  expect: Pick<FileVerdict, "verdict" | "reason" | "hunks" | "hesitations">;
}

const corpus = readJson<Corpus>("corpus.json");
const observed = readJsonl<FileVerdict>("observed-verdicts.jsonl");
const generated = readJsonl<FileVerdict>("generated-verdicts.jsonl");
const slices = readJsonl<Slice>("slices.jsonl");

/**
 * THE RULE — the bar was fixed before anything was counted.
 *
 * Pinned against the node's own words so the bar cannot drift to meet a number.
 * A threshold edited after the measurement is not a threshold.
 */
describe("the bar, as the assumption test wrote it", () => {
  test("at most 5 mechanical per contested, under 3 escalations per week", () => {
    expect(CONFLICT_MECHANICALITY_RULE.maxMechanicalPerContested).toBe(5);
    expect(CONFLICT_MECHANICALITY_RULE.maxEscalationsPerWeek).toBe(3);
  });
});

/**
 * THE CLASSIFIER — the five cases, in the vocabulary of the merge.
 *
 * Each case is the argument for its own verdict, so each gets an example small
 * enough to read. The interesting boundary is between cases 3 and 4: two writers
 * appending different lines is the trivia the objection is about, and two writers
 * appending the *same* line is not, because a union duplicates it and a dedupe
 * throws one writer's copy away without saying so.
 */
describe("classifying one hunk", () => {
  test("both sides wrote the same text — either side is the resolution", () => {
    expect(classifyHunk({ ours: ["a"], base: [], theirs: ["a"] })).toMatchObject({
      verdict: "mechanical",
      reason: "both sides wrote the same text",
      hesitation: null,
    });
  });

  test("trailing whitespace is not a disagreement", () => {
    // A vault is Markdown written by several writers through several editors.
    expect(classifyHunk({ ours: ["- a link  "], base: [], theirs: ["- a  link"] })).toMatchObject({
      verdict: "mechanical",
      reason: "both sides wrote the same text",
    });
  });

  test("only one side changed the region — the other side's text is the resolution", () => {
    expect(classifyHunk({ ours: ["base"], base: ["base"], theirs: ["new"] })).toMatchObject({
      verdict: "mechanical",
      reason: "only one side changed this region",
      hesitation: null,
    });
  });

  test("both sides only added, and added different lines — a union preserves both", () => {
    // "Two appends to different sections, a link added on both sides", named in
    // the assumption test's design as the mechanical case.
    const v = classifyHunk({
      ours: ["keep", "[[from ours]]"],
      base: ["keep"],
      theirs: ["keep", "[[from theirs]]"],
    });
    expect(v).toMatchObject({
      verdict: "mechanical",
      reason: "both sides only added lines, and no line was added twice",
      hesitation: null, // the base region is non-empty, so the insertion point is fixed
    });
  });

  test("...and when the base region is empty, the ORDER is a choice neither writer made", () => {
    // Still mechanical — a union loses nothing — but the rule admits it picked
    // something. This is the hesitation the design asked to be recorded
    // separately, and it is the one the single real conflict in this vault's
    // history carries.
    const v = classifyHunk({ ours: ["## Ours"], base: [], theirs: ["## Theirs"] });
    expect(v.verdict).toBe("mechanical");
    expect(v.hesitation).toMatch(/order is a choice neither writer made/);
  });

  test("both sides added the SAME line — contested, because a dedupe picks a winner silently", () => {
    const v = classifyHunk({
      ours: ["keep", "[[shared]]", "[[ours]]"],
      base: ["keep"],
      theirs: ["keep", "[[shared]]", "[[theirs]]"],
    });
    expect(v).toMatchObject({
      verdict: "contested",
      reason:
        "both sides added the same line, so a union duplicates it and a dedupe picks one writer's copy",
    });
    expect(v.hesitation).toMatch(/1 line\(s\) were added by both sides/);
  });

  test("a rewrite is contested — this is what the human-only rule exists for", () => {
    expect(classifyHunk({ ours: ["ours"], base: ["was"], theirs: ["theirs"] })).toMatchObject({
      verdict: "contested",
      reason: "at least one side rewrote or removed text the other side kept",
      hesitation: null,
    });
  });

  test("a deletion is contested too — the other side kept what this one removed", () => {
    expect(classifyHunk({ ours: ["a", "b"], base: ["a", "b"], theirs: ["a"] })).toMatchObject({
      verdict: "mechanical", // ours IS the base: only `theirs` changed anything
    });
    expect(classifyHunk({ ours: ["a", "b", "c"], base: ["a", "b"], theirs: ["a"] })).toMatchObject({
      verdict: "contested",
      reason: "at least one side rewrote or removed text the other side kept",
    });
  });

  test("a file is mechanical only when EVERY hunk in it is", () => {
    // The unit an operator handles is the file — they open it, read it, resolve
    // it — so one rewrite among nine trivial appends makes the file a human's
    // problem, not nine-tenths trivia.
    const v = classifyFileConflict({
      merge: "x",
      file: "n.md",
      date: "2026-08-03",
      hunks: [
        { ours: ["a"], base: [], theirs: ["a"] },
        { ours: ["ours"], base: ["was"], theirs: ["theirs"] },
      ],
    });
    expect(v.verdict).toBe("contested");
    expect(v.hunks).toBe(2);
  });
});

/**
 * THE BYTES — the classifier meets text git actually wrote.
 *
 * The verdict files are this census's own answers; a test that only read them
 * would be checking that JSON round-trips. The slices are the link back to real
 * conflicted output: parse the committed bytes, classify, and reproduce the
 * recorded verdict. A change to the rule shows up here as a changed expectation
 * rather than as a quietly different number downstream.
 */
describe("real conflicted bytes from the vault's history", () => {
  test("every distinct verdict-and-reason the corpus found has a slice", () => {
    expect(slices).toHaveLength(corpus.slices);
    expect(new Set(slices.map((s) => s.class)).size).toBe(slices.length);
  });

  test.each(slices.map((s) => [s.slice, s] as const))(
    "%s reproduces its recorded verdict from its bytes",
    (_name, slice) => {
      const hunks = parseDiff3(read(path.join("slices", slice.slice)));
      const verdict = classifyFileConflict({
        merge: slice.merge,
        file: slice.file,
        date: "",
        hunks,
      });
      expect(verdict.verdict).toBe(slice.expect.verdict);
      expect(verdict.reason).toBe(slice.expect.reason);
      expect(verdict.hunks).toBe(slice.expect.hunks);
      expect(verdict.hesitations).toEqual(slice.expect.hesitations);
    },
  );

  test("a slice is conflict blocks only, and that is why it can be committed at all", () => {
    // Dropping the unconflicted context is safe precisely because `parseDiff3`
    // ignores it; the assertion above is what proves the slice still classifies
    // as the whole file did. What it buys: the three slices are 43 kB instead of
    // 315 kB of an agent's own scratch briefing.
    let inside = false;
    for (const slice of slices) {
      for (const line of read(path.join("slices", slice.slice)).split("\n")) {
        if (/^<{7}(?:\s|$)/.test(line)) inside = true;
        expect(inside || line === "", `text outside a conflict block: ${line.slice(0, 60)}`).toBe(
          true,
        );
        if (/^>{7}(?:\s|$)/.test(line)) inside = false;
      }
    }
    const kept = slices.reduce((n, s) => n + s.bytes, 0);
    const whole = slices.reduce((n, s) => n + s.wholeFileBytes, 0);
    expect(kept).toBeLessThan(whole / 4);
  });

  test("a two-sided hunk is refused, not parsed with an assumed-empty base", () => {
    // The default conflict style has no `|||||||` section, and without the base
    // "both sides added something" and "both sides rewrote the same paragraph"
    // are the same picture — which is the distinction the whole census turns on.
    // An assumed-empty base reads every rewrite as an add/add and reports it
    // mechanical, which is the one way this measurement could come out
    // reassuring and wrong.
    const twoSided = ["<<<<<<< HEAD", "ours", "=======", "theirs", ">>>>>>> feature", ""].join("\n");
    expect(() => parseDiff3(twoSided)).toThrow(/no base section/);
  });
});

/**
 * THE CENSUS — the totality claim, and then the number.
 *
 * "Every conflict in the vault history is classified as mechanically resolvable
 * or not" is the definition of done, so it is asserted as totality: every row
 * carries one of exactly two verdicts and a reason, and the row count matches the
 * number of merges the harvest independently recorded as conflicting.
 */
describe("the census over the vault's history", () => {
  const rows = [...observed, ...generated];

  test("the cut is the whole history, not a sample", () => {
    expect(corpus.repo).toBe("ost-agent-meta");
    expect(corpus.commits).toBeGreaterThan(3000);
    expect(corpus.mergesObserved).toBe(35);
    expect(corpus.branchPairs).toBe(861); // every unordered pair of 42 branches
    expect(corpus.branchPairs).toBe((corpus.branches * (corpus.branches - 1)) / 2);
  });

  test("every conflict carries one of exactly two verdicts — there is no unknown bucket", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(["mechanical", "contested"]).toContain(row.verdict);
      expect(row.reason.length).toBeGreaterThan(0);
      expect(row.hunks).toBeGreaterThan(0);
    }
    // ...and the classifier still says the same thing about them today.
    expect(rows.filter((r) => r.verdict === "mechanical").length).toBe(1);
    expect(rows.filter((r) => r.verdict === "contested").length).toBe(201);
  });

  test("the row count matches the merges the harvest recorded as conflicting", () => {
    // The cross-check that the census covers the cut rather than a subset of it:
    // the harvest counted conflicting merges while replaying, the verdict files
    // were written from the conflicts those merges produced, and every merge that
    // conflicted has at least one row.
    expect(new Set(observed.map((r) => r.merge)).size).toBe(corpus.mergesConflicted);
    expect(new Set(generated.map((r) => r.merge)).size).toBe(corpus.branchPairsConflicted);
  });

  /**
   * THE ANSWER, on the corpus that is the operator's actual inbox.
   *
   * A human-only rule hands back every conflict it meets, so `escalationsPerWeek`
   * counts all of them — the mechanical ones are exactly the trivia the objection
   * is about. Over 4.7 weeks of this vault's real history the rule would have
   * escalated once.
   */
  test("the merges that actually happened clear both halves of the bar", () => {
    const census = conflictMechanicalityCensus(observed, {
      mergesObserved: corpus.mergesObserved,
      mergesConflicted: corpus.mergesConflicted,
      weeks: corpus.weeks,
    });
    expect(census.conflicts).toHaveLength(1);
    expect(census.mechanical).toBe(1);
    expect(census.contested).toBe(0);
    expect(census.ratio).toBeNull(); // a ratio over zero contested is unmeasured, not large
    expect(census.escalationsPerWeek).toBeLessThan(
      CONFLICT_MECHANICALITY_RULE.maxEscalationsPerWeek,
    );
    expect(census.escalationsPerWeek).toBeCloseTo(0.21, 2);
    expect(census.withinBar).toBe(true);
    // 35 merges, one conflict, and it was two sides appending different sections
    // of the root outcome node at the same point.
    expect(observed[0].file).toBe("OST-Agent (meta).md");
    expect(observed[0].reason).toBe("both sides only added lines, and no line was added twice");
    expect(formatConflictMechanicalityCensus(census)).toContain("1 mechanical, 0 contested");
  });

  /**
   * THE FINDING — the concurrent-work corpus does not measure the vault.
   *
   * The assumption test's design asked for conflicts "generated by replaying
   * concurrent work", because the real history has almost none. Replaying all 861
   * branch pairs produces 201 conflicts and every single one of them is in
   * `.ost-agent/NEXT-BUILD.md`: the loop's own scratch briefing, rewritten
   * wholesale by every agent branch. Not one is in a vault node.
   *
   * So the generated corpus answers a question nobody asked — how badly the
   * machine's state file collides with itself — and its 42.6 escalations per week
   * is the cost of a *file format*, not of the human-only rule. It is asserted
   * here rather than quietly dropped, because "we replayed concurrent work and it
   * blew the bar" is the wrong lesson to draw from it, and a reader who only sees
   * the observed number would never know the other one existed.
   */
  test("every generated conflict is in one machine-written file, and none in a vault node", () => {
    const files = new Set(generated.map((r) => r.file));
    expect([...files]).toEqual([".ost-agent/NEXT-BUILD.md"]);
    expect(generated.filter((r) => r.file.endsWith(".md") && !r.file.startsWith(".ost-agent/"))).toEqual(
      [],
    );
  });

  test("...and it is that file, not the rule, that blows the rate bar", () => {
    const census = conflictMechanicalityCensus(generated, {
      mergesObserved: corpus.branchPairs,
      mergesConflicted: corpus.branchPairsConflicted,
      weeks: corpus.weeks,
    });
    expect(census.contested).toBe(201);
    expect(census.mechanical).toBe(0);
    expect(census.ratio).toBe(0); // nothing about NEXT-BUILD.md collides mechanically
    expect(census.escalationsPerWeek).toBeGreaterThan(
      CONFLICT_MECHANICALITY_RULE.maxEscalationsPerWeek,
    );
    expect(census.withinBar).toBe(false);
    // 130 of the 201 rest on a judgement, and the error bar the design asked for
    // moves the ratio from 0.00 to 1.83 — still nowhere near the 5:1 the
    // objection predicted, in either direction.
    expect(census.hesitant).toBe(130);
    expect(census.ratioIfHesitationsFlip).toBeCloseTo(1.83, 2);
  });

  /**
   * The objection the solution node raised against itself, answered.
   *
   * It predicted a flood of trivia: "most conflicts in an append-only Markdown
   * vault are mechanical". Neither corpus shows that. The real history is not a
   * flood at all (one conflict in 4.7 weeks), and the replayed one is not trivia
   * (0 of 201 mechanical). The cost side is settled; whether to pay it is not
   * this test's call.
   */
  test("neither corpus shows the flood-of-trivia the objection predicted", () => {
    const mechanicalShare = rows.filter((r) => r.verdict === "mechanical").length / rows.length;
    expect(mechanicalShare).toBeLessThan(0.02);
    const perWeek = observed.length / corpus.weeks;
    expect(perWeek).toBeLessThan(CONFLICT_MECHANICALITY_RULE.maxEscalationsPerWeek);
  });
});
