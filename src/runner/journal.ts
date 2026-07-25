/**
 * Run journals — the machine-readable record of what each pass did.
 *
 * Every pass writes one JSON journal (`.ost-agent/runs/<stamp>-<processId>.json`)
 * carrying an `error` field that is honest about what happened. Nothing read it:
 * a pass that died on a driver error still exited 0 and printed a tidy summary, so
 * a cron schedule would no-op forever while looking healthy.
 *
 * This module is the reader. The failure rule is deliberately the crudest one that
 * survived a replay of the existing journals (14 replayed: the one known failure
 * caught, none of the 13 healthy runs misclassified): a non-empty `error` means the
 * run failed. No schema change, no new field to maintain.
 */
import fs from "node:fs";
import path from "node:path";

export interface RunJournalEntry {
  /** Journal file name, so an operator can open the raw record. */
  file: string;
  processId: string;
  title?: string;
  /** ISO timestamp written by the pass. */
  at: string;
  /** The failure, verbatim, or null/absent when the pass completed. */
  error?: string | null;
  result?: { created?: number; linked?: number; annotated?: number; evidence?: number };
  done?: boolean;
}

export function runsDir(dir: string): string {
  return path.join(dir, ".ost-agent", "runs");
}

/** The alert rule, in one place: a run failed iff its journal carries an error. */
export function failed(entry: RunJournalEntry): boolean {
  return Boolean(entry.error);
}

/**
 * Every readable run journal, newest first. A corrupt or non-JSON file is skipped
 * rather than thrown on — one bad file must never blind the operator to the rest.
 */
export function readRunJournals(dir: string): RunJournalEntry[] {
  const runs = runsDir(dir);
  if (!fs.existsSync(runs)) return [];
  const entries: RunJournalEntry[] = [];
  for (const file of fs.readdirSync(runs)) {
    if (!file.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(runs, file), "utf8")) as RunJournalEntry;
      if (typeof parsed?.processId !== "string" || typeof parsed?.at !== "string") continue;
      entries.push({ ...parsed, file });
    } catch {
      /* unreadable journal — skip it, but never let it hide a failure elsewhere */
    }
  }
  return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** The most recent failed run, if any. `entries` must be newest-first. */
export function lastFailedRun(entries: RunJournalEntry[]): RunJournalEntry | undefined {
  return entries.find(failed);
}

/** The newest run of each process, ordered by process id. `entries` must be newest-first. */
export function lastRunPerProcess(entries: RunJournalEntry[]): RunJournalEntry[] {
  const latest = new Map<string, RunJournalEntry>();
  for (const e of entries) if (!latest.has(e.processId)) latest.set(e.processId, e);
  return [...latest.values()].sort((a, b) => a.processId.localeCompare(b.processId));
}
