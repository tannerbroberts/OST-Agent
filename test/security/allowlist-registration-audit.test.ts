/**
 * The allowlist registration audit: no tool outside `ALLOWED_TOOL_NAMES` is ever
 * registered, checked against the registration path rather than against a reading
 * of it.
 *
 * "Registration path" means the audit enumerates what the running code actually
 * hands out — the unnarrowed `buildOstTools` set (the widest surface any process
 * can hold, and the one the CLI `manifest`/`refusals` commands build), and the
 * tool list served over a live MCP transport by BOTH server factories
 * (`createOstMcpServer`, which `ost-agent` tests drive, and
 * `createLazyOstMcpServer`, which the plugin actually starts — the two forked
 * once before, see v1-readiness H5's history). A static comparison of two
 * constants would stay green while a rogue `tool({...})` entry shipped; asking
 * the built set cannot.
 *
 * The invocation half: a non-allowlisted name called through the server must be
 * refused, not executed. Pre-committed threshold, from the assumption test this
 * instruments: zero non-allowlisted tools registered or called in any process.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { createOstMcpServer, createLazyOstMcpServer } from "../../src/mcp/server.js";
import { ALLOWED_TOOL_NAMES } from "../../src/security/policy.js";
import { buildOstTools } from "../../src/security/tools.js";
import { Vault } from "../../src/ost/vault.js";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-allowlist-audit-"));
  await initVault(dir, "Reach 10,000 daily active users", "Retention");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const ALLOWED = new Set<string>(ALLOWED_TOOL_NAMES);

async function connect(server: Server): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "audit", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

/** Assert every registered name is allowlisted and none is registered twice. */
function audit(names: string[], surface: string): void {
  const offList = names.filter((n) => !ALLOWED.has(n));
  expect(offList, `${surface} registered tool(s) outside ALLOWED_TOOL_NAMES: ${offList.join(", ")}`).toEqual([]);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  expect(dupes, `${surface} registered the same name twice: ${dupes.join(", ")}`).toEqual([]);
}

describe("allowlist registration audit", () => {
  test("the unnarrowed buildOstTools set — the widest surface any process holds — is entirely allowlisted", () => {
    // This is the exact call shape of the CLI `manifest`/`refusals` commands
    // (src/cli/index.ts), the only registration path with no allowedNames filter.
    const tools = buildOstTools({ vault: new Vault(dir, { create: false }), dir, remote: { enabled: false } });
    audit(tools.map((t) => t.name), "buildOstTools(ctx)");
  });

  test("the eager MCP server registers only allowlisted tools, asked over a live transport", async () => {
    const client = await connect(createOstMcpServer(buildPassContext(dir)));
    const { tools } = await client.listTools();
    audit(tools.map((t) => t.name), "createOstMcpServer");
  });

  test("the lazy MCP server — what the plugin actually starts — registers only allowlisted tools", async () => {
    const client = await connect(createLazyOstMcpServer(dir));
    const { tools } = await client.listTools();
    audit(tools.map((t) => t.name), "createLazyOstMcpServer");
  });

  test("invoking a non-allowlisted name through the server is refused, not executed", async () => {
    const client = await connect(createLazyOstMcpServer(dir));
    for (const name of ["Bash", "Write", "ost_delete_node"]) {
      const res = (await client.callTool({ name, arguments: {} })) as {
        isError?: boolean;
        content: Array<{ type: string; text?: string }>;
      };
      expect(res.isError, `calling "${name}" must error`).toBe(true);
      const text = res.content.map((c) => c.text ?? "").join("\n");
      expect(text).toContain(name);
    }
  });

  test("the audit is enforced at construction, not only observed here: buildOstTools runs the fail-closed guard on every surface", async () => {
    // The guard lives inside buildOstTools (assertNoDestructiveTool over the
    // full built set), so a rogue tool would throw at registration on EVERY
    // surface — including the CLI ones that narrow it away. This audit cannot
    // inject a rogue tool without editing source, so it pins the next best
    // thing: the guard the path runs rejects an off-list name, and the real
    // set passes it. If the guard is ever taken off the path, the enumeration
    // tests above are the audit of record; this one documents the mechanism.
    const { assertNoDestructiveTool } = await import("../../src/security/policy.js");
    expect(() => assertNoDestructiveTool(["ost_read_tree", "not_on_the_list"])).toThrow(/allowlist/);
    expect(() => assertNoDestructiveTool([...ALLOWED_TOOL_NAMES])).not.toThrow();
  });
});
