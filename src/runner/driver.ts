/**
 * Pass driver — the pluggable "who decides which tools to call" seam.
 *
 * - `anthropicDriver` runs the real agent loop via the API SDK Tool Runner, given
 *   only the allowlisted tools. Bounded by `maxIterations` (+ optional token budget).
 * - `scriptedDriver` runs a fixed sequence of tool calls, used for deterministic,
 *   offline, network-free tests that still exercise the real tool implementations.
 *
 * Either way the ONLY tools available are the allowlisted OST/git tools, so a
 * prompt-injection in the evidence can never reach a destructive capability.
 */
/**
 * A built allowlist tool. We only ever touch `.name` and `.run`; the `any` run
 * signature lets the heterogeneous betaTool objects (each with a distinct input
 * type) assign into one array without fighting the SDK's per-tool generics.
 */
export interface BuiltTool {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (input: any) => any;
}
export type ToolSet = BuiltTool[];

export interface DriverRunOpts {
  /** Process id — used by scriptedDriver to select its script and for logging. */
  label: string;
  system: string;
  prompt: string;
  tools: ToolSet;
  maxIterations: number;
  timeoutSec: number;
  tokenBudget?: number;
  model: string;
}

export interface DriverResult {
  toolCalls: { name: string; input: unknown }[];
  text: string;
  iterations: number;
}

export interface PassDriver {
  run(opts: DriverRunOpts): Promise<DriverResult>;
}

/** A scripted tool call for the offline test driver. */
export interface ScriptedCall {
  tool: string;
  input: Record<string, unknown>;
}

/**
 * Deterministic driver: for each pass label, invoke the scripted tool calls
 * against the real (allowlisted) tools. Unknown tools throw — which is exactly
 * the safety property we want to assert.
 */
export function scriptedDriver(scripts: Record<string, ScriptedCall[]>): PassDriver {
  return {
    async run(opts: DriverRunOpts): Promise<DriverResult> {
      const steps = scripts[opts.label] ?? [];
      const byName = new Map(opts.tools.map((t) => [t.name, t]));
      const toolCalls: { name: string; input: unknown }[] = [];
      for (const step of steps) {
        const tool = byName.get(step.tool);
        if (!tool) {
          throw new Error(`scripted call to unavailable tool "${step.tool}" in ${opts.label}`);
        }
        await tool.run(step.input);
        toolCalls.push({ name: step.tool, input: step.input });
      }
      return { toolCalls, text: "", iterations: steps.length };
    },
  };
}

/**
 * Real driver backed by the Anthropic API SDK beta Tool Runner. Lazily imports
 * the SDK so tests that never construct it don't need network or an API key.
 */
export function anthropicDriver(): PassDriver {
  return {
    async run(opts: DriverRunOpts): Promise<DriverResult> {
      const { Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic();

      // The installed SDK's typedefs predate `thinking: "adaptive"` (the API
      // accepts it — see the claude-api reference), so build the request body and
      // cast at the single call site rather than downgrading to a stale shape.
      const body = {
        model: opts.model,
        max_tokens: 16000,
        max_iterations: opts.maxIterations,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: opts.system,
        tools: opts.tools,
        messages: [{ role: "user", content: opts.prompt }],
      };
      type ToolRunnerBody = Parameters<typeof client.beta.messages.toolRunner>[0];
      const runner = client.beta.messages.toolRunner(body as unknown as ToolRunnerBody);

      const toolCalls: { name: string; input: unknown }[] = [];
      let text = "";
      let iterations = 0;
      for await (const message of runner) {
        iterations++;
        const content = (message as { content?: unknown }).content;
        if (!Array.isArray(content)) continue; // streaming variant — not used here
        for (const block of content as Array<{ type: string; name?: string; input?: unknown; text?: string }>) {
          if (block.type === "tool_use") {
            toolCalls.push({ name: block.name ?? "", input: block.input });
          } else if (block.type === "text") {
            text += block.text ?? "";
          }
        }
      }
      return { toolCalls, text, iterations };
    },
  };
}
