import { describe, expect, test } from "vitest";
import { checkInvariants } from "../../src/eval/invariants.js";
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

describe("checkInvariants", () => {
  test("a well-formed tree has no violations", () => {
    const tree = [
      node(OUT, "Outcome", ["Opp"], { evidence: "assertion" }),
      node("Opp", "Opportunity", ["Sol"], { evidence: "stated" }),
      node("Sol", "Solution", ["Asm"], { tags: ["unvalidated"], status: "unvalidated", evidence: "assertion" }),
      node("Asm", "AssumptionTest", [], { tags: ["unvalidated"], status: "unvalidated", evidence: "assertion" }),
    ];
    expect(checkInvariants(tree)).toEqual([]);
  });

  test("flags a node that declares no evidence class", () => {
    const tree = [
      node(OUT, "Outcome", ["Opp"], { evidence: "assertion" }),
      node("Opp", "Opportunity", [], {}), // no rung: the reader cannot tell what it rests on
    ];
    const violations = checkInvariants(tree);
    expect(violations.some((v) => v.rule === "evidence-class" && v.node === "Opp")).toBe(true);
  });

  test("accepts a node once it declares where it sits on the ladder", () => {
    const tree = [
      node(OUT, "Outcome", ["Opp"], { evidence: "assertion" }),
      node("Opp", "Opportunity", [], { evidence: "observed" }),
    ];
    expect(checkInvariants(tree).filter((v) => v.rule === "evidence-class")).toEqual([]);
  });

  test("flags more than one outcome", () => {
    const tree = [node(OUT, "Outcome"), node("Other outcome", "Outcome")];
    expect(checkInvariants(tree).some((v) => v.rule === "single-outcome")).toBe(true);
  });

  test("flags an orphan opportunity not connected to the outcome", () => {
    const tree = [node(OUT, "Outcome"), node("Opp", "Opportunity")];
    expect(checkInvariants(tree).some((v) => v.rule === "opportunity-connected")).toBe(true);
  });

  test("accepts a nested opportunity reachable via a parent opportunity", () => {
    const tree = [
      node(OUT, "Outcome", ["Parent opp"]),
      node("Parent opp", "Opportunity", ["Child opp"]),
      node("Child opp", "Opportunity"),
    ];
    expect(checkInvariants(tree).some((v) => v.rule === "opportunity-connected")).toBe(false);
  });

  test("flags a solution not under any opportunity, and a dangling link", () => {
    const tree = [node(OUT, "Outcome", ["Ghost"]), node("Sol", "Solution")];
    const v = checkInvariants(tree);
    expect(v.some((x) => x.rule === "solution-mapped")).toBe(true);
    expect(v.some((x) => x.rule === "dangling-link")).toBe(true);
  });

  test("flags an assumption not under any solution", () => {
    const tree = [node(OUT, "Outcome", ["Opp"]), node("Opp", "Opportunity"), node("Asm", "AssumptionTest")];
    expect(checkInvariants(tree).some((v) => v.rule === "assumption-mapped")).toBe(true);
  });

  test("flags a node that is both unvalidated-tagged and status validated", () => {
    const tree = [
      node(OUT, "Outcome", ["Opp"]),
      node("Opp", "Opportunity", ["Sol"]),
      node("Sol", "Solution", [], { tags: ["unvalidated"], status: "validated" }),
    ];
    expect(checkInvariants(tree).some((v) => v.rule === "no-self-validation")).toBe(true);
  });
});

/**
 * A `[[…]]` that a hard-wrapped paragraph split across two lines is an edge the
 * author wrote and the graph does not have: the parser only reads whole-line
 * wikilinks, so a wrapped one is not a link at all — which is precisely why the
 * dangling-link rule cannot see it. Observed six times across the two live
 * vaults in three days, three of them reaching a commit.
 */
describe("wrapped-wikilink", () => {
  const tree = (body: string): OstNode[] => [
    node(OUT, "Outcome", ["Opp"], { evidence: "assertion" }),
    node("Opp", "Opportunity", [], { evidence: "stated", body }),
  ];
  const wrapped = (body: string) => checkInvariants(tree(body)).filter((v) => v.rule === "wrapped-wikilink");

  test("flags a wikilink whose target is split across a line break", () => {
    const v = wrapped("See\n[[What does an identity for every visitor cost — in money\nand in consent]] first.");
    expect(v).toHaveLength(1);
    expect(v[0].node).toBe("Opp");
    // The message must carry the flattened title, because that is what the
    // author meant and what the reader has to go and repair.
    expect(v[0].detail).toContain("What does an identity for every visitor cost — in money and in consent");
  });

  test("does not flag a well-formed inline wikilink", () => {
    expect(wrapped("A sentence mentioning [[Some other node]] inline.")).toEqual([]);
  });

  test("does not flag a paragraph whose line break falls outside the brackets", () => {
    expect(wrapped("A sentence mentioning [[Some other node]]\nwith the break after it.")).toEqual([]);
  });

  test("reports every wrapped link in a node, not just the first", () => {
    expect(wrapped("[[One title\nwrapped]] and [[Another title\nwrapped]]")).toHaveLength(2);
  });

  test("an unclosed [[ cannot swallow the rest of the body", () => {
    expect(wrapped("An unclosed [[ bracket\nfollowed by [[A real one]] on its own.")).toEqual([]);
  });

  test("fires independently of the dangling-link rule, which cannot see this case", () => {
    // The wrapped target exists as a node, so nothing is dangling — and the
    // edge is still missing from the graph.
    const t = [
      node(OUT, "Outcome", ["Opp"], { evidence: "assertion" }),
      node("Opp", "Opportunity", ["Sol"], { evidence: "stated", body: "leans on [[Sol\nutions we tried]]" }),
      node("Sol", "Solution", [], { evidence: "assertion", body: "b" }),
      node("Solutions we tried", "Solution", [], { evidence: "assertion", body: "b" }),
    ];
    const v = checkInvariants(t);
    expect(v.some((x) => x.rule === "dangling-link")).toBe(false);
    expect(v.filter((x) => x.rule === "wrapped-wikilink")).toHaveLength(1);
  });

  test("a clean tree stays clean", () => {
    expect(checkInvariants(tree("Plain prose with no links at all."))).toEqual([]);
  });
});

/**
 * A node that says one thing in the field the tool reads and another in the
 * sentence a human reads has, between its two halves, no answer to the only
 * question a lane exists to settle: may an unattended pass run this by itself?
 * Same shape as `no-self-validation` — a contradiction inside one node — and
 * treated the same way: a hard failure, because the fail-closed direction of a
 * lane is the whole safety argument and a contradiction has no direction.
 */
describe("lane-conflict", () => {
  const tree = (extra: Partial<OstNode>): OstNode[] => [
    node(OUT, "Outcome", ["Opp"], { evidence: "assertion" }),
    node("Opp", "Opportunity", ["Sol"], { evidence: "stated" }),
    node("Sol", "Solution", ["Asm"], { evidence: "assertion" }),
    node("Asm", "AssumptionTest", [], { evidence: "assertion", ...extra }),
  ];
  const conflicts = (extra: Partial<OstNode>) =>
    checkInvariants(tree(extra)).filter((v) => v.rule === "lane-conflict");

  test("fails when the label says compute may run it and the prose says a person is needed", () => {
    const v = conflicts({ lane: "compute-only", body: "**Lane: humans-required.** five players in a room" });
    expect(v).toHaveLength(1);
    expect(v[0].node).toBe("Asm");
    // Both readings must be in the message: the reader has to decide which is
    // wrong, and cannot do that from a message naming only one of them.
    expect(v[0].detail).toContain("compute-only");
    expect(v[0].detail).toContain("humans-required");
  });

  test("fails in the stale direction too — the tree still contradicts itself", () => {
    expect(conflicts({ lane: "humans-required", body: "**Lane: compute-only.** a regex" })).toHaveLength(1);
  });

  test("passes when label and prose agree", () => {
    expect(conflicts({ lane: "compute-only", body: "**Lane: compute-only.** a regex" })).toEqual([]);
  });

  test("passes when the prose declares nothing", () => {
    expect(conflicts({ lane: "compute-only", body: "a regex over two git histories" })).toEqual([]);
  });

  test("passes on an unclassified test that declares a lane — that is a suggestion, not a conflict", () => {
    expect(conflicts({ body: "**Lane: compute-only.** a regex" })).toEqual([]);
  });

  test("does not fail a node on the audit trail setLane wrote into its own ## History", () => {
    // The regression this rule was most likely to ship with: reclassifying a
    // test writes `lane: <prev> → <next>` under ## History, and a naive reader
    // sees <prev> as a competing declaration. Every reclassified node in every
    // vault would have gone red on its own paper trail.
    const body = [
      "It needs five players in a room.",
      "",
      "## History",
      "- 2026-07-26 lane: compute-only → humans-required — by Tanner — real people",
    ].join("\n");
    expect(conflicts({ lane: "humans-required", body })).toEqual([]);
  });

  test("does not fail a node whose declaration names two lanes — that is ambiguity, not conflict", () => {
    const body = "**Lane: compute-only for the census, humans-required for the fixing.**";
    expect(conflicts({ lane: "humans-required", body })).toEqual([]);
  });
});
