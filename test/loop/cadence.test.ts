/**
 * The cadence gate (F1) — and the wedge it must not become.
 *
 * The interesting case is the future-stamped record. The ledger is sorted
 * newest first, so one line dated ahead of the clock answers "when did this
 * vault last fire" until the clock catches up: permanent not-due, clearable
 * only by a human editing a JSONL file. Criterion R2 is the repo's note about
 * what happens to a safety mechanism that turns into a permanent red — it gets
 * routed around.
 *
 * Clamping the stamp to `now` is the tempting fix and it is worse: the clamp
 * moves with the clock, so `last` is always `now` and the window never elapses
 * either. Ignoring the record is what has an exit.
 */
import { describe, expect, test } from "vitest";
import { evaluateCadence, parseCadence } from "../../src/loop/cadence.js";
import type { LoopRunRecord } from "../../src/loop/health.js";

const HOUR = 60 * 60 * 1000;
const now = Date.parse("2026-07-29T12:00:00.000Z");

function run(startedAt: string, verdict?: LoopRunRecord["verdict"]): LoopRunRecord {
  return { runId: startedAt, startedAt, loopVersion: "0", cliVersion: "0", steps: [], ...(verdict ? { verdict } : {}) };
}
/** As `readRuns` hands them over: newest first. */
function ledger(...records: LoopRunRecord[]): LoopRunRecord[] {
  return [...records].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

describe("parseCadence refuses to guess", () => {
  test("declared durations parse", () => {
    expect(parseCadence("30m")).toBe(30 * 60_000);
    expect(parseCadence("6h")).toBe(6 * HOUR);
    expect(parseCadence(" 1D ")).toBe(24 * HOUR);
  });

  test("anything it cannot read is null, which means never — not a default", () => {
    for (const spec of [undefined, null, "", "  ", "6", "6 hours", "0h", "-2h", "6w", "1.5h"]) {
      expect(parseCadence(spec), `${JSON.stringify(spec)} must not parse`).toBeNull();
    }
  });
});

describe("evaluateCadence", () => {
  test("an undeclared cadence is never due, and says why", () => {
    const v = evaluateCadence({ runs: [], now, cadenceMs: null });
    expect(v.status).toBe("undeclared");
    expect(v.reason).toMatch(/loop\.cadence/);
  });

  test("a vault that has never fired is due", () => {
    expect(evaluateCadence({ runs: [], now, cadenceMs: 6 * HOUR }).status).toBe("due");
  });

  test("inside the window it is not-elapsed, and names when it next fires", () => {
    const v = evaluateCadence({ runs: ledger(run("2026-07-29T09:00:00.000Z", "healthy")), now, cadenceMs: 6 * HOUR });
    expect(v.status).toBe("not-elapsed");
    expect(v.nextDueAt).toBe("2026-07-29T15:00:00.000Z");
  });

  test("past the window it is due, and carries the last verdict so silence is legible", () => {
    const v = evaluateCadence({ runs: ledger(run("2026-07-29T05:00:00.000Z", "no-op")), now, cadenceMs: 6 * HOUR });
    expect(v.status).toBe("due");
    expect(v.lastVerdict).toBe("no-op");
  });

  test("a future-stamped record does not put the vault in permanent not-due", () => {
    const v = evaluateCadence({
      runs: ledger(run("2027-01-01T00:00:00.000Z", "healthy"), run("2026-07-29T05:00:00.000Z", "healthy")),
      now,
      cadenceMs: 6 * HOUR,
    });
    expect(v.status).toBe("due");
    expect(v.lastFiredAt).toBe("2026-07-29T05:00:00.000Z");
    expect(v.ignoredFuture).toBe(1);
  });

  test("a future-stamped record still bounds nothing when it is the only one", () => {
    // Self-healing: the vault fires once, which writes a present-stamped record,
    // and from then on the window is bounded by a real firing again.
    const v = evaluateCadence({ runs: ledger(run("2027-01-01T00:00:00.000Z")), now, cadenceMs: 6 * HOUR });
    expect(v.status).toBe("due");
    expect(v.ignoredFuture).toBe(1);
  });

  test("ignoring the future record does not turn into a hot loop", () => {
    // The firing the future record provoked writes its own present-stamped
    // record, and THAT is what bounds the next window.
    const after = ledger(run("2027-01-01T00:00:00.000Z"), run(new Date(now).toISOString(), "healthy"));
    const v = evaluateCadence({ runs: after, now: now + 60_000, cadenceMs: 6 * HOUR });
    expect(v.status).toBe("not-elapsed");
  });

  test("a record stamped exactly now still bounds the window", () => {
    const v = evaluateCadence({ runs: ledger(run(new Date(now).toISOString())), now, cadenceMs: 6 * HOUR });
    expect(v.status).toBe("not-elapsed");
    expect(v.ignoredFuture).toBe(0);
  });
});
