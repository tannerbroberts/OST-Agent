/**
 * Kill ten runs at random points and check what the journal's last line claims.
 *
 * The assumption under test (meta vault, beneath "A run journal written as it
 * goes, so an interrupted run reads as a list of finished steps"): a
 * forward-written journal is accurate at the moment of interruption. The
 * half-finished step is the interesting case — log before completion and the
 * journal overstates, log after and it understates — and the vault fixed the
 * bar before this file existed: **0 of 10 journals overstate, and at most 2
 * understate by one step.**
 *
 * Design, as the assumption test states it: run ten passes, kill each at a
 * randomly chosen point, and compare the journal against what actually landed
 * on disk. "Random" here is a seeded PRNG choosing an operation index, and the
 * child (`fixtures/journal-interruptible-run.ts`) SIGKILLs itself when its
 * operation counter reaches that index — a real, uncatchable process death at
 * a reproducible point, which is how ten kills stay deterministic across
 * machines. The kill can land anywhere strictly inside the run, including the
 * exact instant between a step's last artifact write and its journal append —
 * the window where honest understatement lives.
 *
 * What this file does not cover, per the node that owns it: a crash mid-write,
 * a full disk, a kill while the filesystem is still buffering. A SIGKILL
 * between operations is a clean interruption.
 */
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { appendStep, sealRun, startRun } from "../../src/loop/health.js";
import { journalPath, readJournal, type JournalStep } from "../../src/loop/journal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const CHILD = path.resolve(__dirname, "fixtures/journal-interruptible-run.ts");

const RUNS = 10;
const STEPS = 5;
const CHUNKS = 20;
/** Ops per run, mirroring the child's grid: startRun + steps·(chunks+1) + seal. */
const TOTAL_OPS = 1 + STEPS * (CHUNKS + 1) + 1;

/**
 * Deterministic PRNG (mulberry32) with a fixed seed, so the ten "random" kill
 * points are the same on every machine and every run of this suite. The seed
 * was not searched for an outcome — it is the first one tried, and the
 * threshold has to hold for it the same way it would for a stopwatch.
 */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeVault(): string {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-journal-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  fs.writeFileSync(path.join(vault, "Root.md"), "# Root\n");
  git("add", "-A");
  git("commit", "-qm", "root");
  return vault;
}

/** Steps whose work fully landed: artifact file present with every chunk. */
function landedSteps(vault: string): string[] {
  const expected = Array.from({ length: CHUNKS }, (_, i) => `chunk ${i + 1}`).join("\n") + "\n";
  const landed: string[] = [];
  for (let k = 1; k <= STEPS; k += 1) {
    const artifact = path.join(vault, "steps", `step-${k}.txt`);
    if (fs.existsSync(artifact) && fs.readFileSync(artifact, "utf8") === expected) landed.push(`step-${k}`);
  }
  return landed;
}

const vaults: string[] = [];
afterAll(() => {
  for (const v of vaults) fs.rmSync(v, { recursive: true, force: true });
});

describe("ten runs killed at seeded points", () => {
  test(
    "no journal overstates, and at most two understate by one step",
    () => {
      const rand = mulberry32(0xc0ffee);
      let overstatedRuns = 0;
      let understatedRuns = 0;
      let runsWithClaims = 0;
      let runsCutEarly = 0;

      for (let r = 0; r < RUNS; r += 1) {
        // Strictly inside the run: [1, TOTAL_OPS - 1]. Index 0 would kill
        // before the run opened (trivially accurate, nothing measured), and
        // TOTAL_OPS - 1 kills before the seal — so every child dies mid-run.
        const killAt = 1 + Math.floor(rand() * (TOTAL_OPS - 1));
        const vault = makeVault();
        vaults.push(vault);

        // `node --import tsx` rather than the tsx CLI: the CLI re-spawns node,
        // so the SIGKILL would land in a grandchild and the spawned process
        // would report a plain exit — the parent must see the kill itself.
        const child = spawnSync(
          process.execPath,
          ["--import", "tsx", CHILD, vault, String(killAt), String(STEPS), String(CHUNKS)],
          { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
        // Every run must die by the kill, never finish: a child that sealed
        // was not interrupted and proves nothing about interruption.
        expect(child.signal, `run ${r} (killAt ${killAt}) stderr: ${child.stderr}`).toBe("SIGKILL");

        const journal = readJournal(vault);
        const claimed = journal.filter((e): e is JournalStep => e.kind === "step").map((e) => e.phase);
        const landed = landedSteps(vault);

        // The interrupted journal must still read as a record: it opened, it
        // never sealed, and its tail is the last thing that actually worked.
        expect(journal[0]?.kind, `run ${r} journal is empty`).toBe("open");
        expect(journal.some((e) => e.kind === "seal")).toBe(false);

        const overstated = claimed.filter((s) => !landed.includes(s));
        const understated = landed.filter((s) => !claimed.includes(s));
        if (overstated.length > 0) overstatedRuns += 1;
        if (understated.length > 0) {
          understatedRuns += 1;
          // The bar tolerates understatement only by the single final step —
          // the one whose work finished in the instant before the append.
          expect(understated, `run ${r} (killAt ${killAt}) understates by more than one step`).toHaveLength(1);
          expect(understated[0]).toBe(landed[landed.length - 1]);
        }

        // The last line's claim, checked directly — the spec's own phrasing.
        const last = journal[journal.length - 1];
        if (last?.kind === "step") expect(landed).toContain(last.phase);

        if (claimed.length > 0) runsWithClaims += 1;
        if (claimed.length < STEPS) runsCutEarly += 1;
      }

      // The vault's threshold, verbatim: 0 of 10 overstate, at most 2
      // understate by one step.
      expect(overstatedRuns).toBe(0);
      expect(understatedRuns).toBeLessThanOrEqual(2);

      // The harness itself must have produced interruptions worth measuring:
      // kills landing at varied depths, not all before the first step or all
      // at the end. Loose on purpose — it polices the harness, not the seed.
      expect(runsWithClaims).toBeGreaterThan(0);
      expect(runsCutEarly).toBeGreaterThan(0);
    },
    { timeout: 120_000 },
  );
});

describe("the chosen failure mode, pinned directly", () => {
  // The ten seeded kills all landed inside a step's work (the window between
  // work and append is 1 op in 21, and the seed hit it zero times), so the
  // understatement half of the threshold passed vacuously above. This kill is
  // aimed at the window on purpose: op 21 is the exact instant after step 1's
  // last artifact write and before its journal append. The journal must come
  // out short by exactly that one step — never claiming it, which would be
  // the overstatement the design rejects.
  test("killed between a step's work and its append, the journal understates by exactly that step", () => {
    const vault = makeVault();
    vaults.push(vault);
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", CHILD, vault, String(CHUNKS + 1), String(STEPS), String(CHUNKS)],
      { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(child.signal, `stderr: ${child.stderr}`).toBe("SIGKILL");

    expect(landedSteps(vault)).toEqual(["step-1"]);
    const journal = readJournal(vault);
    expect(journal.map((e) => e.kind)).toEqual(["open"]);
  });
});

describe("the journal is written forward, not summarised at the end", () => {
  test("each completed step is one appended line, present before the run ever seals", () => {
    const vault = makeVault();
    vaults.push(vault);
    startRun(vault, { loopVersion: "t", cliVersion: "t" });
    appendStep(vault, { phase: "pass", command: "do the pass", cwd: "/work", exit: 0, durationMs: 1 });
    appendStep(vault, { phase: "check", command: "prove it", exit: 1, durationMs: 1 });

    // Read before seal: the account already exists line by line.
    const before = readJournal(vault);
    expect(before.map((e) => e.kind)).toEqual(["open", "step", "step"]);
    const check = before[2] as JournalStep;
    expect(check.phase).toBe("check");
    expect(check.exit).toBe(1);

    sealRun(vault, {});
    const after = readJournal(vault);
    expect(after.map((e) => e.kind)).toEqual(["open", "step", "step", "seal"]);
  });

  test("a truncated final line — the residue of a kill mid-append — hides nothing already journaled", () => {
    const vault = makeVault();
    vaults.push(vault);
    startRun(vault, { loopVersion: "t", cliVersion: "t" });
    appendStep(vault, { phase: "pass", command: "do the pass", exit: 0, durationMs: 1 });
    fs.appendFileSync(journalPath(vault), '{"kind":"step","runId":"r","phase":"che');

    const entries = readJournal(vault);
    expect(entries.map((e) => e.kind)).toEqual(["open", "step"]);
  });
});
