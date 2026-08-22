import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { FRICTION_CHANNEL_PATH } from "../../src/adapters/channels.js";
import { defaultConfigYaml } from "../../src/config/schema.js";

// The local tsx binary, invoked directly rather than through `npx`.
// `npx` adds a process layer AND consults npm's cache, which takes a cacache
// lock; dozens of concurrent spawns on a small CI runner contend on that lock
// and can wedge the whole suite. Nothing here needs resolution — tsx is a
// devDependency, so the binary is already on disk.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");

const run = promisify(execFile);
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cli-friction-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), defaultConfigYaml("Reach 10,000 daily active users"), "utf8");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function cli(args: string[]) {
  return run(TSX, [CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
}

/**
 * The three fields `friction` now requires, in flag form. Appended to the cases
 * below, whose subject is where a filing lands rather than what it carries.
 */
const ACTIONABLE_FLAGS = [
  "--tool", "ost-agent check",
  "--input", "--vault (omitted)",
  "--expected", "it reads ost.vault.yaml and finds the tree",
];

const frictionDir = () => path.join(dir, FRICTION_CHANNEL_PATH);

describe("ost-agent friction", () => {
  test("files a one-line friction note into the vault's friction channel", async () => {
    const { stdout } = await cli(["friction", "The vault is not discoverable from the repo", ...ACTIONABLE_FLAGS, "--vault", dir]);

    const notes = fs.readdirSync(frictionDir());
    expect(notes).toHaveLength(1);
    expect(fs.readFileSync(path.join(frictionDir(), notes[0]), "utf8")).toContain("not discoverable from the repo");
    expect(stdout).toContain(notes[0]); // tells the agent where it landed
    // Non-vacuity for the folder, not just the file: channel zero — the folder the
    // untrusted builder writes, and the one `init` now points OUTSIDE the vault —
    // was not created and did not receive it.
    expect(fs.existsSync(path.join(dir, ".ost-agent", "inbox"))).toBe(false);
  }, 30_000);

  test("carries the kind and context through to the note", async () => {
    await cli([
      "friction",
      "Had to guess which vault to read",
      "--kind",
      "guessed",
      "--context",
      "four candidate vault directories exist",
      ...ACTIONABLE_FLAGS,
      "--vault",
      dir,
    ]);

    const body = fs.readFileSync(path.join(frictionDir(), fs.readdirSync(frictionDir())[0]), "utf8");
    expect(body).toContain("guessed");
    expect(body).toContain("four candidate vault directories exist");
  }, 30_000);

  test("rejects an unknown kind instead of filing a mislabelled note", async () => {
    await expect(cli(["friction", "x", "--kind", "vibes", ...ACTIONABLE_FLAGS, "--vault", dir])).rejects.toThrow(/blocked/);
    expect(fs.existsSync(frictionDir())).toBe(false);
  }, 30_000);
});
