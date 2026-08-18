/**
 * "Cost the chart before choosing the goal, so the substitution is a decision
 * and not a drift" — the capture half of "Estimate charting cost for three
 * past goals and check the estimates against what happened".
 *
 * That assumption test needs a human to estimate three ALREADY-CHARTED goals
 * from the goal statement alone and check the guess against the record — a
 * retrospective judgement this file cannot make. What a builder can make real
 * today is the capture the retrospective test depends on: checking an
 * estimate against what happened requires the estimate to have been recorded
 * BEFORE the goal was chosen, and until now nothing captured one, so every
 * such comparison would have to be reconstructed after the fact — the exact
 * drift this solution exists to prevent.
 *
 * This pins three things through the real CLI: `set-outcome` refuses to
 * adopt a goal with no charting-cost figure attached, a figure it does
 * accept is stamped with today's date and attached to the goal it prices,
 * and `rollup` reports every recorded figure beside how long that goal
 * actually stood. It does not, and cannot, say whether any estimate was any
 * GOOD — that stays a human's retrospective call.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";

// The local tsx binary, invoked directly rather than through `npx`.
// `npx` adds a process layer AND consults npm's cache, which takes a cacache
// lock; dozens of concurrent spawns on a small CI runner contend on that lock
// and can wedge the whole suite. Nothing here needs resolution — tsx is a
// devDependency, so the binary is already on disk.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");

const run = promisify(execFile);
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cli-chart-cost-"));
  await initVault(dir, "First mandate", "Project");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function cli(args: string[]) {
  // `execFile` spawns with no TTY attached, which is exactly the shape a
  // wrapper/unattended caller has — the shape `--charting-cost` must not
  // silently pass through unfilled.
  return run(TSX, [CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

describe("ost-agent set-outcome — the charting-cost figure it must now capture", () => {
  test("refuses to adopt a goal with no charting-cost estimate — no flag, no TTY to prompt on", async () => {
    await expect(cli(["set-outcome", "A goal nobody priced", "--vault", dir])).rejects.toThrow(
      /Charting-cost estimate.*no TTY to prompt/,
    );

    // Refused before anything moved: the prior mandate is still the config's outcome.
    const cfg = fs.readFileSync(path.join(dir, "ost.config.yaml"), "utf8");
    expect(cfg).toContain('outcome: "First mandate"');
  }, 30_000);

  test("refuses a --charting-cost value with no number in it", async () => {
    await expect(
      cli(["set-outcome", "A goal nobody priced", "--charting-cost", "no idea, hard to say", "--vault", dir]),
    ).rejects.toThrow(/states no number/);
  }, 30_000);

  test("--charting-cost is accepted, stamped with today's date, and attached to the goal it priced", async () => {
    const { stdout } = await cli([
      "set-outcome",
      "Reach ten real users",
      "--charting-cost",
      "6 evidence, 3 conversations, 9 days to a first actionable branch",
      "--vault",
      dir,
    ]);
    expect(stdout).toContain("charting-cost estimate recorded: 6 evidence, 3 conversations, 9 days to a first actionable branch");

    const root = fs.readFileSync(path.join(dir, "Project.md"), "utf8");
    expect(root).toContain(
      `charting-cost estimate for "Reach ten real users": 6 evidence, 3 conversations, 9 days to a first actionable branch (${isoToday()})`,
    );
  }, 30_000);
});

describe("ost-agent rollup — estimate reported against actual, per goal", () => {
  test("a superseded goal's estimate is reported beside how long it actually stood; the live goal shows no actual yet", async () => {
    await cli(["set-outcome", "Reach ten real users", "--charting-cost", "6 evidence, 3 conversations, 9 days", "--vault", dir]);
    await cli(["set-outcome", "Reach a hundred real users", "--charting-cost", "40 evidence, 12 conversations, 30 days", "--vault", dir]);

    const { stdout } = await cli(["rollup", "--vault", dir]);

    expect(stdout).toContain("Charting-cost estimates (2):");
    expect(stdout).toContain(`"Reach ten real users": 6 evidence, 3 conversations, 9 days (estimated ${isoToday()}) — actual: superseded after 0 day(s)`);
    expect(stdout).toContain(`"Reach a hundred real users": 40 evidence, 12 conversations, 30 days (estimated ${isoToday()}) — actual: current — not yet superseded`);
  }, 30_000);
});
