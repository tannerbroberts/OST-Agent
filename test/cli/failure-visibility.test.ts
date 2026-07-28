import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";

const run = promisify(execFile);
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cli-failure-"));
  // a real vault: `run` commits, so it needs the git repo `init` creates
  await initVault(dir, "Reach 10,000 daily active users");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Run the CLI with every Anthropic credential stripped, so the driver fails the way cron saw it fail. */
function cliNoCredentials(args: string[]) {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  return run("npx", ["tsx", CLI, ...args], { cwd: path.resolve(__dirname, "../.."), env });
}

function cli(args: string[]) {
  return run("npx", ["tsx", CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
}

describe("ost-agent run — a failed pass is visible to a machine", () => {
  test("exits non-zero and names the failure when the driver errors", async () => {
    // Give P2_map something to map, so it actually reaches the driver.
    const evidence = path.join(dir, ".ost-agent", "evidence");
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(
      path.join(evidence, "INBOX_test.md"),
      "# Players cannot find the game\n\nA player said they never come across games like this.",
      "utf8",
    );

    const failure = await cliNoCredentials(["run", "P2_map", "--vault", dir]).then(
      () => null,
      (e: { code?: number; stdout: string; stderr: string }) => e,
    );

    expect(failure, "a pass that dies on a driver error must not exit 0").not.toBeNull();
    expect(failure?.code).toBe(1);
    expect(`${failure?.stdout}${failure?.stderr}`).toMatch(/FAILED/);
  }, 60_000);

  test("exits 0 on a pass that does its work without erroring", async () => {
    const { stdout } = await cli(["run", "P1_ingest", "--vault", dir]);
    expect(stdout).toContain("P1_ingest");
    expect(stdout).not.toMatch(/FAILED/);
  }, 60_000);
});
