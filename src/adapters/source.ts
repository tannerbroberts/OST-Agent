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
import { CHANNEL_NAME_PATTERN } from "../config/schema.js";

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
export const ACTORS = ["inbox", "slack", "atlassian", "usage", "transcript", "actions", "unknown"] as const;
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

/**
 * What a channel's state file holds, beyond the cursor itself.
 *
 * **"Last fetched" and "last delivered" are separate fields, and silence is
 * computed only off the second.** A healthy poller over a dead channel advances
 * `lastFetchedAt` forever; conflating the two is precisely how a dead channel and
 * an idle one become the same observable — which is the failure S2 exists to end.
 *
 * Every stamp is the *ingesting surface's* clock, never an item's own
 * `timestamp`. A file mtime is producer-controlled, so `touch -d 2030` would let a
 * channel declare its own liveness. Same argument as stamping the actor at the
 * ingest site rather than reading it off the payload.
 *
 * The shape is a strict superset of the historical `{cursor}` file, and
 * {@link loadCursor} still reads `parsed.cursor`, so a state file written by any
 * earlier version loads unchanged. Such a record has no stamps at all and is
 * reported `undated` — a third answer that is neither `live` (a lie) nor `silent`
 * (which would flag every upgraded vault as dead on the day it upgraded).
 */
export interface CursorRecord {
  cursor: Cursor;
  /** First fetch on record. This is what dates a channel that has NEVER delivered. */
  firstFetchedAt?: string;
  /** Every completed fetch, item or not. Never used to decide silence. */
  lastFetchedAt?: string;
  /** The last fetch that actually STORED an item. This is what silence reads. */
  lastItemAt?: string;
  lastItemId?: string;
  itemsDelivered?: number;
}

function stateDir(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), ".ost-agent", "state");
}

function cursorFile(vaultDir: string, name: string): string {
  // Fail-closed on the name, because the name is a path segment: a channel called
  // `../../etc` would put this write outside the state directory entirely. The
  // schema already refuses such a name, but the schema is not the only caller —
  // this is the last gate before the filesystem.
  if (!CHANNEL_NAME_PATTERN.test(name)) {
    throw new Error(
      `refusing to use "${name}" as a cursor name — a channel name must match ${CHANNEL_NAME_PATTERN} (it is a filename under .ost-agent/state/)`,
    );
  }
  return path.join(stateDir(vaultDir), `${name}.json`);
}

/** The whole state file, or null when the channel has never been fetched. */
export function loadCursorRecord(vaultDir: string, name: string): CursorRecord | null {
  const p = cursorFile(vaultDir, name);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as CursorRecord;
    if (typeof parsed !== "object" || parsed === null) return null;
    return { ...parsed, cursor: parsed.cursor ?? null };
  } catch {
    // Unreadable is not "never fetched": returning null here would let a corrupt
    // file read as a brand-new channel. It reads as one anyway for want of any
    // other honest answer, but the cursor half stays fail-closed — `loadCursor`
    // returns null, so the adapter re-offers everything and the store's own
    // idempotency drops what is already there.
    return null;
  }
}

export function loadCursor(vaultDir: string, name: string): Cursor {
  return loadCursorRecord(vaultDir, name)?.cursor ?? null;
}

/** What a completed fetch delivered, which is the only thing that dates a channel. */
export interface FetchOutcome {
  /** The items that actually reached storage. Empty is meaningful, not missing. */
  delivered: readonly EvidenceItem[];
  /** Injected so the stamps are deterministic under test. */
  now?: Date;
}

/**
 * Persist a channel's cursor together with when it last fetched and last delivered.
 *
 * `outcome` is REQUIRED rather than optional, and that is the point: an optional
 * argument is one a call site can forget, and a forgotten one here means the
 * channel silently never dates itself and can never be reported silent. Making it
 * required puts the compiler in front of every call site.
 */
export function saveCursor(vaultDir: string, name: string, cursor: Cursor, outcome: FetchOutcome): void {
  const dir = stateDir(vaultDir);
  fs.mkdirSync(dir, { recursive: true });
  const previous = loadCursorRecord(vaultDir, name);
  const carried = {
    ...(previous?.lastItemAt ? { lastItemAt: previous.lastItemAt } : {}),
    ...(previous?.lastItemId ? { lastItemId: previous.lastItemId } : {}),
    ...(previous?.itemsDelivered ? { itemsDelivered: previous.itemsDelivered } : {}),
  };

  // The three-argument fallback that lived here is GONE: `ost_ingest_inbox` — the
  // one caller that predated `outcome` — now passes `{ delivered: stored }` for
  // every channel it reads. It recorded the cursor and nothing else, which was the
  // only honest answer for a caller that said nothing about its outcome, and an
  // `undated` channel is never reported silent. Keeping it would leave a way to
  // write a cursor that permanently disables silence detection for that channel.
  const delivered = outcome.delivered;
  const at = (outcome.now ?? new Date()).toISOString();
  const record: CursorRecord = {
    cursor,
    firstFetchedAt: previous?.firstFetchedAt ?? at,
    lastFetchedAt: at,
    ...(delivered.length > 0
      ? {
          lastItemAt: at,
          lastItemId: delivered[delivered.length - 1].id,
          itemsDelivered: (previous?.itemsDelivered ?? 0) + delivered.length,
        }
      : carried),
  };
  fs.writeFileSync(cursorFile(vaultDir, name), JSON.stringify(record, null, 2), "utf8");
}
