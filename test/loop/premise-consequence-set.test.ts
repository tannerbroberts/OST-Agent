/**
 * Shape spec for "Derive the whole consequence set from the premise and ask about
 * all of it at once". The fixture below is the seven questions the opportunity
 * node "One migration stopped me seven times…" records, hand-arranged into the
 * dependency structure the node itself describes — 1 through 4 as consequences of
 * the stated premise, 5 through 7 as consequences of the route chosen in 4.
 *
 * This does NOT certify that a blind derivation would find those seven — that is
 * the assumption test's question ("Try to derive the seven questions from the
 * premise alone…"), run by a human and recorded on its own node. What this file
 * checks is what a green there would still need underneath it: the set presented
 * as one batch, the dependency links intact and load-bearing, and a later question
 * told apart from one the batch already covers.
 */
import { describe, expect, it } from "vitest";
import {
  classifyEncounter,
  formatConsequenceBatch,
  validateConsequenceSet,
  type ConsequenceSet,
} from "../../src/loop/premise-consequence.js";

const PREMISE = "only serve Claude subscription users";

function sevenItemSet(): ConsequenceSet {
  return {
    premise: PREMISE,
    items: [
      {
        id: "1",
        question: "Does that mean changing how it ships, or also cutting the API-key-billed autonomous runner?",
        default: "change how it ships; leave the autonomous runner for a separate decision",
      },
      {
        id: "2",
        question: "How should the plugin start the MCP server once npm is gone?",
        default: "bundle the server into the plugin itself",
      },
      {
        id: "3",
        question: "What happens to the already-published ost-agent package on npm?",
        default: "deprecate it in place, pointing at the plugin",
      },
      {
        id: "4",
        question: "Where should the implementation happen — isolated worktree or in place?",
        default: "isolated worktree",
      },
      {
        id: "5",
        question:
          "The refusal message now exists as two identical string templates, violating the plan's own " +
          "single-sourcing constraint — how to resolve?",
        dependsOn: "4",
        default: "single-source the template before merging the worktree",
      },
      {
        id: "6",
        question:
          "ost-agent tool ost_status throws as of this commit, and the next task deletes that command entirely " +
          "— reviewer says needs fixes, plan says delete. Which?",
        dependsOn: "4",
        default: "delete, per the plan",
      },
      {
        id: "7",
        question:
          "Deleting the runner severed evidence ingestion and the MCP surface never had it — how should we close it?",
        dependsOn: "4",
        default: "route ingestion through the MCP surface before the runner is gone",
      },
    ],
  };
}

describe("validateConsequenceSet", () => {
  it("accepts a well-formed set", () => {
    expect(validateConsequenceSet(sevenItemSet())).toEqual([]);
  });

  it("flags a dependency on an id that is not in the set", () => {
    const set = sevenItemSet();
    set.items[4] = { ...set.items[4], dependsOn: "99" };
    const issues = validateConsequenceSet(set);
    expect(issues).toContainEqual(expect.objectContaining({ itemId: "5" }));
  });

  it("flags a forward reference — a dependency link may only run backward", () => {
    // #1 depending on #4 would mean the operator meets a reference to a decision
    // they have not read yet, which defeats the whole point of the batch.
    const set = sevenItemSet();
    set.items[0] = { ...set.items[0], dependsOn: "4" };
    const issues = validateConsequenceSet(set);
    expect(issues.some((i) => i.itemId === "1")).toBe(true);
  });

  it("flags a duplicate id", () => {
    const set = sevenItemSet();
    set.items[1] = { ...set.items[1], id: "1" };
    const issues = validateConsequenceSet(set);
    expect(issues.some((i) => i.itemId === "1" && i.problem.includes("duplicate"))).toBe(true);
  });
});

describe("formatConsequenceBatch", () => {
  it("presents every item together in one read, not one at a time", () => {
    const text = formatConsequenceBatch(sevenItemSet());
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      expect(text).toContain(`${n}. `);
    }
  });

  it("states each item's dependency and its proposed default", () => {
    const text = formatConsequenceBatch(sevenItemSet());
    expect(text).toMatch(/1\. .*depends on: the premise .*default: change how it ships/);
    expect(text).toMatch(/5\. .*depends on: #4 .*default: single-source the template/);
  });

  it("shows that #4 is why #5, #6 and #7 exist — the link the node calls load-bearing", () => {
    const text = formatConsequenceBatch(sevenItemSet());
    const lines = text.split("\n");
    const item4Line = lines.findIndex((l) => l.startsWith("4. "));
    expect(item4Line).toBeGreaterThanOrEqual(0);
    const unlockLine = lines[item4Line + 1];
    expect(unlockLine).toContain("#5");
    expect(unlockLine).toContain("#6");
    expect(unlockLine).toContain("#7");
  });

  it("states that the run proceeds without stopping again outside what was covered", () => {
    const text = formatConsequenceBatch(sevenItemSet());
    expect(text.toLowerCase()).toContain("without stopping again");
  });
});

describe("classifyEncounter", () => {
  const set = sevenItemSet();

  it("matches a later question that restates one already in the set, and proceeds on its default", () => {
    const result = classifyEncounter(set, "should the MCP server be started by the plugin now that npm is gone?");
    expect(result.covered).toBe(true);
    expect(result.matchedId).toBe("2");
  });

  it("matches the item the operator actually meant even when phrased differently, via #4", () => {
    const result = classifyEncounter(set, "should this land in a worktree or happen in place?");
    expect(result.covered).toBe(true);
    expect(result.matchedId).toBe("4");
  });

  it("calls a genuinely emergent question outside the set — this is the case that still earns a stop", () => {
    // The node concedes this directly: some of the seven only became visible
    // after work was done, and no up-front derivation reaches those.
    const result = classifyEncounter(set, "should the CLI support a --dry-run flag for this migration?");
    expect(result.covered).toBe(false);
    expect(result.matchedId).toBeUndefined();
  });
});
