import { describe, expect, test } from "vitest";
import { score } from "../../src/eval/scorecard.js";
import type { JudgeReport } from "../../src/eval/judge.js";
import type { OstNode } from "../../src/ost/node.js";

const OUT = "Reach 10,000 daily active users";
const wellFormed: OstNode[] = [
  { title: OUT, layer: "Outcome", tags: [], links: ["Opp"], body: "b" },
  { title: "Opp", layer: "Opportunity", tags: [], links: ["Sol"], body: "b" },
  { title: "Sol", layer: "Solution", tags: ["unvalidated"], status: "unvalidated", links: [], body: "b" },
];

describe("score", () => {
  test("passes when invariants hold and the judge is fully positive", () => {
    const report: JudgeReport = {
      verdicts: [
        { title: "Opp", layer: "Opportunity", grounded: true, classifiedCorrectly: true, rationale: "ok" },
        { title: "Sol", layer: "Solution", grounded: true, classifiedCorrectly: true, rationale: "ok" },
      ],
    };
    const s = score(wellFormed, OUT, report);
    expect(s.pass).toBe(true);
    expect(s.grounding.rate).toBe(1);
    expect(s.methodology.rate).toBe(1);
  });

  test("fails on a structural violation even with a perfect judge", () => {
    const broken: OstNode[] = [
      { title: OUT, layer: "Outcome", tags: [], links: [], body: "b" },
      { title: "Opp", layer: "Opportunity", tags: [], links: [], body: "b" }, // orphan
    ];
    const report: JudgeReport = { verdicts: [{ title: "Opp", layer: "Opportunity", grounded: true, classifiedCorrectly: true, rationale: "" }] };
    const s = score(broken, OUT, report);
    expect(s.invariants.pass).toBe(false);
    expect(s.pass).toBe(false);
  });

  test("fails when the grounding rate is below threshold (a hallucinated node)", () => {
    const report: JudgeReport = {
      verdicts: [
        { title: "Opp", layer: "Opportunity", grounded: true, classifiedCorrectly: true, rationale: "" },
        { title: "Sol", layer: "Solution", grounded: false, classifiedCorrectly: true, rationale: "invented — no evidence" },
      ],
    };
    const s = score(wellFormed, OUT, report);
    expect(s.grounding.rate).toBe(0.5);
    expect(s.grounding.pass).toBe(false);
    expect(s.pass).toBe(false);
  });

  test("fails when a node is misclassified (opportunity is really a solution)", () => {
    const report: JudgeReport = {
      verdicts: [
        { title: "Opp", layer: "Opportunity", grounded: true, classifiedCorrectly: false, rationale: "this is a feature, not a need" },
        { title: "Sol", layer: "Solution", grounded: true, classifiedCorrectly: true, rationale: "" },
      ],
    };
    const s = score(wellFormed, OUT, report);
    expect(s.methodology.pass).toBe(false);
    expect(s.pass).toBe(false);
  });
});
