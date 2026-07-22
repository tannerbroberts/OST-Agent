/**
 * Safe git surface.
 *
 * The ONLY git operations OST-Agent can perform. Each is a fixed invocation that
 * cannot be parameterized into a destructive form:
 *
 *   - gitInitIfAbsent — `git init` only when there is no repo yet
 *   - gitCommit       — stage everything in the vault + create a NEW commit
 *   - gitPush         — fast-forward push to a configured remote (no --force)
 *
 * There is deliberately no reset, no rm, no clean, no branch delete, no history
 * rewrite, and no force flag anywhere. History only ever grows.
 */
import fs from "node:fs";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";

export interface CommitResult {
  sha: string;
  /** false when there was nothing to commit (working tree already clean). */
  committed: boolean;
}

function git(dir: string): SimpleGit {
  return simpleGit(path.resolve(dir));
}

/** Initialize a git repo in `dir` if one is not already present. */
export async function gitInitIfAbsent(dir: string): Promise<boolean> {
  const abs = path.resolve(dir);
  fs.mkdirSync(abs, { recursive: true });
  if (fs.existsSync(path.join(abs, ".git"))) return false;
  await git(abs).init();
  return true;
}

/** Stage all changes under the vault and create a new commit. */
export async function gitCommit(dir: string, message: string): Promise<CommitResult> {
  const g = git(dir);
  await g.add(["-A"]);
  const status = await g.status();
  if (status.isClean()) {
    const sha = await g.revparse(["HEAD"]).catch(() => "");
    return { sha, committed: false };
  }
  await g.commit(message);
  const sha = await g.revparse(["HEAD"]);
  return { sha, committed: true };
}

/**
 * Fast-forward push the current branch to `remote`. Never force-pushes and never
 * deletes refs — the arguments are fixed to `push <remote> <branch>`.
 */
export async function gitPush(dir: string, remote = "origin"): Promise<void> {
  const g = git(dir);
  const branch = (await g.revparse(["--abbrev-ref", "HEAD"])).trim();
  await g.push(remote, branch);
}
