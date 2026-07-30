/**
 * An unattended firing on a `done` tree produces its own next evidence. (S1.)
 *
 * The state this ends: every path to new evidence required an out-of-band actor
 * with write access to the drop folder. `ost_ingest_inbox` built its own
 * `new InboxSource(...)`, read that one folder, and never touched the sources
 * `buildPassContext` assembles — which the MCP server suppressed outright with
 * `skipSources: true`. So the steady state after one sweep was `done: true` for
 * ever, and it looked healthy while doing it.
 *
 * Two adapters can produce evidence with no human in the loop, because they read
 * what the agent itself already did: `TranscriptSource` (its finished sessions) and
 * `UsageSource` (its own tool-invocation trace). This file proves they actually run
 * — and that a genuinely dry firing still yields nothing, quietly, without throwing.
 *
 * The fixtures stand in for the agent's own output. In a real vault the session
 * files and the trace are written by the firing itself; writing them here is how a
 * deterministic offline test says "a session finished since last time" at a chosen
 * moment instead of waiting for one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { createLazyOstMcpServer } from "../../src/mcp/server.js";
import { readEvidence } from "../../src/processes/tree.js";
import { loadConfig, configPath } from "../../src/config/load.js";
import { usageLogPath } from "../../src/telemetry/usage.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ─── The check S1 words as a grep ─────────────────────────────────────────────────

describe("S1 — the tool surface iterates the sources rather than building its own", () => {
  /**
   * S1's first check, as a committed assertion: `grep -rn
   * 'passContext.sources\|ctx\.sources' src/security/tools.ts src/mcp/` must come out
   * NON-empty. Empty is the whole bug — a tool that constructs its own single source
   * reads one channel for ever, and the four adapters that need no human stay shipped
   * with no ingestion caller.
   */
  test("ost_ingest_inbox reads ctx.passContext.sources", () => {
    const files = [
      path.join(repoRoot, "src/security/tools.ts"),
      ...fs
        .readdirSync(path.join(repoRoot, "src/mcp"), { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".ts"))
        .map((e) => path.join(repoRoot, "src/mcp", e.name)),
    ];
    const hits = files.filter((f) => /passContext\.sources|ctx\.sources/.test(fs.readFileSync(f, "utf8")));
    expect(hits.map((f) => path.relative(repoRoot, f))).not.toEqual([]);

    // Non-vacuity: the same scan over the same files finds no reference to a name
    // nothing uses, so a matching regex is evidence about this code and not about
    // the scan being unable to fail.
    const control = files.filter((f) => /passContext\.channelsThatDoNotExist/.test(fs.readFileSync(f, "utf8")));
    expect(control).toEqual([]);
  });

  test("the ingest tool constructs no source of its own", () => {
    // The construction that used to live here is what made the tool single-channel.
    // If it comes back, the sources list becomes decoration.
    const tools = fs.readFileSync(path.join(repoRoot, "src/security/tools.ts"), "utf8");
    const constructions = [...tools.matchAll(/\bnew\s+(\w*Source)\s*\(/g)].map((m) => m[1]);
    expect(constructions).toEqual([]);
    // Non-vacuity: the same regex over the file that IS allowed to construct sources
    // finds them, so an empty result here is a fact about tools.ts.
    const context = fs.readFileSync(path.join(repoRoot, "src/runner/context.ts"), "utf8");
    expect([...context.matchAll(/\bnew\s+(\w*Source)\s*\(/g)].map((m) => m[1]).length).toBeGreaterThan(3);
  });
});

// ─── The consequence: a firing on a clean tree produces the next thing to work on ──

let dir: string;
let sessions: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-s1-"));
  sessions = fs.mkdtempSync(path.join(os.tmpdir(), "ost-s1-sessions-"));
  await initVault(dir, "Reach ten returning operators.", "Reach ten returning operators");
});
afterEach(() => {
  fs.rmSync(sessions, { recursive: true, force: true });
  fs.rmSync(`${dir}.inbox`, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Turn on the two channels that need no human, editing the config `init` wrote
 * rather than replacing it — the drop folder's escaping path (W1) has to survive.
 *
 * The replacements are asserted to have landed. A silent no-op here would leave the
 * transcript channel off and every assertion below would then be measuring an empty
 * vault while its "nothing new" branches passed.
 */
function enableSelfGeneratedChannels(): void {
  const raw = fs
    .readFileSync(configPath(dir), "utf8")
    .replace(/(\n {2}transcript:\n {4}enabled: )false/, "$1true")
    .replace(/(\n {4}path: )""/, `$1${JSON.stringify(sessions)}`)
    .replace(/(\n {4}quietMinutes: )30/, "$11");
  fs.writeFileSync(configPath(dir), raw, "utf8");
  const cfg = loadConfig(dir);
  expect(cfg.adapters.transcript.enabled, "the transcript edit did not land").toBe(true);
  expect(cfg.adapters.transcript.path, "the transcript path edit did not land").toBe(sessions);
  expect(cfg.adapters.usage.enabled).toBe(true);
}

/** One finished session that hit friction — a tool call that failed. */
function writeSession(id: string): void {
  const lines = [
    JSON.stringify({
      timestamp: "2026-07-29T10:00:00.000Z",
      message: { content: [{ type: "tool_use", id: `${id}-1`, name: "Bash", input: { command: "ost-agent frobnicate" } }] },
    }),
    JSON.stringify({
      timestamp: "2026-07-29T10:00:01.000Z",
      message: {
        content: [{ type: "tool_result", tool_use_id: `${id}-1`, is_error: true, content: "zsh: command not found: frobnicate" }],
      },
    }),
  ];
  const file = path.join(sessions, `${id}.jsonl`);
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  // "Finished" means untouched for `quietMinutes`. Backdating the mtime is how an
  // offline test says that without sleeping.
  const old = new Date(Date.now() - 60 * 60_000);
  fs.utimesSync(file, old, old);
}

function day(offset: number): string {
  return new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
}

/** A day of the vault's own tool-invocation trace. */
function writeUsageDay(dayStr: string, count: number): void {
  const file = usageLogPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = Array.from({ length: count }, (_, i) =>
    JSON.stringify({ ts: `${dayStr}T0${i % 10}:00:00.000Z`, tool: "ost_read_tree", ok: true, ms: 3, surface: "mcp" }),
  );
  fs.appendFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

async function connect(): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createLazyOstMcpServer(dir);
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

async function call(client: Client, name: string): Promise<string> {
  const res = (await client.callTool({ name, arguments: {} })) as { isError?: boolean; content: Array<{ text: string }> };
  expect(res.isError, `${name} failed: ${res.content?.[0]?.text}`).toBeFalsy();
  return res.content[0].text;
}

describe("S1 — a firing on a done tree produces its own next evidence", () => {
  test("three consecutive firings with zero human input, evidence strictly increasing", async () => {
    enableSelfGeneratedChannels();
    const client = await connect();

    // The starting state S1 describes: a tree with nothing outstanding.
    const before = JSON.parse(await call(client, "ost_next_work")) as { done: boolean };
    expect(before.done, "the fixture must start from a tree with nothing to do").toBe(true);
    expect(readEvidence(dir)).toHaveLength(0);

    const counts: number[] = [];
    const selfGenerated: string[][] = [];
    for (const n of [1, 2, 3]) {
      // What an unattended firing leaves behind: one more finished session of its
      // own. No human writes anything into this vault at any point in this test.
      writeSession(`session-${n}`);
      const report = await call(client, "ost_ingest_inbox");
      expect(report, "the self-generated channel must be named in every report").toContain("[transcript]");

      const evidence = readEvidence(dir);
      counts.push(evidence.length);
      selfGenerated.push(evidence.filter((e) => /^(TRANSCRIPT|USAGE):/.test(e.id)).map((e) => e.id));
    }

    // Strictly increasing, which is the check as S1 words it.
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBeGreaterThan(counts[0]);
    expect(counts[2]).toBeGreaterThan(counts[1]);
    // …and every firing's growth traces to a channel no human wrote to.
    expect(selfGenerated[2].length).toBe(counts[2]);

    // The consequence, not the mechanism: the tree now has work it did not have.
    const after = JSON.parse(await call(client, "ost_next_work")) as {
      done: boolean;
      unmappedEvidence: Array<{ source: string; actor?: string }>;
    };
    expect(after.done).toBe(false);
    expect(after.unmappedEvidence.some((e) => e.source.startsWith("TRANSCRIPT:"))).toBe(true);
    expect(after.unmappedEvidence.find((e) => e.source.startsWith("TRANSCRIPT:"))?.actor).toBe("transcript");
  }, 20_000);

  test("the vault's own trace becomes evidence, one item per finished day past the threshold", async () => {
    enableSelfGeneratedChannels();
    // Two finished days: one busy enough to be worth an item, one not. `minEvents`
    // is the adapter's guard against rolling up near-idle days, and this is what
    // pins that it discriminates rather than emitting whatever it finds.
    writeUsageDay(day(3), 6);
    writeUsageDay(day(2), 3);
    const client = await connect();

    await call(client, "ost_ingest_inbox");

    const ids = readEvidence(dir).map((e) => e.id).sort();
    expect(ids).toContain(`USAGE:${day(3)}`);
    expect(ids).not.toContain(`USAGE:${day(2)}`);
    // Today is deliberately absent: a partial day would be re-emitted tomorrow with
    // different numbers under the same id.
    expect(ids).not.toContain(`USAGE:${day(0)}`);
  }, 20_000);

  test("a genuinely dry firing captures nothing, and does not throw or claim it looked elsewhere", async () => {
    // The negative S1 asks for. Nothing has happened in this vault: no sessions, no
    // finished day of trace, no notes. The honest answer is zero — reported per
    // channel, so "zero" cannot be confused with "never looked".
    enableSelfGeneratedChannels();
    const client = await connect();

    const report = await call(client, "ost_ingest_inbox");

    expect(report).toMatch(/^captured 0 new item\(s\) from 0 of \d+ channel\(s\):/);
    expect(report).toContain("[transcript] 0 new");
    expect(report).toContain("[usage] 0 new");
    expect(readEvidence(dir)).toHaveLength(0);
    expect(JSON.parse(await call(client, "ost_next_work")).done).toBe(true);

    // Non-vacuity: the same call over the same vault DOES capture once the agent has
    // finished a session, so "0 new" here is a fact about the vault rather than a
    // tool that always says zero.
    writeSession("session-a");
    expect(await call(client, "ost_ingest_inbox")).toMatch(/captured 1 new item/);
  }, 20_000);
});
