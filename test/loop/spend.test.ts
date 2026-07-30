/**
 * The spend ceiling (F3) — no default grant, and no reading of the developer's
 * real account.
 *
 * `measureFiring` takes its transcript directory as an argument and derives
 * nothing: a version that fell back to `os.homedir()` would, in this file, read
 * whoever is running the suite. Every test here points it at a `mkdtemp` dir.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkCeiling, measureFiring, type SpendCeiling } from "../../src/loop/spend.js";

const HOUR = 60 * 60 * 1000;
const now = Date.parse("2026-07-29T12:00:00.000Z");

let dir: string;
let sessions: string;
let vault: string;

/** One Claude Code transcript line carrying a usage object. */
function usageLine(ts: string, output: number, cwd: string): string {
  return JSON.stringify({ type: "assistant", timestamp: ts, cwd, message: { usage: { output_tokens: output } } });
}

function transcript(name: string, lines: string[]): void {
  fs.writeFileSync(path.join(sessions, name), lines.join("\n") + "\n", "utf8");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-spend-"));
  sessions = path.join(dir, "sessions");
  vault = path.join(dir, "vault");
  fs.mkdirSync(sessions);
  fs.mkdirSync(vault);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const ceiling = (over: Partial<SpendCeiling> = {}): SpendCeiling => ({
  weightedTokens: 1000, windowHours: 24, sessionsDir: sessions, ...over,
});

describe("measureFiring", () => {
  test("counts this vault's spend and nobody else's", () => {
    transcript("mine.jsonl", [usageLine("2026-07-29T11:00:00.000Z", 100, vault)]);
    transcript("theirs.jsonl", [usageLine("2026-07-29T11:00:00.000Z", 9999, path.join(dir, "other-repo"))]);
    const m = measureFiring(sessions, { vaultDir: vault, sinceMs: now - 24 * HOUR });
    expect(m.measurable && m.sessions).toBe(1);
    // output is weighted 5x by the repo's one cost model.
    expect(m.measurable && m.weighted).toBe(500);
  });

  test("spend older than the window has aged out — which is how an exhausted ceiling clears itself", () => {
    transcript("mine.jsonl", [
      usageLine("2026-07-27T11:00:00.000Z", 1000, vault),
      usageLine("2026-07-29T11:00:00.000Z", 10, vault),
    ]);
    const m = measureFiring(sessions, { vaultDir: vault, sinceMs: now - 24 * HOUR });
    expect(m.measurable && m.weighted).toBe(50);
  });

  test("a usage record with no timestamp is charged, not dropped", () => {
    // It cannot be placed in the window, and for a ceiling the cautious
    // direction is to charge for spend you cannot rule out.
    transcript("mine.jsonl", [
      JSON.stringify({ cwd: vault, message: { usage: { output_tokens: 4 } } }),
    ]);
    const m = measureFiring(sessions, { vaultDir: vault, sinceMs: now - HOUR });
    expect(m.measurable && m.weighted).toBe(20);
  });

  test("an unreadable transcript directory is unmeasurable, never zero", () => {
    // Zero would be a silent grant of the whole ceiling on every firing.
    const m = measureFiring(path.join(dir, "nope"), { vaultDir: vault, sinceMs: 0 });
    expect(m.measurable).toBe(false);
    if (!m.measurable) expect(m.reason).toMatch(/refuses to fire/);
  });

  test("a directory with no transcripts for this vault measures zero, honestly", () => {
    const m = measureFiring(sessions, { vaultDir: vault, sinceMs: 0 });
    expect(m).toMatchObject({ measurable: true, weighted: 0, sessions: 0 });
  });
});

describe("checkCeiling", () => {
  test("an undeclared ceiling refuses — the loop will not pick a number for your account", () => {
    const v = checkCeiling(null);
    expect(v).toMatchObject({ ok: false, kind: "undeclared" });
    expect(v.reason).toMatch(/loop\.spend/);
  });

  test("an unmeasurable pool refuses, and is reported apart from an exhausted one", () => {
    const v = checkCeiling(ceiling(), measureFiring(path.join(dir, "nope"), { vaultDir: vault, sinceMs: 0 }));
    expect(v).toMatchObject({ ok: false, kind: "unmeasurable" });
  });

  test("at or over the ceiling refuses, and says the window is what clears it", () => {
    transcript("mine.jsonl", [usageLine("2026-07-29T11:00:00.000Z", 200, vault)]);
    const v = checkCeiling(ceiling(), measureFiring(sessions, { vaultDir: vault, sinceMs: now - 24 * HOUR }));
    expect(v).toMatchObject({ ok: false, kind: "exhausted" });
    expect(v.reason).toMatch(/window rolls forward/);
  });

  test("under the ceiling proceeds and reports what is left", () => {
    transcript("mine.jsonl", [usageLine("2026-07-29T11:00:00.000Z", 100, vault)]);
    const v = checkCeiling(ceiling(), measureFiring(sessions, { vaultDir: vault, sinceMs: now - 24 * HOUR }));
    expect(v).toMatchObject({ ok: true, kind: "ok", spent: 500 });
  });
});
