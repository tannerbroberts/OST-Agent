import { describe, expect, test } from "vitest";
import { computeCoverageDebt, coverageOf, UNCOVERED_HEADING } from "../../src/eval/coverage.js";
import type { OstNode } from "../../src/ost/node.js";

function node(title: string, body: string, extra: Partial<OstNode> = {}): OstNode {
  return { title, layer: "AssumptionTest", tags: [], links: [], body, ...extra };
}

const RESULT = "## Results\n- 2026-07-25 **supported** (ran by Tanner) — 4 of 5 finished";
const UNCOVERED = `${UNCOVERED_HEADING}\n- 2026-07-25 (supported) — says nothing about returning users`;

describe("coverageOf", () => {
  test("a test with no result claims nothing, so it owes nothing", () => {
    const c = coverageOf(node("Asm", "the plan"));

    expect(c.claimed).toBe(0);
    expect(c.unbounded).toBe(0);
  });

  test("a recorded result with no uncovered statement is an unbounded claim", () => {
    const c = coverageOf(node("Asm", `the plan\n\n${RESULT}`));

    expect(c.claimed).toBe(1);
    expect(c.stated).toBe(0);
    expect(c.unbounded).toBe(1);
  });

  test("a recorded result paired with an uncovered statement is bounded", () => {
    const c = coverageOf(node("Asm", `the plan\n\n${RESULT}\n\n${UNCOVERED}`));

    expect(c.claimed).toBe(1);
    expect(c.stated).toBe(1);
    expect(c.unbounded).toBe(0);
  });

  test("counts entries, so a second result on an already-bounded test goes unbounded", () => {
    // This is the case the field exists for: the artefact grows, the statement of
    // what it does not cover does not, and the extra claim rides in unexamined.
    const body = `the plan\n\n${RESULT}\n- 2026-07-26 **supported** (ran by Tanner) — again, 9 of 10\n\n${UNCOVERED}`;
    const c = coverageOf(node("Asm", body));

    expect(c.claimed).toBe(2);
    expect(c.stated).toBe(1);
    expect(c.unbounded).toBe(1);
  });

  test("a hand-validated test with no Results section still claims one thing", () => {
    // `status: validated` clears the evidence gate on its own, so it is a claim
    // even with nothing written down — and an unwritten claim bounds nothing.
    const c = coverageOf(node("Asm", "the plan", { status: "validated" }));

    expect(c.claimed).toBe(1);
    expect(c.unbounded).toBe(1);
  });

  test("more uncovered statements than results never reads as negative debt", () => {
    const body = `the plan\n\n${RESULT}\n\n${UNCOVERED}\n- 2026-07-26 (supported) — nor about mobile`;

    expect(coverageOf(node("Asm", body)).unbounded).toBe(0);
  });

  test("ignores a heading that merely mentions the word", () => {
    const c = coverageOf(node("Asm", `the plan\n\n${RESULT}\n\n## What is uncovered elsewhere\n- not this`));

    expect(c.stated).toBe(0);
  });

  test("only list entries count — prose under the heading is not a statement", () => {
    const c = coverageOf(node("Asm", `the plan\n\n${RESULT}\n\n${UNCOVERED_HEADING}\nTODO: fill this in later`));

    expect(c.stated).toBe(0);
    expect(c.unbounded).toBe(1);
  });
});

describe("computeCoverageDebt", () => {
  const tree: OstNode[] = [
    node("Bounded", `p\n\n${RESULT}\n\n${UNCOVERED}`),
    node("Unbounded", `p\n\n${RESULT}`),
    node("Not yet run", "p"),
    { title: "Sol", layer: "Solution", tags: [], links: ["Bounded"], body: `p\n\n${RESULT}` },
  ];

  test("names only the tests that recorded a result without bounding it", () => {
    const debt = computeCoverageDebt(tree);

    expect(debt.gaps.map((g) => g.title)).toEqual(["Unbounded"]);
  });

  test("counts only assumption tests — a Results section elsewhere is not a test result", () => {
    const debt = computeCoverageDebt(tree);

    expect(debt.totals.withResults).toBe(2);
    expect(debt.totals.bounded).toBe(1);
    expect(debt.totals.unbounded).toBe(1);
  });

  test("an empty tree is clean rather than undefined", () => {
    expect(computeCoverageDebt([])).toEqual({ gaps: [], totals: { withResults: 0, bounded: 0, unbounded: 0 } });
  });
});
