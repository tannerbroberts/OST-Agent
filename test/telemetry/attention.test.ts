import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  addTiers, attentionLogPath, emptyTiers, readAttention, recordAttention,
} from "../../src/telemetry/attention.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ost-attention-"));

describe("the attention ledger", () => {
  test("appends entries and reads them back in order", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "2026-07-27T00:00:00Z", unknown: "U", kind: "spend", calls: 1, ms: 10 });
    recordAttention(dir, { ts: "2026-07-27T00:01:00Z", unknown: "U", kind: "resolution", state: "satisfied" });
    const entries = readAttention(dir, "U");
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe("spend");
    expect(entries[1].state).toBe("satisfied");
  });

  test("never overwrites — a second write to the same unknown grows the log", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "U", kind: "spend", calls: 1 });
    recordAttention(dir, { ts: "b", unknown: "U", kind: "spend", calls: 1 });
    expect(readAttention(dir, "U")).toHaveLength(2);
  });

  test("keeps separate unknowns in separate logs", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "First", kind: "spend", calls: 1 });
    recordAttention(dir, { ts: "b", unknown: "Second", kind: "spend", calls: 1 });
    expect(readAttention(dir, "First")).toHaveLength(1);
    expect(readAttention(dir, "Second")).toHaveLength(1);
  });

  test("a title with path characters cannot escape the attention directory", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "../../etc/passwd", kind: "spend", calls: 1 });
    const resolved = path.resolve(attentionLogPath(dir, "../../etc/passwd"));
    expect(resolved.startsWith(path.resolve(dir, ".ost-agent", "attention"))).toBe(true);
  });

  test("reading an unknown with no ledger yields nothing rather than throwing", () => {
    expect(readAttention(tmp(), "never recorded")).toEqual([]);
  });

  test("a corrupt line is skipped, not fatal — a bad byte must not hide the rest", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "U", kind: "spend", calls: 1 });
    fs.appendFileSync(attentionLogPath(dir, "U"), "{not json\n", "utf8");
    recordAttention(dir, { ts: "c", unknown: "U", kind: "spend", calls: 1 });
    expect(readAttention(dir, "U")).toHaveLength(2);
  });

  test("an unwritable vault costs an event, never a throw", () => {
    expect(() => recordAttention("/proc/nonexistent-ost", { ts: "a", unknown: "U", kind: "spend" })).not.toThrow();
  });
});

describe("token tiers", () => {
  test("stay unmixed when added", () => {
    const sum = addTiers(
      { input: 1, output: 2, cacheCreate: 3, cacheRead: 4 },
      { input: 10, output: 20, cacheCreate: 30, cacheRead: 40 },
    );
    expect(sum).toEqual({ input: 11, output: 22, cacheCreate: 33, cacheRead: 44 });
  });

  test("empty is all zeroes", () => {
    expect(emptyTiers()).toEqual({ input: 0, output: 0, cacheCreate: 0, cacheRead: 0 });
  });
});
