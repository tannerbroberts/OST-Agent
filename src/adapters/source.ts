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
  /** Return items new since `cursor`, plus the advanced cursor. Read-only. */
  fetchSince(cursor: Cursor): Promise<FetchResult>;
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
