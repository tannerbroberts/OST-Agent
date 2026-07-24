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
