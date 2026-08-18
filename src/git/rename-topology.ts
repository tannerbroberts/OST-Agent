/**
 * Rename-shaped link breaks, detected from git history — the topology a rename
 * leaves behind rather than any similarity between titles.
 *
 * "Detect renames from link topology and repair the edge" argues that a node
 * moved outside Obsidian's own rename path (a hand-edit, a second writer, a
 * script) can leave a vault with an emptied file at the old title still linked
 * from elsewhere, and a new file at a different title carrying the old node's
 * entire body and links. Title distance is a weak signal there — the incident
 * that motivated this went from "Trust an unmonitored agent enough to walk
 * away" to a completely different sentence — but the outgoing LINK SET survives
 * a rename untouched, because a rename does not touch what a node points at.
 * That is the signal this module looks for: within one commit, a node's file
 * goes empty while another appears carrying the exact link set the first one
 * carried the moment before.
 *
 * Deliberately blind to git's own `-M` rename detection (`--no-renames` is
 * passed explicitly below) — the point is to detect the case git's own
 * heuristic and Obsidian's rename path both miss, so leaning on either here
 * would test nothing.
 */
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { tryOutgoingLinks } from "../ost/node.js";

export interface RenameShapedBreak {
  /** The commit whose diff carries this break. */
  commit: string;
  /** Title of the node whose file went empty in this commit. */
  oldTitle: string;
  /** Title of the node whose file appeared in the same commit. */
  newTitle: string;
  /** The outgoing links shared between the two, i.e. the evidence for the match. */
  sharedLinks: string[];
}

interface FileChange {
  status: string;
  path: string;
}

function git(dir: string): SimpleGit {
  return simpleGit(path.resolve(dir));
}

async function commitsOldestFirst(g: SimpleGit): Promise<string[]> {
  let raw: string;
  try {
    raw = await g.raw(["log", "--reverse", "--format=%H"]);
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Path-status pairs for one commit's diff against its parent, renames turned off. */
async function changedFiles(g: SimpleGit, commit: string): Promise<FileChange[]> {
  let raw: string;
  try {
    raw = await g.raw(["show", "--no-renames", "--name-status", "--format=", commit]);
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

/** File content at `ref:filePath`, or null when it does not exist there. */
async function blobAt(g: SimpleGit, ref: string, filePath: string): Promise<string | null> {
  try {
    return await g.raw(["show", `${ref}:${filePath}`]);
  } catch {
    return null;
  }
}

/** True for two non-empty title lists holding exactly the same titles. */
function sameLinkSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  const as = [...a].sort();
  const bs = [...b].sort();
  return as.every((v, i) => v === bs[i]);
}

/**
 * Walk a vault's git history and report every rename-shaped break: a commit
 * where one node file went from carrying a link set to empty, and another
 * node file appeared in that same commit carrying that exact link set.
 *
 * Reports every match topology supports, whether or not the break still
 * matters to the CURRENT tree (a later commit may have already fixed it, or
 * the old title may no longer be linked from anywhere) — narrowing to what is
 * actionable today is the caller's job, because that answer depends on the
 * live tree and this function only ever looks at history.
 */
export async function findRenameShapedBreaks(vaultDir: string): Promise<RenameShapedBreak[]> {
  const g = git(vaultDir);
  const commits = await commitsOldestFirst(g);
  const breaks: RenameShapedBreak[] = [];

  for (const commit of commits) {
    const changed = (await changedFiles(g, commit)).filter((c) => c.path.endsWith(".md") && !c.path.includes("/"));
    if (changed.length < 2) continue; // a break needs both a vacated and an arrived file

    const vacated: { title: string; links: string[] }[] = [];
    const arrived: { title: string; links: string[] }[] = [];

    for (const c of changed) {
      const title = c.path.slice(0, -3);
      const after = c.status === "D" ? null : await blobAt(g, commit, c.path);
      const wentEmpty = after === null || after.trim() === "";

      if (wentEmpty && c.status !== "A") {
        const before = await blobAt(g, `${commit}~1`, c.path);
        const priorLinks = before ? tryOutgoingLinks(title, before) : null;
        if (priorLinks) vacated.push({ title, links: priorLinks });
      } else if (!wentEmpty && c.status === "A") {
        const links = tryOutgoingLinks(title, after as string);
        if (links) arrived.push({ title, links });
      }
    }

    for (const v of vacated) {
      for (const a of arrived) {
        if (sameLinkSet(v.links, a.links)) {
          breaks.push({ commit, oldTitle: v.title, newTitle: a.title, sharedLinks: [...v.links] });
        }
      }
    }
  }

  return breaks;
}
