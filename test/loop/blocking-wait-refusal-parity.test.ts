/**
 * "Run five passes with the blocking wait and count refusals against the polling
 * record" — the assumption test under *A blocking wait removes the refusals
 * without costing wall-clock time*, held at the threshold it states:
 *
 *   > Zero blocked-call refusals across the five passes, and wall-clock time no
 *   > worse than the polling baseline.
 *
 * The belief it is aimed at is a viability one and it is stated as a conditional:
 * "adopting it is only strictly better if waiting once is no slower than polling
 * — otherwise the refusals were buying something." So this file is not here to
 * show that the shim works. `test/loop/wait-primitive-affordance.test.ts` already
 * shows that, and it shows the thing this candidate is cheapest at: the permitted
 * form is shorter to write than the blocked one. This file asks the harder half —
 * whether the cost went away or merely moved.
 *
 * ## The polling record prices the reflex, not the waiting
 *
 * The node says the baseline is "thirteen-plus real sessions with counted
 * refusals, not a construction". For refusals that is exactly right and this file
 * counts them mechanically. For wall clock it is not, and the corpus says why in
 * one number: **every recorded sighting was answered in 0.00–0.01 seconds**,
 * because the guard refused it before the `sleep` ever ran. Nobody paid those
 * forty-five seconds. There is no recorded poll-and-retry elapsed time to compare
 * against, and an instrument that reported one would be reporting a number it
 * made up.
 *
 * What the record does hold is three real quantities, and the comparison is built
 * only out of those:
 *
 *   - the seconds each refused call **committed to** before it could look once
 *     (its fixed sleep, 25s–240s) — a property of what was written, and paid
 *     whether or not the subject was ready;
 *   - the one compliant wait a session actually ran (`516fdfb8`, 26.42s, and it
 *     still came back nonzero);
 *   - the ceiling everything runs under: `Exit code 143 / Command timed out after
 *     2m 0s`, on disk in `97546e2f`.
 *
 * ## What could have failed, and did
 *
 * Two things here are disconfirmers rather than confirmations, and both were red
 * before this change:
 *
 *   1. **The shipped bound did not fit under the harness ceiling.** The affordance
 *      advertises a give-up, and the cheapest permitted form carries no `timeout`
 *      field — so a bound above 120s is not a bound at all, it is a promise the
 *      shim never gets to keep. What arrives instead is exit 143 with no output,
 *      which is less than the polling shape bought.
 *   2. **The bound was counted in sleeps, not in elapsed time.** A condition that
 *      costs three seconds an attempt was not priced at all, so the wait ran past
 *      the ceiling for exactly the conditions it exists for. `the bound is a
 *      wall-clock bound` below counts attempts rather than seconds, so it says the
 *      same thing on an idle box and a loaded one.
 *
 * ## Why there is real execution and real timing in here
 *
 * Because the threshold is about wall clock, and a model of wall clock is not
 * wall clock. The arithmetic sweep is what generalises — it asks the comparison at
 * *every* readiness time rather than at a flattering one — and the executed passes
 * are what stop the arithmetic from being fiction. Timing assertions are kept to
 * load-independent discriminators (attempt counts, and margins measured in whole
 * multiples) for the reason `vitest.config.ts` gives at length.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_EVERY_SECONDS,
  DEFAULT_FOR_SECONDS,
  HARNESS_BASH_TIMEOUT_SECONDS,
  REQUIRED_PASSES,
  SHIM_NAME,
  SLEEP_GUARD_REMEDY,
  blockingObservationSeconds,
  committedSleepSeconds,
  firstReadinessWhereBlockingLoses,
  permittedWait,
  pollingObservationSeconds,
  probeOf,
  renderWaitShim,
  sleepGuardRefusal,
} from "../../src/loop/wait.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const CORPUS = path.join(repoRoot, "test/fixtures/corrections");

interface CorpusCall {
  session: string;
  command: string;
  /** The error text the harness answered with, unwrapped, or null if it succeeded. */
  error: string | null;
  /** Seconds between the call being written and its result arriving. */
  latencySeconds: number | null;
}

/**
 * Every `Bash` call in the corpus with the answer it got and how long it took.
 *
 * The join is by `tool_use_id`, which is what the corpus was cut to preserve
 * (`test/fixtures/corrections/PROVENANCE.md`), so the latency is the recorded
 * turn and not an inference from ordering.
 */
function corpusCalls(): CorpusCall[] {
  const out: CorpusCall[] = [];
  for (const file of fs.readdirSync(CORPUS).filter((f) => f.endsWith(".jsonl"))) {
    const session = file.slice(0, 8);
    const written = new Map<string, { command: string; at: string }>();
    const answered = new Map<string, { text: string; at: string }>();
    for (const line of fs.readFileSync(path.join(CORPUS, file), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      const entry = JSON.parse(line) as { timestamp?: string; message?: { content?: unknown } };
      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content as {
        type?: string;
        id?: string;
        tool_use_id?: string;
        input?: { command?: string };
        content?: unknown;
      }[]) {
        if (block.type === "tool_use" && typeof block.input?.command === "string" && block.id) {
          written.set(block.id, { command: block.input.command, at: entry.timestamp ?? "" });
        }
        if (block.type === "tool_result" && block.tool_use_id) {
          const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          answered.set(block.tool_use_id, { text, at: entry.timestamp ?? "" });
        }
      }
    }
    for (const [id, call] of written) {
      const result = answered.get(id);
      const raw = result?.text ?? null;
      const unwrapped = raw === null ? null : /<tool_use_error>([\s\S]*)<\/tool_use_error>/.exec(raw)?.[1] ?? raw;
      out.push({
        session,
        command: call.command,
        error: unwrapped,
        latencySeconds:
          result && call.at && result.at ? (Date.parse(result.at) - Date.parse(call.at)) / 1000 : null,
      });
    }
  }
  return out;
}

/**
 * The polling record: every corpus call the sleep guard refused.
 *
 * Selected by the classifier rather than by hand, so the record cannot quietly
 * shrink to the cases the wait handles well. `the classifier reproduces every
 * recorded refusal` below is what makes that selection trustworthy.
 */
function pollingRecord(): CorpusCall[] {
  return corpusCalls().filter((c) => sleepGuardRefusal(c.command) !== null);
}

describe("the polling record, read off the corpus rather than described", () => {
  test("there are at least five recorded passes to compare against", () => {
    const record = pollingRecord();
    expect(record.length).toBeGreaterThanOrEqual(REQUIRED_PASSES);
    // Eight sightings across seven sessions is what PROVENANCE.md documents.
    expect(record).toHaveLength(8);
  });

  test("the classifier reproduces every recorded refusal, byte for byte", () => {
    // The whole refusal count rests on this. A predicate that merely said "yes"
    // could be wrong in the direction that flatters the permitted form and no
    // reader would be able to tell; reconstructing the message means the corpus
    // gets to disagree.
    for (const call of pollingRecord()) {
      expect(sleepGuardRefusal(call.command), `${call.session}: ${call.command}`).toBe(call.error);
    }
  });

  test("and refuses nothing the corpus was not refused for", () => {
    const refusedByGuard = corpusCalls().filter((c) => c.error?.startsWith("Blocked: sleep "));
    expect(refusedByGuard.map((c) => c.command).sort()).toEqual(pollingRecord().map((c) => c.command).sort());
  });

  test("the block is on the fixed prologue, not on sleeping", () => {
    // Worth pinning, because the shim sleeps inside itself and a reader is
    // entitled to ask whether that is "chaining shorter sleeps to work around
    // this block". It is not: the guard's own recommended remedy sleeps too, and
    // it is the form the guard names in the very message that refuses.
    expect(SLEEP_GUARD_REMEDY).toContain("do sleep 2; done");
    expect(sleepGuardRefusal("until gh pr checks 17; do sleep 5; done; gh pr checks 17")).toBeNull();
    // Chaining, however, is still the refused shape — the prologue is the subject.
    expect(sleepGuardRefusal("sleep 5; sleep 5; gh pr checks 17")).not.toBeNull();
  });

  test("not one of the recorded polls ever ran, so the record holds no polling wall clock", () => {
    // The finding that decides how the second half of the threshold can be
    // measured at all. Every sighting was answered instantly because the guard
    // refused it; the seconds those commands named were committed to and never
    // spent. So "the polling baseline" is a baseline of intentions, and the only
    // honest comparison is against what they committed to.
    for (const call of pollingRecord()) {
      expect(call.latencySeconds, `${call.session}: ${call.command}`).not.toBeNull();
      expect(call.latencySeconds!, `${call.session} answered in ${call.latencySeconds}s`).toBeLessThan(1);
    }
    const committed = pollingRecord().map((c) => committedSleepSeconds(c.command)!);
    expect(committed.reduce((a, b) => a + b, 0)).toBe(520);
  });

  test("the one compliant wait that did run cost 26s and still came back nonzero", () => {
    // The record's only real waiting measurement, and it is not a happy one: the
    // hand-built until-loop the guard's advice produced exited early on a partial
    // match and returned exit 8 with `test pending 0` still on screen. It is the
    // reason a blocking wait keyed on the condition's own zero exit is an
    // improvement on the remedy, not only on the reflex.
    const until = corpusCalls().find((c) => c.command.startsWith("until [ -n"));
    expect(until).toBeDefined();
    expect(until!.latencySeconds!).toBeGreaterThan(20);
    expect(until!.error).toContain("Exit code 8");
    expect(until!.error).toContain("pending");
  });
});

describe("the ceiling both shapes run under", () => {
  test("120 seconds is on disk, not assumed", () => {
    const timedOut = corpusCalls().filter((c) => c.error?.includes("Command timed out after"));
    expect(timedOut.length).toBeGreaterThanOrEqual(1);
    for (const call of timedOut) {
      expect(call.error).toContain("Command timed out after 2m 0s");
      expect(call.latencySeconds!).toBeGreaterThanOrEqual(HARNESS_BASH_TIMEOUT_SECONDS);
      expect(call.latencySeconds!).toBeLessThan(HARNESS_BASH_TIMEOUT_SECONDS + 5);
    }
  });

  test("the wait's own bound fits inside it, so a give-up is reported rather than killed", () => {
    // The cheapest permitted form carries no `timeout` field — that is where its
    // saving comes from — so it gets the default ceiling and nothing more. A
    // bound above the ceiling means the shim never reaches its own give-up
    // branch: no output, no verdict, exit 143. Room is left for the final attempt
    // to finish and for the report to be printed.
    expect(permittedWait("gh pr checks 17")).not.toContain("timeout");
    expect(DEFAULT_FOR_SECONDS + DEFAULT_EVERY_SECONDS).toBeLessThanOrEqual(HARNESS_BASH_TIMEOUT_SECONDS);
  });
});

describe("when each shape first sees a subject that becomes ready", () => {
  const recordedIntervals = [...new Set(pollingRecord().map((c) => committedSleepSeconds(c.command)!))].sort(
    (a, b) => a - b,
  );

  test("the sweep, not a chosen scenario: the wait never observes later", () => {
    // Riggable by choosing a readiness time — just under an interval and the wait
    // wins by 44 seconds, on a multiple of it and they tie — so the question is
    // asked at every readiness time out to the longest sleep any session wrote.
    expect(recordedIntervals).toEqual([25, 30, 45, 240]);
    for (const interval of recordedIntervals) {
      expect(
        firstReadinessWhereBlockingLoses(interval, DEFAULT_EVERY_SECONDS, 300),
        `a subject ready at that second is seen sooner by a ${interval}s poller than by the wait`,
      ).toBeNull();
    }
  });

  test("the reason it holds is divisibility, and it is a fact about the recorded intervals", () => {
    // Not a general law. The wait wins everywhere only because its interval
    // divides every interval a session chose; against an interval it does not
    // divide there are readiness times where the poller looks first. If a future
    // sighting brings an interval that is not a multiple of the default, this
    // parity claim needs re-deriving rather than re-running.
    for (const interval of recordedIntervals) expect(interval % DEFAULT_EVERY_SECONDS).toBe(0);
    expect(firstReadinessWhereBlockingLoses(7, DEFAULT_EVERY_SECONDS, 300)).toBe(6);
    expect(firstReadinessWhereBlockingLoses(45, 50, 300)).not.toBeNull();
  });

  test("the whole saving is the prologue a fixed sleep pays before looking once", () => {
    expect(pollingObservationSeconds(0, 45)).toBe(45);
    expect(blockingObservationSeconds(0, DEFAULT_EVERY_SECONDS)).toBe(0);
    expect(pollingObservationSeconds(1, 45)).toBe(45);
    expect(blockingObservationSeconds(1, DEFAULT_EVERY_SECONDS)).toBe(5);
    // And it is a saving, not a rounding artefact: past the first interval both
    // shapes are quantised, and the wait's quantum is the finer one.
    expect(pollingObservationSeconds(46, 45)).toBe(90);
    expect(blockingObservationSeconds(46, DEFAULT_EVERY_SECONDS)).toBe(50);
  });
});

/** A shim installed the way the build pass installs it: rendered, on PATH. */
function installShim(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-await-bin-"));
  fs.writeFileSync(path.join(dir, SHIM_NAME), renderWaitShim(), { mode: 0o755 });
  return dir;
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
  elapsedSeconds: number;
}

/** Run the command a composer would write, with the shim reachable by name. */
function compose(shimDir: string, command: string, timeoutMs = 40000): Run {
  const started = Date.now();
  const env = { ...process.env, PATH: `${shimDir}:${process.env.PATH ?? ""}` };
  try {
    const stdout = execFileSync("sh", ["-c", command], {
      encoding: "utf8",
      env,
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "", elapsedSeconds: (Date.now() - started) / 1000 };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      status: e.status ?? -1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      elapsedSeconds: (Date.now() - started) / 1000,
    };
  }
}

/**
 * A check that reports pending and then completes.
 *
 * Exit 8 is not decoration: it is what `gh pr checks` returned for a pending run
 * in `516fdfb8`, a nonzero status meaning *not finished yet* and indistinguishable
 * at the call site from a failure. A fixture that pended with exit 1 would be
 * testing an easier subject than the one the record contains.
 */
function pendThenComplete(pendingAttempts: number): { condition: string; attempts: () => number } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-await-check-"));
  const script = path.join(dir, "check.sh");
  const state = path.join(dir, "attempts");
  fs.writeFileSync(
    script,
    [
      "#!/bin/sh",
      'n=0; [ -f "$1" ] && n=$(cat "$1")',
      'n=$((n + 1)); printf %s "$n" > "$1"',
      `if [ "$n" -le ${pendingAttempts} ]; then echo "test pending 0"; exit 8; fi`,
      'echo "test pass"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return {
    condition: `sh ${script} ${state}`,
    attempts: () => (fs.existsSync(state) ? Number(fs.readFileSync(state, "utf8")) : 0),
  };
}

describe("the passes — every recorded poll, run through the blocking wait instead", () => {
  test(
    "zero refusals, zero timeouts, and none of them pays the sleep the record committed to",
    () => {
      const shimDir = installShim();
      const record = pollingRecord();
      expect(record.length).toBeGreaterThanOrEqual(REQUIRED_PASSES);

      let refusals = 0;
      let timeouts = 0;
      let elapsedTotal = 0;

      for (const call of record) {
        const committed = committedSleepSeconds(call.command)!;

        // What the pass writes for its real subject: the default form, which is
        // the one the affordance advertises and the one the cost comparison in
        // `wait-primitive-affordance.test.ts` prices.
        const written = permittedWait(probeOf(call.command));
        if (sleepGuardRefusal(written) !== null) refusals++;

        // What the pass runs: the same form against a fixture that pends and then
        // completes. The interval is named so the suite does not spend a minute
        // proving arithmetic the sweep above already proves at the default; the
        // arguments are the only difference from the written form, and the line
        // below holds them to drawing no refusal either.
        const check = pendThenComplete(1);
        const command = `${permittedWait(check.condition)} 1 10`;
        if (sleepGuardRefusal(command) !== null) refusals++;

        const run = compose(shimDir, command);
        elapsedTotal += run.elapsedSeconds;
        if (run.status !== 0) timeouts++;

        expect(run.status, `${call.session}: ${run.stderr}`).toBe(0);
        expect(run.stdout).toContain("test pass");
        // It really waited rather than reporting the first pending answer: the
        // fixture only completes on its second attempt.
        expect(check.attempts()).toBe(2);
        expect(run.stderr).not.toContain("gave up");
        expect(
          run.elapsedSeconds,
          `a pass took ${run.elapsedSeconds}s against the ${committed}s this call committed to`,
        ).toBeLessThan(committed);
      }

      // The headline the threshold asks for. Eight refusals on the record, none
      // here — and the classifier that says "none" is the one the corpus just
      // held to eight verbatim reproductions.
      expect(refusals).toBe(0);
      expect(timeouts).toBe(0);
      expect(record.filter((c) => sleepGuardRefusal(c.command) !== null)).toHaveLength(8);
      expect(elapsedTotal).toBeLessThan(record.reduce((a, c) => a + committedSleepSeconds(c.command)!, 0));
    },
    120000,
  );
});

describe("the regime where the subject never becomes ready", () => {
  /** A check that pends forever, and costs real time on every attempt. */
  function neverCompletes(attemptSeconds: number): { condition: string; attempts: () => number } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-await-stuck-"));
    const script = path.join(dir, "check.sh");
    const state = path.join(dir, "attempts");
    fs.writeFileSync(
      script,
      [
        "#!/bin/sh",
        'n=0; [ -f "$1" ] && n=$(cat "$1")',
        'n=$((n + 1)); printf %s "$n" > "$1"',
        'echo "test pending 0"',
        `sleep ${attemptSeconds}`,
        "exit 8",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    return {
      condition: `sh ${script} ${state}`,
      attempts: () => (fs.existsSync(state) ? Number(fs.readFileSync(state, "utf8")) : 0),
    };
  }

  test(
    "the bound is a wall-clock bound, not the sum of the sleeps",
    () => {
      // The disconfirmer for the second half of the threshold, and it counts
      // attempts rather than seconds so it says the same thing on a loaded box.
      // A bound that adds up its own sleeps prices the condition at zero: at
      // every=1s and limit=4s it will make five attempts however long each one
      // takes, so a three-second condition runs it to nineteen seconds. A
      // deadline read off the clock makes two and stops.
      const attemptSeconds = 3;
      const limit = 4;
      const check = neverCompletes(attemptSeconds);
      const run = compose(installShim(), `${permittedWait(check.condition)} 1 ${limit}`);

      expect(
        check.attempts(),
        "the wait kept attempting past its own deadline — the bound is counting sleeps, not elapsed time",
      ).toBeLessThanOrEqual(3);
      expect(run.elapsedSeconds).toBeLessThanOrEqual(limit + 3 * attemptSeconds);
      expect(run.status).toBe(8);
    },
    120000,
  );

  test(
    "and giving up says what it saw, which is what the poller was buying",
    () => {
      // The honest half of the comparison. In this regime the wait is not cheaper
      // than the poller — both are stopped by the same ceiling — so the question
      // is what each one hands back. Exit 143 hands back nothing. This hands back
      // the last attempt's output and its own verdict, which is strictly more
      // than the five `still pending` lines the originating session got.
      const check = neverCompletes(1);
      const run = compose(installShim(), `${permittedWait(check.condition)} 1 3`);
      expect(run.status).toBe(8);
      expect(run.stdout).toContain("test pending 0");
      expect(run.stderr).toContain(`${SHIM_NAME}: gave up after`);
      expect(run.stderr).toContain("the condition still exits 8");
      const reported = Number(/gave up after (\d+)s/.exec(run.stderr)?.[1]);
      expect(reported).toBeGreaterThanOrEqual(1);
      expect(reported).toBeLessThanOrEqual(HARNESS_BASH_TIMEOUT_SECONDS);
    },
    120000,
  );
});
