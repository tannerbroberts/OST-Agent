/**
 * "Try to bound five past runs within the commit history without being told
 * where they started" — the assumption test beneath "Reconstruct what finished
 * from the commit history, so no run has to be trusted to report", in the meta
 * vault.
 *
 * The assumption is a feasibility claim, and the node states it as a doubt:
 * **one run's commits can be separated from everything else in the log** —
 * "distinguishing them from a concurrent run's, or from a human's, is not
 * obviously solvable from git alone." The pre-committed bar is **at least 4 of 5
 * runs bounded correctly from the history alone**, and nothing in this file may
 * move it.
 *
 * ## What is being compared with what
 *
 * The measurement only means something because the two sides read the same runs
 * through deliberately unequal windows:
 *
 * - **The rule** (`src/loop/run-boundary.ts`) sees `git log` — sha, subject,
 *   author, author date, committer date. No diff, no journal, no run record,
 *   nothing any run wrote about itself.
 * - **The labels** (`test/fixtures/run-boundary/`) are cut from the Claude Code
 *   session transcripts that drove those runs, a record git has never seen. A
 *   discovery pass's extent is the set of commits whose subject names the tool
 *   its transcript recorded calling at that second; a build firing's is the set
 *   of loop commits inside its builder session's transcript window.
 *
 * The measured result is **317 of 319 runs** over 1,500 commits, against 27.0%
 * for the reading the solution node proposes — arrival time alone — and 83.7%
 * for the best actor-split-plus-gap rule. `test/fixtures/run-boundary/PROVENANCE.md`
 * carries the full table, the two misses by name, and what the cut dropped.
 *
 * The test node's design says to hand the history to a *second person*. Nobody
 * was asked. A program was written instead, which the design itself says is the
 * weaker direction — "a person doing this by eye may use cues a program could
 * not, so success here is an upper bound on what an automated reconstruction
 * would achieve." A green run here is therefore a *lower* bound on the same
 * question, which is the direction that can be acted on: the program is the
 * thing that would run unattended.
 *
 * ## What a green run does not settle
 *
 * It proves the boundaries are recoverable, not that the account inside them is
 * worth reading. The solution's own stated weakness survives every assertion
 * below: a run that spent an hour correctly concluding nothing needed doing
 * wrote no commit, so this reconstructs it as a run that never happened. No exit
 * code touches that, and the last test in this file pins the shape of the claim
 * rather than pretending otherwise.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  boundaryAgreement,
  opensRun,
  reconstructRuns,
  renderRunHistory,
  RUN_BOUNDARY_RULE,
  writerOf,
  type HistoryCommit,
} from "../../src/loop/run-boundary.js";

/** The bar the assumption test fixed before this corpus existed. Do not move it. */
const PRE_COMMITTED_BOUNDED_RATE = 4 / 5;

interface TruthRun {
  runId: string;
  kind: "discovery" | "build-loop";
  label: "tool-call-match" | "session-window";
  shas: string[];
}

interface Corpus {
  vault: string;
  head: string;
  until: string;
  transcriptsRead: number;
  sessionsInWindow: number;
  unmatchedToolCommits: number;
  ambiguousToolCommits: number;
  droppedContestedLabels: number;
  droppedClippedLabels: number;
  commits: HistoryCommit[];
  runs: TruthRun[];
}

const corpus: Corpus = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/run-boundary/corpus.json"), "utf8"),
) as Corpus;

describe("the corpus is the whole window, not a selection", () => {
  test("every commit before the cut is here, once, oldest first", () => {
    expect(corpus.commits.length).toBe(1500);
    expect(new Set(corpus.commits.map((c) => c.sha)).size).toBe(corpus.commits.length);
    for (let i = 1; i < corpus.commits.length; i++) {
      expect(corpus.commits[i].authoredAt).toBeGreaterThanOrEqual(corpus.commits[i - 1].authoredAt);
    }
  });

  test("no `mcp:` commit was dropped for being awkward to label", () => {
    // Every commit the tool surface wrote matched exactly one session's call.
    // A harvest that started dropping them would be choosing its own corpus.
    expect(corpus.unmatchedToolCommits).toBe(0);
    expect(corpus.ambiguousToolCommits).toBe(0);
  });

  test("what the record could not establish is counted, not quietly subtracted", () => {
    // 15 builder sessions whose padded windows both claim one sweep, so neither
    // firing's extent is a fact; 0 runs the window cut in half. Pinned so a
    // re-cut that starts discarding labels to make the score move is visible
    // as a change to this number rather than as a better result.
    expect(corpus.droppedContestedLabels).toBe(15);
    expect(corpus.droppedClippedLabels).toBe(0);
  });

  test("the labelled runs are disjoint and there are far more than the five the node asks for", () => {
    expect(corpus.runs.length).toBeGreaterThanOrEqual(5);
    const seen = new Set<string>();
    for (const run of corpus.runs) {
      expect(run.shas.length).toBeGreaterThan(0);
      for (const sha of run.shas) {
        expect(seen.has(sha)).toBe(false);
        seen.add(sha);
      }
    }
  });

  test("both loops are represented, because one loop alone never has to be told apart from anything", () => {
    expect(corpus.runs.filter((r) => r.kind === "discovery").length).toBeGreaterThan(0);
    expect(corpus.runs.filter((r) => r.kind === "build-loop").length).toBeGreaterThan(0);
  });
});

describe("bounding a run from the commit log alone", () => {
  const reconstruction = reconstructRuns(corpus.commits);
  const agreement = boundaryAgreement(reconstruction, corpus.runs);

  test(`at least 4 of 5 runs are bounded correctly (the bar, ${PRE_COMMITTED_BOUNDED_RATE})`, () => {
    // "Correctly" is commit-set equality, which is strictly harder than naming
    // the right endpoints: it also requires that nothing else got swept into
    // the span. The misses print, so a regression says which runs moved.
    const detail = agreement.missed
      .slice(0, 8)
      .map((m) => `${m.runId} expected ${m.expected.length} commit(s), found ${m.found?.length ?? "no run"}`)
      .join("; ");
    expect(
      agreement.rate,
      `${agreement.bounded}/${agreement.total} bounded — ${detail}`,
    ).toBeGreaterThanOrEqual(PRE_COMMITTED_BOUNDED_RATE);
  });

  test("the score is not carried by the runs that are one commit long", () => {
    // 24 of the labelled runs wrote a single commit, and bounding one of those
    // is free. Assert the bar separately over the runs that actually have an
    // inside — and over each loop on its own, so a rule that only understands
    // one of the two cannot hide behind the other's count.
    for (const [name, subset] of [
      ["runs of 2+ commits", corpus.runs.filter((r) => r.shas.length >= 2)],
      ["runs of 3+ commits", corpus.runs.filter((r) => r.shas.length >= 3)],
      ["discovery passes", corpus.runs.filter((r) => r.kind === "discovery")],
      ["build firings", corpus.runs.filter((r) => r.kind === "build-loop")],
    ] as const) {
      const scored = boundaryAgreement(reconstruction, subset);
      expect(scored.total).toBeGreaterThanOrEqual(5);
      expect(scored.rate, `${name}: ${scored.bounded}/${scored.total}`).toBeGreaterThanOrEqual(PRE_COMMITTED_BOUNDED_RATE);
    }
  });

  test("a concurrent run's commits are excluded from the span, which is the half git was doubted on", () => {
    // The two loops interleave for real in this vault: a build firing's sweeps
    // land inside a discovery pass's wall-clock span. Assert first that the
    // case exists — a passing exclusion test over a corpus with nothing to
    // exclude proves nothing — and then that not one of them was swallowed.
    const bounded = new Map(reconstruction.runs.map((r) => [r.shas.join(","), r]));
    const byShaTruth = new Map<string, TruthRun>();
    for (const run of corpus.runs) for (const sha of run.shas) byShaTruth.set(sha, run);

    let interleaved = 0;
    let swallowed = 0;
    for (const truth of corpus.runs) {
      const run = bounded.get(truth.shas.join(","));
      if (!run) continue;
      const members = new Set(run.shas);
      for (const commit of corpus.commits) {
        if (commit.authoredAt <= run.startedAt || commit.authoredAt >= run.endedAt) continue;
        const owner = byShaTruth.get(commit.sha);
        if (owner === undefined || owner.runId === truth.runId) continue;
        interleaved++;
        if (members.has(commit.sha)) swallowed++;
      }
    }
    expect(interleaved).toBeGreaterThan(0);
    expect(swallowed).toBe(0);
  });

  test("every bounded run opened on its writer's own first act, not on a guessed idle gap", () => {
    // `opened: false` is the reconstruction admitting the left edge is
    // inference. A run scored correct while carrying it would mean the bar was
    // being met by the backstop, which is exactly the thing that would not
    // survive contact with a differently-paced vault.
    const bounded = new Map(reconstruction.runs.map((r) => [r.shas.join(","), r]));
    for (const truth of corpus.runs) {
      const run = bounded.get(truth.shas.join(","));
      if (run) expect(run.opened, `${truth.runId} was bounded without an opening marker`).toBe(true);
    }
  });

  test("commits no loop wrote belong to no run, and the corpus contains some", () => {
    // The other half of the node's doubt: "or from a human's". This window
    // carries five — an `audit:` commit somebody made by hand and four
    // `chore(inbox):` ones from a path neither loop writes through. Assert they
    // are there before asserting they were excluded, so the day the window
    // stops containing any, this test says so instead of passing vacuously.
    expect(reconstruction.unattributed.length).toBeGreaterThan(0);
    const inARun = new Set(reconstruction.runs.flatMap((r) => r.shas));
    for (const commit of reconstruction.unattributed) {
      expect(inARun.has(commit.sha)).toBe(false);
      expect(commit.why.length).toBeGreaterThan(0);
    }
    // Nothing is dropped on the floor: every commit is in a run or named as
    // out of one, and a reader can count both.
    expect(inARun.size + reconstruction.unattributed.length).toBe(corpus.commits.length);
  });
});

describe("what carries the result", () => {
  /**
   * The reading the solution node proposes, implemented literally: "the commits
   * between the run's first and last are exactly what it accomplished", with
   * arrival time the only thing separating one run from the next.
   *
   * Written out here rather than exported from `src/`, because it is not a rule
   * this repository uses — it is the alternative the measured number is against.
   */
  function gapOnly(commits: readonly HistoryCommit[], gapSeconds: number): Set<string> {
    const sets = new Set<string>();
    let current: HistoryCommit[] = [];
    let previous: HistoryCommit | undefined;
    for (const commit of commits) {
      if (previous && commit.authoredAt - previous.authoredAt >= gapSeconds && current.length > 0) {
        sets.add(current.map((c) => c.sha).join(","));
        current = [];
      }
      current.push(commit);
      previous = commit;
    }
    if (current.length > 0) sets.add(current.map((c) => c.sha).join(","));
    return sets;
  }

  test("time alone does not bound these runs, at any threshold", () => {
    // The solution node's own framing, measured. If this ever passed the bar,
    // the opening marker in `run-boundary.ts` would be dead weight and should
    // come out; it does not come close, which is why the marker is there.
    for (const gap of [300, 600, 900, 1800, 3600]) {
      const sets = gapOnly(corpus.commits, gap);
      const bounded = corpus.runs.filter((r) => sets.has(r.shas.join(","))).length;
      expect(
        bounded / corpus.runs.length,
        `gap-only at ${gap}s bounded ${bounded}/${corpus.runs.length}`,
      ).toBeLessThan(PRE_COMMITTED_BOUNDED_RATE);
    }
  });

  test("the thresholds are not what carries it — removing the backstop changes nothing", () => {
    const withBackstop = boundaryAgreement(reconstructRuns(corpus.commits), corpus.runs);
    const without = boundaryAgreement(
      reconstructRuns(corpus.commits, { ...RUN_BOUNDARY_RULE, hardGapSeconds: Number.MAX_SAFE_INTEGER }),
      corpus.runs,
    );
    expect(without.bounded).toBe(withBackstop.bounded);
  });

  test("the idle gap is not what the result rests on", () => {
    // Every threshold from 5 minutes to half an hour clears the bar, and
    // 480s–900s all score identically. A rule whose verdict tracked its
    // threshold would be a rule fitted to this corpus; the gap is only being
    // asked to separate two markers, so it has that much room.
    for (const idleGapSeconds of [300, 480, 600, 900, 1200, 1800]) {
      const scored = boundaryAgreement(reconstructRuns(corpus.commits, { ...RUN_BOUNDARY_RULE, idleGapSeconds }), corpus.runs);
      expect(scored.rate, `idle gap ${idleGapSeconds}s bounded ${scored.bounded}/${scored.total}`).toBeGreaterThanOrEqual(
        PRE_COMMITTED_BOUNDED_RATE,
      );
    }
    const plateau = [480, 600, 900].map(
      (idleGapSeconds) => boundaryAgreement(reconstructRuns(corpus.commits, { ...RUN_BOUNDARY_RULE, idleGapSeconds }), corpus.runs).bounded,
    );
    expect(new Set(plateau).size).toBe(1);
  });
});

describe("the rule, on cases small enough to read", () => {
  const commit = (sha: string, subject: string, minutes: number, email = "loop@localhost"): HistoryCommit => ({
    sha,
    subject,
    authorName: "loop",
    authorEmail: email,
    authoredAt: minutes * 60,
    committedAt: minutes * 60,
  });

  test("a writer is read from the subject, never from the author", () => {
    expect(writerOf('mcp: ost_annotate — annotated "X"')).toBe("discovery");
    expect(writerOf("chore(instruments): record 8 observation(s) from the build loop")).toBe("build-loop");
    expect(writerOf("Merge branch 'main'")).toBeUndefined();
    expect(writerOf("fix a typo in the outcome")).toBeUndefined();
  });

  test("each loop's first act is its opening marker and nothing else is", () => {
    expect(opensRun("discovery", "mcp: ost_ingest_inbox — captured 2 new item(s)")).toBe(true);
    expect(opensRun("discovery", 'mcp: ost_create_node — created Solution "X"')).toBe(false);
    expect(opensRun("build-loop", "chore(instruments): record 8 observation(s) from the build loop")).toBe(true);
    expect(opensRun("build-loop", "chore(instruments): record the post-build observation for X")).toBe(false);
  });

  test("two loops writing into one hour come out as two runs, not one interleaved mess", () => {
    const history = [
      commit("a1", "chore(instruments): record 8 observation(s) from the build loop", 0, "build@localhost"),
      commit("b1", "mcp: ost_ingest_inbox — captured 2 new item(s)", 20),
      commit("b2", 'mcp: ost_append_to_node — appended to "X"', 22),
      commit("b3", "mcp: ost_ingest_inbox — captured 0 new item(s)", 24),
      commit("a2", "chore(instruments): record the post-build observation for X", 40, "build@localhost"),
    ];
    const { runs } = reconstructRuns(history);
    expect(runs.map((r) => r.shas)).toEqual([
      ["a1", "a2"],
      ["b1", "b2", "b3"],
    ]);
    expect(runs.every((r) => r.opened)).toBe(true);
  });

  test("a mid-run repeat of the opening act does not split the run", () => {
    const history = [
      commit("c1", "mcp: ost_ingest_inbox — captured 2 new item(s)", 0),
      commit("c2", 'mcp: ost_edit_node — edited "X"', 3),
      commit("c3", "mcp: ost_ingest_inbox — captured 0 new item(s)", 6),
      commit("c4", 'mcp: ost_annotate — annotated "Y"', 8),
    ];
    expect(reconstructRuns(history).runs.map((r) => r.shas)).toEqual([["c1", "c2", "c3", "c4"]]);
  });

  test("a human's commit is named and left out of every run", () => {
    const history = [
      commit("d1", "mcp: ost_ingest_inbox — captured 1 new item(s)", 0),
      commit("h1", "rename the outcome to what I actually meant", 2),
      commit("d2", 'mcp: ost_annotate — annotated "X"', 4),
    ];
    const { runs, unattributed } = reconstructRuns(history);
    expect(runs.map((r) => r.shas)).toEqual([["d1", "d2"]]);
    expect(unattributed.map((c) => c.sha)).toEqual(["h1"]);
  });

  test("a run whose left edge is only an idle gap says so", () => {
    const history = [
      commit("e1", "chore(instruments): record the post-build observation for X", 0, "build@localhost"),
      commit("e2", "chore(instruments): record the post-build observation for Y", 60 * 24, "build@localhost"),
    ];
    const { runs } = reconstructRuns(history);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.opened)).toBe(false);
    expect(renderRunHistory({ runs, unattributed: [] }).join("\n")).toContain("not evidence");
  });

  test("an empty history is silent rather than confident", () => {
    expect(renderRunHistory(reconstructRuns([]))).toEqual(["runs: the history holds no commit any loop wrote"]);
  });
});

describe("what this cannot see", () => {
  test("a run that wrote nothing is reconstructed as a run that never happened", () => {
    // The solution node's own stated weakness, pinned so a later reader cannot
    // mistake a green suite for a claim this covers thinking, reading, or a
    // correct decision to do nothing.
    expect(reconstructRuns([]).runs).toEqual([]);
  });
});
