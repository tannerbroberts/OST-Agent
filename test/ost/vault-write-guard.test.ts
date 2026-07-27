/**
 * The vault-level write guard.
 *
 * Schema validation (v0.17.0) catches a *malformed call*. This catches a *malformed
 * value* — content that is empty, whitespace-only, or the literal strings "undefined"
 * / "null", arriving through a perfectly well-formed call. Those two are complements:
 * a caller that passes `String(someUndefinedVar)` into a correctly-shaped `issue`
 * argument is invisible to the schema check by construction.
 *
 * This is deliberately a tripwire, not a policy. The rule is *the content is exactly
 * that*, never *contains it* — a legitimate annotation discussing the word "undefined"
 * must still be writable, and several nodes in the real vaults do exactly that.
 *
 * Occasioned by 21 destroyed annotation lines across 16 nodes in the two live vaults
 * (2026-07-24/26), each of which was the four characters `undefined` and each of which
 * a guard here would have refused regardless of which entry point produced it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Vault } from "../../src/ost/vault.js";
import type { OstNode } from "../../src/ost/node.js";

let dir: string;
let vault: Vault;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-guard-"));
  vault = new Vault(dir);
  vault.createNode({
    title: "Opp", layer: "Opportunity", tags: [], links: [], body: "b",
  } as OstNode);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The exact shapes observed destroying real annotations, plus their near neighbours. */
const BAD = [
  ["the literal string undefined", "undefined"],
  ["the literal string null", "null"],
  ["undefined with surrounding whitespace", "  undefined  "],
  ["capitalised Undefined", "Undefined"],
  ["the empty string", ""],
  ["whitespace only", "   "],
  ["a newline only", "\n"],
  ["a tab only", "\t"],
] as const;

describe("annotate refuses malformed values", () => {
  for (const [name, value] of BAD) {
    test(`refuses ${name}`, () => {
      const before = fs.readFileSync(path.join(dir, "Opp.md"), "utf8");
      expect(() => vault.annotate("Opp", value)).toThrow(/refusing to write/i);
      // and crucially writes NOTHING — a refusal that still lands a line is not a refusal
      expect(fs.readFileSync(path.join(dir, "Opp.md"), "utf8")).toBe(before);
    });
  }

  test("the error names the offending value so a caller can see what it passed", () => {
    expect(() => vault.annotate("Opp", "undefined")).toThrow(/undefined/);
  });
});

describe("the guard is a tripwire, not a policy", () => {
  test("prose merely CONTAINING the word undefined is still writable", () => {
    // This is the case that makes an over-broad rule unusable: this very repo's
    // vault records annotations about the undefined-write defect itself.
    const legit = "the tool wrote the literal string undefined into 16 nodes";
    vault.annotate("Opp", legit);
    expect(fs.readFileSync(path.join(dir, "Opp.md"), "utf8")).toContain(legit);
  });

  test("a single ordinary character is enough content", () => {
    vault.annotate("Opp", "x");
    expect(fs.readFileSync(path.join(dir, "Opp.md"), "utf8")).toContain("x");
  });
});

describe("every content-bearing write path is covered, not just annotate", () => {
  test("appendToNode refuses undefined", () => {
    expect(() => vault.appendToNode("Opp", "undefined")).toThrow(/refusing to write/i);
  });

  test("appendToNode refuses empty", () => {
    expect(() => vault.appendToNode("Opp", "   ")).toThrow(/refusing to write/i);
  });

  test("appendUnderSection refuses undefined", () => {
    expect(() => vault.appendUnderSection("Opp", "## History", "undefined")).toThrow(
      /refusing to write/i,
    );
  });

  test("createNode refuses an undefined body", () => {
    expect(() =>
      vault.createNode({
        title: "Bad", layer: "Solution", tags: [], links: [], body: "undefined",
      } as OstNode),
    ).toThrow(/refusing to write/i);
    expect(fs.existsSync(path.join(dir, "Bad.md"))).toBe(false);
  });
});

describe("optional notes: absent is fine, the STRING undefined is not", () => {
  // This is the distinction the whole guard turns on. `note === undefined` is a caller
  // legitimately declining to explain itself. `note === "undefined"` is a caller that
  // stringified a variable it never set — the exact defect, one `String()` away.
  test("setStatus with no note is allowed", () => {
    vault.createNode({ title: "S", layer: "Solution", tags: [], links: [], body: "b" } as OstNode);
    expect(() => vault.setStatus("S", "deferred")).not.toThrow();
  });

  test("setStatus refuses the literal string undefined as a note", () => {
    vault.createNode({ title: "S2", layer: "Solution", tags: [], links: [], body: "b" } as OstNode);
    expect(() => vault.setStatus("S2", "deferred", "undefined")).toThrow(/refusing to write/i);
  });

  test("setEvidence refuses the literal string undefined as a note", () => {
    vault.createNode({ title: "S3", layer: "Solution", tags: [], links: [], body: "b" } as OstNode);
    expect(() => vault.setEvidence("S3", "observed", "undefined")).toThrow(/refusing to write/i);
  });

  test("setLane refuses the literal string undefined as a note", () => {
    vault.createNode({
      title: "T", layer: "AssumptionTest", tags: [], links: [], body: "b",
    } as OstNode);
    expect(() => vault.setLane("T", "compute-only", "undefined")).toThrow(/refusing to write/i);
  });

  test("an empty-string note is refused rather than silently written as a bare dash", () => {
    vault.createNode({ title: "S4", layer: "Solution", tags: [], links: [], body: "b" } as OstNode);
    expect(() => vault.setStatus("S4", "deferred", "  ")).toThrow(/refusing to write/i);
  });
});

describe("the guard cannot pass vacuously", () => {
  // A guard with nothing to check reports the same clean result as one that checked
  // everything. This asserts the guard is actually reachable on every path claimed
  // above — if a method stops routing through it, this fails rather than going quiet.
  test("each guarded method rejects at least one known-bad value", () => {
    vault.createNode({ title: "V", layer: "Solution", tags: [], links: [], body: "b" } as OstNode);
    const attempts: Array<() => void> = [
      () => vault.annotate("V", "undefined"),
      () => vault.appendToNode("V", "undefined"),
      () => vault.appendUnderSection("V", "## History", "undefined"),
      () => vault.setStatus("V", "deferred", "undefined"),
      () => vault.setEvidence("V", "observed", "undefined"),
    ];
    let refused = 0;
    for (const a of attempts) {
      try { a(); } catch { refused++; }
    }
    expect(refused).toBe(attempts.length);
  });
});
