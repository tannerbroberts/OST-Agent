/**
 * "Believability ladder required on every node" — the definition of done named
 * two behaviours, not one: `ost_check` failing on an unlabelled node was already
 * true (the `evidence-class` invariant), but the weakest-rung rollup skipped
 * unlabelled nodes entirely, so a tree with nine `money` nodes and one
 * undeclared node reported `weakest: money` — a floor the undeclared node never
 * earned. Both are asserted here so neither can regress alone.
 */
import { describe, expect, test } from "vitest";
import { checkInvariants } from "../../src/eval/invariants.js";
import { believabilityRollup } from "../../src/knowledge/believability.js";
import { renderCheck } from "../../src/eval/render.js";
import type { TreeCensus } from "../../src/ost/census.js";
import type { OstNode } from "../../src/ost/node.js";

const OUT = "Reach 10,000 daily active users";
const node = (title: string, layer: OstNode["layer"], links: string[] = [], extra: Partial<OstNode> = {}): OstNode => ({
  title,
  layer,
  tags: [],
  links,
  body: "b",
  ...extra,
});

function censusOf(nodes: OstNode[]): TreeCensus {
  return { nodes, examined: nodes.length, seenFiles: nodes.map((n) => `${n.title}.md`), skipped: [], unreadable: [], quarantined: [], retired: [] };
}

describe("ost_check fails a vault holding any unlabelled node", () => {
  test("checkInvariants reports evidence-class for the one node that omits it", () => {
    const tree = [
      node(OUT, "Outcome", ["Opp"], { evidence: "assertion" }),
      node("Opp", "Opportunity", [], {}),
    ];
    const violations = checkInvariants(tree);
    expect(violations.some((v) => v.rule === "evidence-class" && v.node === "Opp")).toBe(true);
  });

  test("renderCheck — the text ost_check hands back — reads FAIL, not PASS", () => {
    const tree = [
      node(OUT, "Outcome", ["Opp"], { evidence: "assertion" }),
      node("Opp", "Opportunity", [], {}),
    ];
    const { text, violations } = renderCheck(censusOf(tree));
    expect(violations).toBeGreaterThan(0);
    expect(text).toMatch(/^invariants: FAIL/);
    expect(text).toContain("evidence-class");
  });
});

describe("the weakest-rung rollup is computed over every node", () => {
  test("an unlabelled node pulls the rollup to the floor, not past it", () => {
    const tree = [
      node(OUT, "Outcome", [], { evidence: "money" }),
      node("Opp", "Opportunity", [], { evidence: "money" }),
      node("Sol", "Solution", [], {}), // no rung declared
    ];
    const rollup = believabilityRollup(tree);
    expect(rollup.unlabelled).toBe(1);
    // Before the fix this read "money" — the strongest rung present — because
    // the undeclared node was invisible to the weakest-rung computation.
    expect(rollup.weakest).toBe("assertion");
  });

  test("a fully-labelled tree is unaffected: weakest is still its weakest declared rung", () => {
    const tree = [node("a", "Opportunity", [], { evidence: "money" }), node("b", "Opportunity", [], { evidence: "stated" })];
    expect(believabilityRollup(tree).weakest).toBe("stated");
  });
});
