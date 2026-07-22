/**
 * Inbox adapter — a zero-credential local drop-folder.
 *
 * The user (or any script) drops `*.md` / `*.txt` files into `inbox/`; each new
 * file becomes an evidence item. The adapter is strictly read-only: it never
 * modifies or deletes inbox files. Its cursor is the JSON list of file ids it has
 * already emitted, so re-runs never re-ingest the same note.
 */
import fs from "node:fs";
import path from "node:path";
import type { Cursor, FetchResult, Source } from "./source.js";

const TEXT_EXT = new Set([".md", ".txt", ".markdown"]);

export class InboxSource implements Source {
  readonly name = "inbox";
  private readonly dir: string;

  constructor(inboxDir: string) {
    this.dir = path.resolve(inboxDir);
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
      const id = `INBOX:${e.name}`;
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
