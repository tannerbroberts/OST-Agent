import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { simpleGit } from "simple-git";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { createOstMcpServer } from "../../src/mcp/server.js";
import { writeEvidence } from "../../src/processes/tree.js";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-provenance-"));
  await initVault(dir, "Reach 10,000 daily active users", "Retention");
  // The source cited below now has to resolve — `ost_create_node` refuses a
  // citation that names no record at write time (see
  // test/adapters/source-attribution.test.ts) — so the fixture stores it first,
  // exactly the way a real INBOX drop would have.
  writeEvidence(
    dir,
    {
      id: "INBOX:2026-07-22-design-goals.md",
      source: "INBOX:2026-07-22-design-goals.md",
      title: "design goals",
      timestamp: "2026-07-22T00:00:00Z",
      body: "Players want a daily reason to return.",
    },
    "inbox",
  );
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

async function lastCommitMessage(vaultDir: string): Promise<string> {
  return (await simpleGit(vaultDir).raw(["log", "-1", "--format=%B"])).trim();
}

/**
 * "Test do operators actually replay the audit trail to regain trust" — the
 * half of the solution's claim that was not yet true: a commit named the node
 * but not the source it traces to, so an operator reading `git log` alone
 * could not attribute a change without opening the vault.
 */
describe("commit provenance", () => {
  test("creating a node commits a message naming both the node and its source", async () => {
    const client = await connect(dir);
    await client.callTool({
      name: "ost_create_node",
      arguments: {
        title: "Players want a daily reason to return",
        layer: "Opportunity",
        parent: "Retention",
        body: "Players want a daily reason to return.",
        evidence: "assertion",
        source: "INBOX:2026-07-22-design-goals.md",
      },
    });

    const message = await lastCommitMessage(dir);
    expect(message).toContain("Players want a daily reason to return");
    expect(message).toContain("INBOX:2026-07-22-design-goals.md");
  });

  test("appending to an existing node commits a message naming the node AND the source it was created from", async () => {
    const client = await connect(dir);
    await client.callTool({
      name: "ost_create_node",
      arguments: {
        title: "Players want a daily reason to return",
        layer: "Opportunity",
        parent: "Retention",
        body: "Players want a daily reason to return.",
        evidence: "assertion",
        source: "INBOX:2026-07-22-design-goals.md",
      },
    });

    await client.callTool({
      name: "ost_append_to_node",
      arguments: { title: "Players want a daily reason to return", section: "## Notes\nmore context" },
    });

    const message = await lastCommitMessage(dir);
    expect(message).toContain("Players want a daily reason to return");
    expect(message).toContain("INBOX:2026-07-22-design-goals.md");
  });

  test("a node created with no source commits cleanly — nothing is fabricated", async () => {
    const client = await connect(dir);
    const res = await client.callTool({
      name: "ost_create_node",
      arguments: {
        title: "An idea with no traceable source",
        layer: "Opportunity",
        parent: "Retention",
        body: "b",
        evidence: "stated",
      },
    });
    expect(res.isError).toBeFalsy();
    const message = await lastCommitMessage(dir);
    expect(message).toContain("An idea with no traceable source");
    expect(message).not.toContain("(source:");
  });
});
