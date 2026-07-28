/**
 * The lookup budget: one counter shared by search and page reads, created per
 * PassContext. Exhaustion is an instruction to work from what you have — not
 * an error.
 *
 * Phase 2 makes the policy an allele, and this file is where the extraction is
 * held honest. Three things must NOT move: the number an operator writes in
 * `ost.config.yaml` still governs unless the genome explicitly overrides it,
 * one shared class-blind counter is still the default, and the sentence the
 * tools answer with when the budget is spent is still byte-for-byte the
 * sentence they answered with before there was a genome. The assertions below
 * that look redundant are those pins.
 */
import { describe, expect, test } from "vitest";
import { createLookupBudget, budgetSpentMessage, DEFAULT_LOOKUP_BUDGET } from "../../src/web/budget.js";
import { defaultGenome } from "../../src/genome/load.js";
import type { BudgetsGene } from "../../src/genome/schema.js";

/** The default gene, with only what a test cares about overridden. */
const gene = (over: Partial<BudgetsGene> = {}): BudgetsGene => ({
  sharedPool: null,
  perClass: {},
  onExhaustion: "instruct",
  ...over,
});

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
    const b = createLookupBudget(10, undefined, { refillPerHour: 10, now: () => clock });
    for (let i = 0; i < 10; i++) b.take();
    expect(b.take()).toBe(false);

    clock += 6 * 60 * 1000; // six minutes = one token at 10/hour
    expect(b.remaining()).toBe(1);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });

  test("never refills past the burst capacity", () => {
    let clock = 0;
    const b = createLookupBudget(10, undefined, { refillPerHour: 10, now: () => clock });
    b.take();
    clock += 24 * 60 * 60 * 1000; // a full day of refill
    expect(b.remaining()).toBe(10);
  });

  test("refillPerHour: 0 reproduces the old non-refilling behaviour", () => {
    let clock = 0;
    const b = createLookupBudget(2, undefined, { refillPerHour: 0, now: () => clock });
    b.take();
    b.take();
    clock += 365 * 24 * 60 * 60 * 1000;
    expect(b.take()).toBe(false);
    expect(b.msUntilNext()).toBe(Infinity);
  });

  test("refund returns a token without exceeding capacity", () => {
    const b = createLookupBudget(2, undefined, { refillPerHour: 0 });
    b.take();
    b.refund();
    expect(b.remaining()).toBe(2);
    b.refund(); // already full
    expect(b.remaining()).toBe(2);
  });

  test("msUntilNext reports the wait once exhausted", () => {
    let clock = 0;
    const b = createLookupBudget(1, undefined, { refillPerHour: 60, now: () => clock }); // one per minute
    b.take();
    expect(b.msUntilNext()).toBe(60_000);
    clock += 30_000;
    expect(b.msUntilNext()).toBe(30_000);
  });

  test("the spent message names the wait when one is known", () => {
    expect(budgetSpentMessage(10, "instruct", 12 * 60 * 1000)).toMatch(/12 minutes/);
    expect(budgetSpentMessage(10, "instruct", Infinity)).not.toMatch(/minutes/);
  });
});

describe("createLookupBudget — the operator's number and the genome's", () => {
  test("a bare number stays a positional shorthand — every pre-genome call site keeps counting", () => {
    const b = createLookupBudget(5);
    expect(b.limit).toBe(5);
    expect(b.take()).toBe(true);
    expect(b.remaining()).toBe(4);
  });

  test("a null sharedPool means the operator's configured number governs — the genome declines to have an opinion", () => {
    const b = createLookupBudget(gene(), 4);
    expect(b.limit).toBe(4);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });

  test("an explicit sharedPool is the ONLY way the genome takes the wheel from the operator", () => {
    expect(createLookupBudget(gene({ sharedPool: 2 }), 9).limit).toBe(2);
  });

  test("a null sharedPool with no operator number falls back to DEFAULT_LOOKUP_BUDGET — two absences, still ten", () => {
    expect(createLookupBudget(gene()).limit).toBe(DEFAULT_LOOKUP_BUDGET);
  });

  test("the default genome's budgets ARE today's budgets — whatever the operator wrote, unchanged", () => {
    const b = createLookupBudget(defaultGenome().budgets, 7);
    expect(b.limit).toBe(7);
    expect(b.take()).toBe(true);
    expect(b.remaining()).toBe(6);
  });
});

describe("createLookupBudget — per-class caps", () => {
  test("an empty perClass ignores the class entirely — one shared counter, exactly as before", () => {
    const b = createLookupBudget(gene({ sharedPool: 2, perClass: {} }));
    expect(b.take("bounded")).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take("unbounded")).toBe(false);
    expect(b.remaining()).toBe(0);
  });

  test("a capped class stops at its cap while the shared pool is still deep — and the refusal spends NOTHING", () => {
    const b = createLookupBudget(gene({ sharedPool: 10, perClass: { bounded: 1 } }));
    expect(b.take("bounded")).toBe(true);
    expect(b.take("bounded")).toBe(false);
    expect(b.remaining()).toBe(9);
    expect(b.take("unreached")).toBe(true); // another class is untouched by that cap
    expect(b.remaining()).toBe(8);
  });

  test("a class perClass does not name is uncapped — the map lists exceptions, NOT a whitelist", () => {
    const b = createLookupBudget(gene({ sharedPool: 3, perClass: { unbounded: 0 } }));
    expect(b.take("bounded")).toBe(true);
    expect(b.take("bounded")).toBe(true);
    expect(b.take("unbounded")).toBe(false); // a cap of zero forbids the class outright
    expect(b.remaining()).toBe(1);
  });

  test("the shared pool still bounds every class — a generous per-class cap cannot mint lookups", () => {
    const b = createLookupBudget(gene({ sharedPool: 1, perClass: { bounded: 5 } }));
    expect(b.take("bounded")).toBe(true);
    expect(b.take("bounded")).toBe(false);
  });
});

describe("budgetSpentMessage — the exhaustion instruction is an allele", () => {
  // This pinned the sentence byte-for-byte against the genome extraction, which
  // was meant to change no behaviour. Refill is a real behaviour change and it
  // moved one clause: the pool is no longer "this session", it is a burst that
  // refills within a session, so the old wording had become false. Everything
  // downstream of the first sentence is still pinned, and `instruct` is still
  // the default — which is what this test was actually guarding.
  test("instruct is the default, and says what the pool now is", () => {
    const expected =
      "Lookup budget spent (10 web lookups in this burst). " +
      "Work from what you have already read and cite it. If something essential is still unknown, " +
      "record it as an open question on the relevant node (ost_annotate or a note in the body) " +
      "so the next session can pick it up with a fresh budget.";
    expect(budgetSpentMessage(10)).toBe(expected);
    expect(budgetSpentMessage(10, "instruct")).toBe(expected);
  });

  test("record-unknown closes the loop instruct leaves open — it names the contract, not just the regret", () => {
    const msg = budgetSpentMessage(3, "record-unknown");
    expect(msg).toMatch(/budget spent/i);
    expect(msg).toContain("ost_create_node");
    expect(msg).toContain("## Format");
    expect(msg).toContain("## Methodology");
    expect(msg).toContain("## Rationale");
    expect(msg).not.toBe(budgetSpentMessage(3, "instruct"));
  });
});
