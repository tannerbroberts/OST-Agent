/**
 * Standing is COMPUTED, never stored — asserted over the set of consumers rather
 * than one by one. (V1 readiness, B5; and P5's "no sponsor-specific mechanism".)
 *
 * B5's two halves are (a) no record carries a rung and (b) every consumer derives one
 * from a history. A test that checked (b) against today's three call sites would pass
 * on the day a fourth reader shipped reading a stored value — which is exactly how a
 * criterion comes to be carried by memory. So the consumer set here is DERIVED from
 * the import graph: a new reader of the ledger is held to the same rule the moment it
 * is written, and this file fails the build if it is not.
 *
 * These are source-level assertions, and they are the honest form for a claim about
 * what the code *cannot* do. A behavioural test can show that the shipped readers
 * derive; only reading the source can show that no reader anywhere does otherwise.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { appendObservation, keyString, readTrustLedger, TRUST_KINDS } from "../../src/knowledge/actor-trust.js";
import os from "node:os";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcRoot = path.join(repoRoot, "src");
const MODULE = path.join(srcRoot, "knowledge/actor-trust.ts");

function srcFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ts")) out.push(p);
    }
  };
  walk(srcRoot);
  return out.sort();
}

const rel = (p: string) => path.relative(repoRoot, p);
const isComment = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line);

/** Files that import the ledger — the consumer set, derived rather than listed. */
function consumers(): string[] {
  return srcFiles().filter((p) => p !== MODULE && /from\s+"[^"]*knowledge\/actor-trust\.js"/.test(fs.readFileSync(p, "utf8")));
}

describe("B5(a) — no record carries a rung", () => {
  test("no TrustObservation variant declares one", () => {
    const source = fs.readFileSync(MODULE, "utf8");
    const decl = /export type TrustObservation =([\s\S]*?)\nexport type TrustRecordType/.exec(source);
    expect(decl, "TrustObservation must still be a declared union — this test reads it").not.toBeNull();
    expect(decl![1]).not.toMatch(/\brung\b/);
    // Non-vacuity: the block being read is the real one, and it does declare the
    // fields the scorer folds. A regex that matched nothing would pass the line above.
    expect(decl![1]).toMatch(/verdict/);
    expect(decl![1]).toMatch(/strike/);
  });

  test("nothing written to the ledger carries a rung, on any writer's path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-b5-"));
    try {
      const now = () => new Date("2026-01-01T00:00:00.000Z");
      appendObservation(dir, { kind: "web", id: "example.com", type: "corroboration", test: "t", verdict: "supported", by: "x" }, now);
      appendObservation(dir, { kind: "web", id: "example.com", type: "strike", reason: "r", by: "x" }, now);
      appendObservation(dir, { kind: "web", id: "example.com", type: "reset", reason: "r", by: "x" }, now);
      const ledger = readTrustLedger(dir);
      const history = ledger.histories.get(keyString({ kind: "web", id: "example.com" }))!;
      // The reader hands back HISTORIES — an array of facts — so there is no stored
      // current value for a consumer to read even if one wanted to.
      expect(Array.isArray(history)).toBe(true);
      expect(history).toHaveLength(3);
      for (const rec of history) expect(rec).not.toHaveProperty("rung");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("B5(b) — every consumer derives from a history", () => {
  test("the functions that hand back a rung all fold a whole ledger", () => {
    const source = fs.readFileSync(MODULE, "utf8");
    const producers = [...source.matchAll(/export function (\w+)\(([\s\S]*?)\): (RungId|RungExplanation|Standing\[\])/g)];
    // Non-vacuity: if this found nothing, the loop below would assert nothing.
    expect(producers.length).toBeGreaterThanOrEqual(4);
    for (const [, name, params] of producers) {
      expect(params, `${name} must derive from a ledger, not from a stored value`).toMatch(/ledger: TrustLedger|history/);
    }
  });

  test("every consumer folds the whole ledger, and names a rung only through a deriver", () => {
    /** The module's rung-producing exports. Anything else hands back facts, not verdicts. */
    const DERIVERS = ["rungOf", "explainRung", "standings", "webStanding", "sourceStanding"];
    const set = consumers();
    // Non-vacuity: the derived set is real. If the import pattern ever stops matching,
    // this file would silently police nothing.
    expect(set.map(rel)).toContain("src/security/tools.ts");
    for (const file of set) {
      const text = fs.readFileSync(file, "utf8");
      const imported = /import\s*{([\s\S]*?)}\s*from\s*"[^"]*knowledge\/actor-trust\.js"/.exec(text)?.[1] ?? "";
      expect(text, `${rel(file)} obtains standing without folding a history`).toMatch(/readTrustLedger\(/);
      const namesARung = text.split("\n").some((line) => !isComment(line) && /\brung\b/i.test(line));
      if (!namesARung) continue;
      expect(
        DERIVERS.some((d) => new RegExp(`\\b${d}\\b`).test(imported)),
        `${rel(file)} names a rung but imports no function that derives one from a history`,
      ).toBe(true);
    }
  });

  test("the stored-rung readers are gone from src/ entirely — the strongest form", () => {
    // Comments are exempt on purpose: several modules now explain the collision these
    // functions caused, and a scan that counted the explanation as the offence would
    // pressure the next author to delete the reasoning rather than the code.
    const hits = srcFiles()
      .filter((p) =>
        fs
          .readFileSync(p, "utf8")
          .split("\n")
          .some((line) => !isComment(line) && /\b(readHostTrust|hostRung|rankHost)\b/.test(line)),
      )
      .map(rel);
    expect(hits).toEqual([]);
    // Non-vacuity: the scan does look inside src/, and does find the module that
    // replaced them.
    expect(srcFiles().filter((p) => /\brungOf\b/.test(fs.readFileSync(p, "utf8"))).length).toBeGreaterThan(0);
  });
});

describe("P5 — the sponsor is a row, not a mechanism", () => {
  test("nothing in src/ branches on the sponsor", () => {
    const branches = srcFiles().flatMap((p) =>
      fs
        .readFileSync(p, "utf8")
        .split("\n")
        .map((line, i) => ({ line, at: `${rel(p)}:${i + 1}` }))
        .filter(({ line }) => /(===|!==|==)\s*["']sponsor|case\s+["']sponsor|\.sponsor\b/.test(line))
        .map(({ at }) => at),
    );
    expect(branches).toEqual([]);
    // Non-vacuity: the same scan DOES find the ordinary branches this repo is full of,
    // so an empty result means "no such branch", not "the regex never fires".
    const anyBranch = srcFiles().some((p) => /(===|!==)\s*["']web["']/.test(fs.readFileSync(p, "utf8")));
    expect(anyBranch).toBe(true);
  });

  test("every occurrence in code is a vocabulary member or a table row", () => {
    const kinds = TRUST_KINDS as readonly string[];
    for (const file of srcFiles()) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/sponsor/.test(line) || isComment(line)) return;
        const listsKinds = kinds.filter((k) => line.includes(k)).length >= 2;
        const tableRow = /^\s*sponsor:/.test(line);
        expect(
          listsKinds || tableRow,
          `${rel(file)}:${i + 1} mentions the sponsor outside a kind vocabulary or a table row: ${line.trim()}`,
        ).toBe(true);
      });
    }
  });

  test("the sponsor's ceiling is written in the same table as everyone else's", async () => {
    const { TRUST_CEILINGS, TRUST_INITIAL } = await import("../../src/knowledge/actor-trust.js");
    // The criterion is uniformity: every kind has an entry, computed by the same
    // scorer, and the sponsor's is `stated` because a promise about one's own
    // resources is a first-person report (Part 0), not because the sponsor is special.
    for (const kind of TRUST_KINDS) {
      expect(TRUST_CEILINGS[kind]).toBeDefined();
      expect(TRUST_INITIAL[kind]).toBeDefined();
    }
    expect(TRUST_CEILINGS.sponsor).toBe("stated");
  });
});
