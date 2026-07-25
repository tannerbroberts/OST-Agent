import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { runnableByCompute, setLane, suggestCaution, triageLanes } from "../../src/ost/lanes.js";
import { serialize, type OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";

const node = (title: string, layer: OstNode["layer"], links: string[] = [], extra: Partial<OstNode> = {}): OstNode => ({
  title,
  layer,
  tags: [],
  links,
  body: "b",
  evidence: "assertion",
  ...extra,
});

describe("triageLanes", () => {
  test("groups assumption tests by lane and keeps unlabelled ones visible", () => {
    const tree = [
      node("Out", "Outcome", ["Opp"]),
      node("Opp", "Opportunity", ["Sol"]),
      node("Sol", "Solution", ["A", "B", "C"]),
      node("A", "AssumptionTest", [], { lane: "compute-only" }),
      node("B", "AssumptionTest", [], { lane: "humans-required" }),
      node("C", "AssumptionTest"),
    ];

    const t = triageLanes(tree);

    expect(t.byLane["compute-only"]).toEqual(["A"]);
    expect(t.byLane["humans-required"]).toEqual(["B"]);
    expect(t.unlabelled).toEqual(["C"]);
    expect(t.totals).toEqual({ tests: 3, labelled: 2, unlabelled: 1 });
  });

  test("counts only assumption tests — a lane on any other layer is not triage", () => {
    const tree = [node("Out", "Outcome"), node("Sol", "Solution", [], { lane: "compute-only" })];

    expect(triageLanes(tree).totals.tests).toBe(0);
  });
});

describe("runnableByCompute — the safety boundary", () => {
  const tested = (title: string, extra: Partial<OstNode> = {}) =>
    node(title, "AssumptionTest", [], { body: "## Results\n- 2026-01-01 **supported** (ran by X) — done", ...extra });

  test("an UNLABELLED test is never runnable, however cheap it looks", () => {
    const tree = [node("A", "AssumptionTest")];

    expect(runnableByCompute(tree)).toEqual([]);
  });

  test("only compute-only tests are runnable", () => {
    const tree = [
      node("A", "AssumptionTest", [], { lane: "compute-only" }),
      node("B", "AssumptionTest", [], { lane: "one-command" }),
      node("C", "AssumptionTest", [], { lane: "pending-permission" }),
      node("D", "AssumptionTest", [], { lane: "humans-required" }),
    ];

    expect(runnableByCompute(tree).map((n) => n.title)).toEqual(["A"]);
  });

  test("a compute-only test that already recorded a result is done, not runnable", () => {
    const tree = [tested("A", { lane: "compute-only" }), node("B", "AssumptionTest", [], { lane: "compute-only" })];

    expect(runnableByCompute(tree).map((n) => n.title)).toEqual(["B"]);
  });

  test("the runnable backlog is reported by triage too", () => {
    const tree = [
      node("A", "AssumptionTest", [], { lane: "compute-only" }),
      tested("B", { lane: "compute-only" }),
      node("C", "AssumptionTest"),
    ];

    expect(triageLanes(tree).runnable).toEqual(["A"]);
  });
});

describe("suggestCaution — a mechanical triage aid that only ever errs toward people", () => {
  test("flags a test that names outside people, and cites the phrase that flagged it", () => {
    const s = suggestCaution(node("Two-week recruiting test for interview supply", "AssumptionTest"));

    expect(s?.lane).toBe("humans-required");
    expect(s?.why).toMatch(/interview|recruit/i);
  });

  test("reads the body as well as the title", () => {
    const s = suggestCaution(
      node("A cheap check", "AssumptionTest", [], { body: "Ask twenty strangers whether they would pay." }),
    );

    expect(s?.lane).toBe("humans-required");
    expect(s?.why).toMatch(/stranger/i);
  });

  test("says nothing when it sees no marker — silence is NOT a compute-only verdict", () => {
    // The one thing this function must never do is talk a pass into running a
    // test. It can only ever raise a hand; the permissive call stays human.
    expect(suggestCaution(node("Replay the fourteen existing journals", "AssumptionTest"))).toBeUndefined();
  });

  test("never suggests a lane compute is allowed to run", () => {
    const samples = [
      "Interview five real players",
      "Replay historical runs against a stall definition",
      "Pre-order probe — will anyone pay before the map proves itself",
      "Paper-classify the existing commit history",
      "",
    ];
    for (const title of samples) {
      const s = suggestCaution(node(title, "AssumptionTest"));
      if (s) expect(s.lane).toBe("humans-required");
    }
  });

  test("only speaks about assumption tests", () => {
    expect(suggestCaution(node("Interview five real players", "Solution"))).toBeUndefined();
  });
});

describe("setLane", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-lanes-"));
    fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: Test outcome\n", "utf8");
    fs.writeFileSync(path.join(dir, "A test.md"), serialize(node("A test", "AssumptionTest")), "utf8");
    fs.writeFileSync(path.join(dir, "A solution.md"), serialize(node("A solution", "Solution")), "utf8");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("writes the lane and records who classified it and why", () => {
    setLane(dir, { test: "A test", lane: "compute-only", by: "tanner", why: "replays journals already in the repo" });

    const after = new Vault(dir).read("A test");
    expect(after.lane).toBe("compute-only");
    expect(after.body).toMatch(/## History/);
    expect(after.body).toMatch(/lane: \(none\) → compute-only/);
    expect(after.body).toMatch(/by tanner/);
    expect(after.body).toMatch(/replays journals already in the repo/);
  });

  test("re-classifying keeps the earlier call in History — the record only grows", () => {
    setLane(dir, { test: "A test", lane: "compute-only", by: "tanner", why: "first read" });
    setLane(dir, { test: "A test", lane: "humans-required", by: "tanner", why: "on reflection it needs a person" });

    const after = new Vault(dir).read("A test");
    expect(after.lane).toBe("humans-required");
    expect(after.body).toMatch(/lane: \(none\) → compute-only/);
    expect(after.body).toMatch(/lane: compute-only → humans-required/);
  });

  test("refuses a lane classification with no reason — an unauditable label is worse than none", () => {
    expect(() => setLane(dir, { test: "A test", lane: "compute-only", by: "tanner", why: "  " })).toThrow(/why/i);
  });

  test("refuses an unattributed classification", () => {
    expect(() => setLane(dir, { test: "A test", lane: "compute-only", by: " ", why: "because" })).toThrow(/who/i);
  });

  test("refuses a lane that is not on the list", () => {
    expect(() =>
      setLane(dir, { test: "A test", lane: "cheap" as never, by: "tanner", why: "because" }),
    ).toThrow(/cheap/);
  });

  test("refuses to classify anything that is not an assumption test", () => {
    expect(() =>
      setLane(dir, { test: "A solution", lane: "compute-only", by: "tanner", why: "because" }),
    ).toThrow(/Solution/);
  });
});

describe("the lane survives a round-trip through the file format", () => {
  test("serialize → deserialize keeps the lane", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-lane-rt-"));
    try {
      fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: o\n", "utf8");
      const withLane = node("T", "AssumptionTest", [], { lane: "one-command" });
      fs.writeFileSync(path.join(dir, "T.md"), serialize(withLane), "utf8");

      expect(new Vault(dir).read("T").lane).toBe("one-command");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a garbage lane in frontmatter is dropped rather than trusted", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-lane-bad-"));
    try {
      fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: o\n", "utf8");
      fs.writeFileSync(
        path.join(dir, "T.md"),
        "---\ntype: AssumptionTest\nlane: whatever-i-like\n---\n#AssumptionTest\n\nbody\n",
        "utf8",
      );

      const read = new Vault(dir).read("T");
      expect(read.lane).toBeUndefined();
      expect(runnableByCompute([read])).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
