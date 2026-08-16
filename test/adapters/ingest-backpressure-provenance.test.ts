/**
 * The instrument for "Load the ingest channel at ten times observed peak and
 * check provenance survives" — the assumption test beneath "Backpressure-
 * tolerant ingest channel that preserves provenance under load".
 *
 * **Observed peak, measured against this repository's own dogfooding vault on
 * 2026-08-16:** `.ost-agent/state/*.json` records how many items each channel
 * has ever delivered; `transcript` — the busiest channel this vault runs — has
 * delivered 238. Ten times that is the burst size below: well-formed notes,
 * dropped into channel zero in one shot, all before a single `ost_ingest_inbox`
 * call reads them.
 *
 * **What green means here, and what it does not.** The solution's acceptance
 * criterion is "keeping it all straight", not throughput: every id and
 * timestamp the channel captured must be exactly what arrived, nothing may be
 * dropped, and nothing may be captured twice. It is allowed to take a while —
 * degrading by slowing is the whole design — so this file bounds the wait
 * rather than forbidding it, generously, to catch a stall rather than police a
 * benchmark. It does not cover many sources arriving at once (this is one
 * channel), and every record here is well-formed by construction — it never
 * presents the malformed item on which provenance is most likely to be lost.
 *
 * **The failure this caught.** The channel's own read-and-store loop already
 * handled a burst this size correctly and in well under a second. What did not
 * was the provenance step that makes a captured record durable: every mutating
 * MCP call commits, `gitCommit` refuses to commit a staged conflict marker, and
 * that refusal used to spawn one `git show :path` subprocess PER staged file to
 * check. At 2,380 files that scan alone ran ~20s, on top of a `pre-commit` hook
 * that repeated the exact same per-file scan again — ~30s total per burst, well
 * past this suite's own `testTimeout` and, on a live MCP surface, indistinguishable
 * from a hang to whatever is waiting for the call to return. Fixed in
 * `src/git/conflict-guard.ts`: both scans now read the whole staged index in a
 * constant number of git invocations (`git ls-files -s` + `git cat-file --batch`
 * in-process; `git grep --cached` in the hook) instead of one per file.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { createLazyOstMcpServer } from "../../src/mcp/server.js";
import { readEvidence } from "../../src/processes/tree.js";
import { CHANNEL_ZERO, resolveChannels } from "../../src/adapters/channels.js";
import { loadConfig } from "../../src/config/load.js";
import { loadCursorRecord } from "../../src/adapters/source.js";

const OBSERVED_PEAK = 238;
const BURST = OBSERVED_PEAK * 10;

/**
 * Generous on purpose: this test's own setup (writing 2,380 files, initializing
 * a vault, spawning an in-process MCP server) shares the machine with whatever
 * else vitest is running in parallel, and a single timed run — unlike
 * `test/mcp/wall-clock-budget.test.ts`'s `fastestOf`, impractical here because
 * repeating the burst means repeating the whole fixture — has to tolerate that
 * contention. Measured 3.7s isolated, 13.6s under full-suite parallel load; the
 * old O(files) subprocess scan this regresses against measured ~30s in
 * isolation alone. 25s is loose enough not to be flaky under contention and
 * tight enough that the old behavior — worse, not better, under the same
 * contention — still fails it.
 */
const BUDGET_MS = 25_000;

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-ingest-burst-"));
  await initVault(dir, "Reach ten returning operators.", "Reach ten returning operators");
});
afterEach(() => {
  // The drop folder lives OUTSIDE the vault (W1), so removing the vault alone leaks it.
  fs.rmSync(dropDir(dir), { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

function dropDir(vaultDir: string): string {
  const zero = resolveChannels(vaultDir, loadConfig(vaultDir)).channels.find((c) => c.name === CHANNEL_ZERO);
  if (!zero) throw new Error("no channel zero resolved — adapters.inbox is the key every vault carries");
  return zero.dir;
}

async function connect(vaultDir: string): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createLazyOstMcpServer(vaultDir);
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

async function ingest(client: Client): Promise<{ isError?: boolean; text: string }> {
  const res = (await client.callTool({ name: "ost_ingest_inbox", arguments: {} })) as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
  return { isError: res.isError, text: res.content[0].text };
}

test(
  "ten times observed peak flows through in one burst with every id and timestamp intact",
  async () => {
    const inbox = dropDir(dir);
    fs.mkdirSync(inbox, { recursive: true });

    // Every record well-formed, and its expected timestamp captured at write
    // time — the ground truth "intact" is checked against, not re-derived.
    const expectedTimestamp = new Map<string, string>();
    for (let i = 0; i < BURST; i++) {
      const name = `report-${String(i).padStart(5, "0")}.md`;
      const file = path.join(inbox, name);
      fs.writeFileSync(file, `Operator report number ${i}, filed under load.\n`);
      expectedTimestamp.set(`INBOX:${name}`, fs.statSync(file).mtime.toISOString());
    }

    const client = await connect(dir);
    const t0 = Date.now();
    const first = await ingest(client);
    const elapsedMs = Date.now() - t0;

    expect(first.isError).toBeFalsy();
    expect(first.text).toContain(`captured ${BURST} `);

    // Nothing dropped, nothing double-captured.
    const records = readEvidence(dir);
    expect(records).toHaveLength(BURST);
    const byId = new Map(records.map((r) => [r.id, r]));
    expect(byId.size).toBe(BURST);

    // Every source id and timestamp survived the channel exactly as it arrived.
    for (const [id, ts] of expectedTimestamp) {
      const record = byId.get(id);
      expect(record, `${id} was captured`).toBeDefined();
      expect(record!.source).toBe(id);
      expect(record!.timestamp).toBe(ts);
    }

    // A burst is allowed to be slow to absorb, never allowed to stall — an
    // unattended pass has no way to tell "still absorbing the burst" from "hung".
    expect(elapsedMs, `ingest of ${BURST} items took ${elapsedMs}ms`).toBeLessThan(BUDGET_MS);

    // Re-offering the same burst captures nothing twice.
    const second = await ingest(client);
    expect(second.isError).toBeFalsy();
    expect(second.text).toMatch(/\[inbox\] 0 new/);
    expect(readEvidence(dir)).toHaveLength(BURST);

    // The channel dates its own delivery at the size it actually delivered, so
    // a burst this large is never mistaken for a channel that never speaks (S2).
    const record = loadCursorRecord(dir, CHANNEL_ZERO);
    expect(record?.itemsDelivered).toBe(BURST);
    expect(record?.lastItemAt).toBeTruthy();
  },
  45_000,
);
