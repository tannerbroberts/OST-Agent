/**
 * Scores `scripts/provenance-census.ts` against the one population where the
 * answer is already known: the three files named in "A guard derived the
 * rule it was checking, so it agreed with the bug for 23 releases" (vault,
 * 2026-08-06). Each derived the MCP tool-name prefix independently from the
 * plugin manifest, all three the same wrong way, and none of them ever
 * disagreed with the other two.
 *
 * The parent assumption — "A provenance census would not have flagged the
 * three guards that motivated it" — predicts this census would miss all
 * three, because none of them share an import edge or a declaration with
 * each other; they are three independent copies of one belief, not one
 * shared symbol read three times. That prediction is what this file settles,
 * not a bar the census is expected to clear. See `PROVENANCE.md` in the
 * fixture directory for exactly which commit the three files were cut from
 * and why only two of the three carry an assertion for a census to examine.
 *
 * **The controls come first.** A census that flagged nothing anywhere would
 * trivially "pass" the scoring below for the wrong reason, so the first
 * block proves the census can actually catch the shape it looks for —
 * firing on a same-source assertion, and staying quiet on assertions built
 * to look similar and not be it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { censusSource } from "../../scripts/provenance-census.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "provenance-census");

function fixture(name: string): string {
  return fs.readFileSync(path.join(fixtureDir, name), "utf8");
}

// ── controls: the census can fire, and can hold its fire ────────────────────

describe("the census catches the shape it looks for, and only that shape", () => {
  test("fires when both sides are the same locally-declared constant", () => {
    const source = `
      const TOKEN = compute();
      test("x", () => { expect(TOKEN).toBe(TOKEN); });
    `;
    const findings = censusSource("control.ts", source);
    expect(findings).toHaveLength(1);
    expect(findings[0].sharedOrigin).toContain("#TOKEN@");
  });

  test("fires when both sides trace to the same relative import", () => {
    const source = `
      import { PREFIX } from "../../scripts/mcp-prefix.js";
      test("x", () => { expect(somethingDerivedFrom(PREFIX)).toBe(PREFIX); });
    `;
    const findings = censusSource("control.ts", source);
    expect(findings).toHaveLength(1);
    expect(findings[0].sharedOrigin).toBe("../../scripts/mcp-prefix.js#PREFIX");
  });

  test("stays quiet when the expected side is a literal", () => {
    const source = `
      const TOKEN = compute();
      test("x", () => { expect(TOKEN).toBe("mcp__ost-agent__"); });
    `;
    expect(censusSource("control.ts", source)).toEqual([]);
  });

  test("stays quiet when the two sides come from independent declarations", () => {
    const source = `
      const A = computeA();
      const B = computeB();
      test("x", () => { expect(A).toBe(B); });
    `;
    expect(censusSource("control.ts", source)).toEqual([]);
  });

  test("stays quiet on a bare (non-relative) import — fs, path, vitest itself", () => {
    // Every file in the suite imports these; tracking them would flag nearly
    // every assertion in the repo and size nothing. See provenance-census.ts.
    const source = `
      import fs from "node:fs";
      test("x", () => { expect(fs.existsSync("a")).toBe(fs.existsSync("b")); });
    `;
    expect(censusSource("control.ts", source)).toEqual([]);
  });
});

// ── the scoring: three files whose ground truth is known ────────────────────

describe("scored against the three guards that agreed with the bug", () => {
  test("test/release/command-allowlists.test.ts, as it stood before the fix, is not flagged", () => {
    const findings = censusSource(
      "command-allowlists.defective.test.ts",
      fixture("command-allowlists.defective.test.ts.txt"),
    );
    // `expect(MCP_PREFIX).toBe("mcp__ost-agent__")` — the locally-derived
    // value against a hardcoded literal. No shared origin for a syntactic
    // census to find; this is the false negative the assumption predicted.
    expect(findings).toEqual([]);
  });

  test("test/skill/surface-parity.test.ts, as it stood before the fix, is not flagged", () => {
    const findings = censusSource(
      "surface-parity.defective.test.ts",
      fixture("surface-parity.defective.test.ts.txt"),
    );
    // `expect(prefixProblems(skill, MCP_PREFIX)).toEqual([])` — the derived
    // value folded into a call, against an empty-array literal. Same result.
    expect(findings).toEqual([]);
  });

  test("scripts/gen-skill.ts, as it stood before the fix, carries no assertion to examine", () => {
    // The generator computed the wrong prefix and wrote it into SKILL.md; it
    // never checked itself. A census scoped to "every assertion in the
    // suite" has nothing here to flag or clear — the file is out of its
    // domain, not a miss within it. That is a finding in its own right: a
    // check that never runs is invisible to *any* assertion-based technique.
    const findings = censusSource("gen-skill.defective.ts", fixture("gen-skill.defective.ts.txt"));
    expect(findings).toEqual([]);
  });

  test("the score: 0 of 3 known-defective guards flagged", () => {
    // This is the number "Score the provenance census against the three
    // guards it was invented to catch" exists to settle. The assumption's
    // own prediction was that the census would miss all three; the score
    // above confirms it. A syntactic, import-and-declaration census would
    // not have caught this bug — it would have to be re-described as sizing
    // the population of syntactically self-derived checks, not as an answer
    // to "would this have caught it".
    const files = [
      ["command-allowlists.defective.test.ts.txt"],
      ["surface-parity.defective.test.ts.txt"],
      ["gen-skill.defective.ts.txt"],
    ] as const;
    const flaggedCount = files
      .map(([name]) => censusSource(name, fixture(name)).length)
      .filter((n) => n > 0).length;
    expect(flaggedCount).toBe(0);
  });
});
