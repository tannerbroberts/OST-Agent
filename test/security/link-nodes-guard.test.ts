/**
 * R6 — `ost_link_nodes` validates what it attaches, the way `ost_create_node`
 * does.
 *
 * It was the one tool whose entire job is to state a structural fact and the one
 * tool that checked no structure. It verified that the PARENT existed and
 * nothing else: an Opportunity was accepted as the child of a Solution, and a
 * child that was not on disk at all was accepted too — an edge-forging primitive
 * reachable from the unattended surface, where every other write boundary in
 * this repository refuses first and writes second.
 *
 * Two halves, and they closed for different reasons:
 *
 * 1. **Layer and existence** — the criterion's own check. The guard reads the
 *    SAME `CHILD_HIERARCHY` table `ost_create_node` reads, because two tables
 *    would eventually disagree and the one that disagreed silently would be this
 *    one.
 * 2. **Adoption of a recorded result** — the hole P10's enumeration table found
 *    on 2026-07-30, which no criterion had named: hanging an assumption test
 *    that ALREADY carries a human-recorded result under a second Solution flips
 *    that Solution's gate from blocked to cleared in one call. B1 closed
 *    *authoring* a result; nothing closed *borrowing* one. The edge is added,
 *    not moved, so both Solutions claim the same run and no invariant notices.
 *
 * **The guard had to be narrow in a way this file is what proves.** R3's
 * clearability table says `opportunity-connected`, `solution-mapped` and
 * `assumption-mapped` are each cleared by linking — this tool is the clear path
 * for three of the nine rules. A guard broad enough to touch those turns an
 * unattended pass's only repair into a refusal and wedges the vault. So the
 * three repairs are asserted here as landing calls, and `test/eval/clearability.test.ts`
 * asserts the same thing end-to-end through the rules themselves.
 *
 * **How these were proved non-vacuous**, by mutation rather than by reading:
 * deleting the `assertLinkAllowed(...)` call from `ost_link_nodes` turns eleven
 * tests red — five here, both `dangling-link` create cells in the clearability
 * table, and three rows of P10's enumeration including the gate flip itself.
 * Disabling only the adoption clause (leaving the layer and existence checks in
 * place) turns four red, all of them in R6(b) and P10, and none in R6(a) — so
 * the two halves are pinned separately rather than by one over-broad guard.
 *
 * **Added by the adversarial pass (2026-07-30): the boundary this file was
 * missing.** The first draft asserted the three clear paths survive and left it
 * there, which is true of the shapes R3's table plants and false of one it does
 * not: an orphan AssumptionTest that ALREADY records a result cannot be attached
 * by the agent at all, so `assumption-mapped` has a shape only a human can
 * repair. That is defensible — it is the same call as the adoption refusal, seen
 * from the other side — but it was unstated, and an unstated narrowing of a clear
 * path is how a sweep discovers a wedge in production. The row below states it
 * and bounds it: annotating still reaches `done`, `ost_check` keeps reporting it,
 * and the agent cannot author the state in the first place. Re-run of the same
 * mutation with the row present: disabling only the adoption clause now turns
 * five red rather than four, this one included.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { renderGate } from "../../src/eval/render.js";
import { checkInvariants } from "../../src/eval/invariants.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import type { OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const OUTCOME = "Players keep playing";
const OPPORTUNITY = "Players cannot tell what changed";
/** The Solution under test: no result beneath it, so its gate is blocked. */
const BLOCKED = "Ship a changelog";
const BLOCKED_TEST = "Diff two builds and count the deltas";
/** A sibling Solution whose test a human already ran. */
const CLEARED = "Ship a digest email";
const CLEARED_TEST = "Mail fifty users and count the opens";

const RESULT_LINE = "- 2026-01-04 — supported — by Ana Ruiz — uncovered: retention past week one";

let dir: string;
let vault: Vault;
let ctx: ToolContext;

/** Fixture writes go through the Vault directly — never through the surface under test. */
function put(title: string, layer: OstNode["layer"], body = `prose for ${title}`): void {
  // Assumption tests are instrumented so this fixture stays `done` for the
  // reason under test. A prose-only test blocks `done` on its own term, which
  // would make the advisory-gate assertions below pass for the wrong reason.
  const instrument = layer === "AssumptionTest" ? "npx vitest run test/fixture.test.ts" : undefined;
  vault.createNode({ title, layer, tags: [], links: [], evidence: "assertion", body, instrument } as OstNode);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-link-guard-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  vault = new Vault(dir);
  ctx = { vault, dir, remote: { enabled: false }, surface: "test:r6" };

  put(OUTCOME, "Outcome");
  put(OPPORTUNITY, "Opportunity");
  vault.linkNodes(OUTCOME, OPPORTUNITY);
  put(BLOCKED, "Solution");
  vault.linkNodes(OPPORTUNITY, BLOCKED);
  put(BLOCKED_TEST, "AssumptionTest");
  vault.linkNodes(BLOCKED, BLOCKED_TEST);
  put(CLEARED, "Solution");
  vault.linkNodes(OPPORTUNITY, CLEARED);
  put(CLEARED_TEST, "AssumptionTest");
  vault.linkNodes(CLEARED, CLEARED_TEST);
  // The human's write path — `appendUnderSection` names the heading as its own
  // argument, the one position no tool call reaches (B1).
  vault.appendUnderSection(CLEARED_TEST, "## Results", RESULT_LINE);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const link = (parent: string, child: string): Promise<string> => {
  const tool = buildOstTools(ctx, MCP_TOOL_NAMES).find((t) => t.name === "ost_link_nodes")!;
  return (tool as unknown as { run: (i: unknown) => Promise<string> }).run({ parent, child });
};
const linksOf = (title: string): string[] => vault.read(title).links;
const gate = (solution: string): boolean => renderGate(vault.readTree(), solution).cleared;

describe("R6(a) — the hierarchy and the child are checked, as they are on create", () => {
  test("an Opportunity is refused as the child of a Solution — the criterion's own case", async () => {
    await expect(link(BLOCKED, OPPORTUNITY)).rejects.toThrow(/must attach under Outcome or Opportunity/);
    expect(linksOf(BLOCKED)).toEqual([BLOCKED_TEST]);
  });

  test("a child that does not exist is refused, rather than written as a dangling edge", async () => {
    await expect(link(OPPORTUNITY, "Ghost opportunity")).rejects.toThrow(/does not exist/);
    expect(linksOf(OPPORTUNITY)).toEqual([BLOCKED, CLEARED]);
    // And the refusal is the whole point: nothing in the tree records the attempt.
    expect(checkInvariants(vault.readTree())).toEqual([]);
  });

  test("the Outcome cannot be attached under anything — it is the root", async () => {
    await expect(link(OPPORTUNITY, OUTCOME)).rejects.toThrow(/attaches under nothing/);
  });

  test("a Solution under the Outcome, and an AssumptionTest under an Opportunity, are both refused", async () => {
    // The two off-by-one-layer mistakes an eager agent actually makes.
    await expect(link(OUTCOME, BLOCKED)).rejects.toThrow(/must attach under Opportunity/);
    await expect(link(OPPORTUNITY, BLOCKED_TEST)).rejects.toThrow(/must attach under Solution/);
  });

  test("the parent still has to exist — the one check that was already here", async () => {
    await expect(link("A parent nobody made", BLOCKED)).rejects.toThrow(/no such node/);
  });

  test("NON-VACUITY: every legal edge in this hierarchy still lands", async () => {
    // The control for all five refusals above. A guard that refused everything
    // would pass every one of them and take the tree's only repair tool with it.
    // One legal edge per row of CHILD_HIERARCHY that this fixture can express.
    put("A second gap", "Opportunity");
    put("A sub-gap", "Opportunity");
    put("An unmapped idea", "Solution");
    put("An unmapped test", "AssumptionTest");
    put("Darkness", "Unknown");

    await link(OUTCOME, "A second gap"); // Opportunity under Outcome
    await link(OPPORTUNITY, "A sub-gap"); // Opportunity under Opportunity
    await link(OPPORTUNITY, "An unmapped idea"); // Solution under Opportunity
    await link(BLOCKED, "An unmapped test"); // AssumptionTest under Solution
    await link(BLOCKED_TEST, "Darkness"); // Unknown under anything

    expect(linksOf(OUTCOME)).toContain("A second gap");
    expect(linksOf(OPPORTUNITY)).toEqual(expect.arrayContaining(["A sub-gap", "An unmapped idea"]));
    expect(linksOf(BLOCKED)).toContain("An unmapped test");
    expect(linksOf(BLOCKED_TEST)).toContain("Darkness");
  });

  test("the three invariants this tool clears are still clearable — the guard's narrowness, executed", async () => {
    // R6's own entry warned that `ost_link_nodes` being unguarded is "the reason
    // three invariants in R3 are clearable". Each one is planted here by a direct
    // vault write and cleared by the guarded tool, so a guard that widened would
    // fail here as well as in `test/eval/clearability.test.ts`.
    put("Adrift", "Opportunity");
    put("Unmapped idea", "Solution");
    put("Unmapped test", "AssumptionTest");
    const rules = () => checkInvariants(vault.readTree()).map((v) => v.rule);
    expect(rules()).toEqual(expect.arrayContaining(["opportunity-connected", "solution-mapped", "assumption-mapped"]));

    await link(OUTCOME, "Adrift");
    await link(OPPORTUNITY, "Unmapped idea");
    await link(BLOCKED, "Unmapped test");

    expect(checkInvariants(vault.readTree())).toEqual([]);
  });
});

describe("R6(b) — an already-run assumption test cannot be adopted by a second Solution", () => {
  test("the fixture is the state the property needs: one gate blocked, one cleared", () => {
    expect(gate(BLOCKED)).toBe(false);
    expect(gate(CLEARED)).toBe(true);
    expect(checkInvariants(vault.readTree())).toEqual([]);
  });

  test("the single call that used to flip the gate is refused, and the gate stays blocked", async () => {
    await expect(link(BLOCKED, CLEARED_TEST)).rejects.toThrow(/already records a result/);

    expect(gate(BLOCKED)).toBe(false);
    expect(linksOf(BLOCKED)).toEqual([BLOCKED_TEST]);
  });

  test("PROOF THE REFUSAL IS ABOUT SOMETHING: the same edge, written by the vault, does flip it", () => {
    // Non-vacuity for the row above. Without this, "the gate stayed blocked"
    // would be equally true of a fixture whose gate nothing could ever move.
    // The vault is the unguarded writer — this is the call the tool used to make.
    expect(gate(BLOCKED)).toBe(false);
    vault.linkNodes(BLOCKED, CLEARED_TEST);
    expect(gate(BLOCKED)).toBe(true);
    // …and silently: nothing in the tree says the run was about something else.
    expect(checkInvariants(vault.readTree())).toEqual([]);
  });

  test("an UNRUN test may still be shared between solutions — the refusal is retroactive-only", async () => {
    // Two solutions resting on the same open assumption is ordinary discovery,
    // and the gate does not move: the test has no result to lend. When a human
    // later records one, it is their write that clears both — a person in the
    // loop, not a single agent call.
    await link(CLEARED, BLOCKED_TEST);

    expect(linksOf(CLEARED)).toContain(BLOCKED_TEST);
    expect(gate(CLEARED)).toBe(true); // unchanged: its own test was already run
    expect(gate(BLOCKED)).toBe(false);
  });

  test("re-issuing an edge that already exists is not refused — it writes nothing and clears nothing", async () => {
    // The idempotent call. `linkNodes` no-ops on a duplicate, so refusing it
    // would break a harmless re-issue — and `test/release/no-evolvable-policy.test.ts`
    // drives exactly that sequence (create attaches, then links again).
    vault.appendUnderSection(BLOCKED_TEST, "## Results", RESULT_LINE);
    expect(gate(BLOCKED)).toBe(true);

    await expect(link(BLOCKED, BLOCKED_TEST)).resolves.toContain("linked");
    expect(linksOf(BLOCKED)).toEqual([BLOCKED_TEST]);
  });

  test("the ordinary flow is untouched: create the test, then a human records the result", async () => {
    // The argument the guard rests on, executed rather than asserted. In the flow
    // the product actually documents, the link happens BEFORE the result exists,
    // so nothing legitimate meets this refusal.
    const create = buildOstTools(ctx, MCP_TOOL_NAMES).find((t) => t.name === "ost_create_node")!;
    await (create as unknown as { run: (i: unknown) => Promise<string> }).run({
      title: "Count the diffs by hand",
      layer: "AssumptionTest",
      parent: BLOCKED,
      body: "read two manifests",
      evidence: "assertion",
      humansRequired: "a person reads both manifests and counts the differences",
    });
    expect(linksOf(BLOCKED)).toContain("Count the diffs by hand");

    vault.appendUnderSection("Count the diffs by hand", "## Results", RESULT_LINE);
    expect(gate(BLOCKED)).toBe(true);
  });

  test("the one clear path this guard DOES narrow, stated rather than left to be discovered", async () => {
    // R6's guard is narrow, but it is not free, and the boundary was missing from
    // both this file and `assertLinkAllowed`'s comment when they were written.
    //
    // `assumption-mapped` is cleared by linking an unattached AssumptionTest under
    // a Solution — and that repair is now REFUSED for exactly one shape of orphan:
    // one that already records a result. The clearability table cannot see it: its
    // `assumption-mapped` plant is an orphan with no result, so the row stays green
    // while this shape is unclearable by the agent.
    //
    // It is the right refusal — the guard cannot tell "this test really was about
    // that solution" from "adopt the neighbour's run", and the second reading is
    // the forgery. But it costs an honest repair, so what remains has to be shown:
    // the sweep annotates instead of linking, `done` is reachable, and `ost_check`
    // keeps reporting the orphan for the human who can attach it. Not a wedge — an
    // interrupt, which is the resource this project spends deliberately.
    //
    // The agent cannot AUTHOR this state (create attaches in the same call, before
    // any result can exist), so R3's property is untouched: it arrives from a human
    // in Obsidian, an import, or R8's residue followed by a human's `record`.
    put("An orphan test", "AssumptionTest");
    vault.appendUnderSection("An orphan test", "## Results", RESULT_LINE);
    const rules = () => checkInvariants(vault.readTree()).map((v) => v.rule);
    expect(rules()).toContain("assumption-mapped");

    await expect(link(BLOCKED, "An orphan test")).rejects.toThrow(/already records a result/);
    expect(rules()).toContain("assumption-mapped");
    // …and the gate the refusal is protecting did not move.
    expect(gate(BLOCKED)).toBe(false);

    // NON-VACUITY for "it is the result that is refused, not the repair": the same
    // repair on an orphan with no result lands, and clears its violation.
    put("A second orphan test", "AssumptionTest");
    await link(BLOCKED, "A second orphan test");
    expect(linksOf(BLOCKED)).toContain("A second orphan test");

    // What the sweep does instead, and that it is enough to reach `done`. The
    // issue string comes from `next_work` itself, because that is the move the
    // sweep makes and because suppression matches the issue verbatim (R5) — an
    // annotation in the tester's own words would leave `done` false and this test
    // would then be reporting a wedge that the real sweep does not hit.
    const outstanding = computeNextWork(vault, dir, 1).hygieneIssues.find((h) => h.title === "An orphan test")!;
    expect(outstanding.rule).toBe("assumption-mapped");
    const annotate = buildOstTools(ctx, MCP_TOOL_NAMES).find((t) => t.name === "ost_annotate")!;
    await (annotate as unknown as { run: (i: unknown) => Promise<string> }).run({
      title: "An orphan test",
      issue: outstanding.issue,
    });
    expect(computeNextWork(vault, dir, 1).done).toBe(true);
    // The violation is still reported to the human. Suppressed in `done`, never in `check`.
    expect(rules()).toContain("assumption-mapped");
  });

  test("a Solution's gate is ADVISORY — a refusal here cannot wedge an unattended pass", async () => {
    // Verified rather than assumed, because the whole safety of refusing at this
    // boundary rests on it. `done` is the only gate the unattended loop reads
    // (`src/mcp/next-work.ts`), and it has no gate term: a tree whose solutions
    // are all un-run still reaches done. So a pass that is refused this edge
    // finishes its sweep and reports, instead of retrying forever.
    const work = computeNextWork(vault, dir, 1);
    expect(gate(BLOCKED)).toBe(false);
    expect(work.done).toBe(true);

    // And structurally, so the behavioural half above cannot pass for a reason
    // that has nothing to do with gates: nothing in the file that computes `done`
    // consults the evidence gate at all.
    const src = fs.readFileSync(path.join(repoRoot, "src/mcp/next-work.ts"), "utf8");
    expect(src).not.toMatch(/gateSolution|renderGate/);
  });
});
