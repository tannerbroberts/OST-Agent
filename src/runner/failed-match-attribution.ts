/**
 * Classify a failed string replacement against the run's own record of what it
 * has read — the disambiguation the raw error cannot give.
 *
 * A literal-match editor reports `String to replace not found in file` for two
 * causes that look identical from the message alone: the file changed since the
 * run read it (a second writer moved the ground), or the run quoted the file
 * wrong (its own mistake, on content that never moved). An agent that reaches
 * the right diagnosis today does it by hand, after the fact, from `HEAD` and
 * file mtimes — reconstructible in one observed session, absent everywhere
 * else the same error recurs. This module makes that reconstruction automatic.
 *
 * **The third arm is load-bearing.** A run may fail a match on a file it never
 * read this pass — through a tool whose reads are not journalled, or before
 * this run started at all. Answering "changed" or "wrong quote" there is a
 * guess dressed as a finding, so a file with no journalled read gets an
 * explicit `cannot-say` instead. A two-arm version that always answers
 * "changed" would pass every test that only checks the other two arms.
 *
 * **What this does not do.** It does not journal reads itself — the caller
 * decides what counts as a read and calls {@link ReadJournal.recordRead} at
 * that moment — and it does not decide what a run should do with the verdict
 * (re-read, merge, ask). It only answers, once a match has already failed,
 * which of the two ordinary causes it was, or that the run cannot say.
 *
 * Distinct from `../git/read-write-hash-guard.ts`, which refuses a write
 * *before* it happens by presenting the read's hash back to it. This
 * classifies a failure that guard was never asked about — a write some other
 * editor already let through, or refused for a reason that was never drift.
 */
import fs from "node:fs";
import { hashContent } from "../git/read-write-hash-guard.js";

/** The run's record of what it has read this pass: file path to content hash, at the moment of the read. */
export class ReadJournal {
  private readonly hashes = new Map<string, string>();

  /** Record that this run read `filePath` and it held `content`, right now. */
  recordRead(filePath: string, content: string): void {
    this.hashes.set(filePath, hashContent(content));
  }

  /** The hash this journal holds for `filePath`, or `undefined` if this run never journalled a read of it. */
  hashAt(filePath: string): string | undefined {
    return this.hashes.get(filePath);
  }
}

export type FailedMatchAttribution =
  /** The file's content hash has moved since the journalled read — a second writer, not a bad quote. */
  | { kind: "stale-file"; filePath: string; journalledHash: string; currentHash: string }
  /** The file is byte-identical to the journalled read — the replacement text simply never matched it. */
  | { kind: "bad-quote"; filePath: string; hash: string }
  /** No journalled read exists for this file this run — attribution cannot be made, and is not guessed. */
  | { kind: "cannot-say"; filePath: string; reason: string };

/**
 * Classify a failed string replacement against `filePath` using what `journal`
 * knows. Re-reads the file from disk now — the one comparison the raw error
 * never makes — and answers the question a `String to replace not found`
 * message cannot: did the file change since the run read it, or did the run
 * quote it wrong?
 */
export function classifyFailedMatch(journal: ReadJournal, filePath: string): FailedMatchAttribution {
  const journalledHash = journal.hashAt(filePath);
  if (journalledHash === undefined) {
    return {
      kind: "cannot-say",
      filePath,
      reason: `no journalled read of ${filePath} exists for this run — the failure cannot be attributed ` +
        `to a stale file or a bad quote without a recorded read to compare against.`,
    };
  }
  const currentContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const currentHash = hashContent(currentContent);
  if (currentHash !== journalledHash) {
    return { kind: "stale-file", filePath, journalledHash, currentHash };
  }
  return { kind: "bad-quote", filePath, hash: currentHash };
}

/** The verdict, in one line a person or a transcript reader can act on without decoding the union. */
export function describeFailedMatchAttribution(attribution: FailedMatchAttribution): string {
  switch (attribution.kind) {
    case "stale-file":
      return `the file changed since you read it: ${attribution.filePath} — re-read it before retrying the replacement.`;
    case "bad-quote":
      return `${attribution.filePath} is unchanged since you read it — the replacement text does not match its ` +
        `content, so the quote is wrong, not the file.`;
    case "cannot-say":
      return `cannot attribute the failed match on ${attribution.filePath}: ${attribution.reason}`;
  }
}
