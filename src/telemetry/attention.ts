/**
 * The attention ledger — what an unknown cost, and what it bought.
 *
 * One append-only JSONL per unknown, beside the usage trace and health records
 * it is modelled on. Cost lives here rather than in the node body because a
 * cost line per tool call would fight the never-rewrite rule and drown the
 * prose; the node stays readable, the ledger stays machine-owned.
 *
 * Token tiers are stored UNMIXED. Cached reads are priced roughly an order of
 * magnitude below fresh input, so a summed number tracks conversation length
 * rather than attention spent — and because fitness is cost, summing early
 * would quietly select for variants that re-read context. Weighting is a read-
 * time decision (see eval/attention.ts), which keeps the cost model an allele
 * rather than an assumption baked into the store.
 *
 * Writing is fail-open, exactly as `recordUsageEvent` is: a telemetry failure
 * must cost an event, never a mutation.
 */
import fs from "node:fs";
import path from "node:path";
import type { ResolutionState } from "../knowledge/unknowns.js";
import { sanitizeTitle } from "../ost/sanitize.js";

export interface TokenTiers {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export interface AttentionEntry {
  /** ISO timestamp. */
  ts: string;
  /** Title of the unknown this attention was spent on. */
  unknown: string;
  /** `spend` accrues cost; `resolution` records a terminal state. */
  kind: "spend" | "resolution";
  /** Tool invocations attributed to this unknown. */
  calls?: number;
  /** Wall-clock milliseconds attributed to this unknown. */
  ms?: number;
  /** Token cost, tiers kept separate. */
  tokens?: TokenTiers;
  /** Terminal state, on a `resolution` entry. */
  state?: ResolutionState;
  /** Session marker (OST_SESSION), for correlating with the usage trace. */
  session?: string;
}

export function emptyTiers(): TokenTiers {
  return { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
}

export function addTiers(a: TokenTiers, b: TokenTiers): TokenTiers {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheCreate: a.cacheCreate + b.cacheCreate,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

/**
 * Where one unknown's ledger lives. The title is sanitized before it becomes a
 * filename, so a title carrying path separators cannot write outside the
 * attention directory.
 */
export function attentionLogPath(vaultDir: string, unknown: string): string {
  return path.join(path.resolve(vaultDir), ".ost-agent", "attention", `${sanitizeTitle(unknown)}.jsonl`);
}

/** Append one entry. NEVER throws. */
export function recordAttention(vaultDir: string, entry: AttentionEntry): void {
  try {
    const file = attentionLogPath(vaultDir, entry.unknown);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // fail-open: tracing is best-effort by contract
  }
}

/** Every entry recorded for one unknown, in write order. Corrupt lines are skipped. */
export function readAttention(vaultDir: string, unknown: string): AttentionEntry[] {
  const file = attentionLogPath(vaultDir, unknown);
  if (!fs.existsSync(file)) return [];
  const out: AttentionEntry[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as AttentionEntry);
    } catch {
      // a bad byte must not hide the rest of the ledger
    }
  }
  return out;
}
