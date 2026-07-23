import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { simpleGit } from "simple-git";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { createOstMcpServer, assertVaultReady, MCP_TOOL_NAMES } from "../../src/mcp/server.js";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-mcp-"));
  await initVault(dir, "Reach 10,000 daily active users", "Retention");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function connect(vaultDir: string): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createOstMcpServer(buildPassContext(vaultDir));
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

// result content is [{ type: "text", text }]; helper reads the first text block
function textOf(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content.map((c) => c.text ?? "").join("\n");
}

describe("createOstMcpServer", () => {
  test("exposes exactly the six OST tools and no git tools", async () => {
    const client = await connect(dir);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...MCP_TOOL_NAMES].sort());
    expect(names).not.toContain("git_commit");
    expect(names).not.toContain("git_push");
  });

  test("creating a node writes the file AND makes exactly one commit (no API key)", async () => {
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    const client = await connect(dir);
    const before = (await simpleGit(dir).log()).total;
    const res = await client.callTool({
      name: "ost_create_node",
      arguments: {
        title: "I want a reason to come back every day",
        layer: "Opportunity",
        parent: "Retention",
        body: "Players want a daily reason to return.",
        source: "INBOX:x",
      },
    });
    expect(res.isError).toBeFalsy();
    expect(textOf(res as never)).toMatch(/committed [0-9a-f]{8}/);
    expect(buildPassContext(dir).vault.has("I want a reason to come back every day")).toBe(true);
    expect((await simpleGit(dir).log()).total).toBe(before + 1);
  });

  test("ost_read_tree makes no commit", async () => {
    const client = await connect(dir);
    const before = (await simpleGit(dir).log()).total;
    const res = await client.callTool({ name: "ost_read_tree", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect((await simpleGit(dir).log()).total).toBe(before);
  });

  test("a hierarchy violation is returned as an error and does not mutate the tree", async () => {
    const client = await connect(dir);
    const before = buildPassContext(dir).vault.readTree().length;
    const res = await client.callTool({
      name: "ost_create_node",
      arguments: { title: "S", layer: "Solution", parent: "Retention", body: "b" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res as never)).toMatch(/must attach under Opportunity/);
    expect(buildPassContext(dir).vault.readTree().length).toBe(before);
  });

  test("a call to a tool that is not on the surface is refused (no destructive tool reachable)", async () => {
    const client = await connect(dir);
    for (const bad of ["ost_delete_node", "bash", "git_push"]) {
      const res = await client.callTool({ name: bad, arguments: {} });
      expect(res.isError).toBe(true);
      expect(textOf(res as never)).toMatch(/unknown tool/);
    }
  });

  test("assertVaultReady throws when the vault has no Outcome node", () => {
    fs.rmSync(path.join(dir, "Retention.md")); // remove the only Outcome node
    expect(() => assertVaultReady(buildPassContext(dir))).toThrow(/no Outcome node/);
  });
});
