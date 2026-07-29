/**
 * The lookup budget: one counter shared by search and page reads, created per
 * PassContext. Exhaustion is an instruction to work from what you have — not
 * an error.
 *
 * The number an operator writes in `ost.config.yaml` is the only number that
 * governs it. A `budgets` gene could once shadow that from `genome.yaml`, and
 * outranked it; both are gone.
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

  test("refills over time at the configured hourly rate", () => {
    let clock = 0;
    const b = createLookupBudget(10, { refillPerHour: 10, now: () => clock });
    for (let i = 0; i < 10; i++) b.take();
    expect(b.take()).toBe(false);

    clock += 6 * 60 * 1000; // six minutes = one token at 10/hour
    expect(b.remaining()).toBe(1);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });

  test("never refills past the burst capacity", () => {
    let clock = 0;
    const b = createLookupBudget(10, { refillPerHour: 10, now: () => clock });
    b.take();
    clock += 24 * 60 * 60 * 1000; // a full day of refill
    expect(b.remaining()).toBe(10);
  });

  test("refillPerHour: 0 reproduces the old non-refilling behaviour", () => {
    let clock = 0;
    const b = createLookupBudget(2, { refillPerHour: 0, now: () => clock });
    b.take();
    b.take();
    clock += 365 * 24 * 60 * 60 * 1000;
    expect(b.take()).toBe(false);
    expect(b.msUntilNext()).toBe(Infinity);
  });

  test("refund returns a token without exceeding capacity", () => {
    const b = createLookupBudget(2, { refillPerHour: 0 });
    b.take();
    b.refund();
    expect(b.remaining()).toBe(2);
    b.refund(); // already full
    expect(b.remaining()).toBe(2);
  });

  test("msUntilNext reports the wait once exhausted", () => {
    let clock = 0;
    const b = createLookupBudget(1, { refillPerHour: 60, now: () => clock }); // one per minute
    b.take();
    expect(b.msUntilNext()).toBe(60_000);
    clock += 30_000;
    expect(b.msUntilNext()).toBe(30_000);
  });

});

describe("createLookupBudget — the operator's number", () => {
  test("the operator's configured number governs", () => {
    expect(createLookupBudget(4).limit).toBe(4);
  });

  test("no number at all falls back to DEFAULT_LOOKUP_BUDGET", () => {
    expect(createLookupBudget().limit).toBe(DEFAULT_LOOKUP_BUDGET);
  });
});

describe("budgetSpentMessage", () => {
  test("names the pool and tells the session what to do instead of looking", () => {
    const msg = budgetSpentMessage(7);
    expect(msg).toContain("7 web lookups");
    expect(msg).toMatch(/work from what you have already read/i);
    expect(msg).toMatch(/open question/i);
  });

  test("names the wait when one is known, so 'stop looking' reads as 'for now'", () => {
    expect(budgetSpentMessage(7, 12 * 60_000)).toMatch(/about 12 minutes/);
    expect(budgetSpentMessage(7)).not.toMatch(/minutes/);
  });
});
