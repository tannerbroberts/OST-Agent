import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { appendStep, sealRun, startRun, updateOpenRun } from "../../src/loop/health.js";

/**
 * A recorded failure that cannot be reproduced from its own record is a
 * half-record. `loop step` observed phase, command, exit and duration — but not
 * *where* it ran, and not the argv it actually passed.
 *
 * Both gaps were observed live. A `loop step -- pnpm --filter @tetrix/backend
 * test` invoked from the vault directory rather than the repo produced no
 * output at all; the recorded line was indistinguishable from the same command
 * run correctly. And `command` is a lossy `argv.join(" ")`, so a single
 * argument containing a space records identically to two arguments.
 */
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-step-provenance-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const meta = { loopVersion: "0.20.0", cliVersion: "0.20.0" };

describe("a recorded step carries where and how it ran", () => {
  test("cwd and argv survive onto the sealed record", () => {
    startRun(dir, meta);
    updateOpenRun(dir, { directive: "work" });
    appendStep(dir, {
      phase: "build",
      command: "pnpm --filter @tetrix/backend test",
      argv: ["pnpm", "--filter", "@tetrix/backend", "test"],
      cwd: "/home/user/tetrix-game-monorepo",
      exit: 0,
      durationMs: 5,
    });

    const [step] = sealRun(dir).steps;
    expect(step.cwd).toBe("/home/user/tetrix-game-monorepo");
    expect(step.argv).toEqual(["pnpm", "--filter", "@tetrix/backend", "test"]);
  });

  test("argv distinguishes one spaced argument from two arguments", () => {
    startRun(dir, meta);
    updateOpenRun(dir, { directive: "work" });
    appendStep(dir, {
      phase: "build",
      command: "echo hello world",
      argv: ["echo", "hello world"],
      cwd: dir,
      exit: 0,
      durationMs: 1,
    });
    appendStep(dir, {
      phase: "build",
      command: "echo hello world",
      argv: ["echo", "hello", "world"],
      cwd: dir,
      exit: 0,
      durationMs: 1,
    });

    const [one, two] = sealRun(dir).steps;
    // The lossy join cannot tell these apart; argv can, and that is the point.
    expect(one.command).toBe(two.command);
    expect(one.argv).not.toEqual(two.argv);
  });

  test("two identical commands run in different directories are distinguishable", () => {
    startRun(dir, meta);
    updateOpenRun(dir, { directive: "work" });
    const common = { phase: "build", command: "pnpm test", argv: ["pnpm", "test"], durationMs: 3 };
    appendStep(dir, { ...common, cwd: "/home/user/tetrix-ost", exit: 1 });
    appendStep(dir, { ...common, cwd: "/home/user/tetrix-game-monorepo", exit: 0 });

    const steps = sealRun(dir).steps;
    expect(steps.map((s) => s.cwd)).toEqual([
      "/home/user/tetrix-ost",
      "/home/user/tetrix-game-monorepo",
    ]);
    // The failing one is now attributable to the directory it ran in, which is
    // the whole reason the field exists.
    expect(steps.find((s) => s.exit !== 0)?.cwd).toBe("/home/user/tetrix-ost");
  });

  test("records written before these fields existed still read back", () => {
    // Append-only history: earlier runs.jsonl lines have no cwd/argv, and a
    // reader that throws on them would make the record unreadable at exactly
    // the moment it matters.
    startRun(dir, meta);
    updateOpenRun(dir, { directive: "work" });
    appendStep(dir, { phase: "build", command: "old-style", exit: 0, durationMs: 2 });

    const [step] = sealRun(dir).steps;
    expect(step.command).toBe("old-style");
    expect(step.cwd).toBeUndefined();
    expect(step.argv).toBeUndefined();
  });
});
