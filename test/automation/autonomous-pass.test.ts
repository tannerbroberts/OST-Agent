/**
 * The unattended firing may not push a tree it never proved, and may not fire
 * at all until the cadence gate and the spend ceiling both say so.
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
 *
 * The `node` stub dispatches on argv, because the script now uses `node` for four
 * different things (`loop due`, `loop start`, `loop step`, `check`). A stub that
 * returned one code for all of them would let a script that never consults the
 * checker pass by accident — the failure that the H2 test was written to prevent,
 * reintroduced through the fixture.
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

/** Write an executable stub that appends its argv to the log, then runs `body`. */
function stub(name: string, body: string): void {
  const p = path.join(bin, name);
  fs.writeFileSync(p, `#!/usr/bin/env bash\necho "${name} $*" >> "${log}"\n${body}\n`, "utf8");
  fs.chmodSync(p, 0o755);
}

/**
 * The `node` stub, dispatching on the ost-agent subcommand.
 *
 * `loop step` runs its wrapped command, so the `pass` phase really does invoke
 * the `claude` stub and the ordering assertion is about the real sequence.
 *
 * **Two things here are argument-aware rather than text-aware, and both had to
 * become so.** The wrapped command used to be all single-word arguments, and this
 * stub quietly depended on that in two places.
 *
 * It found the wrapped command by counting *words* after `--` and shifting by the
 * difference. Once the script began passing the pass instructions as one multi-word
 * `-p "$PASS_PROMPT"` argument, that count ran hundreds over the real argument count,
 * `shift` was handed a negative number, and the stub hung instead of failing — a
 * worker that never reports, which reads as a suite that never ran this file rather
 * than as a failure. Walking `"$@"` to the literal `--` cannot drift that way.
 *
 * And it dispatched on `$*` — every argument flattened, wrapped command included. The
 * prompt is now megabytes of instruction text read out of the repo, so a future edit
 * to `ost-pass.md` or `SKILL.md` containing the words "loop start" would have silently
 * re-routed this stub and quietly stopped testing what it claims to test. Only the
 * arguments *before* `--` name the subcommand, so only those are matched.
 */
function stubNode(opts: { due?: number; start?: number; check?: number } = {}): void {
  stub(
    "node",
    [
      // Everything up to the literal `--`; the wrapped command must not steer this.
      'head=""',
      'for a in "$@"; do [ "$a" = "--" ] && break; head="$head $a"; done',
      'case "$head" in',
      `  *"loop due"*) exit ${opts.due ?? 0} ;;`,
      `  *"loop start"*) exit ${opts.start ?? 0} ;;`,
      '  *"loop seal"*) exit 0 ;;',
      // Everything after `--` is the wrapped command; run it for real.
      '  *"loop step"*) while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done; shift; exec "$@" ;;',
      `  *" check "*|*" check") exit ${opts.check ?? 0} ;;`,
      "  *) exit 0 ;;",
      "esac",
    ].join("\n"),
  );
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
  stubNode();
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
    stubNode({ check: 1 }); // `ost-agent check` exits 1 on violations
    expect(runPass()).not.toBe(0);
    expect(calls()).not.toMatch(/git push/);
  });

  test("a clean tree pushes, so the gate is not simply blocking everything", () => {
    expect(runPass()).toBe(0);
    expect(calls()).toMatch(/git push/);
  });

  test("the check is what is consulted, and it runs against the vault", () => {
    runPass();
    expect(calls()).toMatch(/node .*ost-agent\.mjs check --vault \./);
  });

  test("the check runs after the pass, never instead of it", () => {
    // Checking a tree the pass has not touched yet would prove the wrong thing.
    runPass();
    const order = calls();
    expect(order.indexOf("claude -p")).toBeLessThan(order.indexOf("check --vault"));
  });
});

describe("the firing is bracketed, so it lands in the health record", () => {
  test("both required phases go through `loop step`", () => {
    runPass();
    expect(calls()).toMatch(/loop step --phase pass/);
    expect(calls()).toMatch(/loop step --phase check/);
  });

  test("the run is opened before the pass and sealed after it, even when a phase fails", () => {
    stubNode({ check: 1 });
    runPass();
    const order = calls();
    expect(order.indexOf("loop start")).toBeLessThan(order.indexOf("loop step --phase pass"));
    expect(order.indexOf("loop seal")).toBeGreaterThan(order.indexOf("loop step --phase check"));
  });

  test("the lock names this script as the holder, so a killed firing frees it at once", () => {
    runPass();
    expect(calls()).toMatch(/loop start --vault \. --holder-pid \d+/);
  });

  test("an overlapping firing exits 0 and runs nothing — a live pass is not silence", () => {
    stubNode({ start: 15 });
    expect(runPass()).toBe(0);
    expect(calls()).not.toMatch(/claude/);
    expect(calls()).not.toMatch(/git push/);
    // And it must not seal a run it never opened.
    expect(calls()).not.toMatch(/loop seal/);
  });
});

describe("the cadence gate decides whether anything runs at all", () => {
  test("`loop due` is consulted before the pass", () => {
    runPass();
    const order = calls();
    expect(order.indexOf("loop due")).toBeLessThan(order.indexOf("loop start"));
  });

  test("not-elapsed is the one refusal that exits 0, and it fires nothing", () => {
    stubNode({ due: 10 });
    expect(runPass()).toBe(0);
    expect(calls()).not.toMatch(/loop start/);
    expect(calls()).not.toMatch(/claude/);
    expect(calls()).not.toMatch(/git push/);
  });

  for (const [code, what] of [
    [11, "an undeclared cadence"],
    [12, "an undeclared spend ceiling"],
    [13, "an exhausted spend ceiling"],
  ] as const) {
    test(`${what} exits non-zero, so a vault that never fires is not mistaken for a healthy one`, () => {
      // Criterion S2: a channel that died must not look like a channel with
      // nothing to report. Collapsing these into exit 0 is exactly that failure.
      stubNode({ due: code });
      expect(runPass()).toBe(code);
      expect(calls()).not.toMatch(/loop start/);
    });
  }
});
