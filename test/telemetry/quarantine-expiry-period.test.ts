/**
 * The quarantine-expiry replay: had every exclusion this project ever typed
 * carried an expiry date, is there a single period that would have helped?
 *
 * The solution under test is "quarantine entries expire, so a workaround cannot
 * become permanent by inattention". The mechanism is a date beside an entry and
 * is trivial; the **period** is the whole risk, and it is empirical. The
 * assumption test beneath it fixed the bar before anything was swept: **one
 * period must fire after every recorded flake was resolved and before it was
 * forgotten, with zero firings against an unresolved flake.** That threshold is
 * written to require zero bad firings precisely so a thin sample fails rather
 * than flatters.
 *
 * ## This command being green does not mean the assumption held
 *
 * It came out **refuted**, and under both readings of the record rather than one.
 * The command is green because the sweep has been run and pinned, which is what
 * an instrument on a measurement can mean — the same convention
 * `test/friction/path-failure-attribution.test.ts` and
 * `test/telemetry/preflight-uncertainty-census.test.ts` run under, both of whose
 * censuses also came out against their solution and whose nodes are still
 * `#unvalidated`. Whoever reads this exit code must read `readings.meetsBar` with
 * it, which is why it is asserted `false` by name below rather than left to be
 * inferred from a table of periods.
 *
 * ## The controls are what carry this file
 *
 * A sweep that returned "premature" for everything would report this record
 * refuted no matter what was in it, and so would a bug in the date arithmetic.
 * So the planted cases below run first and in both directions: a set built to be
 * served by a period is served by one, and each of the three verdicts is shown
 * firing on a timeline built to carry it. Only then is the verdict over the real
 * record worth reading.
 *
 * The rule is `QUARANTINE_EXPIRY_RULE`, committed in
 * `src/telemetry/quarantine-expiry.ts`. This test asserts the shape of the rule
 * as well as its output, so a later edit shows up here as a changed expectation
 * rather than as a quietly different finding. The timelines are committed in
 * `test/fixtures/quarantine-expiry/`, and `PROVENANCE.md` there records where
 * every date came from and which three of them no machine could have read.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  fireAt,
  formatExpirySweep,
  PERMISSIVE_READING,
  QUARANTINE_EXPIRY_RULE,
  resolutionUnder,
  STRICT_READING,
  sweepExpiryPeriods,
  sweepReadings,
  type QuarantineTimeline,
} from "../../src/telemetry/quarantine-expiry.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "quarantine-expiry");

// ── the rule, before any period is swept against it ─────────────────────────

describe("the rule was committed before the record was replayed", () => {
  test("the hard clause is the one the assumption test fixed: zero firings on a live flake", () => {
    expect(QUARANTINE_EXPIRY_RULE.maxPrematureFirings).toBe(0);
    expect(QUARANTINE_EXPIRY_RULE.usefulOnEverySubject).toBe(true);
  });

  test("the sweep floor is one day, and the grid says so rather than discovering it", () => {
    // An expiry measured in minutes is a retry, not an expiring quarantine. The
    // floor is stated here so that `outlivingShortestPeriod` below is read as a
    // fact about the record rather than as an artefact of the grid.
    expect(QUARANTINE_EXPIRY_RULE.periodsDays[0]).toBe(1);
    expect([...QUARANTINE_EXPIRY_RULE.periodsDays]).toEqual([1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90]);
  });

  test("only an event counts as a resolution, and the two that are not carry their reason", () => {
    expect([...QUARANTINE_EXPIRY_RULE.countsAsResolved]).toEqual(["cause-fixed-in-commit", "cause-removed-from-suite"]);
    // The load-bearing exclusion. "Nobody mentioned it again" is the inattention
    // this candidate exists to defend against; scoring the candidate on it would
    // grade it against the outcome it is supposed to prevent.
    expect(QUARANTINE_EXPIRY_RULE.doesNotCount["record-ends"]).toContain("inattention the candidate exists to prevent");
    expect(QUARANTINE_EXPIRY_RULE.doesNotCount["declared-retired"]).toContain("no event under it");
  });
});

// ── the planted cases: the sweep fires, and it fails to fire ────────────────

function planted(over: Partial<QuarantineTimeline> & Pick<QuarantineTimeline, "file" | "quarantinedAt">): QuarantineTimeline {
  return {
    firstObservedAt: over.quarantinedAt,
    lastExcludedAt: over.quarantinedAt,
    exclusions: 1,
    sessions: 1,
    resolvedAt: null,
    resolutionEvidence: "none",
    resolutionCitation: "planted",
    forgottenAt: over.quarantinedAt,
    forgottenCitation: "planted",
    flake: true,
    priorResolutionClaims: [],
    note: "planted",
    ...over,
  };
}

const SERVED = [
  planted({
    file: "test/planted/a.test.ts",
    quarantinedAt: "2026-01-01T00:00:00.000Z",
    lastExcludedAt: "2026-01-01T01:00:00.000Z",
    resolvedAt: "2026-01-04T00:00:00.000Z",
    resolutionEvidence: "cause-fixed-in-commit",
    forgottenAt: "2026-01-20T00:00:00.000Z",
  }),
  planted({
    file: "test/planted/b.test.ts",
    quarantinedAt: "2026-02-01T00:00:00.000Z",
    lastExcludedAt: "2026-02-01T02:00:00.000Z",
    resolvedAt: "2026-02-03T00:00:00.000Z",
    resolutionEvidence: "cause-removed-from-suite",
    forgottenAt: "2026-02-25T00:00:00.000Z",
  }),
];

describe("a record a period would have served", () => {
  test("the sweep finds it, so a refutation below is a finding and not a broken sweep", () => {
    const sweep = sweepExpiryPeriods(SERVED, STRICT_READING);
    expect(sweep.meetsBar).toBe(true);
    expect(sweep.satisfyingPeriods).toEqual([3, 5, 7, 10, 14]);
    expect(sweep.bestUseful).toBe(2);
  });

  test("each of the three verdicts fires on a timeline built to carry it", () => {
    // Too early: the fix has not landed, so the test rejoins the suite and fails
    // again having changed nothing.
    expect(fireAt(SERVED[0], 1, STRICT_READING).verdict).toBe("premature");
    // On time: after the fix, while somebody is still paying attention.
    expect(fireAt(SERVED[0], 7, STRICT_READING).verdict).toBe("useful");
    // Too late: nothing goes red, because nothing is broken and nobody is there.
    expect(fireAt(SERVED[0], 30, STRICT_READING).verdict).toBe("late");
  });

  test("the firing date is the quarantine's own clock, not the calendar's", () => {
    expect(fireAt(SERVED[1], 3, STRICT_READING).firesAt).toBe("2026-02-04T00:00:00.000Z");
  });

  test("one unresolved subject in an otherwise served record kills every period", () => {
    // The threshold's zero-tolerance clause, shown biting on a case where the
    // rest of the sample is perfect. This is why the real record's single
    // unresolved flake is enough to decide the strict reading on its own.
    const live = planted({ file: "test/planted/c.test.ts", quarantinedAt: "2026-01-01T00:00:00.000Z" });
    const sweep = sweepExpiryPeriods([...SERVED, live], STRICT_READING);
    expect(sweep.meetsBar).toBe(false);
    // Every period that served the other two now carries this one's firing, and
    // the reason names the flake rather than the arithmetic.
    expect(sweep.periods.every((p) => p.firings[2].verdict === "premature")).toBe(true);
    expect(sweep.periods[4].firings[2].why).toContain("still unresolved");
  });

  test("an empty record reports UNREAD rather than a clean refutation", () => {
    const empty = sweepReadings([]);
    expect(empty.meetsBar).toBe(false);
    expect(formatExpirySweep(empty)).toContain("UNREAD");
  });
});

describe("what the readings do and do not concede", () => {
  const falsified = planted({
    file: "test/planted/d.test.ts",
    quarantinedAt: "2026-03-10T00:00:00.000Z",
    forgottenAt: "2026-04-10T00:00:00.000Z",
    priorResolutionClaims: [
      {
        at: "2026-03-01T00:00:00.000Z",
        evidence: "cause-fixed-in-commit",
        citation: "planted",
        falsifiedAt: "2026-03-10T00:00:00.000Z",
        falsifiedBy: "planted",
      },
    ],
  });

  test("a resolution the record took back is not a resolution, whatever class it was filed under", () => {
    // The claim is a `cause-fixed-in-commit`, which the strict reading admits as
    // a class — and it is still refused, because the disqualifying fact is the
    // falsification and not the evidence type.
    expect(resolutionUnder(falsified, STRICT_READING).resolvedAt).toBeNull();
    expect(fireAt(falsified, 7, STRICT_READING).verdict).toBe("premature");
  });

  test("…and the permissive reading is the one that takes the record at its word", () => {
    expect(resolutionUnder(falsified, PERMISSIVE_READING).resolvedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(fireAt(falsified, 7, PERMISSIVE_READING).verdict).toBe("useful");
  });
});

// ── the record this test exists to replay ───────────────────────────────────

/**
 * The committed timelines. `PROVENANCE.md` beside them records where every date
 * came from, which three of them no machine could have read, and how each
 * ambiguity was resolved in the candidate's favour.
 */
const timelines: QuarantineTimeline[] = fs
  .readFileSync(path.join(fixtureDir, "timelines.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as QuarantineTimeline);

describe("the subjects are the census's, not this replay's", () => {
  test("every quarantine the hand-exclusion census found is replayed, and nothing else is", () => {
    // The population is an output of `test/telemetry/hand-exclusion-census.test.ts`
    // over 657 session transcripts, not a list assembled here. If that census's
    // four distinct files change, this assertion fails before any verdict is read.
    const excluded = fs
      .readFileSync(path.join(repoRoot, "test", "fixtures", "hand-exclusion", "exclusions.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { subject: string; file?: string })
      .filter((e) => e.subject === "test-file")
      .map((e) => e.file!);
    expect([...new Set(excluded)].sort()).toEqual(timelines.map((t) => t.file).sort());
  });

  test("the mechanical dates match the corpus they were taken from", () => {
    const flake = timelines.find((t) => t.file === "test/mcp/wall-clock-budget.test.ts")!;
    expect(flake.quarantinedAt).toBe("2026-08-04T17:08:34.672Z");
    expect(flake.lastExcludedAt).toBe("2026-08-04T18:06:36.715Z");
    expect(flake.exclusions).toBe(10);
    expect(timelines.every((t) => t.sessions === 1)).toBe(true);
  });
});

describe("the sweep over the record", () => {
  const readings = sweepReadings(timelines);
  const { strict, permissive } = readings;

  test("one of the four quarantines was a flake at all", () => {
    // The other three are a subagent working around failures its own uncommitted
    // files were causing, three of them inside two minutes. They are replayed
    // because they are quarantines that happened; they are not evidence about
    // flakes, and nobody would have committed an entry for them.
    expect(strict.flakes).toBe(1);
    expect(timelines.filter((t) => t.flake).map((t) => t.file)).toEqual(["test/mcp/wall-clock-budget.test.ts"]);
  });

  test("no quarantine on record outlived a single day — the longest lasted 58 minutes", () => {
    // The number that decides more than the sweep does. Every entry on record was
    // opened and abandoned inside the session that opened it, so the permanence
    // this candidate exists to break is a state this record has never observed.
    expect(strict.longestQuarantineMinutes).toBe(58);
    expect(strict.gridFloorMinutes).toBe(1440);
    expect(strict.outlivingShortestPeriod).toBe(0);
  });

  test("the one real flake has no resolution event at all, so every period fires on a live flake", () => {
    // `test/mcp/wall-clock-budget.test.ts` is byte-identical to its first commit:
    // the absolute 2000ms bound both friction notes named as the root cause is
    // still the assertion in the suite. #138 built a same-run ratio instrument
    // beside it rather than repairing it.
    expect(strict.unresolved).toBe(1);
    expect(strict.periods.every((p) => p.premature === 1)).toBe(true);
    expect(strict.periods.every((p) => p.firings[0].verdict === "premature")).toBe(true);
  });

  test("the three that were resolved were resolved in under an hour, so every period is late on them", () => {
    // 40 to 46 minutes from the exclusion being typed to the commit that removed
    // the cause. A period short enough to land inside that window is not an
    // expiry, and one long enough to be an expiry lands after everyone moved on.
    expect(strict.periods.every((p) => p.late === 3)).toBe(true);
  });

  test("THE ASSUMPTION IS REFUTED — no period satisfies both clauses, under either reading", () => {
    expect(readings.meetsBar).toBe(false);
    expect(strict.satisfyingPeriods).toEqual([]);
    expect(permissive.satisfyingPeriods).toEqual([]);
    expect(formatExpirySweep(readings)).toContain("REFUTED");
  });

  test("…and the verdict does not turn on which reading an author picked", () => {
    // The strict reading refuses two classes and one falsified claim. If the
    // permissive reading — which concedes all of them — reached the bar, this
    // finding would be a fact about a definition. It does not.
    expect(readings.readingDecides).toBe(false);
    expect(strict.bestUseful).toBe(0);
    expect(permissive.bestUseful).toBe(1);
    expect(permissive.periods.filter((p) => p.useful === 1).map((p) => p.days)).toEqual([1, 2, 3, 5, 7, 10]);
  });

  test("the record asserted two resolution dates for the same flake and contradicted both", () => {
    // 2026-08-02: a pass called the flake retired after four clean runs, with no
    // code change, and seven later passes repeat that the call stands. 2026-08-03:
    // cc4ea95 fixed a real 3151ms-against-2000ms regression in this very test.
    // Ten hand exclusions on 2026-08-04 falsified both — and `git merge-base
    // --is-ancestor cc4ea95 c2f767d` exits 0, so the fix was already in the tree
    // that session was working in.
    expect(strict.falsifiedResolutionClaims).toBe(2);
    const flake = timelines.find((t) => t.flake)!;
    expect(flake.priorResolutionClaims.map((c) => c.evidence)).toEqual(["declared-retired", "cause-fixed-in-commit"]);
    expect(flake.priorResolutionClaims.every((c) => c.falsifiedAt === flake.quarantinedAt)).toBe(true);
    expect(formatExpirySweep(readings)).toContain("were later contradicted by it");
  });

  test("the report leads with the verdict and states the coverage under it", () => {
    const rendered = formatExpirySweep(readings);
    expect(rendered.startsWith("Quarantine expiry: REFUTED")).toBe(true);
    expect(rendered).toContain("Coverage: 4 quarantine(s) on record, 1 of them a flake");
    expect(rendered).toContain("Both readings agree");
  });
});
