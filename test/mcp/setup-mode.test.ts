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
    expect(text).toMatch(/ost-agent\.mjs init/); // gives the exact command
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
    expect(textOf(res as never)).toMatch(/ost-agent\.mjs init/);
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

  test("pointing the server at a nonexistent path creates nothing on disk", async () => {
    // OST_VAULT typo'd or aimed at a not-yet-cloned project: probing must not
    // conjure the directory chain — setup mode claims it writes NOTHING.
    const missing = path.join(dir, "porjects", "app");
    const client = await connectLazy(missing);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    const res = await client.callTool({ name: "ost_read_tree", arguments: {} });
    expect(res.isError).toBe(true);
    expect(textOf(res as never)).toMatch(/ost-agent\.mjs init/);
    expect(fs.existsSync(missing)).toBe(false);
    expect(fs.existsSync(path.join(dir, "porjects"))).toBe(false);
  });

  test("a present-but-invalid config degrades to guidance, not a protocol error, and recovers once fixed", async () => {
    await initVault(dir, "Grow weekly active players", "Players");
    const cfg = path.join(dir, "ost.config.yaml");
    const good = fs.readFileSync(cfg, "utf8");
    fs.writeFileSync(cfg, "outcome: 42\n"); // schema-invalid: outcome must be a string

    const client = await connectLazy(dir);
    // tools/list must not become a JSON-RPC internal error
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    // a call answers with the cause and the fix, in-band
    const res = await client.callTool({ name: "ost_next_work", arguments: {} });
    expect(res.isError).toBe(true);
    const text = textOf(res as never);
    expect(text).toContain("ost.config.yaml");
    expect(text).toMatch(/no reconnect/i);

    // fixing the file recovers the same session — no reconnect
    fs.writeFileSync(cfg, good);
    const after = await client.callTool({ name: "ost_read_tree", arguments: {} });
    expect(after.isError).toBeFalsy();
    expect(textOf(after as never)).toContain("Players");
  });

  test("an enabled adapter whose env vars are absent does not block the MCP tools", async () => {
    await initVault(dir, "Grow weekly active players", "Players");
    fs.writeFileSync(
      path.join(dir, "ost.config.yaml"),
      'outcome: "Grow weekly active players"\noutcomeTitle: "Players"\nadapters:\n  slack:\n    enabled: true\n',
    );
    const saved = process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_BOT_TOKEN;
    try {
      const client = await connectLazy(dir);
      // the MCP surface never consumes adapter sources, so the missing token
      // must not take read-only tools (or any tool) down
      const res = await client.callTool({ name: "ost_read_tree", arguments: {} });
      expect(res.isError).toBeFalsy();
      expect(textOf(res as never)).toContain("Players");
    } finally {
      if (saved !== undefined) process.env.SLACK_BOT_TOKEN = saved;
    }
  });

  test("a vault missing its Outcome node is told set-outcome — the same command on every tool", async () => {
    await initVault(dir, "Grow weekly active players", "Players");
    fs.rmSync(path.join(dir, "Players.md")); // remove the only Outcome node

    const client = await connectLazy(dir);
    const work = JSON.parse(textOf((await client.callTool({ name: "ost_next_work", arguments: {} })) as never));
    expect(work.bootstrap).toBe(true);
    expect(work.reason).toBe("no-outcome");
    expect(work.nextStep).toMatch(/ost-agent\.mjs set-outcome/);

    const res = await client.callTool({ name: "ost_read_tree", arguments: {} });
    expect(res.isError).toBe(true);
    const text = textOf(res as never);
    // exactly the command ost_next_work named — never `init`, which on an
    // existing vault silently keeps the old config and discards the outcome
    expect(text).toContain(work.nextStep);
    expect(text).not.toMatch(/ost-agent\.mjs init/);
  });
});
