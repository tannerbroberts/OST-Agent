/**
 * The instrument for "Count how many timed checks would run somewhere that
 * cannot guarantee isolation" — the assumption test beneath "Run the timed check
 * under isolation, or do not let it fail the build at all" in the meta vault.
 *
 * The bar the node fixed on 2026-08-03: **at least 50% of timed-check runs
 * happen somewhere isolation can be guaranteed**, weighted by how often checks
 * really run at each place rather than counted per location.
 *
 * **It came out REFUTED, at 34.0%.** Of the 11,939 timed-check executions this
 * project's record holds for the thirty days ending 2026-09-01, 4,059 are on a
 * GitHub-hosted runner and 7,880 are on the operator's laptop. Every weekly
 * sub-window lands between 30.2% and 36.5%, so the miss is not where the cut
 * fell, and the reading is 34.5% if filtered runs are dropped entirely and 17.2%
 * if every invocation is weighted equally instead — the verdict does not depend
 * on which of the three defensible units is chosen.
 *
 * **The corpus is an upper bound, not an estimate.** Terminal runs and
 * `ost-agent ship`'s own pre-merge gate leave no transcript, and both are
 * workstation runs; every discretionary choice at cut time was made in the
 * direction that flatters the assumption. See
 * `test/fixtures/timed-check-runs/PROVENANCE.md`.
 *
 * **What the refutation means for the row.** The solution's second clause — *or
 * do not let it fail the build at all* — is what applies wherever isolation
 * cannot be promised, and two thirds of this project's timed-check runs are
 * there. Building it converts the majority of runs of every timed check into an
 * advisory number, which the node's own "what would make this the wrong pick"
 * names as the failure: a number that cannot fail anything gets scrolled past
 * for months while the regression it watched for arrives. The siblings that
 * survive are the ones already standing —
 * `test/telemetry/same-run-baseline-ratio.test.ts` and
 * `test/telemetry/work-units-vs-elapsed.test.ts` — which make the measurement
 * robust to contention instead of moving away from it.
 *
 * **The census understates its own subject, and the run that verified it proved
 * so.** Ten files assert on elapsed time; every one of the 4,906 tests is also
 * under `testTimeout: 20000`, an absolute wall-clock bar with no relation to
 * what the test measures. Verifying this census took 959 s against a documented
 * 207–413 s range, and six tests in `test/ost/vault-merge-conflict-census.test.ts`
 * — a file that times nothing — failed on that timeout, while
 * `test/loop/inherited-tree-build-check.test.ts` failed its 30-second bar at
 * 38.264 s. Both on the laptop, both green alone. The share is unaffected (the
 * timeout applies everywhere alike), but the population a busy machine can
 * convict is the suite, not the ten.
 *
 * **And the sharpest number here is not the headline.** This repository already
 * isolates one check: `test/eval/calibration-ratio-stability.test.ts` is out of
 * the parallel suite and runs only when named. It ran 11 times in the window,
 * and all 11 were on the laptop — zero in the one place isolation is possible,
 * because the only thing CI runs is the suite the file is excluded from. The
 * mechanism the solution proposes, as this repository actually implements it,
 * produces a check that never runs where it could be trusted.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { SUITE_EXCLUSIONS } from "../../src/release/gates.declared.js";
import {
  CLOCK_MENTION_PATTERN,
  CLOCK_READING_TESTS,
  DURATION_ASSERTION_PATTERN,
  GATING_TIMED_CHECKS,
} from "../../src/release/timed-checks.declared.js";
import {
  ISOLATION_SHARE_BAR,
  RUN_LOCATIONS,
  isolationGuaranteed,
  isolationShare,
  suiteInvocations,
  type RecordedRun,
} from "../../src/release/timed-check-isolation.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test/fixtures/timed-check-runs");

interface Corpus {
  windowStart: string;
  windowEnd: string;
  repo: string;
  runs: (RecordedRun & { session?: string; command?: string })[];
}
const corpus = JSON.parse(fs.readFileSync(path.join(fixtureDir, "runs.json"), "utf8")) as Corpus;

const DAY_MS = 24 * 60 * 60 * 1000;
const SUITE_MS = 216_000;

/** Every test file in the repository, repo-relative and slash-separated. */
function testFiles(dir = path.join(repoRoot, "test")): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...testFiles(full));
    else if (entry.name.endsWith(".test.ts")) found.push(path.relative(repoRoot, full).split(path.sep).join("/"));
  }
  return found.sort();
}

describe("the census knows what a timed check is", () => {
  test("every file that reads a clock or asserts on a duration is classified, and nothing else is", () => {
    // The wide scans are the point: text matches, no parsing, so a measurement
    // cannot fall out of the census by hiding behind a helper. A new file with a
    // clock in it fails here until someone says which kind it is.
    const scanned = testFiles().filter((f) => {
      const source = fs.readFileSync(path.join(repoRoot, f), "utf8");
      return CLOCK_MENTION_PATTERN.test(source) || DURATION_ASSERTION_PATTERN.test(source);
    });
    expect(CLOCK_READING_TESTS.map((c) => c.file)).toEqual(scanned);
  });

  test("the second scan is what catches a check measured outside its own test file", () => {
    // Not a redundant assertion: `inherited-tree-build-check` is the reason the
    // second scan exists, and a future tightening of either pattern that drops
    // it would put this census back where it started — missing the most absolute
    // wall-clock bar in the repository because the file contains no clock.
    const source = fs.readFileSync(path.join(repoRoot, "test/loop/inherited-tree-build-check.test.ts"), "utf8");
    expect(CLOCK_MENTION_PATTERN.test(source)).toBe(false);
    expect(DURATION_ASSERTION_PATTERN.test(source)).toBe(true);
    expect(GATING_TIMED_CHECKS).toContain("test/loop/inherited-tree-build-check.test.ts");
  });

  test("the gating ten each hold an assertion on something timed", () => {
    for (const file of GATING_TIMED_CHECKS) {
      const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
      expect(CLOCK_MENTION_PATTERN.test(source) || DURATION_ASSERTION_PATTERN.test(source)).toBe(true);
      expect(source).toContain("expect(");
    }
    expect(GATING_TIMED_CHECKS).toHaveLength(10);
  });

  test("exactly one gating check is already outside the parallel suite", () => {
    const outside = GATING_TIMED_CHECKS.filter((c) => SUITE_EXCLUSIONS.includes(c));
    expect(outside).toEqual(["test/eval/calibration-ratio-stability.test.ts"]);
  });

  test("the suite's own per-test timeout is an absolute wall-clock bar over every test", () => {
    // The enumeration above counts the checks that assert on time. It is not the
    // population a busy machine can convict: `testTimeout` fails ANY test that
    // takes longer than 20 seconds, whatever it is asserting, and during the run
    // that verified this census six tests in
    // `test/ost/vault-merge-conflict-census.test.ts` — a file that measures
    // nothing — failed on it while the suite took 959 s against a documented
    // 207–413 s range. So the real subject of "Run the timed check under
    // isolation" is the whole suite, not ten files.
    //
    // It does not move the share: the timeout applies at every location alike,
    // so scaling the per-run check count scales both sides of the fraction.
    const config = fs.readFileSync(path.join(repoRoot, "vitest.config.ts"), "utf8");
    expect(config).toMatch(/testTimeout:\s*20000/);
    expect(config).toMatch(/hookTimeout:\s*20000/);
  });
});

describe("the rule reads no ledger", () => {
  // The same structural guarantee `src/loop/replayable.ts` carries: a rule with
  // no way to open the corpus it is scored against cannot have been fitted to
  // it. Weaker here than there, and the PROVENANCE says so — the exploratory
  // counts for this census were taken before the module was written, so what
  // protects the number is the bar being the node's own and every discretionary
  // choice running against the conclusion, not the order of two commits.
  const source = fs.readFileSync(path.join(repoRoot, "src/release/timed-check-isolation.ts"), "utf8");

  test("it imports no filesystem and names no fixture", () => {
    expect(source).not.toMatch(/from "node:fs"/);
    expect(source).not.toContain("fixtures");
    expect(source).not.toContain("runs.json");
  });
});

describe("suiteInvocations, on the shapes the record actually holds", () => {
  test("a bare run with a redirection is a whole-suite run", () => {
    expect(suiteInvocations("npx vitest run 2>&1 | tail -60")).toEqual([null]);
    expect(suiteInvocations("npm test -- --reporter=default")).toEqual([null]);
  });

  test("positionals are read until the first token that is not a test path", () => {
    expect(suiteInvocations("npx vitest run test/mcp/wall-clock-budget.test.ts 2>&1 | tail -5")).toEqual([
      ["test/mcp/wall-clock-budget.test.ts"],
    ]);
    expect(suiteInvocations("npx vitest run test/ost/ test/mcp/rule-parity.test.ts")).toEqual([
      ["test/ost/", "test/mcp/rule-parity.test.ts"],
    ]);
  });

  test("a command quoting a command is not a run", () => {
    // Both observed in this repository's own record: the commit messages state
    // what was verified, and they name the gate they ran.
    expect(suiteInvocations(`git commit -m "Verified: npx vitest run green at 4,726 tests"`)).toEqual([]);
    expect(
      suiteInvocations("git commit -F - <<'MSG'\nfix: something\n\nVerified: npx vitest run green.\nMSG"),
    ).toEqual([]);
  });

  test("it finds every invocation in a chained command, and only those", () => {
    expect(
      suiteInvocations("npx vitest run test/ost/dedupe-scale.test.ts; echo ok && npx vitest run 2>&1 | tail -5"),
    ).toEqual([["test/ost/dedupe-scale.test.ts"], null]);
    // `npm run bundle` shares a prefix with `npm run test` and is not a run.
    expect(suiteInvocations("npx tsc --noEmit && npm run bundle")).toEqual([]);
  });
});

describe("the corpus", () => {
  test("every run falls inside the declared window", () => {
    const start = Date.parse(corpus.windowStart);
    const end = Date.parse(corpus.windowEnd);
    expect(end - start).toBe(30 * DAY_MS);
    for (const run of corpus.runs) {
      const at = Date.parse(run.at);
      expect(at).toBeGreaterThanOrEqual(start);
      expect(at).toBeLessThan(end);
    }
  });

  test("nothing was filtered on the way in", () => {
    // A share is only as honest as its denominator, so the presence of every
    // class is asserted rather than assumed: both run shapes, all three recorded
    // sources.
    expect(corpus.runs.some((r) => r.filters === null)).toBe(true);
    expect(corpus.runs.some((r) => r.filters !== null)).toBe(true);
    for (const location of ["ci-github-hosted", "operator-workstation-unattended", "operator-workstation-interactive"]) {
      expect(corpus.runs.some((r) => r.location === location)).toBe(true);
    }
    expect(corpus.runs).toHaveLength(2628);
  });

  test("every run names a location the rule enumerates", () => {
    const known = new Set(RUN_LOCATIONS.map((l) => l.id));
    for (const run of corpus.runs) expect(known.has(run.location)).toBe(true);
  });

  test("one of the four locations the assumption test named holds no runs at all", () => {
    // The node's design says "local laptop, CI, scheduled pass, a contributor's
    // machine". Three of those exist here; the fourth is a location this
    // project has never had, because it has one contributor. Kept in
    // RUN_LOCATIONS rather than dropped, so the emptiness is visible.
    expect(corpus.runs.filter((r) => r.location === "contributor-workstation")).toHaveLength(0);
    expect(RUN_LOCATIONS.map((l) => l.id)).toContain("contributor-workstation");
  });
});

describe("the isolation rule", () => {
  test("only the ephemeral runner clears it, and 'unknown' counts against", () => {
    const isolable = RUN_LOCATIONS.filter(isolationGuaranteed).map((l) => l.id);
    expect(isolable).toEqual(["ci-github-hosted"]);
    const contributor = RUN_LOCATIONS.find((l) => l.id === "contributor-workstation")!;
    expect(contributor.foreignLoad).toBe("unknown");
    expect(isolationGuaranteed(contributor)).toBe(false);
  });

  test("the workstation's 'a second run can land beside this one' is recorded, not assumed", () => {
    // The classification does not rest on this — the foreign load that actually
    // convicted a check here was the rest of a laptop, which no transcript
    // measures. But the weaker claim is checkable, and it checks out: whole-suite
    // workstation runs that started while a DIFFERENT session's run was still in
    // flight, at this suite's real 216s runtime.
    const local = corpus.runs
      .filter((r) => r.location !== "ci-github-hosted")
      .map((r) => ({ at: Date.parse(r.at), session: r.session, full: r.filters === null }));
    const overlapping = local.filter(
      (run) => run.full && local.some((o) => o.session !== run.session && Math.abs(o.at - run.at) < SUITE_MS),
    );
    expect(overlapping.length).toBe(24);
    expect(local.filter((r) => r.full)).toHaveLength(856);
  });
});

describe("THE ASSUMPTION IS REFUTED", () => {
  const report = isolationShare(corpus.runs, GATING_TIMED_CHECKS);

  test("34.0% of timed-check runs happen where isolation could be guaranteed, against a 50% bar", () => {
    expect(report.total).toBe(11_939);
    expect(report.isolated).toBe(4059);
    expect(report.share).toBeCloseTo(0.34, 2);
    expect(report.share).toBeLessThan(ISOLATION_SHARE_BAR);
    expect(report.clearsBar).toBe(false);
  });

  test("two thirds of them are on the laptop, and most of that is the unattended loop", () => {
    expect(report.byLocation).toEqual({
      "ci-github-hosted": 4059,
      "operator-workstation-unattended": 6566,
      "operator-workstation-interactive": 1314,
      "contributor-workstation": 0,
    });
  });

  test("no weekly sub-window clears the bar either", () => {
    const start = Date.parse(corpus.windowStart);
    const weekly: number[] = [];
    for (let week = 0; week < 4; week += 1) {
      const from = start + week * 7 * DAY_MS;
      const runs = corpus.runs.filter((r) => {
        const at = Date.parse(r.at);
        return at >= from && at < from + 7 * DAY_MS;
      });
      weekly.push(isolationShare(runs, GATING_TIMED_CHECKS).share);
    }
    expect(weekly.every((share) => share < ISOLATION_SHARE_BAR)).toBe(true);
    expect(Math.min(...weekly)).toBeCloseTo(0.302, 2);
    expect(Math.max(...weekly)).toBeCloseTo(0.365, 2);
  });

  test("the verdict does not depend on the unit, and the enumeration barely moves it", () => {
    // Three defensible units for "how often checks run there", because the node
    // does not name one:
    //   1. executions, weighted by which checks a run actually runs — 34.0%;
    //   2. whole-suite runs only, dropping every filtered run — 34.5%;
    //   3. invocations, each weighted the same — 17.2%.
    // The first two barely differ because 176 of 11,939 executions come from a
    // named file, which is also why the hand-made classification in
    // `timed-checks.declared.ts` cannot decide this: a full-suite run executes
    // every in-suite check, so moving one between kinds scales both sides.
    const wholeSuite = corpus.runs.filter((r) => r.filters === null);
    const wholeSuiteShare = isolationShare(wholeSuite, GATING_TIMED_CHECKS).share;
    expect(wholeSuiteShare).toBeCloseTo(0.345, 3);

    const byInvocation =
      corpus.runs.filter((r) => r.location === "ci-github-hosted").length / corpus.runs.length;
    expect(byInvocation).toBeCloseTo(0.172, 3);

    for (const share of [wholeSuiteShare, byInvocation]) expect(share).toBeLessThan(ISOLATION_SHARE_BAR);
  });

  test("the one classification the verdict turns on, stated so a reader can weigh it", () => {
    // Reclassifying the unattended workstation as isolable — on the argument
    // that the loop's lock controls the machine — clears the bar at 89%. It is
    // the only single change to the rule that does, which is why PROVENANCE.md
    // argues that one classification at length and this test names the price of
    // being wrong about it.
    const asIsolable = RUN_LOCATIONS.map((l) =>
      l.id === "operator-workstation-unattended"
        ? { ...l, foreignLoad: "impossible" as const, concurrentRunsOnOneMachine: "impossible" as const }
        : l,
    );
    const optimistic = isolationShare(corpus.runs, GATING_TIMED_CHECKS, asIsolable);
    expect(optimistic.share).toBeCloseTo(0.89, 2);
    expect(optimistic.clearsBar).toBe(true);
  });

  test("the one check this repository already isolates never runs where isolation is possible", () => {
    // `test/eval/calibration-ratio-stability.test.ts` is out of the parallel
    // suite (SUITE_EXCLUSIONS) and reachable only by name. CI runs `npm test`
    // and nothing else, so every run of it is a laptop run — the mechanism the
    // solution proposes, as implemented here, moves a check out of contention
    // and out of the isolable location at the same time.
    const named = corpus.runs.filter(
      (r) => r.filters !== null && r.filters.some((f) => "test/eval/calibration-ratio-stability.test.ts".includes(f)),
    );
    expect(named).toHaveLength(11);
    expect(named.every((r) => r.location !== "ci-github-hosted")).toBe(true);
  });
});
