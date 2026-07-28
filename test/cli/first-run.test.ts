/**
 * The wall a first-time user actually hits, exercised through the real CLI.
 *
 * Observed in a fresh-user simulation on 2026-07-25, and it failed in the way
 * that is easiest to miss: technically correct, operationally useless. This test
 * asserts the *message*, because the message is the whole feature.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// The local tsx binary, invoked directly rather than through `npx`.
// `npx` adds a process layer AND consults npm's cache, which takes a cacache
// lock; dozens of concurrent spawns on a small CI runner contend on that lock
// and can wedge the whole suite. Nothing here needs resolution — tsx is a
// devDependency, so the binary is already on disk.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");

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
      command: TSX,
      args: [CLI, "mcp", "--vault", dir],
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
      expect(work.nextStep).toMatch(/ost-agent\.mjs init/);
    } finally {
      await client.close();
    }
    // and it did not quietly make a vault to keep itself happy
    expect(fs.existsSync(path.join(dir, ".git"))).toBe(false);
  }, 30_000);
});
