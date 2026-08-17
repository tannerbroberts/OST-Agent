import { describe, expect, test } from "vitest";
import { renderCanary, runCanary, type CanaryProcess } from "../../src/eval/canary.js";

/**
 * "Canary the changed process against the old one" — the solution's whole
 * advantage over every sibling in "A change I ship can only reach the agent
 * by stopping it first" is that the old process never stops: run it and the
 * candidate over the same input, capture both outputs, and never let the
 * candidate's failure or divergence touch what the incumbent produced.
 *
 * This suite is the property test, not the human judgement test. It proves
 * what a spec can prove — that the two runs saw identical input and that the
 * incumbent's result survives a candidate that errors or disagrees. It does
 * NOT decide whether two outputs are comparable enough for a person to judge
 * in a couple of minutes; that is "Timed side-by-side judgement of canary
 * output", and it needs a human and a clock.
 */

describe("identical input", () => {
  test("both processes receive an equal, independently-owned copy of the input", async () => {
    const seenByIncumbent: number[] = [];
    const seenByCandidate: number[] = [];
    const incumbent: CanaryProcess<{ n: number }, number> = (input) => {
      seenByIncumbent.push(input.n);
      return input.n * 2;
    };
    const candidate: CanaryProcess<{ n: number }, number> = (input) => {
      input.n = 999; // a candidate that mutates its input must not affect the incumbent's
      seenByCandidate.push(input.n);
      return input.n * 2;
    };

    const result = await runCanary({ n: 3 }, incumbent, candidate);

    expect(seenByIncumbent).toEqual([3]);
    expect(seenByCandidate).toEqual([999]);
    expect(result.incumbent).toBe(6); // untouched by the candidate's mutation
  });
});

describe("both outputs are captured for comparison", () => {
  test("a candidate whose output matches the incumbent's is not marked diverged", async () => {
    const echo: CanaryProcess<string, string> = (s) => s.toUpperCase();
    const result = await runCanary("hello", echo, echo);
    expect(result.incumbent).toBe("HELLO");
    expect(result.candidate).toEqual({ ok: true, output: "HELLO" });
    expect(result.diverged).toBe(false);
  });

  test("a candidate whose output differs is captured and flagged, not hidden", async () => {
    const incumbent: CanaryProcess<string, string> = (s) => s.toUpperCase();
    const candidate: CanaryProcess<string, string> = (s) => s.toLowerCase();
    const result = await runCanary("Hello", incumbent, candidate);
    expect(result.incumbent).toBe("HELLO");
    expect(result.candidate).toEqual({ ok: true, output: "hello" });
    expect(result.diverged).toBe(true);
  });
});

describe("a canary that errors or diverges leaves the incumbent's result untouched", () => {
  test("a throwing candidate never reaches or replaces the incumbent's output", async () => {
    const incumbent: CanaryProcess<number, number> = (n) => n + 1;
    const candidate: CanaryProcess<number, number> = () => {
      throw new Error("candidate blew up");
    };

    const result = await runCanary(5, incumbent, candidate);

    expect(result.incumbent).toBe(6);
    expect(result.candidate.ok).toBe(false);
    expect(result.candidate.ok === false && result.candidate.error).toBe("candidate blew up");
    expect(result.diverged).toBe(true);
  });

  test("a rejecting async candidate is caught the same way", async () => {
    const incumbent: CanaryProcess<number, number> = async (n) => n + 1;
    const candidate: CanaryProcess<number, number> = async () => {
      throw new Error("async candidate rejected");
    };

    const result = await runCanary(5, incumbent, candidate);

    expect(result.incumbent).toBe(6);
    expect(result.candidate).toEqual({ ok: false, error: "async candidate rejected" });
  });

  test("a non-Error throw is still captured as a string, not left to crash the harness", async () => {
    const incumbent: CanaryProcess<number, number> = (n) => n;
    const candidate: CanaryProcess<number, number> = () => {
      throw "not an Error instance";
    };

    const result = await runCanary(1, incumbent, candidate);
    expect(result.candidate).toEqual({ ok: false, error: "not an Error instance" });
  });

  test("an incumbent failure is never swallowed into an invented result", async () => {
    const incumbent: CanaryProcess<number, number> = () => {
      throw new Error("incumbent is already broken");
    };
    const candidate: CanaryProcess<number, number> = (n) => n;

    await expect(runCanary(1, incumbent, candidate)).rejects.toThrow("incumbent is already broken");
  });
});

describe("the rendered side-by-side view", () => {
  test("shows both outputs when the candidate matches", async () => {
    const echo: CanaryProcess<string, string> = (s) => s;
    const rendered = renderCanary(await runCanary("same", echo, echo));
    expect(rendered).toContain('incumbent: "same"');
    expect(rendered).toContain('candidate: "same"');
    expect(rendered).toContain("MATCH");
  });

  test("marks divergence without discarding the candidate's output", async () => {
    const incumbent: CanaryProcess<string, string> = (s) => s;
    const candidate: CanaryProcess<string, string> = (s) => `${s}!`;
    const rendered = renderCanary(await runCanary("same", incumbent, candidate));
    expect(rendered).toContain('incumbent: "same"');
    expect(rendered).toContain('candidate: "same!"');
    expect(rendered).toContain("DIVERGED");
  });

  test("reports the candidate's error without hiding the incumbent's result", async () => {
    const incumbent: CanaryProcess<string, string> = (s) => s;
    const candidate: CanaryProcess<string, string> = () => {
      throw new Error("boom");
    };
    const rendered = renderCanary(await runCanary("same", incumbent, candidate));
    expect(rendered).toContain('incumbent: "same"');
    expect(rendered).toContain("ERROR — boom");
    expect(rendered).toContain("untouched by the candidate's failure");
  });
});
