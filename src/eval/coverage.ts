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
 * A bounded test read side by side: what it asked for, and what its runs say
 * they left out.
 *
 * `asked` is null when the node never wrote a threshold down — which is a
 * finding rather than a blank. A run that stated its limits against no stated
 * question has nothing to be checked against, and that is exactly the case a
 * count of pairs reports as healthy.
 */
export interface CoveragePair {
  title: string;
  asked: string | null;
  uncovered: string[];
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

/**
 * A bold lead-in naming a pre-commitment, e.g. `**Pre-committed threshold:**`.
 *
 * Matched on the phrase rather than on one exact string, because neither vault
 * was written against this feature: between them they use "Pre-committed
 * threshold", "Pre-committed success threshold", "Pre-commit before looking",
 * "Pre-commit the threshold before starting", and more. Tightening this to one
 * spelling would silently report the tree as thresholdless.
 */
const PRECOMMIT_LEAD = /^\s*\*\*[^*]*pre-commit[^*]*\*\*[:.]?\s*/i;

/** Any other bold lead-in — where a pre-commitment paragraph ends. */
const ANY_LEAD = /^\s*\*\*[^*]+\*\*/;

/**
 * The threshold a node pre-committed to, as one paragraph, or null.
 *
 * Deliberately dumb: it locates a marker and returns the prose after it. It
 * does not check that the prose is a threshold, is measurable, or was really
 * written before the run — all three are human judgements, and the point of
 * printing it is to put it where a human can make them.
 */
export function askedOf(test: OstNode): string | null {
  const lines = test.body.split("\n");
  const start = lines.findIndex((l) => PRECOMMIT_LEAD.test(l));
  if (start === -1) return null;

  const parts = [lines[start].replace(PRECOMMIT_LEAD, "")];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    // A blank line, a heading, or the next bold lead-in ends the paragraph.
    if (!trimmed || /^#{1,6}\s/.test(trimmed) || ANY_LEAD.test(line)) break;
    parts.push(line);
  }

  const asked = parts.join(" ").replace(/\s+/g, " ").trim();
  // A marker with nothing after it reads as a threshold in a skim and bounds
  // nothing in fact, so it is reported as absent rather than as empty.
  return asked || null;
}

/** The statements written under `## Uncovered`, without their list markers. */
export function uncoveredStatementsOf(test: OstNode): string[] {
  const lines = test.body.split("\n");
  const start = lines.findIndex((l) => l.trim() === UNCOVERED_HEADING);
  if (start === -1) return [];

  const statements: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (/^#{1,6}\s/.test(trimmed)) break;
    if (/^[-*]\s+\S/.test(trimmed)) statements.push(trimmed.replace(/^[-*]\s+/, ""));
  }
  return statements;
}

/**
 * Every bounded assumption test, paired with what it asked for.
 *
 * Unbounded tests are left out on purpose: `computeCoverageDebt` already names
 * those, and they have nothing to read side by side. This covers the case that
 * one cannot see at all — a test whose paperwork is complete and whose run may
 * still have answered a different question than the one written down.
 */
export function computeCoveragePairs(tree: readonly OstNode[]): CoveragePair[] {
  return tree
    .filter((n) => n.layer === "AssumptionTest")
    .filter((t) => {
      const c = coverageOf(t);
      return c.claimed > 0 && c.unbounded === 0;
    })
    .map((t) => ({ title: t.title, asked: askedOf(t), uncovered: uncoveredStatementsOf(t) }));
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
