import { describe, expect, test } from "vitest";
import { renderTournament, runTournament } from "../../src/eval/tournament.js";
import type { OstNode } from "../../src/ost/node.js";

/**
 * "Would an operator accept an elimination they initially disagreed with once
 * shown the evidence" — this spec answers only the machine-checkable half:
 * every elimination this pass performs cites a specific recorded result, and
 * no round ever crowns a candidate. Whether a human actually accepts one is
 * the humans-required half the assumption test names, and nothing here
 * grades it.
 */

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
const OPP = "Opp";

/** Outcome → Opportunity → three Solution candidates, each with the test the case needs. */
function bracket(solutions: OstNode[], tests: OstNode[]): { tree: OstNode[]; candidates: OstNode[] } {
  const solutionTitles = solutions.map((s) => s.title);
  const tree = [node(OUT, "Outcome", [OPP]), node(OPP, "Opportunity", solutionTitles), ...solutions, ...tests];
  return { tree, candidates: solutions };
}

describe("runTournament", () => {
  test("a tournament over nothing is a failure to report, not a clean pass", () => {
    const report = runTournament([], []);
    expect(report.subject).toEqual({ offered: 0, read: 0 });
    expect(report.rounds).toHaveLength(0);
    expect(report.survivors).toHaveLength(0);
  });

  test("a candidate with no test beneath it survives by silence — never eliminated on nothing", () => {
    const { tree, candidates } = bracket([node("A", "Solution", [])], []);
    const report = runTournament(candidates, tree);

    expect(report.eliminated).toHaveLength(0);
    expect(report.survivors).toEqual(["A"]);
  });

  test("a proposed-but-unrun test grounds nothing — proposing a test is not evidence against the candidate", () => {
    const asm = node("Asm", "AssumptionTest", [], { status: "unvalidated" });
    const { tree, candidates } = bracket([node("A", "Solution", ["Asm"])], [asm]);
    const report = runTournament(candidates, tree);

    expect(report.eliminated).toHaveLength(0);
    expect(report.survivors).toEqual(["A"]);
  });

  test("a supported result does not eliminate — only a refutation is grounds for removal", () => {
    const asm = node("Asm", "AssumptionTest", [], {
      body: "the plan\n\n## Results\n- 2026-08-10 **supported** (ran by Tanner) — held up under load",
    });
    const { tree, candidates } = bracket([node("A", "Solution", ["Asm"])], [asm]);
    const report = runTournament(candidates, tree);

    expect(report.eliminated).toHaveLength(0);
    expect(report.survivors).toEqual(["A"]);
  });

  test("a refuted result eliminates the candidate and cites the verbatim result line", () => {
    const resultLine = "2026-08-10 **refuted** (ran by Tanner) — 46 replays cost more turns than the baseline";
    const asm = node("Asm", "AssumptionTest", [], { body: `the plan\n\n## Results\n- ${resultLine}` });
    const { tree, candidates } = bracket([node("A", "Solution", ["Asm"])], [asm]);
    const report = runTournament(candidates, tree);

    expect(report.eliminated).toHaveLength(1);
    expect(report.eliminated[0].candidate).toBe("A");
    expect(report.eliminated[0].against).toBe("Asm");
    expect(report.eliminated[0].evidence).toContain(resultLine);
    expect(report.eliminated[0].verdict).toBe("refuted");
    expect(report.survivors).toEqual([]);
  });

  test("every elimination in the report cites a specific evidence id or recorded result — never a bare preference", () => {
    const asmA = node("AsmA", "AssumptionTest", [], {
      body: "## Results\n- 2026-08-01 **refuted** (ran by Tanner) — operator re-added it within a day",
    });
    const asmB = node("AsmB", "AssumptionTest", [], {
      body: "## Results\n- 2026-08-02 **refuted** (ran by Tanner) — three of three appealed",
    });
    const { tree, candidates } = bracket(
      [node("A", "Solution", ["AsmA"]), node("B", "Solution", ["AsmB"]), node("C", "Solution", [])],
      [asmA, asmB],
    );
    const report = runTournament(candidates, tree);

    expect(report.eliminated.length).toBeGreaterThan(0);
    for (const elimination of report.eliminated) {
      // The cited evidence is a real recorded-result line, not empty and not a summary.
      expect(elimination.evidence.trim().length).toBeGreaterThan(0);
      expect(elimination.evidence).toMatch(/refuted/i);
      expect(elimination.against.trim().length).toBeGreaterThan(0);
    }
  });

  test("no round ever crowns anything — the consideration set only shrinks, round by round", () => {
    const asmA = node("AsmA", "AssumptionTest", [], {
      body: "## Results\n- 2026-08-01 **refuted** (ran by Tanner) — operator re-added it within a day",
    });
    const asmB = node("AsmB", "AssumptionTest", [], {
      body: "## Results\n- 2026-08-02 **refuted** (ran by Tanner) — three of three appealed",
    });
    const { tree, candidates } = bracket(
      [node("A", "Solution", ["AsmA"]), node("B", "Solution", ["AsmB"]), node("C", "Solution", [])],
      [asmA, asmB],
    );
    const report = runTournament(candidates, tree);

    expect(report.rounds).toHaveLength(2);
    expect(report.survivors).toEqual(["C"]);

    // Structural: nothing anywhere in the report is a "winner" field, and each
    // round only ever removes from the previous round's remaining set.
    expect(report).not.toHaveProperty("winner");
    for (const round of report.rounds) {
      expect(round).not.toHaveProperty("winner");
      expect(round.remaining.length).toBeLessThan(round.entering.length);
      for (const title of round.remaining) expect(round.entering).toContain(title);
    }
    let previous = report.rounds[0].entering;
    for (const round of report.rounds) {
      expect(round.entering).toEqual(previous);
      previous = round.remaining;
    }

    // Down to a single survivor, the report still calls it a survivor, not a winner.
    expect(report.survivors).toHaveLength(1);
    expect(renderTournament(report)).not.toMatch(/winner:/i);
    expect(renderTournament(report)).toMatch(/stays a human's call/i);
  });

  test("a re-run over an unchanged tree is deterministic — same rounds, same eliminations, same order", () => {
    const asm = node("Asm", "AssumptionTest", [], {
      body: "## Results\n- 2026-08-10 **refuted** (ran by Tanner) — did not hold up",
    });
    const { tree, candidates } = bracket([node("A", "Solution", ["Asm"]), node("B", "Solution", [])], [asm]);

    const first = runTournament(candidates, tree);
    const second = runTournament(candidates, tree);
    expect(second).toEqual(first);
  });
});

describe("renderTournament", () => {
  test("says BLIND over nothing", () => {
    expect(renderTournament(runTournament([], []))).toContain("BLIND");
  });

  test("prints every elimination and the surviving set", () => {
    const resultLine = "2026-08-10 **refuted** (ran by Tanner) — did not hold up";
    const asm = node("Asm", "AssumptionTest", [], { body: `## Results\n- ${resultLine}` });
    const { tree, candidates } = bracket([node("A", "Solution", ["Asm"]), node("B", "Solution", [])], [asm]);

    const rendered = renderTournament(runTournament(candidates, tree));
    expect(rendered).toContain("A");
    expect(rendered).toContain(resultLine);
    expect(rendered).toContain("B");
  });
});
