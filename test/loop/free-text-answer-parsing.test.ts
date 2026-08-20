/**
 * The instrument for "Every forced choice carries an open field, and a written
 * answer is first-class" — specifically for the assumption underneath it, "A
 * run can act on a sentence the operator wrote, without asking again".
 *
 * Feasibility, not correctness: this replays the two texts
 * `TRANSCRIPT:42dcb7b4-f01b-40bc-a211-ed4a44a74fd3` recorded when the operator
 * rejected an `AskUserQuestion` and wrote what they actually meant instead of
 * picking an option (see `test/fixtures/free-text-answers/PROVENANCE.md`), and
 * checks that {@link resolveFreeTextAnswer} yields a decision for both — with no
 * follow-up question needed — rather than whether the decision it yields is the
 * one the operator intended. A passing parse is not a correct one; two samples
 * are a fixture, not a rate.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveFreeTextAnswer } from "../../src/loop/free-text-answer.js";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/free-text-answers/rejections.json",
);

interface RecordedRejection {
  transcript: string;
  askEntry: number;
  question: string;
  answerEntry: number;
  text: string;
}

const { rejections } = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as { rejections: RecordedRejection[] };

describe("the recorded corpus", () => {
  it("is the two rejections TRANSCRIPT:42dcb7b4 recorded", () => {
    expect(rejections).toHaveLength(2);
    for (const r of rejections) {
      expect(r.transcript).toBe("TRANSCRIPT:42dcb7b4-f01b-40bc-a211-ed4a44a74fd3");
      expect(r.text.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveFreeTextAnswer", () => {
  it("yields a decision for both recorded rejection texts, with nothing left to ask", () => {
    for (const r of rejections) {
      const resolution = resolveFreeTextAnswer(r.text);
      expect(resolution.decided, `entry ${r.answerEntry}: ${resolution.why}`).toBe(true);
      expect(resolution.instruction).toBe(r.text);
    }
  });

  it("carries the operator's own words forward unparsed, not a guess at which option they meant", () => {
    // The distinguishing claim: this is not option-matching in disguise. Neither
    // recorded sentence names any of the labels its question actually offered.
    const first = rejections[0]!;
    expect(first.question).toContain("build gate");
    const resolution = resolveFreeTextAnswer(first.text);
    expect(resolution.instruction).not.toMatch(/machine-runnable|specs only|both, staged/i);
  });

  it("does not manufacture a decision out of an empty field", () => {
    expect(resolveFreeTextAnswer("").decided).toBe(false);
    expect(resolveFreeTextAnswer("   ").decided).toBe(false);
  });

  it("does not manufacture a decision out of Claude Code's own rejection filler", () => {
    // The shape the run actually saw at `rejectionEntry` before the operator's
    // real sentence arrived one turn later — see PROVENANCE.md. If this resolved
    // as a decision, the run would be proceeding on having nothing.
    const resolution = resolveFreeTextAnswer("(No answer provided)");
    expect(resolution.decided).toBe(false);
    expect(resolution.instruction).toBeUndefined();
  });
});
