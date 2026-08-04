/**
 * The joint the Phase 1 ledger was built for.
 *
 * `withUsageTracing` read OST_UNKNOWN from Phase 1 and nothing outside a test
 * ever wrote it, so every event in every real vault was unattributed and
 * per-unknown cost was structurally zero. This suite pins the mechanism that
 * closes that: an optional `unknown` property on the tools whose spend can
 * honestly belong to one unknown, read by the single MCP dispatch point and
 * declared to the trace for exactly the span of one call.
 *
 * Most of what follows is about what happens when a call ENDS — normally, by
 * throwing, or with some stale value already present. A leaked marker does not
 * fail loudly: it silently bills the next call to the wrong unknown, which is
 * worse than no attribution at all, because a wrong number reads as a measured
 * one.
 *
 * The last block is H5, and it is about where the marker may come FROM. The
 * declaration used to travel through `process.env.OST_UNKNOWN`, which meant the
 * ledger's two grouping fields were the two fields an unrelated shell could
 * author. Dispatch now declares them in-process (`withAttribution`) and mints its
 * own `session`; the environment is not read by anyone. Both directions are
 * pinned here, because "the shell cannot set it" is worth nothing on a build
 * where nothing sets it at all.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { createLazyOstMcpServer, createOstMcpServer, MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { ALLOWED_TOOL_NAMES } from "../../src/security/policy.js";
import { ATTRIBUTABLE_TOOLS, buildOstTools } from "../../src/security/tools.js";
import { usageLogPath, type UsageEvent } from "../../src/telemetry/usage.js";

const OUTCOME = "Reach ten returning operators";
const DARK = "How many users hit the export path";

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-attribution-"));
  await initVault(dir, "Reach ten returning operators.", OUTCOME);
  delete process.env.OST_UNKNOWN;
  delete process.env.OST_SESSION;
});
afterEach(() => {
  delete process.env.OST_UNKNOWN;
  delete process.env.OST_SESSION;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function connect(): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createOstMcpServer(buildPassContext(dir));
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

/**
 * The factory an operator actually runs.
 *
 * `ost-agent mcp` — the command the plugin auto-starts — builds
 * `createLazyOstMcpServer` (`src/cli/index.ts:333`). It shares the dispatch
 * handler with the eager factory but mints its session on its own line, and a
 * duplicated line is the kind that goes stale in silence.
 */
async function connectLazy(): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createLazyOstMcpServer(dir);
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

function events(): UsageEvent[] {
  const file = usageLogPath(dir);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as UsageEvent);
}

function last(tool: string): UsageEvent {
  const found = events().filter((e) => e.tool === tool);
  if (found.length === 0) throw new Error(`no usage event was recorded for ${tool}`);
  return found[found.length - 1];
}

describe("a tool call that names the unknown it serves", () => {
  test("stamps that name onto the usage trace — this is where cost-to-resolve comes from", async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: "ost_annotate",
      arguments: { title: OUTCOME, issue: "checked the export funnel", unknown: DARK },
    })) as { isError?: boolean };

    expect(res.isError).toBeFalsy();
    expect(last("ost_annotate").unknown).toBe(DARK);
  });

  test("stamps NOTHING when the call names no unknown — silence is not a guess", async () => {
    const client = await connect();
    await client.callTool({
      name: "ost_annotate",
      arguments: { title: OUTCOME, issue: "ordinary housekeeping" },
    });

    expect("unknown" in last("ost_annotate")).toBe(false);
  });

  test("clears the marker when the tool THROWS — a failed exploration must not bill the next call", async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: "ost_create_node",
      arguments: {
        title: "Orphaned darkness",
        layer: "Unknown",
        parent: "no such parent",
        body: "## Format\nx",
        evidence: "assertion",
        unknown: DARK,
      },
    })) as { isError?: boolean };

    expect(res.isError).toBe(true);
    // The wasted attempt is exactly the spend worth seeing, so it is attributed.
    expect(last("ost_create_node").ok).toBe(false);
    expect(last("ost_create_node").unknown).toBe(DARK);
    // …and the marker does not outlive the call that set it. It was never in the
    // environment to begin with (H5), which is a stronger version of the same
    // guarantee than the `finally`-restore this replaced.
    expect(process.env.OST_UNKNOWN).toBeUndefined();
  });

  test("a later call does NOT inherit the earlier call's marker", async () => {
    const client = await connect();
    await client.callTool({
      name: "ost_annotate",
      arguments: { title: OUTCOME, issue: "spent on the unknown", unknown: DARK },
    });
    await client.callTool({
      name: "ost_append_to_node",
      arguments: { title: OUTCOME, section: "## Notes\nspent on nothing in particular" },
    });

    expect(last("ost_annotate").unknown).toBe(DARK);
    expect("unknown" in last("ost_append_to_node")).toBe(false);
  });

  test("an ambient OST_UNKNOWN attributes nothing and survives the call unchanged — dispatch owns the variable, not the shell", async () => {
    process.env.OST_UNKNOWN = "Something an operator exported hours ago";
    const client = await connect();
    await client.callTool({
      name: "ost_annotate",
      arguments: { title: OUTCOME, issue: "declared nothing" },
    });

    expect("unknown" in last("ost_annotate")).toBe(false);
    expect(process.env.OST_UNKNOWN).toBe("Something an operator exported hours ago");
  });
});

describe("the marker is declared, never smuggled", () => {
  test("a tool that does not accept attribution REFUSES the property rather than ignoring it", async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: "ost_next_work",
      arguments: { unknown: DARK },
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/unexpected property `unknown`/);
  });

  test("every attributable tool declares the property, so the input validator lets it through", () => {
    const tools = buildOstTools(buildPassContext(dir)) as unknown as Array<{
      name: string;
      input_schema: { properties?: Record<string, unknown>; additionalProperties?: boolean };
    }>;

    for (const name of ATTRIBUTABLE_TOOLS) {
      const t = tools.find((x) => x.name === name)!;
      expect(Object.keys(t.input_schema.properties ?? {})).toContain("unknown");
      // The declaration is what makes it legal; the closed schema is what makes
      // an undeclared property an error rather than a silent no-op.
      expect(t.input_schema.additionalProperties).toBe(false);
    }
  });
});

/**
 * H5 — attribution is stamped by the surface, not read from the environment.
 *
 * These run through the real MCP server (`createOstMcpServer` over an in-memory
 * transport) rather than against `withUsageTracing` directly, because the
 * criterion is about the surface: the question is not whether the tracer *can*
 * ignore the environment but whether the shipped dispatch path does, and whether
 * what it puts there instead is something the environment cannot forge.
 */
describe("the environment cannot author the trace's attribution", () => {
  test("OST_SESSION and OST_UNKNOWN exported by an unrelated shell appear in the event in no form", async () => {
    // The criterion's check, verbatim. Distinctive values so the assertion can be
    // a substring scan of the raw record rather than a field comparison — nothing
    // about the shell's export reaches the log, under any key.
    process.env.OST_SESSION = "SHELL-SESSION-3f9a71";
    process.env.OST_UNKNOWN = "SHELL-UNKNOWN-8d2b40";
    let survivingSession: string | undefined;
    let survivingUnknown: string | undefined;
    try {
      const client = await connect();
      await client.callTool({
        name: "ost_annotate",
        arguments: { title: OUTCOME, issue: "a call made while the shell had opinions" },
      });
      // Read before the cleanup below, so the "dispatch left them alone" claim is
      // about the call and not about this test's own teardown.
      survivingSession = process.env.OST_SESSION;
      survivingUnknown = process.env.OST_UNKNOWN;
    } finally {
      delete process.env.OST_SESSION;
      delete process.env.OST_UNKNOWN;
    }

    const raw = fs.readFileSync(usageLogPath(dir), "utf8");
    expect(raw).not.toContain("SHELL-SESSION-3f9a71");
    expect(raw).not.toContain("SHELL-UNKNOWN-8d2b40");
    const event = last("ost_annotate");
    expect(event.unknown).toBeUndefined();
    expect(event.session).not.toBe("SHELL-SESSION-3f9a71");
    // POSITIVE CONTROL, and the reason the two assertions above are not vacuous:
    // this same event DOES carry attribution — the server's own minted session —
    // so the trace is demonstrably capable of recording the field it just refused
    // to take from the shell. Both halves were verified to be falsifiable:
    // restoring the `process.env` read in `resolveAttribution` reddens the
    // `not.toContain` pair, and dropping `session` from the `withAttribution`
    // call in `handleOstCall` reddens this line.
    expect(event.session).toMatch(/^mcp-[0-9a-f-]{36}$/);
    // And the shell's variables are left exactly as they were: dispatch neither
    // reads nor writes them now.
    expect(survivingSession).toBe("SHELL-SESSION-3f9a71");
    expect(survivingUnknown).toBe("SHELL-UNKNOWN-8d2b40");
  });

  test("the session is minted by the server: stable across its own calls, different for a second server", async () => {
    // What `session` claims is "these calls came from one run". That claim needs
    // both halves — same run groups, different runs do not merge — and an
    // env-supplied value could satisfy neither reliably: two servers launched
    // from one profile would have shared a session, and a shell could have
    // impersonated a run it was not.
    const first = await connect();
    await first.callTool({ name: "ost_annotate", arguments: { title: OUTCOME, issue: "one" } });
    await first.callTool({ name: "ost_append_to_node", arguments: { title: OUTCOME, section: "## Notes\ntwo" } });

    const second = await connect();
    await second.callTool({ name: "ost_annotate", arguments: { title: OUTCOME, issue: "three" } });

    const all = events().filter((e) => e.session);
    expect(all.length).toBeGreaterThanOrEqual(3);
    const firstServer = all.slice(0, 2).map((e) => e.session);
    expect(new Set(firstServer).size).toBe(1);
    // Non-vacuity for "stable": if every event simply carried the same constant,
    // the second server's would match too. It must not.
    expect(all[2].session).not.toBe(firstServer[0]);
  });

  test("the declared unknown and the minted session ride the SAME event — grouping by either still works", async () => {
    // `src/adapters/usage.ts` counts distinct sessions and `src/eval/attention.ts`
    // buckets by unknown; both read one event. A fix that supplied one field and
    // dropped the other would leave those readers half-blind, so pin them together.
    const client = await connect();
    await client.callTool({
      name: "ost_annotate",
      arguments: { title: OUTCOME, issue: "spent deliberately", unknown: DARK },
    });

    const event = last("ost_annotate");
    expect(event.unknown).toBe(DARK);
    expect(event.session).toMatch(/^mcp-[0-9a-f-]{36}$/);
  });

  test("the SHIPPED factory stamps the same way — `ost-agent mcp` starts the lazy server, not the eager one", async () => {
    // Every assertion above this one runs `createOstMcpServer`, which no
    // operator ever starts: the plugin launches `ost-agent mcp`, and that
    // command builds `createLazyOstMcpServer` (`src/cli/index.ts:333`). The two
    // share `handleOstCall` — so the `unknown` half cannot drift — but each
    // mints its own session, on its own line. That duplication was unpinned:
    // replacing the lazy factory's `mintSessionId()` with `""` left all 133
    // tests under `test/mcp` GREEN, which is how the criterion could have been
    // "met" on a surface where the field it promises was empty in every real
    // vault. That exact mutation reddens the `toMatch` below.
    process.env.OST_SESSION = "SHELL-SESSION-lazy-6a1c";
    process.env.OST_UNKNOWN = "SHELL-UNKNOWN-lazy-2e77";
    const client = await connectLazy();
    await client.callTool({
      name: "ost_annotate",
      arguments: { title: OUTCOME, issue: "made through the surface that ships", unknown: DARK },
    });

    const raw = fs.readFileSync(usageLogPath(dir), "utf8");
    expect(raw).not.toContain("SHELL-SESSION-lazy-6a1c");
    expect(raw).not.toContain("SHELL-UNKNOWN-lazy-2e77");
    const event = last("ost_annotate");
    expect(event.session).toMatch(/^mcp-[0-9a-f-]{36}$/);
    // Paired with the negative, for the reason the whole file is arranged this
    // way: "the shell cannot author it" is free on a build that records nothing.
    expect(event.unknown).toBe(DARK);

    // Per instance here too. A constant minted once per module would group two
    // unrelated plugin sessions into one apparent run, and an absent session
    // would collapse this set to zero.
    const other = await connectLazy();
    await other.callTool({ name: "ost_annotate", arguments: { title: OUTCOME, issue: "a different run entirely" } });
    expect(new Set(events().filter((e) => e.session).map((e) => e.session)).size).toBe(2);
  });
});

describe("attribution added no tool", () => {
  test("the allowlist is the same 24 names and the MCP surface the same 22 — a marker is an argument, not a verb", () => {
    expect(ALLOWED_TOOL_NAMES).toHaveLength(24);
    expect(MCP_TOOL_NAMES).toHaveLength(22);
    for (const name of [...ALLOWED_TOOL_NAMES, ...MCP_TOOL_NAMES]) {
      expect(name).not.toMatch(/unknown/i);
    }
    // And every attributable name is an existing allowlisted tool, so the set
    // cannot become a back door for a new one.
    for (const name of ATTRIBUTABLE_TOOLS) {
      expect([...MCP_TOOL_NAMES] as string[]).toContain(name);
    }
  });
});
