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
import { spawn } from "node:child_process";
import { simpleGit } from "simple-git";
import {
  formatHelperRefusal,
  parseHelperManifest,
  preflightHelper,
  realMachineProbe,
  type HelperManifest,
  type MachineProbe,
} from "../runner/helper-manifest.js";

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
 * Run `git` in `dir`, feeding it `input` on stdin, and return raw stdout.
 *
 * `simple-git`'s `.raw()` has no stdin argument, and `git cat-file --batch`
 * needs one — the object ids to look up arrive on stdin, not as CLI args, which
 * is exactly what lets one process serve any number of lookups. Buffered, not
 * streamed: the batch output for a burst of vault notes is kilobytes, not
 * gigabytes, and a Buffer is what the byte-exact parser below needs.
 */
function runGitCapture(dir: string, args: string[], input?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: path.resolve(dir) });
    const chunks: Buffer[] = [];
    let errText = "";
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => {
      errText += d.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`git ${args.join(" ")} exited ${code}: ${errText.trim()}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    if (input !== undefined) child.stdin.write(input, "utf8");
    child.stdin.end();
  });
}

/**
 * The staged blob for every path in `files`, in the same order, or `null` for a
 * path the index has no entry for (already deleted, or a race with the index).
 *
 * **One process reads the index, one process reads every blob.** The version
 * this replaced spawned `git show :path` once PER FILE — correct, and O(n)
 * subprocess spawns, which is the whole cost at a few hundred files and became
 * the dominant one at a few thousand: a burst of 2,380 staged notes spent over
 * twenty seconds here alone, long enough to blow past this repo's own
 * `testTimeout` and, on the live MCP surface, to look indistinguishable from a
 * hang. `git ls-files -s` resolves every staged path's blob sha in one call;
 * `git cat-file --batch` then reads every blob in one more, over stdin — so the
 * subprocess count is 2 regardless of whether 3 files are staged or 30,000 are.
 */
async function stagedBlobs(dir: string, files: string[]): Promise<(Buffer | null)[]> {
  if (files.length === 0) return [];

  const lsOut = await runGitCapture(dir, ["ls-files", "-s", "-z"]);
  const pathToSha = new Map<string, string>();
  for (const entry of lsOut.toString("utf8").split("\0")) {
    if (!entry) continue;
    const tab = entry.indexOf("\t");
    if (tab === -1) continue;
    // "<mode> <sha> <stage>\t<path>"
    const sha = entry.slice(0, tab).split(" ")[1];
    if (sha) pathToSha.set(entry.slice(tab + 1), sha);
  }

  const shas = files.map((f) => pathToSha.get(f) ?? null);
  const known = shas.filter((s): s is string => s !== null);
  const batchOut =
    known.length > 0 ? await runGitCapture(dir, ["cat-file", "--batch"], `${known.join("\n")}\n`) : Buffer.alloc(0);

  // `--batch` answers requests in the order they were sent, each as a header
  // line ("<sha> <type> <size>", or "<sha> missing") followed by exactly
  // `<size>` bytes of content and a trailing newline — so the read position is
  // derived from sizes already seen, never assumed.
  const contents: (Buffer | null)[] = [];
  let offset = 0;
  for (const sha of shas) {
    if (sha === null) {
      contents.push(null);
      continue;
    }
    const nl = batchOut.indexOf(0x0a, offset);
    if (nl === -1) {
      contents.push(null);
      continue;
    }
    const header = batchOut.slice(offset, nl).toString("utf8");
    offset = nl + 1;
    const parts = header.split(" ");
    if (parts.length < 3) {
      contents.push(null); // "<sha> missing"
      continue;
    }
    const size = Number(parts[2]);
    contents.push(batchOut.subarray(offset, offset + size));
    offset += size + 1; // the newline `cat-file --batch` appends after content
  }
  return contents;
}

/**
 * Scan what is currently staged in `dir` for conflict blocks.
 *
 * Reads the **staged blob**, not the working-tree file: the commit captures the
 * index, so the index is what has to be clean. A file fixed on disk but staged
 * dirty is exactly the case this has to catch.
 */
export async function stagedConflictMarkers(dir: string): Promise<ConflictMarker[]> {
  const g = simpleGit(path.resolve(dir));
  // Added/Copied/Modified/Renamed — deletions have no content to scan.
  const raw = await g
    .raw(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
    .catch(() => "");
  const files = raw.split("\0").filter((f) => f.length > 0);
  if (files.length === 0) return [];

  const blobs = await stagedBlobs(dir, files);
  const markers: ConflictMarker[] = [];
  for (let i = 0; i < files.length; i++) {
    const blob = blobs[i];
    if (blob === null) continue;
    const content = blob.toString("utf8");
    if (!content || looksBinary(content)) continue;
    for (const hit of findConflictMarkers(content)) markers.push({ file: files[i], ...hit });
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
 *
 * **One `git grep --cached`, not one `git show :path` per staged file.** The
 * loop this replaced spawned a process per file, which a burst of a few
 * thousand staged notes turned into the dominant cost of committing them — long
 * enough to make an automated ingest pass that runs this hook on every commit
 * look hung. `git grep --cached` reads the whole index in one process and
 * emits only the candidate marker lines; the `awk` below re-derives the same
 * open/closes-later-in-the-same-file pairing over that sparse list, resetting
 * whenever the file column changes so an opener in one file can never be
 * closed by a marker in another. Safe to parse on a bare `:` split because
 * `sanitizeTitle` (src/ost/sanitize.ts) and evidence's `safeName` both strip
 * `:` from every filename this product ever writes.
 */
export const PRE_COMMIT_HOOK = `#!/bin/sh
${HOOK_SIGNATURE}
# Refuses any commit whose staged content carries an unresolved conflict block.
# Generated by ost-agent (src/git/conflict-guard.ts) — edits here are overwritten.
#
# What this hook needs from the machine it is installed on. Read by
# ensurePreCommitHook before the file is written, so a machine that cannot run
# it is told so instead of finding out at the first commit.
# ost-requires: interpreter sh — the hook is POSIX shell and uses nothing above it
# ost-requires: command git — reads the staged index with \`git diff --cached\` and \`git grep --cached\`
# ost-requires: command tr — splits git's NUL-separated path list into lines
# ost-requires: command awk — pairs each opening conflict marker with its close
files=$(git diff --cached --name-only --diff-filter=ACMR -z | tr '\\0' '\\n')
if [ -z "$files" ]; then
  exit 0
fi
set -f
set --
IFS='
'
for f in $files; do
  [ -n "$f" ] || continue
  set -- "$@" "$f"
done
unset IFS
set +f
report=$(git grep --cached -n -E -e '^<{7}([ \\t]|$)' -e '^>{7}([ \\t]|$)' -- "$@" 2>/dev/null | awk -F: '
  {
    file = $1; line = $2; content = $0
    sub(/^[^:]*:[^:]*:/, "", content)
    if (file != prevfile) { open = 0; prevfile = file }
    if (content ~ /^<{7}([ \\t]|$)/) { open = line; openline = content; next }
    if (content ~ /^>{7}([ \\t]|$)/) { if (open) { printf "  %s:%d  %s\\n", file, open, openline; open = 0 } }
  }')
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
  | "no-repo"
  /** The hook's own manifest is not satisfied here; the refusal names what is missing. */
  | `refused: ${string}`;

/** What the hook itself says it needs, read out of the source that gets written. */
export function preCommitHookManifest(): HelperManifest {
  return parseHelperManifest("pre-commit (ost-agent conflict guard)", PRE_COMMIT_HOOK);
}

/**
 * Install the `pre-commit` hook in `dir`, idempotently.
 *
 * **A hook we did not write is never touched.** Overwriting a contributor's own
 * `pre-commit` would be an edit-in-place of someone else's file to install a
 * guard — the exact class of action this project's safety invariant forbids — and
 * it would silently disable whatever that hook was doing. In that case this
 * returns without installing and the caller carries on: the in-process guard
 * still covers every route a run takes, which is the route that motivated this.
 *
 * **The hook's own preflight runs before it is written.** This is the one shell
 * helper this product puts on a machine, and the machine is the last place the
 * requirements and the hardware are both in view. A hook installed where `awk`
 * or `git grep` is absent does not fail loudly — it fails at the commit the
 * developer was in the middle of, naming a builtin they did not ask about. So a
 * machine that cannot run it is told so here and left without the file: the
 * in-process guard still covers every route a *run* takes, which is the same
 * fallback the untouched-hook branch above relies on.
 */
export function ensurePreCommitHook(dir: string, probe: MachineProbe = realMachineProbe()): HookInstall {
  const abs = path.resolve(dir);
  const gitDir = path.join(abs, ".git");
  if (!fs.existsSync(gitDir)) return "no-repo";
  // A worktree/submodule `.git` is a file pointing elsewhere; leave those be
  // rather than guess at another repository's hook directory.
  if (!fs.statSync(gitDir).isDirectory()) return "no-repo";

  const preflight = preflightHelper(preCommitHookManifest(), probe);
  if (!preflight.ok) return `refused: ${formatHelperRefusal(preflight)}`;

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
