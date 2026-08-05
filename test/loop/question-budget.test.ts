/**
 * The budget itself: what is declared, what is measured, and what the operator is
 * told before they walk away.
 *
 * The ordering question — can a run rank its own questions well enough for the
 * budget to buy the right ones — lives in `question-budget-ordering.test.ts`.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatQuestionBudget, measureInterruptions, type QuestionBudget } from "../../src/loop/questions.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ost-questions-"));
}

/** One transcript line, in the shape Claude Code writes. */
function entry(obj: Record<string, unknown>): string {
  return `${JSON.stringify(obj)}\n`;
}

function ask(ts: string, questions: number): Record<string, unknown> {
  return {
    type: "assistant",
    timestamp: ts,
    message: {
      content: [
        { type: "tool_use", name: "AskUserQuestion", id: `t-${ts}`, input: { questions: Array(questions).fill({}) } },
      ],
    },
  };
}

describe("measureInterruptions", () => {
  it("counts one ask as one interruption however many questions it bundles", () => {
    const vault = tempDir();
    const sessions = tempDir();
    fs.writeFileSync(
      path.join(sessions, "s1.jsonl"),
      entry({ type: "user", cwd: vault, timestamp: "2026-08-01T00:00:00Z" }) +
        entry(ask("2026-08-01T01:00:00Z", 3)) +
        entry(ask("2026-08-01T02:00:00Z", 1)),
    );

    const m = measureInterruptions(sessions, { vaultDir: vault, sinceMs: 0 });
    expect(m).toMatchObject({ measurable: true, interruptions: 2, questions: 4, sessions: 1 });
  });

  it("ignores sessions launched from another vault", () => {
    const vault = tempDir();
    const other = tempDir();
    const sessions = tempDir();
    fs.writeFileSync(
      path.join(sessions, "elsewhere.jsonl"),
      entry({ type: "user", cwd: other, timestamp: "2026-08-01T00:00:00Z" }) + entry(ask("2026-08-01T01:00:00Z", 2)),
    );

    expect(measureInterruptions(sessions, { vaultDir: vault, sinceMs: 0 })).toMatchObject({
      measurable: true,
      interruptions: 0,
      sessions: 0,
    });
  });

  it("drops asks that fall before the window", () => {
    const vault = tempDir();
    const sessions = tempDir();
    fs.writeFileSync(
      path.join(sessions, "s1.jsonl"),
      entry({ type: "user", cwd: vault, timestamp: "2026-08-01T00:00:00Z" }) +
        entry(ask("2026-08-01T01:00:00Z", 1)) +
        entry(ask("2026-08-03T01:00:00Z", 1)),
    );

    const m = measureInterruptions(sessions, {
      vaultDir: vault,
      sinceMs: Date.parse("2026-08-02T00:00:00Z"),
    });
    expect(m).toMatchObject({ measurable: true, interruptions: 1 });
  });

  it("survives a corrupt line, losing that entry and not the session", () => {
    const vault = tempDir();
    const sessions = tempDir();
    fs.writeFileSync(
      path.join(sessions, "s1.jsonl"),
      entry({ type: "user", cwd: vault, timestamp: "2026-08-01T00:00:00Z" }) +
        "{not json\n" +
        entry(ask("2026-08-01T01:00:00Z", 1)),
    );

    expect(measureInterruptions(sessions, { vaultDir: vault, sinceMs: 0 })).toMatchObject({
      measurable: true,
      interruptions: 1,
    });
  });

  it("fails closed on a transcript directory it cannot read", () => {
    const vault = tempDir();
    const m = measureInterruptions(path.join(tempDir(), "nope"), { vaultDir: vault, sinceMs: 0 });
    expect(m.measurable).toBe(false);
    // Not zero. "We could not look" and "it never asked" are different claims, and
    // reporting the second for the first is how an unbounded call on the operator's
    // attention reads as a clean one.
    expect(m.measurable === false && m.reason).toContain("unmeasurable");
  });
});

describe("formatQuestionBudget", () => {
  const budget: QuestionBudget = { interruptions: 3, windowHours: 24, sessionsDir: "/tmp/x" };

  it("says UNBOUNDED out loud when nothing is declared", () => {
    expect(formatQuestionBudget(null)).toContain("UNBOUNDED");
  });

  it("states the bound and what is left", () => {
    const line = formatQuestionBudget(budget, { measurable: true, interruptions: 1, questions: 1, sessions: 2 });
    expect(line).toContain("1 of 3 interruption(s)");
    expect(line).toContain("2 left");
  });

  it("names the bundled questions when an ask carried more than one", () => {
    const line = formatQuestionBudget(budget, { measurable: true, interruptions: 2, questions: 5, sessions: 1 });
    expect(line).toContain("carrying 5 question(s)");
  });

  it("never reports a negative remainder once the budget is overspent", () => {
    const line = formatQuestionBudget(budget, { measurable: true, interruptions: 9, questions: 9, sessions: 1 });
    expect(line).toContain("0 left");
    expect(line).not.toContain("-6");
  });

  it("says UNKNOWN rather than a number it does not have", () => {
    const line = formatQuestionBudget(budget, { measurable: false, reason: "cannot read session transcripts" });
    expect(line).toContain("UNKNOWN");
    expect(line).toContain("cannot read session transcripts");
  });

  it("treats a budget of zero as a real bound, not an absent one", () => {
    // The node's own degradation case: zero means bank everything. A formatter that
    // tested truthiness would print UNBOUNDED for the strictest setting there is.
    const line = formatQuestionBudget({ ...budget, interruptions: 0 }, {
      measurable: true,
      interruptions: 0,
      questions: 0,
      sessions: 1,
    });
    expect(line).not.toContain("UNBOUNDED");
    expect(line).toContain("0 of 0 interruption(s)");
  });
});
