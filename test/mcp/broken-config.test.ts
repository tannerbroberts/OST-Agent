/**
 * A malformed file at the vault root degrades one capability, never the whole tool
 * surface (G1).
 *
 * This was originally found against `genome.yaml`, where a two-line malformed file
 * returned `isError` from every tool alike. Deleting the genome removed one such file,
 * not the failure class: `loadConfig` threw, `buildPassContext` called it before
 * anything else, and every tool is built through that call — including the ones that
 * never read the config at all.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { createLazyOstMcpServer } from "../../src/mcp/server.js";
import { loadConfig, readConfig } from "../../src/config/load.js";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-broken-config-"));
  await initVault(dir, "Grow weekly active players", "Players");
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

function breakConfig(vaultDir: string, contents: string): void {
  fs.writeFileSync(path.join(vaultDir, "ost.config.yaml"), contents, "utf8");
}

/** The criterion's own file, verbatim. */
const CRITERION_CONFIG = "web:\n  lookupBudget: notanumber\n";

test("ost_check and ost_read_tree both answer, with the problem named", async () => {
  breakConfig(dir, CRITERION_CONFIG);
  const client = await connect(dir);

  for (const name of ["ost_check", "ost_read_tree"]) {
    const res = await call(client, name);
    expect(res.isError, `${name} should still answer`).toBeFalsy();
    expect(res.content[0].text).toContain("ost.config.yaml");
  }
});

test("a YAML syntax error degrades the same way, rather than escaping as a throw", async () => {
  // The schema path was the only one previously handled at all: `parseYaml` throwing
  // was uncaught, so a file that is not YAML failed differently from a file that is
  // YAML but wrong. To whoever has to fix it these are one event — the file is there
  // and it cannot be used.
  breakConfig(dir, "outcome: [unclosed\n");
  const client = await connect(dir);

  const res = await call(client, "ost_read_tree");
  expect(res.isError).toBeFalsy();
  expect(res.content[0].text).toContain("ost.config.yaml");
});

test("the tools the file governs refuse, and the warning names them", async () => {
  breakConfig(dir, CRITERION_CONFIG);
  const client = await connect(dir);

  const governed: Array<[string, Record<string, unknown>]> = [
    ["ost_ingest_inbox", {}],
    ["ost_search_web", { query: "x" }],
    ["ost_read_web", { url: "https://example.com" }],
    ["ost_read_repo", { path: "README.md" }],
  ];
  for (const [name, args] of governed) {
    const res = await call(client, name, args);
    expect(res.isError, `${name} should refuse`).toBe(true);
    expect(res.content[0].text).toContain("ost.config.yaml");
  }

  // The warning on the tools that still work says which ones stopped, so an operator
  // who only ever calls ost_next_work still learns what they lost.
  const working = await call(client, "ost_next_work");
  expect(working.content[0].text).toContain("ost_search_web");
});

test("a broken file cannot widen a bound the operator set", async () => {
  // The reason the governed tools refuse instead of falling back. An operator who
  // wrote `web.lookupBudget: 2` and then broke the file elsewhere would, under a
  // blanket fallback, silently get the schema default instead — a broken file
  // loosening a limit, which is exactly what G2 forbids.
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: Grow weekly active players\nweb:\n  lookupBudget: 2\n", "utf8");
  expect(readConfig(dir).config.web.lookupBudget).toBe(2);
  expect(readConfig(dir).problem).toBeUndefined();

  breakConfig(dir, CRITERION_CONFIG);
  const degraded = readConfig(dir);
  expect(degraded.problem).toBeDefined();
  // The defaults ARE what the fallback config carries — which is the whole reason
  // nothing that spends against a bound is allowed to use it.
  expect(degraded.config.web.lookupBudget).not.toBe(2);

  const client = await connect(dir);
  const res = await call(client, "ost_search_web", { query: "x" });
  expect(res.isError).toBe(true);
});

test("the strict reader still throws, so the human at a shell gets the error", () => {
  // The split is deliberate: an interactive surface has someone to tell and a fix is
  // one edit away; the unattended surface has nobody, and going dark over a file that
  // reading the tree never needed is the failure being closed.
  breakConfig(dir, CRITERION_CONFIG);
  expect(() => loadConfig(dir)).toThrow(/ost\.config\.yaml/);
  expect(readConfig(dir).problem).toMatch(/ost\.config\.yaml/);
});
