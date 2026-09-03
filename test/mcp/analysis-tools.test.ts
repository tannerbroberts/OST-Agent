/**
 * The analysis commands as MCP tools. They were reachable only through a
 * Bash grant on the published binary; with the binary gone they have to be on
 * the tool surface, and being read-only they must never enqueue a commit.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { createLazyOstMcpServer, MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { renderCheck, renderDebt, renderGate, renderStatus } from "../../src/eval/render.js";
import { resolveDeclaredRuleset } from "../../src/ost/declared-ruleset.js";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-analysis-"));
  await initVault(dir, "Reach ten returning operators.", "Reach ten returning operators");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function connect(vaultDir: string): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createLazyOstMcpServer(vaultDir);
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
}

// `initVault` runs `git init` but commits nothing, so a fresh vault has zero
// commits and `git rev-parse HEAD` throws. Counting tolerates that; reading
// .git/HEAD would not work at all — it holds `ref: refs/heads/<branch>` and
// never changes when a commit lands.
function commitCount(d: string): number {
  try {
    return Number(
      execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: d, encoding: "utf8" }).trim(),
    );
  } catch {
    return 0;
  }
}

test("all four are on the surface", () => {
  for (const n of ["ost_check", "ost_debt", "ost_status", "ost_gate"]) {
    expect(MCP_TOOL_NAMES).toContain(n);
  }
});

test("ost_check returns exactly what the renderer returns", async () => {
  const client = await connect(dir);
  const res = await call(client, "ost_check");
  expect(res.isError).toBeFalsy();
  // The declared ruleset is part of what the tool renders, so it is part of what
  // the renderer is asked for here. The property is unchanged: the tool adds no
  // wording of its own to the analysis it hands back.
  expect(res.content[0].text).toBe(
    renderCheck(buildPassContext(dir).vault.readTreeCensus(), resolveDeclaredRuleset(dir)).text,
  );
});

test("ost_debt returns exactly what the renderer returns", async () => {
  const client = await connect(dir);
  const res = await call(client, "ost_debt");
  expect(res.content[0].text).toBe(renderDebt(buildPassContext(dir).vault.readTree()));
});

test("ost_status returns exactly what the renderer returns", async () => {
  const client = await connect(dir);
  const res = await call(client, "ost_status");
  expect(res.content[0].text).toBe(renderStatus(buildPassContext(dir), buildPassContext(dir).vault.readTreeCensus()));
});

test("ost_gate carries the verdict in its text", async () => {
  const client = await connect(dir);
  const res = await call(client, "ost_gate", { solution: "A solution that does not exist" });
  expect(res.content[0].text).toBe(
    renderGate(buildPassContext(dir).vault.readTree(), "A solution that does not exist").text,
  );
  expect(res.content[0].text).toMatch(/^gate: BLOCKED — /);
});

test("read-only: no commit is appended and git history does not grow", async () => {
  const client = await connect(dir);
  const before = commitCount(dir);
  for (const n of ["ost_check", "ost_debt", "ost_status"]) {
    const res = await call(client, n);
    // The commit suffix the mutating path appends. Its absence is the assertion.
    expect(res.content[0].text).not.toMatch(/committed [0-9a-f]{8}/);
    expect(res.content[0].text).not.toMatch(/no changes to commit/);
  }
  expect(commitCount(dir)).toBe(before);
});

test("ost_gate rejects a call with no solution", async () => {
  const client = await connect(dir);
  const res = await call(client, "ost_gate", {});
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toMatch(/invalid input for "ost_gate"/);
});
