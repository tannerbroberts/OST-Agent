/**
 * Serialized commit queue. Auto-commit-per-write means multiple CallTool
 * handlers may fire near-simultaneously; chaining every commit on one promise
 * guarantees `git` commits never run concurrently — which would otherwise race
 * on `.git/index.lock` and throw. Under a burst, writes already on disk when a
 * commit fires are folded into that commit: still committed, still revertible,
 * nothing lost. A rejected commit is swallowed on the chain so one failure
 * cannot wedge later commits.
 */
import { gitCommit, type CommitResult } from "../git/safe-git.js";

let chain: Promise<unknown> = Promise.resolve();

export function enqueueCommit(dir: string, message: string): Promise<CommitResult> {
  const next = chain.then(() => gitCommit(dir, message));
  chain = next.catch(() => undefined);
  return next;
}
