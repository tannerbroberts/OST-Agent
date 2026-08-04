/**
 * The path from the Outcome down to one node, for a report that has to say where
 * it has been.
 *
 * A build report used to open with what it did — "Built the conflict-marker
 * guard" — which tells an operator the verb and not the place. The tree is the
 * artifact this product produces, and a solution means something different
 * depending on which need it hangs under; a report that omits the branch makes
 * the reader reconstruct it from memory or not at all.
 *
 * **The graph is not a tree, so "the lineage" is a choice and this file is where
 * it is made.** Nodes legitimately have several parents — an opportunity may sit
 * under two categories, and the operator's own rule is that overlap should be
 * small rather than zero — so more than one path down to a node can exist. The
 * rule here is the shortest one, ties broken alphabetically. Shortest because the
 * most direct framing is the most informative one, and alphabetically because the
 * alternative is "whichever the walk happened to reach first", which is a
 * function of file order and would silently re-render the same node's lineage
 * differently after an unrelated rename.
 *
 * What this deliberately does NOT do is walk upward from the node. The obvious
 * implementation — follow the first inbound link, repeat — was written first and
 * was wrong in a way worth recording: with multiple parents it picks an arbitrary
 * one at every step, and on this product's own vault it walked into a cycle
 * between three nodes and reported a lineage that visited the same solution four
 * times. Downward BFS from the root cannot do that, because it never revisits.
 */
import type { OstNode } from "../ost/node.js";
import { byTitle } from "../processes/tree.js";

/**
 * The shortest Outcome→node path, or null when the node is unreachable.
 *
 * Null is a real answer and callers must handle it: an orphan has no lineage, and
 * so does a node in a vault with no root. Returning `[title]` for those would
 * render a one-element "lineage" that reads like a top-level category.
 */
export function lineageOf(tree: readonly OstNode[], target: string): string[] | null {
  const index = byTitle([...tree]);
  const root = tree.find((n) => n.layer === "Outcome");
  if (!root || !index.has(target)) return null;
  if (root.title === target) return [root.title];

  const seen = new Set<string>([root.title]);
  const queue: string[][] = [[root.title]];
  while (queue.length > 0) {
    const path = queue.shift() as string[];
    const node = index.get(path[path.length - 1]);
    if (!node) continue;
    // Sorted so the tie-break is the title's, not the file order's.
    for (const child of [...node.links].sort()) {
      if (seen.has(child) || !index.has(child)) continue;
      const next = [...path, child];
      if (child === target) return next;
      seen.add(child);
      queue.push(next);
    }
  }
  return null;
}

/** `A → B → C`. Full titles, unclipped — the archive keeps the whole report. */
export function renderLineage(path: readonly string[]): string {
  return path.join(" → ");
}
