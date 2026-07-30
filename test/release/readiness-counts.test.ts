/**
 * The readiness document's summary line agrees with the readiness document.
 *
 * `docs/reference/v1-readiness.md` opens with a sentence of the form *"75
 * criteria, 20 of them blockers. 28 met, 4 partial, 43 not met."* Every other
 * claim in that file is either a citation (`readiness-citations.test.ts`), a
 * sequencing claim (`readiness-tiers.test.ts`) or a criterion whose check
 * something runs. **That line was the exception**, and the document says so about
 * itself: *"a number in a summary line is still a claim carried by memory about
 * claims carried by tests, and it remains the one thing here nothing pins."*
 *
 * It has been wrong twice, both times in the same way — a batch of criteria
 * closed, their own entries were updated, and this line was not:
 *
 * - it read **11 met, 53 not met** against 67 criteria while the file held 13
 *   `met` and 51 `not met` (R4 and R7 had closed);
 * - and the three shell commands the document supplies for re-counting carried
 *   trailing comments reading `68 criteria / 17 blockers / 17-3-48`, two
 *   revisions out of date, so *the fix for the drifting number had itself
 *   drifted*.
 *
 * The second one is the interesting one. A command that prints the right answer
 * beside a comment stating the wrong one is worse than no command: a reader who
 * trusts the comment is misled by the very apparatus installed to stop them being
 * misled. So this test asserts three things at once — the summary line, the
 * comments beside the commands, and the file's actual contents all agree.
 *
 * What it deliberately does NOT do is decide whether a status is *correct*. That
 * is each criterion's own check, and a test that tried would be the
 * self-certification Gate B exists to refuse. This one only asserts that the
 * document's arithmetic about itself adds up.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOC = path.join(repoRoot, "docs/reference/v1-readiness.md");
const doc = fs.readFileSync(DOC, "utf8");

/**
 * The three counts, computed with exactly the regexes the document publishes as
 * the commands to re-run. Kept identical on purpose: a test that counted a
 * *different* way could agree with the summary line while disagreeing with what
 * a reader following the instructions would get.
 */
function counts(markdown: string) {
  const lines = markdown.split("\n");
  const criteria = lines.filter((l) => /^\*\*(⛔ )?[A-Z][0-9]+ —/.test(l)).length;
  const blockers = lines.filter((l) => /^\*\*⛔ [A-Z][0-9]+ —/.test(l)).length;

  // The `sed` collapse the document calls load-bearing: several entries qualify
  // the verdict inside the same bold span ("not met, and nothing exists to build
  // on"), and a match on the bare word alone would silently drop them.
  const statuses = { met: 0, partial: 0, "not met": 0 } as Record<string, number>;
  for (const m of markdown.matchAll(/^> \*Today:\*\s+\*\*([a-z, ]+)/gm)) {
    const verdict = m[1].startsWith("not met") ? "not met" : m[1].startsWith("partial") ? "partial" : m[1].startsWith("met") ? "met" : null;
    expect(verdict, `unrecognised status "${m[1]}" — the summary line cannot count what it cannot classify`).not.toBeNull();
    statuses[verdict!] += 1;
  }
  return { criteria, blockers, ...statuses };
}

const actual = counts(doc);

/** Every `*.test.ts` under `test/`, recursively — the denominator D1 claims. */
function countTestFiles(dir: string): number {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countTestFiles(path.join(dir, e.name));
    else if (e.name.endsWith(".test.ts")) n += 1;
  }
  return n;
}

describe("the readiness summary line counts the readiness document", () => {
  test("the document still opens with a summary line this test can read", () => {
    // Non-vacuity. Every assertion below is driven off this match; if the line is
    // reworded, the right failure is "nothing to check", not silent success.
    expect(doc).toMatch(/^\*\*\d+ criteria, \d+ of them blockers\. \d+ met, \d+ partial, \d+ not met\.\*\*/m);
  });

  test("its five numbers match the file", () => {
    const m = doc.match(/^\*\*(\d+) criteria, (\d+) of them blockers\. (\d+) met, (\d+) partial, (\d+) not met\.\*\*/m)!;
    const [criteria, blockers, met, partial, notMet] = m.slice(1, 6).map(Number);
    expect({ criteria, blockers, met, partial, notMet }).toEqual({
      criteria: actual.criteria,
      blockers: actual.blockers,
      met: actual.met,
      partial: actual.partial,
      notMet: actual["not met"],
    });
  });

  test("every criterion has exactly one status", () => {
    // The three status counts must exhaust the criteria. A criterion whose
    // `*Today:*` line is missing or unparseable would otherwise vanish from the
    // arithmetic without changing any number a reader looks at.
    expect(actual.met + actual.partial + actual["not met"]).toBe(actual.criteria);
  });

  test("the comments beside the document's own re-count commands are current", () => {
    // The drift that made the fix need a fix. These comments are what a reader
    // compares their terminal against.
    const block = doc.match(/```bash\n([\s\S]*?)```/)![1];
    expect(block).toContain(`# ${actual.criteria} criteria`);
    expect(block).toContain(`# ${actual.blockers} blockers`);
    expect(block).toContain(`# ${actual.met} / ${actual.partial} / ${actual["not met"]}`);
  });

  test("D1's file count is the number of test files on disk", () => {
    // D1 is the criterion whose subject is that the release gates pass, and its
    // evidence line has been wrong three times — most recently claiming 790
    // tests across 79 files against an actual 819/83. The *test* count cannot be
    // pinned from inside the suite (counting it means running the run). The
    // *file* count can, and it is the half that moves when a batch lands, so
    // this is the assertion that makes a whole new test file impossible to ship
    // while D1's line stays put.
    const files = countTestFiles(path.join(repoRoot, "test"));
    const claimed = Number(doc.match(/\*Today:\*\s+\*\*met\*\* — [\d,]+ tests across (\d+) files/)![1]);
    expect(claimed).toBe(files);
  });

  test("the naïve blocker count the document warns about is still what it says", () => {
    // The document tells the reader that `grep -c '⛔'` returns more than the
    // blocker count, and names the difference (the legend plus occurrences inside
    // the blockquote's own prose). If that number moves, the warning is wrong and
    // a reader following it miscounts.
    const raw = (doc.match(/⛔/g) ?? []).length;
    const claimed = Number(doc.match(/`grep -c '⛔'` returns (\d+)/)![1]);
    expect(raw).toBe(claimed);
    expect(raw).toBeGreaterThan(actual.blockers);
  });
});
