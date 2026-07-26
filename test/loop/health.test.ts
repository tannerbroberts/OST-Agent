import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  appendStep, computeVerdict, readRuns, runsPath, sealRun, startRun, sweepCrashed, updateOpenRun,
  type LoopRunRecord,
} from "../../src/loop/health.js";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-loop-health-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const meta = { loopVersion: "0.14.0", cliVersion: "0.14.0" };
const step = (phase: string, exit = 0) => ({ phase, command: `cmd-${phase}`, exit, durationMs: 5 });

describe("loop health records", () => {
  test("a full work run with all phases seals healthy", () => {
    startRun(dir, meta);
    updateOpenRun(dir, { directive: "work", workItem: "Fix the door" });
    for (const p of ["sense", "decide", "build", "ost-pass"]) appendStep(dir, step(p));
    const sealed = sealRun(dir);
    expect(sealed.verdict).toBe("healthy");
    expect(readRuns(dir)[0].workItem).toBe("Fix the door");
  });

  test("one non-zero exit poisons the run: unhealthy", () => {
    startRun(dir, meta);
    updateOpenRun(dir, { directive: "work" });
    for (const p of ["sense", "decide"]) appendStep(dir, step(p));
    appendStep(dir, step("build", 1));
    appendStep(dir, step("ost-pass"));
    expect(sealRun(dir).verdict).toBe("unhealthy");
  });

  test("a skipped required phase is unhealthy — omission is visible", () => {
    startRun(dir, meta);
    updateOpenRun(dir, { directive: "work" });
    for (const p of ["sense", "decide", "build"]) appendStep(dir, step(p)); // no ost-pass
    expect(sealRun(dir).verdict).toBe("unhealthy");
  });

  test("a no-op directive seals no-op without required phases", () => {
    startRun(dir, meta);
    updateOpenRun(dir, { directive: "no-op" });
    expect(sealRun(dir).verdict).toBe("no-op");
  });

  test("a restore run needs at least one step to count as healthy", () => {
    startRun(dir, meta);
    updateOpenRun(dir, { directive: "restore" });
    expect(sealRun(dir).verdict).toBe("unhealthy");
    startRun(dir, meta);
    updateOpenRun(dir, { directive: "restore" });
    appendStep(dir, step("build"));
    expect(sealRun(dir).verdict).toBe("healthy");
  });

  test("an unsealed marker from a dead process is swept as crashed on the next start", () => {
    startRun(dir, meta);
    appendStep(dir, step("sense"));
    // process dies here — no seal. Next firing:
    const next = startRun(dir, meta);
    const runs = readRuns(dir);
    expect(runs.some((r) => r.verdict === "crashed")).toBe(true);
    expect(next.runId).not.toBe(runs.find((r) => r.verdict === "crashed")!.runId);
  });

  test("sweepCrashed with no marker is a no-op returning null", () => {
    expect(sweepCrashed(dir)).toBe(null);
  });

  test("runs.jsonl is append-only and survives a corrupt line", () => {
    startRun(dir, meta); updateOpenRun(dir, { directive: "no-op" }); sealRun(dir);
    fs.appendFileSync(runsPath(dir), "not json\n");
    startRun(dir, meta); updateOpenRun(dir, { directive: "no-op" }); sealRun(dir);
    expect(readRuns(dir)).toHaveLength(2); // corrupt line skipped, both real runs read
  });

  test("there is no way to assert a verdict from outside", () => {
    const run: LoopRunRecord = {
      runId: "r", startedAt: "2026-07-26T00:00:00Z", loopVersion: "x", cliVersion: "x",
      directive: "work", steps: [], verdict: "healthy", // lies in the marker...
    };
    expect(computeVerdict(run)).toBe("unhealthy"); // ...are recomputed away at seal
  });

  test("fifty runs opened back to back never share a runId", () => {
    // The id derives from the start timestamp, and a sweep plus a start is only
    // two small writes — two firings can easily open inside the same millisecond.
    // A collision would give a crashed run and its successor the same identity,
    // which is the one thing a run record must never lose.
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(startRun(dir, meta).runId);
    expect(ids.size).toBe(50);
  });
});
