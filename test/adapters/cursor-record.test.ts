/**
 * The cursor state file gained timestamps (S2). The thing that must not happen is
 * an upgraded vault reading its own history wrong — so the shape is a superset, and
 * the file every shipped version wrote still loads to the same cursor.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadCursor, loadCursorRecord, saveCursor, type Cursor } from "../../src/adapters/source.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cursor-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const stateFile = (name: string) => path.join(dir, ".ost-agent", "state", `${name}.json`);
const item = (id: string) => ({ id, source: id, title: id, body: "b", timestamp: "2026-01-01T00:00:00.000Z" });

describe("loadCursor over a file written before timestamps existed", () => {
  test("reads the same cursor it always did", () => {
    fs.mkdirSync(path.dirname(stateFile("inbox")), { recursive: true });
    fs.writeFileSync(stateFile("inbox"), JSON.stringify({ cursor: '["INBOX:a.md"]' }), "utf8");
    expect(loadCursor(dir, "inbox")).toBe('["INBOX:a.md"]');
    expect(loadCursorRecord(dir, "inbox")).toEqual({ cursor: '["INBOX:a.md"]' });
    // Non-vacuity: a different cursor in the same file comes back different, so
    // the read is not returning a constant.
    fs.writeFileSync(stateFile("inbox"), JSON.stringify({ cursor: "[]" }), "utf8");
    expect(loadCursor(dir, "inbox")).toBe("[]");
  });

  test("an unreadable file is null rather than a crash — the adapter re-offers everything", () => {
    fs.mkdirSync(path.dirname(stateFile("inbox")), { recursive: true });
    fs.writeFileSync(stateFile("inbox"), "{not json", "utf8");
    expect(loadCursor(dir, "inbox")).toBeNull();
  });
});

describe("saveCursor records fetches and deliveries separately", () => {
  test("a fetch that delivered nothing advances lastFetchedAt and nothing else", () => {
    const t0 = new Date("2026-07-01T00:00:00.000Z");
    const t1 = new Date("2026-07-02T00:00:00.000Z");
    saveCursor(dir, "inbox", "c0", { delivered: [item("INBOX:a.md")], now: t0 });
    saveCursor(dir, "inbox", "c1", { delivered: [], now: t1 });

    const rec = loadCursorRecord(dir, "inbox");
    expect(rec?.cursor).toBe("c1");
    expect(rec?.firstFetchedAt).toBe(t0.toISOString());
    expect(rec?.lastFetchedAt).toBe(t1.toISOString());
    // The whole point: the empty fetch did NOT move the delivery stamp.
    expect(rec?.lastItemAt).toBe(t0.toISOString());
    expect(rec?.itemsDelivered).toBe(1);

    // Non-vacuity: a fetch that DID deliver moves it, so the field is live.
    saveCursor(dir, "inbox", "c2", { delivered: [item("INBOX:b.md")], now: t1 });
    const after = loadCursorRecord(dir, "inbox");
    expect(after?.lastItemAt).toBe(t1.toISOString());
    expect(after?.lastItemId).toBe("INBOX:b.md");
    expect(after?.itemsDelivered).toBe(2);
  });

  test("firstFetchedAt is set once and never moved", () => {
    const t0 = new Date("2026-07-01T00:00:00.000Z");
    saveCursor(dir, "inbox", "c", { delivered: [], now: t0 });
    saveCursor(dir, "inbox", "c", { delivered: [], now: new Date("2026-07-09T00:00:00.000Z") });
    expect(loadCursorRecord(dir, "inbox")?.firstFetchedAt).toBe(t0.toISOString());
  });

  /**
   * The stamp is the ingesting surface's clock, never the item's own timestamp: a
   * file mtime is producer-controlled, so `touch -d 2030` would otherwise let a
   * channel declare its own liveness.
   */
  test("the stamp comes from the surface, not from the item", () => {
    const now = new Date("2026-07-01T00:00:00.000Z");
    saveCursor(dir, "inbox", "c", {
      delivered: [{ ...item("INBOX:a.md"), timestamp: "2030-01-01T00:00:00.000Z" }],
      now,
    });
    expect(loadCursorRecord(dir, "inbox")?.lastItemAt).toBe(now.toISOString());
  });

  /**
   * The transitional three-argument shim is gone, and this is what replaced it.
   *
   * THE WEDGE it existed for: `outcome` is the only writer of `lastItemAt`, so a
   * three-argument call that stamped `lastFetchedAt` would date a channel that can
   * never date a delivery. `channelHealth` reads that as `never-delivered`, and the
   * moment the declared cadence elapses it reads `silent` — permanently, no matter
   * how many notes the channel really delivers, because nothing the operator or the
   * producer does can write the stamp that would clear it.
   *
   * With every call site migrated, the shim is a remaining *way to reach that
   * state*: a caller that omits the argument now fails at the call rather than
   * writing a cursor that quietly disables silence detection for its channel.
   */
  test("a call that does not report its outcome is refused, not silently accepted", () => {
    const legacy = saveCursor as unknown as (d: string, n: string, c: Cursor) => void;
    expect(() => legacy(dir, "inbox", "c0")).toThrow();
    // Nothing was written: a refused call must not leave a half-record behind that a
    // later read would take for a real fetch.
    expect(loadCursorRecord(dir, "inbox")).toBeNull();

    // Non-vacuity: the same call WITH an outcome writes, so the throw is about the
    // missing argument and not about the channel, the directory or the cursor value.
    const t0 = new Date("2026-07-01T00:00:00.000Z");
    saveCursor(dir, "inbox", "c0", { delivered: [item("INBOX:a.md")], now: t0 });
    expect(loadCursorRecord(dir, "inbox")?.lastItemAt).toBe(t0.toISOString());
  });

  test("a cursor name that could escape the state directory is refused", () => {
    // The name is a filename; `..` in it is a write outside `.ost-agent/state/`.
    expect(() => saveCursor(dir, "../../pwned", null, { delivered: [] })).toThrow(/channel name|cursor name/);
    expect(() => loadCursor(dir, "Inbox")).toThrow(/channel name|cursor name/);
    // Non-vacuity: every name the shipped adapters actually use is accepted.
    for (const name of ["inbox", "usage", "transcript", "atlassian", "slack", "friction"]) {
      expect(() => saveCursor(dir, name, null, { delivered: [] })).not.toThrow();
    }
  });
});
