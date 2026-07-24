import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { defaultConfigYaml } from "../../src/config/schema.js";

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
  return run("npx", ["tsx", CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
}

describe("ost-agent friction", () => {
  test("files a one-line friction note into the vault inbox", async () => {
    const { stdout } = await cli(["friction", "The vault is not discoverable from the repo", "--vault", dir]);

    const inbox = path.join(dir, ".ost-agent", "inbox");
    const notes = fs.readdirSync(inbox);
    expect(notes).toHaveLength(1);
    expect(fs.readFileSync(path.join(inbox, notes[0]), "utf8")).toContain("not discoverable from the repo");
    expect(stdout).toContain(notes[0]); // tells the agent where it landed
  }, 30_000);

  test("carries the kind and context through to the note", async () => {
    await cli([
      "friction",
      "Had to guess which vault to read",
      "--kind",
      "guessed",
      "--context",
      "four candidate vault directories exist",
      "--vault",
      dir,
    ]);

    const inbox = path.join(dir, ".ost-agent", "inbox");
    const body = fs.readFileSync(path.join(inbox, fs.readdirSync(inbox)[0]), "utf8");
    expect(body).toContain("guessed");
    expect(body).toContain("four candidate vault directories exist");
  }, 30_000);

  test("rejects an unknown kind instead of filing a mislabelled note", async () => {
    await expect(cli(["friction", "x", "--kind", "vibes", "--vault", dir])).rejects.toThrow(/blocked/);
    expect(fs.existsSync(path.join(dir, ".ost-agent", "inbox"))).toBe(false);
  }, 30_000);
});
