/**
 * The instrument for "Replay the recorded question sessions and count whether
 * framing first adds stops or removes them" — the assumption test underneath
 * "Ask the open question first, and offer options only once the frame is
 * agreed" (meta vault).
 *
 * The solution's own arithmetic, stated in its "what would make this the wrong
 * pick" section: two-stage costs a flat two operator turns on every question,
 * against one-stage's one turn when the operator's answer was accepted as
 * asked and three when the operator `reframed` it (declined, or answered
 * outside every option offered — see {@link STOP_COUNT_RULE} in
 * `src/loop/questions.ts` for exactly where the three comes from). Framing
 * first only pays for itself if reframed questions are common enough that the
 * turns saved on those outweigh the turn taxed onto every accepted one.
 *
 * No new sessions, no recruiting: this replays the same eleven harvested
 * sessions `question-budget-ordering.test.ts` uses (`test/fixtures/question-
 * budget/`, see its PROVENANCE.md), because the assumption test says the base
 * rate it needs is already sitting in the corpus that exists.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STOP_COUNT_RULE,
  readHindsight,
  sessionStopCount,
  stopCount,
  type HarvestedSession,
} from "../../src/loop/questions.js";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/question-budget/sessions.json",
);

const corpus = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as { sessions: HarvestedSession[] };

describe("the corpus carries a real reframed rate to measure", () => {
  it("holds every recorded session with an answered clarifying question", () => {
    expect(corpus.sessions.length).toBeGreaterThan(0);
    for (const session of corpus.sessions) expect(session.questions.length).toBeGreaterThan(0);
  });

  it("classifies both accepted and reframed questions, so the comparison has both terms", () => {
    const tiers = corpus.sessions.flatMap((s) => s.questions.map((q) => readHindsight(q).tier));
    expect(tiers).toContain("confirmed");
    expect(tiers.filter((t) => t === "reframed").length).toBeGreaterThan(0);
  });
});

describe("what one question costs under each design", () => {
  it("costs one-stage one turn and two-stage two, when the answer was accepted", () => {
    const accepted = corpus.sessions.flatMap((s) => s.questions).find((q) => readHindsight(q).tier !== "reframed")!;
    expect(stopCount(accepted)).toEqual({
      oneStage: STOP_COUNT_RULE.oneStageAccepted,
      twoStage: STOP_COUNT_RULE.twoStageFlat,
      reframed: false,
    });
  });

  it("costs one-stage three turns and two-stage two, when the operator reframed it", () => {
    const reframed = corpus.sessions.flatMap((s) => s.questions).find((q) => readHindsight(q).tier === "reframed")!;
    expect(stopCount(reframed)).toEqual({
      oneStage: STOP_COUNT_RULE.oneStageReframed,
      twoStage: STOP_COUNT_RULE.twoStageFlat,
      reframed: true,
    });
  });
});

describe("replaying every recorded session carrying a clarifying_question", () => {
  const perSession = corpus.sessions.map(sessionStopCount);
  const oneStageTotal = perSession.reduce((sum, s) => sum + s.oneStage, 0);
  const twoStageTotal = perSession.reduce((sum, s) => sum + s.twoStage, 0);
  const totalQuestions = perSession.reduce((sum, s) => sum + s.questions, 0);
  const totalReframed = perSession.reduce((sum, s) => sum + s.reframed, 0);

  it("prints the count so the number, not just the verdict, is on the record", () => {
    const detail = perSession
      .map(
        (s) =>
          `${s.session.slice(0, 8)}  ${s.questions} question(s), ${s.reframed} reframed  ` +
          `one-stage=${s.oneStage}  two-stage=${s.twoStage}  delta=${s.delta >= 0 ? "+" : ""}${s.delta}`,
      )
      .join("\n");
    // eslint-disable-next-line no-console
    console.log(
      `\n${detail}\n\n  totals: ${totalQuestions} question(s), ${totalReframed} reframed ` +
        `(${((totalReframed / totalQuestions) * 100).toFixed(0)}%)\n` +
        `  one-stage: ${oneStageTotal} operator turn(s)\n` +
        `  two-stage: ${twoStageTotal} operator turn(s)\n` +
        `  two-stage minus one-stage: ${twoStageTotal - oneStageTotal >= 0 ? "+" : ""}${twoStageTotal - oneStageTotal}\n`,
    );
    expect(perSession).toHaveLength(corpus.sessions.length);
  });

  /**
   * The pre-committed bar, verbatim from the assumption test's threshold: "the
   * two-stage form produces no more total operator turns than the one-stage
   * form did", summed across every recorded session. On this corpus it is
   * false — 33 of 46 recorded questions were answered on the one turn
   * one-stage attempts, and only 13 needed the three-turn reframe-and-reask
   * that framing-first is meant to avoid, which is too low a rate for a design
   * that taxes every question a second turn to win the arithmetic. See the
   * build report for what this means for the solution.
   */
  it("the two-stage form costs no more total operator turns than the one-stage form did", () => {
    expect(
      twoStageTotal,
      `two-stage would have cost ${twoStageTotal} operator turns against one-stage's actual ${oneStageTotal}, ` +
        `across ${totalQuestions} recorded questions (${totalReframed} reframed, ` +
        `${((totalReframed / totalQuestions) * 100).toFixed(0)}%)`,
    ).toBeLessThanOrEqual(oneStageTotal);
  });
});
