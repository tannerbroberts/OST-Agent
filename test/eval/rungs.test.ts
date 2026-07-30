/**
 * B8, as a test rather than a remembered finding.
 *
 * The criterion's check reads: run `checkInvariants` on a Solution declaring
 * `evidence: money` with no result of any kind. It returned `[]`. The first test
 * below is that check verbatim; the rest pin the boundaries the detector has to
 * hold to not become a rule someone turns off — what a result licenses, what a
 * source licenses, and the three rungs it deliberately does not police.
 */
import { describe, expect, test } from "vitest";
import { checkInvariants } from "../../src/eval/invariants.js";
import { unearnedRungs } from "../../src/eval/rungs.js";
import type { OstNode } from "../../src/ost/node.js";

const OUT = "Grow paid retention";

const node = (title: string, layer: OstNode["layer"], links: string[] = [], extra: Partial<OstNode> = {}): OstNode => ({
  title,
  layer,
  tags: [],
  links,
  body: "prose",
  ...extra,
});

/** A legal tree whose one Solution declares whatever the caller is testing. */
const treeWith = (sol: Partial<OstNode>, tests: OstNode[] = []): OstNode[] => [
  node(OUT, "Outcome", ["Opp"], { evidence: "assertion" }),
  node("Opp", "Opportunity", ["Sol"], { evidence: "stated" }),
  node("Sol", "Solution", tests.map((t) => t.title), { evidence: "assertion", ...sol }),
  ...tests,
];

describe("rung-unearned", () => {
  test("B8: a Solution declaring money with no result of any kind is reported", () => {
    const violations = checkInvariants(treeWith({ evidence: "money" }));
    const found = violations.filter((v) => v.rule === "rung-unearned");
    expect(found).toHaveLength(1);
    expect(found[0].node).toBe("Sol");
    expect(found[0].detail).toMatch(/declares 'money'/);
    // The detail has to say how to get out, because both gates quote it.
    expect(found[0].detail).toMatch(/## Results|declare the rung/);
  });

  test("a result on the node itself backs money", () => {
    const tree = treeWith({ evidence: "money", body: "## Results\n41 of 120 trial teams paid on day one." });
    expect(unearnedRungs(tree)).toEqual([]);
  });

  test("a result on a test beneath it backs money — the relation gateSolution already uses", () => {
    const asm = node("Asm", "AssumptionTest", [], { evidence: "observed", body: "## Results\nseven of ten converted" });
    expect(unearnedRungs(treeWith({ evidence: "money" }, [asm]))).toEqual([]);
  });

  test("a result two layers down does not back it — one level, not the transitive closure", () => {
    // A grandchild's result must not launder a claim on the Opportunity above it.
    const tree = [
      node(OUT, "Outcome", ["Opp"], { evidence: "assertion" }),
      node("Opp", "Opportunity", ["Sol"], { evidence: "money" }),
      node("Sol", "Solution", ["Asm"], { evidence: "assertion" }),
      node("Asm", "AssumptionTest", [], { evidence: "assertion", body: "## Results\nit worked" }),
    ];
    expect(unearnedRungs(tree).map((u) => u.node)).toEqual(["Opp"]);
  });

  test("observed is backed by TRANSCRIPT provenance — a recording is what the rung claims", () => {
    expect(unearnedRungs(treeWith({ evidence: "observed", source: "TRANSCRIPT:session-4" }))).toEqual([]);
  });

  test("the same provenance does not back money — a source can describe a measurement, not price it", () => {
    const found = unearnedRungs(treeWith({ evidence: "money", source: "TRANSCRIPT:session-4" }));
    expect(found).toHaveLength(1);
    expect(found[0].supported).toBe("observed");
  });

  test("a stated-tier source does not back observed, and the violation names the classification", () => {
    const found = unearnedRungs(treeWith({ evidence: "observed", source: "JIRA:PROJ-1" }));
    expect(found).toHaveLength(1);
    expect(found[0].supported).toBe("stated");
    expect(found[0].missing).toMatch(/JIRA:PROJ-1/);
  });

  test("stated, expert and assertion are not policed here — B3's wire and B6's namespace own those", () => {
    for (const rung of ["stated", "expert", "assertion"] as const) {
      expect(unearnedRungs(treeWith({ evidence: rung })), rung).toEqual([]);
    }
  });

  test("an unlabelled node is evidence-class's finding, not this one", () => {
    const tree = treeWith({ evidence: undefined });
    expect(unearnedRungs(tree)).toEqual([]);
    expect(checkInvariants(tree).some((v) => v.rule === "evidence-class")).toBe(true);
  });
});
