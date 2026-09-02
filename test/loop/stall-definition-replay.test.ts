/**
 * The instrument for the meta vault's assumption test "Replay historical runs
 * against a stall definition" (beneath "Supervisor heartbeat with automatic
 * restart") — read `test/fixtures/stall-definition/PROVENANCE.md` before
 * believing anything here.
 *
 * The pre-committed threshold is a confusion matrix over runs that already
 * happened: **every known stall detected AND zero false alarms on the healthy
 * runs.** Those two halves are not equally measurable against this corpus and
 * the difference is the finding, so they are asserted separately and named for
 * what each one actually rests on:
 *
 *   - the false-alarm half is measured against 282 real firings that
 *     demonstrably moved the tree, at every instant of every one of their
 *     lives;
 *   - the detection half has **no observed positive to measure against** — the
 *     corpus contains no run any recorder ever labelled stalled — so it is
 *     measured against reconstructed deaths of real firings, which is weaker
 *     and is asserted as such.
 *
 * The last two cases are the ones that would catch this instrument being bent
 * to fit: one pins the zero-positives fact so the day a real stall lands in the
 * record it fails, and one disconfirms the definition the journal alone would
 * support.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessRunLiveness,
  lastProgressAtMs,
  longestLiveSilenceMs,
  observeOpenRun,
  observedStalls,
  treeMovingRuns,
  truncateAtMark,
  PROGRESS_SILENCE_BUDGET_MS,
  type ProgressMark,
  type RecordedOutcome,
  type RecordedRun,
} from "../../src/loop/liveness.js";

interface HarvestedRun {
  runId: string;
  outcome: RecordedOutcome;
  startedAtMs: number;
  sealedAfterMs?: number;
  marks: [string, number][];
}

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/stall-definition/runs.json"), "utf8"),
) as { vault: string; runs: HarvestedRun[] };

/** Offsets back to absolute times — the fixture stores them relative to keep the corpus small. */
function rehydrate(raw: HarvestedRun, kinds: ProgressMark["kind"][] = ["journal", "commit"]): RecordedRun {
  const marks = raw.marks
    .map(([code, offset]) => ({ kind: code === "j" ? "journal" : "commit", atMs: raw.startedAtMs + offset }) as ProgressMark)
    .filter((m) => kinds.includes(m.kind));
  return {
    runId: raw.runId,
    outcome: raw.outcome,
    startedAtMs: raw.startedAtMs,
    ...(raw.sealedAfterMs !== undefined ? { sealedAtMs: raw.startedAtMs + raw.sealedAfterMs } : {}),
    marks,
  };
}

const corpus = fixture.runs.map((r) => rehydrate(r));
const moving = treeMovingRuns(corpus);
const minutes = (ms: number): number => Math.round((ms / 60_000) * 10) / 10;

/**
 * Every instant at which the silence of a live run peaks — the moment just
 * before each mark, and the moment just before the seal. Between two marks the
 * assessment is monotone in `now`, so a run that is not flagged at any of these
 * was not flagged at any instant of its life.
 */
function peakInstants(run: RecordedRun): number[] {
  const instants = run.marks.map((m) => m.atMs - 1);
  if (run.sealedAtMs !== undefined) instants.push(run.sealedAtMs - 1);
  return instants.filter((t) => t >= run.startedAtMs);
}

describe("the corpus this replays", () => {
  it("is the whole recorded ledger, not a cut of it", () => {
    expect(corpus.length).toBe(369);
    expect(moving.length).toBe(282);
  });
});

describe("zero false alarms — the half the record can settle", () => {
  it("never calls a firing stalled at any instant of a life that moved the tree", () => {
    const falseAlarms = moving.flatMap((run) =>
      peakInstants(run)
        .map((now) => ({ run, now, verdict: assessRunLiveness(run, now) }))
        .filter(({ verdict }) => verdict.state === "stalled")
        .map(({ run: r, verdict }) => `${r.runId} after ${minutes(verdict.silenceMs)}min of silence`),
    );
    expect(falseAlarms).toEqual([]);
  });

  it("never calls a sealed firing stalled, however long ago it sealed", () => {
    const aYearLater = 365 * 24 * 60 * 60_000;
    const states = corpus
      .filter((run) => run.sealedAtMs !== undefined)
      .map((run) => assessRunLiveness(run, run.sealedAtMs! + aYearLater).state);
    expect(new Set(states)).toEqual(new Set(["sealed"]));
  });

  it("is calibrated above the longest live silence in the record, so the margin is structural", () => {
    // Not "it happened to pass": the budget must clear the worst case the
    // corpus contains, which is what makes the case above a consequence rather
    // than a coincidence. A corpus that grows a longer live silence fails here
    // first, before it can turn into a false alarm in the field.
    const worst = Math.max(...moving.map(longestLiveSilenceMs));
    expect(minutes(worst)).toBe(95.3);
    expect(PROGRESS_SILENCE_BUDGET_MS).toBeGreaterThan(worst);
  });
});

describe("detection — the half with no observed positive", () => {
  it("flags a real firing's reconstructed death once the budget elapses", () => {
    const undetected = moving
      .filter((run) => run.marks.length > 0)
      .map((run) => {
        const dead = truncateAtMark(run, run.marks.length - 1);
        const lastMark = dead.marks[dead.marks.length - 1].atMs;
        return { dead, verdict: assessRunLiveness(dead, lastMark + PROGRESS_SILENCE_BUDGET_MS + 1) };
      })
      .filter(({ verdict }) => verdict.state !== "stalled")
      .map(({ dead }) => dead.runId);
    expect(undetected).toEqual([]);
  });

  it("flags a death that happens before the firing produced anything at all", () => {
    // The mark list is empty, so the silence is measured from the run's own
    // start — the case a definition keyed on "the last mark" would divide by
    // zero on, and the shape of a pass that hung before its first tool call.
    const [first] = moving;
    const dead = truncateAtMark(first, -1);
    expect(dead.marks).toEqual([]);
    expect(lastProgressAtMs(dead, dead.startedAtMs + PROGRESS_SILENCE_BUDGET_MS)).toBe(dead.startedAtMs);
    expect(assessRunLiveness(dead, dead.startedAtMs + PROGRESS_SILENCE_BUDGET_MS + 1).state).toBe("stalled");
  });

  it("does not flag a reconstructed death one millisecond before the budget is spent", () => {
    const states = moving
      .filter((run) => run.marks.length > 0)
      .map((run) => {
        const dead = truncateAtMark(run, run.marks.length - 1);
        const lastMark = dead.marks[dead.marks.length - 1].atMs;
        return assessRunLiveness(dead, lastMark + PROGRESS_SILENCE_BUDGET_MS).state;
      });
    expect(new Set(states)).toEqual(new Set(["alive"]));
  });

  it("has no observed stall to measure against, and says so rather than passing quietly", () => {
    // The pre-committed threshold says "every known stall detected". In this
    // corpus there are none to detect: no `crashed` verdict, no unsealed run.
    // A test that reported that half as satisfied would be reporting a green
    // earned by an empty set, so the count is pinned instead. When a real stall
    // lands in the record this fails, and whoever re-cuts the corpus has to
    // face the sensitivity question with an actual positive in hand.
    expect(observedStalls(corpus).map((r) => r.runId)).toEqual([]);
  });
});

describe("the live reading — what `loop status` assembles from disk", () => {
  const open = { runId: "2026-09-01T00-00-00.000Z-loop", startedAt: "2026-09-01T00:00:00.000Z" };
  const startedAtMs = Date.parse(open.startedAt);

  it("takes journal lines for this run and commits, in time order", () => {
    const observed = observeOpenRun(
      open,
      [
        { runId: open.runId, at: "2026-09-01T00:20:00.000Z" },
        // Another run's line. A watchdog that counted it would read a dead run
        // as alive on the strength of its successor's progress.
        { runId: "2026-08-31T00-00-00.000Z-loop", at: "2026-09-01T00:40:00.000Z" },
      ],
      [startedAtMs + 10 * 60_000],
    )!;
    expect(observed.marks).toEqual([
      { kind: "commit", atMs: startedAtMs + 10 * 60_000 },
      { kind: "journal", atMs: startedAtMs + 20 * 60_000 },
    ]);
    expect(observed.sealedAtMs).toBeUndefined();
  });

  it("refuses a marker whose start does not parse rather than inventing one", () => {
    expect(observeOpenRun({ runId: "x", startedAt: "not a date" }, [], [])).toBeNull();
  });

  it("reads a run alive off a commit that arrived after the journal went quiet", () => {
    // The whole point of folding commits in: the journal's last line is the
    // `open` at t=0, so on journal evidence alone this run has been silent for
    // 110 minutes and is nearly over budget.
    const observed = observeOpenRun(open, [{ runId: open.runId, at: open.startedAt }], [startedAtMs + 100 * 60_000])!;
    const now = startedAtMs + 110 * 60_000;
    expect(assessRunLiveness(observed, now).state).toBe("alive");
    expect(assessRunLiveness({ ...observed, marks: observed.marks.filter((m) => m.kind === "journal") }, now).silenceMs).toBe(
      110 * 60_000,
    );
  });
});

describe("what the definition rests on", () => {
  it("cannot be carried by journal lines alone — commits are what make the populations separable", () => {
    // The disconfirmer. Strip commits and the only marks left are `open`, the
    // one `step` line the pass writes when it exits, and `seal` — nothing
    // during the work. The longest silence in a firing that moved the tree
    // then exceeds the budget outright, so the same definition on journal
    // lines alone raises false alarms on real healthy work; and its worst case
    // (244.6 min) sits above the worst case of the firings that failed
    // measured the same way, which is what "these two populations are not
    // separable by this measurement" means.
    const journalOnly = fixture.runs.map((r) => rehydrate(r, ["journal"]));
    const movingJournalOnly = treeMovingRuns(journalOnly);
    const worstJournalOnly = Math.max(...movingJournalOnly.map(longestLiveSilenceMs));

    expect(minutes(worstJournalOnly)).toBe(244.6);
    expect(worstJournalOnly).toBeGreaterThan(PROGRESS_SILENCE_BUDGET_MS);

    const falseAlarms = movingJournalOnly.filter((run) =>
      peakInstants(run).some((now) => assessRunLiveness(run, now).state === "stalled"),
    );
    expect(falseAlarms.length).toBeGreaterThan(0);
  });

  it("would have flagged four firings that were open at the time and produced nothing", () => {
    // What the definition buys, stated as a number rather than as a claim.
    // These are firings the ledger recorded as `unhealthy` — the record does
    // not say they were stalled, and this test does not either. It says the
    // watchdog would have raised a report about them while they were still
    // running, which is the whole of what a green here licenses.
    const wouldHaveReported = corpus
      .filter((run) => run.outcome === "unhealthy")
      .filter((run) => peakInstants(run).some((now) => assessRunLiveness(run, now).state === "stalled"))
      .map((run) => run.runId);
    expect(wouldHaveReported).toEqual([
      "2026-08-16T06-45-07.282Z-loop",
      "2026-08-21T07-19-20.684Z-loop",
      "2026-08-25T19-41-55.314Z-loop",
      "2026-08-26T23-40-02.904Z-loop",
    ]);
  });
});
