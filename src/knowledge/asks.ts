/**
 * The ask ledger — when the tree asked the sponsor for something, so silence has an age.
 *
 * P2: "An outstanding ask of the sponsor has an age, and an unanswered one is surfaced."
 * A `pending-permission` classification used to produce one dated `## History` line and
 * then go dark — nothing re-read it, so an agent that "assumes it has forever" could not
 * tell a signature asked for yesterday from one asked for 40 days ago. Both looked like
 * `lane: pending-permission`, which reads as the system working.
 *
 * The shape is B5's, copied rather than reinvented: append-only JSONL under `.ost-agent/`,
 * read as a HISTORY (never last-record-wins), with attribution stamped by the caller and
 * the clock injected so age is computable under test without touching the wall clock. An
 * ask is never marked "answered" in this ledger — there is nothing to mark. The record of
 * resolution is that the test left `pending-permission` (a result was recorded, or a human
 * re-classified it), which `disposeAssumptionTests` (`src/mcp/next-work.ts`) already reads;
 * an ask ledger that also tracked answers would be a second place that fact could disagree
 * with the first.
 */
import fs from "node:fs";
import path from "node:path";

export interface AskRecord {
  /** When this ask was filed, from the injected clock — never `Date.now()` directly. */
  ts: string;
  /** Title of the AssumptionTest the ask is about. */
  test: string;
  /** Who filed it — an unattributed ask cannot be traced to a surface. */
  by: string;
  /** Why the lane call landed on a needs-a-person lane, carried over from the filing. */
  why: string;
  /**
   * The command that would clear this ask, when the filer knew it. Absent on
   * lines written before the pending-ask queue existed; a reader that needs one
   * falls back to {@link defaultClearingCommand}, so the queue never shows an
   * ask with no way to act on it.
   */
  command?: string;
}

/**
 * The one command that clears ANY ask: recording what happened. A result is the
 * only event that drops a test out of every needs-a-person lane at once, which
 * is why this — and not a lane re-classification — is the fallback a queue
 * entry carries when its filing named nothing more specific.
 */
export function defaultClearingCommand(test: string): string {
  return `ost-agent result "${test}" -v <supported|refuted|inconclusive> -n "<what happened>" -b <you> -u "<what this run left uncovered>"`;
}

export function askLedgerPath(dir: string): string {
  return path.join(dir, ".ost-agent", "asks", "asks.jsonl");
}

/**
 * Append one ask. Returns the record as written.
 *
 * The clock is injected so the stamp is deterministic under test — the same rule
 * {@link import("./actor-trust.js").appendObservation} follows, for the same reason: a
 * test asserting "40 days stale" cannot afford to race the wall clock.
 */
export function appendAsk(dir: string, rec: Omit<AskRecord, "ts">, now: () => Date = () => new Date()): AskRecord {
  if (!rec.test.trim()) throw new Error("an ask needs the test it was filed for");
  if (!rec.by.trim()) throw new Error("an ask needs attribution — say who filed it");
  const record: AskRecord = { ts: now().toISOString(), test: rec.test, by: rec.by, why: rec.why };
  if (rec.command?.trim()) record.command = rec.command.trim();
  const file = askLedgerPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + "\n");
  return record;
}

/**
 * The ledger as read: HISTORIES keyed by test title, plus the count of lines that could
 * not be read. A damaged line is dropped rather than thrown on — the same fail-open choice
 * `readTrustLedger` makes for a corroboration, made the same way here: an ask ledger this
 * module cannot parse must not take `ost_next_work` down with it, and the count travels
 * with the read so the loss is visible rather than silent.
 */
export interface AskLedger {
  histories: ReadonlyMap<string, readonly AskRecord[]>;
  damaged: number;
}

function parseAsk(raw: string): AskRecord | null {
  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!rec || typeof rec !== "object") return null;
  if (typeof rec.ts !== "string" || !rec.ts) return null;
  if (typeof rec.test !== "string" || !rec.test.trim()) return null;
  const parsed: AskRecord = { ts: rec.ts, test: rec.test, by: String(rec.by ?? ""), why: String(rec.why ?? "") };
  if (typeof rec.command === "string" && rec.command.trim()) parsed.command = rec.command;
  return parsed;
}

export function readAskLedger(dir: string): AskLedger {
  const file = askLedgerPath(dir);
  const histories = new Map<string, AskRecord[]>();
  let damaged = 0;
  if (!fs.existsSync(file)) return { histories, damaged };
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const rec = parseAsk(line);
    if (!rec) {
      damaged += 1;
      continue;
    }
    const list = histories.get(rec.test) ?? [];
    list.push(rec);
    histories.set(rec.test, list);
  }
  return { histories, damaged };
}

/**
 * The most recent ask on record for one test, or `null` when none exists — a test that
 * entered `pending-permission` before this ledger existed, or one this ledger never saw.
 * `null` is a legitimate answer and has to stay distinguishable from "asked just now": age
 * is reported unknown rather than zero, because zero would read as fresh.
 */
export function latestAsk(ledger: AskLedger, test: string): AskRecord | null {
  const list = ledger.histories.get(test);
  if (!list || list.length === 0) return null;
  return list[list.length - 1];
}
