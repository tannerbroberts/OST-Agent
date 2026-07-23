/**
 * Scorecard — composes the three efficacy layers into one pass/fail verdict.
 *
 * This is OST-Agent's definition of done: not "it runs", but "on the reference
 * corpus it satisfies every structural invariant and scores above the grounding
 * and methodology thresholds". Usefulness (the third layer) is a human-acceptance
 * metric measured in use, not here — see docs/reference/evaluating-ost-agent.md.
 */
import type { OstNode } from "../ost/node.js";
import { checkInvariants, type Violation } from "./invariants.js";
import type { JudgeReport } from "./judge.js";

export interface Thresholds {
  grounding: number; // min fraction of nodes grounded in evidence
  methodology: number; // min fraction classified into the correct layer
}

export const DEFAULT_THRESHOLDS: Thresholds = { grounding: 0.95, methodology: 0.9 };

export interface Scorecard {
  invariants: { violations: Violation[]; pass: boolean };
  grounding: { rate: number; count: number; total: number; pass: boolean };
  methodology: { rate: number; count: number; total: number; pass: boolean };
  pass: boolean;
}

export function score(
  tree: OstNode[],
  judge: JudgeReport,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Scorecard {
  const violations = checkInvariants(tree);
  const invariantsPass = violations.length === 0;

  const total = judge.verdicts.length;
  const grounded = judge.verdicts.filter((v) => v.grounded).length;
  const classified = judge.verdicts.filter((v) => v.classifiedCorrectly).length;
  const groundingRate = total === 0 ? 1 : grounded / total;
  const methodologyRate = total === 0 ? 1 : classified / total;

  const groundingPass = groundingRate >= thresholds.grounding;
  const methodologyPass = methodologyRate >= thresholds.methodology;

  return {
    invariants: { violations, pass: invariantsPass },
    grounding: { rate: groundingRate, count: grounded, total, pass: groundingPass },
    methodology: { rate: methodologyRate, count: classified, total, pass: methodologyPass },
    pass: invariantsPass && groundingPass && methodologyPass,
  };
}

export function formatScorecard(s: Scorecard): string {
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  const mark = (b: boolean) => (b ? "PASS" : "FAIL");
  const lines = [
    "OST-Agent efficacy scorecard",
    "────────────────────────────",
    `Invariants:  ${mark(s.invariants.pass)}  (${s.invariants.violations.length} violation(s))`,
    ...s.invariants.violations.map((v) => `   ✗ [${v.rule}] ${v.node ? `"${v.node}": ` : ""}${v.detail}`),
    `Grounding:   ${mark(s.grounding.pass)}  ${pct(s.grounding.rate)} (${s.grounding.count}/${s.grounding.total} nodes grounded in evidence)`,
    `Methodology: ${mark(s.methodology.pass)}  ${pct(s.methodology.rate)} (${s.methodology.count}/${s.methodology.total} nodes correctly classified)`,
    "────────────────────────────",
    `OVERALL:     ${mark(s.pass)}`,
  ];
  return lines.join("\n");
}
