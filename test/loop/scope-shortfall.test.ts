/**
 * The instrument for "Compare what the run attempted against what it set out
 * to do, and report the shortfall".
 *
 * The node's own definition of done names the load-bearing assertion: "intended
 * scope is recorded at run start, immutable once the gate is known, and the
 * end-of-run shortfall is diffed against that recorded declaration rather than
 * a restated one." Three claims, tested separately:
 *
 *   - recorded at run start: a declaration succeeds before any step exists.
 *   - immutable once the gate is known: a declaration after a step is recorded
 *     refuses, and so does a second declaration even before any step.
 *   - diffed against the recorded declaration, not a restated one:
 *     `computeShortfall` takes no "declared" argument at all — there is no
 *     parameter a caller could use to restate it — and reads the frozen file
 *     off disk instead.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { appendStep, startRun, type LoopRunRecord } from "../../src/loop/health.js";
import { computeShortfall, declareScope, readScope, shortfallReport } from "../../src/loop/scope.js";

let vault: string;

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: vault, stdio: "ignore" });
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-scope-"));
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  fs.writeFileSync(path.join(vault, "Root.md"), "# Root\n");
  git("add", "-A");
  git("commit", "-qm", "root");
});
afterEach(() => fs.rmSync(vault, { recursive: true, force: true }));

const meta = { loopVersion: "0.0.0", cliVersion: "0.0.0" };

describe("recorded at run start", () => {
  test("a declaration before any step succeeds and is readable back", () => {
    const run = startRun(vault, meta);
    const declared = declareScope(vault, run, "build the shortfall report");
    expect(declared.runId).toBe(run.runId);
    expect(readScope(vault, run.runId)).toEqual(declared);
  });
});

describe("immutable once the gate is known", () => {
  test("a declaration after a step is already recorded is refused", () => {
    const run = startRun(vault, meta);
    const withStep = appendStep(vault, { phase: "check", command: "check", exit: 1, durationMs: 1 });
    expect(withStep.runId).toBe(run.runId);
    expect(() => declareScope(vault, withStep, "narrowed after seeing the gate fail")).toThrow(
      /already.*recorded|first step/i,
    );
    // The refusal must not have written anything — the run still has no scope.
    expect(readScope(vault, run.runId)).toBeNull();
  });

  test("a second declaration is refused, even with no step in between", () => {
    const run = startRun(vault, meta);
    const first = declareScope(vault, run, "build the shortfall report");
    expect(() => declareScope(vault, run, "build something smaller instead")).toThrow(/already declared/i);
    // The original declaration stands, untouched.
    expect(readScope(vault, run.runId)).toEqual(first);
  });
});

describe("the end-of-run shortfall is diffed against the recorded declaration, not a restated one", () => {
  test("computeShortfall has no parameter a caller could use to restate the declaration", () => {
    // The signature itself is the assertion: (dir, runId, attempted). A function
    // that could be handed a different "declared" string at seal time would let
    // a run's own restatement stand in for what it actually committed to.
    expect(computeShortfall.length).toBe(3);
  });

  test("the diff comes from the frozen file even if the run record in memory is stale or forged", () => {
    const run = startRun(vault, meta);
    declareScope(vault, run, "build the shortfall report and wire it into loop seal");

    // Simulate a second, unrelated in-memory LoopRunRecord for the same runId —
    // computeShortfall never looks at it, only at runId, so it cannot be fed a
    // restated declaration through it.
    const forged: LoopRunRecord = { ...run, steps: [{ phase: "check", command: "x", exit: 0, durationMs: 1, at: "" }] };
    void forged;

    const shortfall = computeShortfall(vault, run.runId, "wired the shortfall report into loop seal");
    expect(shortfall).not.toBeNull();
    expect(shortfall!.declared).toBe("build the shortfall report and wire it into loop seal");
  });

  test("a run that never declared a scope has nothing to diff against", () => {
    const run = startRun(vault, meta);
    expect(computeShortfall(vault, run.runId, "did some stuff")).toBeNull();
  });

  test("terms in the declaration the attempt does not repeat are the shortfall", () => {
    const run = startRun(vault, meta);
    declareScope(vault, run, "build the shortfall report and wire it into loop seal");
    const shortfall = computeShortfall(vault, run.runId, "build the shortfall report");
    expect(shortfall).not.toBeNull();
    expect(shortfall!.dropped).toContain("wire");
    expect(shortfall!.dropped).toContain("seal");
    expect(shortfall!.dropped).not.toContain("build");
  });

  test("attempting everything declared reports no shortfall", () => {
    const run = startRun(vault, meta);
    declareScope(vault, run, "build the shortfall report");
    const shortfall = computeShortfall(vault, run.runId, "build the shortfall report, exactly as declared");
    expect(shortfall!.dropped).toEqual([]);
  });
});

describe("the report is a fact, not a verdict", () => {
  test("a report is printed whether or not anything was dropped", () => {
    const run = startRun(vault, meta);
    declareScope(vault, run, "build the shortfall report");
    const clean = computeShortfall(vault, run.runId, "build the shortfall report");
    const short = computeShortfall(vault, run.runId, "look into it");
    expect(shortfallReport(clean).length).toBeGreaterThan(0);
    expect(shortfallReport(short).length).toBeGreaterThan(0);
    expect(shortfallReport(clean).join("\n")).not.toMatch(/shortfall:/);
    expect(shortfallReport(short).join("\n")).toMatch(/shortfall:/);
  });

  test("nothing is printed for a run with no declaration to compare against", () => {
    expect(shortfallReport(null)).toEqual([]);
  });
});
