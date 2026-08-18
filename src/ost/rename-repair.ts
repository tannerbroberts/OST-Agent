/**
 * Turning a rename-shaped break `findRenameShapedBreaks` found in history into
 * an edge repair on the LIVE tree.
 *
 * History and the live tree answer different questions on purpose. A break is
 * real topology the moment it happens, but by the time anyone reads it back a
 * human may already have fixed the edge by hand, or the old title may never
 * have been linked from anywhere else, or something may since have deleted
 * the new node too. None of that is visible from the commit alone — it is
 * only visible by reading the tree as it stands right now — which is why this
 * file, not the git walk, is where "does this still need repairing" gets
 * decided.
 */
import type { OstNode } from "./node.js";
import type { RenameShapedBreak } from "../git/rename-topology.js";

export interface RenameRepairTarget {
  /** The node whose outgoing edge still points at the vacated title. */
  parent: string;
  break: RenameShapedBreak;
}

/**
 * Which detected breaks are still live AND safe to repair against this tree.
 *
 * Three conditions, all required:
 *  - the old title resolves to no node today (otherwise the edge is not
 *    dangling — repairing it would be reattaching something that was never
 *    broken, on the strength of a stale commit)
 *  - the new title DOES resolve to a node today (the rename's destination
 *    has to exist to repoint anything at it)
 *  - some node currently carries an edge to the old title (nothing to repair
 *    otherwise)
 */
export function liveRenameRepairs(tree: readonly OstNode[], breaks: readonly RenameShapedBreak[]): RenameRepairTarget[] {
  const titles = new Set(tree.map((n) => n.title));
  const targets: RenameRepairTarget[] = [];
  for (const b of breaks) {
    if (titles.has(b.oldTitle) || !titles.has(b.newTitle)) continue;
    for (const n of tree) {
      if (n.links.includes(b.oldTitle)) targets.push({ parent: n.title, break: b });
    }
  }
  return targets;
}
