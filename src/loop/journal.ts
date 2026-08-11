/**
 * The run journal — append-only, written forward, one line per thing that has
 * already finished.
 *
 * `open-run.json` is the working record of a firing, and it has two properties
 * that make it exactly the account an interrupted run cannot leave: it is
 * rewritten wholesale on every step (a kill mid-write can lose every step so
 * far), and it is deleted at seal (the finished account exists only in
 * `runs.jsonl`, which is written at the end). A run that dies partway therefore
 * reports nothing durable about what it completed, and the next pass has to
 * infer its progress from side effects — the failure recorded in the meta
 * vault on 2026-07-24, when a backgrounded builder pass left no marker of what
 * it had finished.
 *
 * The journal is the forward-written counterpart. Every line is appended at
 * the moment the thing it names has fully happened — the run opened, a step's
 * command exited, the run sealed — so the file's tail is always the last thing
 * that actually worked, and reading the state of a half-finished run is
 * reading the end of a file. Nothing here is summarised at the end, because
 * anything summarised at the end is missing precisely when it is needed.
 *
 * **The half-finished step is recorded by omission, deliberately.** A journal
 * can log a step before it completes (and overstate when killed mid-step) or
 * after (and understate when killed in the instant between completion and the
 * append). This journal logs after: a line here is a claim a reader acts on,
 * and a claimed step that never happened sends them to debug work that was
 * done, while a missing final step costs at worst one re-check of something
 * idempotent. The assumption test's threshold encodes the same choice — zero
 * overstatement tolerated, understatement by one step tolerated rarely.
 *
 * Writes are unguarded for the same reason as `health.ts`: the journal lives
 * in the same directory as `runs.jsonl`, so a directory that can hold the
 * ledger can hold this, and a firing that cannot record must not pretend it
 * ran.
 */
import fs from "node:fs";
import path from "node:path";
import { requireLoopStateDir, loopStateDir } from "./state.js";
// Type-only, so nothing at runtime imports back into this file — `health.ts`
// is the journal's only writer and imports this module for real.
import type { LoopVerdict } from "./health.js";

/** A run began. Present so a tail with no later lines reads "started, finished nothing". */
export interface JournalOpen {
  kind: "open";
  runId: string;
  at: string;
}

/**
 * A step's command ran to completion and this is what it produced. Appended
 * only after the exit code is in hand — never before the command runs.
 */
export interface JournalStep {
  kind: "step";
  runId: string;
  phase: string;
  command: string;
  /** Where the command ran, when the recorder knew — same field, same reason as `LoopStepRecord.cwd`. */
  cwd?: string;
  exit: number;
  at: string;
}

/** The run reached its end and sealed with this verdict. */
export interface JournalSeal {
  kind: "seal";
  runId: string;
  verdict: LoopVerdict;
  at: string;
}

/**
 * A later process found this run's marker unsealed and swept it. Written by
 * the sweeper, not the dead run — the one line in this file that a run's own
 * process can never append about itself.
 */
export interface JournalCrash {
  kind: "crash";
  runId: string;
  at: string;
}

export type JournalEntry = JournalOpen | JournalStep | JournalSeal | JournalCrash;

const KINDS = new Set<JournalEntry["kind"]>(["open", "step", "seal", "crash"]);

export function journalPath(dir: string): string {
  return path.join(requireLoopStateDir(dir), "journal.jsonl");
}

export function appendJournal(dir: string, entry: JournalEntry): void {
  fs.appendFileSync(journalPath(dir), JSON.stringify(entry) + "\n");
}

/**
 * Every readable journal line, in the order it was written.
 *
 * A line that does not parse is skipped rather than thrown on. That is not the
 * usual corrupt-input hygiene: a process killed mid-append is precisely the
 * event this file exists to survive, and the residue it leaves is a truncated
 * final line. The lines before it are intact — append never rewrites — so the
 * reader's job is to return them, not to refuse the file.
 */
export function readJournal(dir: string): JournalEntry[] {
  const state = loopStateDir(dir);
  if (state === null) return [];
  const p = path.join(state, "journal.jsonl");
  if (!fs.existsSync(p)) return [];
  const entries: JournalEntry[] = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as JournalEntry;
      if (typeof parsed?.runId !== "string") continue;
      if (!KINDS.has(parsed?.kind)) continue;
      entries.push(parsed);
    } catch {
      /* truncated or corrupt line — the entries around it are still the record */
    }
  }
  return entries;
}
