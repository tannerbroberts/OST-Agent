/**
 * Every test file in this repository that reads a clock, and what its verdict
 * actually depends on.
 *
 * This is the *subject* half of the census beneath "Run the timed check under
 * isolation, or do not let it fail the build at all". The census asks what share
 * of timed-check runs happen somewhere isolation could be guaranteed; before it
 * can weight anything it has to know which checks are timed, and "timed" is not
 * a property a regular expression can read off a file. `Date.now()` appears in
 * this suite as a date fixture, as a poll deadline, inside a comment explaining
 * why it is NOT used, and — in eight files — as the measurement a `expect()`
 * decides on. Only the last kind can be convicted by a busy machine.
 *
 * **Why a declaration rather than a detector.** A detector would have to trace a
 * subtraction of two clock reads through local variables, helper functions and
 * derived ratios into an assertion. The first draft of this file tried; it
 * missed `test/mcp/wall-clock-budget.test.ts` (whose elapsed time reaches the
 * assertion through `Math.min` and a struct field) and convicted
 * `test/telemetry/log-only-friction-recall.test.ts` (whose `old` is a
 * *timestamp*, not a duration). What is committed instead is the classification
 * itself, as data a reader can check against the file in one look, plus a scan
 * wide enough that nothing can hide from it: every file mentioning a clock at
 * all is listed here, and `test/release/timed-check-isolation-share.test.ts`
 * fails the build when the scan and this list disagree. A new timed check is
 * then a compile-time-visible decision rather than a silent omission from a
 * census.
 *
 * **The classification does not decide the census.** It is worth saying plainly,
 * because a hand-made list inside a measurement is exactly where a thumb goes on
 * a scale. Every check named here runs inside the same `npx vitest run` as every
 * other, so a full-suite run at a location executes all of them and moving a
 * file between {@link TimedCheckKind}s scales the numerator and denominator of
 * the share together. Only the handful of runs that NAME a file on the command
 * line are sensitive to it, and the instrument asserts the verdict survives
 * dropping those runs entirely.
 */

/** What a clock-reading test's pass/fail actually turns on. */
export type TimedCheckKind =
  /** An `expect()` on how long something took. A busy machine can fail it. */
  | "gating-wall-clock"
  /** An `expect()` on a real elapsed time with no upper bound — `>= 0` and the like. */
  | "measured-but-unbounded"
  /** The clock supplies a date or an age; the verdict is the same at any speed. */
  | "clock-fixture"
  /** A poll deadline: fails when something never happens, not when it is slow. */
  | "liveness-timeout"
  /**
   * The clock is read and printed, and no `expect()` reads the number.
   *
   * Distinct from `mentions-only`, which does not read a clock at all, and from
   * `measured-but-unbounded`, which asserts on the elapsed time and merely sets
   * no ceiling. Here the elapsed time reaches a human through a failure message
   * and reaches no assertion, which is the shape "State timing gates as work
   * completed rather than wall-clock" asks for: report the measurement, decide
   * on something load cannot move.
   */
  | "reported-not-asserted"
  /** The file only talks about the clock — in a comment, or in a string. */
  | "mentions-only";

/** One clock-reading test file, classified. */
export interface DeclaredTimedCheck {
  /** Repository-relative path, as vitest prints it. */
  readonly file: string;
  readonly kind: TimedCheckKind;
  /** What the assertion is made against, for the gating ones. */
  readonly statistic?: "absolute-budget" | "same-run-ratio";
  /** Why it is in this class, checkable against the file in one look. */
  readonly why: string;
}

/**
 * Every `test/**\/*.test.ts` that mentions a clock or asserts on a duration, in
 * path order.
 *
 * The scans that produce the left-hand side of this list are deliberately the
 * widest available — text matches, no parsing — because their job is to make
 * omission impossible rather than to classify. Everything interesting happens in
 * the `kind` column.
 *
 * **Two scans, because one was not enough, and the miss was found the hard way.**
 * The first draft scanned for clock reads in the test file only. It listed 29
 * files and missed `test/loop/inherited-tree-build-check.test.ts`, whose
 * `expect(r.seconds).toBeLessThan(30)` is as absolute a wall-clock bar as this
 * repository has — the elapsed time is measured inside `src/loop/`, so the test
 * file contains no clock read at all. It surfaced by failing at 38.264 s during
 * the very suite run that was verifying this census, on a contended laptop.
 * {@link DURATION_ASSERTION_PATTERN} is the second net, and the finding stands
 * as a caveat on both: a check whose measurement AND whose threshold both live
 * in `src/` would still be invisible here.
 */
export const CLOCK_READING_TESTS: readonly DeclaredTimedCheck[] = [
  {
    file: "test/adapters/channels.test.ts",
    kind: "clock-fixture",
    why: "`const now = Date.now()` is passed in as the channel-health clock; every assertion is about a cadence verdict",
  },
  {
    file: "test/adapters/digest-delivery.test.ts",
    kind: "clock-fixture",
    why: "`cadenceMs` is an input to the cadence verdict; the assertions are on the status it returns",
  },
  {
    file: "test/adapters/ingest-backpressure-provenance.test.ts",
    kind: "gating-wall-clock",
    statistic: "absolute-budget",
    why: "asserts `elapsedMs` for a burst ingest is under a fixed BUDGET_MS",
  },
  {
    file: "test/adapters/mirror-staleness.test.ts",
    kind: "clock-fixture",
    why: "`ageMs` is the distance between two fixed timestamps, not a measurement of the run",
  },
  {
    file: "test/adapters/transcript.test.ts",
    kind: "clock-fixture",
    why: "builds a transcript entry `ageMinutes` old so the quiet-window rule has something to read",
  },
  {
    file: "test/cli/channels.test.ts",
    kind: "clock-fixture",
    why: "back-dates saved cursors by whole days to exercise the staleness verdict",
  },
  {
    file: "test/eval/attention.test.ts",
    kind: "clock-fixture",
    why: "the `ms` fields it asserts on are numbers written into the usage fixtures it rolls up",
  },
  {
    file: "test/eval/calibration-ratio-stability.test.ts",
    kind: "gating-wall-clock",
    statistic: "same-run-ratio",
    why: "times a subject against a calibration workload under planted CPU load and asserts the ratio separates them; excluded from the suite by SUITE_EXCLUSIONS and reachable only by name",
  },
  {
    file: "test/eval/suspect-source.test.ts",
    kind: "mentions-only",
    why: "a comment recording that `appendObservation` takes its clock as an argument, so no clock read reaches the file",
  },
  {
    file: "test/gate/operation-budget.test.ts",
    kind: "reported-not-asserted",
    why:
      "times its idle and saturated legs and puts both figures in the failure message; every `expect()` is on an operation count, so full CPU saturation is applied on purpose and still cannot move the verdict",
  },
  {
    file: "test/git/hand-edit-detector.test.ts",
    kind: "mentions-only",
    why: "a comment on a fixed epoch-seconds fixture, saying there is no `Date.now()` here",
  },
  {
    file: "test/git/stale-lock-recovery.test.ts",
    kind: "liveness-timeout",
    why: "polls until a holder process exits with a 10s deadline; the verdict is whether it exited, and the deadline only bounds the wait",
  },
  {
    file: "test/knowledge/actor-trust.test.ts",
    kind: "mentions-only",
    why: "a header comment explaining why trust folds take a fixed clock",
  },
  {
    file: "test/knowledge/corrections-file-size.test.ts",
    kind: "mentions-only",
    why: "a comment on a fixed date fixture, contrasting it with `Date.now()`",
  },
  {
    file: "test/loop/cadence.test.ts",
    kind: "clock-fixture",
    why: "`cadenceMs` and `now` are both handed to `evaluateCadence`; the assertions are on its status",
  },
  {
    file: "test/loop/checkpoint-update.test.ts",
    kind: "clock-fixture",
    why: "`ttlMs` and `now` are inputs inside the `expect(...)` call; the assertion is on the action taken",
  },
  {
    file: "test/loop/corrections-ledger.test.ts",
    kind: "mentions-only",
    why: "a comment recording that a fixture used to be `Date.now()` and no longer is",
  },
  {
    file: "test/loop/degraded-pass-reporting.test.ts",
    kind: "clock-fixture",
    why: "stamps a run record as started a minute ago so the degradation verdict has an age to read",
  },
  {
    file: "test/loop/discovery-budget-reserved.test.ts",
    kind: "clock-fixture",
    why: "places ledger entries a fixed number of hours before and after now",
  },
  {
    file: "test/loop/early-push-collision-window.test.ts",
    kind: "clock-fixture",
    why: "`rejectionDelayMs` is reconstructed from a committed corpus of recorded pushes, not timed here",
  },
  {
    file: "test/loop/inherited-tree-build-check.test.ts",
    kind: "gating-wall-clock",
    statistic: "absolute-budget",
    why:
      "asserts the real check on this repository finishes in under 30 seconds — the elapsed time is measured in `src/loop/`, so nothing in the test file reads a clock, which is exactly how the first draft of this census missed it",
  },
  {
    file: "test/loop/lock.test.ts",
    kind: "clock-fixture",
    why: "hands `staleness` an explicit `now`, including `now + TTL`, to drive the stale/held verdict",
  },
  {
    file: "test/loop/preflight-parity.test.ts",
    kind: "clock-fixture",
    why: "back-dates ledger lines by whole hours",
  },
  {
    file: "test/loop/prior-art-scan-catches-recorded-collision.test.ts",
    kind: "clock-fixture",
    why: "`atMs` is parsed from the fixed dates of a recorded collision",
  },
  {
    file: "test/loop/question-budget.test.ts",
    kind: "clock-fixture",
    why: "`sinceMs` is a window bound passed in; the assertions are on the interruptions counted",
  },
  {
    file: "test/loop/sense-census-report.test.ts",
    kind: "clock-fixture",
    why: "builds a cutoff one millisecond in the future so nothing is filtered by time",
  },
  {
    file: "test/loop/stall-definition-replay.test.ts",
    kind: "clock-fixture",
    why: "every instant is an offset read off the recorded corpus — no clock is read, and the verdict is the same at any speed",
  },
  {
    file: "test/loop/wait-primitive-affordance.test.ts",
    kind: "gating-wall-clock",
    statistic: "absolute-budget",
    why: "asserts a blocking wait returned in less than the default poll interval — an `expect()` on elapsed wall clock",
  },
  {
    file: "test/loop/work-source-census.test.ts",
    kind: "liveness-timeout",
    why: "one test registers a real `fs.watch` and polls until it fires with a 10s deadline; the verdict is whether the watcher saw the write at all, and the deadline only bounds the wait",
  },
  {
    file: "test/mcp/s1-self-feeding.test.ts",
    kind: "clock-fixture",
    why: "ages inbox items and dates by hours and days",
  },
  {
    file: "test/mcp/suspect-source-work.test.ts",
    kind: "mentions-only",
    why: "a comment saying a planted history is used and no clock read reaches the file",
  },
  {
    file: "test/mcp/wall-clock-budget.test.ts",
    kind: "gating-wall-clock",
    statistic: "absolute-budget",
    why: "the Z3 criterion itself: fastest-of-N elapsed for two tools, each asserted under a fixed BUDGET_MS — the check that failed at 2004ms inside the suite and passed alone",
  },
  {
    file: "test/ost/dedupe-scale.test.ts",
    kind: "gating-wall-clock",
    statistic: "same-run-ratio",
    why: "asserts the indexed path beats the reference path 20x in the same process, and that the reference is slow enough to measure against",
  },
  {
    file: "test/ost/writing-version-recoverable.test.ts",
    kind: "clock-fixture",
    why: "`staleByMs` is the gap between two fixture timestamps",
  },
  {
    file: "test/runner/context.test.ts",
    kind: "clock-fixture",
    why: "builds a two-hour-old timestamp for a quiet-window check",
  },
  {
    file: "test/runner/flake-attribution.test.ts",
    kind: "gating-wall-clock",
    statistic: "same-run-ratio",
    why: "measures a real phase against an interleaved control probe and asserts the attribution the pair produces; the calibration in `beforeAll` is itself timed",
  },
  {
    file: "test/runner/per-run-workspace-cost.test.ts",
    kind: "gating-wall-clock",
    statistic: "same-run-ratio",
    why: "asserts a per-run workspace costs no more than MAX_OVERHEAD times a warm one, both timed in the same process",
  },
  {
    file: "test/skill/skeleton-validity.test.ts",
    kind: "mentions-only",
    why: "`Date.now()` appears inside a string literal that mutates the skeleton to prove the parser rejects it",
  },
  {
    file: "test/telemetry/export-requires-consent.test.ts",
    kind: "mentions-only",
    why: "a comment on the fixed clock, naming `Date.now()` as the flakiness CONTRIBUTING.md warns about",
  },
  {
    file: "test/telemetry/log-only-friction-recall.test.ts",
    kind: "clock-fixture",
    why: "`old` is a timestamp an hour in the past, not a duration; the assertions are about which events are recalled",
  },
  {
    file: "test/telemetry/same-run-baseline-ratio.test.ts",
    kind: "gating-wall-clock",
    statistic: "same-run-ratio",
    why: "times subject and baseline interleaved in the same run and asserts the median ratio separates a planted regression from contention",
  },
  {
    file: "test/telemetry/usage.test.ts",
    kind: "measured-but-unbounded",
    why:
      "`expect(event.ms).toBeGreaterThanOrEqual(0)` is a real elapsed time with no upper bound, so no amount of contention can convict it",
  },
  {
    file: "test/telemetry/work-units-vs-elapsed.test.ts",
    kind: "gating-wall-clock",
    statistic: "same-run-ratio",
    why: "asserts the spread of ms-per-work-unit across vault sizes stays under a committed bound",
  },
];

/**
 * The first text scan the declaration is held to.
 *
 * Wide on purpose: a mention inside a comment is enough to require an entry, so
 * a file cannot fall out of the census by hiding its measurement behind a helper
 * in the same file.
 */
export const CLOCK_MENTION_PATTERN = /(?:Date|performance)\.now\(\)/;

/**
 * The second, for the checks whose measurement is taken somewhere else.
 *
 * An `expect()` naming a duration — `…Ms`, `ms`, `seconds`, `elapsed…`,
 * `duration…` — regardless of where the number came from. It is noisy by design
 * and most of what it catches is a fixture; catching
 * `test/loop/inherited-tree-build-check.test.ts`, whose seconds are measured in
 * `src/loop/`, is what it is for.
 */
export const DURATION_ASSERTION_PATTERN =
  /expect\([^)]*(\b[a-z][a-zA-Z]*Ms\b|\bms\b|\bseconds\b|\belapsed[A-Za-z]*\b|\bduration[A-Za-z]*\b)/;

/** The files whose verdict an `expect()` computes from elapsed wall-clock time. */
export const GATING_TIMED_CHECKS: readonly string[] = CLOCK_READING_TESTS.filter(
  (c) => c.kind === "gating-wall-clock",
).map((c) => c.file);
