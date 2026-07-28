import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { configPath } from "../../src/config/load.js";
import { genomePath } from "../../src/genome/load.js";

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
  test("inbox and the mechanical usage trace by default", () => {
    const ctx = buildPassContext(dir);
    expect(ctx.sources.map((s) => s.name).sort()).toEqual(["inbox", "usage"]);
  });

  test("enabling Atlassian without credentials fails with a clear message", () => {
    enableAtlassian();
    expect(() => buildPassContext(dir)).toThrow(/ATLASSIAN_BASE_URL|API token/);
  });

  test("enabling the transcript adapter with an explicit path adds the source", () => {
    fs.writeFileSync(
      configPath(dir),
      `outcome: "Reach 10,000 daily active users"\nadapters:\n  transcript:\n    enabled: true\n    path: ${JSON.stringify(dir)}\n`,
      "utf8",
    );
    const ctx = buildPassContext(dir);
    expect(ctx.sources.map((s) => s.name).sort()).toEqual(["inbox", "transcript", "usage"]);
  });

  test("enabling the transcript adapter with neither path nor projectDir fails clearly", () => {
    fs.writeFileSync(
      configPath(dir),
      `outcome: "Reach 10,000 daily active users"\nadapters:\n  transcript:\n    enabled: true\n`,
      "utf8",
    );
    expect(() => buildPassContext(dir)).toThrow(/transcript.*(path|projectDir)/i);
  });

  test("enabling Atlassian with credentials adds the source", () => {
    enableAtlassian();
    process.env.ATLASSIAN_BASE_URL = "https://x.atlassian.net";
    process.env.ATLASSIAN_EMAIL = "me@x.com";
    process.env.ATLASSIAN_API_TOKEN = "tok";
    const ctx = buildPassContext(dir);
    expect(ctx.sources.map((s) => s.name).sort()).toEqual(["atlassian", "inbox", "usage"]);
  });
});

describe("buildPassContext budget wiring — the operator's number, unless the genome says otherwise", () => {
  test("with NO genome.yaml the budget is the operator's configured number — an absent genome changes nothing", () => {
    fs.writeFileSync(
      configPath(dir),
      `outcome: "Reach 10,000 daily active users"\nweb:\n  lookupBudget: 4\n`,
      "utf8",
    );
    expect(fs.existsSync(genomePath(dir))).toBe(false);
    expect(buildPassContext(dir).web?.budget?.limit).toBe(4);
  });

  test("a genome with a null sharedPool still defers to the operator — the default genome is not an override", () => {
    fs.writeFileSync(
      configPath(dir),
      `outcome: "Reach 10,000 daily active users"\nweb:\n  lookupBudget: 4\n`,
      "utf8",
    );
    fs.writeFileSync(genomePath(dir), `budgets:\n  perClass: {}\n`, "utf8");
    expect(buildPassContext(dir).web?.budget?.limit).toBe(4);
  });

  test("an explicit sharedPool takes the wheel and the operator's number stands down", () => {
    fs.writeFileSync(
      configPath(dir),
      `outcome: "Reach 10,000 daily active users"\nweb:\n  lookupBudget: 4\n`,
      "utf8",
    );
    fs.writeFileSync(genomePath(dir), `budgets:\n  sharedPool: 2\n`, "utf8");
    expect(buildPassContext(dir).web?.budget?.limit).toBe(2);
  });
});
