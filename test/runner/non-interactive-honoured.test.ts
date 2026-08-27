/**
 * The assumption beneath "Non-interactive is the default, and any tool that
 * would prompt is made to fail loudly instead": *the tools that actually
 * stalled honour the non-interactive convention*.
 *
 * The node's own words for the risk: "It relies on every invoked tool honouring
 * the convention, and the ones that ignore it are exactly the ones that caused
 * the problem. A git that prompts for a reconcile strategy despite a
 * non-interactive environment will hang exactly as before, and the run will now
 * believe it cannot." So this does not test the module against a mock. It
 * reproduces the two situations named in the harvested transcripts, with the
 * real binaries, and records what they do:
 *
 *   - `TRANSCRIPT:06eba571` — `git` exit 128, "You have divergent branches and
 *     need to specify how to reconcile them".
 *   - `TRANSCRIPT:e42cd03d` — `overwrite src/web/budget.ts? (y/n [n]) not
 *     overwritten`.
 *
 * The threshold the AssumptionTest fixed: **both reproduced commands fail
 * promptly rather than prompting or hanging.** "Promptly" is asserted against a
 * wall-clock bound with a real hang on the other side of it, because a test
 * that only checked the exit code would pass just as well against a command
 * that took four minutes to produce it.
 *
 * ## Two findings the node did not contain, pinned here because they change it
 *
 * **The git stall was never a prompt.** `git pull` on divergent branches exits
 * 128 immediately, with or without any non-interactive signal. Nothing waits.
 * It was already the loud failure the solution proposes to create, and the run
 * that "stopped" there stopped because nobody had set the reconcile policy —
 * which is a different node's job. Asserted below, so a future git that *does*
 * start waiting is caught rather than assumed away.
 *
 * **The overwrite prompt is not the tool's default, it is `-i`.** `/bin/cp` on
 * the argv path never asks; the harvested session's shell had `cp` aliased to
 * `cp -i`. So the environment variables reach neither of the two recorded
 * stalls — closing stdin and not going through a shell is what reaches them,
 * and that is what the declaration is built around.
 *
 * Offline, no network, no fixtures outside a temp directory.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  assertHonoured,
  describeOutcome,
  detectPrompt,
  NON_INTERACTIVE_ENV,
  NON_INTERACTIVE_STDIN,
  NON_INTERACTIVE_UNSET,
  NonInteractiveStopError,
  nonInteractiveEnv,
  nonInteractiveResult,
  runNonInteractive,
} from "../../src/runner/non-interactive.js";

/**
 * The bar for "promptly". Generous enough that a loaded machine does not turn a
 * fast failure into a red gate, and far below anything a person would call a
 * stall — the recorded hang was unbounded.
 */
const PROMPT_BUDGET_MS = 20_000;

let dir: string;

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ost-non-interactive-")));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * The operator's own git config is held out of every git this file runs.
 *
 * Without it, a developer who has `pull.rebase` set globally would reproduce a
 * *different* situation than the transcript recorded and the test would measure
 * their machine rather than the tool. `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`
 * are git ≥ 2.32; an older git ignores them and behaves as it does today.
 */
const ISOLATED_GIT = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } as const;

/** Run git for setup only, where a failure is a broken fixture, not a finding. */
function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...ISOLATED_GIT },
  });
  if (r.status !== 0) throw new Error(`fixture git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
}

/**
 * The exact situation in `TRANSCRIPT:06eba571`: a clone whose branch and whose
 * upstream have each moved on, with no `pull.rebase`/`pull.ff` anywhere the
 * command can see. Built from two local repositories, so nothing touches a
 * network.
 */
function divergentClone(root: string): string {
  const origin = path.join(root, "origin");
  const clone = path.join(root, "clone");
  fs.mkdirSync(origin, { recursive: true });
  git(origin, "init", "-q", "--initial-branch=main", ".");
  git(origin, "config", "user.email", "fixture@example.invalid");
  git(origin, "config", "user.name", "Fixture");
  fs.writeFileSync(path.join(origin, "f.txt"), "one\n");
  git(origin, "add", "-A");
  git(origin, "commit", "-qm", "one");

  git(root, "clone", "-q", origin, clone);
  git(clone, "config", "user.email", "fixture@example.invalid");
  git(clone, "config", "user.name", "Fixture");
  // Both sides move: that is what makes the branches divergent rather than
  // merely behind, and only divergence produces the recorded stop.
  fs.appendFileSync(path.join(origin, "f.txt"), "remote\n");
  git(origin, "commit", "-qam", "remote");
  fs.writeFileSync(path.join(clone, "g.txt"), "local\n");
  git(clone, "add", "-A");
  git(clone, "commit", "-qm", "local");
  git(clone, "fetch", "-q");
  return clone;
}

describe("the declaration itself", () => {
  test("every signal is applied over the caller's environment, and the caller cannot keep an interactive one", () => {
    const env = nonInteractiveEnv({ PATH: "/usr/bin", EDITOR: "vim", GIT_EDITOR: "vim", DISPLAY: ":0" });
    expect(env.PATH).toBe("/usr/bin");
    for (const [name, value] of Object.entries(NON_INTERACTIVE_ENV)) expect(env[name]).toBe(value);
    // An exported EDITOR is the operator's shell preference, not an instruction
    // to a child that has no terminal to open it on.
    expect(env.EDITOR).toBe("false");
    expect(env.GIT_EDITOR).toBe("false");
  });

  test("DISPLAY is removed, because there is no value of it that means 'no screen'", () => {
    expect(NON_INTERACTIVE_UNSET).toContain("DISPLAY");
    expect(nonInteractiveEnv({ DISPLAY: ":0" })).not.toHaveProperty("DISPLAY");
  });

  test("nothing in the declaration answers a question on the operator's behalf", () => {
    // The line this module will not cross: it says nobody is watching, it does
    // not say what the absent person would have wanted. `npx` asking "Ok to
    // proceed?" before installing must fail, not be answered yes.
    expect(NON_INTERACTIVE_ENV.NPM_CONFIG_YES).toBe("false");
    expect(NON_INTERACTIVE_ENV).not.toHaveProperty("GIT_MERGE_AUTOEDIT");
    expect(Object.keys(NON_INTERACTIVE_ENV)).not.toContain("PULL_REBASE");
  });

  test("stdin is closed, and is not something a caller can pass", () => {
    expect(NON_INTERACTIVE_STDIN).toBe("ignore");
  });
});

describe("the git that hit divergent branches (TRANSCRIPT:06eba571)", () => {
  test("fails promptly under the declaration — and the failure is the reconcile refusal, not a prompt", () => {
    const clone = divergentClone(dir);
    const run = runNonInteractive(["git", "pull"], {
      cwd: clone,
      timeoutMs: PROMPT_BUDGET_MS,
      env: { ...process.env, ...ISOLATED_GIT },
    });

    expect(run.outcome.kind).toBe("completed");
    if (run.outcome.kind !== "completed") throw new Error(describeOutcome(run));
    // The recorded exit, reproduced.
    expect(run.outcome.status).toBe(128);
    expect(run.outcome.output).toMatch(/divergent branches/i);
    expect(run.outcome.durationMs).toBeLessThan(PROMPT_BUDGET_MS);
    // The finding: git never asked. A hint listing three commands is not a
    // question waiting on an answer, and this node's premise said it would be.
    expect(detectPrompt(run.outcome.output)).toBeUndefined();
    // Loud by the only definition a supervisor can act on: a non-zero exit code
    // it can see, rather than a process it is still waiting for.
    expect(assertHonoured(run)).toBe(run);
  });

  test("the same command with a terminal's stdin still does not wait — measured, not assumed", () => {
    // The node's stated failure mode is a git that prompts *despite* the
    // environment. If that were true of this command, handing it a stdin that
    // never delivers would hang it. It does not: the reconcile refusal is
    // decided before stdin is ever consulted.
    const clone = divergentClone(dir);
    const startedAt = Date.now();
    const r = spawnSync("git", ["pull"], {
      cwd: clone,
      encoding: "utf8",
      // A pipe with nothing written and nothing closing it is the closest a
      // test can get to a terminal nobody is typing at.
      stdio: ["pipe", "pipe", "pipe"],
      timeout: PROMPT_BUDGET_MS,
      env: { ...process.env, ...ISOLATED_GIT },
    });
    expect(r.status).toBe(128);
    expect(Date.now() - startedAt).toBeLessThan(PROMPT_BUDGET_MS);
  });
});

describe("the copy that asked to overwrite (TRANSCRIPT:e42cd03d)", () => {
  /** `src/web/budget.ts` over an existing one, as the transcript had it. */
  function overwriteFixture(root: string): { from: string; to: string } {
    const from = path.join(root, "src", "web", "budget.ts");
    const to = path.join(root, "dest", "budget.ts");
    fs.mkdirSync(path.dirname(from), { recursive: true });
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(from, "export const NEW = 1;\n");
    fs.writeFileSync(to, "export const OLD = 0;\n");
    return { from, to };
  }

  test("`cp -i` fails promptly rather than hanging, and the stall is named rather than left as exit 1", () => {
    const { from, to } = overwriteFixture(dir);
    const run = runNonInteractive(["/bin/cp", "-i", from, to], { timeoutMs: PROMPT_BUDGET_MS });

    // Promptly: it gave up in milliseconds, where an inheritable stdin leaves
    // it sitting on the question indefinitely.
    expect(run.outcome.durationMs).toBeLessThan(PROMPT_BUDGET_MS);
    expect(run.outcome.kind).toBe("prompted");
    if (run.outcome.kind !== "prompted") throw new Error(describeOutcome(run));

    // The recorded question, reproduced. Matched loosely on purpose: BSD cp
    // writes `overwrite dest/budget.ts? (y/n [n])` and GNU coreutils 9.4 writes
    // `/bin/cp: overwrite 'dest/budget.ts'?` with no options listed at all —
    // measured on both, and the shape id below is what a reader is given.
    expect(run.outcome.output).toMatch(/overwrite\b.*budget\.ts/i);
    expect(run.outcome.prompt.shapeId).toBe("overwrite-confirmation");
    // And this is the half "fails promptly" does not give you: the bare exit
    // code is 1, indistinguishable from a permissions error or a missing
    // source. The run says which it was.
    expect(run.outcome.status).toBe(1);
    expect(describeOutcome(run)).toMatch(/stopped on a question nobody could answer/);

    // It asked, was not answered, and left the file alone — so the work did not
    // happen, which is exactly why a silent exit 1 is not good enough.
    expect(fs.readFileSync(to, "utf8")).toBe("export const OLD = 0;\n");

    expect(() => assertHonoured(run)).toThrow(NonInteractiveStopError);
    try {
      assertHonoured(run);
    } catch (err) {
      expect((err as NonInteractiveStopError).reason).toBe("prompted");
    }
  });

  test("the same copy on the argv path, without `-i`, never asks at all", () => {
    // The finding this pins: the harvested prompt came from the operator's
    // shell alias (`cp` → `cp -i`), not from the tool. No environment variable
    // could have reached it; not going through a shell does.
    const { from, to } = overwriteFixture(dir);
    const run = runNonInteractive(["/bin/cp", from, to], { timeoutMs: PROMPT_BUDGET_MS });
    expect(run.outcome.kind).toBe("completed");
    if (run.outcome.kind !== "completed") throw new Error(describeOutcome(run));
    expect(run.outcome.status).toBe(0);
    expect(fs.readFileSync(to, "utf8")).toBe("export const NEW = 1;\n");
  });
});

describe("a tool that honours nothing at all", () => {
  test("is killed at the timeout and reported as hung, rather than waited on", () => {
    // The node's worst case: a tool that ignores every signal. The run must not
    // come to believe it cannot hang — it must bound the wait and say so.
    const script = path.join(dir, "ignores-everything.cjs");
    fs.writeFileSync(script, "setInterval(() => {}, 1000);\n");
    const run = runNonInteractive([process.execPath, script], { timeoutMs: 1500 });

    expect(run.outcome.kind).toBe("hung");
    if (run.outcome.kind !== "hung") throw new Error(describeOutcome(run));
    expect(run.outcome.timeoutMs).toBe(1500);
    expect(describeOutcome(run)).toMatch(/still running after 1500ms with no terminal attached, and was killed/);

    // A hang has no exit code, and inventing one would put a number in the
    // record that nothing observed — but it must never read as a pass.
    expect(nonInteractiveResult(run).status).toBeNull();
    expect(nonInteractiveResult(run).output).toMatch(/was killed/);
    expect(() => assertHonoured(run)).toThrow(/ignored the non-interactive declaration/);
  });

  test("a command that reads stdin gets EOF instead of a wait", () => {
    const script = path.join(dir, "reads-stdin.cjs");
    fs.writeFileSync(
      script,
      [
        "process.stdout.write('Are you sure? (y/n) ');",
        "let seen = false;",
        "process.stdin.on('data', () => { seen = true; });",
        "process.stdin.on('end', () => process.exit(seen ? 0 : 3));",
        "process.stdin.resume();",
      ].join("\n") + "\n",
    );
    const run = runNonInteractive([process.execPath, script], { timeoutMs: PROMPT_BUDGET_MS });
    expect(run.outcome.kind).toBe("prompted");
    if (run.outcome.kind !== "prompted") throw new Error(describeOutcome(run));
    // Exit 3 is the script saying it was never answered — EOF, not a keystroke.
    expect(run.outcome.status).toBe(3);
    // Shapes are tried in order and the first match wins, so a question that is
    // both "are you sure" and a `(y/n)` reports the structural shape.
    expect(run.outcome.prompt.shapeId).toBe("yes-no-question");
  });
});

describe("what counts as a question", () => {
  test("the recorded shapes are recognised", () => {
    expect(detectPrompt("overwrite src/web/budget.ts? (y/n [n]) not overwritten")?.shapeId).toBe("overwrite-confirmation");
    expect(detectPrompt("Need to install the following packages:\ncowsay\nOk to proceed? (y)")?.shapeId).toBe("ok-to-proceed");
    expect(detectPrompt("Press any key to continue")?.shapeId).toBe("press-a-key");
    expect(detectPrompt("Enter passphrase for key '/home/x/.ssh/id_rsa':")?.shapeId).toBe("secret-request");
    expect(detectPrompt("fatal: could not read Username for 'https://github.com': terminal prompts disabled")?.shapeId).toBe(
      "terminal-prompts-disabled",
    );
    expect(detectPrompt("Continue? [y/N]")?.shapeId).toBe("yes-no-question");
  });

  test("shapes are tried in order, so a question matching two reports the first", () => {
    // Worth pinning rather than leaving to whoever reorders the array: the
    // shape id is quoted back to a reader, and a silently different one turns
    // two reports of the same stall into two different-looking stalls.
    expect(detectPrompt("Are you sure? (y/n)")?.shapeId).toBe("yes-no-question");
    expect(detectPrompt("Are you sure you want to continue")?.shapeId).toBe("are-you-sure");
  });

  test("the quoted line comes back, not the whole log", () => {
    const detected = detectPrompt("compiling…\noverwrite dist/x.js? (y/n [n]) not overwritten\ndone");
    expect(detected?.line).toBe("overwrite dist/x.js? (y/n [n]) not overwritten");
  });

  test("ordinary failure output is not read as a question", () => {
    expect(detectPrompt("error TS2345: Argument of type 'string' is not assignable")).toBeUndefined();
    expect(detectPrompt("fatal: Need to specify how to reconcile divergent branches.")).toBeUndefined();
    expect(detectPrompt("FAIL test/x.test.ts > it works")).toBeUndefined();
  });

  test("a command that succeeded is never called prompted, whatever it printed", () => {
    // Help text quoting a prompt is not a prompt. A false "it stopped on a
    // question" sends a reader after a stall that never happened, which is the
    // way an instrument like this stops being believed.
    const script = path.join(dir, "prints-and-succeeds.cjs");
    fs.writeFileSync(script, "process.stdout.write('usage: rm -i  # asks: overwrite file?\\n');\n");
    const run = runNonInteractive([process.execPath, script], { timeoutMs: PROMPT_BUDGET_MS });
    expect(run.outcome.kind).toBe("completed");
    expect(assertHonoured(run)).toBe(run);
  });
});

describe("what a runner that only looks at the exit code sees", () => {
  test("a command that never started keeps a null status rather than a zero", () => {
    const run = runNonInteractive([path.join(dir, "no-such-binary")], { timeoutMs: PROMPT_BUDGET_MS });
    expect(run.outcome.kind).toBe("not-run");
    expect(nonInteractiveResult(run).status).toBeNull();
    expect(describeOutcome(run)).toMatch(/never started/);
  });

  test("a plain failure passes through untouched", () => {
    const script = path.join(dir, "fails.cjs");
    fs.writeFileSync(script, "process.stderr.write('boom\\n'); process.exit(2);\n");
    const run = runNonInteractive([process.execPath, script], { timeoutMs: PROMPT_BUDGET_MS });
    expect(nonInteractiveResult(run)).toEqual({ status: 2, output: "boom\n" });
  });
});
