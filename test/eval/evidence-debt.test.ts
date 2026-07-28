import { describe, expect, test } from "vitest";
import { computeEvidenceDebt, gateSolution } from "../../src/eval/evidence-debt.js";
import type { OstNode } from "../../src/ost/node.js";

const node = (title: string, layer: OstNode["layer"], links: string[] = [], extra: Partial<OstNode> = {}): OstNode => ({
  title,
  layer,
  tags: [],
  links,
  body: "b",
  evidence: "assertion",
  ...extra,
});

const OUT = "Reach 10,000 daily active users";

/** Outcome → Opportunity → Solution, with whatever tests the case needs. */
function tree(solutionLinks: string[], tests: OstNode[]): OstNode[] {
  return [
    node(OUT, "Outcome", ["Opp"]),
    node("Opp", "Opportunity", ["Sol"]),
    node("Sol", "Solution", solutionLinks),
    ...tests,
  ];
}

describe("computeEvidenceDebt", () => {
  test("a solution with no assumption test at all is the worst kind of debt", () => {
    const debt = computeEvidenceDebt(tree([], []));

    expect(debt.solutions).toHaveLength(1);
    expect(debt.solutions[0].state).toBe("untested");
    expect(debt.solutions[0].title).toBe("Sol");
  });

  test("a solution whose tests are proposed but never run still owes evidence", () => {
    const debt = computeEvidenceDebt(tree(["Asm"], [node("Asm", "AssumptionTest", [], { status: "unvalidated" })]));

    expect(debt.solutions[0].state).toBe("proposed");
    expect(debt.solutions[0].testsProposed).toBe(1);
    expect(debt.solutions[0].testsRun).toBe(0);
  });

  test("a test that recorded results in its body clears the debt", () => {
    const asm = node("Asm", "AssumptionTest", [], {
      status: "unvalidated",
      body: "the plan\n\n## Results\n- 2026-07-24 ran it with 5 teams; 4 completed",
    });

    const debt = computeEvidenceDebt(tree(["Asm"], [asm]));

    expect(debt.solutions[0].state).toBe("tested");
    expect(debt.solutions[0].testsRun).toBe(1);
  });

  test("a human marking a test validated also counts as a run", () => {
    const asm = node("Asm", "AssumptionTest", [], { status: "validated" });

    expect(computeEvidenceDebt(tree(["Asm"], [asm])).solutions[0].state).toBe("tested");
  });

  test("totals say how much of the solution space is resting on nothing", () => {
    const t = [
      node(OUT, "Outcome", ["Opp"]),
      node("Opp", "Opportunity", ["A", "B"]),
      node("A", "Solution", []),
      node("B", "Solution", ["Asm"]),
      node("Asm", "AssumptionTest", [], { status: "validated" }),
    ];

    const debt = computeEvidenceDebt(t);

    expect(debt.totals).toEqual({ solutions: 2, untested: 1, proposed: 0, tested: 1 });
  });
});

describe("gateSolution", () => {
  test("refuses to clear a solution whose assumptions were never tested", () => {
    const verdict = gateSolution(tree([], []), "Sol");

    expect(verdict.cleared).toBe(false);
    expect(verdict.reason).toMatch(/no assumption test/i);
  });

  test("refuses one whose tests are only proposed, and names what to run", () => {
    const verdict = gateSolution(tree(["Asm"], [node("Asm", "AssumptionTest", [], { status: "unvalidated" })]), "Sol");

    expect(verdict.cleared).toBe(false);
    expect(verdict.reason).toContain("Asm");
  });

  test("clears a solution once a test has recorded a result", () => {
    const asm = node("Asm", "AssumptionTest", [], { body: "x\n\n## Results\n- it worked" });

    expect(gateSolution(tree(["Asm"], [asm]), "Sol").cleared).toBe(true);
  });

  test("says so plainly when the named solution is not in the tree", () => {
    const verdict = gateSolution(tree([], []), "Nonexistent");

    expect(verdict.cleared).toBe(false);
    expect(verdict.reason).toMatch(/not in the tree|no node/i);
  });
});

/**
 * A node's title is its filename, so by the time it is read back it has been
 * through `sanitizeTitle` — which replaces `:` with a space. A caller naming a
 * node types the title they created it with. Comparing the two raw makes a
 * whole naming convention (`Unknown: what we cannot see`) permanently
 * unaddressable, and does it silently: the lookup simply finds nothing.
 */
describe("titles that the vault had to sanitize are still addressable", () => {
  const created = "Synthetic vault ladder: generate OST-shaped vaults";
  const onDisk = "Synthetic vault ladder generate OST-shaped vaults"; // what sanitizeTitle leaves

  test("gating by the title the caller created resolves the node the vault stored", () => {
    const t = [
      node(OUT, "Outcome", ["Opp"]),
      node("Opp", "Opportunity", [onDisk]),
      node(onDisk, "Solution", ["T"]),
      node("T", "AssumptionTest", [], { body: "## Results\n- ran it" }),
    ];
    const verdict = gateSolution(t, created);
    expect(verdict.reason).not.toMatch(/is not in the tree/);
    expect(verdict.cleared).toBe(true);
  });

  test("and the sanitized spelling keeps working, so nothing that worked stops", () => {
    const t = [
      node(OUT, "Outcome", ["Opp"]),
      node("Opp", "Opportunity", [onDisk]),
      node(onDisk, "Solution", []),
    ];
    expect(gateSolution(t, onDisk).reason).toMatch(/no assumption test beneath it/);
  });
});
