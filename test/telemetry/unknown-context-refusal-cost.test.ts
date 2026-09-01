/**
 * "Measure how much signal a refuse-on-unknown-context rule would delete" — the
 * instrument beneath "Refuse to record a step whose context could not be
 * determined".
 *
 * The solution inverts its opportunity's goal. The stated cost is not that
 * context is missing but that **the record looks complete**, so a failure that
 * cannot be reproduced also cannot be dismissed; the candidate fixes the
 * looking-complete part by declining to write the record at all. Its own node
 * says what that costs: *a failure with unknown context is still a signal that
 * something broke, and refusing to record it loses that.* So the assumption test
 * asks for the price first.
 *
 * **The bar, copied from the node rather than restated:** fewer than 5 of the
 * last 100 recorded steps would have been refused, **and** none of the refused
 * set turns out to be a failure somebody later acted on. Both clauses are in the
 * command deliberately — if the five refused records happen to be the five that
 * mattered, the rule is bad at 5%.
 *
 * ## The price: zero, because the rule cannot fire
 *
 * The ledger the threshold names is the one `readRuns` opens, which
 * `src/loop/state.ts` puts at `<vault>/.git/ost-agent/runs.jsonl`. On 2026-08-31
 * that was **347 runs and 625 recorded steps, of which not one is missing `cwd`
 * and not one is missing `argv`** — 82 of them failures. Over the last hundred:
 * **0 refused, 0%, against a 5% bar.**
 *
 * So the rate clause clears by the widest margin available, and the reading is
 * still not `cleared`. The second clause has no subject: with an empty refused
 * set, "none of the refused set is a failure somebody acted on" is satisfied by a
 * rule that never ran, and the node is explicit that a rate alone is not the
 * verdict — *a low count alone is not enough … the second condition is what makes
 * this a real test rather than a rate.* {@link readCensus} calls that
 * `undecidable`, and the finding it names is sharper than "cheap": **the refusal
 * is free because it is inert.** `loop step` is the only writer of a step record
 * and it captures `process.cwd()` and the argv unconditionally, before it spawns
 * anything (`src/cli/loop.ts`). There is no path in this repository that can hand
 * `appendStep` a step whose context is unknown, so the precondition would guard a
 * door that cannot be opened.
 *
 * And the reason that door is shut is a *sibling of this very node*. "Every
 * recorded step carries the directory and argv it actually ran with" was built and
 * its own instrument discharged — `reconstructInvocation` over the ten most recent
 * real failures, 10 of 10 against a pre-committed 5-of-10 bar
 * (`src/loop/replay.ts`, `test/loop/record-replay-sufficiency.test.ts`). Making
 * the record always carry its context is what left a refusal on missing context
 * with nothing to refuse. The node's framing — that this is "the cheapest of the
 * three by a wide margin" — is still true and no longer the point: it is cheap
 * because it is empty, and what the price actually settles is sequencing between
 * siblings rather than affordability.
 *
 * ## What the cost would look like if it ever could fire
 *
 * There is exactly one corpus in this vault the rule bites on, and **nothing
 * reads it**: `<vault>/.ost-agent/health/runs.jsonl`, the working-tree file the
 * loop wrote before the state directory moved into `.git`. Still committed, no
 * longer opened by anything. Thirty steps, **21 refused — 70%** — and one of the
 * refused is the failing step of 2026-07-27T00:53:59Z, `bash -c npx vitest run`,
 * run from a home directory instead of the repo. Somebody acted on that failure
 * three times inside twenty minutes: a corrected re-run 63 seconds later, a
 * friction note filed 75 seconds later, and the commit that landed the note 17
 * minutes later. That friction note is the source of the opportunity this
 * solution hangs from. **On the only corpus where the rule does anything, it
 * deletes the record that created the branch it lives on.**
 *
 * That is also the node's own distinguishing assumption failing — *that the
 * recorder can reliably tell when it does not know the context.* It cannot. Both
 * wrong-directory failures in that ledger are the same defect, and the rule
 * refuses one and admits the other; what separates them is the schema version of
 * whatever wrote them, not whether either can be reproduced.
 *
 * ## Why this file does not assert the bar, and what it asserts instead
 *
 * The bar is a claim about a recorded world, not about this codebase. The only
 * edit in this repository that could move a breached bar is an edit to the ledger
 * the census reads — and an instrument whose route to green runs through
 * rewriting its own corpus must not gate the suite. So what is asserted here is
 * everything compute can settle without touching the evidence: the predicate is
 * right, the replay is total, the follow-up trace finds what the vault's history
 * actually contains, the reading derives the node's rule and not a friendlier one,
 * and — on each committed corpus — the verdict is pinned to the numbers that
 * corpus actually holds. A rate over an empty set, or a second clause that never
 * fired, comes out `undecidable` rather than printing `0%` and reading as cleared.
 *
 * The measured numbers above are the deliverable. They are printed on every run
 * and pinned against two committed corpora below. Nothing here builds the refusal
 * or the middle version; `src/telemetry/step-context.ts`,
 * `src/telemetry/unknown-context-census.ts` and `src/git/follow-up-sight.ts` are
 * on the module-reachability debt register with that reason.
 *
 * **What a green run here does not settle**, verbatim from the node: whether the
 * middle option it names — record it but mark it `context-unknown` and exclude it
 * from any count implying reproducibility — is the better candidate. This command
 * prices refusal and says nothing about the alternative.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { readVaultPointer } from "../../src/config/pointer.js";
import { gitFollowUpSight } from "../../src/git/follow-up-sight.js";
import { readRuns } from "../../src/loop/health.js";
import {
  contextDeterminable,
  contextGaps,
  refusalFor,
  CONTEXT_READINGS,
  type ContextReading,
} from "../../src/telemetry/step-context.js";
import {
  censusUnknownContext,
  formatUnknownContextCensus,
  payloadOf,
  readCensus,
  stepsNewestFirst,
  traceActedOn,
  CENSUS_WINDOW,
  REFUSAL_SHARE_BAR,
  type CensusStep,
  type CitingCommit,
  type FollowUpSight,
} from "../../src/telemetry/unknown-context-census.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE_DIR = path.join(REPO_ROOT, "test", "fixtures", "unknown-context-price");

/** The failing step the whole finding turns on, by its recorded timestamp. */
const FOUNDING_FAILURE_AT = "2026-07-27T00:53:59.556Z";

describe("the predicate: could the recorder have said where this step ran", () => {
  test("a step with an absolute cwd and an argv is determinable under both readings", () => {
    const step = { phase: "build", command: "npm test", argv: ["npm", "test"], cwd: "/home/user/OST-Agent", exit: 0 };
    for (const reading of CONTEXT_READINGS) {
      expect(contextGaps(step, reading)).toEqual([]);
      expect(contextDeterminable(step, reading)).toBe(true);
      expect(refusalFor(step, reading)).toBeNull();
    }
  });

  test("`reproducible` refuses a superset of `where`, so the two can never disagree about a complete record", () => {
    // The solution node says "where a step ran", which is cwd alone. The
    // opportunity above it asks for enough to reproduce, which needs the argv the
    // command string cannot be split back into. Reporting one number under an
    // unstated reading is how a rate gets mistaken for a verdict, so both are
    // computed — and this is what keeps the looser one from ever being stricter.
    const cases = [
      { command: "npm test", cwd: "/repo", argv: ["npm", "test"] },
      { command: "npm test", cwd: "/repo" },
      { command: "npm test" },
      { command: "npm test", cwd: "relative/path", argv: [] },
      {},
    ];
    for (const step of cases) {
      const where = contextGaps(step, "where");
      const reproducible = contextGaps(step, "reproducible");
      for (const gap of where) expect(reproducible).toContain(gap);
    }
  });

  test("each missing thing is named separately, because the refusal has to be one edit and not one bisection", () => {
    expect(contextGaps({ command: "npm test" }, "where")).toEqual(["no-cwd"]);
    expect(contextGaps({ command: "npm test", cwd: "  " }, "where")).toEqual(["no-cwd"]);
    expect(contextGaps({ command: "npm test", cwd: "../repo" }, "where")).toEqual(["cwd-not-absolute"]);
    expect(contextGaps({ command: "", cwd: "/repo" }, "where")).toEqual(["no-command"]);
    expect(contextGaps({ command: "npm test", cwd: "/repo" }, "reproducible")).toEqual(["no-argv"]);
    expect(contextGaps({ command: "npm test", cwd: "/repo", argv: [] }, "reproducible")).toEqual(["empty-argv"]);
  });

  test("a Windows path is absolute wherever the census happens to run", () => {
    // The ledger this reads was written on Linux and is read here on a Mac, which
    // is the ordinary case for a record that outlives its machine. `path.isAbsolute`
    // answers for the reader's platform, and a predicate whose answer moved with
    // the reader would make the rate a property of whoever ran the census.
    expect(contextGaps({ command: "x", cwd: "C:\\src\\repo" }, "where")).toEqual([]);
    expect(contextGaps({ command: "x", cwd: "\\\\server\\share" }, "where")).toEqual([]);
    expect(contextGaps({ command: "x", cwd: "/srv/repo" }, "where")).toEqual([]);
  });

  test("the refusal names the step and what was missing", () => {
    const message = refusalFor({ phase: "build", command: "npx vitest run" }, "reproducible");
    expect(message).toContain("`build`");
    expect(message).toContain("`npx vitest run`");
    expect(message).toContain("no working directory");
    expect(message).toContain("no argv");
  });
});

describe("the replay: how many recorded steps the refusal would have deleted", () => {
  const runs = [
    { runId: "r2", steps: [{ phase: "build", command: "b", cwd: "/repo", argv: ["b"], exit: 0, at: "2026-01-02T00:00:00Z" }] },
    {
      runId: "r1",
      steps: [
        { phase: "pass", command: "a", exit: 0, at: "2026-01-01T00:00:00Z" },
        { phase: "check", command: "c", cwd: "/repo", argv: ["c"], exit: 1, at: "2026-01-01T00:01:00Z" },
        { phase: "build", command: "d", exit: 1, at: "2026-01-01T00:02:00Z" },
      ],
    },
  ];

  test("steps come out newest first, across runs and within one", () => {
    const steps = stepsNewestFirst(runs);
    expect(steps.map((s) => s.command)).toEqual(["b", "d", "c", "a"]);
    expect(steps.map((s) => s.ordinal)).toEqual([0, 1, 2, 3]);
    expect(steps[1].runId).toBe("r1");
  });

  test("every step is accounted for — refused plus determinable is the whole sample", () => {
    const steps = stepsNewestFirst(runs);
    for (const reading of CONTEXT_READINGS) {
      const c = censusUnknownContext(steps, reading);
      expect(c.sampled).toBe(4);
      expect(c.recorded).toBe(4);
      const determinable = steps.filter((s) => contextDeterminable(s, reading)).length;
      expect(c.refused.length + determinable).toBe(c.sampled);
    }
  });

  test("the count separates failing steps from the rest, because the second clause only reads those", () => {
    const c = censusUnknownContext(stepsNewestFirst(runs), "where");
    expect(c.refused.map((r) => r.step.command)).toEqual(["d", "a"]);
    expect(c.failures).toBe(2);
    expect(c.refusedFailures.map((r) => r.step.command)).toEqual(["d"]);
    expect(c.refusedShare).toBeCloseTo(2 / 4);
    expect(c.byGap["no-cwd"]).toBe(2);
  });

  test("only the last hundred are counted, and `recorded` still says how long the ledger is", () => {
    const many = stepsNewestFirst([
      { runId: "long", steps: Array.from({ length: 150 }, (_, i) => ({ phase: "p", command: `c${i}`, exit: 0, at: "2026-01-01T00:00:00Z" })) },
    ]);
    const c = censusUnknownContext(many, "where");
    expect(CENSUS_WINDOW).toBe(100);
    expect(c.sampled).toBe(100);
    expect(c.recorded).toBe(150);
    expect(c.shortSample).toBe(false);
  });

  test("a ledger shorter than a hundred says so, so the count is never read as `of the last 100`", () => {
    const c = censusUnknownContext(stepsNewestFirst(runs), "where");
    expect(c.shortSample).toBe(true);
    expect(formatUnknownContextCensus("fixture", c, [])).toContain("SHORT SAMPLE");
  });

  test("an empty ledger is 0 refused and 0 share, not a division by zero", () => {
    const c = censusUnknownContext([], "where");
    expect(c.sampled).toBe(0);
    expect(c.refusedShare).toBe(0);
    expect(c.refused).toEqual([]);
  });
});

describe("what counts as somebody acting on a refused failure", () => {
  /** The recorded wrong-directory failure and its recorded fix, in the shape the ledger holds them. */
  const failed: CensusStep = {
    runId: "r",
    ordinal: 1,
    phase: "build",
    command: "bash -c npx vitest run",
    exit: 1,
    at: "2026-07-27T00:53:59.556Z",
  };
  const fixed: CensusStep = {
    runId: "r",
    ordinal: 0,
    phase: "build",
    command: "bash -c cd /home/user/OST-Agent && npx vitest run",
    cwd: "/home/user/OST-Agent",
    argv: ["bash", "-c", "cd /home/user/OST-Agent && npx vitest run"],
    exit: 0,
    at: "2026-07-27T00:55:02.162Z",
  };

  test("the payload survives the shell wrapper and the directory correction that fixed it", () => {
    // Without this the corrected re-run is invisible: the fix for a wrong-directory
    // failure is the same command with `cd … &&` in front, so comparing command
    // strings finds nothing at all.
    expect(payloadOf("bash -c npx vitest run")).toBe("npx vitest run");
    expect(payloadOf("bash -c cd /home/user/OST-Agent && npx vitest run")).toBe("npx vitest run");
    expect(payloadOf("bash -c set -o pipefail; cd /repo && npx tsc --noEmit")).toBe("npx tsc --noEmit");
    // A `cd` that is not the leading correction stays in the payload.
    expect(payloadOf("bash -c npm test && cd /tmp")).toBe("npm test && cd /tmp");
  });

  test("a corrected re-run of the same payload is a follow-up, and it is named as corrected", async () => {
    const steps = [fixed, failed];
    const census = censusUnknownContext(steps, "where");
    const actedOn = await traceActedOn(census, steps, null);
    expect(actedOn).toHaveLength(1);
    expect(actedOn[0].refused.step.at).toBe(failed.at);
    expect(actedOn[0].followUps.map((f) => f.kind)).toEqual(["corrected-rerun"]);
  });

  test("an identical re-run that passed is weaker, so it is reported as `repeat` rather than pooled", async () => {
    const retry: CensusStep = { ...fixed, command: failed.command, cwd: "/x", argv: ["x"] };
    const steps = [retry, failed];
    const actedOn = await traceActedOn(censusUnknownContext(steps, "where"), steps, null);
    expect(actedOn[0].followUps.map((f) => f.kind)).toEqual(["repeat-rerun"]);
  });

  test("a later step outside the window, of another phase, or that also failed is not a follow-up", async () => {
    const cases: CensusStep[] = [
      { ...fixed, at: "2026-07-29T00:00:00.000Z" },
      { ...fixed, phase: "check" },
      { ...fixed, exit: 1 },
      { ...fixed, at: "2026-07-27T00:00:00.000Z" },
    ];
    for (const later of cases) {
      const steps = [later, failed];
      expect(await traceActedOn(censusUnknownContext(steps, "where"), steps, null)).toEqual([]);
    }
  });

  test("a determinable failure is never traced — the second clause reads the refused set only", async () => {
    const kept: CensusStep = { ...failed, cwd: "/home/user", argv: ["bash", "-c", "npx vitest run"] };
    const steps = [fixed, kept];
    expect(await traceActedOn(censusUnknownContext(steps, "reproducible"), steps, null)).toEqual([]);
  });

  test("a commit that cites the failed payload inside the window is a follow-up", async () => {
    // The recorded read, verbatim from test/fixtures/unknown-context-price/PROVENANCE.md.
    const asked: { payload: string; since: string; until: string }[] = [];
    const sight: FollowUpSight = {
      async citingCommits(payload, since, until): Promise<CitingCommit[]> {
        asked.push({ payload, since, until });
        return [
          { sha: "62fefd84221d6c2aa9a8bddeebd72cdcd2f0e8f1", at: "2026-07-27T01:10:35Z", subject: "ost: the sweep that measured only the files it could open" },
        ];
      },
    };
    const steps = [failed];
    const actedOn = await traceActedOn(censusUnknownContext(steps, "where"), steps, sight);
    expect(asked).toEqual([{ payload: "npx vitest run", since: failed.at, until: "2026-07-28T00:53:59.556Z" }]);
    expect(actedOn[0].followUps[0].kind).toBe("citing-commit");
    expect(actedOn[0].followUps[0].detail).toContain("62fefd84");
  });

  test("a payload too short to distinguish anything is not pickaxed", async () => {
    const short: CensusStep = { ...failed, command: "make" };
    let called = false;
    const sight: FollowUpSight = {
      async citingCommits() {
        called = true;
        return [];
      },
    };
    await traceActedOn(censusUnknownContext([short], "where"), [short], sight);
    expect(called).toBe(false);
  });
});

describe("the reading the node fixed, and the two ways it refuses to call a miss a pass", () => {
  function censusWith(refused: number, sampled: number) {
    const steps = stepsNewestFirst([
      {
        runId: "r",
        steps: Array.from({ length: sampled }, (_, i) => ({
          phase: "p",
          command: `command number ${i}`,
          exit: 0,
          at: "2026-01-01T00:00:00Z",
          ...(i < sampled - refused ? { cwd: "/repo", argv: ["x"] } : {}),
        })),
      },
    ]);
    return censusUnknownContext(steps, "where");
  }

  test("both clauses have to hold, and the bar is the share the node fixed", () => {
    expect(REFUSAL_SHARE_BAR).toBe(0.05);
    const under = censusWith(4, 100);
    expect(readCensus(under, []).rateClause).toBe("clear");
    expect(censusWith(5, 100).refusedShare).toBe(0.05);
    expect(readCensus(censusWith(5, 100), []).rateClause).toBe("breached");
  });

  test("a rate that clears the bar is still `not-cleared` when one refused failure was acted on", () => {
    // The node's own reason for putting the second clause in the command: if the
    // five refused records happen to be the five that mattered, the rule is bad at
    // 5%, and leaving that to a reader is how a rate gets mistaken for a verdict.
    const steps: CensusStep[] = [
      { runId: "r", ordinal: 0, phase: "build", command: "npx vitest run once", cwd: "/repo", argv: ["x"], exit: 0, at: "2026-01-01T00:01:00Z" },
      { runId: "r", ordinal: 1, phase: "build", command: "npx vitest run once", exit: 1, at: "2026-01-01T00:00:00Z" },
    ];
    return traceActedOn(censusUnknownContext(steps, "where"), steps, null).then((actedOn) => {
      const reading = readCensus(censusUnknownContext(steps, "where"), actedOn);
      expect(actedOn).toHaveLength(1);
      expect(reading.secondClause).toBe("breached");
      expect(reading.verdict).toBe("not-cleared");
    });
  });

  test("an empty ledger is `undecidable` — a rate over an empty set is undefined, not cleared", () => {
    const reading = readCensus(censusUnknownContext([], "where"), []);
    expect(reading.verdict).toBe("undecidable");
    expect(reading.because).toContain("cannot be cleared");
    expect(reading.because).not.toMatch(/0\.0%/);
  });

  test("a second clause that never fired is `vacuous`, and vacuous is not cleared either", () => {
    // Everything refused, nothing refused that failed. The rate clause could still
    // pass on a big enough denominator, and a census that called that "cleared"
    // would hand the candidate a pass earned by a clause that never ran.
    const clean = censusWith(4, 100);
    expect(clean.refusedFailures).toHaveLength(0);
    const reading = readCensus(clean, []);
    expect(reading.rateClause).toBe("clear");
    expect(reading.secondClause).toBe("vacuous");
    expect(reading.verdict).toBe("undecidable");
    expect(formatUnknownContextCensus("fixture", clean, [])).toContain("nothing to judge");
  });

  test("the report names every acted-on refusal and the evidence for it", () => {
    const steps: CensusStep[] = [
      { runId: "r", ordinal: 0, phase: "build", command: "bash -c cd /repo && npx vitest run", cwd: "/repo", argv: ["x"], exit: 0, at: "2026-01-01T00:01:00Z" },
      { runId: "r", ordinal: 1, phase: "build", command: "bash -c npx vitest run", exit: 1, at: "2026-01-01T00:00:00Z" },
    ];
    return traceActedOn(censusUnknownContext(steps, "where"), steps, null).then((actedOn) => {
      const report = formatUnknownContextCensus("fixture", censusUnknownContext(steps, "where"), actedOn);
      expect(report).toContain("second clause BREACHED");
      expect(report).toContain("2026-01-01T00:00:00Z");
      expect(report).toContain("corrected-rerun");
      expect(report).toContain("not-cleared");
    });
  });
});

/** Read one of the committed corpora, newest run first, the way `readRuns` hands them over. */
function corpus(file: string): CensusStep[] {
  return stepsNewestFirst(
    fs
      .readFileSync(path.join(FIXTURE_DIR, file), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as { runId: string; startedAt: string; steps?: CensusStep[] })
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)),
  );
}

/**
 * The price, over the ledger the loop actually keeps.
 *
 * `runs-current.jsonl` is the newest 101 steps of `<vault>/.git/ost-agent/runs.jsonl`
 * — the file `readRuns` opens, and therefore the "last 100 recorded steps" the
 * threshold names. Committed rather than read live because a fact nobody can
 * check on a bare clone is a fact that stops being checked; `PROVENANCE.md`
 * states exactly which fields were kept and why no dropped one can move a count,
 * and the live block below holds the two to the same number where it can.
 */
describe("the price, over the ledger the loop actually keeps", () => {
  const steps = corpus("runs-current.jsonl");

  test("not one of the last hundred recorded steps would have been refused", () => {
    for (const reading of CONTEXT_READINGS as readonly ContextReading[]) {
      const census = censusUnknownContext(steps, reading);
      expect(census.sampled).toBe(100);
      expect(census.shortSample).toBe(false);
      expect(census.refused, `${reading}: ${census.refused.map((r) => r.refusal).join(" | ")}`).toHaveLength(0);
      expect(census.refusedShare).toBe(0);
      expect(readCensus(census, []).rateClause).toBe("clear");
    }
  });

  test("the failures in that window are recorded with their context, not refused", () => {
    // The clause that matters is about failures, and this window has five of them.
    // Every one carries the working directory and the argv it ran with, which is
    // the whole of what the refusal would have demanded before writing it down.
    const census = censusUnknownContext(steps, "reproducible");
    expect(census.failures).toBe(5);
    expect(census.refusedFailures).toHaveLength(0);
  });

  test("so the reading is `undecidable`, not `cleared` — the second clause never fired", () => {
    // The node is explicit that a rate is not the verdict: "A low count alone is
    // not enough … the second condition is what makes this a real test rather than
    // a rate." With nothing refused, that condition has no subject, and a census
    // that answered `cleared` here would be handing the candidate a pass earned by
    // a rule that never ran.
    const census = censusUnknownContext(steps, "where");
    const reading = readCensus(census, []);
    expect(reading.rateClause).toBe("clear");
    expect(reading.secondClause).toBe("vacuous");
    expect(reading.verdict).toBe("undecidable");

    const report = formatUnknownContextCensus("committed corpus — the ledger the loop keeps", census, []);
    expect(report).toContain("0/100");
    expect(report).toContain("nothing to judge");
    // eslint-disable-next-line no-console -- the count IS the deliverable; a price nobody reads answers nothing.
    console.log(report);
  });

  test("the reason it cannot fire: the only writer captures the context unconditionally", () => {
    // The finding behind the zero, and the one part of it that is a property of
    // this repository rather than of a ledger. `loop step` is the sole caller of
    // `appendStep` outside the suite, and it passes the working directory and the
    // argv on both of its paths — the spend-ceiling halt and the ordinary spawn —
    // before anything is written. A refusal on unknown context guards a door no
    // caller can open.
    const cli = fs.readFileSync(path.join(REPO_ROOT, "src", "cli", "loop.ts"), "utf8");
    const appendCalls = [...cli.matchAll(/appendStep\(opts\.vault, \{[^}]*\}\);/g)].map((m) => m[0]);
    expect(appendCalls).toHaveLength(2);
    for (const call of appendCalls) {
      // `cwd,` on the spawn path, `cwd: process.cwd(),` on the halt path — shorthand counts.
      expect(call).toMatch(/\bargv[,:]/);
      expect(call).toMatch(/\bcwd[,:]/);
    }
    expect(cli).toContain("const cwd = process.cwd();");
  });
});

/**
 * The same replay over the one corpus in this vault the rule bites on — and
 * nothing reads it.
 *
 * `runs-legacy.jsonl` is a byte copy of `<vault>/.ost-agent/health/runs.jsonl`,
 * the working-tree ledger the loop wrote before `src/loop/state.ts` moved the
 * state directory inside `.git`. Still committed in the vault, opened by no code
 * path. It is here because it is the only place the price is anything but zero,
 * and because of what is in the refused set.
 *
 * The follow-up sight is the recorded output of the real `git log -S` against the
 * vault, quoted in `PROVENANCE.md` beside the ledger.
 */
describe("what the refusal would cost on the one corpus it bites — the ledger nothing reads", () => {
  const steps = corpus("runs-legacy.jsonl");

  const recordedSight: FollowUpSight = {
    async citingCommits(payload): Promise<CitingCommit[]> {
      if (payload !== "npx vitest run") return [];
      return [
        { sha: "62fefd84221d6c2aa9a8bddeebd72cdcd2f0e8f1", at: "2026-07-27T01:10:35Z", subject: "ost: the sweep that measured only the files it could open" },
        { sha: "6306c2c1ccd438dfdcb27d7313ddab0cac76c422", at: "2026-07-27T11:17:52Z", subject: "ost: the thirteenth pass — the recorder was lied to, and fixed" },
        { sha: "09db0067493998f09c47282d546c3b0a197cd83b", at: "2026-07-27T16:06:22Z", subject: "ost: the fourteenth pass — the count learns what it was taken over" },
      ];
    },
  };

  test("21 of its 30 steps would have been refused — 70%, against a 5% bar", () => {
    const census = censusUnknownContext(steps, "where");
    expect(census.recorded).toBe(30);
    expect(census.sampled).toBe(30);
    expect(census.shortSample).toBe(true);
    expect(census.refused).toHaveLength(21);
    expect(census.refusedShare).toBeCloseTo(0.7);
    expect(readCensus(census, []).rateClause).toBe("breached");
  });

  test("the two readings agree, so the 70% is not an artefact of how `context` was read", () => {
    // Every refused step is missing cwd AND argv; every admitted one carries both.
    // Worth pinning, because a reader could otherwise put the rate down to the
    // stricter reading having asked for more than the solution node did.
    expect(censusUnknownContext(steps, "where").refused).toHaveLength(21);
    expect(censusUnknownContext(steps, "reproducible").refused).toHaveLength(21);
  });

  test("the refused set contains the failure this opportunity was founded on", () => {
    const census = censusUnknownContext(steps, "where");
    const founding = census.refusedFailures.find((r) => r.step.at === FOUNDING_FAILURE_AT);
    expect(founding, "the 2026-07-27T00:53:59Z wrong-directory failure is refused").toBeDefined();
    expect(founding!.step.command).toBe("bash -c npx vitest run");
    expect(founding!.gaps).toContain("no-cwd");
  });

  test("and somebody acted on it — a corrected re-run 63 seconds later, and the commit that filed the friction note", async () => {
    // This is the second clause with a subject, and what it shows is the candidate
    // deleting its own origin. The note that commit added is the source of "A
    // recorded failure can't be reproduced, because the record omits where it ran"
    // — the parent opportunity of the solution this census prices.
    const census = censusUnknownContext(steps, "where");
    const actedOn = await traceActedOn(census, steps, recordedSight);
    const founding = actedOn.find((a) => a.refused.step.at === FOUNDING_FAILURE_AT);
    expect(founding, "the founding failure has a follow-up").toBeDefined();
    expect(founding!.followUps.map((f) => f.kind)).toContain("corrected-rerun");
    expect(founding!.followUps.map((f) => f.detail).join(" ")).toContain("62fefd84");

    const reading = readCensus(census, actedOn);
    expect(reading.secondClause).toBe("breached");
    expect(reading.verdict).toBe("not-cleared");

    const report = formatUnknownContextCensus("committed corpus — the legacy ledger nothing reads", census, actedOn);
    expect(report).toContain("second clause BREACHED");
    expect(report).toContain(FOUNDING_FAILURE_AT);
    // eslint-disable-next-line no-console -- the count IS the deliverable; a price nobody reads answers nothing.
    console.log(report);
  });

  test("both wrong-directory failures are the same defect; the rule refuses one and admits the other", () => {
    // The node's distinguishing assumption is "that the recorder can reliably tell
    // when it does not know the context. If it cannot, this refuses honest records
    // and admits dishonest ones — strictly worse than doing nothing." Here is that,
    // measured: two failures with the identical cause, separated by the schema
    // version of whatever wrote them rather than by whether either is reproducible.
    const failures = steps.filter((s) => s.exit !== 0);
    expect(failures).toHaveLength(2);
    expect(failures.filter((s) => !contextDeterminable(s, "where")).map((s) => s.at)).toEqual([FOUNDING_FAILURE_AT]);
    expect(failures.filter((s) => contextDeterminable(s, "where"))).toHaveLength(1);
    // Both are the same shape: a proving command re-run a minute later with a `cd`
    // in front of it, from a directory that was not the repository.
    for (const f of failures) {
      const fix = steps.find(
        (s) => s.phase === f.phase && s.exit === 0 && payloadOf(s.command ?? "") === payloadOf(f.command ?? "") && Date.parse(s.at!) > Date.parse(f.at!),
      );
      expect(fix, `no corrected re-run found for the failure at ${f.at}`).toBeDefined();
      expect(fix!.command).toMatch(/cd \S+ &&/);
    }
  });
});

/**
 * The price today, over the live vault.
 *
 * Two jobs. It re-runs the census against the untruncated ledger, so the
 * projection committed as `runs-current.jsonl` is held to the same refusal count
 * rather than trusted — the one claim `PROVENANCE.md` makes that a reader would
 * otherwise have to take on faith. And it prints the current numbers, which is
 * what a person re-reads the node against.
 *
 * No bar is asserted here: the vault moves, and a spec that pinned today's ledger
 * would go red on the next firing that recorded a step.
 */
function liveVault(): string | null {
  try {
    const pointed = readVaultPointer(REPO_ROOT).dir;
    return fs.existsSync(path.join(pointed, "ost.config.yaml")) ? pointed : null;
  } catch {
    return null;
  }
}

const VAULT = liveVault();

describe.runIf(VAULT !== null)("the price today, over the live vault", () => {
  test("the replay is total under both readings, and the committed projection matches the ledger it came from", async () => {
    const live = stepsNewestFirst(readRuns(VAULT!) as unknown as { runId: string; steps?: CensusStep[] }[]);
    const fixture = corpus("runs-current.jsonl");
    const sight = gitFollowUpSight(VAULT!);
    let printed = "";
    for (const reading of CONTEXT_READINGS as readonly ContextReading[]) {
      const census = censusUnknownContext(live, reading);
      const determinable = live.slice(0, CENSUS_WINDOW).filter((s) => contextDeterminable(s, reading)).length;
      expect(census.refused.length + determinable).toBe(census.sampled);
      const actedOn = await traceActedOn(census, live, sight);
      // Every acted-on refusal reaches the person who has to judge it. A count
      // whose list is shorter than the count is the unreconcilable number this
      // vault already records against `debt` and `rollup`.
      const report = formatUnknownContextCensus(`live vault (${path.basename(VAULT!)})`, census, actedOn);
      for (const a of actedOn) expect(report).toContain(a.refused.step.at!);
      printed += report + "\n";
    }
    // `where` can never refuse something `reproducible` lets through.
    const loose = new Set(censusUnknownContext(live, "where").refused.map((r) => r.step.ordinal));
    const strict = new Set(censusUnknownContext(live, "reproducible").refused.map((r) => r.step.ordinal));
    for (const o of loose) expect(strict.has(o), `step ${o} refused by \`where\` but not by \`reproducible\``).toBe(true);

    // The projection check. Over the steps the fixture and the live ledger share,
    // the refusal count must be identical, or the truncation PROVENANCE.md says
    // cannot move a count has moved one.
    const inFixture = new Set(fixture.map((s) => `${s.at}|${s.phase}`));
    const shared = live.filter((s) => inFixture.has(`${s.at}|${s.phase}`));
    expect(shared.length, "the committed projection shares no step with the live ledger").toBeGreaterThan(0);
    for (const reading of CONTEXT_READINGS as readonly ContextReading[]) {
      const refusedLive = shared.filter((s) => !contextDeterminable(s, reading)).length;
      const refusedFixture = fixture.filter((s) => !contextDeterminable(s, reading)).length;
      expect(refusedLive, `${reading}: the projection and the ledger disagree about what would be refused`).toBe(refusedFixture);
    }

    // eslint-disable-next-line no-console -- the current price, for the person re-reading the node against it.
    console.log(printed.trimEnd());
  });
});
