import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  answerPromptUnattended,
  classifyPrompt,
  loadPromptPolicy,
  noTerminalAttached,
  parsePromptPolicy,
  PromptRequiresTerminalError,
  readPolicyJournal,
  type PromptPolicyLine,
} from "../../src/runner/no-tty-policy.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-no-tty-policy-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const CHECK_UPDATES: PromptPolicyLine = {
  id: "decline-update-check",
  test: (p) => /check for updates\?/i.test(p),
  answer: "n",
};

describe("noTerminalAttached", () => {
  test("true when stdin has no TTY", () => {
    expect(noTerminalAttached({ isTTY: false })).toBe(true);
    expect(noTerminalAttached({})).toBe(true);
  });
  test("false when a real terminal is attached", () => {
    expect(noTerminalAttached({ isTTY: true })).toBe(false);
  });
});

describe("classifyPrompt", () => {
  test("a recognised prompt is answered from the policy line that covers it", () => {
    const outcome = classifyPrompt("Check for updates? (Y/n)", [CHECK_UPDATES]);
    expect(outcome).toEqual({ kind: "answered", policyId: "decline-update-check", answer: "n" });
  });

  test("a prompt outside the policy is neither answered nor guessed at", () => {
    const outcome = classifyPrompt("Enter your passphrase:", [CHECK_UPDATES]);
    expect(outcome).toEqual({ kind: "no-policy" });
  });

  test("a destructive overwrite stops the run even with an empty policy", () => {
    const outcome = classifyPrompt("overwrite src/web/budget.ts? (y/n [n])", []);
    expect(outcome).toEqual({ kind: "must-stop", classId: "destructive-overwrite" });
  });

  test("a force push stops the run even with an empty policy", () => {
    const outcome = classifyPrompt("git push --force origin main — continue?", []);
    expect(outcome).toEqual({ kind: "must-stop", classId: "force-push" });
  });

  test("must-stop wins even when a policy line is written to cover the same prompt", () => {
    // The node states the boundary is the operator's to set, not a policy
    // file's to widen — a policy line cannot pull an overwrite prompt back
    // into the answerable set.
    const overreaching: PromptPolicyLine = { id: "always-overwrite", test: (p) => /overwrite/i.test(p), answer: "y" };
    const outcome = classifyPrompt("overwrite dist/ost-agent.mjs? (y/n)", [overreaching]);
    expect(outcome).toEqual({ kind: "must-stop", classId: "destructive-overwrite" });
  });
});

describe("answerPromptUnattended", () => {
  test("refuses to run at all when a terminal is attached", () => {
    expect(() =>
      answerPromptUnattended({ prompt: "Check for updates? (Y/n)", journalDir: dir, stdin: { isTTY: true }, policy: [CHECK_UPDATES] }),
    ).toThrow(/terminal attached/);
  });

  test("answers a recognised prompt and journals the question, the answer, and the citation", () => {
    const answer = answerPromptUnattended({
      prompt: "Check for updates? (Y/n)",
      journalDir: dir,
      stdin: { isTTY: false },
      policy: [CHECK_UPDATES],
      now: () => "2026-08-18T00:00:00.000Z",
    });
    expect(answer).toBe("n");

    const entries = readPolicyJournal(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      question: "Check for updates? (Y/n)",
      answer: "n",
      policyLine: "decline-update-check",
      at: "2026-08-18T00:00:00.000Z",
    });
  });

  test("a must-stop prompt throws instead of being answered, and nothing is journalled", () => {
    expect(() =>
      answerPromptUnattended({
        prompt: "overwrite src/web/budget.ts? (y/n [n])",
        journalDir: dir,
        stdin: { isTTY: false },
        policy: [],
      }),
    ).toThrow(PromptRequiresTerminalError);
    expect(readPolicyJournal(dir)).toHaveLength(0);
  });

  test("a must-stop error names the class it matched", () => {
    try {
      answerPromptUnattended({ prompt: "force push to origin?", journalDir: dir, stdin: { isTTY: false }, policy: [] });
      throw new Error("expected answerPromptUnattended to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PromptRequiresTerminalError);
      expect((err as PromptRequiresTerminalError).reason).toBe("must-stop");
      expect((err as PromptRequiresTerminalError).classId).toBe("force-push");
    }
  });

  test("a prompt outside the policy stops the run rather than being guessed at, and nothing is journalled", () => {
    expect(() =>
      answerPromptUnattended({ prompt: "Enter your passphrase:", journalDir: dir, stdin: { isTTY: false }, policy: [CHECK_UPDATES] }),
    ).toThrow(PromptRequiresTerminalError);
    expect(readPolicyJournal(dir)).toHaveLength(0);
  });

  test("two answered prompts append two lines, in order", () => {
    const other: PromptPolicyLine = { id: "press-any-key", test: (p) => /press any key/i.test(p), answer: "\n" };
    answerPromptUnattended({ prompt: "Check for updates? (Y/n)", journalDir: dir, stdin: { isTTY: false }, policy: [CHECK_UPDATES, other] });
    answerPromptUnattended({ prompt: "Press any key to continue", journalDir: dir, stdin: { isTTY: false }, policy: [CHECK_UPDATES, other] });
    const entries = readPolicyJournal(dir);
    expect(entries.map((e) => e.policyLine)).toEqual(["decline-update-check", "press-any-key"]);
  });
});

describe("parsePromptPolicy / loadPromptPolicy — the policy an operator wrote and can read", () => {
  test("compiles a plain-JSON policy into matchers", () => {
    const policy = parsePromptPolicy([{ id: "decline-update-check", match: "check for updates\\?", answer: "n" }]);
    expect(classifyPrompt("Check for updates? (Y/n)", policy)).toEqual({
      kind: "answered",
      policyId: "decline-update-check",
      answer: "n",
    });
  });

  test("refuses a policy line missing a required field", () => {
    expect(() => parsePromptPolicy([{ id: "no-match-field", answer: "n" }])).toThrow(/"match"/);
    expect(() => parsePromptPolicy([{ match: "x", answer: "n" }])).toThrow(/"id"/);
    expect(() => parsePromptPolicy("not an array")).toThrow(/JSON array/);
  });

  test("loads and compiles a policy file from disk", () => {
    const file = path.join(dir, "prompt-policy.json");
    fs.writeFileSync(file, JSON.stringify([{ id: "decline-update-check", match: "check for updates\\?", answer: "n" }]));
    const policy = loadPromptPolicy(file);
    expect(classifyPrompt("check for updates?", policy)).toMatchObject({ kind: "answered", policyId: "decline-update-check" });
  });
});
