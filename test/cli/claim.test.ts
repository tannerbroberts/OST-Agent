/**
 * `ost-agent claim` — the shell surface of the work claim.
 *
 * The module's own spec (`test/loop/work-claim-vocabulary-match.test.ts`) proves
 * the matcher. What this file proves is the half a caller depends on and a unit
 * test cannot reach: **the exit code**. A wrapper script runs this command and
 * branches on the number, so "somebody already holds this" and "you did not say
 * what you are doing" have to be different numbers — collapsing them into 1
 * makes a pass that cannot name its work look exactly like a pass that lost a
 * race, and the fix for those is not the same.
 *
 * Every degradation is a refusal here rather than a default, and that is what
 * most of these assert. A `claim` that exits 0 because it could not find the
 * ledger, could not read the briefing or was not told who is asking is a pass
 * waved through — the exact failure the command exists to stop, arriving through
 * the command itself.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CLAIM_EXIT } from "../../src/loop/claim.js";

// See `test/cli/friction.test.ts` — the local tsx binary, not `npx`, so dozens
// of concurrent spawns do not contend on npm's cacache lock.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");
const BRIEFING = path.resolve(__dirname, "../fixtures/work-claim/briefing-2026-07-26.md");
const run = promisify(execFile);

const READING_A = "invited-visitor arm split";
const READING_B = "add an arm column to visitor_events";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cli-claim-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Resolves with the exit code rather than rejecting, since non-zero is the point. */
async function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(TSX, [CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? -1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

const claim = (naming: string, session: string, extra: string[] = []) =>
  cli(["claim", naming, "--briefing", BRIEFING, "--state", dir, "--session", session, ...extra]);

describe("ost-agent claim", () => {
  test("the first pass takes the work and exits 0", async () => {
    const r = await claim(READING_A, "session-one");
    expect(r.code).toBe(CLAIM_EXIT.taken);
    expect(r.stdout).toContain("CLAIMED");
    expect(r.stdout).toContain("invited-visitor arm split");
  });

  test("a second pass wording the same item differently is refused, with its own exit code", async () => {
    await claim(READING_A, "session-one");

    const r = await claim(READING_B, "session-two");
    expect(r.code).toBe(CLAIM_EXIT.alreadyClaimed);
    expect(r.stdout).toContain("ALREADY CLAIMED");
    expect(r.stdout).toContain("session-one");
  });

  test("a different item in the same briefing is not blocked by that claim", async () => {
    await claim(READING_A, "session-one");

    const r = await claim("the lobby reconnect timeout on flaky mobile networks", "session-two");
    expect(r.code).toBe(CLAIM_EXIT.taken);
  });

  test("work the briefing does not name is refused as unresolved, not granted", async () => {
    const r = await claim("upgrade the CI image so integration jobs stop timing out", "session-two");
    expect(r.code).toBe(CLAIM_EXIT.unresolved);
    expect(r.stdout).toContain("NOT CLAIMED");
    // And nothing was written, so a later pass is not blocked by a key nobody
    // else can compute.
    const list = await cli(["claim", "--list", "--briefing", BRIEFING, "--state", dir]);
    expect(list.stdout).toContain("No work is claimed");
  });

  test("an unnamed session is a refusal — two passes under one name exclude nobody", async () => {
    const r = await cli(["claim", READING_A, "--briefing", BRIEFING, "--state", dir]);
    expect(r.code).toBe(CLAIM_EXIT.unresolved);
    expect(r.stderr).toContain("no session named");
  });

  test("an unreadable briefing is a refusal, not an empty briefing", async () => {
    const r = await cli([
      "claim", READING_A, "--briefing", path.join(dir, "nope.md"), "--state", dir, "--session", "s",
    ]);
    expect(r.code).toBe(CLAIM_EXIT.unresolved);
    expect(r.stderr).toContain("cannot read the briefing");
  });

  test("--list names the holder and the wording it used", async () => {
    await claim(READING_A, "session-one");

    const r = await cli(["claim", "--list", "--briefing", BRIEFING, "--state", dir]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("session-one holds");
    expect(r.stdout).toContain(READING_A);
  });

  test("--release frees the item for the other pass, and only for its holder", async () => {
    await claim(READING_A, "session-one");

    const notMine = await claim(READING_B, "session-two", ["--release"]);
    expect(notMine.stdout).toContain("NOT RELEASED");

    const mine = await claim(READING_A, "session-one", ["--release"]);
    expect(mine.stdout).toContain("RELEASED");

    const retaken = await claim(READING_B, "session-two");
    expect(retaken.code).toBe(CLAIM_EXIT.taken);
  });

  test("the holder renewing its own claim is not a collision", async () => {
    await claim(READING_A, "session-one");
    const again = await claim(READING_B, "session-one");
    expect(again.code).toBe(CLAIM_EXIT.taken);
    expect(again.stdout).toContain("STILL YOURS");
  });
});
