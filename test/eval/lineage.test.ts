/**
 * Where a report has been, computed rather than remembered.
 *
 * The graph is not a tree — nodes legitimately have several parents — so "the
 * lineage" is a choice, and these pin the choice: shortest path from the
 * Outcome, ties broken alphabetically. Both halves matter. Shortest because the
 * most direct framing is the most informative; alphabetical because the
 * alternative is file order, which would re-render the same node's lineage
 * differently after an unrelated rename and give the operator a different-looking
 * report about identical work.
 *
 * The cycle case is here because the first implementation walked UPWARD from the
 * node — follow the first inbound link, repeat — and on the real vault that
 * picked an arbitrary parent at every step and looped between three nodes,
 * reporting a path that visited the same solution four times.
 */
import { describe, expect, test } from "vitest";
import { lineageOf, renderLineage } from "../../src/eval/lineage.js";
import type { OstNode } from "../../src/ost/node.js";

const node = (title: string, layer: OstNode["layer"], links: string[] = []): OstNode => ({
  title,
  layer,
  status: "unvalidated",
  evidence: "assertion",
  tags: [],
  links,
  body: "prose",
});

const chain = (): OstNode[] => [
  node("Root", "Outcome", ["Tools fail"]),
  node("Tools fail", "Opportunity", ["My shell breaks"]),
  node("My shell breaks", "Opportunity", ["Ship a shim"]),
  node("Ship a shim", "Solution", ["Run it on five machines"]),
  node("Run it on five machines", "AssumptionTest"),
];

describe("lineageOf", () => {
  test("returns the whole path from the Outcome down", () => {
    expect(lineageOf(chain(), "Run it on five machines")).toEqual([
      "Root",
      "Tools fail",
      "My shell breaks",
      "Ship a shim",
      "Run it on five machines",
    ]);
  });

  test("renders arrow-separated with full titles, unclipped", () => {
    expect(renderLineage(lineageOf(chain(), "Ship a shim") as string[])).toBe(
      "Root → Tools fail → My shell breaks → Ship a shim",
    );
  });

  test("prefers the shorter path when a node has two parents", () => {
    const t = chain();
    t[0].links.push("Runs stall"); // a second bucket, one hop closer
    t.push(node("Runs stall", "Opportunity", ["Ship a shim"]));
    expect(lineageOf(t, "Ship a shim")).toEqual(["Root", "Runs stall", "Ship a shim"]);
  });

  test("breaks a tie alphabetically, not by file order", () => {
    const viaB = [
      node("Root", "Outcome", ["Bravo", "Alpha"]), // deliberately out of order
      node("Alpha", "Opportunity", ["Shared need"]),
      node("Bravo", "Opportunity", ["Shared need"]),
      node("Shared need", "Opportunity"),
    ];
    expect(lineageOf(viaB, "Shared need")).toEqual(["Root", "Alpha", "Shared need"]);
    // …and the same tree with the root's links reversed gives the same answer,
    // which is the property that makes the report stable.
    viaB[0].links = ["Alpha", "Bravo"];
    expect(lineageOf(viaB, "Shared need")).toEqual(["Root", "Alpha", "Shared need"]);
  });

  test("terminates on a cycle and does not revisit a node", () => {
    const t = chain();
    t[3].links.push("Tools fail"); // solution points back at its bucket
    const path = lineageOf(t, "Run it on five machines") as string[];
    expect(new Set(path).size).toBe(path.length);
  });

  test("null for an orphan — a one-element path would read as a top-level category", () => {
    const t = chain();
    t.push(node("Adrift", "Opportunity"));
    expect(lineageOf(t, "Adrift")).toBeNull();
  });

  test("null when the node does not exist, and when the vault has no root", () => {
    expect(lineageOf(chain(), "No such node")).toBeNull();
    expect(lineageOf([node("Lonely", "Opportunity")], "Lonely")).toBeNull();
  });

  test("the Outcome's own lineage is itself", () => {
    expect(lineageOf(chain(), "Root")).toEqual(["Root"]);
  });

  test("steps over a dangling link rather than throwing", () => {
    const t = chain();
    t[1].links.unshift("A node that was never created");
    expect(lineageOf(t, "Ship a shim")).toEqual(["Root", "Tools fail", "My shell breaks", "Ship a shim"]);
  });
});
