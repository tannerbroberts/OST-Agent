import { describe, expect, test } from "vitest";
import {
  CAUTIOUS_REVERSIBILITY,
  REVERSIBILITY,
  isReversibility,
  reversibilityOf,
  type ReversibilityId,
} from "../../src/knowledge/reversibility.js";

describe("the reversibility vocabulary", () => {
  test("every class is defined and labelled", () => {
    for (const r of REVERSIBILITY) {
      expect(r.id).toMatch(/^[a-z-]+$/);
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.definition.length).toBeGreaterThan(0);
    }
  });

  test("isReversibility recognises exactly the defined classes and nothing else", () => {
    for (const r of REVERSIBILITY) expect(isReversibility(r.id)).toBe(true);
    expect(isReversibility("nonsense")).toBe(false);
    expect(isReversibility("")).toBe(false);
  });

  test("the cautious class is a real class, and it is the least forgiving one", () => {
    expect(isReversibility(CAUTIOUS_REVERSIBILITY)).toBe(true);
    expect(CAUTIOUS_REVERSIBILITY).toBe("irreversible");
  });

  test("reversibilityOf fails closed: a missing or invented class reads as irreversible", () => {
    // P1's check, verbatim: reversibilityOf(undefined) === reversibilityOf("invented") === "irreversible".
    expect(reversibilityOf(undefined)).toBe("irreversible");
    expect(reversibilityOf("invented")).toBe("irreversible");
    expect(reversibilityOf(undefined)).toBe(reversibilityOf("invented"));
  });

  test("reversibilityOf fails closed on every other unrecognised spelling too", () => {
    expect(reversibilityOf("")).toBe("irreversible");
    expect(reversibilityOf("Reversible")).toBe("irreversible");
    expect(reversibilityOf("REVERSIBLE")).toBe("irreversible");
    expect(reversibilityOf("costly-to-reverse")).toBe("irreversible");
    expect(reversibilityOf("anything-a-future-version-invents")).toBe("irreversible");
  });

  test("reversibilityOf recognises every defined class as itself", () => {
    for (const r of REVERSIBILITY) {
      expect(reversibilityOf(r.id as ReversibilityId)).toBe(r.id);
    }
  });

  test("reversible and costly are distinct from the cautious default", () => {
    const ids = REVERSIBILITY.map((r) => r.id);
    expect(ids).toContain("reversible");
    expect(ids).toContain("costly");
    expect(ids).toContain("irreversible");
  });
});
