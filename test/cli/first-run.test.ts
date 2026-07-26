/**
 * The two walls a first-time user actually hits, exercised through the real CLI.
 *
 * Both were observed in a fresh-user simulation on 2026-07-25 and both failed in
 * the same way: technically correct, operationally useless. These tests assert
 * the *message*, because the message is the whole feature.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { initVault } from "../../src/runner/init.js";

const run = promisify(execFile);
const REPO = path.resolve(__dirname, "../..");
const CLI = path.join(REPO, "src/cli/index.ts");

/** The environment a PM who has not bought a credential actually has. */
function envWithoutCredentials(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "ANTHROPIC_API_KEY" && k !== "ANTHROPIC_AUTH_TOKEN" && v !== undefined) env[k] = v;
  }
  return env;
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-first-run-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("ost-agent mcp in a folder that is not a vault", () => {
  test("still serves the tools, and ost_next_work says how to create the vault", async () => {
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", CLI, "mcp", "--vault", dir],
      env: envWithoutCredentials(),
      cwd: REPO,
    });
    const client = new Client({ name: "test", version: "0.0.0" });
    // connecting at all is half the assertion: this used to throw before the
    // transport came up, so the operator saw only "MCP server failed"
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("ost_next_work");
      const res = (await client.callTool({ name: "ost_next_work", arguments: {} })) as {
        isError?: boolean;
        content: Array<{ text?: string }>;
      };
      expect(res.isError).toBeFalsy();
      const work = JSON.parse(res.content.map((c) => c.text ?? "").join(""));
      expect(work.bootstrap).toBe(true);
      expect(work.nextStep).toMatch(/ost-agent init/);
    } finally {
      await client.close();
    }
    // and it did not quietly make a vault to keep itself happy
    expect(fs.existsSync(path.join(dir, ".git"))).toBe(false);
  }, 30_000);
});

describe("ost-agent run without a credential", () => {
  test("a model-driven pass names both the key and the no-key path, and exits 1", async () => {
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    const failure = await run("npx", ["tsx", CLI, "run", "P2_map", "--vault", dir], {
      cwd: REPO,
      env: envWithoutCredentials(),
    }).then(
      () => null,
      (e: { code?: number; stdout: string; stderr: string }) => e,
    );
    expect(failure, "an unrunnable pass must not exit 0").not.toBeNull();
    expect(failure?.code).toBe(1);
    const out = `${failure?.stdout}${failure?.stderr}`;
    expect(out).toMatch(/ANTHROPIC_API_KEY/);
    expect(out).toMatch(/plugin install ost-agent/);
    expect(out).not.toMatch(/Could not resolve authentication method/);
    // it stopped before the pass, so there is no journal entry to explain away
    expect(fs.existsSync(path.join(dir, ".ost-agent", "runs"))).toBe(true);
    expect(fs.readdirSync(path.join(dir, ".ost-agent", "runs")).filter((f) => f.includes("P2_map"))).toEqual([]);
  }, 60_000);

  test("a model-free pass is not gated — ingest still runs with no credential", async () => {
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    fs.writeFileSync(path.join(dir, ".ost-agent", "inbox", "note.md"), "A player said the daily board is why they open it.\n");
    const { stdout } = await run("npx", ["tsx", CLI, "run", "P1_ingest", "--vault", dir], {
      cwd: REPO,
      env: envWithoutCredentials(),
    });
    expect(stdout).toMatch(/P1_ingest/);
    expect(stdout).not.toMatch(/FAILED/);
  }, 60_000);
});
