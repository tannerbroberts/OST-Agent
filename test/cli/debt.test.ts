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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cli-debt-"));
  await initVault(dir, "Reach 10,000 daily active users");
  const vault = new Vault(dir);
  const root = vault.readTree().find((n) => n.layer === "Outcome")!.title;
  vault.createNode({ title: "Opp", layer: "Opportunity", tags: [], links: [], body: "b", evidence: "stated" });
  vault.linkNodes(root, "Opp");
  vault.createNode({ title: "Untested idea", layer: "Solution", tags: [], links: [], body: "b", evidence: "assertion" });
  vault.linkNodes("Opp", "Untested idea");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function cli(args: string[]) {
  return run("npx", ["tsx", CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
}

describe("ost-agent debt", () => {
  test("lists what each solution owes", async () => {
    const { stdout } = await cli(["debt", "--vault", dir]);

    expect(stdout).toContain("Untested idea");
    expect(stdout).toContain("untested");
  }, 30_000);

  test("prints a bounded test's threshold next to what its run did not cover", async () => {
    // The whole point of the pairing: the two sentences have to be readable
    // together, or the uncovered field is a box that got ticked.
    const vault = new Vault(dir);
    vault.createNode({
      title: "Cold offer",
      layer: "AssumptionTest",
      tags: [],
      links: [],
      body: [
        "**Pre-committed threshold:** at least 5 of 20 book a kickoff.",
        "",
        "## Results",
        "- 2026-07-25 **supported** (ran by Tanner) — 6 booked",
        "",
        "## Uncovered",
        "- 2026-07-25 (supported) — says nothing about whether any of them sent an artefact",
      ].join("\n"),
      evidence: "observed",
    });
    vault.linkNodes("Untested idea", "Cold offer");

    const { stdout } = await cli(["debt", "--vault", dir]);

    expect(stdout).toContain("at least 5 of 20 book a kickoff.");
    expect(stdout).toContain("says nothing about whether any of them sent an artefact");
    // Side by side means side by side: the threshold must be readable above the
    // limit, under the one title, not in two separate lists.
    const asked = stdout.indexOf("at least 5 of 20");
    const limit = stdout.indexOf("says nothing about whether");
    const title = stdout.lastIndexOf("Cold offer", asked);
    expect(title).toBeGreaterThan(-1);
    expect(asked).toBeLessThan(limit);
  }, 30_000);

  test("says so when a bounded test never wrote a threshold down", async () => {
    const vault = new Vault(dir);
    vault.createNode({
      title: "Unasked",
      layer: "AssumptionTest",
      tags: [],
      links: [],
      body: [
        "just a plan, with no threshold",
        "",
        "## Results",
        "- 2026-07-25 **supported** (ran by Tanner) — went well",
        "",
        "## Uncovered",
        "- 2026-07-25 (supported) — only covers desktop",
      ].join("\n"),
      evidence: "observed",
    });
    vault.linkNodes("Untested idea", "Unasked");

    const { stdout } = await cli(["debt", "--vault", dir]);

    expect(stdout).toMatch(/no pre-committed threshold/i);
  }, 30_000);
});

describe("ost-agent gate", () => {
  test("exits non-zero and explains itself when a solution has no tested assumption", async () => {
    await expect(cli(["gate", "Untested idea", "--vault", dir])).rejects.toThrow(/no assumption test/i);
  }, 30_000);

  test("exits zero once an assumption test has recorded a result", async () => {
    const vault = new Vault(dir);
    vault.createNode({
      title: "Asm",
      layer: "AssumptionTest",
      tags: [],
      links: [],
      body: "plan\n\n## Results\n- 2026-07-24 ran it",
      evidence: "observed",
    });
    vault.linkNodes("Untested idea", "Asm");

    const { stdout } = await cli(["gate", "Untested idea", "--vault", dir]);
    expect(stdout).toMatch(/cleared/i);
  }, 30_000);
});
