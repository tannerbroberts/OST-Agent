/**
 * The rolled-up under-served count, and the shape that decides whether the
 * rollup is safe.
 *
 * `underservedOpportunities` counts an Opportunity's DIRECT solution children.
 * For a heading that is the wrong number: a bucket holding 45 solutions two
 * levels down read as maximally under-served, and the queue sent every pass to
 * ideate under it. Rolling the count up through sub-opportunities makes the
 * queue read the same tree the rollup at the head of the pass reads.
 *
 * The rollup asserts something the direct count never did: that solutions
 * BENEATH a category address the category. That is usually true and not always,
 * and the failure is silent — three solutions under one sub-opportunity would
 * mark a heading served while four sibling sub-opportunities beneath it carry
 * nothing. Both assertions are here on purpose. The first is the fix; the second
 * is its falsifier, and a rollup that passes the first while failing the second
 * has inverted the miscount rather than removed it, which is the worse of the
 * two directions because nothing says it happened.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import type { Vault } from "../../src/ost/vault.js";

/** The `minSolutionsPerOpportunity` every other spec in this repo fixtures against. */
const MIN = 3;

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-rollup-count-"));
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

/** The titles the sweep is asking for solutions on, over the full set (never the capped list). */
function underserved(): string[] {
  return computeNextWork(buildPassContext(dir).vault, dir, MIN).underservedOpportunities.map((o) => o.title);
}

describe("underservedOpportunities — the count rolls up through sub-opportunities", () => {
  test("a category with zero direct solutions and a full subtree is absent from the list", () => {
    const vault = buildPassContext(dir).vault;
    opportunity(vault, "Players stop returning after week one", "Retention");
    // Five sub-opportunities, every one of them served, so the rollup and the
    // per-leaf view agree: there is no thin branch under this heading at all.
    for (let leaf = 1; leaf <= 5; leaf += 1) {
      const child = `Week-one drop-off, cause ${leaf}`;
      opportunity(vault, child, "Players stop returning after week one");
      for (let s = 1; s <= 9; s += 1) solution(vault, `Fix ${leaf}.${s}`, child);
    }

    const titles = underserved();
    // 45 solutions beneath it and zero on its own edges. The direct count called
    // this the emptiest node in the tree; the rolled-up count calls it full.
    expect(titles).not.toContain("Players stop returning after week one");
    // And nothing beneath it is short either, or the heading's silence would be
    // covered for by a leaf rather than earned by the subtree.
    for (let leaf = 1; leaf <= 5; leaf += 1) expect(titles).not.toContain(`Week-one drop-off, cause ${leaf}`);
  });

  test("a category whose subtree total is lopsided is still reported", () => {
    const vault = buildPassContext(dir).vault;
    opportunity(vault, "Onboarding loses people", "Retention");
    // Same 45 solutions, all of them under one child. The subtree total clears
    // `min` by fifteen times over and four fifths of the heading's need has
    // nothing addressing it.
    opportunity(vault, "The signup form is too long", "Onboarding loses people");
    for (let s = 1; s <= 45; s += 1) solution(vault, `Shorten the form ${s}`, "The signup form is too long");
    for (let leaf = 2; leaf <= 5; leaf += 1) {
      opportunity(vault, `Onboarding gap ${leaf}`, "Onboarding loses people");
    }

    const titles = underserved();
    // The falsifier. A rollup that reads only the total marks this heading served
    // and the thin four fifths goes quiet — the inversion the assumption beneath
    // this solution warns about, and the reason the total alone is not the rule.
    expect(titles).toContain("Onboarding loses people");
    // The empty siblings are gaps in their own right and are reported as such.
    for (let leaf = 2; leaf <= 5; leaf += 1) expect(titles).toContain(`Onboarding gap ${leaf}`);
    // The one served child is not a gap, so the lopsidedness is the heading's own
    // finding rather than a side effect of counting its children again.
    expect(titles).not.toContain("The signup form is too long");
  });

  test("the summary names a lopsided heading, so its total cannot pass for coverage", () => {
    const vault = buildPassContext(dir).vault;
    opportunity(vault, "Onboarding loses people", "Retention");
    opportunity(vault, "The signup form is too long", "Onboarding loses people");
    for (let s = 1; s <= 45; s += 1) solution(vault, `Shorten the form ${s}`, "The signup form is too long");
    for (let leaf = 2; leaf <= 5; leaf += 1) opportunity(vault, `Onboarding gap ${leaf}`, "Onboarding loses people");

    const { summary, lopsidedCategories } = computeNextWork(buildPassContext(dir).vault, dir, MIN);
    // Listed and listed WITH ITS REASON. A lopsided heading and an empty one sit
    // side by side in the list above and want opposite work — one wants the branch
    // started, this one wants the coverage spread — so the number that separates
    // them has to reach the reader.
    expect(lopsidedCategories).toEqual([{ category: "Onboarding loses people", leaves: 5, empty: 4 }]);
    expect(summary).toContain("4 of 5 leaf/leaves empty");
  });

  test("a heading whose whole subtree holds one solution is still exempt, and the leaf beneath it carries the work", () => {
    const vault = buildPassContext(dir).vault;
    opportunity(vault, "Onboarding loses people at the second step", "Retention");
    opportunity(vault, "The permissions prompt arrives too early", "Onboarding loses people at the second step");
    solution(vault, "Ask after the first success", "The permissions prompt arrives too early");

    const { underservedOpportunities } = computeNextWork(buildPassContext(dir).vault, dir, MIN);
    const titles = underservedOpportunities.map((o) => o.title);
    // The boundary this solution asked to move and did not get. Exempting on
    // `subtree total >= min` would list this heading — one solution beneath it,
    // `min` is three — and a listed heading is an instruction to ideate under a
    // category, which `next-work-leaf-redirect` fixes as the thing that must not
    // happen. The rolled-up total decides lopsidedness here, not eligibility.
    expect(titles).not.toContain("Onboarding loses people at the second step");
    // The branch is not quiet: its one leaf is short, listed, and names the
    // heading it stands in for. That is where the two more solutions belong.
    const leaf = underservedOpportunities.find((o) => o.title === "The permissions prompt arrives too early");
    expect(leaf?.solutions).toBe(1);
    expect(leaf?.redirectedFrom).toContain("Onboarding loses people at the second step");
  });
});
