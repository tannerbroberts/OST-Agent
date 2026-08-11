/**
 * The standing Next Build briefing: one stable address, and rewrites that
 * preserve every prior reading.
 *
 * This is the instrument for the tree node "A standing Next Build node the
 * agent rewrites every pass". The node's own claim is that the history *is* the
 * record — so the spec here is exactly two invariants: the briefing resolves to
 * one address every pass can compute independently, and no rewrite ever loses a
 * reading that was there before it.
 *
 * What a green here does not settle, per the node: whether a builder actually
 * opens a different node because of the briefing (no spec sees a reader's
 * attention), and collision between two passes acting on one briefing (that is
 * `src/loop/claim.ts`, tested in `test/cli/claim.test.ts`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  NEXT_BUILD_FILENAME, nextBuildPath, readBriefing, rewriteBriefing,
} from "../../src/ost/briefing.js";

let vault: string;

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-briefing-"));
});
afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

describe("one stable address", () => {
  test("resolves to <vault>/.ost-agent/NEXT-BUILD.md, absolute", () => {
    const p = nextBuildPath(vault);
    expect(path.isAbsolute(p)).toBe(true);
    expect(p).toBe(path.join(vault, ".ost-agent", NEXT_BUILD_FILENAME));
  });

  test("two spellings of the same vault answer identically", () => {
    // A pass standing inside the vault and a pass pointing at it from outside
    // must land on the same file, or "stable address" is a fiction.
    const relative = path.relative(process.cwd(), vault);
    expect(nextBuildPath(relative)).toBe(nextBuildPath(vault));
  });

  test("a rewrite lands at exactly that address", () => {
    const written = rewriteBriefing(vault, { date: "2026-08-11", body: "Build the census reader first." });
    expect(written).toBe(nextBuildPath(vault));
    expect(fs.existsSync(written)).toBe(true);
  });
});

describe("a rewrite preserves the prior reading", () => {
  test("the superseded current becomes history, verbatim", () => {
    rewriteBriefing(vault, { date: "2026-08-10", body: "First reading: build A, because the gate on B is red." });
    rewriteBriefing(vault, { date: "2026-08-11", body: "Second reading: B's gate went green, build B." });

    const b = readBriefing(vault);
    expect(b.current).toEqual({ date: "2026-08-11", body: "Second reading: B's gate went green, build B." });
    expect(b.history).toEqual([{ date: "2026-08-10", body: "First reading: build A, because the gate on B is red." }]);
  });

  test("across many rewrites the file only ever grows: every reading survives, newest first", () => {
    const readings = ["one", "two", "three", "four"].map((n, i) => ({
      date: `2026-08-0${i + 1}`,
      body: `Reading ${n}: the highest-leverage build this pass, with why.`,
    }));
    for (const r of readings) rewriteBriefing(vault, r);

    const b = readBriefing(vault);
    expect(b.current).toEqual(readings[3]);
    expect(b.history).toEqual([readings[2], readings[1], readings[0]]);

    // The raw file carries all four, so the record survives any parser too.
    const raw = fs.readFileSync(nextBuildPath(vault), "utf8");
    for (const r of readings) expect(raw).toContain(r.body);
  });

  test("a briefing written before this format existed is kept whole, not clobbered", () => {
    // At least one live vault already holds a free-form NEXT-BUILD.md. The
    // first structured rewrite must fold ALL of it into history.
    const legacy = "# NEXT BUILD — hand-written\n\n_Last rewritten: 2026-08-03 (fiftieth pass)._\n\nRe-fetch both repos first.\n";
    fs.mkdirSync(path.join(vault, ".ost-agent"), { recursive: true });
    fs.writeFileSync(nextBuildPath(vault), legacy);

    rewriteBriefing(vault, { date: "2026-08-11", body: "First structured reading." });
    const b = readBriefing(vault);
    expect(b.current?.body).toBe("First structured reading.");
    expect(b.history).toHaveLength(1);
    expect(b.history[0].date).toBe("2026-08-03");
    expect(b.history[0].body).toBe(legacy.trim());
  });
});

describe("reading an empty or malformed state", () => {
  test("no briefing yet answers null current, empty history — not an error", () => {
    expect(readBriefing(vault)).toEqual({ current: null, history: [] });
  });

  test("refuses the values that destroy rather than inform, and writes nothing", () => {
    // Same tripwire as the vault write guard: exactly these strings, observed
    // destroying 21 annotation lines across two live vaults.
    for (const bad of ["", "   ", "undefined", "null", "Undefined"]) {
      expect(() => rewriteBriefing(vault, { date: "2026-08-11", body: bad })).toThrow(/refusing to write/i);
    }
    expect(fs.existsSync(nextBuildPath(vault))).toBe(false);
  });
});
