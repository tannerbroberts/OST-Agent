/**
 * What the resumer reads out of the journal, and what it refuses to run.
 *
 * `kill-restart-idempotence.test.ts` is the end-to-end instrument: it kills a
 * real pass at twenty points and checks the vault. This is the unit beneath it,
 * and it exists for the cases that instrument cannot reach cheaply — a failed
 * step, a sealed account, a step whose author got replay-safety wrong.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { appendStep, readOpenRun, sealRun, startRun } from "../../src/loop/health.js";
import { runResumableSteps, resumeState, resumeSummary, type ResumableStep } from "../../src/loop/resume.js";
import { TEMP_WRITE_SUFFIX } from "../../src/fs/atomic-write.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-resume-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A step over an in-memory effect, so the unit tests need no vault. */
function step(id: string, done: Set<string>, opts: { breaks?: boolean } = {}): ResumableStep {
  return {
    id,
    phase: "pass",
    command: `do ${id}`,
    applied: () => done.has(id),
    apply: () => {
      if (!opts.breaks) done.add(id);
    },
  };
}

describe("what the journal says is left", () => {
  test("a fresh vault has nothing to resume", () => {
    const state = resumeState(dir);
    expect(state).toEqual({ completed: [], inFlight: [], interrupted: false });
    expect(resumeSummary(state)).toContain("nothing to resume");
  });

  test("completions are carried forward and the announced-but-unfinished step is named", () => {
    startRun(dir, { loopVersion: "t", cliVersion: "t" });
    const done = new Set<string>();
    runResumableSteps(dir, [step("a", done)]);
    // A second step that announced itself and never came back — the shape a
    // process killed inside `apply` leaves.
    const open = readOpenRun(dir)!;
    fs.appendFileSync(
      path.join(dir, ".git/ost-agent/journal.jsonl"),
      JSON.stringify({ kind: "intent", runId: open.runId, stepId: "b", phase: "pass", command: "do b", at: new Date().toISOString() }) + "\n",
    );

    const state = resumeState(dir);
    expect(state.completed).toEqual(["a"]);
    expect(state.inFlight).toEqual(["b"]);
    expect(state.interrupted).toBe(true);
    expect(resumeSummary(state)).toContain("b was announced but never completed");
  });

  test("a seal closes the account — work before it is not carried into the next run", () => {
    startRun(dir, { loopVersion: "t", cliVersion: "t" });
    runResumableSteps(dir, [step("a", new Set())]);
    sealRun(dir, {});

    const state = resumeState(dir);
    expect(state.completed, "a sealed run's steps belong to a finished account").toEqual([]);
    expect(state.interrupted).toBe(false);
  });

  test("a crash line does NOT close it — the sweep writes that line over the record it preserves", () => {
    startRun(dir, { loopVersion: "t", cliVersion: "t" });
    runResumableSteps(dir, [step("a", new Set())]);
    // The next firing sweeps the unsealed marker, appending `crash`.
    startRun(dir, { loopVersion: "t", cliVersion: "t" });

    expect(resumeState(dir).completed, "the dead run's finished work is exactly what a restart needs").toEqual(["a"]);
  });

  test("a step that ran and failed is not a step that is done", () => {
    startRun(dir, { loopVersion: "t", cliVersion: "t" });
    appendStep(dir, { phase: "check", command: "prove it", stepId: "check-it", exit: 1, durationMs: 1 });

    expect(resumeState(dir).completed).toEqual([]);
  });

  test("a step recorded without an id cannot be skipped", () => {
    startRun(dir, { loopVersion: "t", cliVersion: "t" });
    appendStep(dir, { phase: "pass", command: "something a caller named nothing", exit: 0, durationMs: 1 });

    expect(resumeState(dir).completed).toEqual([]);
  });
});

describe("what the runner does with each step", () => {
  test("skipped, verified and ran are three different answers", () => {
    startRun(dir, { loopVersion: "t", cliVersion: "t" });
    const done = new Set<string>();
    runResumableSteps(dir, [step("a", done)]); // a is now journaled and done
    done.add("b"); // b's effect landed, but nothing journaled it

    const outcomes = runResumableSteps(dir, [step("a", done), step("b", done), step("c", done)]);

    expect(outcomes).toEqual([
      { id: "a", disposition: "skipped" },
      { id: "b", disposition: "verified" },
      { id: "c", disposition: "ran" },
    ]);
  });

  test("a verified step is journaled as completed, so the next restart skips it", () => {
    startRun(dir, { loopVersion: "t", cliVersion: "t" });
    const done = new Set(["a"]);

    expect(runResumableSteps(dir, [step("a", done)])[0].disposition).toBe("verified");
    expect(runResumableSteps(dir, [step("a", done)])[0].disposition).toBe("skipped");
  });

  test("a step whose effect its own applied() cannot see is refused, loudly, the first time it runs", () => {
    startRun(dir, { loopVersion: "t", cliVersion: "t" });

    expect(() => runResumableSteps(dir, [step("a", new Set(), { breaks: true })])).toThrow(/not replay-safe/);
    // And it is not recorded as done: a restart must attempt it again.
    expect(resumeState(dir).completed).toEqual([]);
    expect(resumeState(dir).inFlight, "the journal still says where it stopped").toEqual(["a"]);
  });

  test("staging files from a killed write are swept before any step runs", () => {
    const orphan = path.join(dir, `.Alpha.md.999999${TEMP_WRITE_SUFFIX}`);
    fs.writeFileSync(orphan, "half a node");
    startRun(dir, { loopVersion: "t", cliVersion: "t" });

    runResumableSteps(dir, [step("a", new Set())]);

    expect(fs.existsSync(orphan), "residue in front of an auto-committing tool is a file it commits").toBe(false);
  });
});
