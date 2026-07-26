/**
 * Setup mode: the MCP server against an UNINITIALIZED directory.
 *
 * The plugin auto-starts `ost-agent mcp` with OST_VAULT=${CLAUDE_PROJECT_DIR}.
 * A fresh consumer's project has no vault yet — the server must come up anyway,
 * teach the connecting session how to bootstrap (outcome stays human-set), and
 * start serving the real tools the moment `init` has run, without a reconnect.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { createLazyOstMcpServer, MCP_TOOL_NAMES } from "../../src/mcp/server.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-mcp-setup-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function connectLazy(vaultDir: string): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createLazyOstMcpServer(vaultDir);
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

function textOf(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content.map((c) => c.text ?? "").join("\n");
}

describe("MCP setup mode (uninitialized vault)", () => {
  test("server connects against an uninitialized directory and still advertises the full OST surface", async () => {
    const client = await connectLazy(dir);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
  });

  test("a tool call before init returns human-driven setup guidance, not a stack trace", async () => {
    const client = await connectLazy(dir);
    const res = await client.callTool({ name: "ost_read_tree", arguments: {} });
    expect(res.isError).toBe(true);
    const text = textOf(res as never);
    expect(text).toContain(dir); // names the exact directory
    expect(text).toMatch(/ost-agent(@latest)? init/); // gives the exact command
    expect(text).toMatch(/outcome/i); // explains what init needs
    expect(text).toMatch(/never (invent|assume)/i); // outcome is human-set — the agent must ask
    expect(text).toMatch(/no api key/i); // setup needs no credential
  });

  test("a mutating call before init is refused with the same guidance and writes nothing", async () => {
    const client = await connectLazy(dir);
    const res = await client.callTool({
      name: "ost_create_node",
      arguments: { title: "X", layer: "Opportunity", parent: "Y", body: "b", evidence: "assertion" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res as never)).toMatch(/ost-agent(@latest)? init/);
    // nothing scaffolded as a side effect: no vault config, no git repo, no node file
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test("tools go live the moment the vault is initialized — same session, no reconnect", async () => {
    const client = await connectLazy(dir);
    const before = await client.callTool({ name: "ost_read_tree", arguments: {} });
    expect(before.isError).toBe(true);

    await initVault(dir, "Grow weekly active players", "Players");

    const after = await client.callTool({ name: "ost_read_tree", arguments: {} });
    expect(after.isError).toBeFalsy();
    expect(textOf(after as never)).toContain("Players");

    // and the work loop is immediately usable
    const work = JSON.parse(textOf((await client.callTool({ name: "ost_next_work", arguments: {} })) as never));
    expect(work.done).toBe(true);
  });

  test("a ready vault behaves identically through the lazy server (no setup detour)", async () => {
    await initVault(dir, "Grow weekly active players", "Players");
    const client = await connectLazy(dir);
    const res = await client.callTool({ name: "ost_read_tree", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(textOf(res as never)).toContain("Players");
  });
});
