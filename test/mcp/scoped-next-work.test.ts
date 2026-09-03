/**
 * Branch-scoped discovery — `discovery.target` scopes the sweep to one
 * opportunity's subtree.
 *
 * The method (Torres) prioritizes top-down to a SINGLE target opportunity and
 * ignores the other branches while working it; the ruleset's own cadence block
 * says "select a single target opportunity at a time". Until this, the sweep
 * had no notion of focus at all: every bucket spanned the whole tree in
 * alphabetical walk order, and fourteen consecutive unattended passes re-derived
 * the same global queue without finishing any region of it.
 *
 * Three properties are load-bearing, and each has a test:
 *
 *   1. **The target can only arrive from config.** `ost_next_work` has no input
 *      that scopes — the ruleset forbids the agent from auto-selecting a target
 *      opportunity, and a parameter would be that selection with extra steps.
 *      (Pinned by the input-schema test at the bottom.)
 *   2. **Scoping is never silent.** It removes work from the lists AND from
 *      `done`, which is stronger than a display cap, so everything scoped away
 *      is counted in `scope.excluded` and the summary names it.
 *   3. **A mistyped target is loud, not narrow.** A target that names no
 *      Opportunity leaves the sweep UNSCOPED with `resolved: false` — scoping
 *      to an empty membership would report a maintained tree off a typo.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork, subtreeTitles } from "../../src/mcp/next-work.js";
import { byTitle, writeEvidence } from "../../src/processes/tree.js";
import { buildOstTools } from "../../src/security/tools.js";

const OUTCOME = "Retention";
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-scope-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * Two branches under the Outcome. "Focus branch" is fully maintained: one
 * solution chain, instrumented, assumption-tested. "Noisy branch" owes
 * everything: an under-served opportunity and a bare solution.
 */
function twoBranches() {
  const v = buildPassContext(dir).vault;
  // The focus branch — complete.
  v.createNode({ title: "Focus branch", layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({ title: "Focus solution A", layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({ title: "Focus assumption", layer: "Assumption", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({
    title: "Focus audit",
    layer: "AssumptionTest",
    evidence: "assertion",
    body: "x",
    tags: [],
    links: [],
    instrument: "npx vitest run test/focus.test.ts",
  });
  v.linkNodes(OUTCOME, "Focus branch");
  v.linkNodes("Focus branch", "Focus solution A");
  v.linkNodes("Focus solution A", "Focus assumption");
  v.linkNodes("Focus assumption", "Focus audit");
  // The noisy branch — owes an ideation and an assumption test.
  v.createNode({ title: "Noisy branch", layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({ title: "Noisy solution", layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
  v.linkNodes(OUTCOME, "Noisy branch");
  v.linkNodes("Noisy branch", "Noisy solution");
  return v;
}

describe("a resolved target scopes every done-blocking bucket to the branch", () => {
  test("the scoped sweep is done when the branch is current, whatever the rest of the tree owes", () => {
    const v = twoBranches();

    // Unscoped: the noisy branch blocks done (under-served + bare solution).
    const unscoped = computeNextWork(v, dir, 1);
    expect(unscoped.done).toBe(false);
    expect(unscoped.scope).toBeUndefined();

    // Scoped to the maintained branch: done, and the exclusions are counted.
    const scoped = computeNextWork(v, dir, 1, undefined, "Focus branch");
    expect(scoped.done).toBe(true);
    expect(scoped.scope).toMatchObject({ target: "Focus branch", resolved: true });
    expect(scoped.scope!.subtreeSize).toBe(4); // opportunity + solution + assumption + test
    expect(scoped.summary).toContain('Branch "Focus branch" is fully maintained');
  });

  test("work outside the branch is counted in scope.excluded and named in the summary, never dropped silently", () => {
    const v = twoBranches();
    const scoped = computeNextWork(v, dir, 1, undefined, "Focus branch");
    const excluded = Object.fromEntries(scoped.scope!.excluded.map((e) => [e.list, e.count]));
    // The noisy solution has no assumption test — excluded, not forgotten.
    expect(excluded["solutionsMissingAssumptions"]).toBe(1);
    expect(scoped.summary).toContain("Out of scope for this target");
    expect(scoped.solutionsMissingAssumptions).toEqual([]);
  });

  test("scoped work inside the branch still blocks done", () => {
    const v = twoBranches();
    // Scope to the branch that owes work: its own debts still count.
    const scoped = computeNextWork(v, dir, 1, undefined, "Noisy branch");
    expect(scoped.done).toBe(false);
    expect(scoped.solutionsMissingAssumptions.map((s) => s.title)).toEqual(["Noisy solution"]);
    expect(scoped.summary).toContain('Outstanding in branch "Noisy branch"');
  });

  test("unmapped evidence is out of scope wholesale — a record has no branch until it is mapped", () => {
    const v = twoBranches();
    writeEvidence(
      dir,
      { id: "INBOX:note.md", source: "INBOX:note.md", title: "A note", timestamp: "2026-08-11T00:00:00Z", body: "Something a customer said." },
      "inbox",
    );
    const unscoped = computeNextWork(v, dir, 1);
    expect(unscoped.unmappedEvidence.length).toBe(1);
    const scoped = computeNextWork(v, dir, 1, undefined, "Focus branch");
    expect(scoped.unmappedEvidence).toEqual([]);
    expect(scoped.scope!.excluded).toContainEqual({ list: "unmappedEvidence", count: 1 });
    // Mapping debt does not block a scoped done — the scoped verdict says so.
    expect(scoped.done).toBe(true);
  });

  test("hygiene issues outside the branch are excluded and counted; inside, they still block", () => {
    const v = twoBranches();
    // A near-duplicate pair in the noisy branch only. Token Jaccard must clear
    // the scan's 0.7: {noisy, retries, forever, silently} vs the same plus
    // {always} is 4/5 = 0.8.
    v.createNode({ title: "Noisy retries forever silently", layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
    v.createNode({ title: "Noisy retries forever silently always", layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
    v.linkNodes("Noisy branch", "Noisy retries forever silently");
    v.linkNodes("Noisy branch", "Noisy retries forever silently always");
    const scoped = computeNextWork(v, dir, 1, undefined, "Focus branch");
    expect(scoped.hygieneIssues).toEqual([]);
    expect(scoped.scope!.excluded.find((e) => e.list === "hygieneIssues")?.count).toBeGreaterThan(0);
    const scopedToNoisy = computeNextWork(v, dir, 1, undefined, "Noisy branch");
    expect(scopedToNoisy.hygieneIssues.some((h) => h.rule === "near-duplicate")).toBe(true);
    expect(scopedToNoisy.done).toBe(false);
  });
});

describe("a target that does not resolve is loud, never a silent narrowing", () => {
  test("mistyped target: unscoped sweep, resolved false, warning in the summary", () => {
    const v = twoBranches();
    const work = computeNextWork(v, dir, 1, undefined, "Focus brnach");
    expect(work.scope).toMatchObject({ target: "Focus brnach", resolved: false, subtreeSize: 0 });
    expect(work.scope!.excluded).toEqual([]);
    // The sweep ran over the whole tree — same verdict as no target at all.
    expect(work.done).toBe(computeNextWork(v, dir, 1).done);
    expect(work.summary).toContain("names no Opportunity in this tree");
  });

  test("a target naming a non-Opportunity (a Solution) is treated as unresolved", () => {
    const v = twoBranches();
    const work = computeNextWork(v, dir, 1, undefined, "Focus solution A");
    expect(work.scope!.resolved).toBe(false);
  });
});

describe("the selection is structurally human", () => {
  test("ost_next_work's input schema has no scope/target parameter — the target can only arrive from config", () => {
    const tools = buildOstTools({ vault: twoBranches(), dir, remote: { enabled: false } });
    const nextWork = tools.find((t) => (t as unknown as { name: string }).name === "ost_next_work") as unknown as {
      input_schema: { properties: Record<string, unknown>; additionalProperties: boolean };
    };
    // Pinned as the exact set rather than as "no key called target", because the
    // hazard is a parameter that scopes the sweep under some other name. Both
    // entries below narrow WHAT COMES BACK and neither narrows what is looked at:
    // `evidence` fetches one already-listed record in full, and `since` says the
    // caller is holding an earlier answer — a miss returns the whole sweep, so
    // nothing can be scoped away by presenting one.
    expect(Object.keys(nextWork.input_schema.properties)).toEqual(["evidence", "since"]);
    expect(nextWork.input_schema.additionalProperties).toBe(false);
  });
});

describe("subtreeTitles", () => {
  test("collects the branch across all layers and survives a cycle", () => {
    const v = twoBranches();
    const tree = v.readTree();
    const index = byTitle(tree);
    const titles = subtreeTitles(index.get("Focus branch")!, index);
    expect([...titles].sort()).toEqual(["Focus assumption", "Focus audit", "Focus branch", "Focus solution A"]);
    // A back edge must not hang the walk. Vault-level link guards may refuse a
    // cycle; build one directly on the in-memory shape instead.
    const a = { title: "A", layer: "Opportunity", links: ["B"] };
    const b = { title: "B", layer: "Opportunity", links: ["A"] };
    const idx = new Map([
      ["A", a],
      ["B", b],
    ]);
    const cyclic = subtreeTitles(a as never, idx as never);
    expect([...cyclic].sort()).toEqual(["A", "B"]);
  });
});
