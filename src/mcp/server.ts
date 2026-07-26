/**
 * Stdio-agnostic MCP server exposing the append-only OST tools.
 *
 * Holds NO model and NO API key: the connecting Claude Code session supplies
 * the reasoning, this server only executes allowlisted append-only tools and
 * commits each write. Reuses buildOstTools verbatim, so the allowlist +
 * fail-closed guard remain the single source of truth for what is callable.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildOstTools } from "../security/tools.js";
import { assertNoDestructiveTool } from "../security/policy.js";
import type { PassContext } from "../processes/types.js";
import { enqueueCommit } from "./commit.js";
import { bootstrapNextWork, vaultReadiness } from "./bootstrap.js";
import { VERSION } from "../index.js";

export const MCP_TOOL_NAMES = [
  "ost_read_tree",
  "ost_next_work",
  "ost_create_node",
  "ost_append_to_node",
  "ost_link_nodes",
  "ost_set_status",
  "ost_set_evidence",
  "ost_flag_humans_required",
  "ost_annotate",
  "ost_search_web",
  "ost_read_web",
  "ost_read_repo",
  "ost_rank_source",
] as const;

// The read-only tools carry no commit; every other exposed tool mutates and is
// auto-committed. Deriving MUTATING as the complement means a tool added to the
// surface can never silently skip its commit. (`ost_rank_source` is deliberately
// NOT here: it appends a trust record, and that record must be committed.)
const READ_ONLY = new Set<string>(["ost_read_tree", "ost_next_work", "ost_search_web", "ost_read_web", "ost_read_repo"]);
const MUTATING = new Set<string>(MCP_TOOL_NAMES.filter((n) => !READ_ONLY.has(n)));

/**
 * Throw unless the vault is initialized: a git repo with an Outcome node.
 *
 * Kept for callers that genuinely cannot proceed without a tree. The stdio
 * server no longer uses it — refusing to start is the least actionable thing it
 * could do on a first run (see `vaultReadiness`).
 */
export function assertVaultReady(ctx: PassContext): void {
  const r = vaultReadiness(ctx);
  if (!r.ready) throw new Error(r.message);
}

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (input: unknown) => Promise<unknown>;
}

export function createOstMcpServer(ctx: PassContext): Server {
  const built = buildOstTools(
    {
      vault: ctx.vault,
      dir: ctx.dir,
      remote: ctx.remote,
      minSolutionsPerOpportunity: ctx.config.processes["P3_ideate"]?.minSolutionsPerOpportunity,
      surface: "mcp",
      web: ctx.web,
      productRepos: ctx.productRepos,
    },
    MCP_TOOL_NAMES,
  );
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
    // First run: the session has the tools but no vault to point them at. Answer
    // with the command that fixes it rather than with whatever the vault layer
    // happens to throw. `ost_next_work` gets it as state — it is where every pass
    // starts, so that is where the skill's first-run branch can key off it.
    const readiness = vaultReadiness(ctx);
    if (!readiness.ready) {
      if (name === "ost_next_work") {
        return { content: [{ type: "text", text: JSON.stringify(bootstrapNextWork(readiness)) }] };
      }
      return { content: [{ type: "text", text: readiness.message }], isError: true };
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
