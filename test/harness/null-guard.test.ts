import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { computeAttention } from "../../src/eval/attention.js";
import { defaultGenome } from "../../src/genome/load.js";
import type { Genome } from "../../src/genome/schema.js";
import { nullEnvironments } from "../../src/harness/environments.js";
import { computeFitness, explorationSpend } from "../../src/harness/fitness.js";
import { runEnvironment } from "../../src/harness/run.js";
import type { EnvironmentSpec } from "../../src/harness/spec.js";
import { Vault } from "../../src/ost/vault.js";

const AT = "2026-07-28T00:00:00.000Z";

/** Run one genome against one environment, in a throwaway vault. */
function once(spec: EnvironmentSpec, genome: Genome): { fitness: number; spend: number } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-null-guard-"));
  try {
    const run = runEnvironment({ spec, genome, dir, startedAt: AT });
    const rollup = computeAttention(new Vault(dir).readTree(), dir);
    return {
      fitness: computeFitness({ run, rollup, spec }).fitness,
      spend: explorationSpend(rollup),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Mean fitness and total spend for one genome across the whole null set. */
function score(genome: Genome): { fitness: number; spend: number } {
  const envs = nullEnvironments(3);
  let fitness = 0;
  let spend = 0;
  for (const spec of envs) {
    const r = once(spec, genome);
    fitness += r.fitness;
    spend += r.spend;
  }
  return { fitness: fitness / envs.length, spend };
}

const thrifty = (): Genome => {
  const g = defaultGenome();
  g.budgets.sharedPool = 1;
  return g;
};

const spendthrift = (): Genome => {
  const g = defaultGenome();
  g.budgets.sharedPool = 50;
  return g;
};

describe("the null-environment guard", () => {
  test("a null environment still PLANTS unknowns — an empty vault would pass vacuously", () => {
    for (const spec of nullEnvironments(3)) {
      expect(spec.unknowns.length).toBeGreaterThan(0);
      expect(spec.unknowns.every((u) => !u.findable)).toBe(true);
    }
  });

  test("nothing in a null environment is findable, so no run can resolve anything", () => {
    const spec = nullEnvironments(1)[0];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-null-guard-"));
    try {
      const run = runEnvironment({ spec, genome: defaultGenome(), dir, startedAt: AT });
      expect(run.status).toBe("completed");
      expect(run.outcomes.every((o) => !o.resolved)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the two variants genuinely differ in exploration spend — otherwise this proves nothing", () => {
    expect(score(spendthrift()).spend).toBeGreaterThan(score(thrifty()).spend);
  });

  test("THE GUARD: in a world with nothing to find, spending more does not score better", () => {
    expect(score(spendthrift()).fitness).toBeLessThanOrEqual(score(thrifty()).fitness);
  });

  test("the guard holds in every environment, not just on average", () => {
    for (const spec of nullEnvironments(3)) {
      expect(once(spec, spendthrift()).fitness).toBeLessThanOrEqual(once(spec, thrifty()).fitness);
    }
  });
});
