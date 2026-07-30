/**
 * The inbox never accepts a report and then loses it (W9, W10).
 *
 * Under DEC-1 the drop folder is the untrusted builder's ONLY channel, so every way a
 * delivered note can vanish is a way the builder is silenced with no signal. Two were
 * reachable: two filenames that collapse to one storage name were stored once and
 * reported as two, and a storage failure mid-batch still saved a cursor covering the
 * whole batch, marking never-written notes as delivered.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { createLazyOstMcpServer } from "../../src/mcp/server.js";
import { readEvidence, writeEvidence } from "../../src/processes/tree.js";

/**
 * The one stub the W10 check calls for: `writeEvidence` throwing on a named item.
 * Everything else in the module stays real — the assertions read the records back
 * through it. Held in `vi.hoisted` because `vi.mock`'s factory is lifted above the
 * imports and cannot close over an ordinary top-level binding.
 */
const stub = vi.hoisted(() => ({ throwOnId: null as string | null }));
vi.mock("../../src/processes/tree.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/processes/tree.js")>();
  return {
    ...actual,
    writeEvidence: (dir: string, rec: { id: string }, actor: string) => {
      if (stub.throwOnId !== null && rec.id === stub.throwOnId) throw new Error("storage refused this record");
      return (actual.writeEvidence as unknown as (...a: unknown[]) => boolean)(dir, rec, actor);
    },
  };
});

let dir: string;
beforeEach(async () => {
  stub.throwOnId = null;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-inbox-durability-"));
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

function drop(vaultDir: string, name: string, body: string): void {
  const inbox = path.join(vaultDir, ".ost-agent", "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  fs.writeFileSync(path.join(inbox, name), body, "utf8");
}

async function ingest(client: Client): Promise<string> {
  const res = (await client.callTool({ name: "ost_ingest_inbox", arguments: {} })) as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
  expect(res.isError).toBeFalsy();
  return res.content[0].text;
}

function savedCursor(vaultDir: string): string[] {
  const p = path.join(vaultDir, ".ost-agent", "state", "inbox.json");
  if (!fs.existsSync(p)) return [];
  const { cursor } = JSON.parse(fs.readFileSync(p, "utf8")) as { cursor: string | null };
  return cursor ? (JSON.parse(cursor) as string[]) : [];
}

// ─── W9 — two reports that collapse to one filename are still two records ─────────

test("notes whose storage names collide are both captured", async () => {
  drop(dir, "note.md", "Setup took over an hour.");
  drop(dir, "note.txt", "Billing page 404s on renewal.");
  const client = await connect(dir);

  const text = await ingest(client);

  const evidence = readEvidence(dir).sort((a, b) => a.id.localeCompare(b.id));
  expect(evidence).toHaveLength(2);
  expect(evidence.map((e) => e.id)).toEqual(["INBOX:note.md", "INBOX:note.txt"]);
  // Both bodies survive intact — a collision that stored one body under both ids
  // would pass a count-only assertion.
  expect(evidence[0].body).toMatch(/over an hour/);
  expect(evidence[1].body).toMatch(/404s on renewal/);
  expect(text).toMatch(/captured 2/);
});

test("a colliding note is still idempotent on re-delivery", async () => {
  drop(dir, "note.md", "one");
  drop(dir, "note.txt", "two");
  const client = await connect(dir);
  await ingest(client);

  // Delete the cursor so the second guard — the one that reads the evidence
  // directory — is the only thing standing between a re-read and a duplicate (W8).
  fs.rmSync(path.join(dir, ".ost-agent", "state", "inbox.json"));
  const again = await ingest(client);

  expect(readEvidence(dir)).toHaveLength(2);
  expect(again).toMatch(/0 new notes/);
});

test("an id that does not collide keeps the plain filename", () => {
  // The disambiguating digest must be reached only on a real collision: an existing
  // vault's records were written under the plain name, and W8's directory guard
  // recognises a re-delivery by finding that exact file.
  expect(writeEvidence(dir, { id: "INBOX:solo.md", source: "INBOX:solo.md", title: "solo", timestamp: "", body: "x" }, "inbox")).toBe(true);
  const files = fs.readdirSync(path.join(dir, ".ost-agent", "evidence"));
  expect(files).toEqual(["INBOX_solo.md"]);
  expect(writeEvidence(dir, { id: "INBOX:solo.md", source: "INBOX:solo.md", title: "solo", timestamp: "", body: "x" }, "inbox")).toBe(false);
  expect(fs.readdirSync(path.join(dir, ".ost-agent", "evidence"))).toEqual(["INBOX_solo.md"]);
});

// ─── W10 — an unstored item leaves the cursor un-advanced ─────────────────────────

test("a storage failure stops the batch and leaves the rest re-offerable", async () => {
  drop(dir, "a.md", "first report");
  drop(dir, "b.md", "second report");
  drop(dir, "c.md", "third report");
  const client = await connect(dir);
  stub.throwOnId = "INBOX:b.md";

  const text = await ingest(client);

  expect(text).toMatch(/STOPPED/);
  expect(text).toMatch(/storage refused this record/);
  expect(readEvidence(dir).map((e) => e.id)).toEqual(["INBOX:a.md"]);
  // The saved cursor describes what reached disk, not what was fetched.
  expect(savedCursor(dir)).toEqual(["INBOX:a.md"]);

  stub.throwOnId = null;
  const retry = await ingest(client);

  expect(retry).toMatch(/captured 2/);
  expect(readEvidence(dir).map((e) => e.id).sort()).toEqual(["INBOX:a.md", "INBOX:b.md", "INBOX:c.md"]);
});

test("a failure on the first item advances the cursor not at all", async () => {
  drop(dir, "a.md", "first report");
  drop(dir, "b.md", "second report");
  const client = await connect(dir);
  stub.throwOnId = "INBOX:a.md";

  await ingest(client);

  expect(readEvidence(dir)).toHaveLength(0);
  expect(savedCursor(dir)).toEqual([]);
});
