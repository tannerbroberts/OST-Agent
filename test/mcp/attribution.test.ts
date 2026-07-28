/**
 * The joint the Phase 1 ledger was built for.
 *
 * `withUsageTracing` has read OST_UNKNOWN since Phase 1 and nothing outside a
 * test has ever written it, so every event in every real vault is unattributed
 * and per-unknown cost is structurally zero. This suite pins the mechanism that
 * closes that: an optional `unknown` property on the tools whose spend can
 * honestly belong to one unknown, read by the single MCP dispatch point and
 * held in the environment for exactly the span of one call.
 *
 * Most of what follows is about what happens when a call ENDS — normally, by
 * throwing, or with some stale value already present. A leaked marker does not
 * fail loudly: it silently bills the next call to the wrong unknown, which is
 * worse than no attribution at all, because a wrong number reads as a measured
 * one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { createOstMcpServer, MCP_TOOL_NAMES } from "../../src/mcp/server.js";
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
});
afterEach(() => {
  delete process.env.OST_UNKNOWN;
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
    // …and the marker does not outlive the call that set it.
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

describe("attribution added no tool", () => {
  test("the allowlist is the same 20 names and the MCP surface the same 18 — a marker is an argument, not a verb", () => {
    expect(ALLOWED_TOOL_NAMES).toHaveLength(20);
    expect(MCP_TOOL_NAMES).toHaveLength(18);
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
