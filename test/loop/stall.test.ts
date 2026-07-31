/**
 * The stall detector — F4's escalation half.
 *
 * The per-firing half (a firing that changed nothing seals `no-op`) is pinned in
 * `health.test.ts`. This file pins the other half: a *run* of firings that moved
 * nothing escalates rather than continuing to read, one at a time, as success.
 *
 * The two tests that carry the design are the two measurement hazards the
 * readiness entry for F4 names by hand — a `crashed` record must not reset the
 * streak, and a vault alternating dry-run and timeout must still escalate. A
 * naive "count `no-op`, reset on anything else" counter passes every other test
 * here and fails those two, which is exactly why they are written.
 */
import { describe, expect, test } from "vitest";
import { assessStall, STALL_STREAK_THRESHOLD } from "../../src/loop/stall.js";
import type { LoopRunRecord, LoopVerdict } from "../../src/loop/health.js";

/**
 * A sealed record with a given verdict, stamped so the newest-first order the
 * ledger comes in is explicit here rather than incidental. `i` counts DOWN from
 * newest: `run(0, …)` is the most recent firing.
 */
function run(i: number, verdict: LoopVerdict | undefined): LoopRunRecord {
  const at = new Date(Date.UTC(2026, 6, 30, 12, 0, 0) - i * 60_000).toISOString();
  return {
    runId: `${at}-loop`,
    startedAt: at,
    endedAt: at,
    loopVersion: "0.0.0",
    cliVersion: "0.0.0",
    steps: [],
    ...(verdict !== undefined ? { verdict } : {}),
  };
}

/** Newest-first ledger from a list of verdicts written newest-first. */
function ledger(...verdicts: (LoopVerdict | undefined)[]): LoopRunRecord[] {
  return verdicts.map((v, i) => run(i, v));
}

describe("the streak", () => {
  test("an empty ledger is not stalled", () => {
    const s = assessStall([]);
    expect(s.stalled).toBe(false);
    expect(s.streak).toBe(0);
    expect(s.since).toBeUndefined();
  });

  test("a single no-op is ordinary, not an escalation", () => {
    const s = assessStall(ledger("no-op"));
    expect(s.stalled).toBe(false);
    expect(s.streak).toBe(1);
  });

  test("three consecutive no-ops escalate — F4's check, verbatim", () => {
    const s = assessStall(ledger("no-op", "no-op", "no-op"));
    expect(s.stalled).toBe(true);
    expect(s.streak).toBe(3);
    expect(s.threshold).toBe(STALL_STREAK_THRESHOLD);
  });

  test("`since` is the OLDEST firing in the streak — when the tree last moved", () => {
    // newest → oldest: two no-ops then a healthy one two firings back.
    const runs = ledger("no-op", "no-op", "no-op", "healthy");
    const s = assessStall(runs);
    // The healthy record is index 3; the streak is indices 0..2, oldest at 2.
    expect(s.since).toBe(runs[2].startedAt);
  });

  test("a healthy firing resets the streak to zero — the positive control", () => {
    // Without a reset the detector would report failure always; this is what
    // proves it does not. The most recent firing moved the tree.
    const s = assessStall(ledger("healthy", "no-op", "no-op", "no-op"));
    expect(s.stalled).toBe(false);
    expect(s.streak).toBe(0);
    expect(s.reason).toMatch(/advanced the tree/);
  });

  test("only firings back to the last healthy one count — older no-ops are already answered", () => {
    // A long-lived vault: it was stuck, recovered (healthy), and has since done
    // two dry passes. The streak is 2, not 2+however-many-before-the-recovery.
    const s = assessStall(ledger("no-op", "no-op", "healthy", "no-op", "no-op", "no-op", "no-op"));
    expect(s.streak).toBe(2);
    expect(s.stalled).toBe(false);
  });
});

describe("the two measurement hazards F4 names", () => {
  test("a `crashed` record does NOT reset the streak", () => {
    // The naive counter resets on any non-no-op and so reads this vault as never
    // stuck. It is stuck: three firings, none of which moved the tree.
    const s = assessStall(ledger("no-op", "crashed", "no-op"));
    expect(s.stalled).toBe(true);
    expect(s.streak).toBe(3);
  });

  test("a vault alternating dry-run and timeout still escalates", () => {
    // A timed-out firing is recorded `crashed` by the next `loop start`. A dead
    // vault that alternates dry pass / timeout / dry pass would escape a counter
    // that reset on `crashed`; here every one of these advanced nothing.
    const s = assessStall(ledger("crashed", "no-op", "crashed", "no-op"));
    expect(s.stalled).toBe(true);
    expect(s.streak).toBe(4);
  });

  test("an `unhealthy` firing is not progress either — it also extends the streak", () => {
    const s = assessStall(ledger("unhealthy", "no-op", "unhealthy"));
    expect(s.stalled).toBe(true);
    expect(s.streak).toBe(3);
  });
});

describe("robustness", () => {
  test("a record whose verdict was dropped is skipped, neither counted nor a reset", () => {
    // `readRuns` deletes an out-of-vocabulary verdict; such a line is unknown.
    // It must not manufacture an escalation (count) nor hide one (reset).
    const s = assessStall(ledger("no-op", undefined, "no-op", undefined, "no-op"));
    expect(s.streak).toBe(3);
    expect(s.stalled).toBe(true);
  });

  test("the threshold is a parameter — the wiring passes the default, tests can lower it", () => {
    expect(assessStall(ledger("no-op", "no-op"), 2).stalled).toBe(true);
    expect(assessStall(ledger("no-op"), 2).stalled).toBe(false);
  });

  test("it does not latch: the same ledger plus one healthy firing clears", () => {
    const stuck = ledger("no-op", "no-op", "no-op");
    expect(assessStall(stuck).stalled).toBe(true);
    // Prepend a healthy firing (now the newest) — no file edited, just a new
    // record. The streak is zero again.
    const recovered = [run(-1, "healthy"), ...stuck];
    expect(assessStall(recovered).stalled).toBe(false);
  });
});
