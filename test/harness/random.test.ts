import { describe, expect, test } from "vitest";
import { makeRng } from "../../src/harness/random.js";

describe("makeRng", () => {
  test("the same seed yields the same sequence", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  test("different seeds diverge", () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(Array.from({ length: 10 }, () => a.next())).not.toEqual(
      Array.from({ length: 10 }, () => b.next()),
    );
  });

  test("next() stays in [0, 1)", () => {
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("int() stays in [0, maxExclusive)", () => {
    const r = makeRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
  });

  test("int(0) is 0 rather than NaN — a generator asking for nothing gets nothing", () => {
    expect(makeRng(3).int(0)).toBe(0);
  });

  test("pick() returns a member of the array", () => {
    const r = makeRng(11);
    const items = ["a", "b", "c"] as const;
    for (let i = 0; i < 100; i++) expect(items).toContain(r.pick(items));
  });

  test("pick() on an empty array throws rather than returning undefined", () => {
    expect(() => makeRng(1).pick([])).toThrow(/empty/i);
  });

  test("two generators from one seed do not share state", () => {
    const a = makeRng(5);
    a.next();
    a.next();
    const b = makeRng(5);
    expect(b.next()).toBe(makeRng(5).next());
  });
});
