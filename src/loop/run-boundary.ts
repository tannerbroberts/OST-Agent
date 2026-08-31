/**
 * Run boundaries, reconstructed from the commit log and nothing else.
 *
 * **The problem this answers.** A run's own account of itself is written at the
 * end, so a run that does not reach the end reports nothing — the failure
 * recorded in the meta vault on 2026-07-24, when a backgrounded builder pass
 * left no marker of what it had finished. `./journal.ts` fixes that forward, by
 * appending a line as each step completes. This module fixes it backward, and
 * the two are not redundant: the journal is a file the run writes, so a run that
 * never had a state directory, or whose directory was wiped, or that was killed
 * before it opened one, still leaves nothing. The commit log is written by the
 * *writes themselves*, so it exists whether or not the run survived to say
 * anything, and a run that lied cannot alter it.
 *
 * **What the solution node claims, and what is actually missing.** "Every
 * mutation already auto-commits with a message naming the tool and its subject.
 * Read the history instead of asking the run." The data is there; what is
 * missing is a way to **bound** a run inside it — and the node names that as its
 * own weakness: "distinguishing one run's commits from a concurrent run's, or
 * from a human's, is not obviously solvable from git alone." That is the
 * assumption this file exists to test, and the answer measured over 600 real
 * commits is that it *is* solvable, but not by the obvious rule. See "What the
 * corpus says" below.
 *
 * ## The rule, and why each part of it is there
 *
 * Three signals, applied in this order:
 *
 *   1. **Actor.** A commit belongs to the stream of the writer that made it —
 *      {@link writerOf} read off the subject, paired with the git author
 *      identity. Two loops committing to one vault interleave in wall-clock
 *      order, and on the corpus 565 commits of one run sit inside the span of
 *      another; without this partition every one of them is swallowed.
 *   2. **The opening marker.** Each loop's brief makes its first act the same
 *      act every time — the discovery pass ingests, the build loop records its
 *      pre-build instrument sweep — so a run's *first* commit is recognisable
 *      from its subject. This is the part that makes the rest work, and it is a
 *      contract with this repository's own loops rather than a property of git.
 *   3. **An idle gap.** A marker mid-run is not a boundary: a discovery pass
 *      re-ingests while it works, and its closing act is the same call as its
 *      opening one. The gap is what separates "the pass ingested again" from "a
 *      new pass started", and nothing more — it is deliberately not carrying the
 *      boundary on its own.
 *
 * ## What the corpus says about that
 *
 * `test/loop/run-boundary-from-history.test.ts` measures this against 319 real
 * runs — 169 discovery passes and 150 build firings — over 1,500 commits of the
 * OST-Agent meta vault, bounded independently from the Claude Code session
 * transcripts that drove them (see `test/fixtures/run-boundary/PROVENANCE.md`).
 * "Correct" is the strict reading: the reconstructed run's commit SET equals the
 * true one, which subsumes both endpoints and the exclusion of everything else.
 *
 *   - **this rule: 317/319 (99.4%)**
 *   - actor split + idle gap, no marker, at its best threshold: 267/319 (83.7%)
 *   - idle gap alone, at its best threshold: 86/319 (27.0%)
 *
 * The pre-committed bar was 4 of 5. The number worth carrying is not the 99%,
 * it is the 27%: the reading the solution node proposes — commits between a
 * run's first and last, separated by when they arrived — recovers a quarter of
 * the runs it is pointed at, and everything above that comes from knowing which
 * loop wrote each commit and what its first act looks like. Anyone porting this
 * to a vault whose loops have no such marker should expect the 27% number.
 *
 * The middle row is the one that decides between two defensible rules, and it
 * decides on *stability* rather than on its peak. Actor-split-plus-gap reaches
 * 83.7% at 1,800s and falls to 56.4% at 600s and 5.6% at 5,400s — its answer is
 * a property of the threshold. With the marker, the score is flat at 99.4%
 * across 480s–900s and never drops below the bar between 300s and 1,800s,
 * because the gap is only being asked to separate two markers rather than to
 * find the boundary itself.
 *
 * ## The boundary, stated rather than buried
 *
 * **A pass whose last act repeats its first is cut in two.** The discovery loop
 * opens and closes with the same call, so a pass that goes quiet for longer than
 * `idleGapSeconds` before its closing ingest reads as two runs. That is one of
 * the two misses on the corpus and it is not fixable from git: the two commits
 * are byte-for-byte the same kind of event. Closing it needs the loop to write a
 * distinguishable closing act, which is a change to the brief, not to this file.
 *
 * Two runs of the *same* writer that overlap in time are likewise one run here,
 * and nothing git records could separate them — the same wall this repository's
 * `../git/hand-edit-detector.ts` hits from the other side. The corpus contains
 * no such overlap (the two loops interleave with each other, never with
 * themselves), so this is untested rather than handled, and it is why
 * {@link ReconstructedRun} carries `opened` instead of pretending every boundary
 * is equally well evidenced.
 *
 * And the older limit, which is the solution's own: **a run that wrote nothing
 * is not here at all.** An hour spent correctly concluding that nothing needed
 * doing leaves no commit, so this reports it as an hour that did not happen. No
 * threshold moves that; it is a property of reading side effects.
 */
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { toolFromSubject } from "./pass-shape.js";

/** Everything this reader is allowed to use — one row of `git log`, no diff. */
export interface HistoryCommit {
  sha: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  /** Author date, epoch seconds. When the write happened. */
  authoredAt: number;
  /** Committer date, epoch seconds. Later than `authoredAt` means it was re-made. */
  committedAt: number;
}

/** The loop that wrote a commit, named by the shape of its subject. */
export type RunWriter = "discovery" | "build-loop";

/** One run, as the history has it. */
export interface ReconstructedRun {
  writer: RunWriter;
  /** The git identity that authored every commit in the run. */
  actor: string;
  /** Every commit attributed to this run, oldest first. */
  shas: string[];
  firstSha: string;
  lastSha: string;
  /** Author dates of the first and last commit, epoch seconds. */
  startedAt: number;
  endedAt: number;
  /**
   * True when the run's first commit is its writer's opening marker, so the
   * left boundary is evidence rather than inference.
   *
   * False means the boundary came from {@link RunBoundaryRule.hardGapSeconds}
   * or from the corpus simply starting there. A caller that needs a bound it
   * can act on should read this before the shas: an unopened run is the reader
   * saying "something changed writers here", not "a run began here".
   */
  opened: boolean;
}

/** A commit no run wrote, and the sentence that says why it is out. */
export interface UnattributedCommit {
  sha: string;
  subject: string;
  why: string;
}

export interface Reconstruction {
  runs: ReconstructedRun[];
  /**
   * Commits excluded from every run — a human's edit, a merge, an unknown
   * machine. Kept rather than dropped: "no run wrote this" is a finding about
   * the vault, and a reader who cannot see the residue cannot tell a clean
   * history from a rule that quietly ignored half of it.
   */
  unattributed: UnattributedCommit[];
}

/**
 * The two thresholds, together in one object so a caller can restate the whole
 * rule and a test can print what it measured under.
 */
export interface RunBoundaryRule {
  /**
   * How long a writer must be quiet before its opening marker reads as a new
   * run rather than a mid-run repeat.
   *
   * 600s. The measurement that fixes it: on the corpus the shortest gap
   * *between* two true runs of one writer is 947s, and the score is flat at its
   * best across 480s–900s. It is set inside that plateau rather than at either
   * edge, because a value tuned to the edge of this corpus is a value fitted to
   * it. Between 300s and 1,800s the rule never drops below the bar, so nothing
   * here turns on the exact number.
   */
  idleGapSeconds: number;
  /**
   * The backstop, for a stream that goes on without ever showing an opening
   * marker.
   *
   * 86400s (24h). **It fires on no true boundary in the corpus** — raising it to
   * `MAX_SAFE_INTEGER` leaves the score unchanged — so it is not carrying the
   * result and is not tuned to it. It is here because without it a stream whose
   * marker this file does not know collapses into one run spanning the whole
   * history, which is a wrong answer wearing a confident face; a run it does cut
   * carries `opened: false`, so the guess is visible as a guess.
   *
   * A day, and the reason it is not the six hours first written here: the corpus
   * contains a single true run with a **5h58m** quiet stretch inside it, so a
   * 6h backstop clears the worst real case by 125 seconds. That is a threshold
   * that happens to be right rather than one that is right, and the cost of
   * being wrong is a run silently reported as two.
   */
  hardGapSeconds: number;
}

export const RUN_BOUNDARY_RULE: RunBoundaryRule = {
  idleGapSeconds: 600,
  hardGapSeconds: 86400,
};

/**
 * Subjects a machine writes that are not a run's work at all.
 *
 * A merge changes which commits are reachable rather than doing anything to the
 * tree, and it is the one subject form here that a human types by hand as often
 * as a tool does. It goes to `unattributed` rather than into a run, which is the
 * same call `../git/hand-edit-detector.ts` makes about merges for the same
 * reason: a merge's diff says nothing about who did the work.
 */
/** `%x1f` in the log format above — a byte no commit subject contains. */
const UNIT_SEPARATOR = "\u001f";

const MERGE_SUBJECT = /^Merge (branch|pull request|remote-tracking branch)\b/;

/**
 * The build loop's own commits, written by the shell around a builder pass
 * rather than by the pass.
 *
 * Two forms, and the split between them is the whole reason a build firing can
 * be bounded: `record N observation(s) from the build loop` is the pre-build
 * instrument sweep and opens a firing, `record the post-build observation for X`
 * closes it. Nothing else in this vault's history wears the `chore(instruments)`
 * prefix.
 */
const BUILD_LOOP_SUBJECT = /^chore\(instruments\):/;
const BUILD_LOOP_OPENING = /^chore\(instruments\):\s+record \d+ observation\(s\) from the build loop/;

/**
 * The discovery pass's first act, by the loop's own brief: ingest the inbox
 * before deciding anything.
 *
 * Listed as one tool name rather than inferred, for the same reason
 * `./pass-shape.ts` lists its calls: a tool added to the MCP surface and to
 * neither list should be visible as unhandled rather than silently become a
 * boundary.
 */
const DISCOVERY_OPENING_CALL = "ost_ingest_inbox";

/**
 * Which loop wrote this commit, or undefined for a subject no loop produces.
 *
 * Read off the subject alone, deliberately, and *not* off the git author: the
 * author identity is whatever the machine's git config happened to say, and on
 * this vault both loops have run under both identities at different times. The
 * author is used below to split streams that agree on writer, never to decide
 * which writer it is.
 */
export function writerOf(subject: string): RunWriter | undefined {
  if (toolFromSubject(subject) !== undefined) return "discovery";
  if (BUILD_LOOP_SUBJECT.test(subject)) return "build-loop";
  return undefined;
}

/** Is this commit the subject form its writer opens a run with? */
export function opensRun(writer: RunWriter, subject: string): boolean {
  if (writer === "discovery") return toolFromSubject(subject) === DISCOVERY_OPENING_CALL;
  return BUILD_LOOP_OPENING.test(subject);
}

/** Why a commit was left out of every run, in one sentence a reader can act on. */
function whyUnattributed(subject: string): string {
  if (MERGE_SUBJECT.test(subject)) {
    return "a merge — it changes which commits are reachable, not what any run did";
  }
  return `no loop in this repository writes subjects of this shape, so no run can be shown to have made it — "${subject.slice(0, 80)}"`;
}

/**
 * Bound every run the history shows, oldest first.
 *
 * `commits` must be oldest-first and must carry nothing the caller could not
 * have got from `git log` — that constraint is the measurement, not hygiene.
 * {@link readRunHistory} produces the shape; a test hands it a fixture.
 */
export function reconstructRuns(
  commits: readonly HistoryCommit[],
  rule: RunBoundaryRule = RUN_BOUNDARY_RULE,
): Reconstruction {
  const unattributed: UnattributedCommit[] = [];
  /** One stream per (writer, git identity) — the actor partition. */
  const streams = new Map<string, { writer: RunWriter; actor: string; commits: HistoryCommit[] }>();

  for (const commit of commits) {
    const writer = writerOf(commit.subject);
    if (writer === undefined) {
      unattributed.push({ sha: commit.sha, subject: commit.subject, why: whyUnattributed(commit.subject) });
      continue;
    }
    const actor = commit.authorEmail || commit.authorName;
    const key = `${writer}${actor}`;
    let stream = streams.get(key);
    if (!stream) {
      stream = { writer, actor, commits: [] };
      streams.set(key, stream);
    }
    stream.commits.push(commit);
  }

  const runs: ReconstructedRun[] = [];
  for (const stream of streams.values()) {
    let current: HistoryCommit[] = [];
    let opened = false;
    const close = () => {
      if (current.length === 0) return;
      runs.push({
        writer: stream.writer,
        actor: stream.actor,
        shas: current.map((c) => c.sha),
        firstSha: current[0].sha,
        lastSha: current[current.length - 1].sha,
        startedAt: current[0].authoredAt,
        endedAt: current[current.length - 1].authoredAt,
        opened,
      });
      current = [];
    };
    let previous: HistoryCommit | undefined;
    for (const commit of stream.commits) {
      const gap = previous ? commit.authoredAt - previous.authoredAt : Number.POSITIVE_INFINITY;
      const marker = opensRun(stream.writer, commit.subject);
      const startsRun = previous === undefined || gap >= rule.hardGapSeconds || (gap >= rule.idleGapSeconds && marker);
      if (startsRun) {
        close();
        opened = marker;
      }
      current.push(commit);
      previous = commit;
    }
    close();
  }

  runs.sort((a, b) => a.startedAt - b.startedAt || a.firstSha.localeCompare(b.firstSha));
  return { runs, unattributed };
}

/**
 * How well a reconstruction bounds a set of runs whose extent is known from
 * somewhere other than git.
 *
 * Lives in `src/` rather than inside the test for the reason `./pass-shape.ts`
 * gives about its own scorer: the number is the assumption test's whole result,
 * and a measurement that exists only inside its own assertion cannot be re-run
 * against a different corpus by anyone who doubts it.
 *
 * **Correct means the commit sets are equal**, not that the endpoints match. The
 * weaker reading passes a run that named the right first and last commit while
 * swallowing a concurrent run's commits in between, and excluding those is half
 * of what the assumption is about.
 */
export function boundaryAgreement(
  reconstruction: Reconstruction,
  known: readonly { runId: string; shas: readonly string[] }[],
): {
  bounded: number;
  total: number;
  rate: number;
  /** The runs that came out wrong, with what was found in their place. */
  missed: { runId: string; expected: readonly string[]; found: string[] | null }[];
} {
  const byMembership = new Map<string, ReconstructedRun>();
  for (const run of reconstruction.runs) byMembership.set(run.shas.join(","), run);
  const index = new Map<string, ReconstructedRun>();
  for (const run of reconstruction.runs) for (const sha of run.shas) index.set(sha, run);

  const missed: { runId: string; expected: readonly string[]; found: string[] | null }[] = [];
  let bounded = 0;
  for (const truth of known) {
    if (byMembership.has([...truth.shas].join(","))) {
      bounded++;
      continue;
    }
    const found = truth.shas.length > 0 ? (index.get(truth.shas[0])?.shas ?? null) : null;
    missed.push({ runId: truth.runId, expected: truth.shas, found });
  }
  return { bounded, total: known.length, rate: known.length === 0 ? 0 : bounded / known.length, missed };
}

/**
 * Read the history this reader is allowed to see, oldest first.
 *
 * HEAD's own history and nothing else — never `--all`, never `--reflog`, for the
 * reason `../git/hand-edit-detector.ts` states at its own log call: a stash
 * writes commits that are not in the tree, and a run reconstructed partly out of
 * them is an account of work that was taken back.
 */
export async function readRunHistory(
  dir: string,
  opts: { since?: string; limit?: number } = {},
): Promise<HistoryCommit[]> {
  const git: SimpleGit = simpleGit(path.resolve(dir));
  const range = opts.since ? [`${opts.since}..HEAD`] : ["HEAD"];
  const limit = opts.limit ? [`-${opts.limit}`] : [];
  const raw = await git.raw(["log", "--reverse", "--format=%H%x1f%at%x1f%ct%x1f%an%x1f%ae%x1f%s", ...limit, ...range]);
  const out: HistoryCommit[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    const [sha, at, ct, authorName, authorEmail, ...rest] = line.split(UNIT_SEPARATOR);
    out.push({
      sha,
      authoredAt: Number(at),
      committedAt: Number(ct),
      authorName,
      authorEmail,
      subject: rest.join(UNIT_SEPARATOR),
    });
  }
  return out;
}

/**
 * The reconstruction as an operator reads it — what ran, when, and how much of
 * each boundary is evidence.
 *
 * Returns lines rather than a string so a caller picks its stream, and says the
 * unattributed count out loud even when it is zero: "no run wrote 4 of these
 * commits" is the half of the report a reader would otherwise never think to
 * ask for.
 */
export function renderRunHistory(reconstruction: Reconstruction): string[] {
  const { runs, unattributed } = reconstruction;
  if (runs.length === 0 && unattributed.length === 0) return ["runs: the history holds no commit any loop wrote"];
  const lines = [
    `runs: ${runs.length} reconstructed from the commit log alone — ` +
      `${runs.filter((r) => r.opened).length} opened on their writer's first act, ` +
      `${runs.filter((r) => !r.opened).length} bounded by an idle stretch instead, ` +
      `${unattributed.length} commit(s) attributed to no run.`,
  ];
  for (const run of runs) {
    const started = new Date(run.startedAt * 1000).toISOString();
    const ended = new Date(run.endedAt * 1000).toISOString();
    lines.push(
      `  ${run.writer} ${run.firstSha.slice(0, 8)}..${run.lastSha.slice(0, 8)} ` +
        `${run.shas.length} commit(s) ${started} → ${ended}` +
        (run.opened ? "" : " (no opening marker — the left boundary is an idle gap, not evidence)"),
    );
  }
  for (const commit of unattributed) lines.push(`  unattributed ${commit.sha.slice(0, 8)} — ${commit.why}`);
  return lines;
}
