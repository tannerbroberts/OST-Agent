/**
 * The instrument for "Prerequisite edges between assumption tests" — whether the
 * tree can hold what a paper map of prerequisites finds.
 *
 * **What this measures and what it deliberately does not.** The assumption
 * beneath the solution is that real dependencies exist between the tests already
 * in the tree, and the method for settling that is a person with a printout
 * marking A-blocks-B pairs. Nothing here can answer it — which pairs are
 * prerequisites is a reading of 272 tests and belongs to a human. What a paper
 * map needs from the code is somewhere to land, and that is this file's whole
 * subject: a map drawn by hand and left on paper is wasted twice over.
 *
 * Three claims, taken straight off the solution node, plus the two edges that
 * decide whether the mechanism is safe to have at all:
 *
 *   1. an AssumptionTest can declare another test as its prerequisite, and the
 *      declaration survives a round-trip to disk
 *   2. a cycle is REFUSED at the write path, and named where it is found by hand
 *   3. the sweep does not OFFER a test whose prerequisite has no result — it
 *      reports it as blocked, and says what it is blocked on
 *   4. an edge naming a title nobody wrote orders NOTHING, and is loud
 *   5. the block clears itself the moment the prerequisite records a result
 *
 * (4) is the one that is easy to get backwards. The fail-closed reflex says an
 * unresolvable edge should hold its test back; that would let a typo silently
 * and permanently remove a test from the runnable queue, and every later sweep
 * would report the shorter list and conclude nothing had changed. Silent removal
 * is the failure this codebase keeps having to undo, so the dangling edge is a
 * hygiene issue that blocks `done` and an ordering that blocks nothing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { checkInvariants } from "../../src/eval/invariants.js";
import { deserialize, serialize, type OstNode } from "../../src/ost/node.js";
import { fileNameForTitle } from "../../src/ost/sanitize.js";
import {
  cycleFromAdding,
  prerequisiteCycles,
  unknownPrerequisites,
  unmetPrerequisites,
} from "../../src/ost/prerequisites.js";
import type { Vault } from "../../src/ost/vault.js";

const OUTCOME = "Retention";
const OPPORTUNITY = "Nobody comes back after week one";
const SOLUTION = "Seed the community before launch";

/** The pair the tetrix instance actually reached for: one test unrunnable until another lands. */
const ARRIVALS = "Instrument arrivals so a cohort can be counted";
const SEEDING = "Seed twenty communities and measure week-one arrivals";

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-prereq-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * Outcome → Opportunity → Solution → Assumption → two AssumptionTests, both
 * `compute-only` and both instrumented.
 *
 * Both details matter. `compute-only` is the ONLY lane the sweep offers as
 * runnable, so a test that leaves that bucket has left it for the ordering and
 * not for a lane. Instrumented so the fixture is `done` for an uninteresting
 * reason — a prose-only test blocks `done` on its own term, which would let
 * every assertion below pass without the prerequisite doing any work.
 */
function twoTests(): Vault {
  const v = buildPassContext(dir).vault;
  const put = (title: string, layer: OstNode["layer"], extra: Partial<OstNode> = {}): void => {
    v.createNode({ title, layer, evidence: "assertion", body: `prose for ${title}`, tags: [], links: [], ...extra } as OstNode);
  };
  put(OPPORTUNITY, "Opportunity");
  put(SOLUTION, "Solution");
  put("Arrivals are the thing seeding would move", "Assumption");
  put(ARRIVALS, "AssumptionTest", { instrument: "npx vitest run test/arrivals.test.ts" });
  put(SEEDING, "AssumptionTest", { instrument: "npx vitest run test/seeding.test.ts" });
  v.linkNodes(OUTCOME, OPPORTUNITY);
  v.linkNodes(OPPORTUNITY, SOLUTION);
  v.linkNodes(SOLUTION, "Arrivals are the thing seeding would move");
  v.linkNodes("Arrivals are the thing seeding would move", ARRIVALS);
  v.linkNodes("Arrivals are the thing seeding would move", SEEDING);
  v.setLane(ARRIVALS, "compute-only", "by test — fixture");
  v.setLane(SEEDING, "compute-only", "by test — fixture");
  return v;
}

/** What `ost-agent result` writes, standing in for the human's run. */
function recordResult(v: Vault, test: string): void {
  v.appendUnderSection(test, "## Results", "- 2026-08-30 confirmed (ran by a person) — it held");
}

describe("1. a test can declare another test as its prerequisite", () => {
  test("the declaration lands on the node and survives a round-trip to disk", () => {
    const v = twoTests();
    v.setPrerequisite(SEEDING, ARRIVALS, "by a person — arrivals are the denominator this test is read against");

    // Read back off disk, not out of the object that wrote it.
    const reread = buildPassContext(dir).vault.read(SEEDING);
    expect(reread.prerequisites).toEqual([ARRIVALS]);
    // And it is a claim someone made, not a fact that appeared: History carries it.
    expect(reread.body).toContain("prerequisite: + " + ARRIVALS);
  });

  test("the field survives serialize → deserialize unchanged, including two of them", () => {
    const node: OstNode = {
      title: SEEDING,
      layer: "AssumptionTest",
      evidence: "assertion",
      prerequisites: [ARRIVALS, "Some other test"],
      tags: [],
      links: [],
      body: "prose",
    };
    expect(deserialize(SEEDING, serialize(node)).prerequisites).toEqual([ARRIVALS, "Some other test"]);
  });

  test("a prerequisite is NOT a child edge — the layer rules stay untouched", () => {
    // The whole reason this is a frontmatter field. Written as a [[wikilink]] it
    // would be a child edge, and `test-mapped` / `single-parent` / `single-backlink`
    // would all fire on a perfectly good ordering claim: the validator would call a
    // real dependency an orphan. This is that guarantee, measured.
    const v = twoTests();
    expect(checkInvariants(v.readTree())).toEqual([]);
    v.setPrerequisite(SEEDING, ARRIVALS, "by a person — arrivals first");
    expect(checkInvariants(v.readTree())).toEqual([]);
    expect(v.read(SEEDING).links).toEqual([]);
  });

  test("declaring the same edge twice is one claim, not two", () => {
    const v = twoTests();
    v.setPrerequisite(SEEDING, ARRIVALS, "by a person — arrivals first");
    expect(v.setPrerequisite(SEEDING, ARRIVALS, "by a person — again")).toBe("");
    expect(v.read(SEEDING).prerequisites).toEqual([ARRIVALS]);
  });
});

describe("2. a cycle is refused", () => {
  test("the second edge of a two-test cycle is refused, and the refusal names the chain", () => {
    const v = twoTests();
    v.setPrerequisite(SEEDING, ARRIVALS, "by a person — arrivals first");
    expect(() => v.setPrerequisite(ARRIVALS, SEEDING, "by a person — and seeding first")).toThrow(/cycle/i);
    // Refused means nothing was written — a refusal that half-wrote would be worse
    // than no refusal, because the tree would then hold the cycle it just objected to.
    expect(v.read(ARRIVALS).prerequisites).toBeUndefined();
    expect(prerequisiteCycles(v.readTree())).toEqual([]);
  });

  test("the refusal names the tests on the chain, so the author knows which edge to doubt", () => {
    const v = twoTests();
    v.setPrerequisite(SEEDING, ARRIVALS, "by a person — arrivals first");
    let message = "";
    try {
      v.setPrerequisite(ARRIVALS, SEEDING, "by a person — and seeding first");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain(ARRIVALS);
    expect(message).toContain(SEEDING);
  });

  test("a test may not be its own prerequisite", () => {
    const v = twoTests();
    expect(() => v.setPrerequisite(SEEDING, SEEDING, "by a person — itself")).toThrow();
    expect(v.read(SEEDING).prerequisites).toBeUndefined();
  });

  test("a longer cycle is refused too — reachability, not a same-pair check", () => {
    const v = twoTests();
    const THIRD = "Confirm the cohort definition holds across regions";
    v.createNode({
      title: THIRD,
      layer: "AssumptionTest",
      evidence: "assertion",
      body: "prose",
      tags: [],
      links: [],
      instrument: "npx vitest run test/cohort.test.ts",
    } as OstNode);
    v.linkNodes("Arrivals are the thing seeding would move", THIRD);
    v.setPrerequisite(SEEDING, ARRIVALS, "by a person — arrivals first");
    v.setPrerequisite(ARRIVALS, THIRD, "by a person — the definition first");
    expect(() => v.setPrerequisite(THIRD, SEEDING, "by a person — closing the loop")).toThrow(/cycle/i);
    expect(cycleFromAdding(v.readTree(), THIRD, SEEDING)).toEqual([THIRD, SEEDING, ARRIVALS, THIRD]);
  });

  test("a cycle written by hand is found and named on every test it runs through", () => {
    // The write path is not the only writer a vault has — a person in Obsidian, an
    // import, a file predating the field. So the structural check has to see one too,
    // and it has to name every member: the tree cannot say which edge is the wrong one.
    const v = twoTests();
    const handWrite = (title: string, requires: string): void => {
      const node = v.read(title);
      node.prerequisites = [requires];
      fs.writeFileSync(path.join(dir, fileNameForTitle(title)), serialize(node), "utf8");
    };
    handWrite(SEEDING, ARRIVALS);
    handWrite(ARRIVALS, SEEDING);

    const cycles = prerequisiteCycles(v.readTree());
    expect(cycles).toHaveLength(1);
    expect([...cycles[0]].sort()).toEqual([ARRIVALS, SEEDING].sort());

    const violations = checkInvariants(v.readTree()).filter((x) => x.rule === "prerequisite-cycle");
    expect(violations.map((x) => x.node).sort()).toEqual([ARRIVALS, SEEDING].sort());
    // And it reaches the gate the unattended pass actually reads.
    expect(computeNextWork(v, dir, 1).done).toBe(false);
  });
});

describe("3. the sweep reports a blocked test as blocked instead of offering it", () => {
  test("a compute-only test whose prerequisite has no result leaves `runnable`", () => {
    const v = twoTests();
    // Before the edge: both are on offer, which is what makes the move below real.
    expect(computeNextWork(v, dir, 1).assumptionWork.runnable.sort()).toEqual([ARRIVALS, SEEDING].sort());

    v.setPrerequisite(SEEDING, ARRIVALS, "by a person — arrivals are the denominator");
    const work = computeNextWork(v, dir, 1);
    expect(work.assumptionWork.runnable).toEqual([ARRIVALS]);
    expect(work.assumptionWork.runnable).not.toContain(SEEDING);
  });

  test("it is reported as blocked, and the report says what it waits on", () => {
    const v = twoTests();
    v.setPrerequisite(SEEDING, ARRIVALS, "by a person — arrivals are the denominator");
    const work = computeNextWork(v, dir, 1);
    expect(work.assumptionWork.blockedOnPrerequisite).toEqual([{ test: SEEDING, waitingOn: [ARRIVALS] }]);
    // A count with no name would say a test is blocked without saying by what,
    // which is the one thing an edge exists to say.
    expect(work.summary).toContain(SEEDING);
    expect(work.summary).toContain(ARRIVALS);
  });

  test("blocked is a place to be, not a disappearance — it is in exactly one bucket", () => {
    const v = twoTests();
    v.setPrerequisite(SEEDING, ARRIVALS, "by a person — arrivals first");
    const aw = computeNextWork(v, dir, 1).assumptionWork;
    const inLanes = [...aw.runnable, ...aw.awaitingOneCommand, ...aw.blockedOnPermission, ...aw.needsHumans];
    expect(inLanes).not.toContain(SEEDING);
    expect(aw.blockedOnPrerequisite.map((b) => b.test)).toEqual([SEEDING]);
  });

  test("ordering outranks the lane — a humans-required blocked test is blocked, not merely waiting on a person", () => {
    const v = twoTests();
    v.setLane(SEEDING, "humans-required", "by test — real people are in the loop");
    v.setPrerequisite(SEEDING, ARRIVALS, "by a person — arrivals first");
    const aw = computeNextWork(v, dir, 1).assumptionWork;
    expect(aw.needsHumans).not.toContain(SEEDING);
    expect(aw.blockedOnPrerequisite.map((b) => b.test)).toEqual([SEEDING]);
  });

  test("blocking never blocks `done` — recording the result that clears it is off this surface", () => {
    // Same argument as every other lane bucket (B1/B2). A `done` term the agent
    // has no tool to clear wedges every unattended pass forever.
    const v = twoTests();
    v.setPrerequisite(SEEDING, ARRIVALS, "by a person — arrivals first");
    expect(computeNextWork(v, dir, 1).done).toBe(true);
  });
});

describe("4. an edge naming nothing orders nothing, and is loud about it", () => {
  test("a prerequisite no node carries leaves its test on offer", () => {
    const v = twoTests();
    const node = v.read(SEEDING);
    node.prerequisites = ["Instrment arrivals so a cohort can be counted"]; // the typo, as typed
    fs.writeFileSync(path.join(dir, fileNameForTitle(SEEDING)), serialize(node), "utf8");

    const work = computeNextWork(v, dir, 1);
    expect(work.assumptionWork.runnable).toContain(SEEDING);
    expect(work.assumptionWork.blockedOnPrerequisite).toEqual([]);
    expect(unmetPrerequisites(v.readTree()).has(SEEDING)).toBe(false);
  });

  test("and it is reported — a typo is repaired or annotated, never silently obeyed", () => {
    const v = twoTests();
    const node = v.read(SEEDING);
    node.prerequisites = ["Instrment arrivals so a cohort can be counted"];
    fs.writeFileSync(path.join(dir, fileNameForTitle(SEEDING)), serialize(node), "utf8");

    expect(unknownPrerequisites(v.readTree())).toEqual([
      { test: SEEDING, prerequisite: "Instrment arrivals so a cohort can be counted", reason: "missing" },
    ]);
    expect(checkInvariants(v.readTree()).some((x) => x.rule === "prerequisite-unknown")).toBe(true);
    expect(computeNextWork(v, dir, 1).done).toBe(false);
  });

  test("an edge onto a node that is not a test is reported the same way", () => {
    const v = twoTests();
    const node = v.read(SEEDING);
    node.prerequisites = [SOLUTION];
    fs.writeFileSync(path.join(dir, fileNameForTitle(SEEDING)), serialize(node), "utf8");

    expect(unknownPrerequisites(v.readTree())).toEqual([
      { test: SEEDING, prerequisite: SOLUTION, reason: "not-a-test", found: "Solution" },
    ]);
    expect(computeNextWork(v, dir, 1).assumptionWork.runnable).toContain(SEEDING);
  });

  test("the write path refuses the same two cases up front", () => {
    const v = twoTests();
    expect(() => v.setPrerequisite(SEEDING, "No such test", "by a person")).toThrow();
    expect(() => v.setPrerequisite(SEEDING, SOLUTION, "by a person")).toThrow();
    expect(v.read(SEEDING).prerequisites).toBeUndefined();
  });
});

describe("5. the block clears itself", () => {
  test("recording the prerequisite's result puts the blocked test back on offer", () => {
    const v = twoTests();
    v.setPrerequisite(SEEDING, ARRIVALS, "by a person — arrivals are the denominator");
    expect(computeNextWork(v, dir, 1).assumptionWork.runnable).toEqual([ARRIVALS]);

    recordResult(v, ARRIVALS);

    const work = computeNextWork(v, dir, 1);
    // Nothing marked it unblocked: the fact changed and the derivation followed.
    expect(work.assumptionWork.blockedOnPrerequisite).toEqual([]);
    expect(work.assumptionWork.runnable).toEqual([SEEDING]);
    // The edge is still on the node — a prerequisite is a standing claim about
    // ordering, not a lock that gets consumed.
    expect(v.read(SEEDING).prerequisites).toEqual([ARRIVALS]);
  });

  test("blocking is one hop on results, not a transitive sweep of the whole chain", () => {
    // SEEDING requires ARRIVALS requires THIRD, with ARRIVALS answered and THIRD
    // not. ARRIVALS' own result is what SEEDING was waiting on, and it has it.
    // Reading further up the chain would let one unanswered test at the far end
    // silently withhold everything upstream of it — a stronger claim than anybody
    // wrote down.
    const v = twoTests();
    const THIRD = "Confirm the cohort definition holds across regions";
    v.createNode({
      title: THIRD,
      layer: "AssumptionTest",
      evidence: "assertion",
      body: "prose",
      tags: [],
      links: [],
      instrument: "npx vitest run test/cohort.test.ts",
    } as OstNode);
    v.linkNodes("Arrivals are the thing seeding would move", THIRD);
    v.setLane(THIRD, "compute-only", "by test — fixture");
    v.setPrerequisite(SEEDING, ARRIVALS, "by a person — arrivals first");
    v.setPrerequisite(ARRIVALS, THIRD, "by a person — the definition first");
    recordResult(v, ARRIVALS);

    const aw = computeNextWork(v, dir, 1).assumptionWork;
    expect(aw.runnable.sort()).toEqual([SEEDING, THIRD].sort());
    expect(aw.blockedOnPrerequisite).toEqual([]);
  });
});
