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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cli-lanes-"));
  await initVault(dir, "Reach 10,000 daily active users");
  const vault = new Vault(dir);
  const root = vault.readTree().find((n) => n.layer === "Outcome")!.title;
  vault.createNode({ title: "Opp", layer: "Opportunity", tags: [], links: [], body: "b", evidence: "stated" });
  vault.linkNodes(root, "Opp");
  vault.createNode({ title: "Sol", layer: "Solution", tags: [], links: [], body: "b", evidence: "assertion" });
  vault.linkNodes("Opp", "Sol");
  vault.createNode({
    title: "Replay the fourteen existing run journals",
    layer: "AssumptionTest",
    tags: [],
    links: [],
    body: "Every journal is already on disk.",
    evidence: "assertion",
  });
  vault.linkNodes("Sol", "Replay the fourteen existing run journals");
  vault.createNode({
    title: "Interview five real players",
    layer: "AssumptionTest",
    tags: [],
    links: [],
    body: "Story-based interviews with people who are not us.",
    evidence: "assertion",
  });
  vault.linkNodes("Sol", "Interview five real players");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function cli(args: string[]) {
  return run(TSX, [CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
}

describe("ost-agent lanes", () => {
  test("an untriaged vault reports every test as unclassified and NOTHING as runnable", async () => {
    const { stdout } = await cli(["lanes", "--vault", dir]);

    expect(stdout).toContain("unclassified 2");
    expect(stdout).toContain("Runnable right now (compute-only, no result yet): 0");
  }, 30_000);

  test("hints point at the test that names outside people, and only ever toward a person", async () => {
    const { stdout } = await cli(["lanes", "--vault", dir]);

    expect(stdout).toMatch(/Interview five real players.*⚠ likely humans-required/);
    expect(stdout).not.toMatch(/⚠ likely compute-only/);
  }, 30_000);

  test("--runnable prints a bare, scriptable list", async () => {
    await cli([
      "lane",
      "Replay the fourteen existing run journals",
      "--set",
      "compute-only",
      "--by",
      "tanner",
      "--why",
      "journals are already on disk",
      "--vault",
      dir,
    ]);

    const { stdout } = await cli(["lanes", "--vault", dir, "--runnable"]);

    expect(stdout.trim()).toBe("Replay the fourteen existing run journals");
  }, 60_000);
});

describe("ost-agent lanes --flag-cautious", () => {
  test("flags only the test that names outside people, and leaves the other unclassified", async () => {
    const { stdout } = await cli(["lanes", "--vault", dir, "--flag-cautious", "tanner"]);

    expect(stdout).toMatch(/flagged "Interview five real players"/);
    expect(stdout).not.toContain("Replay the fourteen existing run journals");

    const vault = new Vault(dir);
    expect(vault.read("Interview five real players").lane).toBe("humans-required");
    // Unclassified is the correct resting state for everything else: the
    // permissive call is a judgement and bulk is the wrong shape for it.
    expect(vault.read("Replay the fourteen existing run journals").lane).toBeUndefined();
  }, 60_000);

  test("says how many are still unclassified, so a bulk pass cannot read as 'triage done'", async () => {
    const { stdout } = await cli(["lanes", "--vault", dir, "--flag-cautious", "tanner"]);

    expect(stdout).toContain("1 remain unclassified");
    expect(stdout).toContain("still NOT runnable by compute");
  }, 60_000);

  test("never reverses a human's permissive call", async () => {
    // The one bulk failure that would be a safety regression rather than noise.
    await cli([
      "lane",
      "Interview five real players",
      "--set",
      "compute-only",
      "--by",
      "tanner",
      "--why",
      "deliberate, and the point of this test",
      "--vault",
      dir,
    ]);

    await cli(["lanes", "--vault", dir, "--flag-cautious", "loop"]);

    expect(new Vault(dir).read("Interview five real players").lane).toBe("compute-only");
  }, 90_000);

  test("is honest when there is nothing to flag", async () => {
    await cli(["lanes", "--vault", dir, "--flag-cautious", "tanner"]);
    const { stdout } = await cli(["lanes", "--vault", dir, "--flag-cautious", "tanner"]);

    expect(stdout).toContain("Nothing to flag");
    expect(stdout).toContain("never 'safe to automate'");
  }, 90_000);
});

describe("ost-agent lane", () => {
  test("classifies a test and says plainly whether compute may now run it", async () => {
    const { stdout } = await cli([
      "lane",
      "Replay the fourteen existing run journals",
      "--set",
      "compute-only",
      "--by",
      "tanner",
      "--why",
      "journals are already on disk",
      "--vault",
      dir,
    ]);

    expect(stdout).toContain("lane: (none) → compute-only");
    expect(stdout).toContain("an unattended pass MAY now run this test.");
    expect(new Vault(dir).read("Replay the fourteen existing run journals").lane).toBe("compute-only");
  }, 30_000);

  test("a humans-required classification says a person is still required", async () => {
    const { stdout } = await cli([
      "lane",
      "Interview five real players",
      "--set",
      "humans-required",
      "--by",
      "tanner",
      "--why",
      "the players are the measurement",
      "--vault",
      dir,
    ]);

    expect(stdout).toContain("a person is still required.");
  }, 30_000);

  test("refuses an invented lane rather than storing it", async () => {
    await expect(
      cli([
        "lane",
        "Interview five real players",
        "--set",
        "cheap",
        "--by",
        "tanner",
        "--why",
        "feels quick",
        "--vault",
        dir,
      ]),
    ).rejects.toThrow(/cheap/);
    expect(new Vault(dir).read("Interview five real players").lane).toBeUndefined();
  }, 30_000);
});
