import { describe, expect, test } from "vitest";
import { bestMatch, findNearDuplicateIssues, similarity } from "../../src/ost/dedupe.js";

describe("similarity", () => {
  test("near-duplicate opportunities score high", () => {
    const s = similarity(
      "I want a reason to come back every day",
      "I want a reason to return every day",
    );
    expect(s).toBeGreaterThan(0.4);
  });

  test("unrelated titles score low", () => {
    const s = similarity("I want the game to be fair", "Install as an app on your home screen");
    expect(s).toBeLessThan(0.2);
  });

  test("exact match scores ~1", () => {
    expect(similarity("Daily challenge mode", "daily challenge mode")).toBe(1);
  });
});

describe("bestMatch", () => {
  const existing = [
    "I want a reason to come back every day",
    "I want the game to be fair",
    "I want to compete",
  ];

  test("returns the closest match above threshold", () => {
    const m = bestMatch("I want a reason to return every day", existing, 0.5);
    expect(m?.title).toBe("I want a reason to come back every day");
  });

  test("returns null when nothing is close enough", () => {
    expect(bestMatch("Server-side move validation", existing, 0.6)).toBeNull();
  });
});

describe("findNearDuplicateIssues", () => {
  test("flags same-layer near-duplicates with a stable direction, ignoring cross-layer and distinct titles", () => {
    const tree = [
      { title: "Retention", layer: "Outcome" },
      { title: "I want a reason to come back every day", layer: "Opportunity" },
      { title: "I want a reason to return every day", layer: "Opportunity" }, // ~dup of the above
      { title: "I want the game to be fair", layer: "Opportunity" }, // distinct
      { title: "I want a reason to come back every day", layer: "Solution" }, // same words, different LAYER → not compared
    ];
    const issues = findNearDuplicateIssues(tree, 0.4); // these titles score ~0.5; prod default (0.7) is stricter
    expect(issues).toHaveLength(1);
    // direction is the alphabetically-later title flagged as a dup of the earlier one
    expect(issues[0].title).toBe("I want a reason to return every day");
    expect(issues[0].issue).toContain("possible duplicate of [[I want a reason to come back every day]]");
    expect(issues[0].issue).toMatch(/similarity 0\.\d\d/);
  });

  test("is deterministic regardless of input order (stable, idempotent output)", () => {
    const a = [
      { title: "Daily challenge mode", layer: "Solution" },
      { title: "Daily challenge modes", layer: "Solution" },
    ];
    const reversed = [...a].reverse();
    const fwd = findNearDuplicateIssues(a, 0.4);
    expect(fwd).toHaveLength(1); // exercises a non-empty, order-independent result
    expect(fwd).toEqual(findNearDuplicateIssues(reversed, 0.4));
  });

  test("returns nothing for a well-formed tree with distinct titles", () => {
    const tree = [
      { title: "Retention", layer: "Outcome" },
      { title: "I want a daily reason to return", layer: "Opportunity" },
      { title: "Daily challenge mode", layer: "Solution" },
      { title: "A daily ritual will lift retention", layer: "AssumptionTest" },
    ];
    expect(findNearDuplicateIssues(tree)).toEqual([]);
  });
});
