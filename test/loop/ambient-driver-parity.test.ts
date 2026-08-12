/**
 * Ambient-driver parity — can an agent already in the operator's session drive
 * a pass as well as a dedicated API-keyed driver?
 *
 * The API-key runner was deleted (16926b8): Claude Code is the only model
 * caller this project has, and the MCP surface is how it drives the append-only
 * tools. What that deletion did NOT settle is whether the ambient route loses
 * or misplaces anything a dedicated driver would have kept — the MCP dispatch
 * interposes input validation, readiness checks, attribution and a commit per
 * mutation, and any of those could refuse or distort a step of a pass that
 * direct tool invocation would have carried through.
 *
 * So this spec produces the comparison itself: the same fixed pass — the same
 * script shape the deleted `scriptedDriver` ran, which is exactly how the API
 * driver's Tool Runner invoked tools in-process — is driven over two identical
 * fixture vaults, once by calling the built tools' `run` directly (the
 * API-driver path) and once through a real MCP client/server pair (the ambient
 * path, the wire a Claude Code session uses). The resulting node sets and
 * edges must match exactly, and must match the shape the script implies, so
 * two passes that both silently did nothing cannot read as parity.
 *
 * What green does not settle, on purpose: prose quality (structure only),
 * long-pass endurance (a fixture bounded enough to be a spec cannot reach
 * context exhaustion mid-sweep), and cost. Those live with the vault's
 * assumption test, not here.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { buildOstTools } from "../../src/security/tools.js";
import { createOstMcpServer } from "../../src/mcp/server.js";

const OUTCOME_TITLE = "Retention";
const OUTCOME_TEXT = "Reach 10,000 daily active users";
const OPP = "I want a reason to come back every day";
const OPP2 = "I forget the app exists between sessions";
const SOL = "Daily challenge mode";
const SOL2 = "Streak reminder notification";
const ASM = "A daily ritual will lift retention";
const TEST_NODE = "Test a seeded daily puzzle lifts D1 return rate";

/**
 * One pass, as a fixed script of allowlisted tool calls — the deterministic
 * stand-in for "which tools a driver decides to call", covering create (every
 * agent-creatable layer on the happy path), a second edge, an append, a status
 * transition and an annotation. Every step must SUCCEED on both paths: a step
 * one surface refuses and the other performs is precisely the divergence this
 * spec exists to catch, and a step both refuse would leave the parity vacuous.
 */
const PASS_SCRIPT: ReadonlyArray<{ tool: string; args: Record<string, unknown> }> = [
  {
    tool: "ost_create_node",
    args: {
      title: OPP,
      layer: "Opportunity",
      parent: OUTCOME_TITLE,
      body: "Players want a daily reason to return.",
      source: "INBOX:interview.md",
      evidence: "assertion",
    },
  },
  {
    tool: "ost_create_node",
    args: {
      title: OPP2,
      layer: "Opportunity",
      parent: OUTCOME_TITLE,
      body: "Nothing pulls players back once the tab is closed.",
      source: "INBOX:interview.md",
      evidence: "assertion",
    },
  },
  {
    tool: "ost_create_node",
    args: {
      title: SOL,
      layer: "Solution",
      parent: OPP,
      status: "unvalidated",
      body: "A seeded daily puzzle shared by all players.",
      evidence: "assertion",
    },
  },
  {
    tool: "ost_create_node",
    args: {
      title: SOL2,
      layer: "Solution",
      parent: OPP,
      status: "unvalidated",
      body: "A push notification when a streak is about to lapse.",
      evidence: "assertion",
    },
  },
  {
    tool: "ost_create_node",
    args: {
      title: ASM,
      layer: "Assumption",
      parent: SOL,
      body: "The belief: a shared daily ritual is why players would return, stated so it could be wrong.",
      evidence: "assertion",
    },
  },
  {
    tool: "ost_create_node",
    args: {
      title: TEST_NODE,
      layer: "AssumptionTest",
      parent: ASM,
      body: "Compare D1 return rate for cohorts with and without the daily challenge.",
      evidence: "assertion",
      threshold: "D1 return rate at least 5 points higher for the challenge cohort.",
      instrument: "npx vitest run test/loop/daily-challenge.test.ts",
    },
  },
  // A move — the tree holds one parent per node, so re-homing is detach-then-link,
  // the one edge-writing flow ost_create_node doesn't cover.
  {
    tool: "ost_detach_nodes",
    args: { parent: OUTCOME_TITLE, child: OPP2, why: "forgetting the app is a facet of the daily-return opportunity, not a peer of it" },
  },
  { tool: "ost_link_nodes", args: { parent: OPP, child: OPP2 } },
  {
    tool: "ost_append_to_node",
    args: { title: OPP, section: "## Notes\n\nThree of five interviewees described a daily-return urge unprompted." },
  },
  {
    tool: "ost_set_status",
    args: { title: SOL, status: "in-discovery", note: "cohort comparison commissioned" },
  },
  {
    tool: "ost_annotate",
    args: { title: SOL2, issue: "hygiene: overlaps the daily challenge's pull mechanism — decorrelate or merge" },
  },
];

/** The edge relation the script implies — asserted against both trees so parity can never be the parity of two no-op passes. */
const EXPECTED_EDGES = [
  `${ASM} -> ${TEST_NODE}`,
  `${OPP} -> ${OPP2}`,
  `${OPP} -> ${SOL}`,
  `${OPP} -> ${SOL2}`,
  `${OUTCOME_TITLE} -> ${OPP}`,
  `${SOL} -> ${ASM}`,
].sort();

let apiDir: string;
let ambientDir: string;
beforeEach(async () => {
  apiDir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-parity-api-"));
  ambientDir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-parity-ambient-"));
  await initVault(apiDir, OUTCOME_TEXT, OUTCOME_TITLE);
  await initVault(ambientDir, OUTCOME_TEXT, OUTCOME_TITLE);
});
afterEach(() => {
  fs.rmSync(apiDir, { recursive: true, force: true });
  fs.rmSync(ambientDir, { recursive: true, force: true });
});

/**
 * The API-driver path: the built tools invoked in-process, `tool.run(input)`,
 * the way the deleted runner's scripted and SDK drivers both dispatched.
 */
async function driveApiPath(dir: string): Promise<void> {
  const ctx = buildPassContext(dir);
  const tools = buildOstTools({
    vault: ctx.vault,
    dir: ctx.dir,
    remote: ctx.remote,
    surface: "pass:parity",
    passContext: ctx,
  }) as unknown as Array<{ name: string; run: (input: unknown) => Promise<unknown> }>;
  const byName = new Map(tools.map((t) => [t.name, t]));
  for (const step of PASS_SCRIPT) {
    const tool = byName.get(step.tool);
    if (!tool) throw new Error(`API-driver path: "${step.tool}" is not on the allowlist surface`);
    await tool.run(step.args);
  }
}

function textOf(res: { content?: unknown }): string {
  const blocks = Array.isArray(res.content) ? (res.content as Array<{ text?: string }>) : [];
  return blocks.map((b) => b.text ?? "").join("\n");
}

/**
 * The ambient path: the same calls carried over a real MCP client/server pair —
 * schema validation, readiness, attribution and the per-mutation commit all in
 * the loop, exactly as a Claude Code session drives them.
 */
async function driveAmbientPath(dir: string): Promise<void> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createOstMcpServer(buildPassContext(dir));
  await server.connect(serverT);
  const client = new Client({ name: "ambient-session", version: "0.0.0" });
  await client.connect(clientT);
  try {
    for (const step of PASS_SCRIPT) {
      const res = (await client.callTool({ name: step.tool, arguments: step.args })) as {
        isError?: boolean;
        content?: unknown;
      };
      expect(res.isError, `ambient path refused "${step.tool}": ${textOf(res)}`).toBeFalsy();
    }
  } finally {
    await client.close();
  }
}

/**
 * The structural view parity is judged on: every node's identity, layer,
 * status, rung, instrument, tags and outgoing edges. Prose and `created`
 * dates are deliberately outside it — the vault's test node is explicit that
 * this comparison is structural only.
 */
function structureOf(dir: string): {
  nodes: Array<Record<string, unknown>>;
  edges: string[];
} {
  const tree = buildPassContext(dir).vault.readTree();
  const nodes = tree
    .map((n) => ({
      title: n.title,
      layer: n.layer,
      status: n.status ?? null,
      evidence: n.evidence ?? null,
      threshold: n.threshold ?? null,
      instrument: n.instrument ?? null,
      source: n.source ?? null,
      tags: [...n.tags].sort(),
      links: [...n.links].sort(),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
  const edges = tree.flatMap((n) => n.links.map((child) => `${n.title} -> ${child}`)).sort();
  return { nodes, edges };
}

describe("ambient session agent drives the append-only tools at API-driver parity", () => {
  test("the same pass through both paths yields identical node sets and edges, and the shape the script implies", async () => {
    await driveApiPath(apiDir);
    await driveAmbientPath(ambientDir);

    const api = structureOf(apiDir);
    const ambient = structureOf(ambientDir);

    // Non-vacuous first: each tree independently carries the whole pass.
    expect(api.edges).toEqual(EXPECTED_EDGES);
    expect(ambient.edges).toEqual(EXPECTED_EDGES);
    expect(api.nodes.map((n) => n.title)).toEqual(
      [OUTCOME_TITLE, OPP, OPP2, SOL, SOL2, ASM, TEST_NODE].sort((a, b) => a.localeCompare(b)),
    );

    // The claim itself: the ambient surface lost and misplaced nothing.
    expect(ambient.nodes).toEqual(api.nodes);
    expect(ambient.edges).toEqual(api.edges);
  });
});
