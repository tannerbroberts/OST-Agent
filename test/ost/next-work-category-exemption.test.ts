/**
 * The category exemption, and the one shape that decides whether it is safe.
 *
 * `underservedOpportunities` counts an Opportunity's DIRECT solution children.
 * That is right for a specific need and wrong for a heading: a bucket holding
 * dozens of solutions two levels down still read as under-served, and the queue
 * sent every pass to ideate under a heading that was already full. The exemption
 * is the cheap fix — a category is a node with sub-opportunities, and a category
 * is not asked to carry solutions of its own.
 *
 * The exemption's whole evidence is "it has a child", and the assumption test
 * beneath the solution asks whether that evidence survives the case where the
 * child is empty too. It does not, which is why the rule shipped with a guard:
 * an empty subtree is exactly the gap this list exists to find, so a heading is
 * only exempt while something actually hangs beneath it. Both assertions are
 * here on purpose — the exemption without the second one is a rule that silences
 * a real gap forever, and the difference between them is the only thing worth
 * pinning.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-exemption-"));
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

describe("underservedOpportunities — the category exemption", () => {
  test("a category with one sub-opportunity and no solution anywhere beneath it is still reported", () => {
    const vault = buildPassContext(dir).vault;
    opportunity(vault, "Onboarding is confusing", "Retention");
    opportunity(vault, "The first screen asks for too much", "Onboarding is confusing");

    // Having a child is the exemption's entire evidence, and here it is worthless:
    // the subtree is empty, so this heading is a genuine gap and must not go quiet.
    expect(underserved()).toContain("Onboarding is confusing");
    // The leaf beneath it is a gap of its own and was never exempt — it files no
    // sub-opportunities. Both are reported, which is what makes the empty branch visible.
    expect(underserved()).toContain("The first screen asks for too much");
  });

  test("a category whose one sub-opportunity carries three solutions is not reported", () => {
    const vault = buildPassContext(dir).vault;
    opportunity(vault, "Players stop returning after week one", "Retention");
    opportunity(vault, "There is no reason to open the app on day 8", "Players stop returning after week one");
    solution(vault, "Ship a streak counter", "There is no reason to open the app on day 8");
    solution(vault, "Ship a weekly digest", "There is no reason to open the app on day 8");
    solution(vault, "Ship a returning-player quest", "There is no reason to open the app on day 8");

    const titles = underserved();
    // The heading holds zero DIRECT solutions and is still served — by the three
    // beneath it. Asking a pass to ideate here is asking it to hang a solution on
    // a category, which is the thing the tree's own invariants file elsewhere.
    expect(titles).not.toContain("Players stop returning after week one");
    // The sub-opportunity is genuinely served: three is `min`.
    expect(titles).not.toContain("There is no reason to open the app on day 8");
  });

  test("the exemption is named in the summary, so a heading cannot go quiet unannounced", () => {
    const vault = buildPassContext(dir).vault;
    opportunity(vault, "Players stop returning after week one", "Retention");
    opportunity(vault, "There is no reason to open the app on day 8", "Players stop returning after week one");
    for (const s of ["Ship a streak counter", "Ship a weekly digest", "Ship a returning-player quest"]) {
      solution(vault, s, "There is no reason to open the app on day 8");
    }

    const { summary } = computeNextWork(buildPassContext(dir).vault, dir, MIN);
    expect(summary).toMatch(/1 category opportunity\(ies\) were exempt/);
    expect(summary).toContain("Players stop returning after week one");
  });

  test("an opportunity with no sub-opportunities is never exempt, however many solutions the tree holds elsewhere", () => {
    const vault = buildPassContext(dir).vault;
    opportunity(vault, "Nobody can find the export button", "Retention");
    solution(vault, "Move export into the toolbar", "Nobody can find the export button");

    // One solution, no children: the exemption has nothing to read and the old
    // arithmetic decides, exactly as before.
    expect(underserved()).toContain("Nobody can find the export button");
  });
});
