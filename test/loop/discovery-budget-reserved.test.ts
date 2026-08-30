/**
 * The discovery reserve is protected — a share of the window's passes that build
 * work cannot spend, however much building there is to do.
 *
 * This is the spec for the solution "Protected discovery budget", and it is
 * written against the one failure the opportunity beneath it names: there is one
 * pool of attention and two claims on it, building has a visible artefact at the
 * end, and every time they compete the artefact wins — not because anyone decided
 * it should, but because nothing separates the two budgets.
 *
 * In this repository that is literal rather than metaphorical. Both wrappers
 * launch Claude Code with the vault as cwd, so both write transcripts into the
 * directory `loop.spend.sessionsDir` names and both are charged against the same
 * window by `measureFiring`. `loop due` is the discovery loop's gate; the build
 * loop deliberately does not call it. So before this existed, build spent the
 * shared pool without ever being asked whether anything was left for discovery.
 *
 * Three things have to hold for the reserve to be a protection rather than a
 * label, and this file is those three:
 *
 *   1. **A configured share is held.** Build is refused once it has spent its
 *      allowance, while budget remains in the window.
 *   2. **The refusal is of build, not of passes in general.** Discovery is never
 *      refused by the mechanism that exists to protect it.
 *   3. **The reserve does not roll over.** An idle discovery loop does not enlarge
 *      the build allowance — this window or the next. A budget build can borrow
 *      from when its owner is not looking is not a protection, and computing
 *      build's allowance as "budget minus what discovery used" is the
 *      implementation that quietly does exactly that.
 *
 * Driven through the real CLI rather than the module, like
 * `test/loop/spend-ceiling.test.ts`, because the wiring is the claim: an
 * `assessReserve` nothing consults would satisfy a unit test and protect nothing.
 * For the same reason the last block asserts that the build wrapper actually gates
 * its model call on this command — the pass that spends the pool is the pass that
 * has to ask.
 *
 * What a green here does NOT settle, and cannot: whether the reserved passes were
 * WORTH anything. A budget guarantees effort, not value, and a loop that spends
 * three protected passes on low-signal busywork looks exactly like one that
 * learned something. That judgement is the human rating the assumption test asks
 * for ("did this change what I believe about the product, or what I plan to do
 * next?", ≥2 of 3), and it stays with the human.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

// The local tsx binary, invoked directly rather than through `npx` — `npx` takes
// npm's cacache lock, and dozens of concurrent spawns contend on it.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The build loop's refusal code — routine, and distinct from the spend ceiling's. */
const RESERVE_HELD = 22;

let dir: string;
let vault: string;

interface Ran {
  code: number;
  out: string;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** `out` is stdout AND stderr — the refusal is announced on stderr, where a cron reads. */
function loop(subcommand: string, ...args: string[]): Ran {
  const r = spawnSync(TSX, [CLI, "loop", subcommand, "--vault", vault, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * A window of 10 passes with 3 held for discovery, so build may spend 7.
 *
 * The numbers are the assumption test's: three reserved discovery passes. The
 * total is what makes the reserve a *share* rather than a second cadence.
 */
function config(reserveBlock: string[] = ["  reserve:", "    discoveryPasses: 3", "    totalPasses: 10", "    windowHours: 24"]): void {
  fs.writeFileSync(
    path.join(vault, "ost.config.yaml"),
    ["outcome: ship it", "loop:", '  cadence: "1h"', ...reserveBlock, ""].join("\n"),
    "utf8",
  );
}

/** A discovery firing on record, `hoursAgo` back. This is the ledger `loop start` writes. */
function discoveryFiring(hoursAgo: number): void {
  const at = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  fs.appendFileSync(
    path.join(vault, ".git", "ost-agent", "runs.jsonl"),
    JSON.stringify({ runId: `r-${at}`, startedAt: at, verdict: "healthy", steps: [] }) + "\n",
    "utf8",
  );
}

/** A build pass on record, `hoursAgo` back — what `loop reserve --claim` appends. */
function buildPass(hoursAgo: number): void {
  const at = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  fs.appendFileSync(path.join(vault, ".git", "ost-agent", "build-passes.jsonl"), JSON.stringify({ at }) + "\n", "utf8");
}

function buildPassesOnRecord(): number {
  const p = path.join(vault, ".git", "ost-agent", "build-passes.jsonl");
  if (!fs.existsSync(p)) return 0;
  return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).length;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-discovery-reserve-"));
  vault = path.join(dir, "vault");
  fs.mkdirSync(vault);
  git("init", "--quiet");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  fs.mkdirSync(path.join(vault, ".git", "ost-agent"), { recursive: true });
  config();
  git("add", "-A");
  git("commit", "--quiet", "-m", "baseline");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("a configured share of passes is held for discovery", () => {
  test("build spends its allowance and is then refused, with budget still in the window", () => {
    // The build loop's own judgement, in its most adversarial form: a queue that
    // never empties. If the refusal below depended on the builder agreeing there
    // was nothing left to build, it could not fire at all — which is the case the
    // node was written for, a loop whose reasoning always finds one more artefact.
    let asked = 0;
    const workRemains = (): boolean => {
      asked += 1;
      return true;
    };

    let refusedAtRound = 0;
    let refusal: Ran | undefined;
    for (let round = 1; round <= 10; round += 1) {
      if (!workRemains()) break; // never taken, and that is the point
      const r = loop("reserve", "--kind", "build", "--claim");
      if (r.code === RESERVE_HELD) {
        refusedAtRound = round;
        refusal = r;
        break;
      }
      expect(r.code).toBe(0);
    }

    // 10 passes in the window, 3 held: the eighth ask is the one that is refused.
    expect(refusedAtRound).toBe(8);
    expect(buildPassesOnRecord()).toBe(7);

    // The refusal names what is holding it and how it clears — time, not a person.
    expect(refusal?.out).toMatch(/held for discovery/);
    expect(refusal?.out).toMatch(/window rolls forward/);

    // And it does not read as the spend ceiling. Collapsing the two would send the
    // operator to raise a ceiling that was never the constraint.
    expect(refusal?.out).not.toMatch(/weighted token/);

    // The builder was still insisting when it was stopped: the refusal is external
    // to the loop's judgement, not a product of it.
    expect(asked).toBe(8);
    expect(workRemains()).toBe(true);
  });

  test("a refused build pass is not charged to the window", () => {
    for (let i = 0; i < 7; i += 1) buildPass(1);
    expect(loop("reserve", "--kind", "build", "--claim").code).toBe(RESERVE_HELD);
    // Charging a pass that was refused would consume a window it never spent, and
    // would keep the refusal alive an extra window every time the cron ticked.
    expect(buildPassesOnRecord()).toBe(7);
  });

  test("discovery is never refused by the mechanism that protects it", () => {
    // The pool is as consumed as it can be — build has spent its whole allowance
    // and discovery its whole reserve. The reserve still says yes to discovery: it
    // is a floor, not a second ceiling. What bounds the pair is `loop.spend`.
    for (let i = 0; i < 7; i += 1) buildPass(1);
    for (let i = 0; i < 3; i += 1) discoveryFiring(1);
    const r = loop("reserve", "--kind", "discovery");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/discovery has used 3 pass\(es\)/);
  });
});

describe("the reserve does not roll over into building", () => {
  test("a window discovery never touched gives build no extra pass", () => {
    // The failure this whole file exists to catch. Discovery has fired ZERO times
    // in the window, so all three of its passes are sitting unused — and the
    // obvious implementation ("allowance = total minus what discovery used") hands
    // build all ten. Build still gets seven.
    for (let i = 0; i < 7; i += 1) buildPass(1);
    const refusal = loop("reserve", "--kind", "build", "--claim");
    expect(refusal.code).toBe(RESERVE_HELD);
    expect(refusal.out).toMatch(/it has used 0/);
    expect(buildPassesOnRecord()).toBe(7);
  });

  test("an idle discovery window banks nothing for the next one", () => {
    // Discovery spent nothing in the window that just aged out, and build spent
    // everything. The unused passes are lost rather than carried: the new window
    // starts at the same seven, not at ten.
    for (let i = 0; i < 7; i += 1) buildPass(30); // aged out of a 24h window
    for (let i = 0; i < 7; i += 1) expect(loop("reserve", "--kind", "build", "--claim").code).toBe(0);
    expect(loop("reserve", "--kind", "build", "--claim").code).toBe(RESERVE_HELD);
  });

  test("passes age out of the window, so the refusal clears without anyone editing a file", () => {
    // The way out the refusal advertises, exercised. Six of the seven build passes
    // are older than the window; one is inside it, so six remain.
    for (let i = 0; i < 6; i += 1) buildPass(30);
    buildPass(1);
    const r = loop("reserve", "--kind", "build");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/build has used 1 of 7/);
  });
});

describe("the reserve is declared, never invented", () => {
  test("no reserve block ⇒ nothing is held, and the gate says so instead of refusing", () => {
    // The rule this schema keeps everywhere: a number nobody declared is not a
    // bound. Refusing every build pass on a vault that predates the key would be a
    // stopping state whose only exit is a human editing YAML.
    config([]);
    for (let i = 0; i < 20; i += 1) buildPass(1);
    const r = loop("reserve", "--kind", "build");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/no `loop\.reserve`/);
    expect(r.out).toMatch(/nothing is protected/);
  });

  test("a half-typed block is read as undeclared, not as a bound nobody stated", () => {
    config(["  reserve:", "    discoveryPasses: 3"]);
    for (let i = 0; i < 20; i += 1) buildPass(1);
    const r = loop("reserve", "--kind", "build");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/no `loop\.reserve`/);
  });

  test("a record stamped in the future is ignored and reported, never allowed to wedge the gate", () => {
    // `cadence.ts`'s lesson, which bites harder here: one build record stamped a
    // year out would sit inside every window until the clock caught up, holding
    // build off permanently with a hand-edited JSONL file as the only way out.
    const ahead = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    fs.appendFileSync(
      path.join(vault, ".git", "ost-agent", "build-passes.jsonl"),
      JSON.stringify({ at: ahead }) + "\n",
      "utf8",
    );
    for (let i = 0; i < 6; i += 1) buildPass(1);
    const r = loop("reserve", "--kind", "build");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/stamped in the future/);
    expect(r.out).toMatch(/build has used 6 of 7/);
  });
});

describe("the pass that spends the pool is the pass that asks", () => {
  /*
   * A reserve nothing consults protects nothing, and the consumer here is a shell
   * script rather than a caller this suite can drive. These pin the wiring: the
   * build wrapper asks before it spends a model call, and it asks in the form that
   * charges the window.
   */
  const script = fs.readFileSync(path.join(repoRoot, "examples/automation/build-pass.sh"), "utf8");
  const executable = script
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

  test("the build wrapper gates its model call on the reserve", () => {
    const gateAt = executable.search(/loop reserve --kind build --claim/);
    const claudeAt = executable.indexOf("claude -p");
    expect(gateAt).toBeGreaterThan(-1);
    expect(claudeAt).toBeGreaterThan(gateAt);
  });

  test("it claims the pass rather than only asking about it", () => {
    // A check without a claim reads the same answer on every tick and refuses
    // nothing, forever: the window is only consumed by something writing to it.
    expect(executable).toMatch(/--claim/);
  });

  test("a held reserve ends the firing without spending a model call", () => {
    // The refusal has to cost nothing, or the protection is paid for out of the
    // pool it is protecting.
    expect(executable).toMatch(/RESERVE_EXIT/);
    expect(executable).toMatch(/\b22\b/);
  });
});
