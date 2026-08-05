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

  /**
   * NON-VACUITY for R6 specifically, and it has to be an edge R6 would allow
   * that `single-parent` also allows — otherwise this file cannot tell "R6 is
   * narrow" from "everything is refused for some other reason".
   *
   * An UNRUN test with no parent at all is that edge: R6 objects only to a
   * recorded result changing hands, and an orphan has no parent to lose.
   */
  test("NON-VACUITY: an unparented, unrun test still attaches", async () => {
    put(BELIEF, "Assumption");
    vault.linkNodes(SOLUTION, BELIEF);
    put("An orphan test", "AssumptionTest");
    withRunSibling();

    await link(BELIEF, "An orphan test");
    expect(vault.read(BELIEF).links).toContain("An orphan test");
    // It lends nothing: an unrun test moves no gate.
    expect(buildPermit(vault.readTree(), SOLUTION).cleared).toBe(false);
  });
});

/**
 * One parent per node.
 *
 * The hierarchy rules all ask whether a node has *at least one* correctly-layered
 * parent; none of them ever asked how many. A vault could satisfy every one of
 * them and still be a DAG — which the meta vault was, with three solutions under
 * two opportunities each.
 */
describe("a node belongs under exactly one parent", () => {
  test("a second parent is refused, and the refusal says how to move it instead", async () => {
    put(BELIEF, "Assumption");
    vault.linkNodes(SOLUTION, BELIEF);
    put("Ship a digest email", "Solution");
    vault.linkNodes(OPPORTUNITY, "Ship a digest email");

    await expect(link("Ship a digest email", BELIEF)).rejects.toThrow(/belongs under exactly one parent/);
    await expect(link("Ship a digest email", BELIEF)).rejects.toThrow(/ost_detach_nodes/);
    expect(vault.read("Ship a digest email").links).not.toContain(BELIEF);
  });

  test("re-issuing the edge a node already has is still a no-op, not a refusal", async () => {
    // The idempotent call must survive: the child's only parent IS this parent,
    // so there is no second parent to object to.
    put(BELIEF, "Assumption");
    vault.linkNodes(SOLUTION, BELIEF);
    await expect(link(SOLUTION, BELIEF)).resolves.toBeDefined();
    expect(vault.read(SOLUTION).links.filter((l) => l === BELIEF)).toHaveLength(1);
  });

  test("re-parenting is the way through: detach, then link", async () => {
    put(BELIEF, "Assumption");
    vault.linkNodes(SOLUTION, BELIEF);
    put("Ship a digest email", "Solution");
    vault.linkNodes(OPPORTUNITY, "Ship a digest email");

    vault.detach(SOLUTION, BELIEF, "it answers the digest better");
    await link("Ship a digest email", BELIEF);

    expect(vault.read("Ship a digest email").links).toContain(BELIEF);
    expect(vault.read(SOLUTION).links).not.toContain(BELIEF);
    expect(checkInvariants(vault.readTree()).map((v) => v.rule)).not.toContain("single-parent");
  });

  test("checkInvariants reports a two-parent node, naming both parents", () => {
    // Planted through the vault, not the tool surface — the surface refuses it,
    // so this shape arrives from a hand edit or a vault predating the rule.
    put(BELIEF, "Assumption");
    vault.linkNodes(SOLUTION, BELIEF);
    put("Ship a digest email", "Solution");
    vault.linkNodes(OPPORTUNITY, "Ship a digest email");
    vault.linkNodes("Ship a digest email", BELIEF);

    const violation = checkInvariants(vault.readTree()).find((v) => v.rule === "single-parent");
    expect(violation?.node).toBe(BELIEF);
    expect(violation?.detail).toContain(SOLUTION);
    expect(violation?.detail).toContain("Ship a digest email");
  });
});
