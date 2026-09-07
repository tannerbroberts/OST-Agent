/**
 * A branch somebody abandoned is not a branch to ideate under.
 *
 * `computeNextWork` builds `underservedOpportunities` by counting each
 * Opportunity's direct Solution children and reporting the ones short of `min`.
 * It asked that question of every Opportunity regardless of status — so a node
 * carrying `status: deferred` was reported as owing solutions while the SAME
 * response listed it under `retiredFromDuplicateScan` for that very status. The
 * live sweep of 2026-08-09 hit exactly that: one entry in
 * `underservedOpportunities` ("Want proof no hijackable capability even exists",
 * `solutions: 2, needed: 3`), retired by a human-authorized merge, and the
 * remedy the queue proposed — ideate a third solution — would have resurrected
 * the branch that human retired.
 *
 * Two assertions, and the second is the one that makes this a test of the design
 * rather than of one predicate:
 *
 *   1. **The bar.** Zero opportunities carrying `status: deferred` appear in
 *      `underservedOpportunities`, over a vault holding at least one deferred
 *      opportunity with fewer than `min` direct solution children.
 *   2. **The consistency invariant.** For a node the sweep withholds from one
 *      analysis on the grounds of its status, no analysis in the same response
 *      may DEMAND WORK for it.
 *
 * "Demand work" is the scope of the invariant and is deliberately narrower than
 * "mention": `hygieneIssues` and `checkInvariants` still count a retired node's
 * violations, and `done` still turns on them. That is not an inconsistency the
 * invariant should reach — it is the anti-forging defence
 * (`test/ost/retired-nodes.test.ts`), and `deferred` is agent-settable, so a
 * status that could empty a gate's denominator would be a tool for making a
 * dangling link disappear. The last test here plants that attack against the new
 * filter and requires it to fail.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import type { Vault } from "../../src/ost/vault.js";

const OUTCOME = "Retention";
const MIN = 3;

/** The retired branch, and one solution under it — short of `min` either way. */
const RETIRED = "Want proof no hijackable capability even exists";
const SURVIVOR = "Fear the agent could take a destructive, irreversible action";

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-underserved-deferred-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function opportunity(vault: Vault, title: string, parent: string): void {
  vault.createNode({ title, layer: "Opportunity", evidence: "assertion", body: "b", tags: [], links: [] });
  vault.linkNodes(parent, title);
}

function solution(vault: Vault, title: string, parent: string): void {
  vault.createNode({ title, layer: "Solution", evidence: "assertion", body: "b", tags: [], links: [] });
  vault.linkNodes(parent, title);
}

/**
 * The observed shape: two sibling needs under the Outcome, one solution apiece,
 * so both are short of `min` before anything is deferred.
 */
function twoShortSiblings(vault: Vault): void {
  opportunity(vault, RETIRED, OUTCOME);
  opportunity(vault, SURVIVOR, OUTCOME);
  solution(vault, "A capability manifest nobody can widen at run time", RETIRED);
  solution(vault, "A closed tool allowlist", SURVIVOR);
}

describe("underservedOpportunities consults status before demanding solutions", () => {
  test("a deferred opportunity short of min is absent — and was there before the deferral", () => {
    const vault = buildPassContext(dir).vault;
    twoShortSiblings(vault);

    // Non-vacuity. Without this the assertion below is true of a fixture that
    // never produced the entry it claims the filter removed.
    const before = computeNextWork(vault, dir, MIN).underservedOpportunities.map((o) => o.title);
    expect(before).toContain(RETIRED);
    expect(before).toContain(SURVIVOR);

    vault.setStatus(RETIRED, "deferred", "merged into the survivor by founder decision on 2026-07-24");

    const after = computeNextWork(vault, dir, MIN);
    expect(after.underservedOpportunities.map((o) => o.title)).toEqual([SURVIVOR]);
    // The removal is named, not silent — the `formatCensus` rule this repo
    // applies to every count that shrinks without anyone having done the work.
    expect(after.summary).toContain(RETIRED);
    expect(after.summary).toContain("under-served count");
  });

  test("the deferred opportunity stays gone however many solutions it is short by", () => {
    const vault = buildPassContext(dir).vault;
    opportunity(vault, RETIRED, OUTCOME);
    vault.setStatus(RETIRED, "deferred", "abandoned outright — nothing beneath it");

    // Zero direct solutions is the deepest shortfall the count can report, and
    // the case the 2026-08-09 sweep would have been sent to ideate three times.
    expect(computeNextWork(vault, dir, MIN).underservedOpportunities.map((o) => o.title)).not.toContain(RETIRED);
  });

  test("no node is withheld from one analysis and demanded by another in the same response", () => {
    const vault = buildPassContext(dir).vault;
    twoShortSiblings(vault);
    // The other two demand lists, planted on one node each so the invariant is
    // measured over a response that has something to say in all three. The
    // shapes differ because the two lists ask different questions: a prose-only
    // test is what `solutionsMissingInstruments` reports, and no test at all is
    // what `solutionsMissingAssumptions` does.
    const proseOnly = "A broker that holds the credential";
    const bare = "A second credential, bought";
    solution(vault, proseOnly, SURVIVOR);
    vault.createNode({ title: "Broker audit", layer: "AssumptionTest", evidence: "assertion", body: "prose only", tags: [], links: [] });
    vault.linkNodes(proseOnly, "Broker audit");
    solution(vault, bare, SURVIVOR);
    const live = "An audited request the run makes to the broker";
    solution(vault, live, SURVIVOR);
    vault.createNode({ title: "Audit-trail check", layer: "AssumptionTest", evidence: "assertion", body: "prose only", tags: [], links: [] });
    vault.linkNodes(live, "Audit-trail check");
    vault.setStatus(proseOnly, "deferred", "abandoned — nothing left to broker");
    vault.setStatus(bare, "deferred", "abandoned — not paying for a second credential");
    vault.setStatus(RETIRED, "deferred", "merged into the survivor by founder decision on 2026-07-24");

    const work = computeNextWork(vault, dir, MIN);
    const withheld = new Set(work.retiredFromDuplicateScan.map((r) => r.node));
    expect(withheld).toContain(RETIRED);
    expect(withheld).toContain(proseOnly);
    expect(withheld).toContain(bare);
    // Non-vacuity for the two solution lists: an undeferred node in each shape
    // is still demanded, so an empty intersection below is the status filter
    // rather than three empty lists.
    expect(work.solutionsMissingInstruments).toContain(live);
    expect(work.solutionsMissingAssumptions.map((s) => s.title)).toContain("A closed tool allowlist");

    const demanded = [
      ...work.underservedOpportunities.map((o) => o.title),
      ...work.solutionsMissingInstruments,
      ...work.solutionsMissingAssumptions.map((s) => s.title),
    ];
    expect(demanded.filter((t) => withheld.has(t))).toEqual([]);
  });

  test("the filter is not a way to silence a gate: a retired node's violations still block done", () => {
    const vault = buildPassContext(dir).vault;
    twoShortSiblings(vault);
    vault.linkNodes(RETIRED, "Ghost opportunity");
    vault.setStatus(RETIRED, "deferred", "nothing to see here");

    const after = computeNextWork(vault, dir, MIN);
    // Withheld from the demand lists above, and from nothing else. The issue
    // still names the retired node, so it is not merely that SOME issue survived.
    expect(
      after.hygieneIssues.some((i) => i.rule === "dangling-link" && i.title === RETIRED && i.issue.includes("Ghost opportunity")),
    ).toBe(true);
    expect(after.done).toBe(false);
  });
});
