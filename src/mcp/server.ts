/**
 * Stdio-agnostic MCP server exposing the append-only OST tools.
 *
 * Holds NO model and NO API key: the connecting Claude Code session supplies
 * the reasoning, this server only executes allowlisted append-only tools and
 * commits each write. Reuses buildOstTools verbatim, so the allowlist +
 * fail-closed guard remain the single source of truth for what is callable.
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildOstTools } from "../security/tools.js";
import { assertNoDestructiveTool } from "../security/policy.js";
import { validateToolInput, type ToolSchema } from "../security/validateToolInput.js";
import type { PassContext } from "../processes/types.js";
import { buildPassContext } from "../runner/context.js";
import { enqueueCommit } from "./commit.js";
import { bootstrapNextWork, vaultReadiness, type VaultNotReady } from "./bootstrap.js";
import { configProblemGuidance, setupGuidance } from "./setup.js";
import { withAttribution } from "../telemetry/usage.js";
import { VERSION } from "../index.js";

export const MCP_TOOL_NAMES = [
  "ost_read_tree",
  "ost_next_work",
  "ost_create_node",
  "ost_append_to_node",
  "ost_link_nodes",
  "ost_set_status",
  "ost_set_evidence",
  "ost_set_instrument",
  "ost_flag_humans_required",
  "ost_annotate",
  "ost_detach_nodes",
  "ost_edit_node",
  "ost_merge_nodes",
  "ost_search_web",
  "ost_read_web",
  "ost_read_repo",
  "ost_rank_source",
  "ost_check",
  "ost_debt",
  "ost_status",
  "ost_gate",
  "ost_ingest_inbox",
  "ost_deposit",
] as const;

// The read-only tools carry no commit; every other exposed tool mutates and is
// auto-committed. Deriving MUTATING as the complement means a tool added to the
// surface can never silently skip its commit. (`ost_rank_source` is deliberately
// NOT here: it appends a trust record, and that record must be committed.)
const READ_ONLY = new Set<string>([
  "ost_read_tree",
  "ost_next_work",
  "ost_search_web",
  "ost_read_web",
  "ost_read_repo",
  // Analysis: they read the tree and format it. Nothing they do can produce a
  // diff, so a commit would always be empty.
  "ost_check",
  "ost_debt",
  "ost_status",
  "ost_gate",
]);
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

interface ToolCallResult {
  // Index signature: the SDK's CallToolResult is a passthrough schema, and the
  // handler return type only unifies with it when the extra keys are allowed.
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function buildDefs(ctx: PassContext): McpToolDef[] {
  const built = buildOstTools(
    {
      vault: ctx.vault,
      dir: ctx.dir,
      remote: ctx.remote,
      minSolutionsPerOpportunity: ctx.config.processes["P3_ideate"]?.minSolutionsPerOpportunity,
      discoveryTarget: ctx.config.discovery?.target ?? undefined,
      ageOutDays: ctx.config.evidence?.ageOutDays ?? undefined,
      surface: "mcp",
      web: ctx.web,
      productRepos: ctx.productRepos,
      passContext: ctx,
      configProblem: ctx.configProblem,
    },
    MCP_TOOL_NAMES,
  );
  // fail-closed: reject any non-allowlisted or destructively-named tool. (git_commit/
  // git_push are exempt from this scan; they're kept off the MCP surface by MCP_TOOL_NAMES,
  // which the "exposes exactly the six" test locks down.)
  assertNoDestructiveTool(built.map((t) => t.name));

  return built.map((t) => {
    const raw = t as unknown as {
      name: string;
      description: string;
      input_schema: Record<string, unknown>;
      run: (i: unknown) => Promise<unknown>;
    };
    return { name: raw.name, description: raw.description, inputSchema: raw.input_schema, run: (i: unknown) => raw.run(i) };
  });
}

function listToolsPayload(defs: McpToolDef[]): { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> } {
  return { tools: defs.map((d) => ({ name: d.name, description: d.description, inputSchema: d.inputSchema })) };
}

function unknownTool(name: string): ToolCallResult {
  return { content: [{ type: "text", text: `unknown tool "${name}" — not on the OST surface` }], isError: true };
}

/**
 * The one refusal both server factories use for a not-ready vault, so their
 * wording cannot fork. `ost_next_work` gets the state as state — it is where
 * every pass starts, so that is where the skill's first-run branch keys off it;
 * every other tool refuses with the shared setup guidance, which names the same
 * `nextStep` command the bootstrap payload carries.
 */
function notReadyResult(readiness: VaultNotReady, name: string): ToolCallResult {
  if (name === "ost_next_work") {
    return { content: [{ type: "text", text: JSON.stringify(bootstrapNextWork(readiness)) }] };
  }
  return { content: [{ type: "text", text: setupGuidance(readiness) }], isError: true };
}

/**
 * The attribution marker a call declares, if any.
 *
 * Reads the optional `unknown` property the attributable tools declare (see
 * ATTRIBUTABLE_TOOLS in security/tools.ts). Called only after
 * `validateToolInput` has passed, so a tool that does not declare the property
 * has already been refused rather than quietly ignored.
 */
function declaredUnknown(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const value = (args as { unknown?: unknown }).unknown;
  if (typeof value !== "string") return undefined;
  const title = value.trim();
  return title.length > 0 ? title : undefined;
}

/**
 * This server's own identity, minted at construction and never accepted from
 * outside.
 *
 * `session` exists so that a later reader can say "these calls came from one
 * run" — and that grouping is only worth anything if the label cannot be
 * authored by something that was not the run. It used to come from `OST_SESSION`,
 * which means any shell that exported the variable before launching the plugin
 * could stamp its own value onto the trace, and two unrelated servers launched
 * from the same profile would collapse into one apparent session. A generated
 * UUID is unguessable, unforgeable and unique per server instance, which is the
 * grouping the field actually claims to offer. (Per INSTANCE, not per process:
 * two servers in one process are two dispatchers, and merging them would be the
 * same lie in miniature.)
 *
 * The `mcp-` prefix is for the human reading the JSONL, not for the machine —
 * nothing parses it.
 */
function mintSessionId(): string {
  return `mcp-${randomUUID()}`;
}

async function handleOstCall(
  ctx: PassContext,
  byName: Map<string, McpToolDef>,
  name: string,
  args: unknown,
  session: string,
): Promise<ToolCallResult> {
  const tool = byName.get(name);
  if (!tool) return unknownTool(name);
  // First run: the session has the tools but no vault to point them at. Answer
  // with the command that fixes it rather than with whatever the vault layer
  // happens to throw.
  const readiness = vaultReadiness(ctx);
  if (!readiness.ready) return notReadyResult(readiness, name);
  // The allowlist above says which tool may run; this says with what. Without
  // it a constructive tool is destructive in an append-only vault: `ost_annotate`
  // handed `note` instead of the declared `issue` read it as `undefined` and
  // wrote that string over the annotation, permanently, reporting success.
  // Wording matches the CLI refusal deliberately — one incident, one sentence.
  const problems = validateToolInput(tool.inputSchema as ToolSchema, args ?? {});
  if (problems.length > 0) {
    return {
      content: [
        {
          type: "text",
          text:
            `invalid input for "${name}":\n${problems.map((p) => `  - ${p}`).join("\n")}\n` +
            "Nothing was written. Fix the call and retry — this vault is append-only, so a bad write cannot be taken back.",
        },
      ],
      isError: true,
    };
  }
  // Attribution is DECLARED here, at the one dispatch point, and travels to the
  // trace as an in-process scope rather than through the environment (H5). Two
  // fields, two different authorities:
  //
  //   session — this server's minted identity. The surface knows it, so it is
  //             always stamped.
  //   unknown — whatever THIS call declared in its arguments. Stamped when the
  //             call named one, ABSENT when it did not. Absent is the honest
  //             answer and a stale value is not: a leaked marker bills the next
  //             call to the wrong unknown, and a wrong number reads as a
  //             measured one.
  //
  // The previous version of this achieved the same by assigning `process.env.
  // OST_UNKNOWN` and restoring it in a `finally`, which worked only because this
  // dispatcher is serial and left the trace readable by any shell that had
  // exported the variable. `withAttribution` scopes the declaration to this call's
  // async context: a concurrent dispatcher would be correct by construction, and
  // an ambient `OST_UNKNOWN`/`OST_SESSION` is now simply not consulted by anyone.
  const marker = declaredUnknown(args);
  try {
    const out = await withAttribution({ session, ...(marker ? { unknown: marker } : {}) }, () => tool.run(args));
    let text = typeof out === "string" ? out : JSON.stringify(out);
    if (MUTATING.has(name)) {
      const commit = await enqueueCommit(ctx.dir, `mcp: ${name} — ${text}`);
      text += commit.committed ? `\ncommitted ${commit.sha.slice(0, 8)}` : `\n(no changes to commit)`;
    }
    return { content: [{ type: "text", text }] };
  } catch (e) {
    return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
}

function newServer(): Server {
  return new Server({ name: "ost-agent", version: VERSION }, { capabilities: { tools: {} } });
}

export function createOstMcpServer(ctx: PassContext): Server {
  const defs = buildDefs(ctx);
  const byName = new Map(defs.map((d) => [d.name, d]));
  const session = mintSessionId();

  const server = newServer();
  server.setRequestHandler(ListToolsRequestSchema, async () => listToolsPayload(defs));
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    handleOstCall(ctx, byName, req.params.name, req.params.arguments ?? {}, session),
  );
  return server;
}

interface LiveTools {
  ctx: PassContext;
  defs: McpToolDef[];
  byName: Map<string, McpToolDef>;
}

/**
 * The same server, built from a directory that may not be a vault yet.
 *
 * The plugin auto-starts `ost-agent mcp` with OST_VAULT pointed at whatever
 * project the session is in, so this factory must come up with no vault, list
 * the full surface, refuse calls with the setup guidance while writing NOTHING,
 * and serve the real tools on the first call after `init` — no reconnect. Calls
 * delegate to the exact handler `createOstMcpServer` uses, so the two paths
 * cannot drift.
 */
export function createLazyOstMcpServer(vaultDir: string): Server {
  const dir = path.resolve(vaultDir);
  // Minted at construction, not on the first successful call: the identity
  // belongs to the server, and a vault that was not ready for the first three
  // calls is still the same run as the fourth.
  const session = mintSessionId();

  // Built on the first call that finds the vault ready, then cached. Never
  // earlier: the context must load the config `init` wrote, not the bootstrap
  // defaults — and readiness itself needs only the directory (see
  // `vaultReadiness`), so probing costs no config load and no side effect.
  let live: LiveTools | undefined;
  // Tool names/descriptions/schemas are context-independent; a defaults-loaded
  // context renders the pre-init listing and is never used to run anything.
  let listingDefs: McpToolDef[] | undefined;

  const acquire = (): { live: LiveTools } | { setup: VaultNotReady } => {
    if (!live) {
      const readiness = vaultReadiness({ dir });
      if (!readiness.ready) return { setup: readiness };
      // Sources ARE built here, and that is a deliberate reversal. This used to pass
      // `skipSources: true` because an adapter whose env vars are absent in the MCP
      // host process (the plugin launches this server without the operator's shell
      // env) would throw inside `buildPassContext` and take every unrelated tool
      // down — G1's failure mode. Suppressing them fixed that and cost the surface
      // every adapter it ships: `ost_ingest_inbox` had no sources to iterate, so the
      // only path to new evidence was a human writing into the drop folder (S1, S5).
      //
      // `buildPassContext` now degrades PER SOURCE instead: a source that cannot be
      // constructed becomes a named entry on `ctx.unavailableSources`, never a throw.
      // G1's property is preserved by the same mechanism that fixed it for configs,
      // rather than by refusing to build anything.
      const ctx = buildPassContext(dir, { tolerateInvalidConfig: true });
      const defs = buildDefs(ctx);
      const built = { ctx, defs, byName: new Map(defs.map((d) => [d.name, d])) };
      // A degraded context is never cached. Recovery-on-fix used to be free — a
      // broken config threw, so nothing was there to cache and the first call after
      // the human edited the file built the real thing. Tolerating the broken file
      // (G1) removed that accident, and caching the degradation would trade one
      // session-long outage for another: the tools would keep refusing after the file
      // was correct. Re-reading one small file per call until it parses is the price,
      // and it stops the moment it succeeds.
      if (ctx.configProblem) return { live: built };
      live = built;
    }
    return { live };
  };

  const server = newServer();

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    let got: ReturnType<typeof acquire> | undefined;
    try {
      got = acquire();
    } catch {
      // A present-but-broken config must not take tools/list down. The listing
      // is context-independent, so fall through to the defaults-built one and
      // let the CallTool path report what to fix.
    }
    if (got && "live" in got) return listToolsPayload(got.live.defs);
    listingDefs ??= buildDefs(buildPassContext(dir, { listingOnly: true }));
    return listToolsPayload(listingDefs);
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    if (!(MCP_TOOL_NAMES as readonly string[]).includes(name)) return unknownTool(name);
    let got: ReturnType<typeof acquire>;
    try {
      got = acquire();
    } catch (e) {
      // Ready vault, unloadable config: answer with the cause and the fix, not
      // a raw JSON-RPC error. `live` was not cached, so the first call after
      // the human fixes the config builds the real context — no reconnect.
      const cause = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: configProblemGuidance(dir, cause) }], isError: true };
    }
    if ("setup" in got) return notReadyResult(got.setup, name);
    return handleOstCall(got.live.ctx, got.live.byName, name, req.params.arguments ?? {}, session);
  });

  return server;
}
