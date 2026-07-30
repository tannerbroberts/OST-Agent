/**
 * A friction filing must not wedge the firing after it.
 *
 * The friction channel's folder is inside the vault on purpose — that is what gets
 * a filing committed with the tree rather than stranded outside it. The cost of
 * being inside is that the filing lands in the working tree, and D5's gate refuses
 * a firing over any dirty path it did not put there (`entriesRequiringAHuman`,
 * `src/cli/loop.ts`), with a deliberately human-only way out. So `ost-agent
 * friction` — the command `README.md` tells the agent to run the moment it is
 * blocked, which is exactly when it has stopped making mutating calls that would
 * commit — would leave residue that refuses every later firing until a person
 * cleared it. The affordance for being stuck would be the thing that stops the loop.
 *
 * This drives the real CLI against a real git vault, because the whole question is
 * what `git status` says afterwards.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { workingTreeStatus } from "../../src/loop/state.js";
import { entriesRequiringAHuman } from "../../src/cli/loop.js";
import { FRICTION_CHANNEL_PATH } from "../../src/adapters/channels.js";

// The local tsx binary, invoked directly rather than through `npx`: `npx` takes
// npm's cacache lock, and dozens of concurrent spawns contend on it.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");
const run = promisify(execFile);

let parent: string;
let dir: string;

beforeEach(async () => {
  parent = fs.mkdtempSync(path.join(os.tmpdir(), "ost-friction-residue-"));
  dir = path.join(parent, "vault");
  await initVault(dir, "Reach ten returning operators.", "Retention");
});
afterEach(() => fs.rmSync(parent, { recursive: true, force: true }));

function friction(args: string[]) {
  return run(TSX, [CLI, "friction", ...args, "--vault", dir], { cwd: path.resolve(__dirname, "../..") });
}

/** Exactly what `loop start` would refuse over. Empty means the next firing may begin. */
function refusesAFiring(): string[] {
  const status = workingTreeStatus(dir);
  if (status.kind === "clean") return [];
  if (status.kind === "unknown") throw new Error(`could not read the vault's status: ${status.reason}`);
  return entriesRequiringAHuman(status.entries);
}

describe("filing friction leaves a vault the loop can still fire", () => {
  test("the filing is committed, so nothing is left for D5 to refuse", async () => {
    expect(refusesAFiring()).toEqual([]); // an init'ed vault starts clean

    const { stdout } = await friction(["Had to guess which vault to read", "--kind", "guessed"]);
    expect(stdout).toMatch(/committed [0-9a-f]{8}/);

    // The property, stated as the loop states it: there is nothing here a person
    // has to explain, so `ost-agent loop start` fires instead of refusing.
    expect(refusesAFiring()).toEqual([]);
    // …and the filing is really on disk and really tracked — "clean" above is the
    // file being in history, not the file being absent.
    const filings = fs.readdirSync(path.join(dir, FRICTION_CHANNEL_PATH));
    expect(filings).toHaveLength(1);

    // Non-vacuity: the same predicate DOES see an ordinary stray file, so the empty
    // list above is the commit working rather than the check being blind.
    fs.writeFileSync(path.join(dir, "Stray.md"), "left behind\n", "utf8");
    expect(refusesAFiring()).toEqual([expect.stringContaining("Stray.md")]);
  }, 30_000);

  test("a second filing commits too — the first one does not become the blocker", async () => {
    await friction(["first"]);
    const { stdout } = await friction(["second"]);
    expect(stdout).toMatch(/committed [0-9a-f]{8}/);
    expect(refusesAFiring()).toEqual([]);
    expect(fs.readdirSync(path.join(dir, FRICTION_CHANNEL_PATH))).toHaveLength(2);
  }, 30_000);

  /**
   * The gate on the commit, which is D5's own argument turned around: `gitCommit`
   * stages with `git add -A`, so committing from a tree that already holds somebody
   * else's file would put that file into history under this filing's name — the
   * misattribution D5 exists to stop. The filing still happens; only the commit is
   * withheld, and the reason is said out loud.
   */
  test("it refuses to commit over a tree that was already dirty, and says so", async () => {
    fs.writeFileSync(path.join(dir, "Somebody-elses.md"), "not mine\n", "utf8");

    const { stdout } = await friction(["filed on top of a dirty tree"]);
    expect(stdout).toMatch(/NOT committed/);
    expect(stdout).toContain("Somebody-elses.md");
    expect(stdout).not.toMatch(/committed [0-9a-f]{8}/);
    // The filing itself is never withheld — the record survives whatever git did.
    expect(fs.readdirSync(path.join(dir, FRICTION_CHANNEL_PATH))).toHaveLength(1);
    // The stranger's file is still untracked: nothing swept it into history.
    expect(refusesAFiring().some((e) => e.includes("Somebody-elses.md"))).toBe(true);
  }, 30_000);

  /**
   * The residue every conforming pass leaves — a read-only tool call appends to
   * `.ost-agent/usage/` and nothing commits it (`FIRING_TRACE_PREFIX`). It must NOT
   * suppress the commit: if it did, the wedge would come back for every vault that
   * has ever run a pass, which is every vault this matters for.
   */
  test("the firing trace does not suppress the commit", async () => {
    const usage = path.join(dir, ".ost-agent", "usage");
    fs.mkdirSync(usage, { recursive: true });
    fs.writeFileSync(path.join(usage, "events.jsonl"), '{"tool":"ost_next_work"}\n', "utf8");
    // Non-vacuity for the setup: the tree really is dirty, and D5 really does wave
    // this one path through — so the commit below happens over a dirty tree.
    expect(workingTreeStatus(dir).kind).toBe("dirty");
    expect(refusesAFiring()).toEqual([]);

    const { stdout } = await friction(["filed after a read-only pass"]);
    expect(stdout).toMatch(/committed [0-9a-f]{8}/);
    expect(refusesAFiring()).toEqual([]);
  }, 30_000);

  /**
   * A vault that is not a checkout still gets its filing. The record is the thing
   * that must survive; the commit is what it would like.
   */
  test("no git history means the filing still happens, and the operator is told it is unversioned", async () => {
    fs.rmSync(path.join(dir, ".git"), { recursive: true, force: true });

    const { stdout } = await friction(["filed into a vault with no history"]);
    expect(stdout).toMatch(/NOT committed/);
    expect(stdout).toMatch(/nothing has versioned it/);
    expect(fs.readdirSync(path.join(dir, FRICTION_CHANNEL_PATH))).toHaveLength(1);
  }, 30_000);
});
