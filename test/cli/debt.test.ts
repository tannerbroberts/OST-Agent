import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { Vault } from "../../src/ost/vault.js";
import { recordResult } from "../../src/ost/results.js";

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
  return run(TSX, [CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
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
      body: "**Pre-committed threshold:** at least 5 of 20 book a kickoff.",
      evidence: "observed",
    });
    vault.linkNodes("Untested idea", "Cold offer");
    // Planted through the human's own write path rather than by typing the
    // headings into a body: `## Results` and `## Uncovered` are reserved
    // (`src/ost/headings.ts`), so a fixture that writes them as content is
    // writing something no caller can write (B1, B10).
    recordResult(dir, {
      test: "Cold offer",
      verdict: "supported",
      note: "6 booked",
      by: "Tanner",
      uncovered: "says nothing about whether any of them sent an artefact",
      on: "2026-07-25",
    });

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
      body: "just a plan, with no threshold",
      evidence: "observed",
    });
    vault.linkNodes("Untested idea", "Unasked");
    recordResult(dir, {
      test: "Unasked",
      verdict: "supported",
      note: "went well",
      by: "Tanner",
      uncovered: "only covers desktop",
      on: "2026-07-25",
    });

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
      body: "plan",
      evidence: "observed",
    });
    vault.linkNodes("Untested idea", "Asm");
    recordResult(dir, {
      test: "Asm",
      verdict: "supported",
      note: "ran it",
      by: "Tanner",
      uncovered: "only the desktop funnel",
      on: "2026-07-24",
    });

    const { stdout } = await cli(["gate", "Untested idea", "--vault", dir]);
    expect(stdout).toMatch(/cleared/i);
  }, 30_000);
});

describe("ost-agent debt — thresholds that were never fixed", () => {
  test("names a test whose pre-commitment is still an instruction to pick one", async () => {
    // The finding that produced this feature: a pre-commitment section exists,
    // so the tree looks rigorous, and what stands in it is "decide the bar".
    const vault = new Vault(dir);
    vault.createNode({
      title: "Unfixed bar",
      layer: "AssumptionTest",
      tags: [],
      links: [],
      body: "plan\n\n**Pre-commit before looking:** Decide the minimum before starting.",
      evidence: "assertion",
    });
    vault.linkNodes("Untested idea", "Unfixed bar");

    const { stdout } = await cli(["debt", "--vault", dir]);

    expect(stdout).toContain("[not fixed] Unfixed bar");
    expect(stdout).toMatch(/cannot come out a failure/i);
  }, 30_000);

  test("leaves a test alone once its threshold carries a bar", async () => {
    const vault = new Vault(dir);
    vault.createNode({
      title: "Fixed bar",
      layer: "AssumptionTest",
      tags: [],
      links: [],
      body: "plan\n\n**Pre-committed threshold:** at least 5 of 20 book a kickoff.",
      evidence: "assertion",
    });
    vault.linkNodes("Untested idea", "Fixed bar");

    const { stdout } = await cli(["debt", "--vault", dir]);

    expect(stdout).not.toContain("[not fixed] Fixed bar");
    expect(stdout).toMatch(/Thresholds: \d+ assumption test\(s\)/);
  }, 30_000);

  test("reports only — a flagged threshold never blocks the gate", async () => {
    // Deliberately the weakest of the three things that could be built here.
    // A report that is wrong is a nuisance; a refusal that is wrong is a wall.
    const vault = new Vault(dir);
    vault.createNode({
      title: "Unfixed but run",
      layer: "AssumptionTest",
      tags: [],
      links: [],
      body: "**Pre-committed threshold:** Choose the bar before starting.",
      evidence: "observed",
    });
    vault.linkNodes("Untested idea", "Unfixed but run");
    recordResult(dir, {
      test: "Unfixed but run",
      verdict: "supported",
      note: "went well",
      by: "Tanner",
      uncovered: "only covers desktop",
      on: "2026-07-25",
    });

    const { stdout } = await cli(["gate", "Untested idea", "--vault", dir]);

    expect(stdout).toMatch(/cleared/i);
  }, 30_000);
});
