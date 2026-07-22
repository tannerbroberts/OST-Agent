/**
 * Direct tool invocation — the seam that lets ANY agent (a separate API-key'd
 * Claude, an MCP client, or the Claude session already running with the operator)
 * drive the tree by calling one allowlisted, append-only tool at a time.
 *
 * The intelligence deciding *what* to create lives in the caller; safety
 * (append-only, no delete tool exists, fail-closed guard) lives here and holds
 * regardless of who drives. This is also the exact surface an `ost-agent mcp`
 * server would expose.
 */
import { buildPassContext } from "./context.js";
import { assertNoDestructiveTool } from "../security/policy.js";
import { buildOstTools } from "../security/tools.js";

export async function runTool(vaultDir: string, name: string, input: unknown): Promise<string> {
  const ctx = buildPassContext(vaultDir);
  const tools = buildOstTools({ vault: ctx.vault, dir: ctx.dir, remote: ctx.remote });
  // fail closed — the tool surface is exactly the allowlist, nothing else
  assertNoDestructiveTool(tools.map((t) => t.name));
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`unknown tool "${name}". Allowed: ${tools.map((t) => t.name).join(", ")}`);
  }
  // tools are a heterogeneous union (each with its own input type); we only need
  // the loose call shape here — safety is already enforced by the allowlist above
  const out = await (tool as { run: (i: unknown) => Promise<unknown> }).run(input ?? {});
  return typeof out === "string" ? out : JSON.stringify(out);
}
