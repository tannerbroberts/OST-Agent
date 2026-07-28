import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { type FitnessRecord } from "../../src/harness/fitness.js";
import { harnessLogPath, readRuns, recordRun } from "../../src/harness/record.js";

const REC: FitnessRecord = {
  environment: "e",
  kind: "generated",
  seed: 1,
  status: "completed",
  fitness: 0.75,
  orientation: 0.5,
  quality: 1,
  explorationSpend: 1,
  costBasis: "tokens",
  weights: { orientation: 0.5, quality: 0.5 },
  resolvedCorrectly: 1,
  findable: 1,
  unattributedShare: 0,
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-harness-rec-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("recordRun", () => {
  test("appends a record the reader gets back intact", () => {
    recordRun(dir, REC);
    expect(readRuns(dir)).toEqual([REC]);
  });

  test("is append-only — a second write never replaces the first", () => {
    recordRun(dir, REC);
    recordRun(dir, { ...REC, seed: 2 });
    expect(readRuns(dir).map((r) => r.seed)).toEqual([1, 2]);
  });

  test("retains losers — a crashed and a zero-fitness run are both kept", () => {
    recordRun(dir, { ...REC, status: "crashed", fitness: 0 });
    recordRun(dir, { ...REC, fitness: 0 });
    expect(readRuns(dir)).toHaveLength(2);
  });

  test("lands under .ost-agent/harness/, not the dead .ost-agent/runs/", () => {
    recordRun(dir, REC);
    expect(harnessLogPath(dir)).toBe(path.join(dir, ".ost-agent", "harness", "runs.jsonl"));
    expect(fs.existsSync(path.join(dir, ".ost-agent", "harness", "runs.jsonl"))).toBe(true);
  });

  test("creates its directory lazily, like usage/ and attention/ do", () => {
    expect(fs.existsSync(path.join(dir, ".ost-agent", "harness"))).toBe(false);
    recordRun(dir, REC);
    expect(fs.existsSync(path.join(dir, ".ost-agent", "harness"))).toBe(true);
  });

  test("is fail-open: an unwritable path costs the record, never a throw", () => {
    fs.writeFileSync(path.join(dir, ".ost-agent"), "not a directory", "utf8");
    expect(() => recordRun(dir, REC)).not.toThrow();
  });
});

describe("readRuns", () => {
  test("a missing log reads as no runs", () => {
    expect(readRuns(dir)).toEqual([]);
  });

  test("skips a corrupt line rather than losing the whole log", () => {
    recordRun(dir, REC);
    fs.appendFileSync(harnessLogPath(dir), "{not json\n", "utf8");
    recordRun(dir, { ...REC, seed: 3 });
    expect(readRuns(dir).map((r) => r.seed)).toEqual([1, 3]);
  });
});
