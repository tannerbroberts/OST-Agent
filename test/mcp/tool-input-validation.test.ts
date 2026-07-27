/**
 * The MCP surface must refuse a call its own schema rejects.
 *
 * The CLI path (`runTool`) has validated since the `ost_annotate({note})`
 * incident, which appended the literal string "undefined" over an annotation,
 * permanently, and reported success. The MCP path — the only surface that
 * survives plugin-only distribution — never got the same guard.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { createLazyOstMcpServer } from "../../src/mcp/server.js";

let dir: string;
// initVault is async and positional: (dir, outcome, outcomeTitle?). The third
// argument is not optional in practice here — it defaults to the directory
// basename, which for a mkdtemp path is unpredictable, and these tests read the
// outcome node by filename.
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-mcp-validate-"));
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

test("a misnamed property is refused, and nothing is written", async () => {
  const client = await connect(dir);
  const before = fs.readdirSync(dir);

  const res = (await client.callTool({
    name: "ost_annotate",
    // `note` is not in the schema; the declared property is `issue`.
    arguments: { title: "Reach ten returning operators", note: "a real observation" },
  })) as { isError?: boolean; content: Array<{ text: string }> };

  expect(res.isError).toBe(true);
  expect(res.content[0].text).toMatch(/invalid input for "ost_annotate"/);
  expect(res.content[0].text).toMatch(/issue/);
  // The refusal must say the vault was untouched, because a caller that
  // retries blind is how the original damage compounded.
  expect(res.content[0].text).toMatch(/Nothing was written/);

  const outcome = fs.readFileSync(path.join(dir, "Reach ten returning operators.md"), "utf8");
  expect(outcome).not.toMatch(/undefined/);
  expect(fs.readdirSync(dir).sort()).toEqual(before.sort());
});

test("a valid call still succeeds", async () => {
  const client = await connect(dir);
  const res = (await client.callTool({
    name: "ost_annotate",
    arguments: { title: "Reach ten returning operators", issue: "a real observation" },
  })) as { isError?: boolean; content: Array<{ text: string }> };

  expect(res.isError).toBeFalsy();
  const outcome = fs.readFileSync(path.join(dir, "Reach ten returning operators.md"), "utf8");
  expect(outcome).toMatch(/a real observation/);
});
