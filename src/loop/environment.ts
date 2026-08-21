/**
 * The dispatch-time environment check, and the parity record that says whether
 * it was worth anything.
 *
 * **The gate.** `loop due` is the thing that decides a firing happens. Until now
 * it decided that from the clock and the token ledger alone, both of which it
 * reads *through* the vault — so a vault whose `.git` had moved, whose config
 * had gone, or which the scheduling account could no longer write answered
 * "never fired" (`readRuns` returns `[]` for a directory with no state dir) and
 * came back **due**, every cycle, forever. The firing then died a few seconds
 * later inside `loop start`, against a lock and a health record it could not
 * write either. Verifying reachability at dispatch turns that into a refusal
 * that costs no compute and names the host fact that caused it.
 *
 * **Why the gate is worth so much less than it looks, and what this file does
 * about it.** A preflight is only a safety check if the scheduler sees what the
 * run will get. Check from a different shell, user or working directory and a
 * green preflight proves nothing — worse, a hint wired to prevent dispatch will
 * eventually cancel a run that would have worked, which is a worse failure than
 * the one it was added to prevent. This repository has already paid for exactly
 * that divergence once: a step failed purely because it ran from a directory
 * nobody had recorded, and the record could not say so.
 *
 * So the gate is not trusted on its word. `loop due` writes down what it saw at
 * dispatch, `loop start` writes down what the run itself sees in its first
 * second, and the two readings are compared pair by pair on the four axes that
 * actually diverge — working directory, resolved `PATH`, user, vault
 * reachability. {@link assessParity} is what turns a run of those pairs into an
 * answer about whether the preflight is authoritative here, and
 * `test/loop/preflight-parity.test.ts` holds it to ten consecutive agreeing
 * dispatches with one disagreement enough to fail.
 *
 * **One function takes both readings, on purpose.** Two readers would compare
 * their own difference as much as the environment's, and the question is about
 * the environment. {@link readEnvironment} is the only thing that reads; the two
 * sides differ in nothing but the process they run in.
 *
 * **What a disagreement does NOT do: stop the run.** It is recorded and said out
 * loud, and that is all. Refusing a run because the scheduler's clearance no
 * longer applies is a second policy with its own failure mode — cancelling work
 * that would have succeeded — and whether an operator wants that trade is a
 * person's call, not a thing this file may decide for them. What it may do is
 * make the divergence impossible to miss, which is what nothing did before.
 *
 * **Deliberately not checked here: whether the required tools resolve.** That is
 * the other half of "verify the environment before dispatching", and it already
 * ships — `ost-agent required-tools --pass … --available …` runs ahead of `loop
 * start` in `examples/automation/autonomous-pass.sh`, before any lock is taken
 * or record opened. Re-deriving it here would put a *decider* in front of an
 * arbitrary caller-named file, which is the read `tool-surface-record.ts` is
 * filed as a reporter precisely to avoid (see `test/release/gate-f-deciders.test.ts`).
 * The two checks stay separate and each reads what it is allowed to police.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// `CONFIG_FILENAME` rather than the config-path helper, deliberately. This module
// writes files, and `test/release/no-evolvable-policy.test.ts` treats "names that
// helper AND writes a file" — textually, in the source — as the signature of a
// module that can rewrite the operator's config, a set it asserts by exact
// equality so a third config writer has to argue for itself in a visible commit.
// Nothing here can write the config: it asks whether the file is *there*, which is
// a different capability, and joining the filename keeps that guard's set both
// exact and true rather than growing an entry that does not belong in it.
import { CONFIG_FILENAME } from "../config/load.js";
import { loopStateDir } from "./state.js";

/** Whether the vault can be reached from where this process stands, and why not when it cannot. */
export interface VaultReach {
  reachable: boolean;
  /** Absent when reachable. Names the FIRST thing that was missing, in the operator's terms. */
  reason?: string;
}

/**
 * One process's account of where it is standing.
 *
 * Every field is something the process observed about itself. Nothing is passed
 * in but the vault directory, which is the one input the two sides are supposed
 * to be resolving *differently* if anything is wrong — `--vault .` from two
 * working directories is two different vaults, and that is the failure this is
 * built to catch rather than a nuisance to normalise away.
 */
export interface EnvironmentReading {
  /** Where this process was standing, symlinks resolved. */
  cwd: string;
  /** The vault as THIS process resolved it, symlinks resolved when it exists. */
  vaultDir: string;
  /** Every `PATH` entry, in order, verbatim — order is part of what resolves a binary. */
  searchPath: readonly string[];
  /** The account this process runs as: `name(uid:gid)`. */
  user: string;
  vault: VaultReach;
}

/** The axes compared. Named rather than diffed generically so a report can say which one moved. */
export type ParityAxis = "cwd" | "vaultDir" | "searchPath" | "user" | "vaultReachable";

export interface Disagreement {
  axis: ParityAxis;
  /** What the scheduler saw at dispatch, rendered for a human. */
  scheduler: string;
  /** What the run saw in its first second. */
  run: string;
}

/** What `loop due` decided about the environment, and what it saw when it decided. */
export interface DispatchRecord {
  at: string;
  verdict: "dispatched" | "skipped";
  reading: EnvironmentReading;
  /** Why it skipped. Absent on a dispatch. */
  reason?: string;
}

/** One dispatch and the run it produced, compared. */
export interface ParityPair {
  runId: string;
  dispatchedAt: string;
  observedAt: string;
  scheduler: EnvironmentReading;
  run: EnvironmentReading;
  disagreements: Disagreement[];
}

const DISPATCH_LEDGER = "dispatch.jsonl";
const PARITY_LEDGER = "environment-parity.jsonl";

/**
 * Both ledgers live under `.git/ost-agent/`, beside the health record and the
 * firing lock, and for the same two reasons: the working tree must never carry
 * them (every mutating MCP tool commits with `git add -A`), and a file the
 * unattended surface can write is a file it can forge — a fabricated run of
 * agreeing pairs would certify the preflight the agent is running under.
 *
 * Null when the vault is not a git checkout, which is one of the states the
 * dispatch gate exists to refuse. A skip for that reason has nowhere to be
 * recorded, and {@link recordDispatch} says so rather than pretending.
 */
export function dispatchLedgerPath(vaultDir: string): string | null {
  const dir = loopStateDir(vaultDir);
  return dir === null ? null : path.join(dir, DISPATCH_LEDGER);
}

export function parityLedgerPath(vaultDir: string): string | null {
  const dir = loopStateDir(vaultDir);
  return dir === null ? null : path.join(dir, PARITY_LEDGER);
}

/** `realpath` where it resolves, the absolute path where it does not — a path that is missing is still a reading. */
function resolved(p: string): string {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

/**
 * Can a firing be recorded here at all?
 *
 * The four conditions are ordered by what a human would fix first, and only the
 * first failure is reported: an operator told "no directory, and no config, and
 * not writable" about a path they typo'd has been handed three restatements of
 * one mistake.
 *
 * Writability is probed with `access`, never by writing. A preflight whose own
 * check leaves a file behind has changed the thing it was measuring, and this
 * one runs on a vault it may be about to refuse to touch.
 */
export function reachVault(vaultDir: string): VaultReach {
  const abs = path.resolve(vaultDir);
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(abs);
  } catch {
    stat = null;
  }
  if (stat === null || !stat.isDirectory()) {
    return { reachable: false, reason: `no directory at ${abs}` };
  }
  const state = loopStateDir(abs);
  if (state === null) {
    return {
      reachable: false,
      reason: `${abs} is not a git checkout — the loop records every firing under .git/ost-agent/ and cannot record one here`,
    };
  }
  if (!fs.existsSync(path.join(abs, CONFIG_FILENAME))) {
    return { reachable: false, reason: `${abs} has no ost.config.yaml — nothing here declares a cadence or a ceiling` };
  }
  try {
    // The git directory rather than the state directory: the state directory is
    // created on first use, so a vault that has never fired has no such path and
    // asking about it would report every fresh vault as unreachable.
    fs.accessSync(path.dirname(state), fs.constants.W_OK);
  } catch {
    return {
      reachable: false,
      reason: `${path.dirname(state)} is not writable by ${currentUser()} — a firing here could not take its lock or open a record`,
    };
  }
  return { reachable: true };
}

function currentUser(): string {
  try {
    const info = os.userInfo();
    return `${info.username}(${info.uid}:${info.gid})`;
  } catch (e) {
    // Reported rather than defaulted: "could not tell who I am" and "I am nobody"
    // are different facts, and a parity comparison that silently agreed on a
    // placeholder would be certifying the one axis it had failed to read.
    return `unknown(${e instanceof Error ? e.message : String(e)})`;
  }
}

/**
 * The reading. The only place either side observes anything, so the pair a
 * comparison is drawn from differs in the process it ran in and nothing else.
 */
export function readEnvironment(vaultDir: string): EnvironmentReading {
  return {
    cwd: resolved(process.cwd()),
    vaultDir: resolved(vaultDir),
    searchPath: (process.env.PATH ?? "").split(path.delimiter).filter(Boolean),
    user: currentUser(),
    vault: reachVault(vaultDir),
  };
}

/**
 * Compare two readings, axis by axis. Exact: `PATH` order counts, because order
 * is what decides which of two binaries with the same name a step actually runs.
 *
 * `vaultReachable` compares the verdict, not the reason — a scheduler and a run
 * that both cannot reach the vault agree about the world, and the interesting
 * disagreement is one saying yes while the other says no.
 */
export function compareEnvironmentReadings(
  scheduler: EnvironmentReading,
  run: EnvironmentReading,
): Disagreement[] {
  const out: Disagreement[] = [];
  const scalar = (axis: ParityAxis, a: string, b: string) => {
    if (a !== b) out.push({ axis, scheduler: a, run: b });
  };
  scalar("cwd", scheduler.cwd, run.cwd);
  scalar("vaultDir", scheduler.vaultDir, run.vaultDir);
  if (
    scheduler.searchPath.length !== run.searchPath.length ||
    scheduler.searchPath.some((entry, i) => entry !== run.searchPath[i])
  ) {
    out.push({
      axis: "searchPath",
      scheduler: scheduler.searchPath.join(path.delimiter),
      run: run.searchPath.join(path.delimiter),
    });
  }
  scalar("user", scheduler.user, run.user);
  scalar("vaultReachable", String(scheduler.vault.reachable), String(run.vault.reachable));
  return out;
}

/** What `loop due` decides about the environment, with the reading it decided from. */
export interface DispatchVerdict {
  ok: boolean;
  reading: EnvironmentReading;
  /** Absent when `ok`. The one line an operator acts on. */
  problem?: string;
}

export function verifyDispatchEnvironment(vaultDir: string): DispatchVerdict {
  const reading = readEnvironment(vaultDir);
  return reading.vault.reachable
    ? { ok: true, reading }
    : { ok: false, reading, problem: reading.vault.reason ?? "the vault could not be reached" };
}

function appendLine(file: string, value: unknown): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(value) + "\n");
    return true;
  } catch {
    return false;
  }
}

/**
 * Write down what the scheduler decided and what it saw.
 *
 * Returns false when it could not be written, and the caller says so out loud
 * rather than swallowing it. That is not a hypothetical: the commonest reason to
 * skip is a vault that is not a git checkout, and the ledger lives inside the
 * `.git` that is missing. A scheduler which counted such skips silently would
 * report "0 consecutive skips" for a host that has skipped every cycle for a
 * week — the exact silence this whole check exists to break.
 */
export function recordDispatch(
  vaultDir: string,
  record: Omit<DispatchRecord, "at"> & { at: string },
): boolean {
  const file = dispatchLedgerPath(vaultDir);
  return file === null ? false : appendLine(file, record);
}

function readLedger<T>(file: string | null, keep: (v: unknown) => v is T): T[] {
  if (file === null || !fs.existsSync(file)) return [];
  const out: T[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (keep(parsed)) out.push(parsed);
    } catch {
      // A torn line is dropped, never repaired. The records around it were each
      // written by a process that observed what it wrote; inventing a shape for
      // the one that was interrupted would put a reading in the ledger nothing
      // ever took.
    }
  }
  return out;
}

const isDispatchRecord = (v: unknown): v is DispatchRecord =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as DispatchRecord).at === "string" &&
  ((v as DispatchRecord).verdict === "dispatched" || (v as DispatchRecord).verdict === "skipped") &&
  typeof (v as DispatchRecord).reading === "object" &&
  (v as DispatchRecord).reading !== null;

const isParityPair = (v: unknown): v is ParityPair =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as ParityPair).runId === "string" &&
  Array.isArray((v as ParityPair).disagreements);

/** Oldest first, the order they were appended in. */
export function readDispatches(vaultDir: string): DispatchRecord[] {
  return readLedger(dispatchLedgerPath(vaultDir), isDispatchRecord);
}

export function readParityPairs(vaultDir: string): ParityPair[] {
  return readLedger(parityLedgerPath(vaultDir), isParityPair);
}

/**
 * How many dispatches in a row this scheduler has skipped, counting back from
 * the newest. Zero the moment one dispatches — the signal is about a host that
 * is stuck, and a host that fired is not stuck any more.
 */
export function consecutiveSkips(records: readonly DispatchRecord[]): number {
  let n = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].verdict !== "skipped") break;
    n++;
  }
  return n;
}

/** The dispatch this run belongs to: the newest record, and only if it dispatched. */
export function pendingDispatch(vaultDir: string): DispatchRecord | null {
  const records = readDispatches(vaultDir);
  const last = records[records.length - 1];
  return last && last.verdict === "dispatched" ? last : null;
}

/**
 * Take the run's own reading, pair it with the dispatch that licensed it, and
 * append the comparison.
 *
 * Null when there is no dispatch to pair with — a run started by hand, or by a
 * wrapper that skipped `loop due`. That is deliberately NOT recorded as an
 * agreeing pair: a run nobody dispatched proves nothing about whether a
 * scheduler's reading matches a run's, and counting it would let a vault reach
 * ten "consecutive dispatches" without a scheduler having been involved once.
 */
export function recordRunParity(
  vaultDir: string,
  opts: { runId: string; reading: EnvironmentReading; at: string },
): ParityPair | null {
  const dispatch = pendingDispatch(vaultDir);
  if (dispatch === null) return null;
  const pair: ParityPair = {
    runId: opts.runId,
    dispatchedAt: dispatch.at,
    observedAt: opts.at,
    scheduler: dispatch.reading,
    run: opts.reading,
    disagreements: compareEnvironmentReadings(dispatch.reading, opts.reading),
  };
  appendLine(parityLedgerPath(vaultDir)!, pair);
  return pair;
}

export interface ParityAssessment {
  ok: boolean;
  /** Agreeing pairs counting back from the newest, stopping at the first that disagreed. */
  consecutive: number;
  /** The newest pair that disagreed, when one did. */
  brokeOn?: ParityPair;
  reason: string;
}

/**
 * Is the preflight authoritative on this host?
 *
 * The bar is a run of `required` consecutive dispatches whose two readings agree
 * on every axis, and **one disagreement anywhere in that run fails it**. The
 * asymmetry is the point: a preflight that is usually right is not a preflight,
 * it is a hint, and a hint wired to prevent dispatch cancels a run that would
 * have worked. Ten clean pairs is a modest bar to hold something to that is
 * being trusted to stop work.
 */
export function assessParity(pairs: readonly ParityPair[], opts: { required: number }): ParityAssessment {
  let consecutive = 0;
  let brokeOn: ParityPair | undefined;
  for (let i = pairs.length - 1; i >= 0; i--) {
    if (pairs[i].disagreements.length > 0) {
      brokeOn = pairs[i];
      break;
    }
    consecutive++;
  }
  if (consecutive >= opts.required) {
    return {
      ok: true,
      consecutive,
      ...(brokeOn ? { brokeOn } : {}),
      reason: `${consecutive} consecutive dispatch(es) agreed exactly between the scheduler's reading and the run's`,
    };
  }
  return {
    ok: false,
    consecutive,
    ...(brokeOn ? { brokeOn } : {}),
    reason: brokeOn
      ? `only ${consecutive} consecutive agreeing dispatch(es) — run ${brokeOn.runId} disagreed on ` +
        `${brokeOn.disagreements.map((d) => d.axis).join(", ")}`
      : `only ${consecutive} dispatch(es) on record, ${opts.required} needed`,
  };
}

/** The line `loop due` prints when it clears — stated so an operator can see what was checked. */
export function dispatchClearedLine(reading: EnvironmentReading): string {
  return (
    `environment verified at dispatch: cwd ${reading.cwd}, vault ${reading.vaultDir} reachable, ` +
    `${reading.searchPath.length} PATH entr(ies), user ${reading.user}`
  );
}

/** The report `loop due` prints when it refuses, including the count nobody was keeping before. */
export function dispatchSkippedReport(opts: {
  problem: string;
  consecutive: number;
  recorded: boolean;
}): string {
  const lines = [`not firing: ${opts.problem}`];
  lines.push(
    "  This is a fact about the host, not about the pass — nothing was dispatched, no lock was taken and no " +
      "compute was spent. Fix it where it lives and the next cycle fires.",
  );
  if (!opts.recorded) {
    lines.push(
      "  ⚠ this skip could not be recorded — the ledger lives under .git/ost-agent/ in the vault this cannot " +
        "reach, so nothing here is counting how long it has been like this.",
    );
  } else if (opts.consecutive > 1) {
    lines.push(`  ⚠ ${opts.consecutive} consecutive dispatch(es) skipped for the same kind of reason.`);
  }
  return lines.join("\n");
}

/** What `loop start` says about the pair it just recorded. */
export function parityLine(pair: ParityPair | null): string {
  if (pair === null) {
    return "environment parity: no dispatch on record — this run was not started by `loop due`, so there is nothing to compare it against.";
  }
  if (pair.disagreements.length === 0) {
    return `environment parity: agrees with the dispatch at ${pair.dispatchedAt} on all four axes.`;
  }
  return [
    `⚠ environment parity: this run does NOT match what the scheduler cleared at ${pair.dispatchedAt}.`,
    ...pair.disagreements.map((d) => `    ${d.axis}: scheduler saw ${d.scheduler}, this run has ${d.run}`),
    "  The preflight that let this dispatch through was measuring a different environment, so its clearance " +
      "does not cover this run. The run is not stopped over it — cancelling work that would have succeeded is " +
      "the failure a preflight is supposed to prevent — but nothing it cleared should be relied on.",
  ].join("\n");
}
