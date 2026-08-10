/**
 * Blind-judge what could have continued, before reading the answer that was given.
 *
 * The instrument for the meta vault's assumption test of the same name. Seventeen
 * recorded AskUserQuestion stops across nine captured conversations
 * (`test/fixtures/question-stops/` — read PROVENANCE.md before believing anything
 * here). For each stop, the dependence rule is shown ONLY what was visible at ask
 * time — the question, the options, and the outstanding work's text — and must
 * partition that work into can-proceed and turns-on-the-answer. The partition is
 * then compared against what the session actually did once it had the answer,
 * which is the `turnsOnAnswer` label read off the unsealed remainder.
 *
 * The bar was pre-committed in the vault node before any of this existed:
 * at least 12 of 17 stops must agree, with at most 2 false-independent calls
 * across the whole set. The two numbers are not equally important — a
 * false-independent call is work a real run would have completed on a wrong
 * footing and reported as finished, which the parent opportunity says is worse
 * than stalling. They are asserted separately so a failure names which kind it is.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bankQuestion,
  partitionOutstanding,
  readQuestionBank,
  type AskedFork,
} from "../../src/loop/question-bank.js";

interface FixtureStop {
  session: string;
  entry: number;
  askedAt: string;
  header: string;
  question: string;
  options: string[];
  answer: string;
  outstanding: { work: string; turnsOnAnswer: boolean; why: string }[];
}

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/question-stops/stops.json"), "utf8"),
) as { stops: FixtureStop[] };

/** What the rule is allowed to see: ask-time fields only, never labels or answers. */
function askTimeView(stop: FixtureStop): { fork: AskedFork; outstanding: string[] } {
  return {
    fork: { header: stop.header, question: stop.question, options: stop.options },
    outstanding: stop.outstanding.map((o) => o.work),
  };
}

describe("the corpus is the one the assumption test named", () => {
  it("holds seventeen answered stops across nine conversations", () => {
    expect(fixture.stops).toHaveLength(17);
    expect(new Set(fixture.stops.map((s) => s.session)).size).toBe(9);
  });

  it("every stop carries an unsealed answer and at least one labelled item", () => {
    for (const stop of fixture.stops) {
      expect(stop.answer.length, `${stop.session}@${stop.entry}`).toBeGreaterThan(0);
      expect(stop.outstanding.length, `${stop.session}@${stop.entry}`).toBeGreaterThan(0);
    }
  });
});

describe("replaying the seventeen stops blind", () => {
  const replays = fixture.stops.map((stop) => {
    const { fork, outstanding } = askTimeView(stop);
    const partition = partitionOutstanding(fork, outstanding);
    const calls = stop.outstanding.map((truth) => {
      const call = partition.calls.find((c) => c.work === truth.work);
      if (call === undefined) throw new Error(`no call for "${truth.work}"`);
      return { truth, call };
    });
    return {
      stop: `${stop.session.slice(0, 8)}@${stop.entry} (${stop.header})`,
      agrees: calls.every(({ truth, call }) => truth.turnsOnAnswer === call.turnsOnAnswer),
      falseIndependents: calls.filter(({ truth, call }) => truth.turnsOnAnswer && !call.turnsOnAnswer),
    };
  });

  it("agrees with what the session actually did on at least 12 of the 17 stops", () => {
    const agreed = replays.filter((r) => r.agrees);
    const detail = replays.map((r) => `${r.agrees ? "  agree" : "DISAGREE"}  ${r.stop}`).join("\n");
    expect(agreed.length, `\n${detail}\n`).toBeGreaterThanOrEqual(12);
  });

  it("makes at most 2 false-independent calls across the whole set", () => {
    const falseIndependents = replays.flatMap((r) =>
      r.falseIndependents.map((f) => `${r.stop}: "${f.truth.work}" — truth: ${f.truth.why}`),
    );
    expect(falseIndependents.length, `\n${falseIndependents.join("\n")}\n`).toBeLessThanOrEqual(2);
  });
});

describe("the write side — a run can bank the question with the work it holds up", () => {
  it("banks a fork with its partition and cost, and reads it back", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "question-bank-"));
    const stop = fixture.stops[0];
    const { fork, outstanding } = askTimeView(stop);
    const banked = bankQuestion(dir, {
      askedAt: stop.askedAt,
      fork,
      wouldPick: stop.options[0],
      why: "replay smoke: the option the run marked as its default",
      outstanding,
    });
    expect(banked.cost).toBe(banked.partition.turnsOnAnswer.length);
    expect(banked.partition.canProceed.length + banked.partition.turnsOnAnswer.length).toBe(
      outstanding.length,
    );

    const read = readQuestionBank(dir);
    expect(read).toHaveLength(1);
    expect(read[0].fork.header).toBe(stop.header);
    expect(read[0].partition.turnsOnAnswer).toEqual(banked.partition.turnsOnAnswer);
  });

  it("an empty or absent bank reads as empty, never as an error", () => {
    expect(readQuestionBank(path.join(os.tmpdir(), "no-such-question-bank"))).toEqual([]);
  });
});
