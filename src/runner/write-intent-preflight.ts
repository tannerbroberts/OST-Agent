/**
 * A run states the paths it intends to write, checks whether the ground under
 * them is already moving, and refuses to start rather than begin work it will
 * have to abandon halfway.
 *
 * This is the *prevent* sibling of the concurrency family under "A second
 * process is editing the same files, and a failed string match is the only
 * notification": {@link "./drift-window.js"} measures whether a between-steps
 * sentinel would have had time to *notice* movement, and
 * {@link "./failed-match-attribution.js"} *classifies* a failed edit after the
 * fact. This module is earlier than both — it runs before a single tool call,
 * and either lets the run start or says why not.
 *
 * **What it is built from.** The one collision this building has actually
 * recorded (`TRANSCRIPT:424486ec-3489-4b53-8e2b-012232d221ab`, replayed in
 * `test/fixtures/write-intent-preflight/`) shows the real signal was not
 * "files looked freshly touched" — every file this run itself was mid-editing
 * also looks freshly touched, which is exactly the false-stop the solution
 * node warns about ("an operator simply working" looks the same from mtimes
 * alone). The signal that actually separated the two, reconstructed from this
 * repository's own git history rather than the transcript's prose, was that
 * `HEAD` moved out from under the run: it read `3fd68a8` at start and found
 * `cf75488` — a merge neither the run nor the operator made from inside the
 * session — by the time it checked. {@link evaluateWriteIntentPreflight} makes
 * that comparison the primary refusal, and treats "one of my own declared
 * paths is dirty and nothing I have done yet could have dirtied it" as a
 * second, narrower signal — narrower on purpose, so an operator's unrelated
 * WIP in a file this run does not care about never trips it.
 *
 * **What it does not do.** It does not resolve a conflict, wait, retry, or
 * acquire anything on the run's behalf — like `grant-preflight.ts`, it is the
 * comparison and only the comparison. A caller that wants to wait for the
 * ground to settle decides that for itself.
 */
import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";

/** The paths a run declares before it does any work, and what it last knew HEAD to be. */
export interface WriteIntent {
  /** Repo-relative paths this run is about to write. */
  paths: readonly string[];
  /**
   * `HEAD` as this run last confirmed it — at session start, or after its own
   * last commit. Absent when the caller has no such record yet (its very first
   * check of a pass): in that case {@link evaluateWriteIntentPreflight} cannot
   * tell whether the ground moved, and skips that comparison rather than
   * guessing.
   */
  referenceHeadSha?: string;
}

/** The state of the working tree at the moment a run is about to declare intent. */
export interface WorkingTreeSnapshot {
  headSha: string;
  /** `.git/MERGE_HEAD` exists — a merge is stopped partway, waiting on conflict resolution. */
  mergeInProgress: boolean;
  /** `.git/rebase-merge` or `.git/rebase-apply` exists. */
  rebaseInProgress: boolean;
  /** Repo-relative path → mtime in ms, for every path `git status --porcelain` currently reports dirty. */
  dirty: Readonly<Record<string, number>>;
}

export type PreflightReason = "merge-in-progress" | "rebase-in-progress" | "head-moved" | "path-contended";

export type PreflightVerdict =
  | { refuse: false }
  | { refuse: true; reason: PreflightReason; detail: string };

/**
 * The rule, fixed here before the corpus was counted — see
 * `test/runner/write-intent-preflight-false-stop.test.ts`, which asserts this
 * shape as well as the count so a later edit shows up as a changed expectation
 * rather than a quietly different finding.
 */
export const WRITE_INTENT_PREFLIGHT_RULE = {
  /**
   * How recently a declared path must have gone dirty to count as contended.
   * The one recorded collision's own mtimes were 17s–162s old when the run
   * checked; this is a wide superset of that so the corpus is not tuned to its
   * own single data point. The false-stop half of the assumption test does not
   * exercise this boundary — none of the recorded clean sessions had a
   * declared path dirty at all, at any age — so this number is asserted here
   * and left as an admitted, untested boundary rather than a measured one.
   */
  recentDirtyWindowMs: 5 * 60 * 1000,
  /** The bar the assumption test states: refuse every recorded collision, and fewer than 1 in 10 clean sessions. */
  maxFalseStopShare: 0.1,
} as const;

/**
 * Decide whether a run should start, given what it intends to touch and what
 * the working tree looks like right now.
 *
 * Checked in order from the least ambiguous signal to the most: a merge or
 * rebase stopped mid-flight cannot be an operator "simply working" — nothing
 * else needs to be asked. `HEAD` having moved from what the run last confirmed
 * is next, and is itself unambiguous — editing files does not move `HEAD`,
 * only a commit, merge, or checkout does. Only after both of those come up
 * empty does a declared path's own dirtiness matter, and only when it is
 * fresh: a run has not written any of its declared paths yet at preflight
 * time, so a fresh mtime on one of them cannot be its own doing.
 */
export function evaluateWriteIntentPreflight(
  intent: WriteIntent,
  snapshot: WorkingTreeSnapshot,
  now: number,
): PreflightVerdict {
  if (snapshot.mergeInProgress) {
    return { refuse: true, reason: "merge-in-progress", detail: `a merge is stopped mid-flight at ${snapshot.headSha}` };
  }
  if (snapshot.rebaseInProgress) {
    return { refuse: true, reason: "rebase-in-progress", detail: `a rebase is stopped mid-flight at ${snapshot.headSha}` };
  }
  if (intent.referenceHeadSha && intent.referenceHeadSha !== snapshot.headSha) {
    return {
      refuse: true,
      reason: "head-moved",
      detail: `HEAD moved from ${intent.referenceHeadSha} to ${snapshot.headSha} since this run last checked`,
    };
  }
  for (const p of intent.paths) {
    const mtime = snapshot.dirty[p];
    if (mtime === undefined) continue;
    const ageMs = now - mtime;
    if (ageMs <= WRITE_INTENT_PREFLIGHT_RULE.recentDirtyWindowMs) {
      return {
        refuse: true,
        reason: "path-contended",
        detail: `${p} is already dirty, touched ${Math.round(ageMs / 1000)}s ago — this run has not written it yet`,
      };
    }
  }
  return { refuse: false };
}

/**
 * Read the live working tree at `repoDir` into the shape
 * {@link evaluateWriteIntentPreflight} decides over.
 *
 * Read-only: `rev-parse`, `status --porcelain`, and `fs.statSync` on the paths
 * git already named as dirty. Nothing here writes, waits, or retries. Goes
 * through `simple-git`, like every other git read in this repository, rather
 * than spawning `git` directly — see `test/runner/suite-result-consumer-census.test.ts`
 * for why a new direct `child_process` door is a cost, not a convenience.
 */
export async function readWorkingTreeSnapshot(repoDir: string): Promise<WorkingTreeSnapshot> {
  const abs = path.resolve(repoDir);
  const g = simpleGit(abs);

  const headSha = (await g.raw(["rev-parse", "HEAD"])).trim();
  const gitDirRaw = (await g.raw(["rev-parse", "--git-dir"])).trim();
  const gitDir = path.isAbsolute(gitDirRaw) ? gitDirRaw : path.join(abs, gitDirRaw);
  const mergeInProgress = fs.existsSync(path.join(gitDir, "MERGE_HEAD"));
  const rebaseInProgress =
    fs.existsSync(path.join(gitDir, "rebase-merge")) || fs.existsSync(path.join(gitDir, "rebase-apply"));

  const statusOut = await g.raw(["status", "--porcelain"]);
  const dirty: Record<string, number> = {};
  for (const line of statusOut.split("\n")) {
    if (line.length < 4) continue;
    const p = line.slice(3).trim();
    if (!p) continue;
    try {
      dirty[p] = fs.statSync(path.join(abs, p)).mtimeMs;
    } catch {
      // git named a path (e.g. a rename source) that no longer exists on disk under that name;
      // it cannot be freshly touched if it is not there, so it is left out rather than guessed at
    }
  }

  return { headSha, mergeInProgress, rebaseInProgress, dirty };
}

// ── replaying the rule over recorded sessions ────────────────────────────────

/** One recorded session, replayed through the rule: what it declared, what the tree looked like, and what actually happened. */
export interface RecordedPreflightCase {
  sessionId: string;
  origin: string;
  intent: WriteIntent;
  snapshot: WorkingTreeSnapshot;
  /** The moment this snapshot was taken, in epoch ms — the clock {@link evaluateWriteIntentPreflight} reasons against. */
  observedAtMs: number;
  /** Whether this session is the one recorded collision, or one of the sessions that finished cleanly. */
  isCollision: boolean;
}

export interface WriteIntentFalseStopCensus {
  cases: number;
  collisionCases: number;
  cleanCases: number;
  /** Recorded collisions the rule would have refused. */
  refusedCollisions: number;
  /** Clean sessions the rule would have refused anyway — the false stops. */
  refusedClean: number;
  /** refusedCollisions === collisionCases, and collisionCases > 0. */
  sensitivityMet: boolean;
  /** refusedClean / cleanCases, or null when there are no clean cases to divide by. */
  falseStopRate: number | null;
  specificityMet: boolean;
  verdicts: { sessionId: string; origin: string; isCollision: boolean; verdict: PreflightVerdict }[];
}

export function writeIntentFalseStopCensus(cases: readonly RecordedPreflightCase[]): WriteIntentFalseStopCensus {
  const verdicts = cases.map((c) => ({
    sessionId: c.sessionId,
    origin: c.origin,
    isCollision: c.isCollision,
    verdict: evaluateWriteIntentPreflight(c.intent, c.snapshot, c.observedAtMs),
  }));

  const collisions = verdicts.filter((v) => v.isCollision);
  const clean = verdicts.filter((v) => !v.isCollision);
  const refusedCollisions = collisions.filter((v) => v.verdict.refuse).length;
  const refusedClean = clean.filter((v) => v.verdict.refuse).length;
  const falseStopRate = clean.length ? refusedClean / clean.length : null;

  return {
    cases: cases.length,
    collisionCases: collisions.length,
    cleanCases: clean.length,
    refusedCollisions,
    refusedClean,
    sensitivityMet: collisions.length > 0 && refusedCollisions === collisions.length,
    falseStopRate,
    specificityMet: falseStopRate !== null && falseStopRate < WRITE_INTENT_PREFLIGHT_RULE.maxFalseStopShare,
    verdicts,
  };
}

export function formatWriteIntentFalseStopCensus(census: WriteIntentFalseStopCensus): string {
  const lines: string[] = [];
  lines.push("Write-intent preflight — sensitivity and false-stop rate over recorded sessions");
  lines.push(
    `Sensitivity: ${census.refusedCollisions} of ${census.collisionCases} recorded collision(s) refused — ` +
      `${census.sensitivityMet ? "MET" : "NOT MET"}.`,
  );
  const rate = census.falseStopRate === null ? "n/a" : `${Math.round(census.falseStopRate * 1000) / 10}%`;
  lines.push(
    `False stops: ${census.refusedClean} of ${census.cleanCases} clean session(s) refused (${rate}), ` +
      `bar is under ${Math.round(WRITE_INTENT_PREFLIGHT_RULE.maxFalseStopShare * 100)}% — ${census.specificityMet ? "MET" : "NOT MET"}.`,
  );
  for (const v of census.verdicts) {
    const outcome = v.verdict.refuse ? `REFUSE (${v.verdict.reason}: ${v.verdict.detail})` : "allow";
    lines.push(`  ${v.sessionId} (${v.origin}) [${v.isCollision ? "collision" : "clean"}] — ${outcome}`);
  }
  return lines.join("\n");
}
