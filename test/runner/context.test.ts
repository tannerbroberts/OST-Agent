import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { configPath } from "../../src/config/load.js";

let dir: string;
const ENV_KEYS = ["ATLASSIAN_BASE_URL", "ATLASSIAN_EMAIL", "ATLASSIAN_API_TOKEN"];
let saved: Record<string, string | undefined>;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-ctx-"));
  await initVault(dir, "Reach 10,000 daily active users");
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

function enableAtlassian() {
  fs.writeFileSync(
    configPath(dir),
    `outcome: "Reach 10,000 daily active users"\nadapters:\n  atlassian:\n    enabled: true\n    projects: ["PROJ"]\n    spaces: []\n`,
    "utf8",
  );
}

describe("buildPassContext adapter wiring", () => {
  test("inbox-only by default", () => {
    const ctx = buildPassContext(dir);
    expect(ctx.sources.map((s) => s.name)).toEqual(["inbox"]);
  });

  test("enabling Atlassian without credentials fails with a clear message", () => {
    enableAtlassian();
    expect(() => buildPassContext(dir)).toThrow(/ATLASSIAN_BASE_URL|API token/);
  });

  test("enabling Atlassian with credentials adds the source", () => {
    enableAtlassian();
    process.env.ATLASSIAN_BASE_URL = "https://x.atlassian.net";
    process.env.ATLASSIAN_EMAIL = "me@x.com";
    process.env.ATLASSIAN_API_TOKEN = "tok";
    const ctx = buildPassContext(dir);
    expect(ctx.sources.map((s) => s.name).sort()).toEqual(["atlassian", "inbox"]);
  });
});
