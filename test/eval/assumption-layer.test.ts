/**
 * The Assumption layer — what a solution's gate reads through, and what it does
 * not.
 *
 * Before this layer a Solution linked its AssumptionTests directly, so the
 * belief being risked and the instrument measuring it were the same node. A
 * solution resting on four beliefs and measured against one of them read as
 * identically covered to one resting on a single belief. Interposing the
 * Assumption separates them.
 *
 * The migration is **write-strict, read-tolerant**, and both halves are pinned
 * here because each without the other is a defect:
 *
 *   - Strict writes only. `CHILD_HIERARCHY` refuses a new
 *     Solution→AssumptionTest edge, so the legacy shape can only ever shrink.
 *   - Tolerant reads. `testsUnderSolution` still resolves a legacy direct edge,
 *     so a vault written before the layer existed keeps a green `check` and a
 *     working gate. Making every un-migrated vault red would have turned a
 *     schema addition into an outage for people who never asked for one.
 *
 * The interesting case is neither of those on its own but the two together: a
 * PARTIALLY migrated solution, which is what every vault looks like mid-walk.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildPermit } from "../../src/eval/buildable.js";
import { computeEvidenceDebt } from "../../src/eval/evidence-debt.js";
import { checkInvariants } from "../../src/eval/invariants.js";
import { byTitle, testsUnderSolution } from "../../src/processes/tree.js";
import type { OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";

const OUTCOME = "Players keep playing";
const OPPORTUNITY = "Players cannot tell what changed";
const SOLUTION = "Ship a changelog";
const BELIEF = "Players would read a changelog if it existed";
const TEST = "Diff two builds and count the deltas";

let dir: string;
let vault: Vault;
let ctx: ToolContext;

function put(title: string, layer: OstNode["layer"], extra: Partial<OstNode> = {}): void {
  vault.createNode({
    title,
    layer,
    tags: [],
    links: [],
    evidence: "assertion",
    body: `prose for ${title}`,
    ...extra,
  } as OstNode);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-assumption-layer-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  vault = new Vault(dir);
  ctx = { vault, dir, remote: { enabled: false }, surface: "test:assumption-layer" };
  put(OUTCOME, "Outcome");
  put(OPPORTUNITY, "Opportunity");
  vault.linkNodes(OUTCOME, OPPORTUNITY);
  put(SOLUTION, "Solution");
  vault.linkNodes(OPPORTUNITY, SOLUTION);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const link = (parent: string, child: string): Promise<string> => {
  const tool = buildOstTools(ctx, MCP_TOOL_NAMES).find((t) => t.name === "ost_link_nodes")!;
  return (tool as unknown as { run: (i: unknown) => Promise<string> }).run({ parent, child });
};
const testsOf = (solution: string): string[] =>
  testsUnderSolution(vault.read(solution), byTitle(vault.readTree())).map((t) => t.title);

describe("a solution's tests are resolved through its assumptions", () => {
  test("the two-hop walk finds a test the solution does not name directly", () => {
    put(BELIEF, "Assumption");
    vault.linkNodes(SOLUTION, BELIEF);
    put(TEST, "AssumptionTest");
    vault.linkNodes(BELIEF, TEST);

    // The solution's own links do NOT contain the test — that is the whole
    // point of the layer, and the reason six call sites had to change.
    expect(vault.read(SOLUTION).links).toEqual([BELIEF]);
    expect(testsOf(SOLUTION)).toEqual([TEST]);
  });

  test("a legacy direct edge still resolves — an un-migrated vault keeps its gate", () => {
    put(TEST, "AssumptionTest");
    vault.linkNodes(SOLUTION, TEST);
    expect(testsOf(SOLUTION)).toEqual([TEST]);
    expect(checkInvariants(vault.readTree()).map((v) => v.rule)).not.toContain("test-mapped");
  });

  test("a half-migrated solution reports BOTH — the shape every vault has mid-walk", () => {
    put("An old test", "AssumptionTest");
    vault.linkNodes(SOLUTION, "An old test"); // legacy
    put(BELIEF, "Assumption");
    vault.linkNodes(SOLUTION, BELIEF);
    put(TEST, "AssumptionTest");
    vault.linkNodes(BELIEF, TEST); // migrated

    expect(testsOf(SOLUTION).sort()).toEqual(["An old test", TEST].sort());
  });

  test("two assumptions sharing one test count it once, not twice", () => {
    // Otherwise a solution reads as twice-tested for a single run, which is the
    // same over-counting the layer was added to prevent.
    put(BELIEF, "Assumption");
    put("A second belief", "Assumption");
    vault.linkNodes(SOLUTION, BELIEF);
    vault.linkNodes(SOLUTION, "A second belief");
    put(TEST, "AssumptionTest");
    vault.linkNodes(BELIEF, TEST);
    vault.linkNodes("A second belief", TEST);

    expect(testsOf(SOLUTION)).toEqual([TEST]);
  });

  test("an assumption with no test leaves the solution untested, not covered", () => {
    // A belief nobody is measuring is exactly the state this layer makes
    // visible — before it, the solution simply had no test and said so the same
    // way. Now it has a stated risk AND no measurement, which is worse and must
    // not read as better.
    put(BELIEF, "Assumption");
    vault.linkNodes(SOLUTION, BELIEF);

    expect(testsOf(SOLUTION)).toEqual([]);
    const debt = computeEvidenceDebt(vault.readTree()).solutions.find((s) => s.title === SOLUTION)!;
    expect(debt.state).toBe("untested");
    expect(buildPermit(vault.readTree(), SOLUTION).cleared).toBe(false);
  });
});

describe("the hierarchy is strict on the way in", () => {
  test("a NEW AssumptionTest under a Solution is refused, naming the layer that takes it", async () => {
    put(TEST, "AssumptionTest");
    await expect(link(SOLUTION, TEST)).rejects.toThrow(/must attach under Assumption/);
  });

  test("an Assumption under an Opportunity is refused", async () => {
    put(BELIEF, "Assumption");
    await expect(link(OPPORTUNITY, BELIEF)).rejects.toThrow(/must attach under Solution/);
  });

  test("an unattached Assumption is reported, and linking it under a Solution clears it", async () => {
    put(BELIEF, "Assumption");
    const rules = (): string[] => checkInvariants(vault.readTree()).map((v) => v.rule);
    expect(rules()).toContain("assumption-mapped");
    await link(SOLUTION, BELIEF);
    expect(rules()).not.toContain("assumption-mapped");
  });
});

describe("R6 still refuses a borrowed result, one layer down", () => {
  const RESULT_LINE = "- 2026-01-04 — supported — by Ana Ruiz — uncovered: retention past week one";

  /** A second solution whose test a human already ran. */
  function withRunSibling(): void {
    put("Ship a digest email", "Solution");
    vault.linkNodes(OPPORTUNITY, "Ship a digest email");
    put("Players would open a digest", "Assumption");
    vault.linkNodes("Ship a digest email", "Players would open a digest");
    put("Mail fifty users and count the opens", "AssumptionTest");
    vault.linkNodes("Players would open a digest", "Mail fifty users and count the opens");
    vault.appendUnderSection("Mail fifty users and count the opens", "## Results", RESULT_LINE);
  }

  test("an already-run test cannot be adopted by a second Assumption", async () => {
    put(BELIEF, "Assumption");
    vault.linkNodes(SOLUTION, BELIEF);
    withRunSibling();

    await expect(link(BELIEF, "Mail fifty users and count the opens")).rejects.toThrow(/already records a result/);
    expect(buildPermit(vault.readTree(), SOLUTION).cleared).toBe(false);
  });

  /**
   * The hole the layer itself opened, and the reason `carriesRecordedResult`
   * looks one hop down rather than only at the node being attached. A solution's
   * gate now clears on a run test TWO hops away, so hanging a whole Assumption
   * that already carries one is the same forgery arriving one layer up — and it
   * would have been missed by a guard that only inspected the child's own body.
   */
  test("an Assumption already carrying a run test cannot be adopted by a second Solution", async () => {
    withRunSibling();
    await expect(link(SOLUTION, "Players would open a digest")).rejects.toThrow(/already records a result/);
  });

  test("NON-VACUITY: an UNRUN assumption may still be shared between solutions", async () => {
    put(BELIEF, "Assumption");
    vault.linkNodes(SOLUTION, BELIEF);
    put(TEST, "AssumptionTest");
    vault.linkNodes(BELIEF, TEST);
    put("Ship a digest email", "Solution");
    vault.linkNodes(OPPORTUNITY, "Ship a digest email");

    await link("Ship a digest email", BELIEF);
    expect(vault.read("Ship a digest email").links).toContain(BELIEF);
    // Both rest on it; neither gate moved, because there is no result to lend.
    expect(buildPermit(vault.readTree(), SOLUTION).cleared).toBe(false);
    expect(buildPermit(vault.readTree(), "Ship a digest email").cleared).toBe(false);
  });
});
