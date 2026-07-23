import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { initVault } from "../../src/runner/init.js";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-mcp-stdio-"));
  await initVault(dir, "Reach 10,000 daily active users", "Retention");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("ost-agent mcp (stdio, no API key)", () => {
  test("spawns, lists tools, and creates a node over real stdio", async () => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "ANTHROPIC_API_KEY" && v !== undefined) env[k] = v;
    }
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/cli/index.ts", "mcp", "--vault", dir],
      env,
    });
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("ost_create_node");
      const res = await client.callTool({
        name: "ost_create_node",
        arguments: { title: "Daily streak", layer: "Opportunity", parent: "Retention", body: "b", source: "INBOX:y" },
      });
      expect(res.isError).toBeFalsy();
      expect(JSON.stringify(res.content)).toMatch(/committed/);
    } finally {
      await client.close();
    }
    // the write landed on disk in the server's vault
    expect(fs.existsSync(path.join(dir, "Daily streak.md"))).toBe(true);
  }, 30_000);
});
