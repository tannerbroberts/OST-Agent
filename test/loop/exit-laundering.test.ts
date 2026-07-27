/**
 * A proving command must be able to come out red.
 *
 * The case that produced this: a loop pass wrapped its build phase as
 * `bash -c "npx vitest run 2>&1 | tail -25"`. `vitest` was not on the path, the
 * shell printed `vitest: not found`, and the step recorded **exit 0** — because
 * a pipeline's status is its last command's, and `tail` read nothing
 * successfully. The health record gained a green build step for a command that
 * never ran.
 *
 * These tests pin both directions, and the second matters as much as the first:
 * a guard that refuses too much would push people back to unwrapped commands,
 * which is worse than the problem it solves.
 */
import { describe, expect, test } from "vitest";
import { detectLaunderedExit, launderedExitMessage } from "../../src/loop/exitLaundering.js";

const sh = (script: string, shell = "bash") => [shell, "-c", script];

describe("detects a pipeline whose failure cannot surface", () => {
  test("the observed case: a test run piped to tail", () => {
    const d = detectLaunderedExit(sh("npx vitest run 2>&1 | tail -25"));
    expect(d).not.toBeNull();
    expect(d?.shell).toBe("bash");
    expect(d?.script).toContain("vitest");
  });

  test.each([
    ["piped to grep", "npm test | grep -c passed"],
    ["piped to tee", "pnpm build | tee build.log"],
    ["a three-stage pipeline", "cat log | sort | uniq -c"],
    ["bash's |& shorthand", "npm test |& tail -5"],
    ["a pipeline after a semicolon", "cd apps/frontend; npx vitest run | tail"],
  ])("%s", (_label, script) => {
    expect(detectLaunderedExit(sh(script))).not.toBeNull();
  });

  test.each(["sh", "zsh", "dash", "ksh", "/bin/bash", "/usr/bin/env-less/sh"])(
    "recognises the shell %s",
    (shell) => {
      expect(detectLaunderedExit(sh("npm test | tail", shell))).not.toBeNull();
    },
  );

  test("a clustered login-shell flag still carries the script", () => {
    expect(detectLaunderedExit(["bash", "-lc", "npm test | tail"])).not.toBeNull();
  });
});

describe("does not refuse a command whose exit code is honest", () => {
  test("pipefail makes the pipeline report its first failing stage", () => {
    expect(detectLaunderedExit(sh("set -o pipefail; npx vitest run | tail -25"))).toBeNull();
  });

  test.each([
    ["clustered set -eo", "set -eo pipefail; npm test | tail"],
    ["clustered set -euo", "set -euo pipefail\nnpm test | tail"],
  ])("%s", (_label, script) => {
    expect(detectLaunderedExit(sh(script))).toBeNull();
  });

  test("a logical OR is not a pipeline — it propagates failure", () => {
    expect(detectLaunderedExit(sh("npm test || echo failed"))).toBeNull();
  });

  test("a pipe inside single quotes is an argument, not a pipeline", () => {
    expect(detectLaunderedExit(sh("grep -E 'a|b' src/x.ts"))).toBeNull();
  });

  test("a pipe inside double quotes is likewise an argument", () => {
    expect(detectLaunderedExit(sh('rg "foo|bar" .'))).toBeNull();
  });

  test("an escaped pipe is a literal", () => {
    expect(detectLaunderedExit(sh("echo a \\| b"))).toBeNull();
  });

  test("a plain shell command with no pipeline is fine", () => {
    expect(detectLaunderedExit(sh("cd apps/frontend && npx vitest run"))).toBeNull();
  });

  test("a direct argv has no shell to launder anything", () => {
    expect(detectLaunderedExit(["npx", "vitest", "run"])).toBeNull();
    expect(detectLaunderedExit(["pnpm", "--filter", "@x/y", "test"])).toBeNull();
  });

  test("a non-shell binary that merely takes a -c flag is left alone", () => {
    expect(detectLaunderedExit(["python3", "-c", "print(1 | 2)"])).toBeNull();
  });

  test("a shell invoked without -c is not inspected", () => {
    expect(detectLaunderedExit(["bash", "script.sh"])).toBeNull();
  });

  test("too few arguments to be a shell script", () => {
    expect(detectLaunderedExit(["bash"])).toBeNull();
    expect(detectLaunderedExit([])).toBeNull();
  });

  test("a -c flag with no script after it is not a crash", () => {
    expect(() => detectLaunderedExit(["bash", "-c"])).not.toThrow();
    expect(detectLaunderedExit(["bash", "-c"])).toBeNull();
  });
});

describe("the refusal explains itself", () => {
  const d = detectLaunderedExit(sh("npx vitest run 2>&1 | tail -25"))!;
  const msg = launderedExitMessage(d);

  test("shows the command it refused", () => {
    expect(msg).toContain("npx vitest run 2>&1 | tail -25");
  });

  test("names the fix rather than only the problem", () => {
    expect(msg).toContain("set -o pipefail");
  });

  test("offers the no-shell alternative too", () => {
    expect(msg).toContain("loop step --phase");
  });

  test("says plainly that nothing was recorded", () => {
    expect(msg).toContain("Nothing was written");
  });
});
