/**
 * P3 — every lane has a behavioural consumer.
 *
 * The lane vocabulary (`src/knowledge/lanes.ts`) exists to do two things: let a
 * pass run the one lane that costs nobody anything, and present the rest "already
 * sorted by what they are actually waiting on." Until now it did neither in a way
 * anything acted on — the only consumer was a CLI that *printed* a list. This pins
 * the consumer that changed that: `ost_next_work` routes each not-yet-resulted
 * assumption test into its lane's bucket, and the routing is behavioural — the same
 * tree with a test in a different lane produces a different `assumptionWork`.
 *
 * It is deliberately an input→output assertion, not a grep. A grep can be satisfied
 * by a lane id appearing beside dead code; this fails unless the classification
 * actually moves a test between buckets.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { runnableByCompute } from "../../src/ost/lanes.js";
import { LANES, type LaneId } from "../../src/knowledge/lanes.js";

const OUTCOME = "Retention";
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-p3-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Build Outcome → Opportunity → Solution → one AssumptionTest, and return the vault. */
function withOneTest(lane: LaneId | undefined) {
  const v = buildPassContext(dir).vault;
  v.createNode({ title: "Users churn after week one", layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({ title: "Onboarding checklist", layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({ title: "Checklist audit", layer: "AssumptionTest", evidence: "assertion", body: "x", tags: [], links: [] });
  v.linkNodes(OUTCOME, "Users churn after week one");
  v.linkNodes("Users churn after week one", "Onboarding checklist");
  v.linkNodes("Onboarding checklist", "Checklist audit");
  if (lane) v.setLane("Checklist audit", lane, "by test — fixture");
  return v;
}

describe("each lane routes its tests into a distinct bucket", () => {
  const cases: Array<{ lane: LaneId; bucket: keyof ReturnType<typeof computeNextWork>["assumptionWork"] }> = [
    { lane: "compute-only", bucket: "runnable" },
    { lane: "one-command", bucket: "awaitingOneCommand" },
    { lane: "pending-permission", bucket: "blockedOnPermission" },
    { lane: "humans-required", bucket: "needsHumans" },
  ];

  test("the four lanes and the four buckets are the same four — no lane is unrouted", () => {
    // Non-vacuity: if a lane were added to the vocabulary without a bucket, the
    // cases above would silently stop covering it. This keeps them in lockstep.
    expect(cases.map((c) => c.lane).sort()).toEqual(LANES.map((l) => l.id).sort());
  });

  for (const { lane, bucket } of cases) {
    test(`a ${lane} test lands in assumptionWork.${bucket} and nowhere else`, () => {
      const v = withOneTest(lane);
      const work = computeNextWork(v, dir, 3);
      const aw = work.assumptionWork;
      expect(aw[bucket]).toEqual(["Checklist audit"]);
      // Exactly one bucket holds it — a router, not a broadcast.
      const total = aw.runnable.length + aw.awaitingOneCommand.length + aw.blockedOnPermission.length + aw.needsHumans.length;
      expect(total).toBe(1);
    });
  }
});

describe("the runnable bucket is exactly what compute may run", () => {
  test("`runnable` equals runnableByCompute — one definition of 'compute may run this', not two", () => {
    const v = withOneTest("compute-only");
    const work = computeNextWork(v, dir, 3);
    expect(work.assumptionWork.runnable).toEqual(runnableByCompute(v.readTree()).map((t) => t.title));
  });

  test("an unlabelled test falls to needsHumans — the fail-closed default, never runnable", () => {
    const v = withOneTest(undefined);
    const work = computeNextWork(v, dir, 3);
    expect(work.assumptionWork.needsHumans).toEqual(["Checklist audit"]);
    expect(work.assumptionWork.runnable).toEqual([]);
  });
});

describe("assumptionWork never blocks done", () => {
  test("a tree whose only outstanding item is a runnable test is still done", () => {
    // The solution HAS a test (so it is not a bare solution), the test has no
    // result, and nothing else is outstanding. Because recording a result is off
    // the agent's surface (B1/B2), a test awaiting one cannot be a completion
    // blocker — it would wedge every pass forever.
    const v = withOneTest("compute-only");
    const work = computeNextWork(v, dir, 1); // min 1 solution, which the opportunity has
    expect(work.assumptionWork.runnable).toEqual(["Checklist audit"]);
    expect(work.done).toBe(true);
  });

  test("a test that recorded a result is off every queue", () => {
    const v = withOneTest("humans-required");
    // A `## Results` section is what `hasRecordedResult` reads; write it directly,
    // standing in for the CLI's `ost-agent result`.
    v.appendUnderSection("Checklist audit", "## Results", "- 2026-07-30 confirmed");
    const work = computeNextWork(v, dir, 3);
    const aw = work.assumptionWork;
    expect(aw.runnable.length + aw.awaitingOneCommand.length + aw.blockedOnPermission.length + aw.needsHumans.length).toBe(0);
  });
});
