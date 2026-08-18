/**
 * The tool-surface preflight: confirm every required MCP tool is really on a
 * live surface, before a pass does anything else — by listing, never calling.
 *
 * **Why this is not {@link checkRequiredTools}.** That module answers "does the
 * declaration cover the grant?" by comparing two strings the caller hands it —
 * a `required-tools` line and an `--available` list somebody typed. It is exact
 * about the comparison and silent about where `--available` came from, which its
 * own `LIVE_SURFACE_CAVEAT` names directly: "whether the surface this run
 * actually fires with is the list handed in here" is NOT checked. This module
 * closes that gap for the one surface kind that can answer it without a side
 * effect: an MCP server exposes `tools/list`, and a client can read it without
 * calling a single tool the list names. What comes back here is not a typed
 * config file, it is the server's own answer to "what do you have."
 *
 * **The distinguishing assumption this settles.** Session `e42cd03d` found a
 * capability — a Claude Code Skill — that was discoverable only by invoking it:
 * `Unknown skill: superpowers:subagent-driven-development` came back from the
 * call, not from a check. That is real, and it is why this module is scoped to
 * MCP tools rather than to "every tool a pass might declare": every tool this
 * repository's own passes name in `required-tools` is an `ost_*` MCP tool
 * (`test/mcp/preflight-required-tools.test.ts` pins that), and an MCP server's
 * `tools/list` is a first-class, side-effect-free RPC — nothing like invoking a
 * Skill by name and reading the failure. A required tool outside the `mcp__`
 * namespace is left to {@link checkRequiredTools}, which is honest about
 * comparing declarations rather than claiming to enumerate a surface it has no
 * side-effect-free way to ask.
 *
 * **No partial credit.** Two surfaces this repo actually constructs —
 * {@link createOstMcpServer} and {@link createLazyOstMcpServer} — are checked
 * side by side, and a gap or an unreachable surface on either one fails the
 * whole preflight. A tool present on one server and silent on the other is
 * exactly the false green "A sweep that cannot read its subject reports a clean
 * result" describes: reporting the pair as clear because one half was fine
 * would be worse than never having checked.
 *
 * **What green does NOT settle.** It confirms the tool is on the surface's own
 * `tools/list` — not that a call to it will succeed, not that the session this
 * pass actually runs in holds the same grant. A tool that lists cleanly and then
 * refuses every call passes this and fails the run.
 */
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { parseRule } from "./grant-preflight.js";
import {
  isDeclarationProblem,
  parseToolDeclaration,
  unnamespacedTool,
  type PassStart,
  type ToolDeclaration,
} from "../mcp/required-tools.js";

/** One live MCP surface a pass runs on, named for the report a human reads. */
export interface ToolSurface {
  readonly name: string;
  readonly server: Server;
}

export interface SurfaceEnumeration {
  readonly surface: string;
  /** Did `tools/list` answer at all? False means the surface, not the tool list, is the problem. */
  readonly reachable: boolean;
  readonly error?: string;
  /** Bare tool names the surface's own `tools/list` returned. Empty if unreachable. */
  readonly liveTools: readonly string[];
  /** Required MCP tools this surface's listing does not name. */
  readonly missingRequired: readonly string[];
}

export interface ToolSurfacePreflight {
  readonly declaration: ToolDeclaration;
  /** The subset of `declaration.required` this module can check — the `mcp__` ones. */
  readonly requiredMcpTools: readonly string[];
  readonly surfaces: readonly SurfaceEnumeration[];
}

/**
 * Distinct codes so the shell that reads them can tell "a tool is missing" from
 * "a surface could not be asked" — the two want different fixes, and collapsing
 * them into one loses exactly the distinction {@link checkRequiredTools} already
 * draws between its own two gap kinds.
 */
export const TOOL_SURFACE_PREFLIGHT_EXIT = {
  cleared: 0,
  /** A required MCP tool is absent from at least one surface's live listing. */
  missingRequired: 50,
  /** `tools/list` could not be completed on at least one surface. */
  unreachable: 51,
  /** The declaration itself could not be read — not a cleared run. */
  undeclared: 52,
} as const;

export interface ToolSurfacePreflightCheck {
  readonly exitCode: number;
  readonly report: string;
  readonly result: ToolSurfacePreflight | null;
}

/**
 * List one surface's tools over a fresh in-memory transport, and nothing else.
 * No `callTool` is ever issued — the whole guarantee this module exists to buy
 * would be void the moment it invoked the thing it is trying to confirm.
 */
export async function enumerateLiveSurface(surface: ToolSurface): Promise<SurfaceEnumeration> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "ost-agent-tool-surface-preflight", version: "0.0.0" });
  try {
    await Promise.all([surface.server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    return { surface: surface.name, reachable: true, liveTools: tools.map((t) => t.name), missingRequired: [] };
  } catch (e) {
    return {
      surface: surface.name,
      reachable: false,
      error: e instanceof Error ? e.message : String(e),
      liveTools: [],
      missingRequired: [],
    };
  } finally {
    await Promise.allSettled([client.close(), surface.server.close()]);
  }
}

const LIVE_LISTING_CAVEAT =
  "WHAT THIS DOES NOT SETTLE: a tool that lists here and then refuses every call, or is present at a schema the " +
  "caller does not hold, clears this preflight and fails the run. This confirms presence on the surface's own " +
  "tools/list, not usability, and not that the session this pass actually fires in holds the same grant.";

/**
 * Resolve a declaration against every named surface, listing rather than
 * calling. Pure with respect to the surfaces it is handed — it opens and closes
 * its own transports and touches nothing else — which is what lets a caller run
 * it before anything the pass does.
 */
export async function checkToolSurfaces(opts: {
  /** The file whose frontmatter declares `allowed-tools` and `required-tools`. */
  passFile: string;
  surfaces: readonly ToolSurface[];
}): Promise<ToolSurfacePreflightCheck> {
  let markdown: string;
  try {
    markdown = fs.readFileSync(opts.passFile, "utf8");
  } catch (e) {
    return {
      exitCode: TOOL_SURFACE_PREFLIGHT_EXIT.undeclared,
      report:
        `tool-surface COULD NOT RUN: ${opts.passFile} is unreadable ` +
        `(${e instanceof Error ? e.message : String(e)}). That is not a cleared run.`,
      result: null,
    };
  }
  const declaration = parseToolDeclaration(markdown);
  if (isDeclarationProblem(declaration)) {
    return {
      exitCode: TOOL_SURFACE_PREFLIGHT_EXIT.undeclared,
      report: `tool-surface COULD NOT RUN: ${opts.passFile} has ${declaration.problem}. That is not a cleared run.`,
      result: null,
    };
  }

  const requiredMcpTools = declaration.required.filter((t) => parseRule(t).tool.startsWith("mcp__"));
  const requiredBare = requiredMcpTools.map((t) => unnamespacedTool(parseRule(t).tool));

  const surfaces: SurfaceEnumeration[] = [];
  for (const surface of opts.surfaces) {
    const enumerated = await enumerateLiveSurface(surface);
    if (!enumerated.reachable) {
      surfaces.push(enumerated);
      continue;
    }
    const live = new Set(enumerated.liveTools.map(unnamespacedTool));
    const missingRequired = requiredMcpTools.filter((_, i) => !live.has(requiredBare[i]));
    surfaces.push({ ...enumerated, missingRequired });
  }

  const result: ToolSurfacePreflight = { declaration, requiredMcpTools, surfaces };
  const anyUnreachable = surfaces.some((s) => !s.reachable);
  const anyMissing = surfaces.some((s) => s.missingRequired.length > 0);
  const exitCode = anyUnreachable
    ? TOOL_SURFACE_PREFLIGHT_EXIT.unreachable
    : anyMissing
      ? TOOL_SURFACE_PREFLIGHT_EXIT.missingRequired
      : TOOL_SURFACE_PREFLIGHT_EXIT.cleared;

  return { exitCode, report: renderToolSurfacePreflight(result, exitCode), result };
}

/**
 * The message the operator reads. Every surface is named individually, on
 * purpose: a count ("2 of 3 surfaces failed") sends the operator back to work
 * out which, and naming the file to check is the entire saving over discovering
 * the gap one denied call at a time.
 */
export function renderToolSurfacePreflight(result: ToolSurfacePreflight, exitCode: number): string {
  const lines: string[] = [];
  if (exitCode === TOOL_SURFACE_PREFLIGHT_EXIT.cleared) {
    lines.push(
      `tool-surface CLEARED: all ${result.requiredMcpTools.length} required MCP tool(s) are on every one of ` +
        `${result.surfaces.length} surface(s) checked, confirmed by listing — zero tools invoked.`,
    );
  } else {
    lines.push(
      `REFUSING TO BEGIN: the tool surface this pass would run on does not confirm what it requires.`,
      "",
      "No partial credit — one bad surface fails the whole preflight, even if every other surface is clean.",
    );
  }
  lines.push("");
  for (const s of result.surfaces) {
    if (!s.reachable) {
      lines.push(`  [${s.surface}] UNREACHABLE — tools/list did not answer: ${s.error}`);
    } else if (s.missingRequired.length > 0) {
      lines.push(`  [${s.surface}] missing required: ${s.missingRequired.map((t) => unnamespacedTool(parseRule(t).tool)).join(", ")}`);
    } else {
      lines.push(`  [${s.surface}] clean — ${s.liveTools.length} tool(s) listed, all required tools present`);
    }
  }
  lines.push("", LIVE_LISTING_CAVEAT);
  return lines.join("\n");
}

/**
 * The ordering guarantee, in the only form a test can hold: `begin` is the
 * pass's work, and it is not reached at all unless every surface confirms the
 * required tools by listing. Mirrors {@link beginPass}'s shape so the two
 * preconditions compose the same way at a call site.
 */
export async function beginOnLiveSurfaces<T>(opts: {
  passFile: string;
  surfaces: readonly ToolSurface[];
  begin: () => T;
}): Promise<PassStart<T>> {
  const check = await checkToolSurfaces({ passFile: opts.passFile, surfaces: opts.surfaces });
  if (check.exitCode !== TOOL_SURFACE_PREFLIGHT_EXIT.cleared) {
    return { started: false, exitCode: check.exitCode, report: check.report, result: undefined };
  }
  return { started: true, exitCode: TOOL_SURFACE_PREFLIGHT_EXIT.cleared, report: check.report, result: opts.begin() };
}
