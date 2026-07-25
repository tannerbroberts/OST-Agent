/**
 * The side-by-side reading: what a test asked for, next to what its run says it
 * did not cover.
 *
 * v0.8.0 made every result carry a statement of its own limits, and then never
 * read that statement — `debt` counts the pair and stops. A count tells you a
 * sentence exists; it cannot tell you the sentence bounds anything. The
 * cheapest thing that makes the field load-bearing is to print the two pieces
 * of text the tool already holds next to each other, so a human can see in one
 * screen whether the run answered the question that was asked.
 *
 * Nothing here judges. It does not compare the two, score them, or decide
 * whether the limit is honest — that is the human call the whole coverage
 * feature is deliberately built around.
 */
import { describe, expect, test } from "vitest";
import {
  askedOf,
  computeCoveragePairs,
  uncoveredStatementsOf,
  UNCOVERED_HEADING,
} from "../../src/eval/coverage.js";
import type { OstNode } from "../../src/ost/node.js";

function node(title: string, body: string, extra: Partial<OstNode> = {}): OstNode {
  return { title, layer: "AssumptionTest", tags: [], links: [], body, ...extra };
}

const RESULT = "## Results\n- 2026-07-25 **supported** (ran by Tanner) — 4 of 5 finished";
const UNCOVERED = `${UNCOVERED_HEADING}\n- 2026-07-25 (supported) — says nothing about returning users`;

describe("askedOf — finding the threshold the node pre-committed to", () => {
  test("reads the text after a pre-commit lead-in", () => {
    const body = "the plan\n\n**Pre-committed threshold:** at least 5 of 20 book a kickoff.";

    expect(askedOf(node("Asm", body))).toBe("at least 5 of 20 book a kickoff.");
  });

  test("accepts the wording variants both vaults actually use", () => {
    // Neither vault was written against this feature, so the marker is matched
    // on the phrase rather than on one exact string. These are real lead-ins,
    // counted out of ost-agent-meta and tetrix-ost.
    const variants = [
      "**Pre-committed threshold:** A",
      "**Pre-committed success threshold:** A",
      "**Pre-commit before looking:** A",
      "**Pre-commit the threshold before starting.** A",
      "**Pre-committed threshold (set before running):** A",
    ];

    for (const lead of variants) {
      expect(askedOf(node("Asm", `plan\n\n${lead}`)), lead).toBe("A");
    }
  });

  test("takes a threshold that wraps across lines, as a paragraph", () => {
    const body = [
      "plan",
      "",
      "**Pre-committed threshold:** the playable variant must reach a signup",
      "rate at least as high as the preview's, on at least 100 arrivals per arm.",
      "",
      "**What it does NOT test.** Retention.",
    ].join("\n");

    expect(askedOf(node("Asm", body))).toBe(
      "the playable variant must reach a signup rate at least as high as the preview's, on at least 100 arrivals per arm.",
    );
  });

  test("stops at the next heading rather than swallowing the results", () => {
    const body = `plan\n\n**Pre-committed threshold:** 5 of 20.\n${RESULT}`;

    expect(askedOf(node("Asm", body))).toBe("5 of 20.");
  });

  test("is null when the node never wrote a threshold down", () => {
    expect(askedOf(node("Asm", "plan\n\n**Method:** ask people"))).toBeNull();
  });

  test("is null when the lead-in is there but says nothing after it", () => {
    // An empty pre-commitment is worse than none: it looks like a threshold in
    // a skim. Reporting it as absent is what puts it in front of a human.
    expect(askedOf(node("Asm", "plan\n\n**Pre-committed threshold:**\n\n## Results"))).toBeNull();
  });
});

describe("uncoveredStatementsOf", () => {
  test("returns the statements, stripped of their list marker", () => {
    expect(uncoveredStatementsOf(node("Asm", `plan\n\n${UNCOVERED}`))).toEqual([
      "2026-07-25 (supported) — says nothing about returning users",
    ]);
  });

  test("is empty when nothing was ever stated", () => {
    expect(uncoveredStatementsOf(node("Asm", `plan\n\n${RESULT}`))).toEqual([]);
  });
});

describe("computeCoveragePairs", () => {
  test("pairs a bounded test's threshold with what its run left out", () => {
    const body = `plan\n\n**Pre-committed threshold:** 5 of 20 book a kickoff.\n\n${RESULT}\n\n${UNCOVERED}`;
    const pairs = computeCoveragePairs([node("Cold offer", body)]);

    expect(pairs).toEqual([
      {
        title: "Cold offer",
        asked: "5 of 20 book a kickoff.",
        uncovered: ["2026-07-25 (supported) — says nothing about returning users"],
      },
    ]);
  });

  test("reports a bounded test that never wrote a threshold down, rather than skipping it", () => {
    // This is a finding, not a blank: the run stated a limit, and there is
    // nothing in the node to read that limit against.
    const pairs = computeCoveragePairs([node("Asm", `plan\n\n${RESULT}\n\n${UNCOVERED}`)]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].asked).toBeNull();
  });

  test("leaves unbounded tests alone — they are already named by the gap list", () => {
    const unbounded = node("Unbounded", `plan\n\n**Pre-committed threshold:** 5 of 20.\n\n${RESULT}`);

    expect(computeCoveragePairs([unbounded])).toEqual([]);
  });

  test("ignores tests with no result at all, and nodes that are not tests", () => {
    const proposed = node("Proposed", "plan\n\n**Pre-committed threshold:** 5 of 20.");
    const solution = node("A solution", `plan\n\n${RESULT}\n\n${UNCOVERED}`, { layer: "Solution" });

    expect(computeCoveragePairs([proposed, solution])).toEqual([]);
  });
});
