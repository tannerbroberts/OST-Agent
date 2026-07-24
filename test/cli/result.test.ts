import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { Vault } from "../../src/ost/vault.js";

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
  return run("npx", ["tsx", CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
}

describe("ost-agent result", () => {
  test("recording a result clears that solution's gate", async () => {
    await expect(cli(["gate", "Sol", "--vault", dir])).rejects.toThrow(/BLOCKED|none run/i);

    await cli(["result", "Asm", "--verdict", "supported", "--note", "4 of 5 finished", "--by", "Tanner", "--vault", dir]);

    const { stdout } = await cli(["gate", "Sol", "--vault", dir]);
    expect(stdout).toMatch(/cleared/i);
  }, 60_000);

  test("refuses to record a result with no one's name on it", async () => {
    await expect(
      cli(["result", "Asm", "--verdict", "supported", "--note", "it worked", "--vault", dir]),
    ).rejects.toThrow(/who ran it|attribut|required/i);
  }, 30_000);
});
