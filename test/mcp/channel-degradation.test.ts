/**
 * One channel that cannot run costs that channel and nothing else. (G1, applied to
 * sources; the obstacle S1 had to solve rather than route around.)
 *
 * `skipSources: true` was not laziness. An adapter whose env vars are absent in the
 * MCP host process — and the plugin launches this server without the operator's
 * shell env — used to throw inside `buildPassContext`, which every tool is built
 * through, so a missing `SLACK_BOT_TOKEN` returned `isError` from `ost_check` and
 * `ost_read_tree` alike. Suppressing sources fixed that at the cost of the tree ever
 * feeding itself.
 *
 * The fix reuses the shape this repo already found for broken configs: degrade per
 * source. A source that cannot be constructed becomes a NAMED, REPORTED
 * unavailability; the tools that do not depend on it keep working; and the one tool
 * that does says plainly which channel is unavailable and why.
 *
 * The reporting half is not decoration. A channel the operator enabled and that
 * cannot run must be named, never silently skipped — otherwise "0 new items" means
 * both "nothing to report" and "never looked", which is exactly the ambiguity S2
 * exists to destroy.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { createLazyOstMcpServer } from "../../src/mcp/server.js";
import { configPath } from "../../src/config/load.js";

const CREDENTIALS = ["SLACK_BOT_TOKEN", "ATLASSIAN_BASE_URL", "ATLASSIAN_EMAIL", "ATLASSIAN_API_TOKEN"];

let dir: string;
let saved: Record<string, string | undefined>;
/** The config `init` wrote, before any test edited it. */
let pristineConfig: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-degrade-"));
  await initVault(dir, "Reach ten returning operators.", "Reach ten returning operators");
  pristineConfig = fs.readFileSync(configPath(dir), "utf8");
  saved = Object.fromEntries(CREDENTIALS.map((k) => [k, process.env[k]]));
  // The host process this server runs in has none of the operator's credentials.
  // That is the situation, not a contrivance.
  for (const k of CREDENTIALS) delete process.env[k];
});
afterEach(() => {
  for (const k of CREDENTIALS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(`${dir}.inbox`, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Turn on the two credentialed adapters, leaving the drop folder's path alone. */
function enableCredentialedAdapters(): void {
  const raw = fs
    .readFileSync(configPath(dir), "utf8")
    .replace(/(\n {2}atlassian:\n {4}enabled: )false/, "$1true")
    .replace(/(\n {2}slack:\n {4}enabled: )false/, "$1true");
  fs.writeFileSync(configPath(dir), raw, "utf8");
  // A no-op replacement would leave both adapters off and every assertion below
  // would then be about a vault that never asked for them.
  expect(raw).toMatch(/slack:\n {4}enabled: true/);
  expect(raw).toMatch(/atlassian:\n {4}enabled: true/);
}

/**
 * Add a second drop folder under `adapters.inbox.channels`. Inserted after channel
 * zero's own `path:` line, which is the first one in the file — appending at the end
 * would land it under `processes:`, where the schema ignores it and this test would
 * be asserting things about a channel nobody declared.
 */
function declareChannel(name: string, declaredPath: string): void {
  // Always from the config `init` wrote, never from whatever a previous call left:
  // two `channels:` keys is a duplicate-key YAML error, and the tool would then be
  // refusing for a reason this test is not about.
  const before = pristineConfig;
  const raw = before.replace(
    /(\n {4}path: "[^"]*"[^\n]*)/,
    `$1\n    channels:\n      - name: ${name}\n        path: ${JSON.stringify(declaredPath)}`,
  );
  expect(raw, "the channel declaration did not land in the inbox block").not.toBe(before);
  fs.writeFileSync(configPath(dir), raw, "utf8");
}

async function connect(): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createLazyOstMcpServer(dir);
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

async function call(client: Client, name: string): Promise<{ isError?: boolean; text: string }> {
  const res = (await client.callTool({ name, arguments: {} })) as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
  return { isError: res.isError, text: res.content[0].text };
}

describe("an enabled channel with no credentials", () => {
  test("does not take down the tools that never needed it", async () => {
    enableCredentialedAdapters();
    const client = await connect();

    for (const name of ["ost_check", "ost_read_tree", "ost_next_work"]) {
      const res = await call(client, name);
      expect(res.isError, `${name} failed over a credential it does not use: ${res.text}`).toBeFalsy();
    }
    // Substance, not just absence of error: the answers are the real ones.
    expect((await call(client, "ost_check")).text).toMatch(/invariants:/);
    expect((await call(client, "ost_read_tree")).text).toMatch(/Reach ten returning operators/);
    expect(JSON.parse((await call(client, "ost_next_work")).text).done).toBe(true);
  }, 20_000);

  test("is named by the one tool that does depend on it, with the reason", async () => {
    enableCredentialedAdapters();
    const client = await connect();

    const res = await call(client, "ost_ingest_inbox");
    expect(res.isError).toBeFalsy();
    expect(res.text).toMatch(/\[slack\] UNAVAILABLE — .*SLACK_BOT_TOKEN/);
    expect(res.text).toMatch(/\[atlassian\] UNAVAILABLE — .*ATLASSIAN_BASE_URL/);
    // …and the channels that CAN run still ran, in the same call.
    expect(res.text).toMatch(/\[inbox\] 0 new/);
  }, 20_000);

  test('"turned off" and "could not be read" are never the same word', async () => {
    // The whole point of reporting rather than skipping. With slack off, the report
    // says so as a decision; with slack on and no token, it says so as a failure.
    // If these two collapsed, an operator could not tell which one they were looking at.
    const off = await call(await connect(), "ost_ingest_inbox");
    expect(off.text).toMatch(/\[slack\] disabled/);
    expect(off.text).not.toMatch(/\[slack\] UNAVAILABLE/);

    fs.rmSync(dir, { recursive: true, force: true });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-degrade-"));
    await initVault(dir, "Reach ten returning operators.", "Reach ten returning operators");
    enableCredentialedAdapters();
    const on = await call(await connect(), "ost_ingest_inbox");
    expect(on.text).toMatch(/\[slack\] UNAVAILABLE/);
    expect(on.text).not.toMatch(/\[slack\] disabled/);
  }, 20_000);

  test("a refused channel is reported, not dropped", async () => {
    // A `channels:` entry that resolves inside the vault is refused by the resolver
    // (W1). Refused is not disabled and is not absent: the operator asked for it, so
    // its silence has to be attributable to something.
    declareChannel("support", ".ost-agent/support-drop");
    const res = await call(await connect(), "ost_ingest_inbox");
    expect(res.isError).toBeFalsy();
    expect(res.text).toMatch(/UNAVAILABLE — .*"support".*inside the vault/);

    // Non-vacuity: the same channel declared OUTSIDE the vault is accepted and read,
    // so the refusal is about the path and not about declaring a channel at all.
    declareChannel("support", `${dir}.support`);
    const accepted = await call(await connect(), "ost_ingest_inbox");
    expect(accepted.text).toMatch(/\[support\] 0 new/);
    expect(accepted.text).not.toMatch(/UNAVAILABLE/);
    fs.rmSync(`${dir}.support`, { recursive: true, force: true });
  }, 20_000);
});
