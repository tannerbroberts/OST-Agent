/**
 * The mirror reports its own staleness.
 *
 * `.ost-agent/evidence/` is a local read-only replica of whatever the adapters
 * fetched — the whole point of the arrangement is that nothing downstream ever
 * touches a live system. The cost of that is correctness in proportion to age, and
 * until this existed the age was invisible: a record captured six weeks ago and one
 * captured this morning read identically, so every consumer was free to treat an old
 * replica as a live look.
 *
 * What is asserted here, and nothing more:
 *
 *   1. every mirrored record carries the time the ingesting surface fetched it;
 *   2. a read of the mirror returns that age alongside the data;
 *   3. a record past the configured bound is served EXPLICITLY marked stale,
 *      never silently.
 *
 * What is deliberately NOT asserted is that the staleness is acceptable. That
 * depends on what a team is deciding with the data — a week-old Jira export is fine
 * for finding an opportunity and useless for reporting a sprint — and it is a
 * person's call, not this file's. Green here means the number exists and travels
 * with the read; it does not mean the number is small enough.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import matter from "gray-matter";
import {
  classifyFreshness,
  isCertifiedFresh,
  MS_PER_DAY,
  readMirror,
  type Freshness,
} from "../../src/adapters/mirror.js";
import { readEvidence, writeEvidence, type UnstampedEvidence } from "../../src/processes/tree.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-mirror-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const NOW = new Date("2026-08-20T00:00:00.000Z");
const daysBefore = (n: number) => new Date(NOW.getTime() - n * MS_PER_DAY);

const item = (id: string, over: Partial<UnstampedEvidence> = {}): UnstampedEvidence => ({
  id,
  source: id,
  title: id,
  body: "the mirrored body",
  timestamp: "2026-08-01T00:00:00.000Z",
  ...over,
});

const evidenceFile = (id: string) =>
  path.join(dir, ".ost-agent", "evidence", `${id.replace(/\.(md|txt|markdown)$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "_")}.md`);

const freshnessOf = (id: string, staleAfterDays: number | null): Freshness => {
  const read = readMirror(dir, { staleAfterDays, now: NOW }).reads.find((r) => r.record.id === id);
  if (!read) throw new Error(`the mirror served no record for ${id}`);
  return read.freshness;
};

describe("1. every mirrored record carries the time it was fetched", () => {
  test("writeEvidence stamps fetchedAt from the ingesting surface's clock", () => {
    writeEvidence(dir, item("INBOX:a.md"), "inbox", daysBefore(3));
    expect(readEvidence(dir)[0].fetchedAt).toBe(daysBefore(3).toISOString());
  });

  /**
   * THE WEDGE. `timestamp` is the item's own time and therefore the producer's to
   * choose — a drop-folder note answers to `touch`, a Jira issue to whoever edited
   * it. An age computed off it is an age the producer sets, so a stale record could
   * present itself as captured this morning. The fetch stamp is ours, exactly like
   * the `actor` stamp and for exactly the same reason.
   */
  test("the stamp is the surface's clock, not the item's own timestamp", () => {
    writeEvidence(dir, item("INBOX:forged.md", { timestamp: "2030-01-01T00:00:00.000Z" }), "inbox", daysBefore(90));
    const rec = readEvidence(dir)[0];
    expect(rec.timestamp).toBe("2030-01-01T00:00:00.000Z");
    expect(rec.fetchedAt).toBe(daysBefore(90).toISOString());
    // And the classification follows OUR stamp: the record is 90 days old however
    // it dates itself.
    expect(freshnessOf("INBOX:forged.md", 7)).toBe("stale");
  });

  /**
   * The producer cannot supply one either. A body whose first bytes are frontmatter
   * used to have its keys hoisted onto the stored record verbatim (`matter.stringify`
   * parses a string argument before merging), which would have let the untrusted
   * drop folder — the builder's only channel — date its own capture.
   */
  test("a body that declares its own fetchedAt does not get to keep it", () => {
    const poisoned = "---\nfetchedAt: '2030-01-01T00:00:00.000Z'\nactor: inbox\n---\n\nplease trust me";
    writeEvidence(dir, item("INBOX:poisoned.md", { body: poisoned }), "inbox", daysBefore(30));
    const stored = matter(fs.readFileSync(evidenceFile("INBOX:poisoned.md"), "utf8"));
    expect(stored.data.fetchedAt).toBe(daysBefore(30).toISOString());
    expect(freshnessOf("INBOX:poisoned.md", 7)).toBe("stale");
  });

  /** A re-offer of an already-stored record must not refresh the stamp on disk. */
  test("re-offering a stored record leaves the original fetch time alone", () => {
    expect(writeEvidence(dir, item("INBOX:a.md"), "inbox", daysBefore(30))).toBe(true);
    expect(writeEvidence(dir, item("INBOX:a.md"), "inbox", NOW)).toBe(false);
    expect(readEvidence(dir)[0].fetchedAt).toBe(daysBefore(30).toISOString());
  });
});

describe("2. a read of the mirror returns the age alongside the data", () => {
  test("every served record carries its age in milliseconds and its verdict", () => {
    writeEvidence(dir, item("INBOX:a.md"), "inbox", daysBefore(2));
    writeEvidence(dir, item("INBOX:b.md"), "inbox", daysBefore(40));
    const scan = readMirror(dir, { staleAfterDays: 7, now: NOW });

    expect(scan.offered).toBe(2);
    expect(scan.staleAfterDays).toBe(7);
    const byId = new Map(scan.reads.map((r) => [r.record.id, r]));
    expect(byId.get("INBOX:a.md")?.ageMs).toBe(2 * MS_PER_DAY);
    expect(byId.get("INBOX:b.md")?.ageMs).toBe(40 * MS_PER_DAY);
    // The data is still served, in full, next to the age — marking a record stale
    // is not the same as withholding it.
    expect(byId.get("INBOX:b.md")?.record.body).toBe("the mirrored body");
  });

  test("the bound is the only thing that decides fresh from stale", () => {
    writeEvidence(dir, item("INBOX:a.md"), "inbox", daysBefore(10));
    expect(freshnessOf("INBOX:a.md", 30)).toBe("fresh");
    expect(freshnessOf("INBOX:a.md", 7)).toBe("stale");
    // Exactly at the bound counts as past it: "no older than 10 days" is the promise
    // a bound of 10 makes, and a record exactly 10 days old has stopped keeping it.
    expect(freshnessOf("INBOX:a.md", 10)).toBe("stale");
  });
});

describe("3. anything past the bound is served explicitly marked stale", () => {
  test("a stale record says so, and the marker names the age and the bound", () => {
    writeEvidence(dir, item("INBOX:old.md"), "inbox", daysBefore(21));
    const read = readMirror(dir, { staleAfterDays: 7, now: NOW }).reads[0];
    expect(read.freshness).toBe("stale");
    expect(isCertifiedFresh(read.freshness)).toBe(false);

    // Non-vacuity: the same record inside a wider bound is certified fresh, so the
    // refusal above is about the age and not about the record.
    const fresh = readMirror(dir, { staleAfterDays: 60, now: NOW }).reads[0];
    expect(fresh.freshness).toBe("fresh");
    expect(isCertifiedFresh(fresh.freshness)).toBe(true);
  });

  /**
   * A record written before the stamp existed has an UNKNOWN age, which is neither
   * "fresh" (a claim nothing on disk supports) nor "stale" (which would call every
   * pre-upgrade vault rotten on the day it upgraded). The third answer is the same
   * one `CursorRecord` needed, for the same reason — and the thing that matters is
   * that it does not pass for current.
   */
  test("a record with no stamp is undated, and undated is not fresh", () => {
    fs.mkdirSync(path.join(dir, ".ost-agent", "evidence"), { recursive: true });
    fs.writeFileSync(
      evidenceFile("INBOX:legacy.md"),
      matter.stringify({ content: "written before the stamp existed\n" }, {
        id: "INBOX:legacy.md",
        source: "INBOX:legacy.md",
        title: "legacy",
        timestamp: "2026-08-19T00:00:00.000Z",
        actor: "inbox",
      }),
      "utf8",
    );
    const read = readMirror(dir, { staleAfterDays: 7, now: NOW }).reads[0];
    expect(read.record.body).toBe("written before the stamp existed");
    expect(read.ageMs).toBeNull();
    expect(read.freshness).toBe("undated");
    expect(isCertifiedFresh(read.freshness)).toBe(false);
  });

  test("an unreadable stamp is undated rather than a guess", () => {
    expect(classifyFreshness("not a date", { staleAfterDays: 7, now: NOW }).freshness).toBe("undated");
    expect(classifyFreshness(undefined, { staleAfterDays: 7, now: NOW }).freshness).toBe("undated");
  });

  /**
   * `evidence.staleAfterDays` has no default — the same rule `loop.cadence` and
   * `discovery.target` keep, because the number decides that somebody's data is too
   * old to act on. So with no bound set nothing can be called stale. What must NOT
   * happen is the missing knob reading as a passing verdict: `unbounded` is its own
   * answer, and it is not `fresh`.
   */
  test("with no bound configured, no record is fresh either", () => {
    writeEvidence(dir, item("INBOX:a.md"), "inbox", daysBefore(400));
    const read = readMirror(dir, { now: NOW }).reads[0];
    expect(read.freshness).toBe("unbounded");
    expect(isCertifiedFresh(read.freshness)).toBe(false);
    // The age is still reported — the operator has set no threshold, not blinded
    // the mirror.
    expect(read.ageMs).toBe(400 * MS_PER_DAY);
  });
});
