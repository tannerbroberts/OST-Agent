import { describe, expect, test } from "vitest";
import { deserialize, serialize, type OstNode } from "../../src/ost/node.js";

describe("serialize / deserialize round-trip", () => {
  const node: OstNode = {
    title: "Daily challenge mode",
    layer: "Solution",
    status: "unvalidated",
    source: "JIRA:PROJ-1234",
    created: "2026-07-22",
    confidence: "low",
    tags: ["unvalidated"],
    links: ["A daily ritual will lift retention", "Solver logic can be reused"],
    body: "A seeded daily puzzle shared by all players. NOT built.\n\n## History\n- 2026-07-22 created (unvalidated)",
  };

  test("serialized output has the expected structure", () => {
    const md = serialize(node);
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("type: Solution");
    // tag line comes right after the frontmatter block
    const afterFm = md.split("---\n").slice(2).join("---\n");
    expect(afterFm.trimStart().startsWith("#Solution #unvalidated")).toBe(true);
    expect(md).toContain("[[A daily ritual will lift retention]]");
    expect(md).toContain("[[Solver logic can be reused]]");
  });

  test("round-trips to a deep-equal node", () => {
    const back = deserialize(node.title, serialize(node));
    expect(back).toEqual(node);
  });

  test("created round-trips through YAML date parsing", () => {
    const back = deserialize(node.title, serialize(node));
    expect(back.created).toBe("2026-07-22");
    expect(typeof back.created).toBe("string");
  });

  test("handles a minimal outcome node (no children, no extra tags)", () => {
    const outcome: OstNode = {
      title: "Reach 10,000 daily active users",
      layer: "Outcome",
      tags: [],
      links: ["I want a reason to come back every day"],
      body: "The single business outcome, set by leadership.",
    };
    const back = deserialize(outcome.title, serialize(outcome));
    expect(back).toEqual(outcome);
  });

  test("body wikilinks are not mistaken for structural child edges", () => {
    const n: OstNode = {
      title: "X",
      layer: "Opportunity",
      tags: [],
      links: ["Child A"],
      body: "See also [[Some other note]] in the prose.",
    };
    const back = deserialize(n.title, serialize(n));
    expect(back.links).toEqual(["Child A"]);
    expect(back.body).toContain("[[Some other note]]");
  });

  test("rejects an invalid layer type", () => {
    const bad = "---\ntype: Nonsense\n---\n#Nonsense\n\nbody\n";
    expect(() => deserialize("bad", bad)).toThrow();
  });
});
