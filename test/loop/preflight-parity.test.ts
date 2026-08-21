/**
 * "Compare the scheduler's view of the environment against the run's" — the
 * assumption test's threshold, held at the bar it states: **ten consecutive
 * dispatches must agree exactly** between what the scheduler saw when it decided
 * to fire and what the run itself read in its first second, on all four axes the
 * node names — working directory, resolved `PATH`, user, vault reachability.
 * One disagreement fails it.
 *
 * ## Why this drives the real CLI, twice per dispatch
 *
 * The claim under test is that the preflight is *authoritative*: that a green
 * check in the scheduler tells you something about the environment the run will
 * get. Calling `readEnvironment` twice inside this process would answer a
 * different and worthless question — of course one process agrees with itself.
 * So every dispatch here is two separate `node` processes, spawned exactly the
 * way `examples/automation/autonomous-pass.sh` spawns them: `cd "$VAULT_DIR"`
 * first, then `--vault .`, so each side resolves the vault itself rather than
 * being handed an answer.
 *
 * **What that does and does not settle, stated because the number 10 invites
 * over-reading.** Ten agreeing pairs say the two readings are really taken, in
 * different processes, and really compared, and that on this deployment shape —
 * a scheduler and a run in the same shell — they match. They say nothing about a
 * scheduler and a run on different hosts, in different containers or under
 * different users, which is where divergence is likeliest and where this
 * instrument is least informative. The node says the same thing in its own
 * words, and this file does not quietly claim more.
 *
 * ## The negative control, which is the half that makes the rest mean anything
 *
 * A parity test whose two readings are taken the same way by construction can
 * pass while the comparator is broken, and a test that cannot come out a failure
 * is not an instrument. So `a dispatch the run does not match` runs the same
 * bracket with the run deliberately started from a different directory and with
 * a different `PATH`, and requires the pair to be recorded as a disagreement
 * naming those axes — and requires `assessParity` to fail on the ledger that
 * contains it.
 *
 * ## The bracket is `due` → `start` → `seal`, with no phases
 *
 * The two proving steps a real firing runs (`loop step --phase pass|check`) are
 * two more process spawns each and change nothing this file measures: the
 * subject is the pair of readings, and the verdict a phaseless firing seals is
 * irrelevant to it. `seal` is here because it releases the lock and closes the
 * run, which is what lets the next dispatch happen at all.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  assessParity,
  compareEnvironmentReadings,
  parityLedgerPath,
  readDispatches,
  readEnvironment,
  readParityPairs,
  type ParityPair,
} from "../../src/loop/environment.js";

// The local tsx binary rather than `npx`, which takes npm's cacache lock — see
// the same note in test/cli/loop.test.ts.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

/** The node's bar, verbatim. */
const REQUIRED_DISPATCHES = 10;

let dir: string;
let vault: string;
let sessions: string;

interface Ran {
  code: number;
  out: string;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * One loop command, spawned the way the shipped wrapper spawns it: standing in
 * the vault, naming it as `.`.
 *
 * `cwd` and `env` are overridable because the negative control's entire job is
 * to spawn the run half differently from the scheduler half.
 */
function loop(subcommand: string, opts: { cwd?: string; env?: NodeJS.ProcessEnv; vault?: string } = {}): Ran {
  const r = spawnSync(TSX, [CLI, "loop", subcommand, "--vault", opts.vault ?? "."], {
    cwd: opts.cwd ?? vault,
    env: { ...process.env, ...(opts.env ?? {}) },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * Move every recorded firing back a week.
 *
 * The cadence gate is what stops a vault firing twice inside its window, and
 * this file needs ten dispatches in a few seconds. Backdating the ledger is the
 * one piece of fixture surgery here, and it touches only the timestamps the
 * cadence gate reads — the readings under test are taken live by the two
 * processes on every dispatch and are never written by this file.
 */
function elapseCadence(): void {
  const runs = path.join(vault, ".git", "ost-agent", "runs.jsonl");
  if (!fs.existsSync(runs)) return;
  const lines = fs
    .readFileSync(runs, "utf8")
    .split("\n")
    .filter((l) => l.trim());
  const rewritten = lines.map((line, i) => {
    const record = JSON.parse(line) as { startedAt: string; endedAt?: string };
    const at = new Date(Date.now() - (lines.length - i + 24) * 60 * 60 * 1000).toISOString();
    record.startedAt = at;
    if (record.endedAt) record.endedAt = at;
    return JSON.stringify(record);
  });
  fs.writeFileSync(runs, rewritten.join("\n") + "\n", "utf8");
}

/** A firing's worth of spend inside the window, well under the declared ceiling. */
function spend(): void {
  fs.writeFileSync(
    path.join(sessions, "s.jsonl"),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      cwd: fs.realpathSync(vault),
      message: { usage: { output_tokens: 1 } },
    }) + "\n",
    "utf8",
  );
}

const CONFIG = [
  "outcome: Ship the thing",
  "loop:",
  '  cadence: "6h"',
  "  spend:",
  "    ceilingWeightedTokens: 1000000",
  "    windowHours: 24",
  '    sessionsDir: "../sessions"',
  "",
].join("\n");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-preflight-parity-"));
  vault = path.join(dir, "vault");
  sessions = path.join(dir, "sessions");
  fs.mkdirSync(vault);
  fs.mkdirSync(sessions);
  git("init", "--quiet");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  fs.writeFileSync(path.join(vault, "ost.config.yaml"), CONFIG, "utf8");
  git("add", "-A");
  git("commit", "--quiet", "-m", "baseline");
  spend();
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * One dispatch, end to end, in the two processes the claim is about. Returns
 * both halves so a caller can assert on the gate as well as on the pair.
 *
 * `run` names how the second process differs from the first — nothing, for a
 * faithful dispatch; a different directory and `PATH` for the control.
 */
function dispatch(run: { cwd?: string; env?: NodeJS.ProcessEnv; vault?: string } = {}): {
  due: Ran;
  start: Ran;
  seal: Ran;
} {
  elapseCadence();
  const due = loop("due");
  const start = loop("start", run);
  const seal = loop("seal");
  return { due, start, seal };
}

describe("the scheduler's reading and the run's, over ten consecutive dispatches", () => {
  test(
    "all ten agree exactly, on every axis",
    () => {
      for (let i = 0; i < REQUIRED_DISPATCHES; i++) {
        const { due, start } = dispatch();
        expect(due.code, `dispatch ${i + 1}: loop due refused — ${due.out}`).toBe(0);
        expect(due.out).toMatch(/environment verified at dispatch:/);
        expect(start.code, `dispatch ${i + 1}: loop start refused — ${start.out}`).toBe(0);
      }

      const pairs = readParityPairs(vault);
      expect(pairs).toHaveLength(REQUIRED_DISPATCHES);

      // The bar, stated as the node states it: one disagreement anywhere fails.
      const disagreeing = pairs.filter((p) => p.disagreements.length > 0);
      expect(
        disagreeing.map((p) => ({ runId: p.runId, axes: p.disagreements })),
        "a dispatch and its run disagreed about the environment",
      ).toEqual([]);

      const verdict = assessParity(pairs, { required: REQUIRED_DISPATCHES });
      expect(verdict.ok, verdict.reason).toBe(true);
      expect(verdict.consecutive).toBe(REQUIRED_DISPATCHES);
    },
    180_000,
  );

  test(
    "each pair is two different processes reading, not one reading copied",
    () => {
      // Non-vacuity for the run above. If `loop start` had simply reused the
      // dispatch record instead of reading for itself, every pair would agree and
      // the ten-dispatch run would be green against nothing. Each side stamps its
      // own moment, and the two ledgers are written by two different commands, so
      // a run whose observation is later than the dispatch that licensed it is the
      // observable difference between the two readings having happened and one of
      // them having been copied forward.
      const { due, start } = dispatch();
      expect(due.code).toBe(0);
      expect(start.code).toBe(0);

      const pairs = readParityPairs(vault);
      expect(pairs).toHaveLength(1);
      expect(Date.parse(pairs[0].observedAt)).toBeGreaterThan(Date.parse(pairs[0].dispatchedAt));
      expect(start.out).toMatch(/environment parity: agrees with the dispatch/);

      // And the two ledgers really are two: the dispatch record exists on its own
      // and says the scheduler dispatched.
      const dispatches = readDispatches(vault);
      expect(dispatches).toHaveLength(1);
      expect(dispatches[0].verdict).toBe("dispatched");
    },
    60_000,
  );
});

describe("a dispatch the run does not match — the control that lets this instrument fail", () => {
  test(
    "a run started from another directory with another PATH is recorded as a disagreement",
    () => {
      const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "ost-elsewhere-"));
      try {
        // The scheduler stands in the vault, as the wrapper does. The run is
        // handed the same vault by absolute path but stands somewhere else, with
        // one extra entry on its PATH — the shape of a scheduler and a run that
        // do not share a shell.
        const { due, start } = dispatch({
          cwd: elsewhere,
          vault,
          env: { PATH: `${elsewhere}${path.delimiter}${process.env.PATH ?? ""}` },
        });
        expect(due.code).toBe(0);
        // The run is NOT refused over it: cancelling work that would have
        // succeeded is the failure a preflight exists to prevent.
        expect(start.code).toBe(0);
        expect(start.out).toMatch(/⚠ environment parity: this run does NOT match/);

        const pairs = readParityPairs(vault);
        expect(pairs).toHaveLength(1);
        expect(pairs[0].disagreements.map((d) => d.axis).sort()).toEqual(["cwd", "searchPath"]);

        // And the ledger with that pair in it does not clear the bar, at any
        // required count — which is what "one disagreement fails it" means.
        expect(assessParity(pairs, { required: 1 }).ok).toBe(false);
        expect(assessParity(pairs, { required: REQUIRED_DISPATCHES }).ok).toBe(false);
      } finally {
        fs.rmSync(elsewhere, { recursive: true, force: true });
      }
    },
    60_000,
  );

  test("the comparison sees the user axis too, which no test can spawn its way into", () => {
    // The fourth axis, held at the unit level on purpose: this suite cannot
    // become another user, and an axis compared nowhere would be an axis the
    // report silently stopped covering.
    const scheduler = readEnvironment(vault);
    const asSomebodyElse = { ...scheduler, user: "someone-else(999:999)" };
    expect(compareEnvironmentReadings(scheduler, asSomebodyElse)).toEqual([
      { axis: "user", scheduler: scheduler.user, run: "someone-else(999:999)" },
    ]);

    const unreachable = { ...scheduler, vault: { reachable: false, reason: "gone" } };
    expect(compareEnvironmentReadings(scheduler, unreachable).map((d) => d.axis)).toEqual(["vaultReachable"]);
  });

  test("a run nobody dispatched is not counted as an agreeing pair", () => {
    // A `loop start` with no `loop due` in front of it says nothing about
    // whether a scheduler's reading matches a run's, and counting it would let a
    // vault reach ten "consecutive dispatches" without a scheduler having been
    // involved once.
    const start = loop("start");
    expect(start.code).toBe(0);
    expect(start.out).toMatch(/no dispatch on record/);
    expect(readParityPairs(vault)).toEqual([]);
  }, 30_000);
});

describe("the gate itself: what the scheduler refuses to dispatch into", () => {
  test("a vault that is not a git checkout is refused before the cadence gate can call it due", () => {
    // The failure this gate exists to stop, in its own words: `readRuns` returns
    // `[]` for a directory with no state dir, so a checkout whose `.git` had gone
    // read as "never fired" and came back due on every cycle, forever.
    fs.rmSync(path.join(vault, ".git"), { recursive: true, force: true });
    const due = loop("due");
    expect(due.code).toBe(21);
    expect(due.out).toMatch(/is not a git checkout/);
    // And it did not first announce a firing history it could not read.
    expect(due.out).not.toMatch(/last record:/);
    expect(due.out).not.toMatch(/^due:/m);
    // The skip has nowhere to be recorded, and says so rather than counting to
    // zero forever.
    expect(due.out).toMatch(/this skip could not be recorded/);
  }, 30_000);

  test("a vault with no config is refused with the same code and a different reason", () => {
    fs.rmSync(path.join(vault, "ost.config.yaml"));
    const due = loop("due");
    expect(due.code).toBe(21);
    expect(due.out).toMatch(/has no ost\.config\.yaml/);
    // Here the ledger IS reachable, so the skip is counted rather than lost.
    const dispatches = readDispatches(vault);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].verdict).toBe("skipped");
  }, 30_000);

  test("consecutive skips accumulate across cycles, which is what a scheduler can do and a pass cannot", () => {
    fs.rmSync(path.join(vault, "ost.config.yaml"));
    loop("due");
    const second = loop("due");
    expect(second.out).toMatch(/2 consecutive dispatch\(es\) skipped/);
    expect(readDispatches(vault)).toHaveLength(2);
  }, 30_000);

  test("the parity ledger lives where the unattended surface cannot write it", () => {
    // The same property the health record and the firing lock have, and for the
    // same reason: a ledger the agent could append to is a ledger that can
    // certify the preflight the agent is running under.
    expect(parityLedgerPath(vault)!).toContain(path.join(".git", "ost-agent"));
  });
});

describe("assessParity — the threshold, held on its own", () => {
  const pair = (disagreements: ParityPair["disagreements"]): ParityPair => ({
    runId: `r${disagreements.length}`,
    dispatchedAt: "2026-08-01T00:00:00.000Z",
    observedAt: "2026-08-01T00:00:01.000Z",
    scheduler: readEnvironment(process.cwd()),
    run: readEnvironment(process.cwd()),
    disagreements,
  });
  const agree = () => pair([]);
  const differ = () => pair([{ axis: "cwd" as const, scheduler: "/a", run: "/b" }]);

  test("nine agreeing dispatches is not ten", () => {
    const nine = Array.from({ length: 9 }, agree);
    expect(assessParity(nine, { required: 10 }).ok).toBe(false);
    expect(assessParity([...nine, agree()], { required: 10 }).ok).toBe(true);
  });

  test("one disagreement inside the window fails it, however many agreed before", () => {
    const pairs = [...Array.from({ length: 20 }, agree), differ(), ...Array.from({ length: 9 }, agree)];
    const verdict = assessParity(pairs, { required: 10 });
    expect(verdict.ok).toBe(false);
    expect(verdict.consecutive).toBe(9);
    expect(verdict.brokeOn?.disagreements[0].axis).toBe("cwd");
  });

  test("an empty ledger is not a pass — nothing measured is not agreement", () => {
    expect(assessParity([], { required: 10 })).toMatchObject({ ok: false, consecutive: 0 });
  });
});
