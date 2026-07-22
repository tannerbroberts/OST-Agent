import { describe, expect, test } from "vitest";
import { bestMatch, similarity } from "../../src/ost/dedupe.js";

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
