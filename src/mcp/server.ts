/**
 * Stdio-agnostic MCP server exposing the append-only OST tools.
 *
 * Holds NO model and NO API key: the connecting Claude Code session supplies
 * the reasoning, this server only executes allowlisted append-only tools and
 * commits each write. Reuses buildOstTools verbatim, so the allowlist +
 * fail-closed guard remain the single source of truth for what is callable.
 */
import fs from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildOstTools } from "../security/tools.js";
import { assertNoDestructiveTool } from "../security/policy.js";
import type { PassContext } from "../processes/types.js";
import { enqueueCommit } from "./commit.js";
import { VERSION } from "../index.js";

export const MCP_TOOL_NAMES = [
  "ost_read_tree",
  "ost_create_node",
  "ost_append_to_node",
  "ost_link_nodes",
  "ost_set_status",
  "ost_annotate",
] as const;

// Every exposed tool except the read-only one mutates → auto-commit. Derived from
// MCP_TOOL_NAMES so a tool added to the surface can never silently skip its commit.
const MUTATING = new Set<string>(MCP_TOOL_NAMES.filter((n) => n !== "ost_read_tree"));

/** Throw unless the vault is initialized: a git repo with an Outcome node. */
export function assertVaultReady(ctx: PassContext): void {
  if (!fs.existsSync(path.join(ctx.dir, ".git"))) {
    throw new Error(`vault at ${ctx.dir} is not a git repository — run \`ost-agent init\` first`);
  }
  if (!ctx.vault.readTree().some((n) => n.layer === "Outcome")) {
    throw new Error(
      `vault at ${ctx.dir} has no Outcome node — run \`ost-agent init\` / \`ost-agent set-outcome\` first. ` +
        `The MCP server maintains an existing tree; it does not bootstrap one.`,
    );
  }
}

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (input: unknown) => Promise<unknown>;
}

export function createOstMcpServer(ctx: PassContext): Server {
  const built = buildOstTools({ vault: ctx.vault, dir: ctx.dir, remote: ctx.remote }, MCP_TOOL_NAMES);
  // fail-closed: reject any non-allowlisted or destructively-named tool. (git_commit/
  // git_push are exempt from this scan; they're kept off the MCP surface by MCP_TOOL_NAMES,
  // which the "exposes exactly the six" test locks down.)
  assertNoDestructiveTool(built.map((t) => t.name));

  const defs: McpToolDef[] = built.map((t) => {
    const raw = t as unknown as {
      name: string;
      description: string;
      input_schema: Record<string, unknown>;
      run: (i: unknown) => Promise<unknown>;
    };
    return { name: raw.name, description: raw.description, inputSchema: raw.input_schema, run: (i) => raw.run(i) };
  });
  const byName = new Map(defs.map((d) => [d.name, d]));

  const server = new Server({ name: "ost-agent", version: VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: defs.map((d) => ({ name: d.name, description: d.description, inputSchema: d.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = req.params.arguments ?? {};
    const tool = byName.get(name);
    if (!tool) {
      return { content: [{ type: "text", text: `unknown tool "${name}" — not on the OST surface` }], isError: true };
    }
    try {
      const out = await tool.run(args);
      let text = typeof out === "string" ? out : JSON.stringify(out);
      if (MUTATING.has(name)) {
        const commit = await enqueueCommit(ctx.dir, `mcp: ${name} — ${text}`);
        text += commit.committed ? `\ncommitted ${commit.sha.slice(0, 8)}` : `\n(no changes to commit)`;
      }
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  });

  return server;
}
