/**
 * Filter the queue on shipped and count what is still unsatisfiable.
 *
 * `solutionsMissingInstruments` asks every unbuilt solution for a command
 * that is red today and green once the solution is built. For a solution
 * that already ships, no such command can exist — any honest spec asserting
 * shipped behaviour passes on arrival, measures nothing, and hands a builder
 * no definition of done. The 2026-08-06 sweep found five `status: shipped`
 * solutions sitting in the live queue anyway.
 *
 * This is not a test of exclusion alone — {@link
 * "./shipped-status-audit.test.ts"} already pins that one case at a time.
 * It is a test that a MIXED queue drains to exactly the solutions still
 * owed an instrument: a trusted shipped promotion leaves, an unexplained
 * one stays (the field is agent-settable and cannot be trusted bare), and
 * an ordinary unbuilt solution stays because it is genuinely unsatisfiable
 * — nobody has written it a red command yet. Counting the survivors is the
 * point: a fix that empties the queue by accident (over-trusting) or fails
 * to shrink it at all (under-trusting) both pass a same-solution unit test
 * but fail this one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { solutionsMissingInstruments } from "../../src/eval/buildable.js";
import { trustsShippedStatus } from "../../src/eval/shipped-audit.js";

const OUTCOME = "Retention";
const OPPORTUNITY = "Users churn after week one";
const TRUSTED_SHIPPED = "Onboarding checklist";
const UNEXPLAINED_SHIPPED = "Undo button";
const STILL_UNBUILT = "Progress bar";
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-queue-shipped-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function solutionWithTest(v: ReturnType<typeof buildPassContext>["vault"], title: string) {
  v.createNode({ title, layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({ title: `${title} audit`, layer: "AssumptionTest", evidence: "assertion", body: "prose only", tags: [], links: [] });
  v.linkNodes(OPPORTUNITY, title);
  v.linkNodes(title, `${title} audit`);
}

describe("a mixed queue drains to exactly the solutions still owed an instrument", () => {
  test("trusted-shipped leaves, unexplained-shipped and unbuilt both stay", () => {
    const v = buildPassContext(dir).vault;
    v.createNode({ title: OPPORTUNITY, layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
    v.linkNodes(OUTCOME, OPPORTUNITY);
    solutionWithTest(v, TRUSTED_SHIPPED);
    solutionWithTest(v, UNEXPLAINED_SHIPPED);
    solutionWithTest(v, STILL_UNBUILT);

    v.setStatus(TRUSTED_SHIPPED, "shipped", "shipped in v0.1.0; the guard lives at the write funnel");
    v.setStatus(UNEXPLAINED_SHIPPED, "shipped");

    const tree = v.readTree();
    expect(trustsShippedStatus(v.read(TRUSTED_SHIPPED))).toBe(true);
    expect(trustsShippedStatus(v.read(UNEXPLAINED_SHIPPED))).toBe(false);

    const queue = solutionsMissingInstruments(tree);
    expect(queue).not.toContain(TRUSTED_SHIPPED);
    expect(new Set(queue)).toEqual(new Set([UNEXPLAINED_SHIPPED, STILL_UNBUILT]));
  });
});
