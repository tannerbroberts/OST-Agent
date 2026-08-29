/**
 * How much work is waiting behind each item on the frontier.
 *
 * `ost-agent buildable` emits a frontier — every solution a builder could start
 * on today — and until now the order over it was affordability, then the
 * believability rung, then the order the files happened to be walked in. On a
 * vault whose solutions all rest on the same rung and whose tests are all
 * unlabelled, the first two terms tie on nearly everything and the frontier
 * comes back alphabetical. Alphabetical is not a ranking; and affordability,
 * which is the only term that ever separates anything, ranks by what a step
 * COSTS. Efficiency in a dependency graph is not a property of individual
 * steps: a cheap step that unblocks nothing is worse than an expensive one that
 * unblocks nine, and any ordering that reads items one at a time cannot see the
 * difference.
 *
 * So this module computes the other quantity — for each frontier item, how many
 * other outstanding nodes are waiting behind it — and it computes it over the
 * parent/child edges the tree already has. It asks nothing of the operator and
 * nothing of a model, which is the whole reason this is the cheapest route to a
 * defensible order.
 *
 * ## What "waiting behind it" means, exactly
 *
 * Two sets, unioned:
 *
 *   1. **Its own subtree.** A red instrument beneath a solution cannot go green
 *      until the solution is built, and the assumption above that instrument
 *      cannot be settled until it does. Everything outstanding under a frontier
 *      item is waiting on that item by construction.
 *   2. **The branch it is the only live route through.** Walk up from the item:
 *      an ancestor whose whole subtree contains exactly ONE frontier item is an
 *      ancestor that cannot move until that item does — every other candidate
 *      beneath it is unbuildable today, so nothing else in that branch can
 *      produce evidence. Everything outstanding under such an ancestor is
 *      waiting behind this item too. The walk continues while that stays true
 *      and stops at the first ancestor with a second live route, because an
 *      opportunity holding two buildable candidates is not blocked on either
 *      one of them.
 *
 * Set union, not sum: a node waiting behind an item is counted once however
 * many ways it is reachable. `soleRouteFor` names the ancestors that term 2
 * added, so a reader can check the claim by opening the branch instead of
 * taking a number's word for it.
 *
 * ## What it cannot do, stated before anyone reads a rank off it
 *
 * It cannot weigh how much any of it matters. It will happily put a
 * heavily-depended-upon branch at the top when the whole branch is aimed at
 * something nobody wants, and it rewards whatever the tree has recorded most
 * densely — a branch that is well-mapped because it was easy to map outranks a
 * sparse branch that matters more, and the ordering looks rigorous while doing
 * it. Sizing and importance are genuinely human inputs and this deliberately
 * does not ask for them.
 */
import { hasRecordedResult } from "../eval/evidence-debt.js";
import type { OstNode } from "./node.js";

/** What one frontier item is carrying, and where the weight came from. */
export interface UnblockingWeight {
  /**
   * How many OTHER outstanding nodes are waiting behind this item — the number
   * the frontier is ordered by. Never counts the item itself, and never counts
   * the same node twice.
   */
  unblocks: number;
  /**
   * The ancestors this item is the only live route through, nearest first.
   * Empty when the item carries only its own subtree, which is the ordinary
   * case for a candidate sitting beside other buildable siblings.
   */
  soleRouteFor: string[];
}

/** A weight for an item nothing is waiting behind — the shape a miss returns. */
export const NOTHING_WAITING: UnblockingWeight = { unblocks: 0, soleRouteFor: [] };

/**
 * Is this node still waiting on something, or is it settled?
 *
 * `hasRecordedResult` is the repository's existing answer for a test — a
 * `## Results` section, or a human promoting it to `validated` — and it is
 * reused rather than restated so the two cannot drift. Beyond it, `shipped` and
 * `deferred` are settled too: the first was built, the second was abandoned,
 * and neither is work anybody is blocked on. Everything else counts.
 */
function stillOutstanding(node: OstNode): boolean {
  if (node.status === "shipped" || node.status === "deferred") return false;
  return !hasRecordedResult(node);
}

/**
 * Title → first parent seen in a whole-tree walk.
 *
 * "First seen" is the same rule `computeNextWork` uses for its parent lookups,
 * and it is what makes this total on a vault that has violated `single-parent`:
 * a node with two parents gets the one the walk reached first rather than an
 * exception, because a ranking that throws on a malformed tree is a ranking
 * nobody can run when they most need it.
 */
function firstParents(tree: readonly OstNode[], index: Map<string, OstNode>): Map<string, string> {
  const parent = new Map<string, string>();
  for (const p of tree) {
    for (const link of p.links) {
      if (index.has(link) && !parent.has(link)) parent.set(link, p.title);
    }
  }
  return parent;
}

/**
 * Every title in this node's branch, itself included — cycle-safe the same way
 * `opportunitiesServedBeneath` is: a back edge is simply already visited.
 * Dangling links contribute nothing; `ost-agent check` reports those on its own.
 */
function subtree(root: string, index: Map<string, OstNode>): Set<string> {
  const seen = new Set<string>([root]);
  const queue = [root];
  for (let head = 0; head < queue.length; head++) {
    const node = index.get(queue[head]);
    if (!node) continue;
    for (const link of node.links) {
      if (seen.has(link) || !index.has(link)) continue;
      seen.add(link);
      queue.push(link);
    }
  }
  return seen;
}

/**
 * The unblocking weight of every item on `frontier`, keyed by title.
 *
 * `frontier` is supplied rather than derived: this module ranks the queue, it
 * does not decide who is in it — the same split `rankBuildableWork` already
 * keeps with `buildableSolutions`. A title that names no node in the tree gets
 * {@link NOTHING_WAITING}, because an item that is not in the graph has nothing
 * behind it in the graph.
 */
export function unblockingWeights(
  tree: readonly OstNode[],
  frontier: readonly string[],
): Map<string, UnblockingWeight> {
  const index = new Map<string, OstNode>();
  for (const n of tree) index.set(n.title, n);
  const parent = firstParents(tree, index);
  const live = frontier.filter((t) => index.has(t));

  /*
   * How many frontier items each ancestor holds beneath it.
   *
   * Counted by walking UP from each frontier item rather than down from each
   * ancestor: the up-walk is O(frontier × depth) and the down-walk would
   * materialize a subtree per node. The `guard` is the cycle stop — a parent
   * chain that loops would otherwise increment forever.
   */
  const liveRoutes = new Map<string, number>();
  for (const title of live) {
    const guard = new Set<string>([title]);
    for (let up = parent.get(title); up !== undefined && !guard.has(up); up = parent.get(up)) {
      guard.add(up);
      liveRoutes.set(up, (liveRoutes.get(up) ?? 0) + 1);
    }
  }

  const weights = new Map<string, UnblockingWeight>();
  for (const title of frontier) {
    if (!index.has(title)) {
      weights.set(title, NOTHING_WAITING);
      continue;
    }
    // Climb while this item is the only live route through the ancestor. The
    // topmost qualifying ancestor's subtree CONTAINS every lower one's, so the
    // union is that one branch and only one set has to be materialized.
    const soleRouteFor: string[] = [];
    let top = title;
    const guard = new Set<string>([title]);
    for (let up = parent.get(title); up !== undefined && !guard.has(up); up = parent.get(up)) {
      if (liveRoutes.get(up) !== 1) break;
      guard.add(up);
      soleRouteFor.push(up);
      top = up;
    }
    let unblocks = 0;
    for (const behind of subtree(top, index)) {
      if (behind === title) continue;
      if (stillOutstanding(index.get(behind)!)) unblocks++;
    }
    weights.set(title, { unblocks, soleRouteFor });
  }
  return weights;
}
