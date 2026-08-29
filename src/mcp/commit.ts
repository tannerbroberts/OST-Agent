/**
 * Serialized commit queue. Auto-commit-per-write means multiple CallTool
 * handlers may fire near-simultaneously; chaining every commit on one promise
 * guarantees `git` commits never run concurrently — which would otherwise race
 * on `.git/index.lock` and throw. Under a burst, writes already on disk when a
 * commit fires are folded into that commit: still committed, still revertible,
 * nothing lost. A rejected commit is swallowed on the chain so one failure
 * cannot wedge later commits.
 *
 * **Every commit also stamps the firing lock's heartbeat.** This is the funnel
 * every mutation the product makes passes through, which makes it the one place
 * that knows a firing is still doing work rather than merely still having a pid.
 * A hung agent and a working one are the same process from outside; they are not
 * the same commit stream, and that difference is what lets a stale lock be
 * recovered in minutes instead of an hour (`../loop/lock.ts`).
 */
import { gitCommit, type CommitResult } from "../git/safe-git.js";
import { touchFiringLock } from "../loop/lock.js";

let chain: Promise<unknown> = Promise.resolve();

export function enqueueCommit(dir: string, message: string): Promise<CommitResult> {
  const next = chain.then(async () => {
    const result = await gitCommit(dir, message);
    // After the commit, not before: the heartbeat asserts progress happened, and
    // a stamp written ahead of a commit that then threw would assert work nobody
    // did. A no-op commit stamps too — a firing whose tree was already clean is
    // still a firing that ran a tool.
    touchFiringLock(dir);
    return result;
  });
  chain = next.catch(() => undefined);
  return next;
}
