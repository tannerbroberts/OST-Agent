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
  test("instruct is the default and is byte-identical to the sentence that shipped before the genome", () => {
    const expected =
      "Lookup budget spent (10 web lookups this session). " +
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
