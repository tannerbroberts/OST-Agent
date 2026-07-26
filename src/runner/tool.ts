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
import { validateToolInput, type ToolSchema } from "../security/validateToolInput.js";

export async function runTool(vaultDir: string, name: string, input: unknown): Promise<string> {
  const ctx = buildPassContext(vaultDir);
  const tools = buildOstTools({ vault: ctx.vault, dir: ctx.dir, remote: ctx.remote, surface: "cli-tool" });
  // fail closed — the tool surface is exactly the allowlist, nothing else
  assertNoDestructiveTool(tools.map((t) => t.name));
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`unknown tool "${name}". Allowed: ${tools.map((t) => t.name).join(", ")}`);
  }
  // The allowlist above says which tool may run. This says with what — and it
  // has to, because a constructive tool handed an argument nobody checked is
  // destructive in an append-only vault: `ost_annotate` given `note` instead of
  // the declared `issue` wrote the literal string "undefined" over the note it
  // was given, permanently, and reported success.
  // The SDK's helper normalises `inputSchema` to `input_schema`; read both so
  // this keeps working whichever shape the tool object arrives in. A tool with
  // no readable schema is validated against nothing and must not silently pass
  // as "checked" — see the assertion in the schema-coverage test.
  const declared = tool as { input_schema?: ToolSchema; inputSchema?: ToolSchema };
  const problems = validateToolInput(declared.input_schema ?? declared.inputSchema, input ?? {});
  if (problems.length > 0) {
    throw new Error(
      `invalid input for "${name}":\n${problems.map((p) => `  - ${p}`).join("\n")}\n` +
        "Nothing was written. Fix the call and retry — this vault is append-only, so a bad write cannot be taken back.",
    );
  }

  // tools are a heterogeneous union (each with its own input type); we only need
  // the loose call shape here
  const out = await (tool as { run: (i: unknown) => Promise<unknown> }).run(input ?? {});
  return typeof out === "string" ? out : JSON.stringify(out);
}
