/**
 * Usage tracing — the mechanical record of what the agent actually did.
 *
 * The friction adapter and builder reports are the agent's own *account* of its
 * work: honest, but a narrated account all the same — "subject to whatever this
 * agent failed to notice or chose not to file." This module records the part no
 * narrator touches: every allowlisted tool invocation, as it happens, with its
 * outcome and timing, appended to a JSONL log inside the vault. A trace cannot
 * flatter itself, and it disagrees with the narrative exactly where the
 * narrative is wrong — which is the most valuable evidence dogfooding produces.
 *
 * Recording is fail-open by design: telemetry must never break a tool call, so
 * an unwritable log means a lost event, not a failed mutation. Events carry
 * tool name, outcome, duration, surface, and input SIZE — never input content,
 * so nothing sensitive can leak into the trace.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../adapters/transcript.js";

export interface UsageEvent {
  /** ISO timestamp of the invocation. */
  ts: string;
  /** Tool name, e.g. "ost_create_node". */
  tool: string;
  /** Whether the call returned without throwing. */
  ok: boolean;
  /** Wall-clock duration in milliseconds. */
  ms: number;
  /** Which surface dispatched it: "mcp", "cli-tool", "pass:P2_map", ... */
  surface: string;
  /** Byte length of the JSON-encoded input — size only, never content. */
  argBytes: number;
  /** Redacted, truncated error message when ok=false. */
  err?: string;
  /** Optional session/process marker (OST_SESSION env), for grouping. */
  session?: string;
  /** Which unknown this call was spent on (OST_UNKNOWN env), when one is being worked. */
  unknown?: string;
}

const MAX_ERR_CHARS = 300;

/** Where the trace lives: inside the vault, owned by the operator, travels in git. */
export function usageLogPath(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), ".ost-agent", "usage", "events.jsonl");
}

/**
 * Append one event to the vault's usage log. NEVER throws — a telemetry
 * failure must cost an event, not a mutation.
 */
export function recordUsageEvent(vaultDir: string, event: UsageEvent): void {
  try {
    const file = usageLogPath(vaultDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // fail-open: tracing is best-effort by contract
  }
}

/** The minimal shape of a betaTool we wrap; kept structural so we never import SDK types here. */
interface RunnableTool {
  name: string;
  run: (input: never) => unknown | Promise<unknown>;
}

/**
 * Wrap every tool's `run` so each invocation lands in the vault's usage log.
 * Results and thrown errors pass through untouched; only observation is added.
 */
export function withUsageTracing<T extends RunnableTool>(tools: T[], vaultDir: string, surface: string): T[] {
  const session = process.env.OST_SESSION || undefined;
  return tools.map((tool) => ({
    ...tool,
    run: async (input: never) => {
      const unknown = process.env.OST_UNKNOWN || undefined;
      const started = Date.now();
      let argBytes = 0;
      try {
        argBytes = Buffer.byteLength(JSON.stringify(input ?? null), "utf8");
      } catch {
        // unserializable input: size stays 0, the call itself proceeds
      }
      try {
        const result = await tool.run(input);
        recordUsageEvent(vaultDir, {
          ts: new Date(started).toISOString(),
          tool: tool.name,
          ok: true,
          ms: Date.now() - started,
          surface,
          argBytes,
          ...(session ? { session } : {}),
          ...(unknown ? { unknown } : {}),
        });
        return result;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        recordUsageEvent(vaultDir, {
          ts: new Date(started).toISOString(),
          tool: tool.name,
          ok: false,
          ms: Date.now() - started,
          surface,
          argBytes,
          err: redactSecrets(message).slice(0, MAX_ERR_CHARS),
          ...(session ? { session } : {}),
          ...(unknown ? { unknown } : {}),
        });
        throw e;
      }
    },
  }));
}
