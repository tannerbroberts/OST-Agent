/**
 * Read-only knowledge sources.
 *
 * A `Source` pulls new items from wherever the business's knowledge already flows.
 * The cursor is an OPAQUE string owned by each adapter (the framework only stores
 * and hands it back), so adapters choose their own resumability scheme. Cursors
 * are persisted under `.ost-agent/state/<adapter>.json` inside the vault so they
 * survive restarts and travel in git.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Who produced an evidence record — a closed vocabulary, one entry per channel.
 *
 * Closed, and not a free string, because the next thing to be keyed on this identity
 * is a trust ledger with a ceiling per actor kind, and `web-trust.ts` is already the
 * cautionary tale: `rankHost` accepts any string, so a commissioned pipeline and a
 * real hostname share one namespace and one ceiling (B6). A union means a new adapter
 * cannot quietly mint a producer identity by typing a new word — it has to be added
 * here, where the ceiling will eventually be written next to it.
 *
 * {@link UNKNOWN_ACTOR} is a member because a record can predate the stamp or carry a
 * hand-edited value, and the read has to land somewhere; it lands on the least-trusted
 * answer, never on a channel's name.
 */
export const ACTORS = ["inbox", "slack", "atlassian", "usage", "transcript", "unknown"] as const;
export type Actor = (typeof ACTORS)[number];

/** The fail-closed answer: a record whose producer is not established. */
export const UNKNOWN_ACTOR: Actor = "unknown";

export function isActor(value: unknown): value is Actor {
  return typeof value === "string" && (ACTORS as readonly string[]).includes(value);
}

/**
 * One fetched item, before it is stored.
 *
 * **There is deliberately no `actor` field here.** The producer identity is not part
 * of the payload — it is stamped at the ingest site from the {@link Source} that did
 * the fetching (`writeEvidence`'s third argument). An item that can carry an actor is
 * an item whose author can choose one, and the author of an inbox body is the
 * untrusted builder.
 */
export interface EvidenceItem {
  /** Stable id within the source. */
  id: string;
  /** Provenance tag, e.g. "INBOX:note.md", "JIRA:PROJ-1234". */
  source: string;
  title: string;
  /** Untrusted text — treated as data, never as instructions. */
  body: string;
  /** ISO timestamp. */
  timestamp: string;
  url?: string;
}

/** Opaque, adapter-defined cursor (or null when nothing has been read yet). */
export type Cursor = string | null;

export interface FetchResult {
  items: EvidenceItem[];
  cursor: Cursor;
}

export interface Source {
  readonly name: string;
  /**
   * The producer identity this channel stamps on everything it captures. Separate
   * from `name` — which keys the cursor file — so that what a record says about its
   * origin is a declared member of {@link ACTORS} rather than whatever string an
   * adapter happened to name itself.
   */
  readonly actor: Actor;
  /** Return items new since `cursor`, plus the advanced cursor. Read-only. */
  fetchSince(cursor: Cursor): Promise<FetchResult>;
  /**
   * The cursor that covers `stored` and nothing else — what to persist when a fetch
   * was only partly stored.
   *
   * `fetchSince` returns one cursor for the whole batch, so persisting it after a
   * storage failure marks unstored items as delivered: the producer's report is
   * accepted and then lost, with no way to detect it or retry (W10). The framework
   * cannot repair that itself, because a cursor is opaque to it by design — only the
   * adapter knows whether its scheme can express "these three of five".
   *
   * **Returning `previous` unchanged is a correct implementation, and the required
   * one for a watermark cursor.** A high-water mark cannot name a subset; the honest
   * answer is to re-fetch the whole batch next time and let the store's own
   * idempotency drop the ones already written. The method is required rather than
   * optional so that a new adapter has to decide which of the two it is, in the file
   * where its cursor scheme is written.
   */
  advanceCursor(previous: Cursor, stored: EvidenceItem[]): Cursor;
}

function stateDir(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), ".ost-agent", "state");
}

function cursorFile(vaultDir: string, name: string): string {
  return path.join(stateDir(vaultDir), `${name}.json`);
}

export function loadCursor(vaultDir: string, name: string): Cursor {
  const p = cursorFile(vaultDir, name);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as { cursor: Cursor };
    return parsed.cursor ?? null;
  } catch {
    return null;
  }
}

export function saveCursor(vaultDir: string, name: string, cursor: Cursor): void {
  const dir = stateDir(vaultDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cursorFile(vaultDir, name), JSON.stringify({ cursor }, null, 2), "utf8");
}
