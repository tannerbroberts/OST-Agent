/**
 * Evidence debt — what the tree owes before anyone should build.
 *
 * Hunger for evidence and the urge to ship compete for the same attention, and
 * delivery wins by default. This is the deterministic half of the answer: for
 * every solution, has any assumption beneath it actually been tested, or is the
 * idea still resting on the fact that someone liked it?
 *
 * The judgement is mechanical on purpose — it never asks whether the RIGHT
 * assumption was tested, only whether any test recorded a result. That is a
 * floor, not a verdict: a human still decides whether the riskiest assumption
 * was the one that got run.
 */
import type { OstNode } from "../ost/node.js";
import { titlesMatch } from "../ost/sanitize.js";

export type DebtState = "untested" | "proposed" | "tested";

export interface SolutionDebt {
  title: string;
  state: DebtState;
  testsProposed: number;
  testsRun: number;
  /** Titles of proposed-but-unrun tests — what to go run. */
  outstanding: string[];
}

export interface EvidenceDebt {
  solutions: SolutionDebt[];
  totals: { solutions: number; untested: number; proposed: number; tested: number };
}

/**
 * A test counts as run when it records a result: a `## Results` section in its
 * body, or a human moving it off 'unvalidated' to 'validated'. Anything else is
 * a proposal, however carefully written.
 */
export function hasRecordedResult(test: OstNode): boolean {
  if (test.status === "validated") return true;
  return /^##\s+Results\b/im.test(test.body);
}

function testsUnder(tree: readonly OstNode[], solution: OstNode): OstNode[] {
  return tree.filter((n) => n.layer === "AssumptionTest" && solution.links.includes(n.title));
}

/** Per-solution debt across the whole tree, plus totals. */
export function computeEvidenceDebt(tree: readonly OstNode[]): EvidenceDebt {
  const solutions = tree
    .filter((n) => n.layer === "Solution")
    .map((sol) => {
      const tests = testsUnder(tree, sol);
      const run = tests.filter(hasRecordedResult);
      const state: DebtState = tests.length === 0 ? "untested" : run.length === 0 ? "proposed" : "tested";
      return {
        title: sol.title,
        state,
        testsProposed: tests.length,
        testsRun: run.length,
        outstanding: tests.filter((t) => !hasRecordedResult(t)).map((t) => t.title),
      };
    });

  return {
    solutions,
    totals: {
      solutions: solutions.length,
      untested: solutions.filter((s) => s.state === "untested").length,
      proposed: solutions.filter((s) => s.state === "proposed").length,
      tested: solutions.filter((s) => s.state === "tested").length,
    },
  };
}

export interface GateVerdict {
  cleared: boolean;
  reason: string;
  debt?: SolutionDebt;
}

/**
 * The gate: may work start on this solution? Clears only when some assumption
 * beneath it has recorded a result. Refusals name what to go run.
 */
export function gateSolution(tree: readonly OstNode[], title: string): GateVerdict {
  // Matched through the sanitizer: the caller names the title they created,
  // the tree carries the title the filesystem allowed.
  const solution = tree.find((n) => n.layer === "Solution" && titlesMatch(n.title, title));
  if (!solution) {
    return { cleared: false, reason: `"${title}" is not in the tree as a Solution — nothing to gate against` };
  }
  const debt = computeEvidenceDebt(tree).solutions.find((s) => titlesMatch(s.title, title))!;

  if (debt.state === "tested") {
    return { cleared: true, reason: `${debt.testsRun} of ${debt.testsProposed} assumption test(s) recorded a result`, debt };
  }
  if (debt.state === "untested") {
    return {
      cleared: false,
      reason: `"${title}" has no assumption test beneath it — surface one and run it before building`,
      debt,
    };
  }
  return {
    cleared: false,
    reason: `"${title}" has ${debt.testsProposed} proposed assumption test(s), none run: ${debt.outstanding.join("; ")}`,
    debt,
  };
}
