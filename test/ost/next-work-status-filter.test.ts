/**
 * Every work bucket excludes nodes whose own frontmatter already says they are
 * closed.
 *
 * `computeNextWork` re-derives outstanding work from raw structure on every
 * pass, and `solutionsMissingInstruments` used to ask that question of every
 * solution regardless of status — so a `shipped` solution with no History
 * reasoning, or a `deferred` one abandoned outright, both surfaced as if they
 * were unbuilt work needing a red-now command. The shipped face (behind a
 * trusted-promotion gate) is pinned by `test/ost/shipped-status-audit.test.ts`;
 * this spec pins the sibling case that gate does not cover — `deferred` — and
 * re-confirms the unvalidated case stays reported, through `computeNextWork`
 * itself rather than the bare function.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";

const OUTCOME = "Retention";

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-status-filter-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("computeNextWork's solutionsMissingInstruments consults status before listing", () => {
  test("shipped and deferred solutions are absent; the unvalidated one lacking an instrument is still present", () => {
    const v = buildPassContext(dir).vault;
    const opportunity = "Users churn after week one";
    v.createNode({ title: opportunity, layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
    v.linkNodes(OUTCOME, opportunity);

    const shipped = "Onboarding checklist";
    const deferred = "Push notification nudge";
    const unvalidatedNoInstrument = "Progress bar on setup";
    const unvalidatedWithInstrument = "Email digest";

    for (const [solution, assumptionTest] of [
      [shipped, "Onboarding checklist audit"],
      [deferred, "Push nudge audit"],
      [unvalidatedNoInstrument, "Progress bar audit"],
      [unvalidatedWithInstrument, "Email digest audit"],
    ] as const) {
      v.createNode({ title: solution, layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
      v.linkNodes(opportunity, solution);
      v.createNode({
        title: assumptionTest,
        layer: "AssumptionTest",
        evidence: "assertion",
        body: "prose only",
        tags: [],
        links: [],
        ...(solution === unvalidatedWithInstrument ? { instrument: "npx vitest run test/ost/does-not-exist.test.ts" } : {}),
      });
      v.linkNodes(solution, assumptionTest);
    }

    v.setStatus(shipped, "shipped", "shipped in v0.1.0; the guard lives at the write funnel");
    v.setStatus(deferred, "deferred", "abandoned — push permission opt-in rate too low to matter");

    const work = computeNextWork(v, dir, 3);
    expect(work.solutionsMissingInstruments).toEqual([unvalidatedNoInstrument]);
  });
});
