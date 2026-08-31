/**
 * "Check whether isolation correctly acquits a flake and convicts a real
 * regression" — the AssumptionTest beneath "Re-run once and report the
 * disagreement rather than the first result".
 *
 * The assumption under test is that *"passes in isolation" reliably means "was
 * a flake"*. It does not, and the node names the case where it does not: an
 * operation slow **because** of a genuine regression under concurrency passes
 * alone for exactly the reason it failed in the suite. A mechanism that reads
 * the isolated pass as an acquittal files that case as noise, silently. So the
 * three planted scenarios below are not three samples of one behaviour — the
 * first two are checkable by a re-run alone and the third is the one that
 * decides whether the candidate may be built in this form at all.
 *
 * **Pre-committed threshold, from the node: all three labelled correctly, 3 of
 * 3 repetitions each.** Scenario 3 is not negotiable and this file must not be
 * rewritten to pass without it; if it cannot be convicted, the node's own
 * fallback is to report the disagreement unresolved (`undetermined`) rather
 * than assert `contention`, and that is a rewrite of the solution, not a green.
 *
 * ## The scenarios are real runs, not fixture readings
 *
 * Every number below is a wall-clock measurement of work that actually
 * happened in this process. `../eval/perf-gate-noise-band.test.ts` replays a
 * recorded corpus and is the right shape for scoring rival *rules*; this file
 * has to establish something a corpus cannot, which is that a
 * concurrency-only slowdown really does leave the control flat while it
 * inflates the subject. That is a claim about how the two co-occur in a live
 * scheduler, and a hand-written pair of numbers would assume it rather than
 * show it.
 *
 *   1. **Known flake.** Three co-scheduled event-loop hogs during the failing
 *      phase and none during the re-run. This is the 2026-08-01 shape —
 *      `test/mcp/wall-clock-budget.test.ts` at 2004ms and 2280ms against a
 *      2000ms budget, passing alone seconds later, filed as friction twice.
 *      Correct label: **contention**.
 *   2. **Known regression, load-independent.** A fixed extra cost carried in
 *      every phase. Correct label: **regression**, surviving the isolated
 *      re-run — i.e. reached via `agreement`, not via the control.
 *   3. **Known regression, concurrency-only.** The subject queues behind five
 *      siblings on a shared lock. The realistic shape the node asks for, and
 *      the hold is `setTimeout`, not a spin: the siblings occupy the *resource*
 *      without occupying the *CPU*, so the box genuinely stays idle while the
 *      subject genuinely stalls. Correct label: **regression**. A re-run-only
 *      mechanism labels this `contention` and is wrong.
 *
 * ## Why in-process hogs rather than forked spinners
 *
 * `test/telemetry/same-run-baseline-ratio.test.ts` records forking one spinner
 * per core and knocking over an unrelated timing assertion in another file in
 * the same `npx vitest run` — "fixing one flake by manufacturing another is not
 * a fix". Node is single-threaded, so the hogs here contend for one event loop
 * and cannot take more than the one core this file's worker already holds.
 * That is why this file is not in `SUITE_EXCLUSIONS`: it is a victim risk, not
 * a culprit risk, and the calibration below is what handles the victim half.
 *
 * ## Everything is sized against a calibrated idle cost, and that is deliberate
 *
 * The budgets, the planted regression and the lock hold are all multiples of
 * `idleMs`, measured once in `beforeAll` through the same harness. Fixing them
 * as absolute milliseconds would make the *plants themselves* ambient-load
 * dependent: inside a 270-file suite a "passes alone" phase can cost several
 * times what it costs on an idle laptop, and a scenario that stops failing in
 * its failing phase has planted nothing while still reporting green. Scaling
 * the plant is not scaling the rule — `CONTENTION_RATIO` is fixed in
 * `src/runner/flake-attribution.ts` and nothing here touches it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { isInstrument, parseInstrument, type ParsedInstrument } from "../../src/knowledge/instruments.js";
import { runInstrument } from "../../src/ost/instrument.js";
import {
  CONTENTION_RATIO,
  attributeRerun,
  describeFlakeAttribution,
  probeElapsed,
  timedPhase,
  type FlakeAttribution,
  type Phase,
} from "../../src/runner/flake-attribution.js";

/** The node's threshold. Not derived from anything below it. */
const REPETITIONS = 3;

/** One slice of subject work, in ms of real CPU, between yields. */
const UNIT_MS = 4;
/** Slices in an unregressed subject. */
const IDLE_SLICES = 10;
/** Slices a hog takes per turn — heavier than the subject's, so three of them dominate the loop. */
const HOG_UNIT_MS = 8;
const HOGS = 3;
/** Siblings queued ahead of the subject on the shared lock in scenario 3. */
const LOCK_HOLDERS = 5;

/** Multiples of the calibrated idle cost. See the file header for why these are ratios. */
const BUDGET_MULTIPLE = 3;
/** Scenario 2's fixed slowdown: enough to clear the budget in every phase. */
const REGRESSION_MULTIPLE = 5;
/** Scenario 3: each sibling holds the lock this long, so the queue is 5x this. */
const HOLD_MULTIPLE = 1.5;

/** Busy-wait for real. The subject's cost has to be CPU a co-scheduled hog can take from it. */
function spin(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* deliberately burning the thread — see spin's caller */
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A shared resource, held across an await.
 *
 * Scenario 3 needs a stall that is not CPU: the whole discriminator is that a
 * concurrency-only regression leaves the box idle. Queuing on this mutex costs
 * the subject wall-clock while the event loop stays free for the control, which
 * is what "lock contention" actually looks like and what a spin loop would not
 * reproduce.
 */
class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const ahead = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => (release = resolve));
    await ahead;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** The subject: `slices` slices of CPU, yielding between them, optionally behind a lock. */
async function subject(slices: number, lock?: Mutex): Promise<void> {
  const body = async (): Promise<void> => {
    for (let i = 0; i < slices; i++) {
      spin(UNIT_MS);
      await tick();
    }
  };
  await (lock ? lock.run(body) : body());
}

/**
 * The control workload: the same *kind* of thing at a size the subject's
 * suspected cost cannot be in, and it yields, so it reads the event loop.
 */
async function controlWork(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    spin(1);
    await tick();
  }
}

/** Start `n` event-loop hogs; the returned function stops them. */
function startHogs(n: number): () => void {
  let running = true;
  for (let i = 0; i < n; i++) {
    void (async () => {
      while (running) {
        spin(HOG_UNIT_MS);
        await tick();
      }
    })();
  }
  return () => {
    running = false;
  };
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Run the subject once and take control readings *while it runs*.
 *
 * Interleaved rather than measured in a block before or after, and the median
 * rather than the fastest: both are `test/telemetry/same-run-baseline-ratio.test.ts`'s
 * findings, arrived at there after a design that measured the two sides
 * separately produced an 86x ratio out of nothing but two minima that never
 * co-occurred.
 */
async function timePhase(run: () => Promise<void>, budgetMs: number): Promise<Phase> {
  const probes: number[] = [];
  let finished = false;
  const start = Date.now();
  const running = run().then(() => {
    finished = true;
  });
  const probing = (async () => {
    do {
      probes.push(await probeElapsed(controlWork));
    } while (!finished);
  })();
  await running;
  const measuredMs = Date.now() - start;
  await probing;
  return timedPhase(measuredMs, budgetMs, median(probes));
}

/** What the subject costs with nothing else going on — every plant below is a multiple of it. */
let idleMs = 0;

beforeAll(async () => {
  // Three passes, fastest kept: the calibration itself runs inside whatever the
  // suite is doing, and the least contaminated sample is the honest one for
  // "what does this work cost". Sizing the plants off an inflated calibration
  // would inflate every budget with it and could stop the failing phases failing.
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const phase = await timePhase(() => subject(IDLE_SLICES), Number.POSITIVE_INFINITY);
    best = Math.min(best, phase.elapsedMs);
  }
  idleMs = Math.max(best, UNIT_MS * IDLE_SLICES);
}, 60_000);

describe("the rule, on fixed numbers", () => {
  const budgetMs = 2000;

  test("the re-run agreeing is a regression, and needs no control to say so", () => {
    const a = attributeRerun(timedPhase(2280, budgetMs), timedPhase(2310, budgetMs));
    expect(a.kind).toBe("regression");
    expect(a.kind === "regression" && a.via).toBe("agreement");
  });

  test("the re-run disagreeing, with a control that rose, is contention", () => {
    const a = attributeRerun(timedPhase(2280, budgetMs, 40), timedPhase(620, budgetMs, 10));
    expect(a.kind).toBe("contention");
    expect(a.kind === "contention" && a.control.ratio).toBe(4);
  });

  test("the re-run disagreeing, with a control that did NOT rise, is still a regression", () => {
    const a = attributeRerun(timedPhase(2280, budgetMs, 11), timedPhase(620, budgetMs, 10));
    expect(a.kind).toBe("regression");
    expect(a.kind === "regression" && a.via).toBe("idle-control");
  });

  /*
   * The third arm, and it is load-bearing rather than a default. With no
   * control pair, a busy box and a concurrency-only regression produce the
   * identical pair of runs; answering "contention" there is the silent false
   * acquittal this whole test exists to prevent, and answering "regression"
   * throws away what the re-run did establish.
   */
  test("the re-run disagreeing, with no control at all, is undetermined rather than acquitted", () => {
    const a = attributeRerun(timedPhase(2280, budgetMs), timedPhase(620, budgetMs));
    expect(a.kind).toBe("undetermined");
    expect(describeFlakeAttribution(a)).toContain("cause not determined");
  });

  test("a control reading of zero is no reading, not an infinite ratio", () => {
    // What a platform without a load average reports. Dividing by it would
    // convict the box on the strength of a missing number.
    const a = attributeRerun(timedPhase(2280, budgetMs, 40), timedPhase(620, budgetMs, 0));
    expect(a.kind).toBe("undetermined");
  });

  test("the boundary is the constant, and the constant is not read off this file", () => {
    expect(CONTENTION_RATIO).toBe(1.5);
  });

  test("each verdict says which it is, with both numbers, in one line", () => {
    const contention = attributeRerun(timedPhase(2280, budgetMs, 40), timedPhase(620, budgetMs, 10));
    const line = describeFlakeAttribution(contention);
    expect(line).toContain("2,280ms");
    expect(line).toContain("620ms");
    expect(line).toContain("contention, not regression");
  });
});

/**
 * The three scenarios, run for real.
 *
 * Each repetition runs the failing phase and the isolated re-run back to back,
 * so the two control readings are as close in time as the design allows, then
 * asserts the label. Non-vacuity is checked in the same breath and is not a
 * formality: a scenario whose "failing" phase did not actually breach its
 * budget planted nothing, and would hand a correct-looking label to a run that
 * never reproduced the condition.
 */
describe("three planted scenarios with known answers", () => {
  interface Rep {
    attribution: FlakeAttribution;
    inSuite: Phase;
    inIsolation: Phase;
  }

  async function repeat(
    failingPhase: () => Promise<Phase>,
    isolatedPhase: () => Promise<Phase>,
  ): Promise<Rep[]> {
    const reps: Rep[] = [];
    for (let i = 0; i < REPETITIONS; i++) {
      const inSuite = await failingPhase();
      const inIsolation = await isolatedPhase();
      reps.push({ attribution: attributeRerun(inSuite, inIsolation), inSuite, inIsolation });
    }
    return reps;
  }

  /** The plant reproduced its own condition — otherwise the label below means nothing. */
  function expectPlantHeld(reps: Rep[]): void {
    for (const r of reps) expect(r.inSuite.failed).toBe(true);
  }

  test(
    "1. a load-induced flake is labelled contention, 3 of 3",
    async () => {
      const budgetMs = idleMs * BUDGET_MULTIPLE;
      const reps = await repeat(
        async () => {
          const stop = startHogs(HOGS);
          try {
            return await timePhase(() => subject(IDLE_SLICES), budgetMs);
          } finally {
            stop();
          }
        },
        () => timePhase(() => subject(IDLE_SLICES), budgetMs),
      );

      expectPlantHeld(reps);
      // The re-run really did disagree — this scenario is about the disagreement.
      for (const r of reps) expect(r.inIsolation.failed).toBe(false);
      expect(reps.map((r) => r.attribution.kind)).toEqual(["contention", "contention", "contention"]);
    },
    120_000,
  );

  test(
    "2. a load-independent regression is labelled regression and survives the isolated re-run, 3 of 3",
    async () => {
      const budgetMs = idleMs * BUDGET_MULTIPLE;
      const slices = IDLE_SLICES * REGRESSION_MULTIPLE;
      const reps = await repeat(
        () => timePhase(() => subject(slices), budgetMs),
        () => timePhase(() => subject(slices), budgetMs),
      );

      expectPlantHeld(reps);
      expect(reps.map((r) => r.attribution.kind)).toEqual(["regression", "regression", "regression"]);
      // "Survives the isolated re-run" is a stronger claim than the label: it
      // has to be convicted by the second run agreeing, not by a control reading.
      for (const r of reps) {
        expect(r.inIsolation.failed).toBe(true);
        expect(r.attribution.kind === "regression" && r.attribution.via).toBe("agreement");
      }
    },
    120_000,
  );

  /*
   * The scenario that decides the candidate.
   *
   * The subject queues behind five siblings on a shared lock and is slow for
   * it; alone, the lock is free and it is fast. A mechanism that reads the
   * isolated pass as an acquittal calls this `contention` — the false
   * acquittal, and the reason the assumption test exists. It is convicted here
   * because the siblings hold the lock across a timer rather than a spin, so
   * the control stays flat and the box is demonstrably not what changed.
   */
  test(
    "3. a concurrency-only regression is still labelled regression, 3 of 3",
    async () => {
      const budgetMs = idleMs * BUDGET_MULTIPLE;
      const holdMs = Math.round(idleMs * HOLD_MULTIPLE);
      const reps = await repeat(
        () => {
          const lock = new Mutex();
          // Queued first, so the subject waits behind all of them.
          const holders = Promise.all(
            Array.from({ length: LOCK_HOLDERS }, () => lock.run(() => delay(holdMs))),
          );
          return timePhase(async () => {
            await subject(IDLE_SLICES, lock);
            await holders;
          }, budgetMs);
        },
        // Alone, the same code on an uncontended lock.
        () => timePhase(() => subject(IDLE_SLICES, new Mutex()), budgetMs),
      );

      expectPlantHeld(reps);
      // The trap is set: the re-run passed, so a re-run-only mechanism acquits here.
      for (const r of reps) expect(r.inIsolation.failed).toBe(false);
      expect(reps.map((r) => r.attribution.kind)).toEqual(["regression", "regression", "regression"]);
      for (const r of reps) {
        expect(r.attribution.kind === "regression" && r.attribution.via).toBe("idle-control");
      }
    },
    120_000,
  );
});

/**
 * The live caller, and the bound it runs into.
 *
 * `runInstrument` is where a red is turned into the line somebody later reads
 * as the whole verdict, so it is where the re-run has to happen. It is also the
 * caller that CANNOT reach the deciding arm above: it is blocked in `spawnSync`
 * for the whole of each run, so no control workload can be interleaved with the
 * child, and the command it re-runs already names one spec file, so the second
 * run is a repetition rather than an isolation. Two answers are reachable from
 * here and the tests below pin both — plus the fact that the third is NOT
 * silently invented, which is the property that matters most.
 *
 * These live beside the scenarios rather than in `test/ost/instrument.test.ts`
 * because they are the same mechanism seen from its other end: what the rule
 * can decide, and what this caller can actually feed it.
 */
describe("the instrument runner re-runs a red and records what the second run said", () => {
  let repo: string;
  let calls: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-flake-repo-"));
    calls = path.join(repo, "calls.txt");
    fs.writeFileSync(calls, "", "utf8");
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  /** A stub `vitest` whose verdict can depend on which invocation this is. */
  function runner(script: string): void {
    fs.mkdirSync(path.join(repo, "node_modules", ".bin"), { recursive: true });
    fs.mkdirSync(path.join(repo, "test"), { recursive: true });
    fs.writeFileSync(path.join(repo, "test", "a.test.ts"), "// a spec that exists\n", "utf8");
    const bin = path.join(repo, "node_modules", ".bin", "vitest");
    fs.writeFileSync(bin, `#!/bin/sh\necho call >> ${JSON.stringify(calls)}\n${script}\n`, "utf8");
    fs.chmodSync(bin, 0o755);
  }

  const FAILS = `echo "FAIL test/a.test.ts > expected 3 got 0"; exit 1`;
  const PASSES = `echo "Test Files  1 passed (1)"; exit 0`;
  /**
   * Red on the first invocation, green on every one after it — a flake, exactly.
   *
   * A function, not a `const`: `calls` is assigned in `beforeEach`, and a
   * describe-level constant bakes in the value it had while the describe body
   * ran, which is `undefined`. The shim would then count lines in a file named
   * "undefined", take the else branch every time, and silently stop flaking —
   * so this test would pass while asserting the wrong arm. It did exactly that
   * once before this comment existed.
   */
  const flakes = (): string =>
    `if [ "$(wc -l < ${JSON.stringify(calls)})" -ge 2 ]; then ${PASSES}; else ${FAILS}; fi`;

  const instrument = (): ParsedInstrument => {
    const parsed = parseInstrument("npx vitest run test/a.test.ts");
    if (!isInstrument(parsed)) throw new Error(`fixture instrument does not parse: ${parsed.reason}`);
    return parsed;
  };

  function invocations(): number {
    return fs.readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).length;
  }

  test("two reds agree, and the line says the red stands", () => {
    runner(FAILS);
    const run = runInstrument(instrument(), repo, { rerunOnRed: true });

    expect(run.observation).toBe("red");
    expect(invocations()).toBe(2);
    expect(run.attribution?.kind).toBe("regression");
    expect(run.attribution?.kind === "regression" && run.attribution.via).toBe("agreement");
    expect(run.excerpt).toContain("the re-run agrees and the red stands");
    // The original failure is still the head of the line — the attribution is
    // appended to what was observed, not substituted for it.
    expect(run.excerpt.startsWith("FAIL test/a.test.ts")).toBe(true);
  });

  test("a red that passes on the re-run is undetermined, and is NOT acquitted as contention", () => {
    runner(flakes());
    const run = runInstrument(instrument(), repo, { rerunOnRed: true });

    // Still red: the first result is what was observed, and the log is
    // append-only. The re-run buys the attribution, not the luckier verdict.
    expect(run.observation).toBe("red");
    expect(run.attribution?.kind).toBe("undetermined");
    expect(run.excerpt).toContain("cause not determined");
    /*
     * The whole point. This caller has no control reading, so a busy box and a
     * regression that only shows under concurrency are indistinguishable to it.
     * Calling this one "contention" is the silent false acquittal the assumption
     * test was written to catch, and it must not appear here just because the
     * mechanism is capable of producing it elsewhere.
     */
    expect(run.excerpt).not.toContain("contention, not regression");
  });

  test("the re-run is off by default, so nothing else pays for it", () => {
    runner(FAILS);
    const run = runInstrument(instrument(), repo);

    expect(run.observation).toBe("red");
    expect(invocations()).toBe(1);
    expect(run.attribution).toBeUndefined();
  });

  test("a second run that collects nothing is not a disagreement", () => {
    // The spec vanished, or the runner broke, between the two runs. Reading
    // that as "passed on the re-run" would acquit a red on an absence — the
    // same vacuity `no-spec` exists to keep out of the log in the first place.
    runner(
      `if [ "$(wc -l < ${JSON.stringify(calls)})" -ge 2 ]; ` +
        `then echo "No test files found, exiting with code 1"; exit 1; else ${FAILS}; fi`,
    );
    const run = runInstrument(instrument(), repo, { rerunOnRed: true });

    expect(run.observation).toBe("red");
    expect(invocations()).toBe(2);
    expect(run.attribution).toBeUndefined();
    expect(run.excerpt).toBe("FAIL test/a.test.ts > expected 3 got 0");
  });

  test("a green first run is never re-run — there is nothing to attribute", () => {
    runner(PASSES);
    const run = runInstrument(instrument(), repo, { rerunOnRed: true });

    expect(run.observation).toBe("green");
    expect(invocations()).toBe(1);
  });
});
