/**
 * Does a declared resource picture actually change which work comes first?
 *
 * The candidate is a manifest the planner must cite before it ranks anything.
 * The assumption underneath it — the one this file exists to settle — is that
 * declaring the operator's resources *moves the order*. If the ranking is
 * identical with and without the manifest, the manifest is documentation rather
 * than a planner input, and should not be built.
 *
 * The bar was pre-committed on the assumption test, before anything was
 * measured: **at least two of the current top five positions must change, or an
 * item must enter or leave the top five. One change or none kills the
 * candidate** — it would mean the planner was already conditioning on these
 * facts implicitly and the manifest buys nothing.
 *
 * The file is in four parts, and the order matters:
 *
 *   1. **The citation, which is unconditional.** An order that cited only what
 *      happened to be declared would report a vault with no manifest as a vault
 *      with no assumptions. Every blank is named, always.
 *   2. **The detectors, with their controls.** Every assertion in part 4 would
 *      also pass against a detector that fired on everything, so the controls
 *      that force each one to find nothing are the assertions carrying this file.
 *   3. **The baseline is the real one.** The manifest-absent order must equal
 *      what `ost-agent buildable` prints today, or part 4 is comparing two
 *      rankings this repository invented rather than measuring what declaring
 *      resources buys.
 *   4. **The shift**, over the corpus cut in `test/fixtures/manifest-planner/`,
 *      against the bar above — plus the three fields that did no ordering work,
 *      asserted so that losing the two that do is a failure here.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, test } from "vitest";
import { buildableSolutions } from "../../src/eval/buildable.js";
import type { OstNode } from "../../src/ost/node.js";
import {
  EMPTY_MANIFEST,
  MANIFEST_FILENAME,
  RESOURCES,
  ResourceManifestSchema,
  blankResources,
  declaredResources,
  readResourceManifest,
  type ResourceManifest,
} from "../../src/product/manifest.js";
import {
  capitalNamed,
  credentialDemands,
  formatPriorityOrder,
  outsidePeople,
  personInTheLoop,
  rankBuildableWork,
} from "../../src/product/planner.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "manifest-planner");

/** The corpus: every buildable solution of the `ost-agent-meta` vault on 2026-08-04, plus its tests. */
const CORPUS: OstNode[] = fs
  .readFileSync(path.join(FIXTURES, "candidates.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as OstNode);

/** The manifest, hand-filled for that vault from facts already recorded in it. */
const HAND_FILLED: ResourceManifest = ResourceManifestSchema.parse(
  parseYaml(fs.readFileSync(path.join(FIXTURES, "hand-filled.ost.resources.yaml"), "utf8")),
);

/** The pre-committed bar, transcribed from the assumption test's `threshold:` field. */
const MIN_POSITIONS_CHANGED = 2;
const TOP = 5;

function titles(order: { ranked: { solution: string }[] }, n = TOP): string[] {
  return order.ranked.slice(0, n).map((r) => r.solution);
}

/** An AssumptionTest with everything defaulted, so each control states only what it is about. */
function testNode(over: Partial<OstNode> = {}): OstNode {
  return {
    title: "Replay the recorded failures and count how many reproduce",
    layer: "AssumptionTest",
    body: "Run the recorded traces back through the reader and diff the outcome.",
    links: [],
    tags: [],
    ...over,
  } as OstNode;
}

describe("the citation is unconditional", () => {
  test("with no manifest at all, every resource is cited as a blank", () => {
    const order = rankBuildableWork(CORPUS, EMPTY_MANIFEST);
    expect(order.citation.declared).toEqual([]);
    expect(order.citation.blank.map((b) => b.resource)).toEqual(RESOURCES.map((r) => r.id));
    // A blank names what a declaration would have conditioned — the cost of the silence.
    for (const b of order.citation.blank) expect(b.wouldHaveConditioned).toBeTruthy();
  });

  test("the order cannot be obtained without it", () => {
    const order = rankBuildableWork(CORPUS, HAND_FILLED);
    // The shape is the enforcement: one function returns a ranking, and the
    // ranking arrives welded to the citation.
    expect(Object.keys(order).sort()).toEqual(["citation", "ranked"]);
    expect(order.citation.declared.map((d) => d.resource)).toEqual(RESOURCES.map((r) => r.id));
    expect(order.citation.blank).toEqual([]);
  });

  test("a reader is told which resources are guessed at, in the rendered order", () => {
    const rendered = formatPriorityOrder(rankBuildableWork(CORPUS, EMPTY_MANIFEST));
    expect(rendered).toMatch(/UNDECLARED — 5 resource\(s\) this order is guessing about/);
    expect(rendered).toMatch(/no resource is declared, so this order conditions on no fact about the operator/);
  });

  test("an unreadable manifest ranks as if nothing were declared, and says so", () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ost-manifest-"));
    try {
      fs.writeFileSync(path.join(dir, MANIFEST_FILENAME), "hours:\n  perWeek: not-a-number\n", "utf8");
      const load = readResourceManifest(dir);
      expect(load.problem).toMatch(/invalid ost\.resources\.yaml/);
      expect(load.manifest).toEqual(EMPTY_MANIFEST);
      const order = rankBuildableWork(CORPUS, load.manifest, load.problem);
      expect(order.citation.problem).toBe(load.problem);
      expect(order.citation.blank).toHaveLength(RESOURCES.length);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a vault with no manifest file is every-field-blank, not an error", () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ost-manifest-"));
    try {
      const load = readResourceManifest(dir);
      expect(load.problem).toBeUndefined();
      expect(declaredResources(load.manifest)).toEqual([]);
      expect(blankResources(load.manifest)).toEqual(RESOURCES.map((r) => r.id));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the detectors find nothing when there is nothing", () => {
  test("capital is a sum, not a word about scarcity", () => {
    // The vocabulary this repository's own nodes use about tokens and attention.
    expect(capitalNamed("a cheap check that fits the budget and costs the operator nothing")).toBeUndefined();
    expect(capitalNamed("spend it down across the run, and report what it cost")).toBeUndefined();
    expect(capitalNamed("buy a second AI credential just to try it")).toBeUndefined();
    // And what it does find.
    expect(capitalNamed("a $200 pilot with three teams")).toMatch(/\$200/);
    expect(capitalNamed("500 USD of ad spend")).toMatch(/500 USD/);
  });

  test("capital fires on none of the 39 real candidates — a measured zero, not an untried rule", () => {
    const withCapital = rankBuildableWork(CORPUS, HAND_FILLED).citation.declared.find((d) => d.resource === "capital");
    expect(withCapital?.conditioned).toBe(0);
  });

  test("a credential demand needs a credential the operator named", () => {
    const text = "publish the tree to npm and hand the run a token";
    expect(credentialDemands(text, [])).toEqual([]);
    expect(credentialDemands(text, ["publish"])).toEqual(["publish"]);
    // Word-bounded: a declared name is a word, not a substring.
    expect(credentialDemands("republished the corrected node", ["publish"])).toEqual([]);
    expect(credentialDemands("the publishing schedule", ["publish"])).toEqual([]);
  });

  test("outside people are read by the existing triage vocabulary, and it can stay silent", () => {
    expect(outsidePeople([testNode()])).toBeUndefined();
    expect(outsidePeople([testNode({ body: "Ask five strangers to try it cold." })])).toMatch(/strangers/);
  });

  test("the human-hours detector fails closed, which makes it a constant on this corpus", () => {
    expect(personInTheLoop([testNode({ lane: "compute-only" })])).toBeUndefined();
    expect(personInTheLoop([testNode()])).toMatch(/carries no lane/);
    // Every one of the 39 real tests is unlabelled, so `hours` defers all of them
    // — and a term that fires on everything changes no order at all. The finding
    // is asserted rather than written down, so losing it is a failure here.
    const hours = rankBuildableWork(CORPUS, HAND_FILLED).citation.declared.find((d) => d.resource === "hours");
    expect(hours?.conditioned).toBe(CORPUS.filter((n) => n.layer === "Solution").length);
  });
});

describe("the baseline is the order the product actually emits", () => {
  test("with every resource blank, the planner reproduces `ost-agent buildable`", () => {
    const order = rankBuildableWork(CORPUS, EMPTY_MANIFEST);
    expect(order.ranked.map((r) => r.solution)).toEqual(buildableSolutions(CORPUS).map((b) => b.solution));
    // and nothing is deferred, because nothing is declared to be unavailable
    expect(order.ranked.every((r) => r.unmet.length === 0)).toBe(true);
  });

  test("the corpus is the one the provenance describes", () => {
    const solutions = CORPUS.filter((n) => n.layer === "Solution");
    const tests = CORPUS.filter((n) => n.layer === "AssumptionTest");
    expect(solutions).toHaveLength(39);
    expect(tests).toHaveLength(39);
    // Both flatten a ranking term, and both are why the baseline is tree order.
    expect(solutions.every((s) => s.evidence === "assertion")).toBe(true);
    expect(tests.every((t) => t.lane === undefined)).toBe(true);
  });
});

describe("the shift — the pre-committed bar", () => {
  const without = rankBuildableWork(CORPUS, EMPTY_MANIFEST);
  const withManifest = rankBuildableWork(CORPUS, HAND_FILLED);
  const before = titles(without);
  const after = titles(withManifest);

  test("at least two of the top five positions change, or an item enters or leaves", () => {
    const positionsChanged = before.filter((s, i) => after[i] !== s).length;
    const left = before.filter((s) => !after.includes(s));
    const entered = after.filter((s) => !before.includes(s));

    // The bar, exactly as the assumption test pre-committed it.
    expect(positionsChanged >= MIN_POSITIONS_CHANGED || left.length > 0 || entered.length > 0).toBe(true);

    // What actually happened, pinned so a regression to "it barely moved" is
    // visible rather than absorbed by the `or`.
    expect(positionsChanged).toBe(5);
    expect(left).toHaveLength(2);
    expect(entered).toHaveLength(2);
  });

  test("the two candidates that left the top five name why, in the operator's own declarations", () => {
    const left = before.filter((s) => !after.includes(s));
    for (const title of left) {
      const candidate = withManifest.ranked.find((r) => r.solution === title)!;
      expect(candidate.unmet.length).toBeGreaterThan(1);
      // A deferral quotes the phrase that caused it and the declared fact that
      // blocked it, so a reader can disagree with the call in one glance.
      for (const u of candidate.unmet) {
        expect(u.demand).toBeTruthy();
        expect(u.declared).toBeTruthy();
      }
    }
  });

  test("two of the five declared fields did the ordering; the other three are measured zeros", () => {
    const by = new Map(withManifest.citation.declared.map((d) => [d.resource, d.conditioned]));
    // Does the work:
    expect(by.get("social-reach")).toBe(4);
    expect(by.get("credentials")).toBe(1);
    // Deferred nothing:
    expect(by.get("capital")).toBe(0);
    expect(by.get("compute")).toBe(0);
    // Deferred everything, which is the same as deferring nothing:
    expect(by.get("hours")).toBe(39);
  });

  test("the ranking is a permutation — declaring resources defers work, it never drops it", () => {
    expect(withManifest.ranked).toHaveLength(without.ranked.length);
    expect(withManifest.ranked.map((r) => r.solution).sort()).toEqual(without.ranked.map((r) => r.solution).sort());
  });

  test("the rendered order carries the citation above the ranking", () => {
    const rendered = formatPriorityOrder(withManifest);
    expect(rendered.indexOf("social-reach")).toBeLessThan(rendered.indexOf("1. "));
    expect(rendered).toMatch(/deferred 4 candidate\(s\)/);
    expect(rendered).toMatch(/conditioned nothing here/);
    // And it refuses to be read as a verdict on the work.
    expect(rendered).toMatch(/It does not say the work is worth doing/);
    expect(rendered).toMatch(/cannot tell whether the manifest is still true/);
  });
});
