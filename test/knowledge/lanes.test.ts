import { describe, expect, test } from "vitest";
import { CAUTIOUS_LANE, LANES, computeMayRun, isLane, type LaneId } from "../../src/knowledge/lanes.js";

describe("the lane vocabulary", () => {
  test("every lane is defined, labelled, and says whether compute may run it", () => {
    for (const lane of LANES) {
      expect(lane.id).toMatch(/^[a-z-]+$/);
      expect(lane.label.length).toBeGreaterThan(0);
      expect(lane.definition.length).toBeGreaterThan(0);
      expect(typeof lane.computeMayRun).toBe("boolean");
    }
  });

  test("exactly ONE lane lets an unattended pass run the test itself", () => {
    // The whole safety argument rests on this being a single, narrow lane. If a
    // second lane ever becomes compute-runnable it must be argued for here first.
    const runnable = LANES.filter((l) => l.computeMayRun);
    expect(runnable.map((l) => l.id)).toEqual(["compute-only"]);
  });

  test("the cautious lane is a real lane and compute may not run it", () => {
    expect(isLane(CAUTIOUS_LANE)).toBe(true);
    expect(computeMayRun(CAUTIOUS_LANE)).toBe(false);
  });

  test("a lane compute cannot run is the DEFAULT: anything unrecognised is not runnable", () => {
    // Mirrors the believability ladder's floor rule. Guessing in the permissive
    // direction is the one mistake this product cannot survive: compute running a
    // test that needed a person would fabricate evidence.
    expect(computeMayRun("humans-required")).toBe(false);
    expect(computeMayRun("one-command")).toBe(false);
    expect(computeMayRun("pending-permission")).toBe(false);
    expect(computeMayRun("")).toBe(false);
    expect(computeMayRun("compute_only")).toBe(false);
    expect(computeMayRun("COMPUTE-ONLY")).toBe(false);
    expect(computeMayRun("anything-a-future-version-invents")).toBe(false);
  });

  test("isLane recognises exactly the defined lanes and nothing else", () => {
    for (const lane of LANES) expect(isLane(lane.id)).toBe(true);
    expect(isLane("nonsense")).toBe(false);
    expect(isLane("")).toBe(false);
  });

  test("pending-permission is distinct from one-command: a credential is not a judgement", () => {
    // Folded in from an observed stall: `npm publish` is not a yes/no with
    // evidence behind it, so putting it in a decision lane makes the docket chores.
    const ids = LANES.map((l) => l.id as LaneId);
    expect(ids).toContain("pending-permission");
    expect(ids).toContain("one-command");
  });
});
