/**
 * Where the loop keeps its own records — inside `.git`, never in the working tree.
 *
 * The health ledger and the firing lock are the two files a firing MUST be able
 * to write, and both of them are files the tree must never contain. Every
 * mutating MCP tool commits with `git add -A` (`src/git/safe-git.ts:49`), so a
 * record written to `<vault>/.ost-agent/health/` is swept into the next
 * `mcp: <tool>` commit — a node file that no tool invocation explains (W2) and a
 * dirty working tree in front of an auto-committing tool (D5), manufactured on
 * every single firing.
 *
 * `.git/ost-agent/` avoids that by construction rather than by policy: git
 * refuses to track anything inside its own directory, so there is no `.gitignore`
 * to delete and no ordering to get right. It is also the correct *scope* for both
 * files — a lock is machine-local (a pushed lock is a lock that never breaks) and
 * a health record states what THIS machine observed, not what the repository
 * agreed happened.
 *
 * The consequence is worth stating plainly: a fresh clone has no ledger, so a
 * CI runner that checks out the vault every time (`examples/automation/
 * github-workflow.yml`) always reads "never fired" and the cadence gate always
 * says due. That path already has a scheduler — GitHub's `cron` — and the
 * cadence gate is for the machine that does not.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Name of the directory the loop's records live in, under the git dir. */
const STATE_DIRNAME = "ost-agent";

/**
 * Resolve `<vault>/.git`, following the `gitdir:` pointer a worktree or
 * submodule leaves there. Returns null when the directory is not a git
 * checkout at all — the callers that write treat that as a refusal to fire,
 * because a firing that cannot be recorded must not happen.
 */
function gitDir(vaultDir: string): string | null {
  const abs = path.resolve(vaultDir);
  const dotGit = path.join(abs, ".git");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dotGit);
  } catch {
    return null;
  }
  if (stat.isDirectory()) return dotGit;
  if (!stat.isFile()) return null;
  // A linked worktree's `.git` is a one-line file: `gitdir: <path>`.
  const pointer = fs.readFileSync(dotGit, "utf8").trim();
  const match = pointer.match(/^gitdir:\s*(.+)$/);
  if (!match) return null;
  return path.resolve(abs, match[1].trim());
}

/** The loop's state directory, or null when this vault has nowhere to record. */
export function loopStateDir(vaultDir: string): string | null {
  const git = gitDir(vaultDir);
  return git === null ? null : path.join(git, STATE_DIRNAME);
}

/**
 * The loop's state directory, created, or a throw naming the reason.
 *
 * Deliberately not fail-open. If the record cannot be written the firing does
 * not get to happen: `computeMayRun` returns false when it does not know, and a
 * firing whose health nobody can read afterwards is the state this whole gate
 * exists to prevent.
 */
export function requireLoopStateDir(vaultDir: string): string {
  const dir = loopStateDir(vaultDir);
  if (dir === null) {
    throw new Error(
      `${path.resolve(vaultDir)} is not a git checkout — the loop records every firing under .git/ost-agent/ ` +
        "and refuses to fire where it cannot record. Run `ost-agent init` or `git init` there first.",
    );
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The vault's current commit, or undefined when there isn't one (no repo, no
 * commits yet, git not on PATH). Read-only: `rev-parse` cannot mutate anything,
 * and it is the one fact about a firing that the agent driving it cannot reach —
 * which is what makes it usable as the "did this firing do anything" signal.
 */
export function gitHead(vaultDir: string): string | undefined {
  const r = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: path.resolve(vaultDir),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const sha = r.status === 0 ? (r.stdout ?? "").trim() : "";
  return sha.length > 0 ? sha : undefined;
}
