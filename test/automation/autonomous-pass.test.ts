/**
 * The unattended firing may not push a tree it never proved.
 *
 * `claude -p` exits 0 for a pass that wedged, skipped a phase, or left the vault red:
 * its exit code reports Claude Code's health, not the tree's. So the script used to
 * push unconditionally, and the single most likely failure mode of an unattended loop —
 * a firing that did nothing useful — was indistinguishable from success at every
 * downstream observer.
 *
 * This runs the real script with `claude`, `node` and `git` stubbed on PATH, rather
 * than grepping it for the word "check". A grep passes on a script that calls the
 * checker and ignores what it said.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const REPO = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO, "examples", "automation", "autonomous-pass.sh");

let dir: string;
let bin: string;
let vault: string;
/** Where the stubs record what they were asked to do. */
let log: string;

/** Write an executable stub that appends its argv to the log, then exits `code`. */
function stub(name: string, body: string): void {
  const p = path.join(bin, name);
  fs.writeFileSync(p, `#!/usr/bin/env bash\necho "${name} $*" >> "${log}"\n${body}\n`, "utf8");
  fs.chmodSync(p, 0o755);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-h2-"));
  bin = path.join(dir, "bin");
  vault = path.join(dir, "vault");
  log = path.join(dir, "calls.log");
  fs.mkdirSync(bin);
  fs.mkdirSync(vault);
  fs.writeFileSync(log, "", "utf8");
  stub("claude", "exit 0");
  // `git remote get-url origin` must succeed, so the push is reached whenever the
  // gate allows it — otherwise a passing test could just be a vault with no remote.
  stub("git", "exit 0");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Run the script with the stubs in front of the real tools. Returns its exit code. */
function runPass(): number {
  try {
    execFileSync("bash", [SCRIPT, vault], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OST_AGENT_DIR: REPO },
      stdio: "pipe",
    });
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
}

const calls = () => fs.readFileSync(log, "utf8");

describe("autonomous-pass.sh gates the push on the deterministic check", () => {
  test("a red tree fails the firing and pushes nothing", () => {
    stub("node", "exit 1"); // `ost-agent check` exits 1 on violations
    expect(runPass()).not.toBe(0);
    expect(calls()).not.toMatch(/git push/);
  });

  test("a clean tree pushes, so the gate is not simply blocking everything", () => {
    stub("node", "exit 0");
    expect(runPass()).toBe(0);
    expect(calls()).toMatch(/git push/);
  });

  test("the check is what is consulted, and it runs against the vault", () => {
    stub("node", "exit 0");
    runPass();
    expect(calls()).toMatch(/node .*ost-agent\.mjs check/);
  });

  test("the check runs after the pass, never instead of it", () => {
    // Checking a tree the pass has not touched yet would prove the wrong thing.
    stub("node", "exit 0");
    runPass();
    const order = calls();
    expect(order.indexOf("claude")).toBeLessThan(order.indexOf("check"));
  });
});
