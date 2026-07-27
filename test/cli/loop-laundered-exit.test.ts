/**
 * `loop step` refuses a command that cannot come out red — end to end.
 *
 * The unit tests in `test/loop/exit-laundering.test.ts` pin the detection. This
 * pins the thing that actually matters to a later reader of `runs.jsonl`: that
 * the refusal happens *before* anything is written, so a laundered step never
 * reaches the record at all.
 *
 * The case that produced it: `bash -c "npx vitest run 2>&1 | tail -25"` recorded
 * exit 0 while the shell was printing `vitest: not found`. The pipeline's status
 * was `tail`'s, and `tail` succeeded at reading nothing.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readOpenRun } from "../../src/loop/health.js";
import { initVault } from "../../src/runner/init.js";

const run = promisify(execFile);
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cli-launder-"));
  await initVault(dir, "Reach 10k DAU");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function cli(args: string[]) {
  return run("npx", ["tsx", CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
}

/** execFile rejects on a non-zero exit; the error still carries stdout/stderr. */
async function cliExpectingFailure(args: string[]): Promise<{ code: number; stderr: string }> {
  try {
    await cli(args);
    throw new Error("expected the CLI to exit non-zero");
  } catch (e) {
    const err = e as { code?: number; stderr?: string; message: string };
    if (typeof err.code !== "number") throw e;
    return { code: err.code, stderr: err.stderr ?? "" };
  }
}

describe("loop step refuses an exit code that cannot report failure", () => {
  test("the observed case is refused, and nothing is recorded", async () => {
    await cli(["loop", "start", "--vault", dir]);

    const { code, stderr } = await cliExpectingFailure([
      "loop", "step", "--phase", "build", "--vault", dir,
      "--", "bash", "-c", "npx vitest run 2>&1 | tail -25",
    ]);

    expect(code).not.toBe(0);
    expect(stderr).toContain("cannot report failure");
    expect(stderr).toContain("set -o pipefail");

    // The point of the whole guard: the run is untouched, so a later reader is
    // not asked to distinguish this from an honest pass.
    const open = readOpenRun(dir);
    expect(open).not.toBe(null);
    expect(open?.steps ?? []).toHaveLength(0);
  });

  test("the same command with pipefail is accepted and recorded honestly", async () => {
    await cli(["loop", "start", "--vault", dir]);

    await cliExpectingFailure([
      "loop", "step", "--phase", "build", "--vault", dir,
      "--", "bash", "-c", "set -o pipefail; this-binary-does-not-exist | tail -5",
    ]);

    const steps = readOpenRun(dir)?.steps ?? [];
    expect(steps).toHaveLength(1);
    // pipefail is doing the work: without it this records 0, which is the bug.
    expect(steps[0].exit).not.toBe(0);
  });

  test("a direct argv command is untouched by the guard", async () => {
    await cli(["loop", "start", "--vault", dir]);
    await cli([
      "loop", "step", "--phase", "sense", "--vault", dir,
      "--", "node", "-e", "process.exit(0)",
    ]);

    const steps = readOpenRun(dir)?.steps ?? [];
    expect(steps).toHaveLength(1);
    expect(steps[0].exit).toBe(0);
  });
});
