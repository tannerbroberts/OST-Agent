/**
 * The instrument for the meta vault's assumption test "Try to reproduce ten
 * recorded failures from the record alone" — read
 * `test/fixtures/record-replay/PROVENANCE.md` before believing anything here.
 *
 * This covers only the mechanical half the assumption test's own history
 * note describes: whether a recorded step carries enough (`cwd` and `argv`)
 * to reconstruct an executable invocation. Whether the reconstructed command
 * reproduces the original exit code is a person's judgement and is not
 * asserted here.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LoopRunRecord, LoopStepRecord } from "../../src/loop/health.js";
import { reconstructInvocation, recentNonZeroExitSteps } from "../../src/loop/replay.js";

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/record-replay/steps.json"), "utf8"),
) as { steps: LoopStepRecord[] };

const baseStep: LoopStepRecord = { phase: "check", command: "x", exit: 1, durationMs: 1, at: "2026-01-01T00:00:00.000Z" };

describe("reconstructInvocation", () => {
  it("reconstructs when both cwd and argv are recorded", () => {
    const step: LoopStepRecord = { ...baseStep, cwd: "/repo", argv: ["node", "cli.js", "check"] };
    expect(reconstructInvocation(step)).toEqual({ cwd: "/repo", argv: ["node", "cli.js", "check"] });
  });

  it("refuses to reconstruct without cwd", () => {
    const step: LoopStepRecord = { ...baseStep, argv: ["node", "cli.js"] };
    expect(reconstructInvocation(step)).toBeNull();
  });

  it("refuses to reconstruct without argv", () => {
    const step: LoopStepRecord = { ...baseStep, cwd: "/repo" };
    expect(reconstructInvocation(step)).toBeNull();
  });

  it("refuses to reconstruct an empty argv — nothing to spawn", () => {
    const step: LoopStepRecord = { ...baseStep, cwd: "/repo", argv: [] };
    expect(reconstructInvocation(step)).toBeNull();
  });

  it("refuses an empty-string cwd — a pre-fix line lacking the field entirely", () => {
    const step: LoopStepRecord = { ...baseStep, cwd: "", argv: ["node"] };
    expect(reconstructInvocation(step)).toBeNull();
  });

  it("returns a copy — mutating the result cannot corrupt the record", () => {
    const argv = ["node", "cli.js"];
    const step: LoopStepRecord = { ...baseStep, cwd: "/repo", argv };
    const result = reconstructInvocation(step)!;
    result.argv.push("--extra");
    expect(argv).toEqual(["node", "cli.js"]);
  });
});

describe("recentNonZeroExitSteps", () => {
  const run = (steps: LoopStepRecord[]): LoopRunRecord => ({
    runId: "r",
    startedAt: steps[0]?.at ?? "2026-01-01T00:00:00.000Z",
    loopVersion: "0.0.0",
    cliVersion: "0.0.0",
    steps,
  });

  it("keeps only non-zero exits, newest first by the step's own `at`", () => {
    const steps: LoopStepRecord[] = [
      { ...baseStep, at: "2026-01-01T00:00:00.000Z", exit: 0 },
      { ...baseStep, at: "2026-01-02T00:00:00.000Z", exit: 1 },
      { ...baseStep, at: "2026-01-03T00:00:00.000Z", exit: 2 },
    ];
    const result = recentNonZeroExitSteps([run(steps)]);
    expect(result.map((s) => s.at)).toEqual(["2026-01-03T00:00:00.000Z", "2026-01-02T00:00:00.000Z"]);
  });

  it("excludes a refused step — it never spawned a command to reproduce", () => {
    const steps: LoopStepRecord[] = [
      { ...baseStep, at: "2026-01-01T00:00:00.000Z", exit: 1 },
      { ...baseStep, at: "2026-01-02T00:00:00.000Z", exit: 13, refused: "spend-ceiling" },
    ];
    const result = recentNonZeroExitSteps([run(steps)]);
    expect(result).toHaveLength(1);
    expect(result[0].at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("orders across runs by step `at`, not by run order", () => {
    const older = run([{ ...baseStep, at: "2026-01-01T00:00:00.000Z", exit: 1 }]);
    const newer = run([{ ...baseStep, at: "2026-01-05T00:00:00.000Z", exit: 1 }]);
    const result = recentNonZeroExitSteps([older, newer]);
    expect(result.map((s) => s.at)).toEqual(["2026-01-05T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]);
  });

  it("respects the limit", () => {
    const steps: LoopStepRecord[] = Array.from({ length: 15 }, (_, i) => ({
      ...baseStep,
      at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      exit: 1,
    }));
    expect(recentNonZeroExitSteps([run(steps)], 10)).toHaveLength(10);
  });
});

describe("the ten most recent real non-refused failures in the meta vault's ledger", () => {
  it("carries the fixture's committed shape — ten steps, none refused", () => {
    expect(fixture.steps).toHaveLength(10);
    expect(fixture.steps.every((s) => s.refused === undefined)).toBe(true);
    expect(fixture.steps.every((s) => s.exit !== 0)).toBe(true);
  });

  it("closes at least 5 of 10 under cwd-and-argv — the assumption test's pre-committed bar", () => {
    const reconstructed = fixture.steps.filter((s) => reconstructInvocation(s) !== null);
    expect(reconstructed.length).toBeGreaterThanOrEqual(5);
  });
});
