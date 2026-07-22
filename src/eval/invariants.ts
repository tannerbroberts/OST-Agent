/**
 * Structural invariants — the deterministic layer of efficacy.
 *
 * These have a truth value regardless of the model: a well-formed Opportunity
 * Solution Tree must satisfy all of them, always. Violations are hard failures.
 * This is the floor beneath the (non-deterministic) faithfulness judge.
 */
import { byTitle } from "../processes/tree.js";
import type { OstNode } from "../ost/node.js";

export interface Violation {
  rule: string;
  node?: string;
  detail: string;
}

export function checkInvariants(tree: OstNode[], outcomeTitle: string): Violation[] {
  const v: Violation[] = [];
  const index = byTitle(tree);
  const outcomes = tree.filter((n) => n.layer === "Outcome");

  // exactly one outcome, and it is the human-set one
  if (outcomes.length !== 1) {
    v.push({ rule: "single-outcome", detail: `expected exactly 1 Outcome, found ${outcomes.length}` });
  } else if (outcomes[0].title !== outcomeTitle) {
    v.push({ rule: "outcome-identity", node: outcomes[0].title, detail: `Outcome is "${outcomes[0].title}", expected the human-set "${outcomeTitle}"` });
  }

  // no dangling links
  for (const n of tree) {
    for (const link of n.links) {
      if (!index.has(link)) v.push({ rule: "dangling-link", node: n.title, detail: `[[${link}]] has no node` });
    }
  }

  // every Opportunity is reachable from the outcome through Outcome/Opportunity edges
  const reachable = reachableOpportunities(tree, index, outcomeTitle);
  for (const n of tree) {
    if (n.layer === "Opportunity" && !reachable.has(n.title)) {
      v.push({ rule: "opportunity-connected", node: n.title, detail: "not connected to the outcome (directly or via a parent opportunity)" });
    }
  }

  // every Solution sits under at least one Opportunity
  for (const n of tree) {
    if (n.layer === "Solution") {
      const parents = tree.filter((p) => p.layer === "Opportunity" && p.links.includes(n.title));
      if (parents.length === 0) v.push({ rule: "solution-mapped", node: n.title, detail: "not linked under any Opportunity" });
    }
  }

  // every AssumptionTest sits under at least one Solution
  for (const n of tree) {
    if (n.layer === "AssumptionTest") {
      const parents = tree.filter((p) => p.layer === "Solution" && p.links.includes(n.title));
      if (parents.length === 0) v.push({ rule: "assumption-mapped", node: n.title, detail: "not linked under any Solution" });
    }
  }

  // an agent-ideated (#unvalidated) node must not also claim status: validated
  for (const n of tree) {
    if (n.tags.includes("unvalidated") && n.status === "validated") {
      v.push({ rule: "no-self-validation", node: n.title, detail: "carries the 'unvalidated' tag but status is 'validated' — contradiction" });
    }
  }

  return v;
}

function reachableOpportunities(tree: OstNode[], index: Map<string, OstNode>, outcomeTitle: string): Set<string> {
  const reachable = new Set<string>();
  const start = index.get(outcomeTitle);
  if (!start) return reachable;
  const stack = [...start.links];
  while (stack.length) {
    const title = stack.pop()!;
    const node = index.get(title);
    if (!node || node.layer !== "Opportunity" || reachable.has(title)) continue;
    reachable.add(title);
    for (const child of node.links) if (index.get(child)?.layer === "Opportunity") stack.push(child);
  }
  return reachable;
}
