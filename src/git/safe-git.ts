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
 *
 * Because history only grows, a bad commit is permanent — so `gitCommit` refuses
 * one class of them outright: staged content carrying an unresolved conflict
 * block (see `./conflict-guard.ts`). It also installs the matching `pre-commit`
 * hook, which is what covers the commits a human makes in the same tree.
 */
import fs from "node:fs";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { assertNoStagedConflictMarkers, ensurePreCommitHook } from "./conflict-guard.js";

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
  const g = git(abs);
  await g.init();
  // Ensure commits succeed even where no global git identity is configured — a fresh
  // CI runner, a container, or a bare workstation. Only set a repo-local identity when
  // none is already resolvable, so we never override the user's real name/email.
  const hasIdentity = (await g.raw(["config", "user.email"]).catch(() => "")).trim().length > 0;
  if (!hasIdentity) {
    await g.addConfig("user.email", "ost-agent@localhost");
    await g.addConfig("user.name", "OST-Agent");
  }
  ensurePreCommitHook(abs);
  return true;
}

/**
 * Stage all changes under the vault and create a new commit.
 *
 * **Refuses when the index carries an unresolved conflict block.** A marker that
 * reaches a commit leaves the next run a repository that cannot build, and this
 * is the funnel every commit the product makes passes through — the MCP
 * auto-commit, the `git_commit` tool, `init`, `set-outcome`, the friction CLI.
 * The check runs after staging, because staging is what decides the content the
 * commit will hold, and it throws rather than returning a `committed: false`: a
 * clean tree is a legitimate no-op the caller reports, a staged conflict marker
 * is a mistake nobody should be able to skim past.
 */
export async function gitCommit(dir: string, message: string): Promise<CommitResult> {
  const g = git(dir);
  // Re-assert the hook on the way past: a vault initialized before this existed,
  // or one cloned fresh, has no hooks. Idempotent, and never overwrites a hook
  // this project did not write.
  ensurePreCommitHook(path.resolve(dir));
  await g.add(["-A"]);
  const status = await g.status();
  if (status.isClean()) {
    const sha = await g.revparse(["HEAD"]).catch(() => "");
    return { sha, committed: false };
  }
  await assertNoStagedConflictMarkers(dir);
  await g.commit(message);
  const sha = await g.revparse(["HEAD"]);
  return { sha, committed: true };
}

/**
 * Where a push may go, decided by the vault's config and by nothing else (P9).
 *
 * `gitPush` defaults its remote to `origin` and both call sites used to take the
 * default, so what left the machine was whatever `git remote add` had been run
 * in that directory — ambient state, set by anyone, invisible to the operator
 * reading `ost.config.yaml`, and never the thing they wrote down. The config
 * carried `remote.url` and *nothing read it*: the one field that says where the
 * vault publishes was decoration.
 *
 * So the target is resolved from the config here, and the two `enabled` cases
 * are kept apart because they are different facts:
 *
 *  - **disabled** — the operator said don't publish. Not an error; the caller
 *    reports the no-op.
 *  - **enabled with no `url`** — the operator asked for publication and did not
 *    say where. **Refused, fail-closed**, and this is the decision worth
 *    stating: falling back to `origin` would be guessing a destination for data
 *    the operator has already declared they care about the destination of, and a
 *    guess that happens to be right most of the time is exactly the shape of
 *    thing that is catastrophic the once it is wrong. A vault that today relies
 *    on an ambient `origin` will stop pushing and be told why, which is a
 *    louder and cheaper failure than a vault that quietly pushed somewhere else.
 *
 * The URL is passed to git as the remote argument. `git push <url> <branch>` is
 * a fast-forward push to that exact URL — no named remote is consulted, so a
 * local `origin` pointing elsewhere cannot redirect it.
 */
export type PushDecision =
  | { push: true; remote: string }
  | { push: false; reason: "disabled" | "no-url"; why: string };

export function pushTargetFor(remote: { enabled: boolean; url?: string }): PushDecision {
  if (!remote.enabled) {
    return { push: false, reason: "disabled", why: "remote push is disabled — no-op" };
  }
  const url = remote.url?.trim();
  if (!url) {
    return {
      push: false,
      reason: "no-url",
      why:
        "remote.enabled is true but remote.url is unset in ost.config.yaml — refusing to push. What leaves this " +
        "machine is decided by the vault's config, not by whatever `origin` happens to point at here. Set " +
        "remote.url, or set remote.enabled: false.",
    };
  }
  return { push: true, remote: url };
}

/**
 * Fast-forward push the current branch to `remote`. Never force-pushes and never
 * deletes refs — the arguments are fixed to `push <remote> <branch>`.
 *
 * The `remote` argument is unchanged and still defaults to `origin`: callers
 * resolve it through {@link pushTargetFor}, so the default is what a direct
 * in-process caller (a test) gets, never what the product ships with.
 */
export async function gitPush(dir: string, remote = "origin"): Promise<void> {
  const g = git(dir);
  const branch = (await g.revparse(["--abbrev-ref", "HEAD"])).trim();
  await g.push(remote, branch);
}
