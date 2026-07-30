/**
 * `ost-agent loop` through the real CLI — the exit codes are the interface.
 *
 * A wrapper script sees nothing but a number, so the number has to carry the
 * distinction: `10` is the routine "not yet", and every other refusal means the
 * vault is not going to fire until somebody changes something. Collapsing them
 * would make a vault that has never fired once look exactly like a healthy one,
 * which is criterion S2's failure statement verbatim.
 *
 * These run the CLI end to end rather than the modules, because the wiring is
 * what is being asserted — that `loop due` really consults the cadence gate and
 * the spend ceiling, in that order, and really refuses.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

// The local tsx binary, invoked directly rather than through `npx` — `npx`
// takes npm's cacache lock, and dozens of concurrent spawns contend on it.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

let dir: string;
let vault: string;
let sessions: string;

interface Ran {
  code: number;
  out: string;
}

/** `--vault` goes before any `--`, or commander hands it to the child command. */
function loop(subcommand: string, ...args: string[]): Ran {
  try {
    const out = execFileSync(TSX, [CLI, "loop", subcommand, "--vault", vault, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number | null; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function config(loopBlock: string): void {
  fs.writeFileSync(path.join(vault, "ost.config.yaml"), `outcome: "ship it"\n${loopBlock}`, "utf8");
}

/** A firing's worth of spend in this vault, at a timestamp inside the window. */
function spend(outputTokens: number): void {
  fs.writeFileSync(
    path.join(sessions, "s.jsonl"),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      cwd: fs.realpathSync(vault),
      message: { usage: { output_tokens: outputTokens } },
    }) + "\n",
    "utf8",
  );
}

const FULL_LOOP = [
  "loop:",
  '  cadence: "6h"',
  "  spend:",
  "    ceilingWeightedTokens: 1000",
  "    windowHours: 24",
  '    sessionsDir: "sessions"',
  "",
].join("\n");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cli-loop-"));
  vault = path.join(dir, "vault");
  sessions = path.join(vault, "sessions");
  fs.mkdirSync(vault);
  fs.mkdirSync(sessions);
  fs.mkdirSync(path.join(vault, ".git"));
  config(FULL_LOOP);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("loop due", () => {
  test("no cadence declared: exit 11, and it says the vault will never fire", () => {
    config("");
    const r = loop("due");
    expect(r.code).toBe(11);
    expect(r.out).toMatch(/never fire on its own/);
  });

  test("no spend ceiling declared: exit 12, and it will not pick one", () => {
    config('loop:\n  cadence: "6h"\n');
    const r = loop("due");
    expect(r.code).toBe(12);
    expect(r.out).toMatch(/will not pick a ceiling/);
  });

  test("over the ceiling: exit 13, distinct from the undeclared case", () => {
    spend(500); // ×5 weighting = 2500, over the 1000 ceiling
    const r = loop("due");
    expect(r.code).toBe(13);
    expect(r.out).toMatch(/ceiling/);
  });

  test("cadence and ceiling both satisfied: exit 0", () => {
    spend(1);
    const r = loop("due");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^due:/m);
  });

  test("a vault that has never fired says so, on every invocation", () => {
    spend(1);
    expect(loop("due").out).toMatch(/last record: none — this vault has never fired/);
  });

  test("inside the window: exit 10, the one refusal a wrapper may treat as routine", () => {
    spend(1);
    expect(loop("start").code).toBe(0);
    expect(loop("step", "--phase", "pass", "--", "true").code).toBe(0);
    expect(loop("step", "--phase", "check", "--", "true").code).toBe(0);
    expect(loop("seal").code).toBe(0);

    const r = loop("due");
    expect(r.code).toBe(10);
    expect(r.out).toMatch(/not due: next due/);
  });
});

describe("the firing bracket", () => {
  test("a firing appends exactly one record, and its verdict is not the caller's to choose", () => {
    spend(1);
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    loop("step", "--phase", "check", "--", "true");
    const sealed = loop("seal");
    // No commit moved (this .git is a stub), so a green firing that changed
    // nothing is `no-op` rather than `healthy`.
    expect(sealed.out).toMatch(/sealed: no-op/);
    const ledger = fs.readFileSync(path.join(vault, ".git", "ost-agent", "runs.jsonl"), "utf8").trim().split("\n");
    expect(ledger).toHaveLength(1);
  });

  test("a red phase seals unhealthy and exits non-zero", () => {
    spend(1);
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    expect(loop("step", "--phase", "check", "--", "false").code).toBe(1);
    const sealed = loop("seal");
    expect(sealed.out).toMatch(/sealed: unhealthy/);
    expect(sealed.code).toBe(1);
  });

  test("a skipped phase seals unhealthy — omission does not read as healthy", () => {
    spend(1);
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    expect(loop("seal").out).toMatch(/sealed: unhealthy/);
  });

  test("a firing that never sealed is recorded `crashed` by the next one", () => {
    spend(1);
    // A holder pid above every default pid_max: this firing's owner is already
    // gone, which is what the machine dying looks like to the next firing.
    loop("start", "--holder-pid", "4194303");
    loop("step", "--phase", "pass", "--", "true");
    // The next firing breaks the dead firing's lock and sweeps its open marker.
    expect(loop("start").code).toBe(0);
    const ledger = fs.readFileSync(path.join(vault, ".git", "ost-agent", "runs.jsonl"), "utf8").trim().split("\n");
    expect(ledger).toHaveLength(1);
    expect(JSON.parse(ledger[0]).verdict).toBe("crashed");
  });

  test("the overlap lock refuses a second firing with its own exit code", () => {
    spend(1);
    expect(loop("start").code).toBe(0);
    const second = loop("start");
    expect(second.code).toBe(15);
    expect(second.out).toMatch(/another firing holds the lock/);
  });

  test("a live holder pid keeps the lock held, so it is not simply refusing everything", () => {
    spend(1);
    expect(loop("start", "--holder-pid", String(process.pid)).code).toBe(0);
    expect(loop("start", "--holder-pid", String(process.pid)).code).toBe(15);
  });

  test("a step whose exit code cannot report failure is refused before anything is recorded", () => {
    spend(1);
    loop("start");
    const r = loop("step", "--phase", "check", "--", "bash", "-c", "false | tail -1");
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/exit code cannot report failure/);
    // Nothing recorded: the open run still has no steps.
    const open = JSON.parse(fs.readFileSync(path.join(vault, ".git", "ost-agent", "open-run.json"), "utf8"));
    expect(open.steps).toEqual([]);
  });
});

describe("nothing the loop writes lands in the working tree", () => {
  test("the ledger, the marker and the lock are all under .git", () => {
    // Every mutating MCP tool commits with `git add -A`. A record in the
    // working tree would be swept into the next `mcp: <tool>` commit — W2's
    // failure and D5's, manufactured on every firing.
    //
    // The snapshot is taken BEFORE `loop start`, which is the command most likely
    // to create something: it takes the lock and opens the run record. An earlier
    // version captured it after `start` and after the first `step`, so anything
    // those two wrote was baked into the baseline and compared against itself.
    spend(1);
    const before = fs.readdirSync(vault).sort();
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    loop("step", "--phase", "check", "--", "true");
    loop("seal");
    expect(fs.readdirSync(vault).sort()).toEqual(before);

    // Named directories as well as the listing, because a bracket that wrote
    // nothing at all would satisfy the equality above for the wrong reason.
    expect(fs.existsSync(path.join(vault, ".ost-agent"))).toBe(false);
    expect(fs.existsSync(path.join(vault, ".git", "ost-agent", "runs.jsonl"))).toBe(true);
  });

  test("git sees a clean working tree across the whole bracket", () => {
    // The listing check above cannot see a *modified* tracked file, and criterion
    // D5 is stated in terms of `git status --porcelain` being empty at the start of
    // a firing. Assert the thing the criterion actually says, against a real
    // repository — the shared fixture's `.git` is a bare directory, which is enough
    // for the loop to record into but cannot answer a status query.
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

    fs.rmSync(path.join(vault, ".git"), { recursive: true, force: true });
    git("init", "--quiet");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    spend(1);
    git("add", "-A");
    git("commit", "--quiet", "-m", "baseline");
    expect(git("status", "--porcelain").trim()).toBe("");

    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    loop("step", "--phase", "check", "--", "true");
    loop("seal");

    // The bracket really recorded — otherwise a no-op would satisfy this trivially.
    expect(fs.existsSync(path.join(vault, ".git", "ost-agent", "runs.jsonl"))).toBe(true);
    expect(git("status", "--porcelain").trim()).toBe("");
  });
});
