/**
 * Conflict-marker guard.
 *
 * A merge conflict once got committed into a source file, and the next run
 * inherited a repository that could not build. The marker itself was what
 * shipped — not a subtly wrong resolution, the literal `<<<<<<<` — so the fix is
 * to refuse at the moment of the mistake: no commit whose staged content carries
 * a conflict block is allowed to happen.
 *
 * Two mechanisms, because there are two kinds of route:
 *
 *  - **In-process** ({@link assertNoStagedConflictMarkers}) — every commit this
 *    product creates goes through `gitCommit`, which asks here first. This is the
 *    one that covers the routes a *run* takes: the MCP auto-commit, the
 *    `git_commit` tool, `init`, `set-outcome`, the friction CLI.
 *  - **A `pre-commit` hook** ({@link ensurePreCommitHook}) — covers the routes a
 *    *human* takes in the same working tree: `git commit`, `git commit --amend`,
 *    and the `git commit` that concludes a conflicted `git merge` or `git rebase`.
 *
 * What neither covers, stated rather than implied: `git commit --no-verify`
 * skips the hook, and a `git merge` that auto-merges cleanly creates its commit
 * without invoking `pre-commit` at all (verified against git 2.50). The former is
 * a human deliberately overriding; the latter cannot introduce a marker on its
 * own — git only writes markers when the merge *stops* — but it can carry in
 * commits from a branch that never passed this hook. Both are the "advisory, not
 * a guarantee" objection, and closing them means a check on the server side.
 */
import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";

/**
 * The start and end of a conflict block.
 *
 * **`=======` is deliberately not a marker on its own.** It is the middle line of
 * a conflict, and it is also a setext `<h1>` underline in Markdown — and this
 * product's entire working tree is a vault of Markdown. A scanner that flags a
 * bare row of equals signs refuses to commit ordinary prose, so the rule here is
 * a block: an opening `<<<<<<<` that some later line closes with `>>>>>>>`. That
 * pair is what git writes and what a human is essentially never writing on
 * purpose, which is where the "no false positives worth speaking of" claim
 * actually holds.
 */
const CONFLICT_START = /^<{7}(?:\s|$)/;
const CONFLICT_END = /^>{7}(?:\s|$)/;

export interface ConflictMarker {
  /** Repo-relative path of the staged file. */
  file: string;
  /** 1-based line number of the opening marker. */
  line: number;
  /** The opening marker line itself, trimmed, for the refusal message. */
  text: string;
}

/**
 * Locate conflict blocks in one file's text. A block counts only when an opening
 * marker is closed by a later `>>>>>>>` — see {@link CONFLICT_START}.
 */
export function findConflictMarkers(text: string): { line: number; text: string }[] {
  const lines = text.split(/\r?\n/);
  const found: { line: number; text: string }[] = [];
  let openAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (openAt === -1) {
      if (CONFLICT_START.test(line)) openAt = i;
    } else if (CONFLICT_END.test(line)) {
      found.push({ line: openAt + 1, text: lines[openAt].trimEnd() });
      openAt = -1;
    } else if (CONFLICT_START.test(line)) {
      // A second opener before any closer — the first one was never closed;
      // track the newer one so a real block later in the file is still caught.
      openAt = i;
    }
  }
  return found;
}

/** Heuristic: a NUL byte in the first block means git is holding a binary blob. */
function looksBinary(text: string): boolean {
  return text.slice(0, 8000).includes("\0");
}

/**
 * Scan what is currently staged in `dir` for conflict blocks.
 *
 * Reads the **staged blob** (`git show :path`), not the working-tree file: the
 * commit captures the index, so the index is what has to be clean. A file fixed
 * on disk but staged dirty is exactly the case this has to catch.
 */
export async function stagedConflictMarkers(dir: string): Promise<ConflictMarker[]> {
  const g = simpleGit(path.resolve(dir));
  // Added/Copied/Modified/Renamed — deletions have no content to scan.
  const raw = await g
    .raw(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
    .catch(() => "");
  const files = raw.split("\0").filter((f) => f.length > 0);
  const markers: ConflictMarker[] = [];
  for (const file of files) {
    const content = await g.raw(["show", `:${file}`]).catch(() => "");
    if (!content || looksBinary(content)) continue;
    for (const hit of findConflictMarkers(content)) markers.push({ file, ...hit });
  }
  return markers;
}

/** The refusal text, shared by the in-process guard and the hook. */
export function conflictRefusalMessage(markers: ConflictMarker[]): string {
  const where = markers.map((m) => `  ${m.file}:${m.line}  ${m.text}`).join("\n");
  return (
    `refusing to commit: staged content contains ${markers.length} unresolved conflict ` +
    `marker${markers.length === 1 ? "" : "s"}\n${where}\n` +
    `Resolve the conflict and stage the result. A commit carrying a marker leaves the ` +
    `next run a repository that cannot build.`
  );
}

/**
 * Throw unless the index is free of conflict blocks. Called by `gitCommit`, so
 * every commit route this product takes passes through it.
 */
export async function assertNoStagedConflictMarkers(dir: string): Promise<void> {
  const markers = await stagedConflictMarkers(dir);
  if (markers.length > 0) throw new Error(conflictRefusalMessage(markers));
}

/**
 * The line that identifies a hook as ours. Present in every version we write, so
 * an upgrade can recognize its own previous output and a hand-written hook is
 * never mistaken for one.
 */
export const HOOK_SIGNATURE = "# ost-agent: conflict-marker guard";

/**
 * The hook body. POSIX `sh` and git plumbing only — no node, no package
 * resolution, nothing that stops working when the hook fires from an editor's
 * git integration or a bare login shell.
 *
 * The `awk` mirrors {@link findConflictMarkers}: open on `<<<<<<<`, report only
 * when a later `>>>>>>>` closes it, never on a bare `=======`.
 */
export const PRE_COMMIT_HOOK = `#!/bin/sh
${HOOK_SIGNATURE}
# Refuses any commit whose staged content carries an unresolved conflict block.
# Generated by ost-agent (src/git/conflict-guard.ts) — edits here are overwritten.
#
# The scan runs inside a command substitution rather than a bare pipeline: a
# \`while\` on the right of a pipe is a subshell, so a flag set in it does not
# survive. Collecting the report as text and testing whether it is empty is the
# form that works in every POSIX sh.
report=$(git diff --cached --name-only --diff-filter=ACMR -z | tr '\\0' '\\n' | while IFS= read -r f; do
  [ -n "$f" ] || continue
  git show ":$f" 2>/dev/null | awk -v file="$f" '
    /^<<<<<<<([ \\t]|$)/ { open = NR; line = $0; next }
    /^>>>>>>>([ \\t]|$)/ { if (open) { printf "  %s:%d  %s\\n", file, open, line; open = 0 } }
  '
done)
if [ -n "$report" ]; then
  echo "refusing to commit: staged content contains unresolved conflict markers" >&2
  echo "$report" >&2
  echo "Resolve the conflict and stage the result. A commit carrying a marker leaves the next run a repository that cannot build." >&2
  exit 1
fi
exit 0
`;

export type HookInstall =
  | "installed"
  | "up-to-date"
  | "left-alone: a pre-commit hook this project did not write is already there"
  | "no-repo";

/**
 * Install the `pre-commit` hook in `dir`, idempotently.
 *
 * **A hook we did not write is never touched.** Overwriting a contributor's own
 * `pre-commit` would be an edit-in-place of someone else's file to install a
 * guard — the exact class of action this project's safety invariant forbids — and
 * it would silently disable whatever that hook was doing. In that case this
 * returns without installing and the caller carries on: the in-process guard
 * still covers every route a run takes, which is the route that motivated this.
 */
export function ensurePreCommitHook(dir: string): HookInstall {
  const abs = path.resolve(dir);
  const gitDir = path.join(abs, ".git");
  if (!fs.existsSync(gitDir)) return "no-repo";
  // A worktree/submodule `.git` is a file pointing elsewhere; leave those be
  // rather than guess at another repository's hook directory.
  if (!fs.statSync(gitDir).isDirectory()) return "no-repo";

  const hooks = path.join(gitDir, "hooks");
  const hook = path.join(hooks, "pre-commit");
  if (fs.existsSync(hook)) {
    const existing = fs.readFileSync(hook, "utf8");
    if (!existing.includes(HOOK_SIGNATURE)) {
      return "left-alone: a pre-commit hook this project did not write is already there";
    }
    if (existing === PRE_COMMIT_HOOK) {
      // Still make sure it can run — a checkout can drop the executable bit.
      fs.chmodSync(hook, 0o755);
      return "up-to-date";
    }
  }
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(hook, PRE_COMMIT_HOOK, { mode: 0o755 });
  fs.chmodSync(hook, 0o755);
  return "installed";
}
