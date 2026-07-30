/**
 * Structural invariants — the deterministic layer of efficacy.
 *
 * These have a truth value regardless of the model: a well-formed Opportunity
 * Solution Tree must satisfy all of them, always. Violations are hard failures.
 * This is the floor beneath the (non-deterministic) faithfulness judge.
 */
import { BELIEVABILITY_LADDER } from "../knowledge/believability.js";
import { byTitle } from "../processes/tree.js";
import { laneConflicts } from "../ost/lanes.js";
import { wrappedLinkTargets, type OstNode } from "../ost/node.js";
import { unearnedRungs } from "./rungs.js";

export interface Violation {
  rule: string;
  node?: string;
  detail: string;
}

export function checkInvariants(tree: OstNode[]): Violation[] {
  const v: Violation[] = [];
  const index = byTitle(tree);
  const outcomes = tree.filter((n) => n.layer === "Outcome");

  // exactly one root outcome (its mandate lives in the body; identity is the node itself)
  if (outcomes.length !== 1) {
    v.push({ rule: "single-outcome", detail: `expected exactly 1 Outcome, found ${outcomes.length}` });
  }

  // no dangling links
  for (const n of tree) {
    for (const link of n.links) {
      if (!index.has(link)) v.push({ rule: "dangling-link", node: n.title, detail: `[[${link}]] has no node` });
    }
  }

  // no wikilink split across a line break — an edge the author wrote that the
  // graph does not have, and that the dangling-link rule above cannot see
  for (const n of tree) {
    for (const target of wrappedLinkTargets(n.body)) {
      v.push({
        rule: "wrapped-wikilink",
        node: n.title,
        detail: `[[${target}]] is split across a line break — it renders as text, not an edge; put it on one line`,
      });
    }
  }

  // every Opportunity is reachable from the outcome through Outcome/Opportunity edges
  const reachable = reachableOpportunities(tree, index);
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

  // every node declares what it rests on — an unlabelled node lets a reader
  // over-trust founder theory by mistaking it for evidence
  for (const n of tree) {
    if (!n.evidence) {
      v.push({
        rule: "evidence-class",
        node: n.title,
        detail: `declares no evidence class — add one of: ${BELIEVABILITY_LADDER.map((r) => r.id).join(", ")}`,
      });
    }
  }

  // an agent-ideated (#unvalidated) node must not also claim status: validated
  for (const n of tree) {
    if (n.tags.includes("unvalidated") && n.status === "validated") {
      v.push({ rule: "no-self-validation", node: n.title, detail: "carries the 'unvalidated' tag but status is 'validated' — contradiction" });
    }
  }

  // a test must not answer "may an unattended pass run this?" twice, differently.
  // Same shape as no-self-validation above — one node, two fields, opposite
  // claims — and a hard failure for the same reason: the fail-closed direction
  // of a lane is the safety argument, and a contradiction has no direction.
  // a node may not declare a measurement it cannot point at. The two rungs that
  // assert a recording happened — observed, money — are the ones no amount of
  // authorship confers, and the ladder's own comment says so; this is that
  // sentence computed rather than addressed to the model. Nodes predating B3's
  // guard land here too, which is the point of keeping it a detector.
  for (const u of unearnedRungs(tree)) {
    v.push({
      rule: "rung-unearned",
      node: u.node,
      detail: `declares '${u.declared}' but what it points at supports '${u.supported}' — ${u.missing}`,
    });
  }

  for (const c of laneConflicts(tree)) {
    v.push({
      rule: "lane-conflict",
      node: c.test,
      detail:
        `labelled ${c.labelled} but its own prose says "${c.quote}" — ` +
        (c.labelled === "compute-only"
          ? "an unattended pass will run it while the test says a person is needed; reconcile before it does"
          : "one of the two is stale; a human decides which"),
    });
  }

  return v;
}

function reachableOpportunities(tree: OstNode[], index: Map<string, OstNode>): Set<string> {
  const reachable = new Set<string>();
  // locate the outcome by layer (there is exactly one) so title punctuation can't break traversal
  const start = tree.find((n) => n.layer === "Outcome");
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
