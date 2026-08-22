/**
 * "Every pass records the outcome text it ran against, and a changed outcome is
 * visible as a change" — the assumption test's threshold, held clause by clause.
 *
 * The threshold has three parts and each one is a describe block below:
 *
 *   1. Every pass writes the outcome text it ran against into its own record.
 *   2. Two passes that ran against different outcome texts are distinguishable
 *      from that record alone, **without consulting the vault's current state**.
 *   3. A pass whose outcome changed mid-run reports that, rather than recording
 *      either end of it as though it had held throughout.
 *
 * Clauses 1 and 2 are driven through the real `loop start` / `loop seal`
 * bracket, because the claim is about what a firing leaves behind and not about
 * what a function returns if someone calls it. Clause 2 in particular is
 * asserted against `runs.jsonl` read as bytes — the fixture's config is edited
 * to a third, different mandate before the ledger is read, so a record that
 * derived its answer from the vault instead of carrying it would come back with
 * that third text and fail.
 *
 * Clause 3's mid-run edit is the case a naive implementation gets wrong in a way
 * that looks right: read the outcome once and stamp it, at either end, and the
 * record asserts something that was not true for the whole run. So the bracket
 * below edits `ost.config.yaml` between `loop start` and `loop seal`, and the
 * sealed line has to carry both texts and say they differ.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { closeGoalContract, goalContractReport, goalDigest, observeGoal, isGoalUnreadable } from "../../src/loop/goal-contract.js";
import { readRuns } from "../../src/loop/health.js";

const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

let vault: string;

interface Ran {
  code: number;
  out: string;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function loop(subcommand: string, ...args: string[]): Ran {
  const r = spawnSync(TSX, [CLI, "loop", subcommand, "--vault", vault, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Point the vault at a mandate. Committed, because `loop start` refuses a dirty tree. */
function setOutcome(outcome: string): void {
  fs.writeFileSync(path.join(vault, "ost.config.yaml"), `outcome: ${JSON.stringify(outcome)}\n`, "utf8");
  git("add", "-A");
  git("commit", "--quiet", "-m", "outcome");
}

/**
 * One whole firing, in the shape `computeVerdict` requires: both `REQUIRED_PHASES`
 * produce a step, so the run seals `no-op` (nothing moved HEAD) and exits 0. The
 * phase commands are `git --version` — a real process with a real exit code,
 * doing nothing to the vault, because what is under test is the record and not
 * the work.
 */
function fire(): void {
  const started = loop("start");
  expect(started.code, started.out).toBe(0);
  for (const phase of ["pass", "check"]) {
    const step = loop("step", "--phase", phase, "--", "git", "--version");
    expect(step.code, step.out).toBe(0);
  }
  traceToolCall();
  const sealed = loop("seal");
  expect(sealed.code, sealed.out).toBe(0);
}

/**
 * One traced tool invocation, exactly as `withUsageTracing` writes them — the
 * same fixture `test/cli/loop.test.ts` uses, and for the same reason. A firing
 * whose pass phase traces nothing seals `degraded` (`src/loop/degraded.ts`), and
 * the brackets here run `git --version` for their pass step, so this line is what
 * stands for the pass they are standing in for.
 */
function traceToolCall(): void {
  fs.appendFileSync(
    path.join(vault, ".ost-agent", "usage", "events.jsonl"),
    JSON.stringify({ ts: new Date().toISOString(), tool: "ost_next_work", ok: true, ms: 2, surface: "mcp", argBytes: 8 }) + "\n",
    "utf8",
  );
}

const FIRST = "make the thing people are already asking for";
const SECOND = "make the thing nobody has asked for yet";
const THIRD = "a mandate no firing below ever ran against";

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-goal-contract-"));
  git("init", "--quiet");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  fs.writeFileSync(path.join(vault, "Root.md"), "# Root\n");
  // Tracked and empty before the first firing, so the appends `traceToolCall`
  // makes read as a modification under `.ost-agent/usage/` — which the dirty-tree
  // gate exempts — rather than as an untracked `?? .ost-agent/`, which it refuses.
  const trace = path.join(vault, ".ost-agent", "usage", "events.jsonl");
  fs.mkdirSync(path.dirname(trace), { recursive: true });
  fs.writeFileSync(trace, "", "utf8");
  setOutcome(FIRST);
});
afterEach(() => fs.rmSync(vault, { recursive: true, force: true }));

describe("1 — every pass records the outcome text it ran against", () => {
  test("a firing's sealed record carries the mandate verbatim", () => {
    fire();

    const [run] = readRuns(vault);
    expect(run.goal, "the sealed run record has no goal contract at all").toBeDefined();
    const opened = run.goal!.opened;
    if ("unknown" in opened) throw new Error(`the outcome was not readable: ${opened.unknown}`);
    expect(opened.text).toBe(FIRST);
    expect(opened.digest).toBe(goalDigest(FIRST));
  });

  test("the record says it re-read the mandate at seal, so 'it held' is a comparison and not a silence", () => {
    fire();

    const [run] = readRuns(vault);
    expect(run.goal!.sealed, "nothing was recorded at the seal end of the run").toBeDefined();
    expect(run.goal!.drift).toBe("held");
  });

  test("an open, unsealed run already carries what it opened against", () => {
    const started = loop("start");
    expect(started.code, started.out).toBe(0);

    const open = JSON.parse(fs.readFileSync(path.join(vault, ".git", "ost-agent", "open-run.json"), "utf8"));
    expect(open.goal?.opened?.text).toBe(FIRST);
    // A run that dies here is swept as `crashed` carrying this stamp — the aim of
    // a firing that never finished is exactly the one nobody can reconstruct.
    expect(open.goal?.sealed).toBeUndefined();
  });

  test("the firing says out loud what it is running against, at both ends", () => {
    const started = loop("start");
    expect(started.out).toContain(FIRST);
    const sealed = loop("seal");
    expect(sealed.out).toContain(FIRST);
  });
});

describe("2 — two passes that ran against different outcomes are distinguishable from the records alone", () => {
  test("the ledger tells them apart with the vault pointed somewhere else entirely", () => {
    fire();
    setOutcome(SECOND);
    fire();

    // The vault's current state is now a third mandate neither firing ever saw.
    // Anything that answers this question by reading the vault answers `THIRD`.
    setOutcome(THIRD);

    const ledger = fs.readFileSync(path.join(vault, ".git", "ost-agent", "runs.jsonl"), "utf8");
    const lines = ledger.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);

    const texts = lines.map((r) => r.goal.opened.text);
    expect(texts).toEqual([FIRST, SECOND]);
    expect(new Set(lines.map((r) => r.goal.opened.digest)).size).toBe(2);
    expect(texts).not.toContain(THIRD);
  });

  test("two firings under the SAME mandate are not spuriously distinguishable", () => {
    // The other half of the claim: if every record differed, the ledger would
    // "distinguish" firings that ran against identical text and the property
    // above would be measuring the timestamp rather than the mandate.
    fire();
    fire();

    const runs = readRuns(vault);
    const digests = runs.map((r) => (("digest" in r.goal!.opened) ? r.goal!.opened.digest : null));
    expect(new Set(digests).size).toBe(1);
  });
});

describe("3 — a mid-run change is reported, not stamped as though one end held throughout", () => {
  /** The same bracket as `fire`, with a human retuning the mandate in the middle of it. */
  function fireWithMidRunRetune(): Ran {
    const started = loop("start");
    expect(started.code, started.out).toBe(0);
    const passStep = loop("step", "--phase", "pass", "--", "git", "--version");
    expect(passStep.code, passStep.out).toBe(0);
    traceToolCall();

    // The retune lands here — after the pass has run against FIRST, before the
    // firing has accounted for itself.
    setOutcome(SECOND);

    const checkStep = loop("step", "--phase", "check", "--", "git", "--version");
    expect(checkStep.code, checkStep.out).toBe(0);
    return loop("seal");
  }

  test("the sealed record carries both texts and says they differ", () => {
    const sealed = fireWithMidRunRetune();
    expect(sealed.code, sealed.out).toBe(0);

    const [run] = readRuns(vault);
    const { opened, sealed: atSeal, drift } = run.goal!;
    if ("unknown" in opened || !atSeal || "unknown" in atSeal) throw new Error("both ends should have been readable");
    expect(opened.text).toBe(FIRST);
    expect(atSeal.text).toBe(SECOND);
    expect(drift).toBe("changed");
  });

  test("the report names the change and both texts, on the channel a cron reads", () => {
    const sealed = fireWithMidRunRetune();

    expect(sealed.out).toMatch(/goal changed mid-run/);
    expect(sealed.out).toContain(FIRST);
    expect(sealed.out).toContain(SECOND);
  });

  test("`loop health` reports the last firing's aim off its own record, not off the vault", () => {
    fire();
    setOutcome(SECOND);

    const health = loop("health");
    expect(health.code, health.out).toBe(0);
    expect(health.out).toContain(FIRST);
    expect(health.out).not.toContain(SECOND);
  });
});

describe("the reading itself — what an unreadable mandate records", () => {
  test("a directory with no config records that it had none, rather than an empty mandate", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ost-goal-noconfig-"));
    try {
      const observed = observeGoal(empty, Date.parse("2026-08-21T00:00:00Z"));
      expect(isGoalUnreadable(observed)).toBe(true);
      if (!isGoalUnreadable(observed)) throw new Error("unreachable");
      expect(observed.unknown).toContain("ost.config.yaml");
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  test("a broken config records the reason, not a mandate of ''", () => {
    fs.writeFileSync(path.join(vault, "ost.config.yaml"), "outcome: [\n", "utf8");
    const observed = observeGoal(vault, Date.parse("2026-08-21T00:00:00Z"));
    expect(isGoalUnreadable(observed)).toBe(true);
  });

  test("an end that could not be read is never reported as having held", () => {
    const at = "2026-08-21T00:00:00Z";
    const readable = { text: FIRST, digest: goalDigest(FIRST), source: "ost.config.yaml", at };
    const contract = closeGoalContract(readable, { unknown: "gone", at });

    expect(contract.drift).toBe("unknown");
    expect(goalContractReport(contract).join("\n")).not.toMatch(/from open to seal/);
  });

  test("the report is silent only when there is no contract at all", () => {
    expect(goalContractReport(undefined)).toEqual([]);
    const at = "2026-08-21T00:00:00Z";
    const held = closeGoalContract(
      { text: FIRST, digest: goalDigest(FIRST), source: "ost.config.yaml", at },
      { text: FIRST, digest: goalDigest(FIRST), source: "ost.config.yaml", at },
    );
    expect(goalContractReport(held).length).toBeGreaterThan(0);
  });
});
