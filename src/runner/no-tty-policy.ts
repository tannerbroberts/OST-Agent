/**
 * Answer a prompt on the operator's behalf when no terminal is attached —
 * from a written policy, never from a guess.
 *
 * Built for "Detect that no terminal is attached and answer the prompt from a
 * stated policy" (vault). The opportunity it serves is a run that hangs mid-
 * command on a question a tool asked expecting a human at a keyboard, with
 * nothing about the stop announcing itself. The node is explicit about the
 * boundary that makes answering acceptable rather than reckless: every answer
 * is recorded with the question, the answer given, and the policy line that
 * supplied it, and some prompts — a destructive overwrite, a force push —
 * must stop the run no matter what any policy says.
 *
 * **What this does not do.** It does not intercept a real child process's
 * stdin — that is a pty-level integration this module leaves for whatever
 * wires a policy into an actual spawned command. What it does is the decision
 * a caller needs at that integration point: given a no-terminal run and a
 * prompt's text, decide must-stop / answered / no-policy, and journal the
 * ones it answers. The must-stop classes are not a parameter — a policy
 * cannot widen past them, because the boundary of that grant is the
 * operator's to set and not a policy file's to loosen.
 */
import fs from "node:fs";
import path from "node:path";

/** One line of a written policy: a prompt shape, and the answer given for it. */
export interface PromptPolicyLine {
  /** The citation recorded in the journal — identifies which line answered. */
  id: string;
  /** True when this line applies to the prompt's text. */
  test: (prompt: string) => boolean;
  /** The answer given on the operator's behalf. */
  answer: string;
}

/** A class of prompt that stops the run no matter what any policy says. */
export interface MustStopClass {
  id: string;
  test: (prompt: string) => boolean;
}

/**
 * Fixed, not a parameter to anything a caller can override. A policy file can
 * add answers; it cannot remove this list from the check. Kept to the two
 * classes the node itself names — narrow on purpose, so a future addition is
 * a visible edit here rather than a silent widening of what "must-stop"
 * covers.
 */
export const MUST_STOP_CLASSES: readonly MustStopClass[] = [
  {
    id: "destructive-overwrite",
    test: (p) => /\boverwrit(e|ing|ten)\b/i.test(p),
  },
  {
    id: "force-push",
    test: (p) => /force[- ]push|push\s+--force|push\s+-f\b|push\s+\+\S/i.test(p),
  },
];

/** Outside the two fixed classes, an operator has written nothing yet. */
export const DEFAULT_PROMPT_POLICY: readonly PromptPolicyLine[] = [];

export type PromptOutcome =
  | { kind: "answered"; policyId: string; answer: string }
  | { kind: "must-stop"; classId: string }
  | { kind: "no-policy" };

/** True when nothing at the other end of stdin can answer a real prompt. */
export function noTerminalAttached(stdin: { isTTY?: boolean } = process.stdin): boolean {
  return !stdin.isTTY;
}

/**
 * Classify one prompt. Must-stop is checked first and cannot be shadowed by a
 * policy line that also matches — `classifyPrompt` never reaches `policy` for
 * a prompt {@link MUST_STOP_CLASSES} already claimed.
 */
export function classifyPrompt(prompt: string, policy: readonly PromptPolicyLine[] = DEFAULT_PROMPT_POLICY): PromptOutcome {
  for (const cls of MUST_STOP_CLASSES) {
    if (cls.test(prompt)) return { kind: "must-stop", classId: cls.id };
  }
  for (const line of policy) {
    if (line.test(prompt)) return { kind: "answered", policyId: line.id, answer: line.answer };
  }
  return { kind: "no-policy" };
}

/** One answer given on the operator's behalf, as the journal records it. */
export interface PolicyJournalEntry {
  question: string;
  answer: string;
  policyLine: string;
  at: string;
}

export function policyJournalPath(dir: string): string {
  return path.join(dir, "no-tty-policy-answers.jsonl");
}

function appendPolicyJournal(dir: string, entry: PolicyJournalEntry): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(policyJournalPath(dir), JSON.stringify(entry) + "\n");
}

/** Every answer this run has given, in the order it gave them. */
export function readPolicyJournal(dir: string): PolicyJournalEntry[] {
  const p = policyJournalPath(dir);
  if (!fs.existsSync(p)) return [];
  const entries: PolicyJournalEntry[] = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    entries.push(JSON.parse(line) as PolicyJournalEntry);
  }
  return entries;
}

/**
 * Raised when a prompt cannot be answered on the operator's behalf: either it
 * is in a must-stop class, or it is outside the policy entirely. Both cases
 * are the same instruction to the caller — stop, do not guess — with the
 * reason attached so the run can say which.
 */
export class PromptRequiresTerminalError extends Error {
  constructor(
    public readonly prompt: string,
    public readonly reason: "must-stop" | "no-policy",
    public readonly classId?: string,
  ) {
    super(
      reason === "must-stop"
        ? `prompt matches the must-stop class "${classId}" — this stops the run no matter what any policy says: ${prompt}`
        : `prompt is outside the written policy — stopping rather than guessing: ${prompt}`,
    );
    this.name = "PromptRequiresTerminalError";
  }
}

/**
 * Answer one prompt for a run with no attached terminal, or throw so the
 * caller stops rather than guesses.
 *
 * Refuses outright if a terminal IS attached (`noTerminalAttached` false) —
 * this function exists for the run that has nobody to ask, not as a shortcut
 * past an interactive one.
 */
export function answerPromptUnattended(params: {
  prompt: string;
  journalDir: string;
  stdin?: { isTTY?: boolean };
  policy?: readonly PromptPolicyLine[];
  now?: () => string;
}): string {
  const stdin = params.stdin ?? process.stdin;
  if (!noTerminalAttached(stdin)) {
    throw new Error("answerPromptUnattended called with a terminal attached — let the real prompt run");
  }
  const outcome = classifyPrompt(params.prompt, params.policy ?? DEFAULT_PROMPT_POLICY);
  if (outcome.kind !== "answered") {
    throw new PromptRequiresTerminalError(params.prompt, outcome.kind, "classId" in outcome ? outcome.classId : undefined);
  }
  const now = params.now ?? (() => new Date().toISOString());
  appendPolicyJournal(params.journalDir, {
    question: params.prompt,
    answer: outcome.answer,
    policyLine: outcome.policyId,
    at: now(),
  });
  return outcome.answer;
}

/**
 * Compile a policy an operator wrote as plain, readable JSON — an array of
 * `{id, match, answer}`, `match` a regex source matched case-insensitively —
 * into the matcher form {@link classifyPrompt} and {@link answerPromptUnattended}
 * take. Kept separate from the answering path so a malformed policy file
 * fails at load time, once, rather than on the run's first prompt.
 */
export function parsePromptPolicy(json: unknown): PromptPolicyLine[] {
  if (!Array.isArray(json)) throw new Error("prompt policy must be a JSON array of {id, match, answer}");
  return json.map((raw, i) => {
    const row = raw as { id?: unknown; match?: unknown; answer?: unknown };
    if (typeof row.id !== "string" || row.id.trim().length === 0) {
      throw new Error(`prompt policy line ${i}: "id" must be a non-empty string`);
    }
    if (typeof row.match !== "string" || row.match.trim().length === 0) {
      throw new Error(`prompt policy line ${i} ("${row.id}"): "match" must be a non-empty regex string`);
    }
    if (typeof row.answer !== "string") {
      throw new Error(`prompt policy line ${i} ("${row.id}"): "answer" must be a string`);
    }
    const regex = new RegExp(row.match, "i");
    return { id: row.id, answer: row.answer, test: (p: string) => regex.test(p) };
  });
}

/** Load and compile a policy file at `filePath`. */
export function loadPromptPolicy(filePath: string): PromptPolicyLine[] {
  return parsePromptPolicy(JSON.parse(fs.readFileSync(filePath, "utf8")));
}
