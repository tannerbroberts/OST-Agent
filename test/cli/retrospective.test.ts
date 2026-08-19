import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RETROSPECTIVE_CHANNEL_PATH } from "../../src/adapters/channels.js";
import { defaultConfigYaml } from "../../src/config/schema.js";

const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const run = promisify(execFile);
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cli-retro-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), defaultConfigYaml("Reach 10,000 daily active users"), "utf8");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function cli(args: string[]) {
  return run(TSX, [CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
}

const retroDir = () => path.join(dir, RETROSPECTIVE_CHANNEL_PATH);

describe("ost-agent retrospective", () => {
  test("files the confession into the vault's retrospective channel, with the session id required", async () => {
    const { stdout } = await cli([
      "retrospective",
      "Assumed the vault path instead of resolving it",
      "--session",
      "s-abc123",
      "--vault",
      dir,
    ]);

    const notes = fs.readdirSync(retroDir());
    expect(notes).toHaveLength(1);
    const body = fs.readFileSync(path.join(retroDir(), notes[0]), "utf8");
    expect(body).toContain("Assumed the vault path instead of resolving it");
    expect(body).toContain("s-abc123");
    expect(stdout).toContain(notes[0]);
  }, 30_000);

  test("refuses to run without a session id", async () => {
    await expect(cli(["retrospective", "x", "--vault", dir])).rejects.toThrow();
    expect(fs.existsSync(retroDir())).toBe(false);
  }, 30_000);
});
