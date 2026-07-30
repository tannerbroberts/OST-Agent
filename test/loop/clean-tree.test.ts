/**
 * `workingTreeStatus` — the reader criterion D5's refusal is built on, and the
 * one question it must never answer wrongly: *is this vault clean right now?*
 *
 * Two wrong answers, with very different costs. A false "dirty" wedges an
 * unattended loop on a vault that was fine. A false "clean" is the failure D5
 * exists to prevent: the firing proceeds, and the leftover file is committed by
 * the next mutating tool under that tool's name (`git add -A`,
 * `src/git/safe-git.ts:49`) — W2 manufactured deterministically — while F4's
 * HEAD-delta verdict shifts by one firing and a dead vault reads `healthy`.
 *
 * The third answer, `unknown`, is deliberately its own shape rather than being
 * folded into either. Tested here because folding it into "clean" is the easy
 * mistake (a `catch { return clean }` reads harmless) and is precisely the false
 * clean above.
 *
 * The end-to-end refusal — exit codes, message, the wedge — is pinned in
 * `test/cli/loop.test.ts`; this file is the unit underneath it, plus one thing
 * only a full CLI can prove: that the vault the documented first-run path creates
 * is clean enough to fire. If `ost-agent init` left anything uncommitted, D5's
 * refusal would land on day one, on every new vault, and be indistinguishable
 * from the tool being broken.
 *
 * **Non-vacuity, proved by mutation rather than claimed.** `workingTreeStatus`
 * was made to answer `clean` unconditionally — the exact bug that matters, since
 * a false clean is what lets a firing proceed against a leftover — and **seven of
 * the nine rows below went red**, including the first-run row, whose inline
 * control expects a refusal. Exactly two stayed green, and they are the two that
 * expect `clean` as their answer: a committed vault and an ignored file. That
 * split is the control — these rows are not all asserting the same thing — and it
 * is written down because an earlier draft of this paragraph guessed the number
 * (six) and named "a path that does not exist" as a survivor, when that row
 * demands `unknown` and reddens like the rest.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { workingTreeStatus } from "../../src/loop/state.js";

const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

let dir: string;
let vault: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function initRepo(at: string): void {
  fs.mkdirSync(at, { recursive: true });
  const run = (...args: string[]) =>
    execFileSync("git", args, { cwd: at, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  run("init", "--quiet");
  run("config", "user.email", "t@example.com");
  run("config", "user.name", "t");
  run("config", "commit.gpgsign", "false");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-clean-tree-"));
  vault = path.join(dir, "vault");
  initRepo(vault);
  fs.writeFileSync(path.join(vault, "tracked.md"), "one\n", "utf8");
  git("add", "-A");
  git("commit", "--quiet", "-m", "baseline");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("workingTreeStatus", () => {
  test("a committed vault is clean", () => {
    expect(workingTreeStatus(vault)).toEqual({ kind: "clean" });
  });

  test("an untracked file is dirty, and the entry is git's own line", () => {
    fs.writeFileSync(path.join(vault, "zz-probe.md"), "left behind\n", "utf8");
    const status = workingTreeStatus(vault);
    expect(status.kind).toBe("dirty");
    // The porcelain code is kept, not stripped: `??` is what tells an operator
    // this is a file nobody has ever tracked rather than an edit they made.
    if (status.kind === "dirty") expect(status.entries).toEqual(["?? zz-probe.md"]);
  });

  test("a modified tracked file is dirty too — the case a directory listing cannot see", () => {
    // `test/cli/loop.test.ts` also asserts a listing-based invariant ("nothing
    // the loop writes lands in the working tree"). That check is blind to this
    // row: the file already existed. D5 is stated in `git status` terms for
    // exactly this reason.
    fs.writeFileSync(path.join(vault, "tracked.md"), "two\n", "utf8");
    const status = workingTreeStatus(vault);
    expect(status.kind).toBe("dirty");
    if (status.kind === "dirty") expect(status.entries).toEqual([" M tracked.md"]);
  });

  test("a staged-but-uncommitted file is dirty — the tool that stages is not the tool that commits", () => {
    // The specific way this bites: `gitCommit` runs `git add -A` and then
    // commits everything staged. A path staged by somebody else is already
    // loaded into the next tool's commit before that tool runs.
    fs.writeFileSync(path.join(vault, "staged.md"), "x\n", "utf8");
    git("add", "staged.md");
    const status = workingTreeStatus(vault);
    expect(status.kind).toBe("dirty");
    if (status.kind === "dirty") expect(status.entries).toEqual(["A  staged.md"]);
  });

  test("an ignored file is clean — git's ignore rules decide, not a rule of our own", () => {
    // Non-vacuity for the row above as well: the same directory, one line of
    // `.gitignore` apart, produces the opposite verdict.
    fs.writeFileSync(path.join(vault, ".gitignore"), "scratch/\n", "utf8");
    git("add", "-A");
    git("commit", "--quiet", "-m", "ignore scratch");
    fs.mkdirSync(path.join(vault, "scratch"));
    fs.writeFileSync(path.join(vault, "scratch", "notes.md"), "x\n", "utf8");
    expect(workingTreeStatus(vault)).toEqual({ kind: "clean" });
  });

  test("everything under .git is invisible, which is why the loop records there", () => {
    // The load-bearing fact behind the wedge test in test/cli/loop.test.ts,
    // asserted directly at the level it is true at: git will not report its own
    // directory however much is written into it. `<vault>/.ost-agent/` — the
    // location an earlier draft used — would have made every firing dirty the
    // tree for the next one.
    const state = path.join(vault, ".git", "ost-agent");
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, "runs.jsonl"), '{"runId":"x"}\n', "utf8");
    fs.writeFileSync(path.join(state, "firing.lock"), '{"pid":1}\n', "utf8");
    expect(workingTreeStatus(vault)).toEqual({ kind: "clean" });

    // Control: the same two files one directory up ARE seen, so the assertion
    // above is about `.git` and not about this function ignoring writes.
    const outside = path.join(vault, ".ost-agent");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "runs.jsonl"), '{"runId":"x"}\n', "utf8");
    expect(workingTreeStatus(vault).kind).toBe("dirty");
  });

  test("a directory git cannot describe is `unknown`, never `clean`", () => {
    // A bare `.git` directory: enough for the loop's state dir to resolve, not
    // enough for git to answer a status query. Reporting this as clean would let
    // a firing proceed against a vault whose state nothing can vouch for, which
    // is a false clean — the expensive direction.
    const stub = path.join(dir, "stub");
    fs.mkdirSync(path.join(stub, ".git"), { recursive: true });
    const status = workingTreeStatus(stub);
    expect(status.kind).toBe("unknown");
    if (status.kind === "unknown") expect(status.reason).toMatch(/not a git repository/);
  });

  test("a path that does not exist is `unknown` as well, and does not throw", () => {
    // `loop start` calls this before anything else; a throw here would be an
    // unhandled stack trace instead of a refusal an operator can act on.
    const status = workingTreeStatus(path.join(dir, "no-such-vault"));
    expect(status.kind).toBe("unknown");
  });
});

describe("the first-run path leaves a vault that can fire", () => {
  test("`ost-agent init` commits everything it wrote, so the first `loop start` is not refused", () => {
    // D5's refusal is fail-closed with a human-only way out, which is only
    // defensible if the vault the tool itself creates starts clean. If `init`
    // left its own files untracked, every brand-new vault would refuse its first
    // firing, and the operator's first experience of the mechanism would be
    // indistinguishable from a bug — R2's shape on the front door.
    const fresh = path.join(dir, "fresh");
    execFileSync(TSX, [CLI, "init", fresh, "-o", "ship the thing"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    expect(workingTreeStatus(fresh)).toEqual({ kind: "clean" });

    // And the CLI agrees, end to end — the reader above could be right while
    // `loop start` consulted something else.
    const started = execFileSync(TSX, [CLI, "loop", "start", "--vault", fresh], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(started).toMatch(/loop run .* open/);

    // Control: the identical vault, one stray file later, IS refused — so the
    // pass above is a fact about `init` and not about the gate being absent.
    // The run opened above is deliberately left open: the tree check runs before
    // the lock, so this asserts 14 (dirty) and not 15 (locked), which is the
    // ordering `loop start` promises — a refusal that takes no lock and writes
    // no record.
    fs.writeFileSync(path.join(fresh, "zz-probe.md"), "x\n", "utf8");
    let code = 0;
    try {
      execFileSync(TSX, [CLI, "loop", "start", "--vault", fresh], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      code = (e as { status: number | null }).status ?? -1;
    }
    expect(code).toBe(14);
  });
});
