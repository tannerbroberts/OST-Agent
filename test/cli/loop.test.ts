import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { readOpenRun, readRuns } from "../../src/loop/health.js";

const run = promisify(execFile);
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

let dir: string;
// A real vault, not a bare `ost.config.yaml`: `seal` runs the tree invariants
// itself, and a directory with no root Outcome fails `single-outcome` — so a
// config-only fixture can never seal healthy no matter how green its phases are.
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cli-loop-"));
  await initVault(dir, "Reach 10k DAU");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function cli(args: string[]) {
  return run("npx", ["tsx", CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
}

describe("ost-agent loop start/step/seal", () => {
  test("start opens a run; step records the wrapped command's exit; seal computes the verdict", async () => {
    await cli(["loop", "start", "--vault", dir]);
    expect(readOpenRun(dir)).not.toBe(null);

    await cli(["loop", "step", "--phase", "sense", "--vault", dir, "--", "node", "-e", "process.exit(0)"]);
    await cli(["loop", "decide", "Fix the door", "--vault", dir]);
    await cli(["loop", "step", "--phase", "build", "--vault", dir, "--", "node", "-e", "process.exit(0)"]);
    await cli(["loop", "step", "--phase", "ost-pass", "--vault", dir, "--", "node", "-e", "process.exit(0)"]);

    const { stdout } = await cli(["loop", "seal", "--vault", dir]);
    expect(stdout).toContain("healthy");
    const [sealed] = readRuns(dir);
    expect(sealed.verdict).toBe("healthy");
    expect(sealed.workItem).toBe("Fix the door");
    expect(sealed.steps.map((s) => s.phase)).toContain("check"); // seal ran the invariants itself
  }, 60_000);

  test("a failing wrapped command propagates its exit code and poisons the run", async () => {
    await cli(["loop", "start", "--vault", dir]);
    await expect(
      cli(["loop", "step", "--phase", "build", "--vault", dir, "--", "node", "-e", "process.exit(3)"]),
    ).rejects.toMatchObject({ code: 3 });

    await expect(cli(["loop", "seal", "--vault", dir])).rejects.toMatchObject({ code: 1 });
    expect(readRuns(dir)[0].verdict).toBe("unhealthy");
  }, 60_000);

  test("step without an open run refuses loudly", async () => {
    await expect(
      cli(["loop", "step", "--phase", "sense", "--vault", dir, "--", "node", "-e", "0"]),
    ).rejects.toThrow(/loop start/);
  }, 30_000);

  test("a crashed prior run is swept and visible after the next start", async () => {
    await cli(["loop", "start", "--vault", dir]); // opened, never sealed — "the process died"
    await cli(["loop", "start", "--vault", dir]);
    expect(readRuns(dir).some((r) => r.verdict === "crashed")).toBe(true);
  }, 60_000);

  test("a broken tree seals unhealthy even when every phase was green", async () => {
    // The reason `seal` runs `checkInvariants` itself rather than trusting a
    // phase to have done it: a firing can run every command successfully and
    // still leave the tree it maintains in a state the product refuses.
    fs.writeFileSync(
      path.join(dir, "An opportunity pointing nowhere.md"),
      "---\ntype: Opportunity\nevidence: assertion\n---\n#Opportunity\n[[A node that does not exist]]\n",
      "utf8",
    );

    await cli(["loop", "start", "--vault", dir]);
    for (const phase of ["sense", "build", "ost-pass"]) {
      await cli(["loop", "step", "--phase", phase, "--vault", dir, "--", "node", "-e", "process.exit(0)"]);
    }
    await cli(["loop", "decide", "Reach 10k DAU", "--vault", dir]);

    await expect(cli(["loop", "seal", "--vault", dir])).rejects.toMatchObject({ code: 1 });
    const [sealed] = readRuns(dir);
    expect(sealed.verdict).toBe("unhealthy");
    expect(sealed.steps.find((s) => s.phase === "check")?.exit).toBe(1);
  }, 60_000);

  test("a wrapped command that never runs is recorded as a failure, not skipped", async () => {
    // `spawnSync` on a binary that does not exist returns status null and sets
    // `error`. Treating that as anything but a failed step would let a phase
    // whose command was never even found seal healthy.
    await cli(["loop", "start", "--vault", dir]);
    await expect(
      cli(["loop", "step", "--phase", "build", "--vault", dir, "--", "definitely-not-a-real-binary-xyz"]),
    ).rejects.toMatchObject({ code: 1 });

    const open = readOpenRun(dir);
    expect(open?.steps).toHaveLength(1);
    expect(open?.steps[0].exit).not.toBe(0);
  }, 30_000);
});
