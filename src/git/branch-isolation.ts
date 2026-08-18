/**
 * Branch isolation and reviewable merge.
 *
 * Two agent passes never write to the same working tree. Each takes a branch of
 * its own — a separate checkout, via `git worktree add`, not just a separate ref
 * — does its whole pass there, and the results are brought together afterwards
 * as one explicit merge. Concurrent work is fully supported; concurrent writing
 * to one set of files is not, because it was never asked to be: nothing here
 * lets two passes share an index.
 *
 * The merge half is deliberately thin. Append-only Markdown means two agents
 * appending to different node files touch disjoint paths and git merges those
 * without help. The genuine collisions — two nodes created with the same title,
 * two edits to one parent's link list, a status changed on both sides — are
 * exactly where an ordinary three-way merge already stops and leaves conflict
 * markers rather than picking a side; {@link mergeAgentBranch} calls plain
 * `git merge`, with no strategy option and no `-X ours`/`-X theirs`, so it can
 * never resolve one of those silently. A collision it cannot resolve is
 * reported, not swallowed: nothing here commits over a conflict, and
 * `gitCommit` (./safe-git.ts) already refuses a commit whose staged content
 * carries a marker if a caller tried anyway.
 *
 * Whether the *resolution* that follows a conflict is any good is out of scope
 * for this module on purpose — that is a person or a graded pass reading two
 * sides against what each meant, not something a merge command can assert.
 */
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";

function git(dir: string): SimpleGit {
  return simpleGit(path.resolve(dir));
}

export interface AgentBranch {
  /** Name of the branch the worktree is checked out on. */
  branch: string;
  /** Absolute path to the isolated working tree. */
  dir: string;
}

/**
 * Give one agent pass a working tree no other pass can write to.
 *
 * Creates `branch` off `base` (default: `mainDir`'s current `HEAD`) and checks
 * it out into `worktreeDir` via `git worktree add -b`. `mainDir`'s own checkout
 * is untouched — its `HEAD` does not move, and nothing written under
 * `worktreeDir` appears there until a merge brings it back. Two passes that
 * each call this, even against the same `mainDir`, get distinct directories,
 * distinct indexes, and distinct branches: there is no path by which one can
 * observe the other's uncommitted work.
 */
export async function createAgentBranch(
  mainDir: string,
  branch: string,
  worktreeDir: string,
  base = "HEAD",
): Promise<AgentBranch> {
  const dir = path.resolve(worktreeDir);
  await git(mainDir).raw(["worktree", "add", "-b", branch, dir, base]);
  return { branch, dir };
}

export interface MergeConflict {
  /** Repo-relative path git reports as unmerged. */
  file: string;
}

export interface MergeResult {
  /** True when the merge produced a new commit; false when it stopped on a conflict. */
  merged: boolean;
  /** `HEAD` after the call — the merge commit when clean, unchanged when conflicted. */
  sha: string;
  /** Empty when `merged` is true. One entry per path `git` reports as unmerged. */
  conflicts: MergeConflict[];
}

/**
 * Bring `branch` into `mainDir`'s current branch as one real merge commit — the
 * "deliberate, reviewable step" the node names. Never a rebase, never a squash:
 * a two-parent commit is what leaves a reviewer able to see both sides.
 *
 * Calls plain `git merge --no-ff`, with no strategy option, so it settles
 * exactly what an ordinary three-way merge would and never picks a side on its
 * own. When git stops short with unmerged paths, this returns them rather than
 * throwing or retrying with a strategy that would paper over the collision —
 * `merged: false`, the working tree left exactly as git left it (conflict
 * markers in place, nothing staged that resolves them), and the caller decides
 * what happens next.
 */
export async function mergeAgentBranch(mainDir: string, branch: string, message: string): Promise<MergeResult> {
  const g = git(mainDir);
  try {
    await g.merge(["--no-ff", "-m", message, branch]);
  } catch {
    // `simple-git`'s `.merge()` rejects on a stopped merge — git itself exits 1
    // — but a raw `git merge` invocation does not, since a conflict is git's
    // normal (non-fatal) way of reporting "stopped, needs a human". Reading the
    // conflicted paths back off the index, rather than trusting the rejected
    // error's own parse, is what stays correct regardless of which path
    // produced the rejection.
    const conflicted = await g.raw(["diff", "--name-only", "--diff-filter=U"]);
    const conflicts = conflicted
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean)
      .map((file) => ({ file }));
    const sha = await g.revparse(["HEAD"]);
    return { merged: false, sha, conflicts };
  }
  const sha = await g.revparse(["HEAD"]);
  return { merged: true, sha, conflicts: [] };
}
