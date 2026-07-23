/**
 * Serialized commit queue. Auto-commit-per-write means multiple CallTool
 * handlers may fire near-simultaneously; chaining every commit on one promise
 * guarantees `git add -A` + `commit` never interleave (which could otherwise
 * sweep one write's files into another write's commit). A rejected commit is
 * swallowed on the chain so a single failure cannot wedge all later commits.
 */
import { gitCommit, type CommitResult } from "../git/safe-git.js";

let chain: Promise<unknown> = Promise.resolve();

export function enqueueCommit(dir: string, message: string): Promise<CommitResult> {
  const next = chain.then(() => gitCommit(dir, message));
  chain = next.catch(() => undefined);
  return next;
}
