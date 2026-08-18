/**
 * Dead-end scan — reads reversals off the committed history instead of a
 * session transcript.
 *
 * "Detect the dead ends from the artifact trail rather than from the
 * session" argues that a wrong turn that cost real time almost always
 * leaves a scar in the repository even when it leaves no error code, because
 * someone had to undo it. This module looks for the two reversal shapes that
 * survive in the surviving history of a branch: a commit that reverts an
 * earlier one, and a file that was both created and deleted inside the
 * scanned window.
 *
 * Deliberately narrow, and the solution node says why: a branch built and
 * discarded before it ever merged, and a push rejected as non-fast-forward,
 * leave no trace in the history a later `git log` can walk at all. This
 * only sees the wrong turns that reached a commit on the branch being
 * scanned — everything cheaper to abandon than that is invisible to it, by
 * construction, not by a bug.
 */
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";

export type DeadEndKind = "revert" | "created-then-deleted";

export interface DeadEndEvent {
  kind: DeadEndKind;
  /** The commit where the dead end becomes visible: the revert, or the deletion. */
  sha: string;
  /** ISO date of that commit. */
  date: string;
  /** Human-readable one-line description. */
  summary: string;
  /** The file involved, for a "created-then-deleted" event. */
  file?: string;
  /** The commit undone, for a "revert" event. */
  revertedSha?: string;
}

export interface DeadEndScanOptions {
  /** How many of the most recent commits to scan, oldest-first within that set. */
  maxCommits?: number;
}

interface CommitInfo {
  sha: string;
  date: string;
  subject: string;
  body: string;
}

interface FileChange {
  status: string;
  path: string;
}

const DEFAULT_WINDOW = 200;
const REVERT_TRAILER = /This reverts commit ([0-9a-f]{7,40})/i;

function git(dir: string): SimpleGit {
  return simpleGit(path.resolve(dir));
}

/** The `max` most recent commits, oldest-first, with the fields the scan needs. */
async function commitsInWindow(g: SimpleGit, max: number): Promise<CommitInfo[]> {
  let raw: string;
  try {
    raw = await g.raw([
      "log",
      "-n",
      String(max),
      "--reverse",
      "--date=iso-strict",
      "--format=%H%x1f%ad%x1f%s%x1f%b%x03",
    ]);
  } catch {
    return [];
  }
  return raw
    .split("\x03")
    .map((chunk) => chunk.replace(/^\n/, "").trim())
    .filter(Boolean)
    .map((chunk) => {
      const [sha = "", date = "", subject = "", ...bodyParts] = chunk.split("\x1f");
      return { sha, date, subject, body: bodyParts.join("\x1f").trim() };
    });
}

/** Path-status pairs for one commit's diff against its parent, renames turned off. */
async function changedFiles(g: SimpleGit, sha: string): Promise<FileChange[]> {
  let raw: string;
  try {
    raw = await g.raw(["show", "--no-renames", "--name-status", "--format=", sha]);
  } catch {
    return [];
  }
  const changes: FileChange[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [status, ...rest] = trimmed.split("\t");
    const filePath = rest[rest.length - 1];
    if (!status || !filePath) continue;
    changes.push({ status, path: filePath });
  }
  return changes;
}

/**
 * Walk a repository's recent commit window and flag dead-end-shaped events.
 *
 * A revert fires whenever a commit in the window carries git's own "This
 * reverts commit …" trailer — no guessing at intent, just reading the marker
 * `git revert` already writes. A created-then-deleted fires whenever a file
 * is added by one commit and removed by a later commit, both inside the same
 * window, regardless of how many ordinary edits happened to it in between.
 */
export async function scanDeadEnds(repoDir: string, opts: DeadEndScanOptions = {}): Promise<DeadEndEvent[]> {
  const g = git(repoDir);
  const max = opts.maxCommits ?? DEFAULT_WINDOW;
  const commits = await commitsInWindow(g, max);
  const events: DeadEndEvent[] = [];
  const addedBy = new Map<string, CommitInfo>();

  for (const commit of commits) {
    const reverted = REVERT_TRAILER.exec(commit.body)?.[1];
    if (reverted) {
      events.push({
        kind: "revert",
        sha: commit.sha,
        date: commit.date,
        summary: commit.subject,
        revertedSha: reverted,
      });
    }

    for (const change of await changedFiles(g, commit.sha)) {
      if (change.status === "A") {
        addedBy.set(change.path, commit);
        continue;
      }
      if (change.status !== "D") continue;
      const added = addedBy.get(change.path);
      if (!added) continue;
      events.push({
        kind: "created-then-deleted",
        sha: commit.sha,
        date: commit.date,
        summary: `${change.path} added in ${added.sha.slice(0, 12)}, deleted in ${commit.sha.slice(0, 12)}`,
        file: change.path,
      });
      addedBy.delete(change.path);
    }
  }

  return events;
}
