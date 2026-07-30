/**
 * Inbox adapter — a zero-credential local drop-folder, one instance per channel.
 *
 * The user (or any script) drops `*.md` / `*.txt` files into the folder; each new
 * file becomes an evidence item. The adapter is strictly read-only: it never
 * modifies or deletes drop-folder files. Its cursor is the JSON list of file ids it
 * has already emitted, so re-runs never re-ingest the same note.
 *
 * The channel it serves is a REQUIRED constructor argument with no positional
 * overload, because that argument is both the cursor filename and the id namespace:
 * a call site that could omit it would silently get channel zero and share the
 * legacy cursor, which is S3's bug exactly. Requiring it makes the compiler
 * enumerate every call site.
 */
import fs from "node:fs";
import path from "node:path";
import { channelIdPrefix } from "./channels.js";
import type { Actor, Cursor, EvidenceItem, FetchResult, Source } from "./source.js";

const TEXT_EXT = new Set([".md", ".txt", ".markdown"]);

export interface InboxSourceOptions {
  /** The folder to read. Already resolved by `resolveChannels`. */
  dir: string;
  /** Which channel this instance IS — its cursor file and its id namespace. */
  channel: string;
}

export class InboxSource implements Source {
  /** The cursor filename under `.ost-agent/state/`. One per channel, never shared. */
  readonly name: string;
  /**
   * Every drop folder is `inbox`, however many there are — including the agent's own
   * friction filings. That is the honest answer rather than a lost distinction: a
   * folder is writable by anyone who can write that mount, so any finer-grained
   * claim about *which* producer wrote a given file would be read off a name the
   * producer chose. What the channel buys instead is a segment of the id the writer
   * cannot forge, stamped here from config rather than parsed out of a filename.
   */
  readonly actor: Actor = "inbox";
  private readonly dir: string;
  private readonly prefix: string;

  constructor(options: InboxSourceOptions) {
    // The positional-string fallback that lived here is GONE, together with the last
    // `new InboxSource(dir)` in `src/`. It existed so legacy call sites kept working
    // while the compiler enumerated them, and it silently mapped an un-migrated call
    // to channel zero — which, once a vault has two drop folders, is a second channel
    // quietly consuming the first's cursor. A shim that outlives its reason is
    // indistinguishable from a feature.
    this.name = options.channel;
    this.prefix = channelIdPrefix(options.channel);
    this.dir = path.resolve(options.dir);
  }

  async fetchSince(cursor: Cursor): Promise<FetchResult> {
    const seen = new Set<string>(decodeSeen(cursor));

    if (!fs.existsSync(this.dir)) {
      return { items: [], cursor };
    }

    const entries = fs
      .readdirSync(this.dir, { withFileTypes: true })
      .filter((e) => e.isFile() && TEXT_EXT.has(path.extname(e.name).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));

    const items = [];
    for (const e of entries) {
      const id = `${this.prefix}${e.name}`;
      if (seen.has(id)) continue;
      const full = path.join(this.dir, e.name);
      const stat = fs.statSync(full);
      items.push({
        id,
        source: id,
        title: e.name.replace(/\.(md|txt|markdown)$/i, ""),
        body: fs.readFileSync(full, "utf8"),
        timestamp: stat.mtime.toISOString(),
      });
      seen.add(id);
    }

    return { items, cursor: encodeSeen([...seen]) };
  }

  /**
   * Exact, because this cursor is a set of ids rather than a watermark: the ids that
   * were already seen, plus the ids that were actually stored. An item that failed to
   * store is absent, so the next `fetchSince` offers it again.
   */
  advanceCursor(previous: Cursor, stored: EvidenceItem[]): Cursor {
    return encodeSeen([...new Set([...decodeSeen(previous), ...stored.map((i) => i.id)])]);
  }
}

function decodeSeen(cursor: Cursor): string[] {
  if (!cursor) return [];
  try {
    const parsed = JSON.parse(cursor);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function encodeSeen(seen: string[]): string {
  return JSON.stringify(seen);
}
