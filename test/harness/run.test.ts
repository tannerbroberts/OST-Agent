import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { computeAttention } from "../../src/eval/attention.js";
import { defaultGenome } from "../../src/genome/load.js";
import { makeSpec } from "../../src/harness/generate.js";
import { runEnvironment } from "../../src/harness/run.js";
import { type EnvironmentSpec } from "../../src/harness/spec.js";
import { Vault } from "../../src/ost/vault.js";

const AT = "2026-07-28T00:00:00.000Z";

const SPEC: EnvironmentSpec = {
  name: "one-findable-one-not",
  kind: "generated",
  seed: 1,
  created: "2026-07-28",
  outcome: "Reach 10,000 daily active users",
  outcomeTitle: "Retention",
  nodes: [
    { title: "Retention", layer: "Outcome", body: "Reach 10,000 daily active users", links: [] },
  ],
  unknowns: [
    {
      title: "How many users hit the export path",
      darkens: "Retention",
      sections: ["Format", "Methodology", "Rationale"],
      findable: true,
      answer: "412 per day",
    },
    {
      title: "Why the trial converts",
      darkens: "Retention",
      sections: ["Format"],
      findable: false,
      answer: "",
    },
  ],
  evidence: [],
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-harness-run-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("runEnvironment", () => {
  test("completes and resolves exactly the findable unknown", () => {
    const rec = runEnvironment({ spec: SPEC, genome: defaultGenome(), dir, startedAt: AT });
    expect(rec.status).toBe("completed");
    expect(rec.outcomes.filter((o) => o.resolved).map((o) => o.title)).toEqual([
      "How many users hit the export path",
    ]);
  });

  test("writes a real attention ledger the real rollup can read back", () => {
    runEnvironment({ spec: SPEC, genome: defaultGenome(), dir, startedAt: AT });
    const rollup = computeAttention(new Vault(dir).readTree(), dir);
    expect(rollup.unknowns).toHaveLength(2);
    for (const u of rollup.unknowns) expect(u.calls).toBeGreaterThan(0);
  });

  test("an unresolved unknown still shows its spend — abandonment stays visible", () => {
    runEnvironment({ spec: SPEC, genome: defaultGenome(), dir, startedAt: AT });
    const rollup = computeAttention(new Vault(dir).readTree(), dir);
    expect(rollup.unknowns.find((u) => u.title === "Why the trial converts")?.calls).toBeGreaterThan(
      0,
    );
  });

  test("is deterministic: the same inputs twice yield the same record", () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), "ost-harness-run-a-"));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), "ost-harness-run-b-"));
    try {
      const ra = runEnvironment({ spec: SPEC, genome: defaultGenome(), dir: a, startedAt: AT });
      const rb = runEnvironment({ spec: SPEC, genome: defaultGenome(), dir: b, startedAt: AT });
      expect(ra).toEqual(rb);
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  test("the budget gene is live: a tiny shared pool cuts the work short", () => {
    const g = defaultGenome();
    g.budgets.sharedPool = 1;
    const rec = runEnvironment({
      spec: makeSpec(4, { unknowns: 5, findableRatio: 1 }),
      genome: g,
      dir,
      startedAt: AT,
    });
    expect(rec.budgetLimit).toBe(1);
    expect(rec.outcomes.filter((o) => o.resolved).length).toBeLessThan(5);
  });

  test("the pivot cap is a display limit, never an amnesty — done still sees everything", () => {
    const g = defaultGenome();
    g.pivot.maxOpenUnknownsSurfaced = 1;
    g.pivot.unknownsBlockDone = true;
    const rec = runEnvironment({ spec: SPEC, genome: g, dir, startedAt: AT });
    expect(rec.surfaced).toHaveLength(1);
    expect(rec.done).toBe(false);
  });

  test("a genome the schema refuses never produces a completed run", () => {
    const g = defaultGenome();
    g.classifier.fallback = "nonesuch";
    const rec = runEnvironment({ spec: SPEC, genome: g, dir, startedAt: AT });
    expect(rec.status).toBe("crashed");
    expect(rec.error).toBeTruthy();
  });

  test("a crashed run is not a zero-fitness run — it is marked crashed and carries no outcomes", () => {
    const g = defaultGenome();
    g.classifier.fallback = "nonesuch";
    const rec = runEnvironment({ spec: SPEC, genome: g, dir, startedAt: AT });
    expect(rec.status).toBe("crashed");
    expect(rec.outcomes).toEqual([]);
  });

  test("a null environment completes, resolves nothing, and still records spend", () => {
    const nul = makeSpec(9, { unknowns: 4, findableRatio: 0 });
    const rec = runEnvironment({ spec: nul, genome: defaultGenome(), dir, startedAt: AT });
    expect(rec.status).toBe("completed");
    expect(rec.outcomes.every((o) => !o.resolved)).toBe(true);
    expect(computeAttention(new Vault(dir).readTree(), dir).unknowns).toHaveLength(4);
  });
});
