/**
 * Every `file:line` citation in the readiness document points at a file that
 * exists, at a line that exists. (V1 readiness, the document's own standard.)
 *
 * `docs/reference/v1-readiness.md` is the bar, and its whole claim to being a
 * bar rather than an opinion is that each criterion names evidence a reader can
 * go look at. A citation into a file that has since been edited is worse than no
 * citation: it reads as verified and sends the reader to the wrong line, which
 * is how B4 came to cite `tools.ts:546` for a tool at `:501`, and how Z5 spent
 * months citing a `spendClass` that had been deleted with the genome.
 *
 * **What this catches and what it does not.** It catches a citation into a
 * missing file and a citation past the end of one. It does NOT catch a citation
 * that has drifted to a different line *within* the file — the B4 case was
 * in-bounds and only fell out of reading it. So this is a floor, not a
 * guarantee, and it earns its place by being the part that can be mechanical:
 * of the four stale citations found on 2026-07-29, all four were out of bounds.
 *
 * Deliberately not asserted: that the cited line *says* what the criterion
 * claims. Nothing short of a human reading it decides that, and a test that
 * pretended otherwise would be the self-certification Gate B exists to refuse.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOC = path.join(repoRoot, "docs/reference/v1-readiness.md");

/** `` `src/foo/bar.ts:12-34` `` or `` `src/foo/bar.ts:12` `` — backticked, repo-relative. */
const CITATION = /`((?:src|test|scripts|docs|\.github)\/[A-Za-z0-9._/-]+\.(?:ts|md|yml|yaml|json)):(\d+)(?:-(\d+))?`/g;

interface Citation {
  raw: string;
  file: string;
  hi: number;
}

function citations(): Citation[] {
  const doc = fs.readFileSync(DOC, "utf8");
  return [...doc.matchAll(CITATION)].map((m) => ({
    raw: m[0].replace(/`/g, ""),
    file: m[1],
    hi: Number(m[3] ?? m[2]),
  }));
}

describe("the readiness document's file:line evidence", () => {
  // If the regex ever stops matching (a formatting change, a renamed doc), the
  // two tests below pass by finding nothing to check. This is the tripwire.
  test("the citation scan actually finds citations", () => {
    expect(citations().length).toBeGreaterThan(50);
  });

  test("every cited file exists", () => {
    const missing = citations()
      .filter((c) => !fs.existsSync(path.join(repoRoot, c.file)))
      .map((c) => c.raw);
    expect([...new Set(missing)]).toEqual([]);
  });

  test("every cited line is within its file", () => {
    const lineCounts = new Map<string, number>();
    const outOfBounds: string[] = [];
    for (const c of citations()) {
      const abs = path.join(repoRoot, c.file);
      if (!fs.existsSync(abs)) continue; // reported by the test above
      if (!lineCounts.has(c.file)) lineCounts.set(c.file, fs.readFileSync(abs, "utf8").split("\n").length);
      const lines = lineCounts.get(c.file)!;
      if (c.hi > lines) outOfBounds.push(`${c.raw} (file has ${lines} lines)`);
    }
    expect([...new Set(outOfBounds)]).toEqual([]);
  });
});
