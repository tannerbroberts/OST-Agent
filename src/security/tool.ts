/**
 * The tool definition helper.
 *
 * Was `betaTool` from the Anthropic SDK, used purely as a raw-JSON-Schema
 * wrapper. tools.ts already chose raw JSON Schema over betaZodTool to avoid
 * coupling the tool surface to a dependency's versioning; now that no code
 * path calls a model, the SDK itself is that coupling, so the nine lines it
 * contributed live here instead.
 *
 * `input_schema` is snake_case on the way out because the MCP server and the
 * input validator both read that key.
 *
 * Every tool also resolves a {@link ReversibilityId} (P1): declare it on the
 * spec, or don't — either way `OstToolDef.reversibility` is never `undefined`,
 * because `reversibilityOf` fails closed to `irreversible` for a spec that
 * omits it. A tool added later without thinking about reversibility reads as
 * the least forgiving class rather than as unclassified.
 */

import { reversibilityOf, type ReversibilityId } from "../knowledge/reversibility.js";

export interface ToolSpec<I> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown> & { type?: string };
  run: (input: I) => Promise<string | unknown> | string | unknown;
  /** How expensive this tool's effect is to undo. Omit and it reads as `irreversible`. */
  reversibility?: string;
}

export interface OstToolDef<I = unknown> {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run: (input: I) => Promise<string | unknown> | string | unknown;
  reversibility: ReversibilityId;
}

export function tool<I>(spec: ToolSpec<I>): OstToolDef<I> {
  if (spec.inputSchema.type !== "object") {
    throw new Error(
      `JSON schema for tool "${spec.name}" must be an object, but got ${spec.inputSchema.type}`,
    );
  }
  return {
    name: spec.name,
    description: spec.description,
    input_schema: spec.inputSchema,
    run: spec.run,
    reversibility: reversibilityOf(spec.reversibility),
  };
}
