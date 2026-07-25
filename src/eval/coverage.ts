/**
 * Coverage debt — what a recorded result quietly claims but never ran.
 *
 * A result is a small piece of prose that clears a gate. It says what happened;
 * it almost never says what did *not* happen. So the artefact left behind gets
 * read as answering the whole threshold the test was written against, when in
 * practice it answered some part of it and the rest went untested and unnoticed.
 *
 * Twice in a row on a sibling product, the honest move after running a test was
 * to split the node, because the artefact covered less than the question asked —
 * and both times that depended on somebody happening to notice. This module is
 * the mechanical half of noticing: every claim must be paired with a written
 * statement of what it leaves out, and an unpaired claim is debt with a name.
 *
 * The judgement is deliberately shallow. It never reads the uncovered statement
 * or checks that it is true — only that a person was made to write one. Whether
 * the statement is honest is a human call, and nothing here pretends otherwise.
 */
import { hasRecordedResult } from "./evidence-debt.js";
import type { OstNode } from "../ost/node.js";

/** Section an assumption test's `does not cover` statements are appended under. */
export const UNCOVERED_HEADING = "## Uncovered";

export interface Coverage {
  /** How many distinct results this test claims. */
  claimed: number;
  /** How many written statements of what a run did not cover. */
  stated: number;
  /** Claims with no statement bounding them. */
  unbounded: number;
}

export interface CoverageGap {
  title: string;
  claimed: number;
  stated: number;
  unbounded: number;
}

export interface CoverageDebt {
  /** Tests that recorded a result without saying what it fails to cover. */
  gaps: CoverageGap[];
  totals: { withResults: number; bounded: number; unbounded: number };
}

/**
 * Count the list entries directly under a `## Heading`, stopping at the next
 * heading of any level. Only list entries count: prose under the heading is a
 * placeholder ("TODO: fill this in"), and a placeholder bounds nothing.
 */
function countEntriesUnder(body: string, heading: string): number {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return 0;
  let count = 0;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) break;
    if (/^[-*]\s+\S/.test(line.trim())) count++;
  }
  return count;
}

/** What one assumption test claims, and how much of that claim is bounded. */
export function coverageOf(test: OstNode): Coverage {
  const results = countEntriesUnder(test.body, "## Results");
  // A hand-validated test with nothing written down still clears the evidence
  // gate, so it is one claim — and an unwritten claim bounds nothing at all.
  const claimed = results > 0 ? results : hasRecordedResult(test) ? 1 : 0;
  const stated = countEntriesUnder(test.body, UNCOVERED_HEADING);
  return { claimed, stated, unbounded: Math.max(0, claimed - stated) };
}

/** Every assumption test whose recorded results outrun their uncovered statements. */
export function computeCoverageDebt(tree: readonly OstNode[]): CoverageDebt {
  const tests = tree.filter((n) => n.layer === "AssumptionTest").map((t) => ({ title: t.title, ...coverageOf(t) }));
  const withResults = tests.filter((t) => t.claimed > 0);
  const gaps = withResults.filter((t) => t.unbounded > 0);
  return {
    gaps,
    totals: {
      withResults: withResults.length,
      bounded: withResults.length - gaps.length,
      unbounded: gaps.length,
    },
  };
}
