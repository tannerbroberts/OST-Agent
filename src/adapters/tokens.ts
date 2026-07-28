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
 * reads a file no OST-Agent process wrote, so it is untrusted input. A
 * correlator that threw on a malformed transcript would take down `ost_status`.
 *
 * Two views of the same account. `readSessionUsage` is the per-record view:
 * every usage object with the timestamp it arrived at, so a session's spend can
 * be cut against the intervals during which a given unknown was being worked.
 * `readSessionTokens` is the whole-file total, and is a FOLD over the per-record
 * view rather than a second traversal — derived, so the two can never disagree.
 *
 * `iterations` is deliberately not read. Real `usage` objects carry an
 * `iterations` array whose per-iteration tiers duplicate the top-level fields
 * exactly (observed live: top-level input 2 / output 125 / cache_creation 5703 /
 * cache_read 15152, with `iterations[0]` carrying the identical four numbers).
 * Summing both would double-count every token, and since fitness is cost, an
 * inflated cost model selects against whatever iterates — the opposite of what
 * the ledger is for.
 *
 * `cwd` is the join key. A transcript names the directory its session ran in,
 * and for a maintenance pass that directory is the vault; the filename stem is
 * the `sessionId`. Nothing else links a Claude Code session to an OST tree —
 * `OST_SESSION` has no writer anywhere in the repo — so `sessionCwd` is what
 * makes self-correlation possible at all (see eval/correlate.ts).
 */
import fs from "node:fs";
import { addTiers, emptyTiers, type TokenTiers } from "../telemetry/attention.js";

/** One assistant message's token cost, with the metadata needed to place it in time. */
export interface SessionUsageEntry {
  /** ISO timestamp the record was written with, or "" when the transcript carried none. */
  ts: string;
  /** The four tiers, unmixed. */
  tiers: TokenTiers;
  /** Claude Code's per-entry id, when present. */
  uuid?: string;
  /** The API request id, when present — a second dedupe handle. */
  requestId?: string;
}

/** A non-negative finite number, or 0. Never NaN. */
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** A non-empty string, or undefined. An absent field and a blank one are the same claim: nothing. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Every JSON-object line of a transcript, in file order. Corrupt lines are
 * skipped rather than fatal, and an unreadable file yields nothing at all —
 * one bad line must not cost the rest of the session.
 */
function* readEntries(file: string): Generator<Record<string, unknown>> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return;
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
    if (entry && typeof entry === "object") yield entry as Record<string, unknown>;
  }
}

/**
 * Lift one transcript entry's token usage, or null when it carries none.
 *
 * Reads the TOP LEVEL of `usage` only. See the module note on `iterations`.
 */
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

/**
 * Every usage record in a session transcript, in file order, each with the time
 * it arrived. An entry missing its timestamp keeps `ts: ""` and its tokens: it
 * cannot be placed in an interval, but uncorrelatable is not uncounted — it
 * belongs to the residual, which the correlator reports rather than hides.
 */
export function readSessionUsage(file: string): SessionUsageEntry[] {
  const entries: SessionUsageEntry[] = [];
  for (const entry of readEntries(file)) {
    const tiers = parseUsage(entry);
    if (!tiers) continue;
    const uuid = text(entry.uuid);
    const requestId = text(entry.requestId);
    entries.push({
      ts: text(entry.timestamp) ?? "",
      tiers,
      ...(uuid ? { uuid } : {}),
      ...(requestId ? { requestId } : {}),
    });
  }
  return entries;
}

/**
 * The directory a session ran in, taken from the first entry that names one.
 * Undefined when the file is missing, unreadable, or names no `cwd` — a
 * transcript that will not say where it ran cannot be joined to a vault, and
 * saying so is the correct answer.
 */
export function sessionCwd(file: string): string | undefined {
  for (const entry of readEntries(file)) {
    const cwd = text(entry.cwd);
    if (cwd) return cwd;
  }
  return undefined;
}

/** Total token cost of one session transcript, tiers kept separate. */
export function readSessionTokens(file: string): TokenTiers {
  let total = emptyTiers();
  for (const { tiers } of readSessionUsage(file)) total = addTiers(total, tiers);
  return total;
}
