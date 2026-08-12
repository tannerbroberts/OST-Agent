import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  candidateAssumptions,
  PANEL,
  renderPanel,
  runPanel,
  solutionProse,
  type SolutionUnderReview,
} from "../../src/eval/judge-panel.js";

/**
 * "Have three independent judges nominate for ten solutions and see whether
 * they agree with each other."
 *
 * The bar comes from the assumption test's own threshold field: at least 2 of
 * 3 judges name the same assumption on at least 6 of 10 solutions. The corpus
 * is ten real Solution bodies from the meta vault, committed under
 * `test/fixtures/judge-panel/` — the first ten Solution-typed files in
 * C-locale filename order, a rule chosen so the sample could not be picked for
 * how it scores. Scatter (all three judges naming different sentences) is
 * asserted separately from agreement, because the node is explicit that a
 * scattering panel is generating rather than judging.
 *
 * What green means here, and only this: three deterministic lenses that share
 * no vocabulary converge on the same sentence often enough to clear the bar,
 * so the corpus's solution prose makes its riskiest assumption mechanically
 * legible. Green does not mean the nominated assumptions are correct — three
 * judges can converge on the same wrong sentence — and it does not answer the
 * humans-required half of the assumption test, which wants judges that do not
 * share a mechanical ancestry at all.
 */

const CORPUS_DIR = path.join(__dirname, "..", "fixtures", "judge-panel");

function corpus(): SolutionUnderReview[] {
  return fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => ({
      title: f.replace(/\.md$/, ""),
      body: fs.readFileSync(path.join(CORPUS_DIR, f), "utf8"),
    }));
}

describe("the panel over the committed corpus", () => {
  test("a panel over nothing is a failure, not a pass", () => {
    // The corpus must actually be there and actually be read — a sweep that
    // reads nothing must not be able to report a clean result.
    const solutions = corpus();
    expect(solutions).toHaveLength(10);
    const report = runPanel(solutions);
    expect(report.subject).toEqual({ offered: 10, read: 10 });
    expect(runPanel([]).subject.read).toBe(0);
  });

  test("at least 2 of 3 judges name the same assumption on at least 6 of 10 solutions", () => {
    const report = runPanel(corpus());

    // The report the human reads: every nomination, so disagreement is
    // inspectable rather than summarised away.
    for (const row of report.rows) {
      const verdict = row.agreed ? "agreed" : row.scattered ? "SCATTERED" : "no majority";
      console.info(`[panel] ${verdict} — ${row.solution}`);
      for (const n of row.nominations) {
        console.info(`  ${n.judge}: ${n.candidate ? `#${n.candidate.index} "${n.candidate.text}"` : "(abstained)"}`);
      }
    }
    console.info(`[panel] agreement ${report.agreementCount}/10, scatter ${report.scatterCount}/10`);

    expect(report.agreementCount).toBeGreaterThanOrEqual(6);

    // Scatter is the separate figure, not the complement of agreement: a row
    // with an abstention can miss a majority without the panel having
    // scattered. Full scatter on a majority-agreeing row is impossible, and a
    // panel that scattered on most rows would be generating even if some
    // agreement survived.
    for (const row of report.rows) {
      expect(row.agreed && row.scattered).toBe(false);
    }
    expect(report.scatterCount).toBeLessThanOrEqual(10 - report.agreementCount);
  });
});

describe("what makes the panel a panel", () => {
  test("there are three judges and their lenses are distinct", () => {
    expect(PANEL).toHaveLength(3);
    expect(new Set(PANEL.map((j) => j.name)).size).toBe(3);
  });

  test("a judge reads the argument, not the tree's commentary on it", () => {
    const body = [
      "---",
      "type: Solution",
      "created: '2026-08-03'",
      "---",
      "#Solution #unvalidated",
      "[[Some belief node]]",
      "",
      "The mechanism holds if operators accept the trade.",
      "",
      "## Definition of done",
      "",
      "This section names an instrument and must never reach a judge.",
      "",
      "## Issues",
      "- a later pass appended commentary that is not the author's argument",
    ].join("\n");

    const prose = solutionProse(body);
    expect(prose).toBe("The mechanism holds if operators accept the trade.");
  });

  test("agreement is identity on a sentence the text contains, not a fuzzy match", () => {
    const prose = solutionProse(
      "First claim stands on its own merits here. The idea fails if the operator never accepts the risk of the trade.",
    );
    const candidates = candidateAssumptions(prose);
    expect(candidates.map((c) => c.index)).toEqual([0, 1]);

    // Both marker lenses have signal only in the second sentence, so the
    // majority consensus must be that exact sentence.
    const report = runPanel([{ title: "t", body: prose }]);
    expect(report.rows[0].agreed).toBe(true);
    expect(report.rows[0].consensus).toBe("The idea fails if the operator never accepts the risk of the trade.");
  });

  test("the rendered report says BLIND over nothing and prints every nomination otherwise", () => {
    expect(renderPanel(runPanel([]))).toContain("BLIND");

    const rendered = renderPanel(
      runPanel([{ title: "t", body: "The idea fails if the operator never accepts the risk of the trade." }]),
    );
    // Disagreement is the valuable output, so the render must carry the
    // nominations themselves, not only the tally.
    expect(rendered).toContain("majority agreement on 1 of 1");
    for (const judge of PANEL) expect(rendered).toContain(`${judge.name}:`);
    expect(rendered).toContain("The idea fails if the operator never accepts the risk of the trade.");
  });

  test("a judge with no signal abstains rather than defaulting into agreement", () => {
    // No fragility markers, no consequence markers anywhere: both marker
    // judges must abstain, so no majority can form from tie-break defaults.
    const body = "Plain statements populate the entire body text. Another plain statement follows the very first.";
    const report = runPanel([{ title: "unrelated title words", body }]);
    const [fragility, consequence] = report.rows[0].nominations;
    expect(fragility.candidate).toBeUndefined();
    expect(consequence.candidate).toBeUndefined();
    expect(report.rows[0].agreed).toBe(false);
  });
});
