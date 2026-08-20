/**
 * The instrument for "The CLI fallback reaches the same vault, and refuses the
 * write half" — the assumption beneath "Fall back to the command-line path
 * automatically when the MCP tools are absent".
 *
 * **The three clauses, and why there are three.** The test node's threshold:
 * with the MCP surface removed, the fallback (1) resolves the same vault the MCP
 * surface would have and produces byte-identical ingest / check / status / debt
 * output, (2) refuses every write verb rather than routing it, and (3) is not
 * able to emit a report that a clean-run reader would accept. Reaching the
 * vault is necessary and nowhere near sufficient: a fallback with the right
 * vault and different numbers enters the record as a clean run carrying wrong
 * counts; a fallback that can author is unattended work through a path nobody
 * designed for it; and a fallback whose firing still seals `no-op` is the
 * twenty-two false-clean firings this whole branch of the tree is about, with
 * more output.
 *
 * **Clause 3 is the one written against a mechanism that already exists.** The
 * degraded verdict decides "did the pass reach the tree" by counting traced
 * tool calls — and the fallback runs the same traced tools. A naive fallback
 * would make four real calls after the pass made none, satisfy the rule on the
 * pass's behalf, and seal `no-op`. The rows in the third block are what keep
 * that from being built: the fallback's own calls are asserted to be in the
 * trace AND the firing is asserted to seal `degraded` anyway.
 *
 * **Where `ingest` sits.** The MCP dispatcher classifies `ost_ingest_inbox` as
 * mutating (it writes evidence records and commits). The node lists it in the
 * read-only half, and the line it draws is report-versus-author: ingest captures
 * what the channels already hold and authors nothing. So it is carried, its
 * captures are committed under a `fallback:` message, and the byte-identity row
 * for it compares two identical vaults — the one thing a committing verb cannot
 * do is run twice against the same state and produce the same bytes.
 *
 * **What a green here does not prove.** That a human reading the degraded report
 * notices. That is "Show readers a degraded run report and see whether they
 * notice", a question about people, and nothing in this file stands in for it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { createLazyOstMcpServer, MCP_TOOL_NAMES, mutatesVault } from "../../src/mcp/server.js";
import { LOOP_EXIT } from "../../src/cli/loop.js";
import {
  FALLBACK_TOOL_NAMES,
  FALLBACK_VERB_ORDER,
  resolveFallbackVerb,
  runFallbackVerb,
} from "../../src/loop/fallback.js";
import { FALLBACK_SURFACE } from "../../src/loop/degraded.js";
import { computeVerdict, readOpenRun, readRuns, type LoopRunRecord } from "../../src/loop/health.js";
import { readUsageEvents } from "../../src/telemetry/preflight.js";
import { usageLogPath } from "../../src/telemetry/usage.js";
import { readEvidence } from "../../src/processes/tree.js";
import { CHANNEL_ZERO, resolveChannels } from "../../src/adapters/channels.js";
import { loadConfig } from "../../src/config/load.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../../src/cli/index.ts");
const TSX = path.resolve(here, "../../node_modules/.bin/tsx");

const OUTCOME = "Reach ten returning operators.";
const ROOT = "Retention";

let dir: string;
let vault: string;
let sessions: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function commitCount(cwd: string): number {
  try {
    return Number(git(cwd, "rev-list", "--count", "HEAD").trim());
  } catch {
    return 0;
  }
}

/** stdout AND stderr: the banner and every refusal go to stderr, and a cron mails stderr. */
function cli(args: string[], opts: { cwd?: string } = {}): { code: number; out: string; stdout: string; stderr: string } {
  const r = spawnSync(TSX, [CLI, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function loop(subcommand: string, ...args: string[]): { code: number; out: string; stdout: string; stderr: string } {
  return cli(["loop", subcommand, "--vault", vault, ...args]);
}

/**
 * A vault the documented first-run path creates, with a `loop:` block so it may
 * fire. Both halves are committed: `loop start` refuses a dirty tree, and a test
 * that edited the fixture without committing would be testing that refusal.
 *
 * The usage trace is created and TRACKED from the baseline, which is what a real
 * vault looks like after its first call — and it is load-bearing: git collapses
 * an untracked directory to `?? .ost-agent/`, which the firing's residue
 * exemption does not cover, so a second `loop start` in the same vault would be
 * refused for a reason that has nothing to do with this file.
 */
async function makeVault(at: string): Promise<void> {
  await initVault(at, OUTCOME, ROOT);
  git(at, "config", "user.email", "t@example.com");
  git(at, "config", "user.name", "t");
  git(at, "config", "commit.gpgsign", "false");
  fs.appendFileSync(
    path.join(at, "ost.config.yaml"),
    [
      "",
      "loop:",
      '  cadence: "6h"',
      "  spend:",
      "    ceilingWeightedTokens: 1000",
      "    windowHours: 24",
      `    sessionsDir: ${JSON.stringify(sessions)}`,
      "",
    ].join("\n"),
    "utf8",
  );
  fs.mkdirSync(path.dirname(usageLogPath(at)), { recursive: true });
  fs.writeFileSync(usageLogPath(at), "");
  git(at, "add", "-A");
  git(at, "commit", "--quiet", "-m", "loop config");
}

/** The real dispatcher, in process — what "the MCP surface would have given" means. */
async function connect(vaultDir: string): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createLazyOstMcpServer(vaultDir);
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
  expect(res.isError, `${name} errored: ${res.content[0]?.text}`).toBeFalsy();
  return res.content[0].text;
}

/** One traced call, exactly as the MCP dispatcher writes them — what makes a pass NON-degraded. */
function traceToolCall(vaultDir: string, tool = "ost_next_work"): void {
  fs.appendFileSync(
    usageLogPath(vaultDir),
    JSON.stringify({ ts: new Date().toISOString(), tool, ok: true, ms: 3, surface: "mcp", argBytes: 12 }) + "\n",
    "utf8",
  );
}

/** The drop folder the vault's own config names — asked for, never assumed. */
function dropDir(vaultDir: string): string {
  const zero = resolveChannels(vaultDir, loadConfig(vaultDir)).channels.find((c) => c.name === CHANNEL_ZERO);
  if (!zero) throw new Error("no channel zero resolved");
  return zero.dir;
}

function lastRecord(): LoopRunRecord {
  const runs = readRuns(vault);
  expect(runs.length).toBeGreaterThan(0);
  return runs[0];
}

/** The words a firing may not emit when it could not do its job. */
const CLEAN = /sealed: (healthy|no-op)/;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-mcp-absent-"));
  vault = path.join(dir, "vault");
  sessions = path.join(dir, "sessions");
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, "s.jsonl"), "");
  await makeVault(vault);
});
afterEach(() => {
  // Drop folders live OUTSIDE the vault, so removing the vault alone leaks them.
  for (const v of fs.readdirSync(dir)) {
    const candidate = path.join(dir, v);
    if (fs.existsSync(path.join(candidate, "ost.config.yaml"))) fs.rmSync(dropDir(candidate), { recursive: true, force: true });
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Clause 1. Each row runs the MCP tool through the real in-process server and the
 * fallback verb through the real fallback, against the same vault, and asserts
 * the bytes agree. A tree with something in it, so `debt` and `status` have
 * numbers to disagree about.
 */
describe("clause 1 — the fallback reaches the same vault and gives the same answers, byte for byte", () => {
  beforeEach(async () => {
    const client = await connect(vault);
    await call(client, "ost_create_node", {
      title: "Operators cannot tell what changed",
      layer: "Opportunity",
      parent: ROOT,
      body: "an opportunity the pass mapped",
      evidence: "assertion",
    });
    await call(client, "ost_create_node", {
      title: "Show a diff on the home screen",
      layer: "Solution",
      parent: "Operators cannot tell what changed",
      body: "one candidate, no assumption test yet",
      evidence: "assertion",
    });
  });

  // Non-vacuity, per verb: the text is about THIS tree (three nodes, one
  // solution owing a test), not an empty render both sides would trivially
  // agree on. `check` prints counts, never titles.
  test.each([
    ["check", /over 3 node\(s\)/],
    ["status", /Show a diff on the home screen|Opportunit|3/],
    ["debt", /Show a diff on the home screen/],
  ] as const)("%s: identical to the MCP tool's text", async (verb, about) => {
    const client = await connect(vault);
    const mcp = await call(client, `ost_${verb}`);
    const fallback = await runFallbackVerb(vault, verb);
    expect(fallback.text).toBe(mcp);
    expect(fallback.committed).toBeUndefined();
    expect(mcp).toMatch(about);
  });

  test("read-only verbs commit nothing and leave no residue but the trace", async () => {
    const before = commitCount(vault);
    for (const verb of ["check", "status", "debt"] as const) await runFallbackVerb(vault, verb);
    expect(commitCount(vault)).toBe(before);
    // Leading whitespace is significant in porcelain v1 (` M` is modified, unstaged).
    const status = git(vault, "status", "--porcelain")
      .split("\n")
      .map((l) => l.replace(/\s+$/, ""))
      .filter((l) => l.length > 0);
    // The usage trace is the one expected leaving. The census history that the
    // CLI `check`/`status` commands write is NOT here, because the fallback runs
    // the MCP tools rather than the CLI commands — same answers, same residue.
    expect(status).toEqual([" M .ost-agent/usage/events.jsonl"]);
  });

  test("through the CLI, inside a firing, the printed text is the MCP text", async () => {
    const client = await connect(vault);
    const mcp = await call(client, "ost_debt");
    // The seeding above traced calls; this firing's window opens after them.
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    const r = loop("fallback", "debt");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(mcp);
    loop("seal");
  });

  test("with no --vault, the fallback resolves the vault the way `mcp` does: from where it is run", async () => {
    const client = await connect(vault);
    const mcp = await call(client, "ost_debt");
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    const r = cli(["loop", "fallback", "debt"], { cwd: vault });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(mcp);
    loop("seal");
  });

  test("ingest: two identical vaults, one through MCP and one through the fallback, capture the same evidence and say the same thing", async () => {
    const twin = path.join(dir, "twin");
    await makeVault(twin);
    const note = "Three operators said setup took over an hour.";
    for (const v of [vault, twin]) {
      fs.mkdirSync(dropDir(v), { recursive: true });
      fs.writeFileSync(path.join(dropDir(v), "operator-call.md"), note, "utf8");
    }

    const client = await connect(vault);
    const mcp = await call(client, "ost_ingest_inbox");
    const before = commitCount(twin);
    const fallback = await runFallbackVerb(twin, "ingest");

    // The sha is the one byte range that differs by construction — two commits
    // in two repositories. Everything else, including the dispatcher's own
    // `committed` suffix, is compared literally.
    const mask = (s: string) => s.replace(/committed [0-9a-f]{8}/, "committed <sha>");
    expect(mask(fallback.text)).toBe(mask(mcp));
    expect(mcp).toMatch(/captured 1 new item\(s\)/);
    expect(fallback.committed).toBeDefined();
    expect(commitCount(twin)).toBe(before + 1);
    expect(git(twin, "log", "-1", "--format=%s")).toMatch(/^fallback: ost_ingest_inbox — /);

    const shape = (v: string) => readEvidence(v).map((e) => ({ source: e.source, title: e.title, body: e.body, actor: e.actor }));
    expect(shape(twin)).toEqual(shape(vault));
    expect(shape(twin)).toHaveLength(1);
  });
});

/**
 * Clause 2. The write half is refused before anything is built, and the
 * refusal says which of three reasons applies.
 */
describe("clause 2 — every write verb is refused rather than routed", () => {
  test("the fallback builds exactly four tools, and only `ingest` among them is one the server commits after", () => {
    expect([...FALLBACK_TOOL_NAMES]).toEqual(["ost_ingest_inbox", "ost_check", "ost_status", "ost_debt"]);
    expect(FALLBACK_TOOL_NAMES.filter(mutatesVault)).toEqual(["ost_ingest_inbox"]);
  });

  test("every tool on the MCP surface outside the four is refused, and every mutating one is refused as a write verb", () => {
    const outside = MCP_TOOL_NAMES.filter((n) => !FALLBACK_TOOL_NAMES.includes(n));
    expect(outside.length).toBeGreaterThan(10);
    for (const name of outside) {
      const r = resolveFallbackVerb(name);
      expect(r.ok, name).toBe(false);
      if (r.ok) continue;
      expect(r.why, name).toBe(mutatesVault(name) ? "write-verb" : "not-carried");
      // The bare spelling is refused the same way: `create_node` is `ost_create_node`.
      expect(resolveFallbackVerb(name.replace(/^ost_/, "")).ok, name).toBe(false);
    }
    // And the four are accepted in every spelling an operator would try.
    for (const verb of FALLBACK_VERB_ORDER) {
      expect(resolveFallbackVerb(verb).ok).toBe(true);
      expect(resolveFallbackVerb(`ost_${verb === "ingest" ? "ingest_inbox" : verb}`).ok).toBe(true);
    }
    expect(resolveFallbackVerb("definitely-not-a-tool")).toMatchObject({ ok: false, why: "unknown" });
  });

  test("asked to author, the CLI refuses with its own exit code, runs nothing, writes nothing, and stamps nothing", () => {
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    const before = commitCount(vault);

    const r = loop("fallback", "ost_create_node");
    expect(r.code).toBe(LOOP_EXIT.fallbackRefused);
    expect(r.stderr).toMatch(/write verb/);
    expect(r.stderr).toMatch(/never author/);
    expect(r.stderr).toMatch(/Nothing was built, run or written/);

    expect(commitCount(vault)).toBe(before);
    expect(readUsageEvents(vault).filter((e) => e.surface === FALLBACK_SURFACE)).toEqual([]);
    // No stamp: a refused request is not a fallback that happened, and the seal
    // must not report one.
    expect(readOpenRun(vault)?.fallback).toBeUndefined();
    loop("step", "--phase", "check", "--", "true");
    const sealed = loop("seal");
    expect(sealed.out).not.toMatch(/mcp-absent-fallback/);
  });

  test("a mixed request — one carried verb, one write verb — is refused whole, and the carried verb does not run", () => {
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    const r = loop("fallback", "check", "ost_annotate");
    expect(r.code).toBe(LOOP_EXIT.fallbackRefused);
    expect(r.stderr).toMatch(/ost_annotate/);
    expect(readUsageEvents(vault).filter((e) => e.surface === FALLBACK_SURFACE)).toEqual([]);
    expect(readOpenRun(vault)?.fallback).toBeUndefined();
    loop("seal");
  });

  test("a read-only tool outside the four is refused too, with a reason that is not 'write verb'", () => {
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    const r = loop("fallback", "ost_next_work");
    expect(r.code).toBe(LOOP_EXIT.fallbackRefused);
    expect(r.stderr).toMatch(/not carried by the fallback/);
    expect(r.stderr).not.toMatch(/write verb/);
    loop("seal");
  });
});

/**
 * Clause 3. A whole firing bracket, with the fallback in it, and the seal read
 * the way a cron and a wrapper read it.
 */
describe("clause 3 — a fallback run cannot emit a report a clean-run reader would accept", () => {
  test("the firing seals degraded, names the fallback, exits 17, and the record re-derives to degraded", () => {
    loop("start");
    loop("step", "--phase", "pass", "--", "true");

    const fb = loop("fallback");
    expect(fb.code).toBe(0);
    expect(fb.stderr).toMatch(/falling back: 0 tool call\(s\) were traced/);
    expect(fb.stderr).toMatch(/Nothing will be authored/);
    for (const verb of FALLBACK_VERB_ORDER) expect(fb.stdout).toMatch(new RegExp(`── fallback ${verb} \\(`));

    // THE TRAP, stated: the fallback's own calls are in the trace. A detector
    // that counted them would now believe the pass reached the tree.
    expect(readUsageEvents(vault).filter((e) => e.surface === FALLBACK_SURFACE).length).toBeGreaterThanOrEqual(4);

    loop("step", "--phase", "check", "--", "true");
    const sealed = loop("seal");
    expect(sealed.out).toMatch(/sealed: degraded/);
    expect(sealed.out).not.toMatch(CLEAN);
    expect(sealed.out).toMatch(/mcp-absent-fallback/);
    expect(sealed.out).toMatch(/ran: ingest, check, status, debt/);
    expect(sealed.out).toMatch(/Nothing was authored/);
    expect(sealed.out).toMatch(/not evidence that the tree is fine/);
    // And the pass's own emptiness is still named beside it — the fallback does
    // not launder the no-tool-calls finding into "but we ran some reports".
    expect(sealed.out).toMatch(/no-tool-calls/);
    expect(sealed.code).toBe(LOOP_EXIT.degraded);

    const record = lastRecord();
    expect(record.verdict).toBe("degraded");
    expect(record.fallback?.passToolCalls).toBe(0);
    expect(record.fallback?.verbs.map((v) => [v.verb, v.ok])).toEqual([
      ["ingest", true],
      ["check", true],
      ["status", true],
      ["debt", true],
    ]);
    expect(record.degradations?.map((d) => d.kind)).toEqual(expect.arrayContaining(["no-tool-calls", "mcp-absent-fallback"]));
    expect(computeVerdict(record)).toBe("degraded");
  });

  test("`loop health` and `loop due` carry the verdict and the name, for the reader who was not there", () => {
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    loop("fallback");
    loop("step", "--phase", "check", "--", "true");
    loop("seal");
    const health = loop("health");
    expect(health.out).toMatch(/last-fired: .*degraded/);
    expect(health.out).toMatch(/mcp-absent-fallback/);
    expect(loop("due").out).toMatch(/last record: degraded/);
  });

  test("a fallback that dies after stamping still seals degraded — the stamp lands before the first verb", () => {
    // Simulated at the record level: the stamp with an empty verb list is what
    // `runFallback` writes before it builds a tool. A seal over it must not read
    // "no verbs ran" as "no fallback happened".
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    const open = readOpenRun(vault)!;
    fs.writeFileSync(
      path.join(vault, ".git", "ost-agent", "open-run.json"),
      JSON.stringify({ ...open, fallback: { at: new Date().toISOString(), passToolCalls: 0, verbs: [] } }, null, 2),
    );
    loop("step", "--phase", "check", "--", "true");
    const sealed = loop("seal");
    expect(sealed.out).toMatch(/sealed: degraded/);
    expect(sealed.out).toMatch(/mcp-absent-fallback: .*ran: nothing/);
  });

  test("a failed verb is recorded as failed, reported, and does not soften the verdict", () => {
    // A config the ingest verb refuses to run under (CONFIG_DEPENDENT): the
    // fallback must say ingest failed rather than skip it quietly, exit 1, and
    // the firing must still seal degraded. The loop's own front door loads the
    // config strictly, so the break is introduced AFTER `start`.
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    const config = path.join(vault, "ost.config.yaml");
    const original = fs.readFileSync(config, "utf8");
    fs.writeFileSync(config, original + "\nweb: [unclosed\n", "utf8");
    const fb = loop("fallback");
    fs.writeFileSync(config, original, "utf8");
    expect(fb.code).toBe(1);
    expect(fb.out).toMatch(/ost_ingest_inbox failed/);
    const open = readOpenRun(vault)!;
    expect(open.fallback?.verbs.find((v) => v.verb === "ingest")?.ok).toBe(false);
    expect(open.fallback?.verbs.find((v) => v.verb === "check")?.ok).toBe(true);
    loop("step", "--phase", "check", "--", "true");
    const sealed = loop("seal");
    expect(sealed.out).toMatch(/sealed: degraded/);
    expect(sealed.out).toMatch(/failed: ingest/);
  });
});

/**
 * The controls. A fallback that engages on every firing would turn every firing
 * degraded, and a firing whose surface was present must be left exactly alone.
 */
describe("controls — a present surface is not fallen back on, and the bookends hold", () => {
  test("one traced call from the pass is enough: the fallback declines, runs nothing, and the firing seals no-op", () => {
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    traceToolCall(vault);
    const fb = loop("fallback");
    expect(fb.code).toBe(0);
    expect(fb.stdout).toMatch(/not falling back: 1 tool call\(s\) were traced/);
    expect(readUsageEvents(vault).filter((e) => e.surface === FALLBACK_SURFACE)).toEqual([]);
    loop("step", "--phase", "check", "--", "true");
    const sealed = loop("seal");
    expect(sealed.out).toMatch(/sealed: no-op/);
    expect(lastRecord().fallback).toBeUndefined();
    expect(lastRecord().degradations).toBeUndefined();
  });

  test("outside a firing there is nothing to fall back on behalf of", () => {
    const r = loop("fallback");
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no open loop run/);
    expect(readUsageEvents(vault).filter((e) => e.surface === FALLBACK_SURFACE)).toEqual([]);
  });

  test("a second `loop fallback` in the same run does not run the verbs twice", () => {
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    loop("fallback");
    const traced = readUsageEvents(vault).filter((e) => e.surface === FALLBACK_SURFACE).length;
    const again = loop("fallback");
    expect(again.code).toBe(0);
    expect(again.stdout).toMatch(/already fell back this run/);
    expect(readUsageEvents(vault).filter((e) => e.surface === FALLBACK_SURFACE).length).toBe(traced);
    loop("step", "--phase", "check", "--", "true");
    loop("seal");
  });

  test("two full-surface firings in a row, neither degraded, neither stamped", () => {
    for (let i = 0; i < 2; i++) {
      loop("start");
      loop("step", "--phase", "pass", "--", "true");
      traceToolCall(vault);
      loop("fallback");
      loop("step", "--phase", "check", "--", "true");
      expect(loop("seal").out).toMatch(/sealed: no-op/);
    }
    for (const run of readRuns(vault)) {
      expect(run.verdict).toBe("no-op");
      expect(run.fallback).toBeUndefined();
    }
  });
});
