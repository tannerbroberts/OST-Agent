import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  ReadJournal,
  classifyFailedMatch,
  describeFailedMatchAttribution,
} from "../../src/runner/failed-match-attribution.js";

/**
 * "Change a journalled file underneath a replacement and require the failure
 * to name staleness, not a missing string" — the assumption test this
 * solution's build permit rests on. Three arms, and the third is the one that
 * matters: a version that always answers "changed" passes the first two
 * trivially, which is why it gets its own test.
 */

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-failed-match-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function seedFile(name: string, content: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, "utf8");
  return p;
}

describe("failed-match attribution", () => {
  test("a file rewritten after the journalled read is reported as stale, not a missing string", () => {
    const p = seedFile("a.ts", "export const x = 1;\n");
    const journal = new ReadJournal();
    journal.recordRead(p, fs.readFileSync(p, "utf8"));

    // A second process rewrites the file after the run's read — the failed
    // replacement that follows is drift, not a bad quote.
    fs.writeFileSync(p, "export const x = 2;\n", "utf8");

    const attribution = classifyFailedMatch(journal, p);
    expect(attribution.kind).toBe("stale-file");
    const message = describeFailedMatchAttribution(attribution);
    expect(message).toContain("changed since you read it");
    expect(message).not.toContain("String to replace not found");
  });

  test("a replacement that never matched byte-identical content is reported as a bad quote, not staleness", () => {
    const p = seedFile("b.ts", "export const y = 1;\n");
    const journal = new ReadJournal();
    journal.recordRead(p, fs.readFileSync(p, "utf8"));

    // No writer touches the file. The old_string the run tried to match never
    // appeared in it — its own mistake, not a second writer's.

    const attribution = classifyFailedMatch(journal, p);
    expect(attribution.kind).toBe("bad-quote");
    const message = describeFailedMatchAttribution(attribution);
    expect(message).toContain("quote is wrong, not the file");
    expect(message).not.toContain("the file changed since you read it");
  });

  test("a file with no journalled read yields an explicit cannot-say, not a guess", () => {
    const p = seedFile("c.ts", "export const z = 1;\n");
    const journal = new ReadJournal();
    // This run never recorded a read of `p` — through an unjournalled tool,
    // or a file it never read at all this pass.

    const attribution = classifyFailedMatch(journal, p);
    expect(attribution.kind).toBe("cannot-say");
    const message = describeFailedMatchAttribution(attribution);
    expect(message).toContain("cannot attribute");
    expect(message).not.toMatch(/changed since you read it|quote is wrong/);
  });

  test("handed the failing quote, both arms carry the text that is at that site now", () => {
    // The cause and the correction are separate questions, and knowing which
    // one it was still leaves a run with nothing to write instead.
    const stale = seedFile("e.ts", "const total = subtotal + tax;\n");
    const journal = new ReadJournal();
    journal.recordRead(stale, fs.readFileSync(stale, "utf8"));
    fs.writeFileSync(stale, "const total = subtotal + tax + shipping;\n", "utf8");

    const staleMessage = describeFailedMatchAttribution(
      classifyFailedMatch(journal, stale, "const total = subtotal + tax;"),
    );
    expect(staleMessage).toContain("changed since you read it");
    expect(staleMessage).toContain("const total = subtotal + tax + shipping;");

    const badQuote = seedFile("f.ts", "  const flag = enabled ?? false;\n");
    journal.recordRead(badQuote, fs.readFileSync(badQuote, "utf8"));
    const quoteMessage = describeFailedMatchAttribution(
      classifyFailedMatch(journal, badQuote, "        const flag = enabled ?? true;"),
    );
    expect(quoteMessage).toContain("quote is wrong, not the file");
    expect(quoteMessage).toContain("const flag = enabled ?? false;");
  });

  test("without the failing quote the verdict stays cause-only — no site is guessed", () => {
    const p = seedFile("g.ts", "export const only = 1;\n");
    const journal = new ReadJournal();
    journal.recordRead(p, fs.readFileSync(p, "utf8"));
    const attribution = classifyFailedMatch(journal, p);
    expect(attribution.kind).toBe("bad-quote");
    if (attribution.kind !== "bad-quote") return;
    expect(attribution.atSite).toBeUndefined();
    expect(describeFailedMatchAttribution(attribution)).not.toContain("what is at");
  });

  test("the third arm is load-bearing: an unjournalled file must not collapse into either verdict", () => {
    // A two-arm implementation that always answers "changed" (or always
    // "bad-quote") would satisfy the two tests above without ever reaching
    // this file. This guards the coverage claim, not just the accuracy of it.
    const untouched = seedFile("d.ts", "export const w = 1;\n");
    const journal = new ReadJournal();
    const attribution = classifyFailedMatch(journal, untouched);
    expect(attribution.kind).not.toBe("stale-file");
    expect(attribution.kind).not.toBe("bad-quote");
  });
});
