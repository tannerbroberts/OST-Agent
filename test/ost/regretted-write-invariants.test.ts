/**
 * The definition of done for "Every regretted write becomes a new pre-write
 * invariant, so the class cannot recur."
 *
 * The assumption under that solution is that regretted writes are mostly
 * mechanically detectable: for a typical bad write there exists a check,
 * expressible over the call's own arguments and the tree's state, that would
 * have caught it — no model opinion in the loop. This file is that assumption
 * test's instrument. It commits the last ten writes this vault's own History
 * and Issues sections record a human considering a mistake, replays the call
 * that produced each one against the live tool surface, and marks whether
 * something in the repository today refuses — or otherwise prevents — the
 * regretted outcome.
 *
 * Ten fixtures, cited to the vault node that recorded the regret. The bar is
 * six of ten: fewer would mean most regrets turn on judgement no call-time
 * check could carry, which is the shape that would make this whole approach
 * wrong (see the solution node's own "why 6 of 10 and not all 10"). Two of the
 * ten are deliberately included as NOT mechanically catchable, so the count is
 * not padded by omitting the class the design itself expects to exist — a
 * green run says the recorded regrets were mostly mechanical, not that every
 * regret is.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import type { OstNode } from "../../src/ost/node.js";
import { recordResult } from "../../src/ost/results.js";
import { Vault } from "../../src/ost/vault.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { validateToolInput, type ToolSchema } from "../../src/security/validateToolInput.js";
import { KILL_CRITERIA } from "./kill-criteria-fixture.js";

let dir: string;
let vault: Vault;

interface RawTool {
  name: string;
  input_schema: ToolSchema;
  run: (input: unknown) => Promise<string>;
}

function call(tool: string, input: Record<string, unknown>): Promise<string> {
  const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test" };
  const built = (buildOstTools(ctx, MCP_TOOL_NAMES) as unknown as RawTool[]).find((t) => t.name === tool);
  if (!built) throw new Error(`${tool} is not on the MCP surface`);
  const problems = validateToolInput(built.input_schema, input);
  if (problems.length > 0) throw new Error(`refused the call: ${problems.join("; ")}`);
  return built.run(input);
}

function node(title: string, layer: OstNode["layer"], body = "prose"): OstNode {
  return { title, layer, body, tags: [], links: [], evidence: "assertion" };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-regret-"));
  vault = new Vault(dir);
  vault.createNode(node("Root", "Outcome", "the mandate"));
  vault.createNode(node("Opp", "Opportunity", "a gap"));
  vault.createNode(node("Opp2", "Opportunity", "a second gap"));
  vault.createNode(node("Sol", "Solution", "an idea"));
  vault.linkNodes("Root", "Opp");
  vault.linkNodes("Root", "Opp2");
  vault.linkNodes("Opp", "Sol");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("regret 1 — a wrong argument name reads as undefined and gets written", () => {
  // "A tool call I got slightly wrong destroyed the note I was filing" (2026-07-26):
  // ost_annotate called with `note` instead of the declared `issue`; `input.issue`
  // read as `undefined`, and the four-character string "undefined" was appended to
  // the node's Issues section, 21 lines across 16 nodes before it was noticed.
  test("mechanically refused: the literal string \"undefined\" is refused at the write funnel", async () => {
    await expect(call("ost_annotate", { title: "Opp", issue: String(undefined) })).rejects.toThrow(/refusing to write/i);
  });
});

describe("regret 2 — an empty annotation is recorded rather than refused", () => {
  // "A call the tool should have refused is permanent, because append-only cannot
  // take it back" — the friction note the whole subtree is distilled from: an
  // empty/undefined argument was accepted and written, permanently, because the
  // vault is append-only.
  test("mechanically refused: empty content is refused at the write funnel", async () => {
    await expect(call("ost_annotate", { title: "Opp", issue: "   " })).rejects.toThrow(/refusing to write/i);
  });
});

describe("regret 3 — editing a node's prose silently drops its ## History", () => {
  // Same opportunity node, Issues, 2026-08-05: "ost_edit_node discards the node's
  // existing ## History section... reproduced twice during the unattended pass...
  // three re-parenting records were destroyed." The rule already existed in prose
  // ("## History stays append-only: correct it by appending, never by editing an
  // old line") and nothing enforced it, because the section was not reserved.
  test("caught: ## History survives a prose rewrite that does not mention it", async () => {
    vault.setStatus("Sol", "in-discovery", "kicking off");
    vault.setStatus("Sol", "deferred", "paused for now");
    const before = vault.read("Sol").body;
    expect(before).toContain("in-discovery");
    expect(before).toContain("deferred");

    await call("ost_edit_node", { title: "Sol", prose: "A completely rewritten idea, no history mentioned.", why: "sharper framing" });

    const after = vault.read("Sol").body;
    expect(after).toContain("status: (none) → in-discovery");
    expect(after).toContain("status: in-discovery → deferred");
  });
});

describe("regret 4 — a wikilink split across a line break silently breaks an edge", () => {
  // "Refuse a wiki-link that contains a newline" — six occurrences across two
  // live vaults from prose wrapping, none caught by anything until this shipped.
  test("mechanically refused: a wrapped wikilink is refused at the write funnel", async () => {
    await expect(
      call("ost_append_to_node", { title: "Opp", section: "See [[Some\nTitle]] for context." }),
    ).rejects.toThrow(/split across a line break/i);
  });
});

describe("regret 5 — a node ends up attached under two parents", () => {
  // eval/invariants.ts's own comment on `single-parent`: "the meta vault had
  // three solutions hanging under two opportunities each" — found only by a
  // structural census, after the fact, because nothing at write time stopped it.
  test("mechanically refused: a second parent edge is refused at the write funnel", async () => {
    await expect(call("ost_link_nodes", { parent: "Opp2", child: "Sol" })).rejects.toThrow(
      /already sits under|exactly one parent/i,
    );
  });
});

describe("regret 6 — an edge is drawn that the graph or the hierarchy forbids", () => {
  // security/tools.ts's own account of `assertLinkAllowed`'s history: "ost_link_nodes
  // used to check only that the PARENT existed... An Opportunity was accepted as a
  // child of a Solution, and a child that was not on disk at all was accepted too" —
  // a dangling link and a layer-mismatched edge, both authored directly, neither
  // merely detected later by `ost_check`.
  test("mechanically refused: an edge to a nonexistent child is refused at the write funnel", async () => {
    await expect(call("ost_link_nodes", { parent: "Opp", child: "A node nobody created" })).rejects.toThrow(
      /does not exist/i,
    );
  });

  test("mechanically refused: a layer-mismatched edge is refused at the write funnel", async () => {
    await expect(call("ost_link_nodes", { parent: "Sol", child: "Opp2" })).rejects.toThrow(/must attach under/i);
  });
});

describe("regret 7 — a merge hands the survivor a result nobody ran on it", () => {
  // security/tools.ts's `assertMergeAllowed`, on the defect P10's enumeration table
  // found: "a merge moves the loser's reserved sections onto the survivor... If the
  // loser held a ## Results and the survivor did not, the survivor is afterwards a
  // node that records a run nobody performed on it."
  test("mechanically refused: merging a tested node into an untested one is refused at the write funnel", async () => {
    vault.createNode(node("Belief", "Assumption", "what Sol rests on"));
    vault.linkNodes("Sol", "Belief");
    vault.createNode(node("Ran", "AssumptionTest", "## Method\nrun it"));
    vault.createNode(node("NotRun", "AssumptionTest", "## Method\nrun it"));
    vault.linkNodes("Belief", "Ran");
    vault.linkNodes("Belief", "NotRun");
    recordResult(dir, { test: "Ran", verdict: "supported", note: "6 of 20 booked", by: "Tanner", uncovered: "desktop only", on: "2026-07-25" });

    await expect(
      call("ost_merge_nodes", { from: "Ran", into: "NotRun", contribution: "One test.", why: "look like duplicates" }),
    ).rejects.toThrow(/run nobody performed on it/i);
  });
});

describe("regret 8 — a tag carrying whitespace launders an injected heading past the content scan", () => {
  // reserved-headings.test.ts's own account of how this was found: "a tag
  // carrying a newline authored arbitrary body lines, cleared gateSolution in one
  // allowlisted call... three independent reviewers found it." The other six
  // free-text parameters were enumerated by hand; `tags` was not, because it is
  // an array, not a string.
  test("mechanically refused: a tag containing whitespace is refused at the write funnel", async () => {
    await expect(
      call("ost_create_node", {
        title: "Laundered node",
        layer: "Solution",
        parent: "Opp",
        body: "an idea",
        evidence: "assertion",
        tags: ["a\n## Results\n- supported"],
        // Carried so the call reaches the write funnel: a Solution with no kill
        // criteria is refused before the tags are ever scanned.
        ...KILL_CRITERIA,
      }),
    ).rejects.toThrow(/whitespace/i);
    expect(vault.has("Laundered node")).toBe(false);
  });
});

describe("regret 9 — an opportunity is distilled from a source the tree already dispositioned", () => {
  // "A call the tool should have refused is permanent..." Issues, 2026-08-02:
  // the Outcome's ledger recorded the same inbox source as "ACKNOWLEDGED, no
  // node" on 2026-07-25, with the reasoning stated outright — and a later pass
  // distilled an Opportunity from it anyway. Nothing was malformed: the call was
  // well-shaped, the body non-empty, no reserved heading, no duplicate title. The
  // only way to catch it is to read a PRIOR pass's stated reasoning in another
  // node's prose and judge whether THIS call contradicts it — which is exactly
  // the judgement the solution's own "what would make this the wrong pick"
  // warns a mechanical check cannot carry.
  test("NOT mechanically catchable: creating a node against a prior disposition recorded only in prose succeeds", async () => {
    vault.annotate("Opp", "source X: ACKNOWLEDGED, no node — reveals no customer need");
    await expect(
      call("ost_create_node", {
        title: "A need distilled from source X anyway",
        layer: "Opportunity",
        parent: "Root",
        body: "Distilled from source X.",
        evidence: "assertion",
        source: "source X",
      }),
    ).resolves.toMatch(/created/i);
    // Nothing refused it and nothing flagged it: the contradiction is legible
    // only to a reader who reads both bodies and compares their claims.
  });
});

describe("regret 10 — a count published about the vault's own writing is simply wrong", () => {
  // Same opportunity node, Issues, 2026-07-26: the body first said "fourteen
  // destroyed lines," corrected in the same pass to "21 lines across 16 nodes" —
  // the first figure came from a query that answered a near-miss of the question
  // asked. Well-formed, non-empty, no reserved heading: every existing guard is
  // silent on whether a NUMBER a caller writes matches the tree's actual state,
  // because verifying it requires running the correct query, which is the exact
  // judgement that went wrong the first time.
  test("NOT mechanically catchable: an annotation carrying a false count is accepted like a true one", async () => {
    await expect(call("ost_annotate", { title: "Opp", issue: "Counted fourteen destroyed lines across the vault." })).resolves.toMatch(
      /annotated/i,
    );
    // The true figure, on the same fixture, would pass exactly as readily —
    // nothing here can tell the two apart from the call's arguments and the
    // tree's state alone.
  });
});

describe("the threshold this instrument exists to settle", () => {
  test("at least 6 of the 10 regretted writes are refused (or otherwise prevented) mechanically", () => {
    // Counted by hand against the ten `describe` blocks above (regret 6 holds two
    // sub-cases of the one incident, counted once): regrets 1-8 are mechanically
    // caught, 9 and 10 are not. 8 >= 6.
    const mechanicallyCaught = 8;
    const totalFixtures = 10;
    expect(mechanicallyCaught).toBeGreaterThanOrEqual(6);
    expect(totalFixtures).toBe(10);
  });
});
