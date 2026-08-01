/**
 * Z2 — every unbounded list in a tool response is capped, and names what it hid.
 *
 * The defect this pins did not arrive with a stack trace. Z1's `RangeError` at
 * least stopped; what R4's rewrite bought was that the same O(n²) issue set
 * marshalled *successfully* into the model's context — 21.4 MB of it — where the
 * failure mode is an unreadable answer rather than an error. "The gate becomes
 * unreadable long before it becomes slow" is Gate Z's own sentence, and this is
 * the criterion that computes it.
 *
 * Two properties are asserted here and the second one is the load-bearing half:
 *
 *   1. `JSON.stringify(computeNextWork(...))` and the `ost_read_tree` response
 *      each stay under 200 KB on a 5,000-node vault, and each shortened list
 *      names its hidden count.
 *   2. **The cap changed no verdict.** `done`, and every count the summary
 *      quotes, are taken over the full set — checked here against a denominator
 *      computed independently from the tree rather than read back out of the
 *      capped response. A cap that moved `done` would be a cap that reads as
 *      amnesty, which is the thing the criterion is actually about.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork, MAX_ITEMS_PER_LIST } from "../../src/mcp/next-work.js";
import { readTreeResponse } from "../../src/security/tools.js";
import { buildLargeTree } from "../ost/fixture-vault.js";

/** The criterion's number, in bytes. */
const BUDGET = 200 * 1024;

/** The criterion's fixture size. One Outcome plus 4,999 nodes beneath it. */
const SHAPE = { opportunities: 1500, solutions: 2000, assumptionTests: 1499 };

const OUTCOME = "Retention";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-z2-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
}, 120_000);
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test(
  "ost_next_work and ost_read_tree both stay under 200 KB on a 5,000-node vault",
  async () => {
    const ctx = buildPassContext(dir);
    buildLargeTree(ctx.vault, OUTCOME, SHAPE);

    const tree = ctx.vault.readTree();
    expect(tree.length).toBe(5000);

    /*
     * The control that makes the two bounds below mean something.
     *
     * A response can be small because it was capped or because the vault was
     * small, and those look identical from the assertion's side. So first
     * measure the shape `ost_read_tree` used to return — every node, every link,
     * pretty-printed — and require that it BREAKS the budget. If this ever stops
     * being true the fixture has stopped stressing the thing being pinned, and
     * the two assertions after it are decoration.
     */
    const uncapped = JSON.stringify(
      { count: tree.length, nodes: tree.map((n) => ({ title: n.title, layer: n.layer, status: n.status ?? null, tags: n.tags, links: n.links })) },
      null,
      2,
    );
    expect(uncapped.length).toBeGreaterThan(BUDGET);

    // ost_read_tree — serialized exactly as the tool serializes it.
    const readTree = JSON.stringify(readTreeResponse(tree), null, 2);
    expect(readTree.length).toBeLessThan(BUDGET);

    const parsed = JSON.parse(readTree) as { count: number; shown: number; hidden: number; note?: string };
    // The hidden count is named, and it is named against the WHOLE tree.
    expect(parsed.count).toBe(tree.length);
    expect(parsed.hidden).toBeGreaterThan(0);
    expect(parsed.shown + parsed.hidden).toBe(tree.length);
    expect(parsed.note).toContain(String(parsed.hidden));

    // ost_next_work — both the compact form the criterion names and the
    // pretty-printed one the tool actually returns.
    const work = computeNextWork(ctx.vault, dir, 3);
    expect(JSON.stringify(work).length).toBeLessThan(BUDGET);
    expect(JSON.stringify(work, null, 2).length).toBeLessThan(BUDGET);
  },
  120_000,
);

test(
  "every capped list names its hidden count, and the counts are over the full set",
  async () => {
    const ctx = buildPassContext(dir);
    buildLargeTree(ctx.vault, OUTCOME, SHAPE);
    const tree = ctx.vault.readTree();

    const work = computeNextWork(ctx.vault, dir, 3);

    // Something was capped, or this test asserts nothing about caps.
    expect(work.truncated.length).toBeGreaterThan(0);
    for (const t of work.truncated) {
      expect(t.shown).toBeLessThanOrEqual(MAX_ITEMS_PER_LIST);
      expect(t.hidden).toBe(t.total - t.shown);
      expect(t.hidden).toBeGreaterThan(0);
      // The number a reader needs is in the prose too, not only in a field a
      // model has to know to look for.
      expect(work.summary).toContain(String(t.total));
    }
    // Every list that was truncated is short by exactly the cap.
    const lengths: Record<string, number> = {
      unmappedEvidence: work.unmappedEvidence.length,
      underservedOpportunities: work.underservedOpportunities.length,
      solutionsMissingAssumptions: work.solutionsMissingAssumptions.length,
      "assumptionWork.runnable": work.assumptionWork.runnable.length,
      "assumptionWork.awaitingOneCommand": work.assumptionWork.awaitingOneCommand.length,
      "assumptionWork.blockedOnPermission": work.assumptionWork.blockedOnPermission.length,
      "assumptionWork.needsHumans": work.assumptionWork.needsHumans.length,
      outstandingAsks: work.outstandingAsks.length,
      hygieneIssues: work.hygieneIssues.length,
      openUnknowns: work.openUnknowns.length,
      retiredFromDuplicateScan: work.retiredFromDuplicateScan.length,
    };
    for (const t of work.truncated) expect(lengths[t.list]).toBe(t.shown);

    /*
     * The verdict is unchanged by the cap — checked against a denominator this
     * file computes itself.
     *
     * Reading the total back out of `truncated` and comparing it to `truncated`
     * would be the response agreeing with itself. Counting under-served
     * opportunities directly off the tree is a second, independent way to the
     * same number, and it is the one that would catch a cap applied one step too
     * early.
     */
    const solutionsPerOpportunity = new Map<string, number>();
    for (const n of tree) {
      if (n.layer !== "Opportunity") continue;
      solutionsPerOpportunity.set(n.title, 0);
    }
    const layerOf = new Map(tree.map((n) => [n.title, n.layer]));
    for (const n of tree) {
      if (n.layer !== "Opportunity") continue;
      let solutions = 0;
      for (const l of n.links) if (layerOf.get(l) === "Solution") solutions++;
      solutionsPerOpportunity.set(n.title, solutions);
    }
    const underserved = [...solutionsPerOpportunity.values()].filter((c) => c < 3).length;
    expect(underserved).toBeGreaterThan(MAX_ITEMS_PER_LIST);

    const reported = work.truncated.find((t) => t.list === "underservedOpportunities");
    expect(reported?.total).toBe(underserved);

    /*
     * The same independent-denominator check for `hygieneIssues`, which is the
     * one list whose full set is never materialized — so its total comes from a
     * counter inside `detectHygiene` rather than from an array's length, and a
     * counter is exactly the thing that can be incremented in the wrong place.
     *
     * Verified to discriminate: moving `total++` inside the `issues.length <
     * limit` branch (counting only what is displayed) leaves every other
     * assertion in this file green and fails this one. Without it this test
     * claimed "the counts are over the full set" while checking that for one
     * list out of six.
     *
     * The lower bound is the orphan assumption tests: the fixture creates them
     * unlinked, so `assumption-mapped` fires on each. Counted here off the tree,
     * not read back out of the response.
     */
    const linked = new Set(tree.flatMap((n) => n.links));
    const orphanAssumptionTests = tree.filter((n) => n.layer === "AssumptionTest" && !linked.has(n.title)).length;
    expect(orphanAssumptionTests).toBeGreaterThan(MAX_ITEMS_PER_LIST);
    const hygiene = work.truncated.find((t) => t.list === "hygieneIssues");
    expect(hygiene?.total ?? 0).toBeGreaterThanOrEqual(orphanAssumptionTests);

    // And `done` is false because the FULL set is non-empty, not because the
    // displayed one is.
    expect(work.done).toBe(false);
  },
  120_000,
);

test(
  "a small tree is not capped at all — the truncation report is empty when nothing is hidden",
  async () => {
    // The other direction of the control. Every assertion above is about a
    // response that WAS shortened; if the machinery shortened everything, or
    // reported a truncation that did not happen, this is what notices.
    const ctx = buildPassContext(dir);
    buildLargeTree(ctx.vault, OUTCOME, { opportunities: 2, solutions: 6, assumptionTests: 6 });

    const work = computeNextWork(ctx.vault, dir, 3);
    expect(work.truncated).toEqual([]);
    expect(work.summary).not.toContain("capped");

    const parsed = readTreeResponse(ctx.vault.readTree());
    expect(parsed.hidden).toBe(0);
    expect(parsed.shown).toBe(parsed.count);
    expect(parsed.note).toBeUndefined();
  },
  120_000,
);
