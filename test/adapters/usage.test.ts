import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { UsageSource } from "../../src/adapters/usage.js";
import type { UsageEvent } from "../../src/telemetry/usage.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-usage-src-"));
  file = path.join(dir, "events.jsonl");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeEvents(events: Partial<UsageEvent>[]): void {
  fs.writeFileSync(
    file,
    events
      .map((e) =>
        JSON.stringify({ ok: true, ms: 10, surface: "cli-tool", argBytes: 10, tool: "ost_annotate", ts: "2026-07-23T10:00:00.000Z", ...e }),
      )
      .join("\n") + "\n",
    "utf8",
  );
}

const TODAY = "2026-07-25";
const source = (minEvents = 2) => new UsageSource({ file, minEvents, today: () => TODAY });

describe("UsageSource", () => {
  test("emits one rollup item per finished day with enough events", async () => {
    writeEvents([
      { ts: "2026-07-23T10:00:00.000Z", tool: "ost_create_node" },
      { ts: "2026-07-23T10:00:01.000Z", tool: "ost_create_node" },
      { ts: "2026-07-23T10:00:02.000Z", tool: "ost_annotate", ok: false, err: "no such node" },
      { ts: "2026-07-24T09:00:00.000Z", tool: "ost_read_tree" },
      { ts: "2026-07-24T09:00:01.000Z", tool: "ost_read_tree", surface: "mcp" },
    ]);

    const { items, cursor } = await source().fetchSince(null);

    expect(items.map((i) => i.id)).toEqual(["USAGE:2026-07-23", "USAGE:2026-07-24"]);
    expect(cursor).toBe("2026-07-24");
    const first = items[0];
    expect(first.title).toContain("3 calls");
    expect(first.title).toContain("1 failed");
    expect(first.body).toContain("| ost_create_node | 2 |");
    expect(first.body).toContain("no such node");
    expect(first.body).toContain("observed behavior");
  });

  test("never emits the current (unfinished) day", async () => {
    writeEvents([
      { ts: `${TODAY}T08:00:00.000Z` },
      { ts: `${TODAY}T08:00:01.000Z` },
      { ts: `${TODAY}T08:00:02.000Z` },
    ]);

    const { items, cursor } = await source().fetchSince(null);
    expect(items).toEqual([]);
    expect(cursor).toBeNull();
  });

  test("cursor prevents re-emission and quiet days advance it silently", async () => {
    writeEvents([
      { ts: "2026-07-22T10:00:00.000Z" },
      { ts: "2026-07-22T10:00:01.000Z" },
      { ts: "2026-07-23T10:00:00.000Z" }, // below minEvents: dropped, but the day still advances the cursor
    ]);

    const first = await source().fetchSince(null);
    expect(first.items.map((i) => i.id)).toEqual(["USAGE:2026-07-22"]);
    expect(first.cursor).toBe("2026-07-23");

    const second = await source().fetchSince(first.cursor);
    expect(second.items).toEqual([]);
    expect(second.cursor).toBe("2026-07-23");
  });

  test("survives a torn/corrupt trailing line", async () => {
    writeEvents([
      { ts: "2026-07-23T10:00:00.000Z" },
      { ts: "2026-07-23T10:00:01.000Z" },
    ]);
    fs.appendFileSync(file, '{"ts":"2026-07-23T10:00:02.000Z","tool":"ost_ann', "utf8"); // torn write

    const { items } = await source().fetchSince(null);
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("2 calls");
  });

  test("missing log file means no items, same cursor", async () => {
    const { items, cursor } = await source().fetchSince("2026-07-20");
    expect(items).toEqual([]);
    expect(cursor).toBe("2026-07-20");
  });
});
