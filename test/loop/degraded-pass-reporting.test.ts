/**
 * The instrument for "A degraded pass has its own name and is not allowed to
 * report a clean run."
 *
 * **What it is scoring.** The candidate's own assumption test frames this as a
 * question about self-honesty — run five passes with the tool surface removed and
 * count how many admit it — and records, in the same breath, why that framing is
 * the weak one: "it is enforced by the agent's own honesty about its own limits,
 * precisely the thing that cannot be assumed." What can be settled by a committed
 * test is the mechanism underneath: whether a degraded firing has a name of its
 * own in the record, whether that name is derived from evidence the firing cannot
 * author, and whether it is barred from reporting the two verdicts an operator
 * reads as fine. So the deliberate degradation is done to the *surface*, five
 * modes of it, and the pass is never asked anything.
 *
 * **The control half is not optional.** The test node pre-commits two numbers,
 * and the second is "0 of 2 full runs may falsely self-label" — a contract that
 * always says degraded carries no information either. Every degradation case here
 * has a full-surface twin, and the twin asserts the old verdicts still hold.
 *
 * **What a green here does not prove.** That an operator who sees `degraded`
 * goes and looks. That is a question about people, and this file cannot answer it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { assessDegradation, degradedReport, observeSurface } from "../../src/loop/degraded.js";
import { computeVerdict, readRuns, type LoopRunRecord } from "../../src/loop/health.js";
import { assessStall } from "../../src/loop/stall.js";
import { usageLogPath } from "../../src/telemetry/usage.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "../../src/cli/index.ts");
const TSX = path.resolve(here, "../../node_modules/.bin/tsx");

let dir: string;
let vault: string;
let sessions: string;

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: vault, stdio: "ignore" });
}

/** stdout AND stderr: the degraded report is a warning, and a cron mails stderr. */
function loop(subcommand: string, ...args: string[]): { code: number; out: string } {
  const r = spawnSync(TSX, [CLI, "loop", subcommand, "--vault", vault, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const FULL_LOOP = [
  'outcome: "ship it"',
  "loop:",
  '  cadence: "6h"',
  "  spend:",
  "    ceilingWeightedTokens: 1000",
  "    windowHours: 24",
  '    sessionsDir: "../sessions"',
  "",
].join("\n");

/**
 * Rewrite the config AND commit it. Both halves are required: `loop start`
 * refuses a dirty working tree (D5), so a test that edits the fixture and fires
 * without committing is testing the dirty-tree refusal instead of what it meant to.
 */
function writeConfig(text: string): void {
  fs.writeFileSync(path.join(vault, "ost.config.yaml"), text, "utf8");
  git("add", "-A");
  git("commit", "--quiet", "-m", "config");
}

/**
 * One traced tool invocation, exactly as `withUsageTracing` writes them.
 *
 * This is what makes a firing NON-degraded, and it is deliberately the only way:
 * the trace is written by the dispatcher at call time, so a pass that never
 * reached the tree cannot produce one however it describes itself afterwards.
 */
function traceToolCall(tool = "ost_next_work"): void {
  const file = usageLogPath(vault);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(
    file,
    JSON.stringify({ ts: new Date().toISOString(), tool, ok: true, ms: 3, surface: "mcp", argBytes: 12 }) + "\n",
    "utf8",
  );
}

/** A whole firing bracket. `withTools` decides whether the pass reached the tree. */
function fire(opts: { withTools: boolean; check?: string } = { withTools: true }): { code: number; out: string } {
  loop("start");
  loop("step", "--phase", "pass", "--", "true");
  if (opts.withTools) traceToolCall();
  loop("step", "--phase", "check", "--", opts.check ?? "true");
  return loop("seal");
}

function lastRecord(): LoopRunRecord {
  const runs = readRuns(vault);
  expect(runs.length).toBeGreaterThan(0);
  return runs[0];
}

/** The words a firing may not emit when it could not do its job. */
const CLEAN = /sealed: (healthy|no-op)/;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-degraded-"));
  vault = path.join(dir, "vault");
  sessions = path.join(dir, "sessions");
  fs.mkdirSync(vault);
  fs.mkdirSync(sessions);
  git("init", "--quiet");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(sessions, "s.jsonl"), "");
  // The trace file exists and is TRACKED from the baseline, which is what a real
  // vault looks like after its first tool call — and it is load-bearing here.
  // Git collapses an untracked directory to `?? .ost-agent/`, and the firing's
  // dirty-tree exemption is on `.ost-agent/usage/` exactly; a fixture that
  // created the folder mid-firing would be refused at the next `loop start` for
  // a reason that has nothing to do with this file.
  fs.mkdirSync(path.dirname(usageLogPath(vault)), { recursive: true });
  fs.writeFileSync(usageLogPath(vault), "");
  writeConfig(FULL_LOOP);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * Mode by mode, each injected into a real firing and each scored on the two
 * questions the assumption test asks of a report: did it label itself degraded,
 * and did it name the specific work it could not attempt.
 */
describe("every degradation mode this codebase can produce is named, not rounded to success", () => {
  test("no tool surface: the pass ran, reached nothing, and does not seal `no-op`", () => {
    // The observed failure, reproduced: twenty-two firings whose MCP surface was
    // never present, each running `check` and `status` truthfully and sealing a
    // verdict a reader takes to mean the tree was already fine.
    const sealed = fire({ withTools: false });

    expect(sealed.out).toMatch(/sealed: degraded/);
    expect(sealed.out).not.toMatch(CLEAN);
    expect(sealed.out).toMatch(/no-tool-calls/);
    // Names the work it could not attempt, not merely that something was wrong.
    expect(sealed.out).toMatch(/mapping, ideation and assumption work/);
    expect(lastRecord().verdict).toBe("degraded");
  });

  test("a credential the config asks for and the machine does not have", () => {
    // Slack enabled with no SLACK_BOT_TOKEN in the environment: one adapter the
    // operator declared, refusing to construct. `buildPassContext` already keeps
    // this apart from "turned off", and this is the reader that needed it to.
    writeConfig(`${FULL_LOOP}adapters:\n  slack:\n    enabled: true\n    channels: ["C1"]\n`);
    const sealed = fire({ withTools: true });

    expect(sealed.out).toMatch(/sealed: degraded/);
    expect(sealed.out).not.toMatch(CLEAN);
    expect(sealed.out).toMatch(/unreadable-source/);
    expect(sealed.out).toMatch(/slack/);
    expect(lastRecord().degradations?.some((d) => d.kind === "unreadable-source")).toBe(true);
  });

  test("a source turned OFF is not a degradation — the configuration working is not a loss", () => {
    // The other side of the same partition, and the one that decides whether this
    // detector is usable: Slack is disabled by default in every vault, so a rule
    // that counted `disabled` would call every firing everywhere degraded.
    writeConfig(`${FULL_LOOP}adapters:\n  slack:\n    enabled: false\n`);
    expect(fire({ withTools: true }).out).toMatch(/sealed: no-op/);
  });

  test("a present-but-unreadable config never reaches a seal at all — the loop refuses to fire on defaults", () => {
    // G1's degradation is real on the MCP surface: a broken `ost.config.yaml` is
    // tolerated there, the tools keep serving, and a pass could run against schema
    // defaults rather than the operator's vault. It turns out it CANNOT happen
    // inside a firing, and finding that out is worth more than the test that was
    // written to inject it: the loop's own front door loads the config strictly,
    // so a broken file stops the firing before a run is ever opened.
    writeConfig('outcome: "ship it"\nloop:\n  cadence: [unclosed\n');

    expect(loop("due").code).not.toBe(0);
    const started = loop("start");
    expect(started.code).not.toBe(0);
    // Nothing was opened, so there is nothing to seal — the refusal is a firing
    // that did not begin, which is a louder answer than a degraded one that did.
    expect(loop("seal").out).toMatch(/no open loop run/);
    expect(readRuns(vault)).toEqual([]);
  });

  test("the classifier still names a config fallback, for the surface that can produce one", () => {
    // Kept as a mode because the observation is shared: `observeSurface` reads the
    // same `buildPassContext` the MCP server does, and a future firing path that
    // tolerates a broken config must not be able to seal clean on defaults.
    const run: LoopRunRecord = {
      runId: "r",
      startedAt: new Date().toISOString(),
      loopVersion: "0",
      cliVersion: "0",
      steps: [
        { phase: "pass", command: "true", exit: 0, durationMs: 1, at: new Date().toISOString() },
        { phase: "check", command: "true", exit: 0, durationMs: 1, at: new Date().toISOString() },
      ],
    };
    const degradations = assessDegradation(run, {
      toolCalls: 9,
      unreadableSources: [],
      configProblem: "ost.config.yaml is not valid YAML",
    });
    expect(degradations.map((d) => d.kind)).toEqual(["config-fallback"]);
    expect(computeVerdict({ ...run, degradations, headBefore: "a", headAfter: "b" })).toBe("degraded");
  });

  test("a surface that cannot be inspected is degraded, because unknown is not clean", () => {
    // The mode with no injection available from outside — assessed directly. A
    // reader that treated "could not check" as "nothing found" would be the exact
    // failure this whole node is about, one level up.
    const run: LoopRunRecord = {
      runId: "r",
      startedAt: new Date().toISOString(),
      loopVersion: "0",
      cliVersion: "0",
      steps: [
        { phase: "pass", command: "true", exit: 0, durationMs: 1, at: new Date().toISOString() },
        { phase: "check", command: "true", exit: 0, durationMs: 1, at: new Date().toISOString() },
      ],
    };
    const degradations = assessDegradation(run, {
      toolCalls: 4,
      unreadableSources: [],
      observationFailure: "EACCES",
    });
    expect(degradations.map((d) => d.kind)).toContain("unobservable-surface");
    expect(computeVerdict({ ...run, degradations, headBefore: "a", headAfter: "b" })).toBe("degraded");
  });

  test("degradation is reported even when the firing also failed — and does not soften the failure", () => {
    // A red step is a failure and stays one: `unhealthy` outranks `degraded`, so
    // nothing here can launder a broken check into an excuse. But the operator
    // still gets told the check ran with nothing behind it.
    const sealed = fire({ withTools: false, check: "false" });

    expect(sealed.out).toMatch(/sealed: unhealthy/);
    expect(sealed.out).toMatch(/no-tool-calls/);
    expect(sealed.code).toBe(1);
  });
});

/**
 * The controls. A contract that always says degraded carries no information, and
 * the test node pre-commits that zero full-surface runs may falsely self-label.
 */
describe("a full surface does not self-label — the detector is not simply always on", () => {
  test("two consecutive full-surface firings, neither degraded", () => {
    expect(fire({ withTools: true }).out).toMatch(/sealed: no-op/);
    expect(fire({ withTools: true }).out).toMatch(/sealed: no-op/);
    for (const run of readRuns(vault)) {
      expect(run.verdict).not.toBe("degraded");
      expect(run.degradations).toBeUndefined();
    }
  });

  test("a full-surface firing that advances the tree still seals healthy", () => {
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    traceToolCall();
    fs.writeFileSync(path.join(vault, "Node.md"), "# Node\n");
    git("add", "-A");
    git("commit", "--quiet", "-m", "a node");
    loop("step", "--phase", "check", "--", "true");
    expect(loop("seal").out).toMatch(/sealed: healthy/);
  });

  test("a clean vault observes an empty degradation set — nothing invented", () => {
    const run: LoopRunRecord = {
      runId: "r",
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      loopVersion: "0",
      cliVersion: "0",
      steps: [{ phase: "pass", command: "true", exit: 0, durationMs: 1, at: new Date().toISOString() }],
    };
    traceToolCall();
    expect(assessDegradation(run, observeSurface(vault, run))).toEqual([]);
  });
});

/**
 * The second half of the node's title. A name is worth nothing if the surfaces
 * an operator actually reads round it back to fine.
 */
describe("a degraded firing is not allowed to report a clean run", () => {
  test("the seal exits non-zero, and with a code distinct from a red tree", () => {
    const degraded = fire({ withTools: false });
    expect(degraded.code).toBe(17);

    // Distinct from `unhealthy`'s 1: a wrapper that could not tell them apart
    // would treat "the pass never reached the tree" as "the tree came back red",
    // which have different fixes.
    const red = fire({ withTools: true, check: "false" });
    expect(red.code).toBe(1);
  });

  test("the record carries what could not be attempted, for the reader who was not there", () => {
    fire({ withTools: false });
    const record = lastRecord();
    expect(record.verdict).toBe("degraded");
    expect(record.degradations?.length).toBeGreaterThan(0);
    // Re-deriving the verdict from the sealed line reproduces it: the record and
    // the classification cannot disagree.
    expect(computeVerdict(record)).toBe("degraded");
  });

  test("`loop health` names the degradation instead of printing the word alone", () => {
    fire({ withTools: false });
    const health = loop("health");
    expect(health.out).toMatch(/last-fired: .*degraded/);
    expect(health.out).toMatch(/no-tool-calls/);
    expect(health.out).toMatch(/not evidence that the tree is fine/);
  });

  test("`loop due` reports the last record as degraded rather than as a verdict it isn't", () => {
    fire({ withTools: false });
    expect(loop("due").out).toMatch(/last record: degraded/);
  });

  test("degraded firings do not clear the stall streak, because the tree did not move", () => {
    fire({ withTools: false });
    fire({ withTools: false });
    const third = fire({ withTools: false });
    expect(third.out).toMatch(/⚠ stalled:/);
    expect(assessStall(readRuns(vault)).streak).toBe(3);
  });

  test("the report says outright that this is not evidence the tree is fine", () => {
    const lines = degradedReport([{ kind: "no-tool-calls", detail: "nothing was reached" }]);
    expect(lines.join("\n")).toMatch(/not evidence that the tree is fine/);
    // And says nothing at all when there is nothing to say — a degraded banner on
    // a healthy firing would spend the same trust from the other direction.
    expect(degradedReport([])).toEqual([]);
  });
});
