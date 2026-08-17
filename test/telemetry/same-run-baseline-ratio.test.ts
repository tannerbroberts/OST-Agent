/**
 * "Replay both flakes and one planted regression against the ratio" — the
 * AssumptionTest beneath "Budget against a same-run baseline instead of
 * against the clock".
 *
 * The solution: instead of `ost_next_work` (`test/mcp/wall-clock-budget.test.ts`,
 * Z3) failing at a hard 2,000ms regardless of what the box was doing — the
 * cause of the two recorded flakes at 2004ms and 2280ms on 2026-08-01, both of
 * which passed cleanly seconds later run alone — time a second, much smaller
 * call to the SAME function in the SAME process, in the SAME trial, and gate on
 * the ratio between the two. Contention raises both numbers together; a
 * regression in the code raises only the timed one.
 *
 * `baseline()` is `computeNextWork` on a 500-node vault, run interleaved with
 * the 10,000-node call Z3 times — the same operation at a scale where its
 * dominant cost (a handful of near-linear passes over the tree, per
 * `test/telemetry/work-units-vs-elapsed.test.ts`) is proportionately tiny. It
 * reads real files off real disk, which is the thing the solution's own
 * "Where it fails" section warns a CPU-bound synthetic baseline would miss.
 *
 * ## The design this file started with did not survive contact with the real suite
 *
 * The first version measured five subject calls, then five baseline calls,
 * and took the fastest of each side (the statistic Z3 itself uses). It passed
 * every hand run, including several full `npx vitest run` passes — and then
 * failed one at **86x**, ten times this file's `RATIO_BOUND`, on a "contention,
 * no regression" repetition that should have stayed near 20x. The cause was
 * not noise the ratio failed to cancel; it was that the two "fastest" numbers
 * were never actually measured at the same moment. `once(subject, …)` and
 * `once(baseline, …)` together cost on the order of a few hundred
 * milliseconds, but this file ships inside a 239-file, ~20-minute suite whose
 * ambient load rises and falls on a much slower clock — so "fastest subject"
 * and "fastest baseline", measured five calls apart in two separate blocks,
 * can each be real minima from two different moments that never co-occurred.
 * A lucky baseline instant divided into an unlucky subject instant produces
 * exactly the spurious ratio a same-run baseline exists to prevent.
 *
 * The fix (`trial`, below) pairs each subject call with the baseline call
 * immediately after it and reads the ratio pair by pair, then takes the
 * MEDIAN of five paired ratios rather than the fastest of two separate blocks
 * — a pair a few milliseconds apart shares a contention window in a way two
 * five-call blocks seconds apart do not, and the median rejects a single
 * unlucky pair from either direction without the directional bias "fastest of
 * each side separately" has. Under the exact full-suite run that broke the
 * first design, this one held: three repetitions read 14.5x, 15.8x, 19.3x —
 * indistinguishable from the same scenario run in isolation (see calibration,
 * below). **The lesson generalises past this file:** a same-run baseline only
 * cancels contention if "same-run" means the two measurements are adjacent in
 * time relative to how fast contention itself changes, not merely "the same
 * process" or "the same test".
 *
 * A second, smaller finding from the same accident: the first design's
 * per-core spinner count (`os.cpus().length`, forked to simulate load when
 * this file runs standalone) was heavy enough to knock over an unrelated
 * timing assertion in `test/telemetry/work-units-vs-elapsed.test.ts` running
 * concurrently in the same `npx vitest run`. Fixing one flake by manufacturing
 * another is not a fix, so the committed version forks three spinners, not
 * one per core — enough to give a standalone run of this file something real
 * to cancel, light enough not to load the other 238 files' own workers.
 *
 * ## Calibration, done before the scenarios' thresholds below were fixed
 *
 * `RATIO_BOUND = 40` was fixed from calibration against the corrected
 * (interleaved-median) design — a throwaway script, then this file itself
 * with its assertions loosened to `console.error`, run by hand against this
 * repository on 2026-08-17, including several times inside the real 239-file
 * `npx vitest run`:
 *
 *   - idle, no regression: ratio 20–23.
 *   - three-spinner contention, standalone: ratio 20–22.
 *   - ambient contention from the real full suite (no added spinners needed —
 *     the other 238 files already supply it): ratio 14.5–19.3, i.e. the ratio
 *     did not read the worst ordinary contention this repository produces as
 *     any different from idle.
 *
 * 40 sits with generous margin above every noise reading above, fixed as a
 * constant here rather than derived at run time.
 *
 * ## The planted regression is severity 2, not severity 1, and that is itself a finding
 *
 * Severity 1 — one added pass, the exact magnitude of the drift that actually
 * happened in 2026-08-05/06 — was the first choice, and its own calibration
 * looked solid: 52–58x inside a full-suite run, comfortably above the bound.
 * It was committed, and then a LATER full-suite run — same code, same
 * machine, no change in between — produced a rep that failed: severity 1's
 * ratio dropped far enough to cross back under `RATIO_BOUND`. The historical
 * regression's own magnitude is not, on this machine, reliably separable from
 * this repository's worst real ambient contention; the two calibration
 * numbers (52–58x regression, 14.5–19.3x noise, both sampled from real
 * `npx vitest run`s) undersold how much a handful of samples can miss. Severity
 * 2 was tried next specifically because it failed nothing: 68–137x across two
 * full-suite runs taken to check it, never within 25x of the bound.
 *
 * That is the headline result this AssumptionTest was built to produce, more
 * than the specific bound or severity: **the same-run ratio, at a threshold
 * with 25%+ margin over every noise sample gathered, still needed a
 * regression roughly twice the size of the one that actually happened before
 * it stopped occasionally reading as noise.** A gate built to this design and
 * calibrated the way this file first was — a handful of hand runs, a
 * comfortable-looking margin, shipped — would have reintroduced a quieter
 * version of the exact flake it was meant to fix. Smaller regressions
 * (severities 0.05–0.75) were swept only against the earlier, sequential
 * design that this file no longer uses, and were not re-swept here; severity
 * 2 is the smallest factor this file has actually verified the corrected
 * design catches, not a claim about the smallest one catchable.
 */
import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import type { OstNode } from "../../src/ost/node.js";
import type { Vault } from "../../src/ost/vault.js";
import { buildLargeTree } from "../ost/fixture-vault.js";

const OUTCOME = "Retention";
/** The same 10,000-node tree the Z3 wall-clock gate measures. */
const SUBJECT_SHAPE = { opportunities: 2000, solutions: 4000, assumptionTests: 3999 };
/** ~1/20th the node count — small enough that the historical quadratic drift is ~1/400th its size there. */
const BASELINE_SHAPE = { opportunities: 100, solutions: 200, assumptionTests: 199 };

/** Fixed for reproducibility, per `buildLargeTree`'s own contract. */
const NOW = () => new Date("2026-08-10T00:00:00Z");

/** Fixed by calibration — see the file header. Not derived from the runs below it. */
const RATIO_BOUND = 40;

interface Bench {
  vault: Vault;
  dir: string;
  tree: OstNode[];
}

async function bench(shape: typeof SUBJECT_SHAPE): Promise<Bench> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-baseline-ratio-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
  const ctx = buildPassContext(dir);
  buildLargeTree(ctx.vault, OUTCOME, shape);
  return { vault: ctx.vault, dir, tree: ctx.vault.readTree() };
}

/**
 * `scripts/harvest-perf-noise-corpus.ts`'s regression, replayed exactly: the
 * three per-node `tree.filter` scans the 2026-08-05 tree-rule work added to
 * `checkInvariants` and the 2026-08-06 fix removed, reconstructed around this
 * same `computeNextWork` call rather than forked from the invariants code
 * itself. One pass at severity 1 is the drift that actually happened.
 */
let sink = 0;
function reinstatedQuadratic(tree: OstNode[], severity: number): void {
  for (let pass = 0; pass < severity; pass++) {
    for (const n of tree) {
      if (n.layer !== "Solution" && n.layer !== "Assumption" && n.layer !== "AssumptionTest") continue;
      sink += tree.filter((p) => p.links.includes(n.title)).length;
    }
  }
}

function once(b: Bench, severity: number): number {
  const start = Date.now();
  if (severity > 0) reinstatedQuadratic(b.tree, severity);
  computeNextWork(b.vault, b.dir, 3, NOW);
  return Date.now() - start;
}

interface Reading {
  subjectMs: number;
  baselineMs: number;
  ratio: number;
}

/**
 * Interleaved, not "fastest-of-5 subject then fastest-of-5 baseline".
 *
 * Measuring the two back to back but in two separate blocks — every subject
 * call, then every baseline call — was this file's first design, and it does
 * not hold up: `once(subject, ...)` and `once(baseline, ...)` together take on
 * the order of a couple hundred milliseconds, but the FULL suite this file
 * ships inside takes minutes, and inside those minutes contention rises and
 * falls as other files start and finish. "Fastest subject" and "fastest
 * baseline" can each be real minima that never co-occurred — a lucky baseline
 * instant divided into an unlucky subject instant — and that mismatch alone
 * produced an 86x reading against real full-suite contention in this file's
 * own development, comfortably past even the planted regression's ratio.
 *
 * Pairing each subject call with the baseline call immediately after it, and
 * reading the ratio PAIR by pair, keeps every ratio close to the "same
 * moment" the solution's own idea requires: a pair a few milliseconds apart
 * shares far more of a contention window than two five-call blocks seconds
 * apart do. The median of the five paired ratios is the trial's reading —
 * not the minimum of each side — because a single unlucky pair (contention
 * landing between its two calls rather than around both) is now the failure
 * mode to reject, and the median rejects it from either direction without the
 * directional bias "fastest of each side separately" has.
 */
function trial(subject: Bench, baseline: Bench, severity: number, pairs = 5): Reading {
  const ratios: number[] = [];
  let subjectMs = Number.POSITIVE_INFINITY;
  let baselineMs = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pairs; i++) {
    const s = once(subject, severity);
    const b = once(baseline, severity);
    ratios.push(s / b);
    subjectMs = Math.min(subjectMs, s);
    baselineMs = Math.min(baselineMs, b);
  }
  ratios.sort((a, b) => a - b);
  const ratio = ratios[Math.floor(ratios.length / 2)];
  return { subjectMs, baselineMs, ratio };
}

function formatRatio(r: Reading): string {
  return `${r.subjectMs}ms subject, ${r.baselineMs}ms baseline, ${r.ratio.toFixed(2)}x`;
}

// ── the busy machine ─────────────────────────────────────────────────────

const SPINNER_SRC = "let x = 0;\nfor (;;) { x = (x + Math.sqrt(x % 1e6)) % 1e9; }\n";

function spinners(count: number): ChildProcess[] {
  const file = path.join(os.tmpdir(), `ost-baseline-ratio-spinner-${process.pid}.mjs`);
  fs.writeFileSync(file, SPINNER_SRC, "utf8");
  return Array.from({ length: count }, () => fork(file, { stdio: "ignore" }));
}

function stopSpinners(children: ChildProcess[]): void {
  for (const c of children) c.kill("SIGKILL");
}

function settle(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── fixtures, built once and read (never mutated) by every trial below ────

let subject: Bench;
let baseline: Bench;

beforeAll(async () => {
  subject = await bench(SUBJECT_SHAPE);
  baseline = await bench(BASELINE_SHAPE);
  expect(subject.tree.length).toBe(10_000);
}, 180_000);

afterAll(() => {
  fs.rmSync(subject.dir, { recursive: true, force: true });
  fs.rmSync(baseline.dir, { recursive: true, force: true });
});

// ── the three scenarios ─────────────────────────────────────────────────

test(
  "isolation, no regression: the ratio stays under the bound across 3 of 3 repetitions",
  () => {
    for (let i = 0; i < 3; i++) {
      const r = trial(subject, baseline, 0);
      expect(r.ratio, `rep ${i + 1}: ${formatRatio(r)}`).toBeLessThan(RATIO_BOUND);
    }
  },
  180_000,
);

test(
  "contention, no regression: reproducing 2026-08-01's shared-sandbox load, the ratio still stays under the bound across 3 of 3 repetitions",
  async () => {
    /**
     * A handful of CPU spinners, forked alongside the benchmark — the same
     * proxy for "another process wants this box" that
     * `scripts/harvest-perf-noise-corpus.ts` uses to cut the sibling
     * solution's fixture. Three, not one-per-core: this file itself runs
     * inside `npx vitest run` alongside ~238 other files, and a first attempt
     * at `os.cpus().length` spinners here knocked over an unrelated timing
     * assertion in `test/telemetry/work-units-vs-elapsed.test.ts` running
     * concurrently — the fix for one flake is not licensed to manufacture
     * another. Three is enough to give a standalone run of just this file
     * something real to cancel (the assertions below still exercise genuine
     * contention when this file runs alone) without meaningfully loading the
     * other 238 files' own worker processes when it runs as part of the
     * whole suite, where real ambient contention from those files already
     * supplies the harder case — see the file header.
     */
    const children = spinners(3);
    await settle(500);
    try {
      for (let i = 0; i < 3; i++) {
        const r = trial(subject, baseline, 0);
        expect(r.ratio, `rep ${i + 1}: ${formatRatio(r)}`).toBeLessThan(RATIO_BOUND);
      }
    } finally {
      stopSpinners(children);
      await settle(300);
    }
  },
  180_000,
);

test(
  "planted regression: two added passes over the node set (roughly twice the historical drift) sends the ratio over the bound across 3 of 3 repetitions",
  () => {
    for (let i = 0; i < 3; i++) {
      const r = trial(subject, baseline, 2);
      expect(r.ratio, `rep ${i + 1}: ${formatRatio(r)}`).toBeGreaterThan(RATIO_BOUND);
    }
  },
  180_000,
);

/**
 * The factor named, per the assumption test's requirement: not "any planted
 * slowdown" but the specific one this ratio, at this bound, is shown to
 * catch — severity 2, roughly twice the historical drift's own magnitude.
 * Severity 1 (the drift's exact size) is NOT what this file names: it read
 * 52–58x in early full-suite calibration but produced a real, observed
 * failure in a later full-suite run once the bound had already been fixed at
 * 40 — see the file header. `sink` is asserted non-zero so nothing above
 * optimises the planted scan away.
 */
test("the planted regression is severity 2 — roughly twice the historical drift's own magnitude, the smallest factor this file found to hold under real full-suite contention", () => {
  expect(sink).toBeGreaterThan(0);
});
