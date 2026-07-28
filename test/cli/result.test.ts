import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { Vault } from "../../src/ost/vault.js";

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cli-result-"));
  await initVault(dir, "Reach 10,000 daily active users");
  const vault = new Vault(dir);
  const root = vault.readTree().find((n) => n.layer === "Outcome")!.title;
  vault.createNode({ title: "Opp", layer: "Opportunity", tags: [], links: [], body: "b", evidence: "stated" });
  vault.linkNodes(root, "Opp");
  vault.createNode({ title: "Sol", layer: "Solution", tags: [], links: [], body: "b", evidence: "assertion" });
  vault.linkNodes("Opp", "Sol");
  vault.createNode({ title: "Asm", layer: "AssumptionTest", tags: [], links: [], body: "plan", evidence: "assertion" });
  vault.linkNodes("Sol", "Asm");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function cli(args: string[]) {
  return run(TSX, [CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
}

describe("ost-agent result", () => {
  test("recording a result clears that solution's gate", async () => {
    await expect(cli(["gate", "Sol", "--vault", dir])).rejects.toThrow(/BLOCKED|none run/i);

    await cli(["result", "Asm", "--verdict", "supported", "--note", "4 of 5 finished", "--by", "Tanner", "--uncovered", "nothing about first-time users", "--vault", dir]);

    const { stdout } = await cli(["gate", "Sol", "--vault", dir]);
    expect(stdout).toMatch(/cleared/i);
  }, 60_000);

  test("refuses to record a result with no one's name on it", async () => {
    await expect(
      cli(["result", "Asm", "--verdict", "supported", "--note", "it worked", "--uncovered", "u", "--vault", dir]),
    ).rejects.toThrow(/who ran it|attribut|required/i);
  }, 30_000);

  test("refuses to record a result that does not say what it leaves untested", async () => {
    await expect(
      cli(["result", "Asm", "--verdict", "supported", "--note", "it worked", "--by", "Tanner", "--vault", dir]),
    ).rejects.toThrow(/uncovered|required/i);

    // and the gate stays shut, so a refused result cannot half-clear a solution
    await expect(cli(["gate", "Sol", "--vault", dir])).rejects.toThrow(/BLOCKED|none run/i);
  }, 60_000);
});

describe("ost-agent debt surfaces unbounded results", () => {
  test("a result paired with its limits reads as bounded", async () => {
    await cli([
      "result", "Asm",
      "--verdict", "supported",
      "--note", "4 of 5 finished",
      "--by", "Tanner",
      "--uncovered", "says nothing about anyone on a phone",
      "--vault", dir,
    ]);

    const { stdout } = await cli(["debt", "--vault", dir]);
    expect(stdout).toMatch(/bounded 1/);
    expect(stdout).not.toMatch(/\[unbounded\] Asm/);
  }, 60_000);

  test("names a test whose results outrun its stated limits", async () => {
    // written the way an older vault holds it: a bare result, no statement
    const vault = new Vault(dir);
    vault.appendUnderSection("Asm", "## Results", "- 2026-07-01 **supported** (ran by Tanner) — from an older vault");

    const { stdout } = await cli(["debt", "--vault", dir]);
    expect(stdout).toMatch(/\[unbounded\] Asm/);
    expect(stdout).toMatch(/none saying what they fail to cover/);

    const status = await cli(["status", "--vault", dir]);
    expect(status.stdout).toMatch(/unbounded: Asm/);
  }, 60_000);
});
