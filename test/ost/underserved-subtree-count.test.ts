/**
 * "An opportunity counts as served when its subtree has solutions, not only its
 * direct children" — operationalised as a count, not just a boolean exemption.
 *
 * The category exemption (`test/ost/next-work-category-exemption.test.ts`) pins
 * the mechanism at one level of nesting: a heading with one served
 * sub-opportunity stops being reported. This file pins the claim the solution
 * node actually makes, which is about the WHOLE subtree, arbitrarily deep — the
 * ruleset says opportunities "nest into a multi-level sub-tree", and a bucket
 * whose solutions sit three hops down must be exempt exactly as one whose
 * solutions sit one hop down is.
 *
 * The census this solution shipped against (`2026-08-09`, 21 of 21) found the
 * false-positive rate of the un-fixed counter was total on this tree: every
 * currently-reported gap was a category with a solution somewhere beneath it.
 * The number this test asserts is the number that census predicts for a fixed
 * counter — zero categories left carrying a phantom gap once their subtree, at
 * any depth, holds enough to satisfy `min`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { byTitle, opportunitiesServedBeneath } from "../../src/processes/tree.js";
import type { Vault } from "../../src/ost/vault.js";

const MIN = 3;

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-subtree-count-"));
  await initVault(dir, "Reach 10,000 daily active users", "Retention");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function opportunity(vault: Vault, title: string, parent: string): void {
  vault.createNode({ title, layer: "Opportunity", evidence: "observed", source: "INBOX:n.md", body: "b", tags: [], links: [] });
  vault.linkNodes(parent, title);
}

function solution(vault: Vault, title: string, parent: string): void {
  vault.createNode({ title, layer: "Solution", evidence: "assertion", body: "b", tags: [], links: [] });
  vault.linkNodes(parent, title);
}

/** Every underserved-opportunity title that has a Solution somewhere beneath it — the phantom-gap count. */
function phantomGaps(vault: Vault): string[] {
  const { underservedOpportunities } = computeNextWork(vault, dir, MIN);
  const tree = vault.readTree();
  const servedBeneath = opportunitiesServedBeneath(tree, byTitle(tree));
  return underservedOpportunities.map((o) => o.title).filter((t) => servedBeneath.has(t));
}

describe("underservedOpportunities — the subtree count, at arbitrary depth", () => {
  test("a bucket served three levels down is not a phantom gap", () => {
    const vault = buildPassContext(dir).vault;
    // Outcome -> bucket -> mid -> leaf -> 3 solutions. Three Opportunity hops
    // between the bucket and its solutions, not the one hop the exemption test
    // already covers.
    opportunity(vault, "Players stop returning", "Retention");
    opportunity(vault, "Nothing brings them back after week one", "Players stop returning");
    opportunity(vault, "There is no reason to open the app on day 8", "Nothing brings them back after week one");
    for (const s of ["Ship a streak counter", "Ship a weekly digest", "Ship a returning-player quest"]) {
      solution(vault, s, "There is no reason to open the app on day 8");
    }

    const titles = computeNextWork(vault, dir, MIN).underservedOpportunities.map((o) => o.title);
    // All three category hops are exempt — the subtree carries `min` solutions
    // regardless of how many Opportunity edges sit between the heading and them.
    expect(titles).not.toContain("Players stop returning");
    expect(titles).not.toContain("Nothing brings them back after week one");
    expect(titles).not.toContain("There is no reason to open the app on day 8");
    expect(phantomGaps(vault)).toEqual([]);
  });

  test("a bucket with several served branches and one genuinely empty one reports only the empty one", () => {
    const vault = buildPassContext(dir).vault;
    opportunity(vault, "Onboarding is confusing", "Retention");
    opportunity(vault, "The tutorial is skippable and everyone skips it", "Onboarding is confusing");
    opportunity(vault, "Account creation has too many steps", "Onboarding is confusing");
    opportunity(vault, "Nobody understands the pricing page", "Onboarding is confusing");
    for (const s of ["Make the tutorial mandatory", "Add a skip warning", "Track skip rate"]) {
      solution(vault, s, "The tutorial is skippable and everyone skips it");
    }
    for (const s of ["Cut signup to one field", "Add social login", "Prefill from invite"]) {
      solution(vault, s, "Account creation has too many steps");
    }
    // "Nobody understands the pricing page" is left with nothing beneath it —
    // a genuine gap, and the one this counter must still find.

    const titles = computeNextWork(vault, dir, MIN).underservedOpportunities.map((o) => o.title);
    expect(titles).not.toContain("Onboarding is confusing");
    expect(titles).not.toContain("The tutorial is skippable and everyone skips it");
    expect(titles).not.toContain("Account creation has too many steps");
    expect(titles).toContain("Nobody understands the pricing page");

    // The one real gap has nothing beneath it, so it does not appear in the
    // phantom-gap count either — it is a true positive, not a false one.
    expect(phantomGaps(vault)).toEqual([]);
  });

  test("the phantom-gap count is what the census fixed its bar against: zero once the subtree is honoured", () => {
    const vault = buildPassContext(dir).vault;
    // Mirror the shape the 2026-08-09 census actually found: several bucket
    // categories, each served by a chain of intermediate opportunities.
    const buckets: Array<[string, string]> = [
      ["Checking on progress means digging through files", "A status view exists but nobody opens it"],
      ["The pass never says it is done", "There is no signal that a sweep finished"],
      ["Trust an unmonitored agent enough to walk away", "A run has no authority to decide anything"],
    ];
    for (const [bucket, mid] of buckets) {
      opportunity(vault, bucket, "Retention");
      opportunity(vault, mid, bucket);
      for (const s of [`${mid} — fix A`, `${mid} — fix B`, `${mid} — fix C`]) {
        solution(vault, s, mid);
      }
    }

    expect(phantomGaps(vault)).toEqual([]);
  });
});
