/**
 * A pass that errored may not be mistaken for a pass that had nothing to do.
 *
 * The friction this comes from was observed mechanically on 2026-07-25: `P2_map`
 * died on an auth error, exited 0, wrote a commit and printed a tidy summary. On
 * a nightly cron that firing would have no-opped forever while looking perfectly
 * healthy. The answer the tree chose is the machine-legible floor — cron,
 * launchd and CI all speak exit codes already — so this pins the channel those
 * schedulers actually read, against the real runner entry point rather than
 * against a helper.
 *
 * Three claims, and they are the assumption test's own words:
 *
 *   1. a pass that throws mid-run exits nonzero;
 *   2. a pass that completes exits zero;
 *   3. the failing run prints a summary naming the phase it died in and the last
 *      node it touched.
 *
 * The third is the one with teeth, and it is not decoration. `loop seal` already
 * printed a per-step checklist — on stdout, above twenty lines of sense census —
 * in which `✗ pass (exit 3)` is one line among many and no line anywhere says
 * which node the firing was on when it died. Two things follow. A summary on the
 * channel this repository reserves for what a cron must not scroll past (stderr,
 * as `degradedReport` and the stall escalation already are), and the last node
 * touched, read off the vault's own tool trace — the one record the reasoning
 * that would like to look clean cannot author.
 *
 * **The negative controls are half the spec.** A summary printed on every seal
 * would satisfy every positive assertion here and mean nothing, so a completed
 * run and a merely-degraded run are both asserted to leave no failure summary
 * behind. `degraded` is deliberately included: it has its own exit code because a
 * wrapper must be able to tell "the tree came back red" from "the pass never
 * reached the tree", and a FAILED banner over both would undo that.
 *
 * What this does NOT settle, stated because the node it serves says so plainly:
 * whether a real cron NOTICES within a cycle. That needs a scheduled run broken
 * on purpose and a person watching the clock.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { appendStep, startRun } from "../../src/loop/health.js";
import { gitHead } from "../../src/loop/state.js";
import { buildOstTools } from "../../src/security/tools.js";
import { Vault } from "../../src/ost/vault.js";

// The local tsx binary, invoked directly rather than through `npx` — same reason
// as `test/cli/first-run.test.ts`: `npx` takes npm's cacache lock, and dozens of
// concurrent spawns on a small runner contend on it.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

/** The root node's title, and therefore the basename of its file. */
const ROOT = "Retention";
const ROOT_FILE = `${ROOT}.md`;

let vault: string;

beforeEach(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-pass-exit-"));
  await initVault(vault, "Reach ten thousand daily active users", ROOT);
});
afterEach(() => fs.rmSync(vault, { recursive: true, force: true }));

interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** The real CLI, in a child process, so the exit code under test is a real one. */
function cli(...args: string[]): Ran {
  const r = spawnSync(TSX, [CLI, ...args], { encoding: "utf8", cwd: vault });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const start = () => cli("loop", "start", "--vault", vault);
const seal = () => cli("loop", "seal", "--vault", vault);
const step = (phase: string, ...command: string[]) =>
  cli("loop", "step", "--phase", phase, "--vault", vault, "--", ...command);

/** A phase command that exits with `code` and is otherwise silent. */
const exits = (code: number) => [process.execPath, "-e", `process.exit(${code})`];

/**
 * A run opened and stepped through the same writers `loop start` and `loop step`
 * call, without paying for a child process each.
 *
 * The two tests above spend the spawns, because exit-code PROPAGATION is what
 * they measure and only a real process can answer that. Everything below
 * measures what the seal SAYS — and the seal is spawned for real in every one of
 * them, reading a record written by the module the CLI hands the job to. What is
 * skipped is the lock and the dirty-tree refusal, neither of which is a subject
 * here.
 */
function openRun(): void {
  startRun(vault, { loopVersion: "test", cliVersion: "test", headBefore: gitHead(vault) });
}

function recordSteps(steps: readonly { phase: string; exit: number }[]): void {
  for (const s of steps) {
    appendStep(vault, {
      phase: s.phase,
      command: `node -e process.exit(${s.exit})`,
      argv: [process.execPath, "-e", `process.exit(${s.exit})`],
      cwd: vault,
      exit: s.exit,
      durationMs: 1,
    });
  }
}

/** The pass phase died; the check that follows it ran clean. */
const DIED_IN_PASS = [
  { phase: "pass", exit: 3 },
  { phase: "check", exit: 0 },
] as const;

/**
 * Reach the tree the way a pass does: through the allowlisted surface, so the
 * call lands in `.ost-agent/usage/events.jsonl` exactly as an unattended firing's
 * would. `ost_annotate` is deliberately an EDIT and not a create — the trace's
 * pre-existing `wrote` field names only node files a call brought into existence,
 * and a pass that spent its night annotating and merging would report "no node
 * touched" if that were the only field a summary could read.
 *
 * It also commits, which moves the vault's HEAD — that is what lets a completed
 * run seal `healthy` rather than `no-op`.
 */
async function reachTheTree(issue: string): Promise<void> {
  const tools = buildOstTools(
    { vault: new Vault(vault, { create: false }), dir: vault, remote: { enabled: false }, surface: "pass:test" },
    ["ost_annotate"],
  ) as unknown as { name: string; run: (i: unknown) => Promise<string> }[];
  await tools[0].run({ title: ROOT, issue });
}

describe("the channel a cron reads carries the truth about a pass that errored", () => {
  test("a phase that throws exits nonzero, and so does the seal that follows it", async () => {
    expect(start().status).toBe(0);
    await reachTheTree("the pass reached the tree before it died");

    // The phase's own exit code, unlaundered: 3 in, 3 out.
    expect(step("pass", ...exits(3)).status).toBe(3);
    expect(step("check", ...exits(0)).status).toBe(0);

    // And the seal — the command the wrapper's EXIT trap runs, and the last word
    // any scheduler gets — does not report a clean firing over it.
    expect(seal().status).not.toBe(0);
  });

  test("a pass that completes exits zero, so the nonzero above means something", async () => {
    expect(start().status).toBe(0);
    await reachTheTree("the pass reached the tree");

    expect(step("pass", ...exits(0)).status).toBe(0);
    expect(step("check", ...exits(0)).status).toBe(0);

    // Zero is the one word an unattended caller reads as clean, and this firing
    // earned it: both required phases ran green, the tree was reached, HEAD moved.
    expect(seal().status).toBe(0);
  });
});

describe("the failure summary a broken pass leaves behind", () => {
  test("names the phase it died in, and its exit code, where a cron will not scroll past it", async () => {
    openRun();
    await reachTheTree("the pass reached the tree before it died");
    recordSteps(DIED_IN_PASS);

    const sealed = seal();
    expect(sealed.stderr).toMatch(/FAILED/);
    expect(sealed.stderr).toMatch(/\bpass\b/);
    expect(sealed.stderr).toMatch(/exit 3\b/);
    // `check` ran green; naming it in a failure summary would send a reader to
    // the wrong phase, which is the whole complaint this test descends from.
    expect(sealed.stderr).not.toMatch(/died in phase [`'"]?check/);
  });

  test("names the last node it touched, read off the trace rather than off the pass's account", async () => {
    openRun();
    await reachTheTree("the pass reached the tree before it died");
    recordSteps(DIED_IN_PASS);

    expect(seal().stderr).toContain(ROOT_FILE);
  });

  test("a failing run that touched no node says so, rather than being silent about it", () => {
    openRun();
    // No call to `reachTheTree`: this is the auth-error shape, where the driver
    // died before it reached the vault at all.
    recordSteps(DIED_IN_PASS);

    const sealed = seal();
    expect(sealed.stderr).toMatch(/FAILED/);
    // The distinction the summary owes its reader: "it touched nothing" is a
    // finding, and it must not be spelled the same way as "this line is missing".
    expect(sealed.stderr).toMatch(/last node touched: none/i);
    expect(sealed.stderr).not.toContain(ROOT_FILE);
  });
});

describe("what the summary must NOT say, so that saying it means something", () => {
  test("a completed run leaves no failure summary behind", async () => {
    openRun();
    await reachTheTree("the pass reached the tree");
    recordSteps([
      { phase: "pass", exit: 0 },
      { phase: "check", exit: 0 },
    ]);

    const sealed = seal();
    expect(sealed.status).toBe(0);
    expect(sealed.stderr).not.toMatch(/FAILED/);
  });

  test("a degraded run keeps its own exit code and its own words — it is not relabelled a failure", () => {
    openRun();
    // Every phase green and the tree never reached: the twenty-two-firing shape
    // `degraded` exists to name. It is not a failure and must not be dressed as
    // one — a wrapper that cannot tell the two apart is what `LOOP_EXIT.degraded`
    // exists to prevent.
    recordSteps([
      { phase: "pass", exit: 0 },
      { phase: "check", exit: 0 },
    ]);

    const sealed = seal();
    expect(sealed.status).not.toBe(0);
    expect(sealed.status).not.toBe(1);
    expect(sealed.stderr).toMatch(/degraded/);
    expect(sealed.stderr).not.toMatch(/FAILED/);
  });
});
