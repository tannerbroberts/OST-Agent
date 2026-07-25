import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { failed, lastFailedRun, lastRunPerProcess, readRunJournals } from "../../src/runner/journal.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-journal-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeJournal(name: string, entry: object): void {
  const runs = path.join(dir, ".ost-agent", "runs");
  fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(path.join(runs, name), JSON.stringify(entry), "utf8");
}

describe("the alert rule the replay validated: a non-null error means the run failed", () => {
  test("an error string marks the run failed", () => {
    expect(failed({ file: "a.json", processId: "P2_map", at: "2026-07-25T02:00:38Z", error: "auth failed" })).toBe(true);
  });

  test("null, absent, and empty errors are all healthy — a healthy run is never misclassified", () => {
    expect(failed({ file: "a.json", processId: "P2_map", at: "2026-07-25T02:00:38Z", error: null })).toBe(false);
    expect(failed({ file: "a.json", processId: "P2_map", at: "2026-07-25T02:00:38Z", error: "" })).toBe(false);
  });
});

describe("readRunJournals", () => {
  test("returns entries newest-first", () => {
    writeJournal("1.json", { processId: "P1_ingest", at: "2026-07-25T01:00:00Z", error: null });
    writeJournal("2.json", { processId: "P2_map", at: "2026-07-25T03:00:00Z", error: null });
    writeJournal("3.json", { processId: "P3_ideate", at: "2026-07-25T02:00:00Z", error: null });

    expect(readRunJournals(dir).map((e) => e.processId)).toEqual(["P2_map", "P3_ideate", "P1_ingest"]);
  });

  test("skips unreadable journals instead of throwing — one corrupt file cannot blind the operator", () => {
    writeJournal("ok.json", { processId: "P1_ingest", at: "2026-07-25T01:00:00Z", error: null });
    fs.writeFileSync(path.join(dir, ".ost-agent", "runs", "corrupt.json"), "{not json", "utf8");
    fs.writeFileSync(path.join(dir, ".ost-agent", "runs", "notes.txt"), "ignored", "utf8");

    expect(readRunJournals(dir).map((e) => e.processId)).toEqual(["P1_ingest"]);
  });

  test("a vault that has never run reports no journals rather than failing", () => {
    expect(readRunJournals(dir)).toEqual([]);
  });
});

describe("lastFailedRun", () => {
  test("finds the most recent failure, not the first one written", () => {
    writeJournal("1.json", { processId: "P2_map", at: "2026-07-24T02:00:00Z", error: "old auth failure" });
    writeJournal("2.json", { processId: "P3_ideate", at: "2026-07-25T02:00:00Z", error: "fresh driver failure" });
    writeJournal("3.json", { processId: "P1_ingest", at: "2026-07-25T03:00:00Z", error: null });

    expect(lastFailedRun(readRunJournals(dir))).toMatchObject({ processId: "P3_ideate", error: "fresh driver failure" });
  });

  test("is undefined when every recorded run is healthy", () => {
    writeJournal("1.json", { processId: "P1_ingest", at: "2026-07-25T01:00:00Z", error: null });
    expect(lastFailedRun(readRunJournals(dir))).toBeUndefined();
  });
});

describe("lastRunPerProcess", () => {
  test("keeps only the newest run of each process, ordered by process id", () => {
    writeJournal("1.json", { processId: "P2_map", at: "2026-07-25T01:00:00Z", error: "stale failure" });
    writeJournal("2.json", { processId: "P2_map", at: "2026-07-25T04:00:00Z", error: null });
    writeJournal("3.json", { processId: "P1_ingest", at: "2026-07-25T02:00:00Z", error: null });

    const last = lastRunPerProcess(readRunJournals(dir));
    expect(last.map((e) => e.processId)).toEqual(["P1_ingest", "P2_map"]);
    expect(last.find((e) => e.processId === "P2_map")?.error).toBeNull();
  });
});
