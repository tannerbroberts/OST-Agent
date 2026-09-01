/**
 * Kill a pass at twenty points, restart each one, and check what the vault
 * holds afterwards.
 *
 * The assumption under test (meta vault, beneath "Resumable append-only process
 * journal" → "Killing the process at any instant leaves a state a restart can
 * resume from"): *a pass can be killed at any instant and restarted with no
 * corruption, no duplicate nodes, no half-written state, and no stuck locks.*
 * The threshold was fixed by the node before any of this existed and is
 * absolute rather than a percentage — **20 of 20 restarts produce a valid vault
 * with zero duplicates and zero partial nodes, and the pass completes.** One
 * failure means the guarantee does not exist.
 *
 * ## Twenty points, taken rather than sampled
 *
 * The node says "twenty randomly chosen points". The pass under test
 * (`fixtures/resumable-pass.ts`) exposes exactly twenty instants strictly
 * inside itself, so this takes ALL of them instead of drawing twenty seeded
 * numbers out of a larger space. That is strictly stronger — a seeded draw
 * repeats points and leaves gaps, and it puts a reader in the position of
 * trusting a seed — and it costs nothing here, because the grid is small enough
 * to exhaust. What is lost is the argument for randomness itself, and the node
 * already states it: twenty enumerated points are the moments an author
 * imagined, and "kill it whenever you like" is a claim about every instant.
 *
 * ## What is real here and what is not
 *
 * REAL: a separate OS process running the shipping pass code, a real SIGKILL it
 * cannot catch, a real firing lock, the real journal, and the real `Vault`
 * writes. The restart is the same program run again with no kill, which is what
 * an operator does.
 *
 * NOT COVERED, and the omission is structural rather than an oversight: a kill
 * *inside* a single `write` syscall. The counter that makes these twenty points
 * reproducible can only tick between operations, so it can never land mid-write
 * — and a test that tried to would be a coin toss, since 64MB reaches the page
 * cache in 23ms. The half-written file that window would produce is what
 * `src/fs/atomic-write.ts` makes impossible, and `test/fs/atomic-write.test.ts`
 * checks that property the way it is decidable: a node write lands by rename,
 * which the target's inode reports exactly.
 */
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { checkInvariants } from "../../src/eval/invariants.js";
import { readJournal } from "../../src/loop/journal.js";
import { readFiringLock } from "../../src/loop/lock.js";
import { Vault } from "../../src/ost/vault.js";
import { TEMP_WRITE_SUFFIX } from "../../src/fs/atomic-write.js";
import { APPENDED_SECTION, OPPORTUNITY, OUTCOME, SOLUTION, STEPS } from "./fixtures/resumable-pass-shape.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const PASS = path.resolve(__dirname, "fixtures/resumable-pass.ts");

/** Every instant strictly inside the pass. See the fixture for the grid. */
const KILL_POINTS = Array.from({ length: 20 }, (_, i) => i + 1);
/** Ops at which a step's effect has landed and its journal line has not. */
const REPLAY_WINDOW_POINTS = [3, 6, 9, 12, 15, 18];
const NEVER_KILL = -1;

interface StepOutcome {
  id: string;
  disposition: "skipped" | "verified" | "ran";
}
interface PassSummary {
  runId: string;
  resumedFrom: { completed: string[]; inFlight: string[]; interrupted: boolean };
  outcomes: StepOutcome[];
}

function makeVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-kill-restart-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  // The one node the pass does not write: a valid tree needs exactly one
  // Outcome, and the pass hangs its work beneath this.
  fs.writeFileSync(
    path.join(dir, `${OUTCOME}.md`),
    ["---", "type: Outcome", "evidence: assertion", "---", "#Outcome #evidence/assertion", "", "The scratch mandate.", ""].join("\n"),
  );
  git("add", "-A");
  git("commit", "-qm", "scratch outcome");
  return dir;
}

/**
 * Run the pass. `killAt` of {@link NEVER_KILL} is the restart.
 *
 * `node --import tsx` rather than the `tsx` CLI: the CLI re-spawns node, so the
 * SIGKILL would land in a grandchild and the parent would see a plain exit
 * instead of the signal. Same reason as `run-journal-interruption.test.ts`.
 */
function runPass(vault: string, killAt: number) {
  return spawnSync(process.execPath, ["--import", "tsx", PASS, vault, String(killAt)], {
    cwd: REPO,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Every `.md` at the vault root — the files a reader would call nodes. */
function nodeFiles(vault: string): string[] {
  return fs
    .readdirSync(vault)
    .filter((n) => n.endsWith(".md"))
    .sort();
}

const vaults: string[] = [];
afterAll(() => {
  for (const v of vaults) fs.rmSync(v, { recursive: true, force: true });
});

/**
 * The four things the node's threshold names, asserted against a vault that has
 * been killed and restarted. Every one is computed the way the shipping reader
 * computes it — `check`'s own invariants over `readTreeCensus`, the census's own
 * unreadable/quarantined lists, and the real lock reader.
 */
function assertVaultIsWhole(vault: string, at: string): void {
  const census = new Vault(vault).readTreeCensus();

  // Valid: the deterministic invariants `ost-agent check` exits non-zero on.
  const violations = checkInvariants(census.nodes, census.quarantined);
  expect(violations.map((v) => `[${v.rule}] ${v.node ?? ""} ${v.detail}`), `${at}: invariants`).toEqual([]);

  // No partial nodes: a file the census could not parse or classify is exactly
  // what a truncated write leaves behind, and it is reported rather than thrown.
  expect(census.unreadable, `${at}: unreadable node files`).toEqual([]);
  expect(census.quarantined.map((q) => q.file), `${at}: quarantined node files`).toEqual([]);
  expect(census.skipped.map((s) => s.file), `${at}: files the reader dropped`).toEqual([]);

  // No duplicates: exactly the three nodes this pass produces, once each, and
  // the appended section present exactly once in each node that gets one. The
  // second is the replay hazard — an append re-run is a duplicated section that
  // no invariant would ever report.
  expect(nodeFiles(vault), `${at}: node files`).toEqual([`${OPPORTUNITY}.md`, `${OUTCOME}.md`, `${SOLUTION}.md`]);
  for (const title of [OPPORTUNITY, SOLUTION]) {
    const body = new Vault(vault).read(title).body;
    expect(body.split(APPENDED_SECTION).length - 1, `${at}: "${title}" carries the appended section once`).toBe(1);
  }

  // No half-written state left beside the nodes: a staging file whose writer
  // died is swept by the next pass, so a finished restart leaves none.
  expect(
    fs.readdirSync(vault).filter((n) => n.endsWith(TEMP_WRITE_SUFFIX)),
    `${at}: abandoned staging files`,
  ).toEqual([]);

  // No orphaned lock: the vault is usable by the next firing without anything
  // having to break a lock first.
  expect(readFiringLock(vault), `${at}: firing lock still held`).toBeNull();

  // The pass completed: the journal's last line is a seal, which is the only
  // thing that distinguishes a finished run from one that stopped.
  const journal = readJournal(vault);
  expect(journal[journal.length - 1]?.kind, `${at}: journal tail`).toBe("seal");
}

/**
 * One kill and one restart per point, run once, and every assertion below reads
 * those same forty processes.
 *
 * Deliberately not a spawn per assertion. This file already forks forty node
 * processes, and this repository has recorded what an over-eager test does to
 * the ones running beside it: `test/telemetry/same-run-baseline-ratio.test.ts`
 * documents its own first version manufacturing enough load to redden an
 * unrelated timing assertion, and calls fixing one flake by causing another not
 * a fix. Re-running the twenty for each property would have been fourteen more
 * spawns for facts the first twenty already established.
 */
interface Interruption {
  readonly vault: string;
  readonly lockAfterKill: ReturnType<typeof readFiringLock>;
  readonly summary: PassSummary;
}

const runs = new Map<number, Interruption>();

beforeAll(() => {
  for (const killAt of KILL_POINTS) {
    const vault = makeVault();
    vaults.push(vault);

    const killed = runPass(vault, killAt);
    // A run that finished was not interrupted and proves nothing about
    // interruption — the grid must actually reach every one of these points.
    expect(killed.signal, `killAt ${killAt} was not interrupted; stderr: ${killed.stderr}`).toBe("SIGKILL");
    const lockAfterKill = readFiringLock(vault);

    const restarted = runPass(vault, NEVER_KILL);
    expect(restarted.status, `killAt ${killAt} restart failed; stderr: ${restarted.stderr}`).toBe(0);

    runs.set(killAt, { vault, lockAfterKill, summary: JSON.parse(restarted.stdout.trim()) as PassSummary });
  }
}, 300_000);

describe("a pass killed at every instant it has, then restarted", () => {
  test("20 of 20 restarts leave a valid vault, no duplicates, no partial nodes and no stuck lock", () => {
    for (const [killAt, run] of runs) assertVaultIsWhole(run.vault, `killAt ${killAt}`);
  });

  test("20 of 20 passes completed — every step accounted for, none quietly left out", () => {
    for (const [killAt, run] of runs) {
      expect(run.summary.outcomes.map((o) => o.id).length, `killAt ${killAt} step count`).toBe(STEPS);
    }
  });

  test("a killed holder's lock is broken by the restart rather than waited out", () => {
    // Every kill lands while the lock is held — it is taken before the run opens
    // and released after the seal — so all twenty restarts had to break one.
    for (const [killAt, run] of runs) {
      expect(run.lockAfterKill, `killAt ${killAt}: the dead run's lock`).not.toBeNull();
    }
  });
});

describe("what the restart actually had to do", () => {
  /**
   * The distinguishing case. A kill at the instant between a step's write and
   * its journal line leaves the journal SHORT by that step — deliberately, see
   * `journal.ts` — and the restart must settle it by looking at the vault. If it
   * settled it by re-running instead, the append would be doubled and the
   * whole-vault assertion above is what would catch it; this asserts the
   * mechanism directly, so a regression says what broke rather than only that
   * something did.
   */
  test("a step killed between its write and its journal line is verified, not re-run", () => {
    for (const killAt of REPLAY_WINDOW_POINTS) {
      const { summary } = runs.get(killAt)!;
      // The step whose write landed is the (killAt/3)-th one, 1-indexed.
      const nth = killAt / 3;
      const inFlight = summary.outcomes[nth - 1];
      expect(inFlight.disposition, `killAt ${killAt}: step ${nth} (${inFlight.id})`).toBe("verified");
      // Everything before it was journaled and is skipped without a second look.
      for (const earlier of summary.outcomes.slice(0, nth - 1)) {
        expect(earlier.disposition, `killAt ${killAt}: ${earlier.id}`).toBe("skipped");
      }
      // And the journal named it as the thing that was underway — the marker a
      // backgrounded pass was found to be missing (meta vault, 2026-07-24).
      expect(summary.resumedFrom.inFlight, `killAt ${killAt}: what the journal said was in flight`).toEqual([
        inFlight.id,
      ]);
      expect(summary.resumedFrom.completed.length, `killAt ${killAt}: completions carried forward`).toBe(nth - 1);
    }
  });

  test("a step announced but killed before its write is announced again and run", () => {
    // Ops 3k+1 and 3k+2 are the two instants after step k+1's intent line and
    // before its effect: the journal names it as underway and the vault says it
    // did not happen. That pair is what makes an intent worth writing — without
    // it a restart cannot tell this state from "never reached".
    for (const killAt of [1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17]) {
      const { summary } = runs.get(killAt)!;
      const journaled = Math.floor((killAt - 1) / 3);
      expect(summary.outcomes.slice(0, journaled).map((o) => o.disposition), `killAt ${killAt}: behind it`).toEqual(
        Array(journaled).fill("skipped"),
      );
      const announced = summary.outcomes[journaled];
      expect(summary.resumedFrom.inFlight, `killAt ${killAt}: what was underway`).toEqual([announced.id]);
      expect(announced.disposition, `killAt ${killAt}: ${announced.id}`).toBe("ran");
    }
  });

  test("a pass killed after it sealed is re-run from the top and changes nothing", () => {
    // Op 20: sealed, lock not yet released — the one point of the twenty with no
    // journal work left to resume, only a lock to break.
    const { summary } = runs.get(20)!;

    // Nothing to resume — the journal sealed — so every step is judged against
    // the vault instead, finds its effect already there, and writes nothing.
    expect(summary.resumedFrom.interrupted).toBe(false);
    expect(summary.outcomes.map((o) => o.disposition)).toEqual(Array(STEPS).fill("verified"));
  });
});
