/**
 * A sweep states what it read before it states what it found — and a sweep that
 * read nothing is a failure, not a clean run.
 *
 * **The failure this exists to stop.** A sweep-shaped check ("walk a set, report
 * every entry that violates X") has two ways to come out with an empty findings
 * list. It looked at everything and everything was fine, or it looked at nothing.
 * Those are opposite facts and this codebase has shipped them under the same
 * sentence more than once: a CORS sweep over a directory that had moved, a schema
 * validator with nothing in its allowlist to validate, an em-dash sweep whose
 * subject shrank without anybody noticing. Each reported zero findings. Each was
 * read as clean.
 *
 * So the report here is built from a declared subject rather than from a findings
 * array. {@link SweepSubject} carries two numbers — how many subjects the sweep
 * was *offered* and how many it actually *read* — and every outcome is derived
 * from those before the findings are looked at. Zero read is `blind`, exits
 * non-zero, and cannot be spelled "clean" because there is no branch that spells
 * it that way.
 *
 * **What this is a floor for, and what it is not.** The guard fires on total
 * blindness only. The em-dash sweep that motivated it read 302 of 306 entries, so
 * this would have stayed silent on the very failure that produced it — the
 * solution node says as much, out loud, and that concession is the reason the
 * second half of this module exists. Partial blindness is not caught, it is
 * *recorded*: {@link recordSweepRun} writes the offered/read pair for every run,
 * and {@link blindnessCensus} replays those records to say how many runs were
 * blind all the way rather than partly. Whether the guard is worth its keep is a
 * reading taken off that census by an operator, not a claim made here.
 *
 * The census reports what it could not classify as loudly as what it could. A run
 * whose record does not preserve a subject count is not evidence of anything, and
 * counting it as `full` would be the same rounding this module exists to refuse.
 */
import fs from "node:fs";
import path from "node:path";
import { loopStateDir, requireLoopStateDir } from "../loop/state.js";

/**
 * What a sweep had in front of it, in the two numbers that separate the cases.
 *
 * `offered` is the size of the subject as the sweep found it — files in the
 * directory, nodes in the tree, rows in the ledger. `read` is how many of those
 * it got as far as examining. They differ whenever an entry is skipped, and a
 * skip is exactly the event that goes unremarked: a parse failure swallowed to
 * keep the walk alive costs one subject and no words.
 */
export interface SweepSubject {
  readonly offered: number;
  readonly read: number;
}

/**
 * How much of its subject a run actually reached.
 *
 * `unrecorded` is not a fourth degree of blindness — it is the absence of the
 * measurement, kept as its own value so a census can never quietly fold an
 * unknown into `full`.
 */
export type Blindness = "full" | "partly-blind" | "totally-blind" | "unrecorded";

/**
 * What a sweep is allowed to say it was.
 *
 * There are three, and `blind` outranks the other two: a run that read nothing
 * has no findings to report and no denominator to have been clean over.
 */
export type SweepOutcome = "blind" | "clean" | "findings";

export interface SweepReport {
  /** The sweep's name, as it appears in the ledger and in the operator's line. */
  readonly name: string;
  readonly subject: SweepSubject;
  readonly findings: number;
  readonly outcome: SweepOutcome;
  readonly blindness: Blindness;
  /** 0 only for `clean`. `blind` and `findings` both exit non-zero. */
  readonly exitCode: number;
  /** The lines an operator reads, denominator first. */
  readonly lines: readonly string[];
}

/**
 * Classify a subject, before any finding is consulted.
 *
 * `offered === 0` is `totally-blind` and not some fifth state meaning "nothing to
 * do". A sweep pointed at an empty directory and a sweep pointed at a directory
 * that has moved are indistinguishable from inside the sweep, and the honest
 * answer to "was this clean?" in both cases is that nobody looked at anything.
 */
export function classifySubject(subject: SweepSubject): Exclude<Blindness, "unrecorded"> {
  const { offered, read } = subject;
  if (read > offered) {
    throw new Error(
      `a sweep cannot read ${read} of ${offered} subject(s) — \`offered\` is the size of the set and \`read\` a part of it`,
    );
  }
  if (read === 0) return "totally-blind";
  return read < offered ? "partly-blind" : "full";
}

/**
 * The verdict, the exit code and the operator's lines for one run.
 *
 * The denominator leads every line on purpose. "0 findings" is the sentence that
 * has been wrong here; "0 findings over 306 records" cannot be, because the
 * number that would have shown the blindness is in the same breath as the result.
 */
export function sweepReport(name: string, subject: SweepSubject, findings: number): SweepReport {
  const blindness = classifySubject(subject);
  const { offered, read } = subject;
  const skipped = offered - read;

  if (blindness === "totally-blind") {
    return {
      name,
      subject,
      findings,
      outcome: "blind",
      blindness,
      exitCode: 1,
      lines: [
        `${name}: BLIND — read 0 of ${offered} subject(s), so this run found nothing because it looked at nothing.`,
        `  A sweep with an empty subject is a failure, not a pass. Check that what it was pointed at is still there.`,
      ],
    };
  }

  const denominator =
    skipped > 0
      ? `${read} of ${offered} subject(s) (${skipped} skipped — this run was partly blind)`
      : `${read} of ${offered} subject(s)`;

  if (findings > 0) {
    return {
      name,
      subject,
      findings,
      outcome: "findings",
      blindness,
      exitCode: 1,
      lines: [`${name}: ${findings} finding(s) over ${denominator}.`],
    };
  }

  return {
    name,
    subject,
    findings,
    outcome: "clean",
    blindness,
    exitCode: 0,
    lines: [`${name}: clean — 0 findings over ${denominator}.`],
  };
}

/**
 * One line of the sweep ledger: what a run had in front of it and what it did.
 *
 * `subject` is optional because the records this replays are not all going to be
 * written by this module. A run recorded before the subject count existed is a
 * run nobody can classify, and the field's absence is how the census learns that
 * — see {@link classifyRun}.
 */
export interface RecordedSweepRun {
  readonly sweep: string;
  /** ISO timestamp, supplied by the caller so nothing here reads the clock. */
  readonly at: string;
  readonly subject?: SweepSubject;
  readonly findings?: number;
  readonly outcome?: SweepOutcome;
  /** Set on a placeholder standing in for a ledger line that would not parse. */
  readonly unreadable?: boolean;
}

/**
 * How much of its subject a *recorded* run reached.
 *
 * A record with no subject reads `unrecorded`, and a record whose subject is
 * malformed does too — `read` above `offered` is not a run that was thorough, it
 * is a record nobody can take a reading off.
 */
export function classifyRun(run: RecordedSweepRun): Blindness {
  if (!run.subject) return "unrecorded";
  const { offered, read } = run.subject;
  if (!Number.isFinite(offered) || !Number.isFinite(read) || offered < 0 || read < 0 || read > offered) {
    return "unrecorded";
  }
  return classifySubject(run.subject);
}

export interface BlindnessCensus {
  /** Every run the replay read, classified or not. The denominator. */
  readonly runs: number;
  readonly full: number;
  readonly partlyBlind: number;
  readonly totallyBlind: number;
  /**
   * Runs whose record does not preserve a usable subject count.
   *
   * Reported beside the rest rather than divided out of it: if this number is
   * large the finding is about the records and not about blindness at all.
   */
  readonly unclassifiable: number;
  /** Of the unclassifiable, how many were ledger lines that would not parse. */
  readonly unreadable: number;
  /** Classified runs that did not reach their whole subject. */
  readonly nonFull: number;
  /**
   * `totallyBlind / nonFull` — the ratio the guard's worth is read off — or null
   * when no non-full run was classified and there is no ratio to report.
   */
  readonly totallyBlindShareOfNonFull: number | null;
}

/** Replay recorded runs and say how many were blind all the way rather than partly. */
export function blindnessCensus(runs: readonly RecordedSweepRun[]): BlindnessCensus {
  let full = 0;
  let partlyBlind = 0;
  let totallyBlind = 0;
  let unclassifiable = 0;
  let unreadable = 0;
  for (const run of runs) {
    if (run.unreadable) unreadable++;
    switch (classifyRun(run)) {
      case "full":
        full++;
        break;
      case "partly-blind":
        partlyBlind++;
        break;
      case "totally-blind":
        totallyBlind++;
        break;
      default:
        unclassifiable++;
    }
  }
  const nonFull = partlyBlind + totallyBlind;
  return {
    runs: runs.length,
    full,
    partlyBlind,
    totallyBlind,
    unclassifiable,
    unreadable,
    nonFull,
    totallyBlindShareOfNonFull: nonFull === 0 ? null : totallyBlind / nonFull,
  };
}

/**
 * The census as an operator reads it.
 *
 * The unclassifiable count is on its own line and never folded into a percentage,
 * because the reading it supports is a different one: a replay that cannot
 * classify most of its runs has found a gap in the records, not a rate of
 * blindness. And no threshold is applied here — whether the share is high enough
 * to justify the guard is the operator's call, and a module that answered it
 * would be the check grading its own homework.
 */
export function formatBlindnessCensus(census: BlindnessCensus): string {
  const lines: string[] = [];
  lines.push(
    `Sweep blindness: ${census.runs} recorded run(s) — ${census.full} read their whole subject, ` +
      `${census.partlyBlind} partly blind, ${census.totallyBlind} totally blind.`,
  );
  const share =
    census.totallyBlindShareOfNonFull === null
      ? "no run fell short of its subject, so there is no share to report"
      : `${Math.round(census.totallyBlindShareOfNonFull * 100)}% of the ${census.nonFull} non-full run(s) were totally blind`;
  lines.push(`  ${share}.`);
  lines.push(
    `  ${census.unclassifiable} run(s) could not be classified because the record preserves no subject count` +
      (census.unreadable > 0 ? ` (${census.unreadable} of them unparseable ledger line(s))` : "") +
      `.`,
  );
  if (census.unclassifiable > census.runs - census.unclassifiable) {
    lines.push(
      `  More runs are unclassifiable than classifiable: this is a finding about the records, not about blindness.`,
    );
  }
  return lines.join("\n");
}

/** Name of the append-only ledger, beside the loop's health record and never in the tree. */
const SWEEP_LEDGER = "sweeps.jsonl";

/** Where the ledger lives, or null when this vault is not a git checkout. */
export function sweepLedgerPath(vaultDir: string): string | null {
  const dir = loopStateDir(vaultDir);
  return dir === null ? null : path.join(dir, SWEEP_LEDGER);
}

/**
 * Append one run. Throws when the vault has nowhere to record.
 *
 * Deliberately not fail-open, for the same reason `health.ts` is not: this ledger
 * is the only thing that will ever be able to say whether the guard was worth
 * building, and a sweep that silently failed to record its subject is one more
 * run nobody can classify. A caller that would rather report than throw catches
 * it and says so — {@link sweepLedgerPath} returns null in advance for the check
 * that wants to ask first.
 */
export function recordSweepRun(vaultDir: string, run: RecordedSweepRun): void {
  const dir = requireLoopStateDir(vaultDir);
  fs.appendFileSync(path.join(dir, SWEEP_LEDGER), JSON.stringify(run) + "\n");
}

/**
 * Read the ledger back.
 *
 * A line that will not parse becomes a placeholder run rather than being dropped,
 * which is this module's own rule applied to itself: a reader that silently
 * skipped the lines it could not handle would be a partly blind sweep reporting a
 * clean replay.
 */
export function readSweepRuns(vaultDir: string): RecordedSweepRun[] {
  const file = sweepLedgerPath(vaultDir);
  if (file === null || !fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line): RecordedSweepRun => {
      try {
        const parsed = JSON.parse(line) as RecordedSweepRun;
        if (parsed && typeof parsed.sweep === "string") return parsed;
      } catch {
        // falls through to the placeholder — see the doc comment
      }
      return { sweep: "(unparseable ledger line)", at: "", unreadable: true };
    });
}
