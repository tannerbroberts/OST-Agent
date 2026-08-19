/**
 * The record "Does a stated denominator catch a drop nobody predicted" is
 * counted over.
 *
 * The denominator itself shipped in v0.22.0: every `check` and `status` firing
 * already computes drops, unreadable files and a git discrepancy, then prints
 * them and throws the result away. The assumption test needs a human to read
 * the last several firings side by side and judge whether an unanticipated
 * drop showed up, whether it named a file specific enough to act on, and
 * whether it was ignored for two or more firings running — none of which is
 * answerable from a single run's stdout once the next invocation has
 * overwritten the terminal. This file is the record that makes that judgement
 * possible: it does not, and cannot, make the judgement itself.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  censusHistoryPath,
  isNonEmptyCensus,
  MAX_CENSUS_FIRINGS,
  readCensusHistory,
  recordCensusFiring,
  type CensusFiring,
} from "../../src/ost/census.js";
import type { TreeCensus } from "../../src/ost/census.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-census-history-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const cleanCensus = (): TreeCensus => ({
  nodes: [],
  examined: 3,
  seenFiles: ["Alpha.md", "Beta.md", "Gamma.md"],
  skipped: [],
  unreadable: [],
  retired: [],
});

const droppedCensus = (): TreeCensus => ({
  nodes: [],
  examined: 4,
  seenFiles: ["Alpha.md", "Beta.md", "Gamma.md", "Stray.md"],
  skipped: [{ file: "Stray.md", reason: 'unrecognised type "Opportunties"' }],
  unreadable: [],
  retired: [],
});

describe("isNonEmptyCensus — the same question the assumption test's threshold asks", () => {
  test("a clean census is empty", () => {
    expect(isNonEmptyCensus(cleanCensus())).toBe(false);
  });

  test("a skipped file makes it non-empty", () => {
    expect(isNonEmptyCensus(droppedCensus())).toBe(true);
  });

  test("an unreadable file makes it non-empty", () => {
    const census = { ...cleanCensus(), unreadable: [{ file: "Broken.md", reason: "frontmatter did not parse" }] };
    expect(isNonEmptyCensus(census)).toBe(true);
  });

  test("a git discrepancy makes it non-empty, even with nothing skipped or unreadable", () => {
    const census: TreeCensus = {
      ...cleanCensus(),
      independent: { source: "git", tracked: 4, unseenByWalk: ["Em—Dash.md"] },
    };
    expect(isNonEmptyCensus(census)).toBe(true);
  });

  test("an independent source that agrees with the walk stays empty", () => {
    const census: TreeCensus = {
      ...cleanCensus(),
      independent: { source: "git", tracked: 3, unseenByWalk: [] },
    };
    expect(isNonEmptyCensus(census)).toBe(false);
  });
});

describe("recordCensusFiring + readCensusHistory — the per-firing record", () => {
  test("readCensusHistory returns nothing before any firing was recorded", () => {
    expect(readCensusHistory(dir)).toEqual([]);
  });

  test("a recorded firing names the dropped file specific enough to act on", () => {
    recordCensusFiring(dir, "check", droppedCensus(), "2026-08-05T00:00:00.000Z");

    const history = readCensusHistory(dir);
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual<CensusFiring>({
      ts: "2026-08-05T00:00:00.000Z",
      command: "check",
      examined: 4,
      skipped: [{ file: "Stray.md", reason: 'unrecognised type "Opportunties"' }],
      unreadable: [],
      unseenByWalk: [],
    });
  });

  test("clean firings are recorded too, not only the non-empty ones", () => {
    // The threshold reads "zero non-empty census lines across 10 firings" as a
    // fact about the run, not as an absence of any record — that judgement is
    // impossible unless the clean firings are on the tape as well.
    recordCensusFiring(dir, "status", cleanCensus(), "2026-08-05T00:00:00.000Z");

    const history = readCensusHistory(dir);
    expect(history).toHaveLength(1);
    expect(history[0]!.skipped).toEqual([]);
    expect(history[0]!.unreadable).toEqual([]);
    expect(history[0]!.unseenByWalk).toEqual([]);
  });

  test("both check and status firings land in the same history, in order", () => {
    recordCensusFiring(dir, "check", cleanCensus(), "2026-08-05T00:00:00.000Z");
    recordCensusFiring(dir, "status", droppedCensus(), "2026-08-05T01:00:00.000Z");

    const history = readCensusHistory(dir);
    expect(history.map((f) => f.command)).toEqual(["check", "status"]);
    expect(history.map((f) => f.ts)).toEqual(["2026-08-05T00:00:00.000Z", "2026-08-05T01:00:00.000Z"]);
  });

  test(`keeps only the last ${MAX_CENSUS_FIRINGS} firings — the window the assumption test's threshold reads over`, () => {
    const total = MAX_CENSUS_FIRINGS + 3;
    for (let i = 0; i < total; i++) {
      recordCensusFiring(dir, "check", cleanCensus(), `firing-${i}`);
    }

    const history = readCensusHistory(dir);
    expect(history).toHaveLength(MAX_CENSUS_FIRINGS);
    // The oldest three fell off the front; the tape kept the most recent window.
    expect(history[0]!.ts).toBe(`firing-${total - MAX_CENSUS_FIRINGS}`);
    expect(history[history.length - 1]!.ts).toBe(`firing-${total - 1}`);
  });

  test("a torn final line is dropped, never the read — the same rule the usage trace follows", () => {
    recordCensusFiring(dir, "check", cleanCensus(), "2026-08-05T00:00:00.000Z");
    fs.appendFileSync(censusHistoryPath(dir), '{"ts":"2026-08-05T01:00:00.000Z","command":"check"', "utf8");

    const history = readCensusHistory(dir);
    expect(history).toHaveLength(1);
    expect(history[0]!.ts).toBe("2026-08-05T00:00:00.000Z");
  });

  test("recording never throws even when the vault directory cannot hold it", () => {
    // A regular file where the sidecar directory needs to be — mkdirSync fails,
    // and this is telemetry about the census, not the census itself: a write
    // failure here must cost a history entry, not the command that fired it.
    fs.writeFileSync(path.join(dir, ".ost-agent"), "not a directory\n", "utf8");

    expect(() => recordCensusFiring(dir, "check", droppedCensus(), "2026-08-05T00:00:00.000Z")).not.toThrow();
    expect(readCensusHistory(dir)).toEqual([]);
  });
});
