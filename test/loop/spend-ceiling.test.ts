/**
 * The spend ceiling stops the loop dead, whatever it thinks it is doing.
 *
 * This is the spec for the one property that is the ceiling's whole advantage
 * over a stop predicate or a wake signal: **the limit is external to the loop's
 * own judgement and cannot be argued with.** A stop predicate relies on the
 * loop correctly evaluating something; a ceiling holds even when the loop is
 * confidently wrong about how much work is left. So every test here drives the
 * loop to the ceiling while its own judgement insists work remains, and
 * requires the halt anyway:
 *
 *   - between firings, `loop due` refuses once the window's spend reaches the
 *     ceiling, however many times the loop's predicate says "fire again";
 *   - inside a firing, `loop step` refuses to run the next phase once the
 *     ceiling is crossed — the command the loop was about to run IS its claim
 *     that work remains, and it is never spawned;
 *   - the ceiling a firing runs under is stamped at `loop start` and never
 *     re-read, so widening the config mid-firing widens nothing.
 *
 * Driven through the real CLI rather than the modules, like `test/cli/loop.test.ts`,
 * because the wiring is the claim: a `checkCeiling` that nothing consults would
 * satisfy a unit test and stop no loop.
 *
 * What a green here does NOT settle, because no spec can: whether the spend
 * bought anything. A loop that burns its budget on invented work hits this
 * ceiling looking exactly like one that did something useful — that judgement
 * is the humans-required test on the node, and it stays with the humans.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

// The local tsx binary, invoked directly rather than through `npx` — `npx`
// takes npm's cacache lock, and dozens of concurrent spawns contend on it.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

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

/** `out` is stdout AND stderr — the halt is announced on stderr, where a cron reads. */
function loop(subcommand: string, ...args: string[]): Ran {
  const r = spawnSync(TSX, [CLI, "loop", subcommand, "--vault", vault, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function config(loopBlock: string): void {
  fs.writeFileSync(path.join(vault, "ost.config.yaml"), `outcome: "ship it"\n${loopBlock}`, "utf8");
}

/**
 * Spend arriving in this vault's transcript, APPENDED so it accumulates the way
 * a real session's usage records do. `outputTokens` are weighted ×5 by the
 * repo's one cost model, so 60 output tokens is 300 weighted.
 */
function spend(outputTokens: number): void {
  fs.appendFileSync(
    path.join(sessions, "s.jsonl"),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      cwd: fs.realpathSync(vault),
      message: { usage: { output_tokens: outputTokens } },
    }) + "\n",
    "utf8",
  );
}

const CEILING_1000 = [
  "loop:",
  '  cadence: "6h"',
  "  spend:",
  "    ceilingWeightedTokens: 1000",
  "    windowHours: 24",
  '    sessionsDir: "../sessions"',
  "",
].join("\n");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-spend-ceiling-"));
  vault = path.join(dir, "vault");
  sessions = path.join(dir, "sessions");
  fs.mkdirSync(vault);
  fs.mkdirSync(sessions);
  git("init", "--quiet");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  config(CEILING_1000);
  git("add", "-A");
  git("commit", "--quiet", "-m", "baseline");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("between firings — the ceiling halts a loop whose own judgement never would", () => {
  test("driven to the ceiling by a stop predicate that always insists work remains, the loop halts anyway", () => {
    // The loop's own judgement, in its most adversarial form: a predicate that
    // NEVER concedes. If the halt below depended on this in any way, the test
    // could not halt at all — which is exactly the case the node was written
    // for, a loop whose reasoning is the broken thing.
    let asked = 0;
    const workRemains = (): boolean => {
      asked += 1;
      return true;
    };

    let haltedAtRound = 0;
    let halt: Ran | undefined;
    for (let round = 1; round <= 10; round += 1) {
      if (!workRemains()) break; // never taken, and that is the point
      const r = loop("due");
      if (r.code === 13) {
        haltedAtRound = round;
        halt = r;
        break;
      }
      expect(r.code).toBe(0);
      spend(60); // one firing's worth: 300 weighted against the 1000 ceiling
    }

    // Deterministic: 300 weighted per firing halts the fifth ask, after 1200.
    expect(haltedAtRound).toBe(5);
    expect(halt?.out).toMatch(/ceiling/);
    // The refusal names its own way out — time, not a human editing YAML.
    expect(halt?.out).toMatch(/window rolls forward/);
    // The predicate was still insisting when the loop stopped: the halt was
    // external to the loop's judgement, not a product of it.
    expect(asked).toBe(5);
    expect(workRemains()).toBe(true);
  });
});

describe("mid-firing — a pass that crosses the ceiling is stopped at the next phase boundary", () => {
  test("the next phase is refused, never spawned, and the halt is on the record", () => {
    spend(1); // 5 weighted — well under the ceiling, so the firing opens
    expect(loop("start").code).toBe(0);
    expect(loop("step", "--phase", "pass", "--", "true").code).toBe(0);

    // The pass phase spent past the ceiling while it ran (Claude Code appends
    // usage records live; the loop only sees them at the boundary).
    spend(400); // 2000 weighted, over the 1000 ceiling

    // The command the loop hands to the next step IS its claim that work
    // remains. Its side effect is the proof of whether it was ever spawned.
    const marker = path.join(dir, "check-ran");
    const halted = loop("step", "--phase", "check", "--", "sh", "-c", `touch "${marker}"`);
    expect(halted.code).toBe(13);
    expect(halted.out).toMatch(/halting mid-firing/);
    expect(halted.out).toMatch(/ceiling/);
    expect(fs.existsSync(marker)).toBe(false);

    // The halt seals like what it is: a firing that did not finish its job. And
    // the ledger says the phase was REFUSED, not that the command exited 13.
    const sealed = loop("seal");
    expect(sealed.out).toMatch(/sealed: unhealthy/);
    expect(sealed.code).toBe(1);
    const ledger = fs.readFileSync(path.join(vault, ".git", "ost-agent", "runs.jsonl"), "utf8").trim().split("\n");
    const run = JSON.parse(ledger[ledger.length - 1]);
    const haltStep = run.steps.find((s: { phase: string }) => s.phase === "check");
    expect(haltStep).toMatchObject({ exit: 13, refused: "spend-ceiling" });
  });

  test("widening the config mid-firing widens nothing — the stamp taken at start is the budget", () => {
    spend(300); // 1500 weighted: already over the 1000 ceiling once measured
    expect(loop("start").code).toBe(0); // start does not gate on spend; `due` does

    // The spender's move: raise the declared ceiling out of reach while the
    // firing is running. `loop step` must enforce the number stamped at start,
    // or a budget re-read from a file mid-run is a budget its spender can widen.
    config(CEILING_1000.replace("ceilingWeightedTokens: 1000", "ceilingWeightedTokens: 1000000"));

    const halted = loop("step", "--phase", "pass", "--", "true");
    expect(halted.code).toBe(13);
    expect(halted.out).toMatch(/halting mid-firing/);
  });

  test("under the ceiling the phases run — the halt is not simply refusing everything", () => {
    spend(1); // 5 weighted
    expect(loop("start").code).toBe(0);
    const marker = path.join(dir, "pass-ran");
    expect(loop("step", "--phase", "pass", "--", "sh", "-c", `touch "${marker}"`).code).toBe(0);
    expect(fs.existsSync(marker)).toBe(true);
  });

  test("a firing opened without a declared ceiling is not halted — no bound is invented", () => {
    // `loop due` refuses an undeclared ceiling before any conforming firing
    // opens (exit 12); a bracket driven directly past it — a test, a manual
    // run — carries no stamp, and inventing a number to enforce would be the
    // one thing the spend gate never does. The scope of the mid-firing halt is
    // exactly the ceiling somebody declared.
    config('loop:\n  cadence: "6h"\n');
    git("add", "-A");
    git("commit", "--quiet", "-m", "no ceiling");
    spend(400); // spend that WOULD halt, were any ceiling stamped
    expect(loop("start").code).toBe(0);
    expect(loop("step", "--phase", "pass", "--", "true").code).toBe(0);
  });
});
