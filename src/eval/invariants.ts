/**
 * Structural invariants — the deterministic layer of efficacy.
 *
 * These have a truth value regardless of the model: a well-formed Opportunity
 * Solution Tree must satisfy all of them, always. Violations are hard failures.
 * This is the floor beneath the (non-deterministic) faithfulness judge.
 *
 * **Which standard "always" means is a version.** These rules have been
 * tightened eleven times in forty days, and each tightening applied instantly to
 * every tree that already existed. A vault declares the ruleset version it is
 * held to ({@link ../ost/declared-ruleset.ts}) and `opts.ruleset` carries it
 * here; {@link ../knowledge/check-ruleset.ts} is the history and the argument.
 * Omit it and you get the latest, which is what every caller written before this
 * existed gets and what an undeclared vault gets.
 *
 * There are exactly THREE places below that read that version, and the count is
 * the point rather than an implementation detail — `versioned-rule-cost.test.ts`
 * greps this file for them and fails if a fourth appears without being recorded
 * as a boundary. Two are behavioural flags for the two rules whose verdict ever
 * changed in place; the third is the single lineage filter at the bottom, which
 * covers every rule that was ever added or removed.
 */
import {
  LATEST_CHECK_RULESET,
  behaviourLiveIn,
  rulesLiveIn,
} from "../knowledge/check-ruleset.js";
import { BELIEVABILITY_LADDER } from "../knowledge/believability.js";
import { byTitle } from "../processes/tree.js";
import { laneConflicts } from "../ost/lanes.js";
import { wrappedLinkTargets, type Layer, type OstNode } from "../ost/node.js";
import { prerequisiteCycles, unknownPrerequisites } from "../ost/prerequisites.js";
import { quarantinedParents, quarantinedTitles, type QuarantinedNode } from "../ost/quarantine.js";
import { unearnedRungs } from "./rungs.js";

export interface Violation {
  rule: string;
  node?: string;
  detail: string;
}

/**
 * @param quarantined Node-shaped files the reader could not classify
 * ({@link ../ost/quarantine.ts}). They are NOT checked — the reader cannot
 * classify them, so it has no business judging them — but they are read for two
 * things, and both turn symptoms back into their cause: an edge INTO one is not
 * dangling, and a node hanging BENEATH one is quarantined-parent rather than an
 * orphan. Defaults to none, so every caller that has no census behaves exactly
 * as it did.
 * @param opts.ruleset The check ruleset version this tree declared. Defaults to
 * the latest, so a caller that knows nothing about versions gets today's
 * standard — the direction that does not quietly stop checking things.
 */
export function checkInvariants(
  tree: OstNode[],
  quarantined: readonly QuarantinedNode[] = [],
  opts: { ruleset?: string } = {},
): Violation[] {
  const ruleset = opts.ruleset ?? LATEST_CHECK_RULESET;
  const v: Violation[] = [];
  const index = byTitle(tree);
  const outcomes = tree.filter((n) => n.layer === "Outcome");

  /*
   * Version conditional 1 of 3 — `quarantine-tolerance` (2026-08-31).
   *
   * Five rules changed verdict at that boundary and this is the only branch any
   * of them needs, because the change was already written as a parameter whose
   * default of `[]` reproduces the older behaviour exactly. Reproducing a
   * pre-quarantine `check` is therefore a decision about what to pass, taken
   * once, and not a branch inside `dangling-link`, `opportunity-connected`,
   * `solution-mapped`, `assumption-mapped` and `test-mapped` separately.
   */
  const seen = behaviourLiveIn("quarantine-tolerance", ruleset) ? quarantined : [];

  /*
   * Version conditional 2 of 3 — `assumption-layer` (2026-08-05).
   *
   * The one rule id in this file's whole history that survived a change of
   * meaning: before the Assumption layer, `assumption-mapped` named an
   * AssumptionTest under no Solution; after it, an Assumption under no Solution.
   * The lineage filter cannot express that — the id is live on both sides — so
   * this is the branch that shape costs.
   */
  const assumptionMappedLayer: Layer = behaviourLiveIn("assumption-layer", ruleset) ? "Assumption" : "AssumptionTest";

  const quarantinedTitle = quarantinedTitles(seen);
  const heldBy = quarantinedParents(seen);

  // exactly one root outcome (its mandate lives in the body; identity is the node itself)
  if (outcomes.length !== 1) {
    v.push({ rule: "single-outcome", detail: `expected exactly 1 Outcome, found ${outcomes.length}` });
  }

  // no dangling links
  //
  // A link onto a QUARANTINED title is not dangling and never was: the file is
  // right there on disk with a body and edges of its own, and calling the edge
  // broken sends a reader to repair the wrong end of it. The census names the
  // quarantine; this rule stays quiet about a target it can see.
  for (const n of tree) {
    for (const link of n.links) {
      if (index.has(link) || quarantinedTitle.has(link)) continue;
      v.push({ rule: "dangling-link", node: n.title, detail: `[[${link}]] has no node` });
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

  // The Outcome files categories, never the work itself.
  //
  // The bucket layer: the only children of the root are generic Opportunity
  // nodes ("Tools fail"), and the specific needs hang beneath those. Without it
  // the root accumulates an edge from every pass that ever touched it — 34 of
  // them here, one per need, which is a list rather than a map and gives a
  // reader no altitude to read from.
  //
  // Stated as an invariant rather than left to the rollup's advice because it is
  // the one structural rule a single call can break and no later pass would
  // notice: a Solution linked to the Outcome still satisfies `solution-mapped`
  // as long as some Opportunity also holds it, so nothing else in this file
  // would ever report it.
  // `Unknown` is exempt and that is not a loophole. An Unknown is a question the
  // tree cannot yet answer, not a piece of work: `CHILD_HIERARCHY` lets one hang
  // off any layer including the Outcome, because a question about the mandate
  // itself has nowhere else to live. It carries no solutions and no tests, so it
  // does not put work at the root — which is the thing this rule is about.
  for (const outcome of outcomes) {
    for (const link of outcome.links) {
      const child = index.get(link);
      if (!child) continue; // dangling is the other rule's business
      if (child.layer === "Opportunity" || child.layer === "Unknown") continue;
      v.push({
        rule: "outcome-files-categories",
        node: outcome.title,
        detail: `links [[${link}]], which is a ${child.layer} — only category Opportunities attach to the Outcome; put it under the opportunity it serves`,
      });
    }
  }

  // every Opportunity is reachable from the outcome through Outcome/Opportunity edges
  const reachable = reachableOpportunities(tree, index, seen);
  for (const n of tree) {
    if (n.layer === "Opportunity" && !reachable.has(n.title)) {
      v.push({ rule: "opportunity-connected", node: n.title, detail: "not connected to the outcome (directly or via a parent opportunity)" });
    }
  }

  /*
   * Inbound edges, indexed once.
   *
   * The four rules below all ask the same question — "who links to this node?" —
   * and three of them used to answer it with `tree.filter(...)` per node, which
   * is a full scan of the tree per Solution, per Assumption and per Test, with an
   * `Array.includes` inside each. At 10,000 nodes that is ~80M link comparisons
   * and it was 44% of all CPU in the Z3 benchmark: `ost_next_work` drifted from
   * ~620ms to ~1,600ms on the machine Z3 was measured on, and CI — a slower box —
   * crossed the 2,000ms budget six runs out of six while local runs still passed.
   * The gate was right and nobody had read it yet.
   *
   * The index was already here, built for `single-parent` twenty lines further
   * down; the three scans above it simply never used it. It holds parent NODES
   * rather than titles so the layer tests below need no second lookup, and it is
   * built exactly as `single-parent` built it — one entry per (parent, link)
   * occurrence, so a parent that lists the same child twice still counts twice
   * for that rule, as it always did.
   */
  const parentsOf = new Map<string, OstNode[]>();
  for (const p of tree) {
    for (const child of p.links) {
      const list = parentsOf.get(child);
      if (list) list.push(p);
      else parentsOf.set(child, [p]);
    }
  }

  // A node hanging beneath a quarantined parent is not an orphan.
  //
  // It has a parent; what is missing is the reader's ability to say what layer
  // that parent is. Reporting it under `solution-mapped` sends whoever reads the
  // finding to re-parent a node that is already parented, and it does so once per
  // child — nine findings for one edited `type:`, none of them naming the edit.
  // The quarantine itself is reported by the census and by `ost_next_work`, once,
  // naming these children as quarantined-parent.
  const heldByQuarantine = (title: string): boolean => heldBy.has(title);

  // every Solution sits under at least one Opportunity
  for (const n of tree) {
    if (n.layer === "Solution" && !heldByQuarantine(n.title)) {
      const parents = parentsOf.get(n.title) ?? [];
      if (!parents.some((p) => p.layer === "Opportunity"))
        v.push({ rule: "solution-mapped", node: n.title, detail: "not linked under any Opportunity" });
    }
  }

  // every Assumption sits under at least one Solution — or, under a ruleset
  // predating the Assumption layer, every AssumptionTest does (see
  // `assumptionMappedLayer` above; that is the same rule id meaning two things)
  for (const n of tree) {
    if (n.layer === assumptionMappedLayer && !heldByQuarantine(n.title)) {
      const parents = parentsOf.get(n.title) ?? [];
      if (!parents.some((p) => p.layer === "Solution"))
        v.push({ rule: "assumption-mapped", node: n.title, detail: "not linked under any Solution" });
    }
  }

  // every AssumptionTest sits under at least one Assumption — or, in a vault
  // written before that layer existed, directly under a Solution.
  //
  // The legacy parent is accepted for the reason `testsUnderSolution` spells
  // out: `check` is what CI and the loop gate on, so making it red on every
  // un-migrated vault would convert a schema addition into an outage for
  // everyone who did not ask for it. What is NOT tolerated is the shape being
  // written today — `CHILD_HIERARCHY` refuses a new Solution→AssumptionTest
  // edge, so the legacy branch can only ever shrink.
  for (const n of tree) {
    if (n.layer === "AssumptionTest" && !heldByQuarantine(n.title)) {
      const parents = parentsOf.get(n.title) ?? [];
      if (!parents.some((p) => p.layer === "Assumption" || p.layer === "Solution"))
        v.push({ rule: "test-mapped", node: n.title, detail: "not linked under any Assumption" });
    }
  }

  // no node has two parents — the tree is a tree, not a DAG
  //
  // Every rule above asks whether a node has *at least one* correctly-layered
  // parent. None of them ever asked how many, so a vault could satisfy the whole
  // hierarchy and still be a graph: the meta vault had three solutions hanging
  // under two opportunities each, and every walk that "handles" multi-parenting
  // (`subtree`, `rollupTree`) was really working around a shape nobody had
  // decided to allow.
  //
  // The ruleset already said this in prose — "place each node under its single
  // best-fit parent; if it plausibly fits two, flag for human review rather than
  // duplicating or double-linking" — so this is that sentence acquiring a check.
  // Counting is deliberately over ALL inbound edges rather than only
  // correctly-layered ones: two parents is two parents, and a node reached by one
  // legal and one illegal edge should report both problems, not have this one
  // hidden by the other.
  //
  // Reads the `parentsOf` index built above rather than building a second copy of
  // it — this rule is where that index was introduced, and the three hierarchy
  // rules now share it.
  for (const n of tree) {
    const held = parentsOf.get(n.title);
    if (held && held.length > 1) {
      v.push({
        rule: "single-parent",
        node: n.title,
        detail: `has ${held.length} parents (${held.map((p) => p.title).join("; ")}) — a node belongs under its single best-fit parent`,
      });
    }
  }

  // a title is wikilinked exactly once in the whole vault — by its parent
  //
  // `single-parent` counts EDGES: the contiguous `[[…]]` lines under the tag
  // line, which is all `links` holds. A wikilink inside a paragraph is not an
  // edge by that definition, so the tree can be a perfect one-parent tree while
  // a node is still linked from fifteen other bodies. Obsidian does not make
  // that distinction — it draws every wikilink it finds, wherever it sits — so
  // by the only measure a reader has, those are inbound edges and the graph is
  // not a tree. The meta vault had 2,214 of them across 920 nodes.
  //
  // A mention is not forbidden; a LINK is. "Some node" in prose costs nothing
  // and says the same thing, which is why the migration de-linked rather than
  // deleted.
  const linkedFrom = new Map<string, string[]>();
  for (const p of tree) {
    for (const child of p.links) {
      const list = linkedFrom.get(child);
      if (list) list.push(`${p.title} (edge)`);
      else linkedFrom.set(child, [`${p.title} (edge)`]);
    }
    for (const m of (p.body ?? "").matchAll(/\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]/g)) {
      const target = m[1].trim();
      const list = linkedFrom.get(target);
      if (list) list.push(`${p.title} (prose)`);
      else linkedFrom.set(target, [`${p.title} (prose)`]);
    }
  }
  for (const n of tree) {
    // The Outcome is the root and is linked by nobody; every other node is
    // linked exactly once. A node linked zero times is already reported by the
    // *-mapped rules, so this one only speaks to the surplus.
    const from = linkedFrom.get(n.title) ?? [];
    if (from.length > 1) {
      v.push({
        rule: "single-backlink",
        node: n.title,
        detail: `is wikilinked ${from.length} times (${from.join("; ")}) — exactly one link, from its parent; mention it elsewhere as plain text`,
      });
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
        `labelled ${c.labelled} but its own prose says "${c.quote}" (full sentence: "${c.sentence}") — ` +
        (c.labelled === "compute-only"
          ? "an unattended pass will run it while the test says a person is needed; reconcile before it does"
          : "one of the two is stale; a human decides which"),
    });
  }

  // A prerequisite edge naming something that is not a test in this tree.
  //
  // This is the rule the OST validator had to grow to hold prerequisites at all:
  // `dangling-link` reads a node's `[[wikilink]]` edges, and a prerequisite is
  // deliberately not one of those (see the field doc on `OstNode.prerequisites`),
  // so before this rule an ordering edge onto a title nobody wrote was invisible
  // to every gate. Loud rather than fail-closed on purpose: `unmetPrerequisites`
  // lets an unresolvable edge order NOTHING, so a typo cannot quietly withhold a
  // test from the runnable queue — it has to be repaired or annotated instead.
  for (const u of unknownPrerequisites(tree)) {
    v.push({
      rule: "prerequisite-unknown",
      node: u.test,
      detail:
        u.reason === "missing"
          ? `declares "${u.prerequisite}" as a prerequisite, but no node carries that title — the edge orders nothing`
          : `declares "${u.prerequisite}" as a prerequisite, but that node is a ${u.found} — a prerequisite orders one AssumptionTest against another`,
    });
  }

  // A prerequisite cycle: an ordering that can never start.
  //
  // The write path refuses one (`Vault.setPrerequisite`), so anything reaching
  // here arrived by hand edit, by import, or from a vault written before the
  // field — which is exactly the case a structural check exists for. Reported on
  // every member, because the tree cannot say which of the edges is the wrong
  // one and annotating any single node would otherwise hide the rest.
  for (const cycle of prerequisiteCycles(tree)) {
    const chain = [...cycle, cycle[0]].map((t) => `"${t}"`).join(" requires ");
    for (const member of cycle) {
      v.push({
        rule: "prerequisite-cycle",
        node: member,
        detail: `sits on a prerequisite cycle: ${chain} — every test on it waits on itself, so none can ever be first`,
      });
    }
  }

  /*
   * Version conditional 3 of 3 — the lineage filter.
   *
   * ONE branch covering every rule that was ever added or removed: ten of the
   * eleven recorded boundaries are that shape, and none of them costs a line in
   * this file. A rule that was not yet live under the declared ruleset is
   * computed and then dropped rather than skipped, which costs a little work on
   * a tree nobody is checking that rule against and buys the property this whole
   * scheme rests on — that adding a rule is a lineage entry and never a
   * conditional, so the eleventh tightening costs what the first one did.
   *
   * A rule this file can emit that the lineage never records would be filtered
   * out of every version at once, which is why the instrument asserts the two
   * sets are equal rather than trusting them to be.
   */
  const live = rulesLiveIn(ruleset);
  return v.filter((violation) => live.has(violation.rule));
}

/**
 * The walk traverses THROUGH a quarantined node rather than stopping at one.
 *
 * That is the whole "diagnosis, not symptom" rule applied to reachability. A
 * `type:` this reader does not know says nothing about whether the branch below
 * it hangs off the Outcome — on disk it plainly does — so treating quarantine as
 * a break reports every Opportunity beneath it as adrift. That is exactly the
 * shape the defect took: one edited `type:` produced four orphan Opportunities,
 * none of which was actually disconnected from anything.
 *
 * A quarantined node contributes its edges and nothing else: it is never added
 * to `reachable` (it is not an Opportunity — it is not classified at all), so it
 * cannot satisfy this rule on its own behalf.
 */
function reachableOpportunities(
  tree: OstNode[],
  index: Map<string, OstNode>,
  quarantined: readonly QuarantinedNode[],
): Set<string> {
  const reachable = new Set<string>();
  const through = new Map(quarantined.map((q) => [q.title, q.links]));
  // locate the outcome by layer (there is exactly one) so title punctuation can't break traversal
  const start = tree.find((n) => n.layer === "Outcome");
  if (!start) return reachable;
  const stack = [...start.links];
  const crossed = new Set<string>();
  while (stack.length) {
    const title = stack.pop()!;
    const held = through.get(title);
    if (held) {
      if (crossed.has(title)) continue;
      crossed.add(title);
      stack.push(...held);
      continue;
    }
    const node = index.get(title);
    if (!node || node.layer !== "Opportunity" || reachable.has(title)) continue;
    reachable.add(title);
    for (const child of node.links) if (index.get(child)?.layer === "Opportunity" || through.has(child)) stack.push(child);
  }
  return reachable;
}
