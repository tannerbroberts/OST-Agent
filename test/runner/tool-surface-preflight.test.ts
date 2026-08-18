/**
 * The tool-surface preflight: does it confirm a required tool list by LISTING a
 * live surface, with zero invocations, and does it refuse to start the pass
 * when even one surface cannot confirm?
 *
 * The pre-committed bar (`Try to confirm a tool surface without invoking any of
 * it`) is pass/fail per surface with no partial credit: the full required tool
 * list must be confirmable without calling any listed tool, on EVERY surface
 * the pass runs on, and a single surface where that fails must fail the whole
 * check — never a silent under-report on one surface papered over by a clean
 * one next to it.
 *
 * Zero invocation is asserted directly: every synthetic surface below counts
 * `CallTool` requests, and every test — cleared or refused — asserts that
 * counter never leaves zero. A preflight that "confirms" a tool by calling it
 * would pass every other assertion here and still be the wrong thing built.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { createOstMcpServer, createLazyOstMcpServer } from "../../src/mcp/server.js";
import {
  TOOL_SURFACE_PREFLIGHT_EXIT,
  beginOnLiveSurfaces,
  checkToolSurfaces,
  enumerateLiveSurface,
  type ToolSurface,
} from "../../src/runner/tool-surface-preflight.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MCP = "mcp__plugin_ost-agent_ost-agent__";
const REQUIRED = ["ost_next_work", "ost_read_tree", "ost_create_node"];
const WOULD_USE = ["ost_ingest_inbox", "ost_append_to_node"];

let dir: string;
let passFile: string;

function writeDeclaration(opts: { required: readonly string[]; wouldUse: readonly string[] }): string {
  const file = path.join(dir, "pass.md");
  const allowed = [...opts.required, ...opts.wouldUse].map((t) => `${MCP}${t}`).join(", ");
  const required = opts.required.map((t) => `${MCP}${t}`).join(", ");
  fs.writeFileSync(file, `---\nname: a-pass\nallowed-tools: ${allowed}\nrequired-tools: ${required}\n---\n\nbody\n`);
  return file;
}

/** A surface that counts how many times a listed tool was actually called. */
function fakeSurface(name: string, tools: readonly string[]): { surface: ToolSurface; calls: { count: number } } {
  const calls = { count: 0 };
  const server = new Server({ name, version: "0.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t, description: t, inputSchema: { type: "object" } })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => {
    calls.count += 1;
    return { content: [{ type: "text", text: "invoked" }] };
  });
  return { surface: { name, server }, calls };
}

/** A surface whose `tools/list` itself fails to answer. */
function unreachableSurface(name: string): ToolSurface {
  const server = new Server({ name, version: "0.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    throw new Error("simulated: this surface cannot answer tools/list");
  });
  return { name, server };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-tool-surface-"));
  passFile = writeDeclaration({ required: REQUIRED, wouldUse: WOULD_USE });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("a single surface, listed rather than called", () => {
  test("enumerateLiveSurface reads the tool names and calls nothing", async () => {
    const { surface, calls } = fakeSurface("solo", REQUIRED);
    const enumerated = await enumerateLiveSurface(surface);
    expect(enumerated.reachable).toBe(true);
    expect(enumerated.liveTools.sort()).toEqual([...REQUIRED].sort());
    expect(calls.count).toBe(0);
  });

  test("an unreachable surface reports why, rather than an empty clean listing", async () => {
    const enumerated = await enumerateLiveSurface(unreachableSurface("broken"));
    expect(enumerated.reachable).toBe(false);
    expect(enumerated.error).toMatch(/simulated/);
    expect(enumerated.liveTools).toEqual([]);
  });
});

describe("every surface complete", () => {
  test("clears with exit 0, and invokes nothing on either surface", async () => {
    const a = fakeSurface("surface-a", [...REQUIRED, ...WOULD_USE]);
    const b = fakeSurface("surface-b", [...REQUIRED, ...WOULD_USE]);
    const check = await checkToolSurfaces({ passFile, surfaces: [a.surface, b.surface] });

    expect(check.exitCode, check.report).toBe(TOOL_SURFACE_PREFLIGHT_EXIT.cleared);
    expect(check.report).toContain("CLEARED");
    expect(a.calls.count).toBe(0);
    expect(b.calls.count).toBe(0);
  });
});

describe("no partial credit — one bad surface fails the whole preflight", () => {
  test("a required tool missing on ONE of two surfaces still refuses overall", async () => {
    const complete = fakeSurface("complete", REQUIRED);
    const degraded = fakeSurface("degraded", REQUIRED.filter((t) => t !== "ost_read_tree"));
    const check = await checkToolSurfaces({ passFile, surfaces: [complete.surface, degraded.surface] });

    expect(check.exitCode).toBe(TOOL_SURFACE_PREFLIGHT_EXIT.missingRequired);
    // Named individually, and against the right surface — the whole saving over
    // discovering it one denied call at a time.
    expect(check.report).toContain("[degraded]");
    expect(check.report).toContain("ost_read_tree");
    expect(check.report).toContain("[complete] clean");
    // The clean surface being clean does not make the overall result clean.
    expect(check.report).not.toContain("tool-surface CLEARED");
    expect(complete.calls.count).toBe(0);
    expect(degraded.calls.count).toBe(0);
  });

  test("an unreachable surface fails the preflight even when the other surface is complete", async () => {
    const complete = fakeSurface("complete", REQUIRED);
    const check = await checkToolSurfaces({ passFile, surfaces: [complete.surface, unreachableSurface("flaky")] });

    expect(check.exitCode).toBe(TOOL_SURFACE_PREFLIGHT_EXIT.unreachable);
    expect(check.report).toContain("[flaky] UNREACHABLE");
    expect(check.report).toMatch(/simulated/);
    expect(complete.calls.count).toBe(0);
  });

  test("would-use tools are not checked against the surface, so their absence never triggers a refusal", async () => {
    // Only REQUIRED is listed; WOULD_USE is entirely off this surface. That is a
    // narrower pass, not a broken preflight — the same split `required-tools.ts`
    // already draws, reused rather than re-decided here.
    const complete = fakeSurface("required-only", REQUIRED);
    const check = await checkToolSurfaces({ passFile, surfaces: [complete.surface] });
    expect(check.exitCode).toBe(TOOL_SURFACE_PREFLIGHT_EXIT.cleared);
  });
});

describe("the ordering guarantee: begin is not reached on a refusal", () => {
  test("a missing required tool stops before `begin` runs", async () => {
    const degraded = fakeSurface("degraded", REQUIRED.filter((t) => t !== "ost_create_node"));
    let beginCalls = 0;
    const start = await beginOnLiveSurfaces({
      passFile,
      surfaces: [degraded.surface],
      begin: () => {
        beginCalls += 1;
        return "ran";
      },
    });

    expect(start.started).toBe(false);
    expect(start.result).toBeUndefined();
    expect(beginCalls).toBe(0);
  });

  test("a cleared surface set reaches `begin`", async () => {
    const complete = fakeSurface("complete", [...REQUIRED, ...WOULD_USE]);
    let beginCalls = 0;
    const start = await beginOnLiveSurfaces({
      passFile,
      surfaces: [complete.surface],
      begin: () => {
        beginCalls += 1;
        return "ran";
      },
    });

    expect(start.started).toBe(true);
    expect(start.result).toBe("ran");
    expect(beginCalls).toBe(1);
  });
});

describe("an unreadable or undeclared pass file is not a cleared run", () => {
  test("a missing file refuses rather than clearing, and never touches a surface", async () => {
    const complete = fakeSurface("complete", REQUIRED);
    const check = await checkToolSurfaces({
      passFile: path.join(dir, "nope.md"),
      surfaces: [complete.surface],
    });
    expect(check.exitCode).toBe(TOOL_SURFACE_PREFLIGHT_EXIT.undeclared);
    expect(complete.calls.count).toBe(0);
  });

  test("a file with no `required-tools` line refuses rather than assuming nothing is required", async () => {
    const file = path.join(dir, "no-required.md");
    fs.writeFileSync(file, `---\nallowed-tools: ${MCP}ost_next_work\n---\n`);
    const check = await checkToolSurfaces({ passFile: file, surfaces: [] });
    expect(check.exitCode).toBe(TOOL_SURFACE_PREFLIGHT_EXIT.undeclared);
  });
});

describe("the report says what green does not settle", () => {
  test("the caveat about usability and live grant is always present", async () => {
    const complete = fakeSurface("complete", [...REQUIRED, ...WOULD_USE]);
    const check = await checkToolSurfaces({ passFile, surfaces: [complete.surface] });
    expect(check.report).toMatch(/does not settle/i);
    expect(check.report).toMatch(/not usability/i);
  });
});

describe("against the two surfaces this repository actually ships", () => {
  let vaultDir: string;
  const SKILL = path.join(REPO, ".claude/skills/opportunity-solution-tree/SKILL.md");

  beforeEach(async () => {
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-tool-surface-real-"));
    await initVault(vaultDir, "Reach 10,000 daily active users", "Retention");
  });
  afterEach(() => fs.rmSync(vaultDir, { recursive: true, force: true }));

  test("createOstMcpServer and createLazyOstMcpServer both confirm the skill's required tools by listing", async () => {
    const live: ToolSurface = { name: "live (initialized vault)", server: createOstMcpServer(buildPassContext(vaultDir)) };
    const lazy: ToolSurface = { name: "lazy (pre-init)", server: createLazyOstMcpServer(vaultDir) };
    const check = await checkToolSurfaces({ passFile: SKILL, surfaces: [live, lazy] });

    // This is the real assumption under test: a required tool declared in the
    // shipped skill is not just PRESENT in `MCP_TOOL_NAMES`, it is actually on
    // both server constructors' own `tools/list` answer, with nothing invoked.
    expect(check.exitCode, check.report).toBe(TOOL_SURFACE_PREFLIGHT_EXIT.cleared);
  });

  test("the lazy surface confirms the required tools even before `init` has been run", async () => {
    // The plugin auto-starts the lazy server before a vault exists at all — the
    // exact moment a preflight has to answer honestly, since `createOstMcpServer`
    // cannot even be constructed yet (it needs a PassContext this directory does
    // not have).
    const uninitialized = fs.mkdtempSync(path.join(os.tmpdir(), "ost-tool-surface-uninit-"));
    try {
      const lazy: ToolSurface = { name: "lazy (uninitialized directory)", server: createLazyOstMcpServer(uninitialized) };
      const check = await checkToolSurfaces({ passFile: SKILL, surfaces: [lazy] });
      expect(check.exitCode, check.report).toBe(TOOL_SURFACE_PREFLIGHT_EXIT.cleared);
    } finally {
      fs.rmSync(uninitialized, { recursive: true, force: true });
    }
  });
});
