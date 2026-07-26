/**
 * The lookup budget: one counter shared by search and page reads, created per
 * PassContext. Exhaustion is an instruction to work from what you have — not
 * an error.
 */
import { describe, expect, test } from "vitest";
import { createLookupBudget, budgetSpentMessage, DEFAULT_LOOKUP_BUDGET } from "../../src/web/budget.js";

describe("createLookupBudget", () => {
  test("allows exactly `limit` takes, then refuses", () => {
    const b = createLookupBudget(3);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    expect(b.take()).toBe(false); // stays exhausted
    expect(b.remaining()).toBe(0);
  });

  test("reports remaining as it drains", () => {
    const b = createLookupBudget(2);
    expect(b.remaining()).toBe(2);
    b.take();
    expect(b.remaining()).toBe(1);
  });

  test("defaults to DEFAULT_LOOKUP_BUDGET", () => {
    expect(createLookupBudget().remaining()).toBe(DEFAULT_LOOKUP_BUDGET);
    expect(DEFAULT_LOOKUP_BUDGET).toBe(10);
  });

  test("the spent message instructs, it does not just refuse", () => {
    const msg = budgetSpentMessage(10);
    expect(msg).toMatch(/budget/i);
    expect(msg).toMatch(/annotate|record|cite|open question/i);
  });
});
