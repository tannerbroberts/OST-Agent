/**
 * First run: a session that lands in a folder with no vault must be told what to
 * do, not handed a dead server.
 *
 * The observed seam (fresh-user simulation, 2026-07-25): after `/plugin install`
 * the session has the tools and the skill but no vault, and nothing in either
 * layer handles that. `ost-agent mcp` refused to start, so the operator saw an
 * MCP server that failed to connect — the least actionable possible signal.
 *
 * The contract these tests lock down: the server always starts, the tool surface
 * is identical whether or not a vault exists, `ost_next_work` (where every pass
 * begins) reports the bootstrap state as *state* rather than as an error, and
 * every mutating tool refuses with the one command that fixes it. The agent is
 * told to ask the human for the outcome — never to invent one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { createOstMcpServer, MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { vaultReadiness } from "../../src/mcp/bootstrap.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-bootstrap-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function connect(vaultDir: string): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createOstMcpServer(buildPassContext(vaultDir, { allowMissingConfig: true }));
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

function textOf(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content.map((c) => c.text ?? "").join("\n");
}

describe("vaultReadiness", () => {
  test("an empty folder is not ready, and says which command creates the vault", () => {
    const r = vaultReadiness(buildPassContext(dir, { allowMissingConfig: true }));
    expect(r.ready).toBe(false);
    if (r.ready) throw new Error("unreachable");
    expect(r.reason).toBe("no-vault");
    expect(r.nextStep).toMatch(/ost-agent(@latest)? init/);
    // the outcome is the one thing the agent may never supply for the human
    expect(r.message).toMatch(/ask the human/i);
  });

  test("a git repo with no Outcome node is not ready, and is a different reason", async () => {
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    fs.rmSync(path.join(dir, "Retention.md"));
    const r = vaultReadiness(buildPassContext(dir));
    expect(r.ready).toBe(false);
    if (r.ready) throw new Error("unreachable");
    expect(r.reason).toBe("no-outcome");
    expect(r.nextStep).toMatch(/ost-agent(@latest)? set-outcome/);
  });

  test("an initialized vault is ready", async () => {
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    expect(vaultReadiness(buildPassContext(dir)).ready).toBe(true);
  });

  /**
   * Reporting the state is not the same as being findable. Whoever reads a
   * bootstrap message — a session, or a human staring at a failed-looking tool —
   * should be told the one thing they can type, and it should be the same door
   * the slash-command menu offers.
   */
  test("both not-ready messages name the /ost-setup front door", async () => {
    const empty = vaultReadiness(buildPassContext(dir, { allowMissingConfig: true }));
    if (empty.ready) throw new Error("unreachable");
    expect(empty.message).toMatch(/\/ost-setup/);

    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    fs.rmSync(path.join(dir, "Retention.md"));
    const rootless = vaultReadiness(buildPassContext(dir));
    if (rootless.ready) throw new Error("unreachable");
    expect(rootless.message).toMatch(/\/ost-setup/);
  });
});

describe("the MCP server with no vault", () => {
  test("still starts and exposes the identical tool surface", async () => {
    const client = await connect(dir);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
  });

  test("ost_next_work reports bootstrap as state, not as an error", async () => {
    const client = await connect(dir);
    const res = (await client.callTool({ name: "ost_next_work", arguments: {} })) as never;
    // an error here would read as "the tool is broken"; this is a normal first run
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    const work = JSON.parse(textOf(res));
    expect(work.bootstrap).toBe(true);
    expect(work.done).toBe(false);
    expect(work.reason).toBe("no-vault");
    expect(work.nextStep).toMatch(/ost-agent(@latest)? init/);
    expect(work.vault).toBe(path.resolve(dir));
  });

  test("a mutating tool refuses with the command that fixes it, and writes nothing", async () => {
    const client = await connect(dir);
    const res = (await client.callTool({
      name: "ost_create_node",
      arguments: { title: "T", layer: "Opportunity", parent: "Nothing", body: "b", source: "INBOX:x", evidence: "stated" },
    })) as never;
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(textOf(res)).toMatch(/ost-agent(@latest)? init/);
    // nothing was created, and no git repo was conjured to hold it
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test("ost_read_tree refuses too — an empty tree would be a lie about a missing vault", async () => {
    const client = await connect(dir);
    const res = (await client.callTool({ name: "ost_read_tree", arguments: {} })) as never;
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(textOf(res)).toMatch(/ost-agent(@latest)? init/);
  });

  test("an initialized vault is unaffected: no bootstrap field, work reported normally", async () => {
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    const client = await connect(dir);
    const work = JSON.parse(textOf((await client.callTool({ name: "ost_next_work", arguments: {} })) as never));
    expect(work.bootstrap).toBeUndefined();
    expect(work.done).toBe(true);
  });
});
