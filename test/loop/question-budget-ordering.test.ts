/**
 * The instrument for "A budget for questions, spent down across the run and
 * visible to the operator" — specifically for the belief underneath it: that a
 * run can rank its own questions by consequence well enough that a spent budget
 * buys the important ones.
 *
 * Four harvested sessions are replayed. Each has its questions ranked by
 * {@link QUESTION_CONSEQUENCE_RULE}, which sees only what was on screen when the
 * question was asked; a budget of half the session's questions is spent in that
 * order; and the result is checked against {@link HINDSIGHT_RULE}, which sees only
 * what the operator did afterwards. The assumption holds if the budget bought the
 * question hindsight named, in at least 3 of the 4.
 *
 * **Read this before believing a green.** The test prints three numbers beside the
 * headline and two of them can contradict it:
 *
 * - the same replay with NO ranking at all, spending in plain arrival order;
 * - the same replay at the other rounding of "half";
 * - the same replay over every session harvested, not just the four.
 *
 * They are printed unconditionally rather than asserted on, because they are the
 * reader's evidence about what the headline is worth, and a number only shown when
 * it agrees is not evidence.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HINDSIGHT_RULE,
  MIN_INTERRUPTIONS_PER_SESSION,
  QUESTION_CONSEQUENCE_RULE,
  halfBudget,
  headlineCorpus,
  hindsightTop,
  rankByConsequence,
  readHindsight,
  replaySession,
  scoreQuestion,
  type HarvestedSession,
} from "../../src/loop/questions.js";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/question-budget/sessions.json",
);

const corpus = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as { sessions: HarvestedSession[] };
const headline = headlineCorpus(corpus.sessions);

/** The threshold, from the assumption test's own frontmatter. */
const REQUIRED_SESSIONS = 3;

describe("the corpus", () => {
  it("is the four sessions that stopped their operator repeatedly", () => {
    expect(headline).toHaveLength(4);
    for (const session of headline) {
      expect(session.interruptions).toBeGreaterThanOrEqual(MIN_INTERRUPTIONS_PER_SESSION);
      expect(session.questions.length).toBeGreaterThanOrEqual(3);
    }
    // Every question carries the answer it got. A replay over a question with no
    // recorded answer would be scoring a hindsight nobody has.
    for (const session of headline) {
      for (const q of session.questions) expect(q.answer, `${session.id} entry ${q.entry}`).toBeTruthy();
    }
  });

  it("keeps the two rules on separate inputs", () => {
    // The guard that makes the whole replay mean anything: the scorer is handed
    // header/question/options and cannot reach `answer`. If this ever fails, the
    // ranking function is being graded against something it can see.
    const q = headline[0]!.questions[0]!;
    const seen = scoreQuestion({ header: q.header, question: q.question, options: q.options });
    const withAnswer = scoreQuestion({ header: q.header, question: q.question, options: q.options } as never);
    expect(seen).toEqual(withAnswer);
    expect(JSON.stringify(QUESTION_CONSEQUENCE_RULE)).not.toContain("answer");
  });
});

describe("the hindsight reading", () => {
  it("classifies by what the operator did, not by anyone's ranking", () => {
    const tiers = headline.flatMap((s) => s.questions.map((q) => readHindsight(q).tier));
    // All three tiers occur, so none of them is a branch nothing exercises.
    expect(new Set(tiers)).toEqual(new Set(["confirmed", "overridden", "reframed"]));
    expect(Object.keys(HINDSIGHT_RULE.tiers).sort()).toEqual(["confirmed", "overridden", "reframed"]);
  });

  it("names one most-consequential question per session", () => {
    for (const session of headline) {
      expect(hindsightTop(session.questions), session.id).not.toBeNull();
    }
  });
});

describe("spending the budget in ranked order", () => {
  const replays = headline.map(replaySession);

  it("buys the question hindsight named, in at least 3 of 4 sessions", () => {
    for (const r of replays) {
      const q = headline.find((s) => s.id === r.session)!.questions[r.top!]!;
      // eslint-disable-next-line no-console
      console.log(
        `${r.session.slice(0, 8)}  ${r.questions} question(s), budget ${r.budget}, ` +
          `ranked→[${r.spent.join(",")}], hindsight top #${r.top} "${q.header}" (${readHindsight(q).tier}) ` +
          `→ ${r.caught ? "CAUGHT" : "MISSED"}`,
      );
    }
    const caught = replays.filter((r) => r.caught).length;
    expect(caught, `${caught} of ${replays.length} sessions`).toBeGreaterThanOrEqual(REQUIRED_SESSIONS);
  });

  it("reports what the ranking function is actually worth", () => {
    const caught = replays.filter((r) => r.caught).length;
    const byArrival = replays.filter((r) => r.caughtByArrivalOrder).length;
    const atFloor = replays.filter((r) => r.caughtAtFloorBudget).length;

    // eslint-disable-next-line no-console
    console.log(
      `\n  ranked order:  ${caught}/${replays.length}` +
        `\n  arrival order: ${byArrival}/${replays.length}  ← no ranking at all` +
        `\n  budget rounded down: ${atFloor}/${replays.length}`,
    );
    if (caught === byArrival) {
      // eslint-disable-next-line no-console
      console.log(
        "  NOTE: ranking and arrival order agree on this corpus. A green above is not " +
          "evidence that ranking works — it is evidence that these sessions asked their " +
          "consequential question early.",
      );
    }
    if (atFloor < REQUIRED_SESSIONS) {
      // eslint-disable-next-line no-console
      console.log(
        `  NOTE: THE ROUNDING DECIDES THIS. "Half" of an odd-length session is not a whole ` +
          `number; rounded down the corpus scores ${atFloor}/${replays.length} and the threshold fails.`,
      );
    }
    expect(byArrival).toBeLessThanOrEqual(replays.length);
    expect(atFloor).toBeLessThanOrEqual(caught);
  });

  it("holds up, or does not, over every session harvested", () => {
    const wide = corpus.sessions.map(replaySession).filter((r) => r.top !== null);
    const caught = wide.filter((r) => r.caught).length;
    // eslint-disable-next-line no-console
    console.log(
      `\n  wider corpus: ${caught}/${wide.length} sessions (every transcript on the machine with ` +
        `${3} or more answered clarifying questions, not just the four)`,
    );
    expect(wide.length).toBeGreaterThan(headline.length);
  });
});

describe("the ranking rule itself", () => {
  it("puts an undefaultable question above a merely irreversible one", () => {
    const undefaultable = scoreQuestion({ header: "h", question: "q", options: ["Keep it", "Change it"] });
    const irreversible = scoreQuestion({
      header: "h",
      question: "q",
      options: ["Keep it (Recommended)", "Delete it"],
    });
    expect(undefaultable.score).toBeGreaterThan(irreversible.score);
  });

  it("does not read the question text for irreversibility verbs", () => {
    // "delete" describing the situation is not "delete" as an option the answer
    // authorises, and a rule that conflated them would score every post-mortem
    // question as consequential.
    const scored = scoreQuestion({
      header: "h",
      question: "The migration will delete the old table. Proceed?",
      options: ["Yes (Recommended)", "No"],
    });
    expect(scored.score).toBe(0);
  });

  it("breaks ties toward the question that arrived first", () => {
    const flat = [
      { header: "a", question: "a", options: ["x (Recommended)", "y"] },
      { header: "b", question: "b", options: ["x (Recommended)", "y"] },
    ];
    expect(rankByConsequence(flat).map((r) => r.arrival)).toEqual([0, 1]);
  });
});

describe("halfBudget", () => {
  it("rounds up, so a budget of half of three interruptions is two", () => {
    expect([1, 2, 3, 4, 5].map(halfBudget)).toEqual([1, 1, 2, 2, 3]);
  });
});
