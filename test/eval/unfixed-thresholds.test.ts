/**
 * A threshold that is still an instruction to choose one.
 *
 * v0.9.0 printed each bounded test's pre-commitment next to what its run left
 * out, and the first thing that did — run over both live vaults before it
 * shipped — was expose that in one of them the pre-commitment mostly is not a
 * commitment. 21 of 27 open with *Fix…* / *Decide…* / *Choose…*: an instruction
 * to pre-commit, standing where the pre-commitment should be. A test whose
 * threshold was never fixed cannot come out a failure.
 *
 * This is the census turned into a standing report. It is deliberately the
 * weakest of the three things that could be built here — it only looks. It
 * refuses nothing, blocks nothing, and rewrites nothing, because the rule is
 * shallow enough to be wrong at the edges and a report that is wrong is a
 * nuisance while a refusal that is wrong is a wall.
 */
import { describe, expect, test } from "vitest";
import { computeUnfixedThresholds, thresholdKindOf } from "../../src/eval/coverage.js";
import type { OstNode } from "../../src/ost/node.js";

function node(title: string, body: string, extra: Partial<OstNode> = {}): OstNode {
  return { title, layer: "AssumptionTest", tags: [], links: [], body, ...extra };
}

function asked(threshold: string): OstNode {
  return node("Asm", `the plan\n\n**Pre-committed threshold:** ${threshold}`);
}

describe("thresholdKindOf — is this a commitment, or an instruction to make one", () => {
  test("a paragraph with a number in it is a fixed bar", () => {
    expect(thresholdKindOf(asked("at least 5 of 20 book a kickoff."))).toBe("bound");
  });

  test("a comparison with no digits still counts as fixed", () => {
    // "no more than a third" is a bar somebody committed to. Requiring a digit
    // would report it as unfixed and teach the reader to ignore the report.
    for (const bar of [
      "no more than a third of runs may end blocked.",
      "at most a handful, and the rest must clear.",
      "a majority of reviewers must change their mind.",
      "≥ 2 incidents beyond the known one, else defer.",
      "fewer than half the sessions may need a retry.",
    ]) {
      expect(thresholdKindOf(asked(bar)), bar).toBe("bound");
    }
  });

  test("an imperative with no bar in it is an instruction, not a threshold", () => {
    for (const instruction of [
      "Fix the minimum number of kickoffs before starting.",
      "Decide the acceptable failure rate before looking at the data.",
      "Choose a bar for what counts as adoption.",
      "Set the sentiment floor before the interviews.",
      "Pick the cutoff in advance and write it here.",
      "Determine what would make you abandon this.",
    ]) {
      expect(thresholdKindOf(asked(instruction)), instruction).toBe("instruction");
    }
  });

  test("a number anywhere in the paragraph wins over the imperative opening", () => {
    // Deliberate: something was fixed, even if the sentence is phrased as an
    // ask. Flagging it would be the false positive that gets the report turned
    // off, and the genuinely empty ones come back with it.
    expect(thresholdKindOf(asked("Decide the bar; last time 5 of 20 booked."))).toBe("bound");
  });

  test("a falsifiable bar written in plain words is neither, and is not flagged", () => {
    // Real, from the sibling vault. No number and no imperative — a perfectly
    // good pre-commitment that a "must contain a digit" rule would libel.
    const real =
      "a piece placed by a visitor with no account lands on the board and " +
      "survives a page reload.";

    expect(thresholdKindOf(asked(real))).toBe("prose");
  });

  test("no pre-commitment paragraph at all reads as absent, not as prose", () => {
    expect(thresholdKindOf(node("Asm", "just a plan"))).toBe("absent");
  });

  test("the imperative must open the paragraph, not merely appear in it", () => {
    // "…and decide later" is a description of a threshold, not an instruction
    // standing in for one. The census counted openings, and so does this.
    expect(thresholdKindOf(asked("The bar is unanimous agreement, and decide the rest later."))).toBe(
      "bound",
    );
    expect(thresholdKindOf(asked("The reviewers must agree before we choose to build."))).toBe("prose");
  });

  test("reads through the wording variants both vaults actually use", () => {
    const body = "plan\n\n**Pre-commit before looking:** Choose the cutoff first.";

    expect(thresholdKindOf(node("Asm", body))).toBe("instruction");
  });
});

describe("computeUnfixedThresholds — the standing census", () => {
  const tree: OstNode[] = [
    asked("at least 100 arrivals per arm."),
    { ...asked("Fix the minimum before starting."), title: "Instructed" },
    { ...asked("Decide what counts as adoption."), title: "Instructed too" },
    { ...node("Wordy", "plan\n\n**Pre-committed threshold:** the run must survive a reload."), title: "Wordy" },
    { ...node("Silent", "plan with no threshold at all"), title: "Silent" },
    { ...node("A solution", "not a test"), title: "A solution", layer: "Solution" },
  ];

  test("counts every assumption test, and only assumption tests", () => {
    const census = computeUnfixedThresholds(tree);

    expect(census.totals).toEqual({ tests: 5, bound: 1, instruction: 2, prose: 1, absent: 1 });
  });

  test("the four kinds sum to the number of tests, so nothing is silently dropped", () => {
    const t = computeUnfixedThresholds(tree).totals;

    expect(t.bound + t.instruction + t.prose + t.absent).toBe(t.tests);
  });

  test("names only the tests it is flagging, with the text it read", () => {
    const census = computeUnfixedThresholds(tree);

    expect(census.unfixed.map((u) => u.title)).toEqual(["Instructed", "Instructed too", "Silent"]);
    expect(census.unfixed[0].asked).toBe("Fix the minimum before starting.");
    // An absent one has nothing to quote, and says so by being null rather than "".
    expect(census.unfixed[2].asked).toBeNull();
  });

  test("a test whose threshold is fixed, or is prose, is counted and not flagged", () => {
    const flagged = computeUnfixedThresholds(tree).unfixed.map((u) => u.title);

    expect(flagged).not.toContain("Asm");
    expect(flagged).not.toContain("Wordy");
  });

  test("an empty tree is a clean census rather than an error", () => {
    expect(computeUnfixedThresholds([])).toEqual({
      unfixed: [],
      totals: { tests: 0, bound: 0, instruction: 0, prose: 0, absent: 0 },
    });
  });
});
