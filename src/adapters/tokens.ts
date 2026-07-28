/**
 * Token cost, read from the only place it exists.
 *
 * Since the API-key runner was deleted, OST-Agent never calls the model —
 * Claude Code does — so the tool tracer cannot see token spend at all. It is
 * carried instead in Claude Code's session JSONL, one `usage` object per
 * assistant message.
 *
 * The four tiers are lifted SEPARATELY and never summed here. Cached reads are
 * priced roughly an order of magnitude below fresh input; a single number
 * would track conversation length rather than attention, and the cost model
 * belongs at read time where it can be varied (see eval/attention.ts).
 *
 * Every parse failure degrades to zero rather than to NaN or a throw: this
 * reads a file no OST-Agent process wrote, so it is untrusted input.
 */
import fs from "node:fs";
import { addTiers, emptyTiers, type TokenTiers } from "../telemetry/attention.js";

/** A non-negative finite number, or 0. Never NaN. */
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Lift one transcript entry's token usage, or null when it carries none. */
export function parseUsage(entry: unknown): TokenTiers | null {
  if (!entry || typeof entry !== "object") return null;
  const message = (entry as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const usage = (message as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  return {
    input: count(u.input_tokens),
    output: count(u.output_tokens),
    cacheCreate: count(u.cache_creation_input_tokens),
    cacheRead: count(u.cache_read_input_tokens),
  };
}

/** Total token cost of one session transcript, tiers kept separate. */
export function readSessionTokens(file: string): TokenTiers {
  let total = emptyTiers();
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return total;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const tiers = parseUsage(entry);
    if (tiers) total = addTiers(total, tiers);
  }
  return total;
}
