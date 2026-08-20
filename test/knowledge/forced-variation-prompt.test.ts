/**
 * The instrument for "Does a named-dimension constraint raise distinctness
 * without lowering candidate quality" — the half of it a repository can answer.
 *
 * The test's own threshold compares a constrained candidate set against an
 * unconstrained one, which presumes the constraint reaches the model at all.
 * This asserts that half: an ideation prompt built for a target opportunity
 * names an explicit variation dimension for every candidate it requests, names
 * a different one for each sibling, carries each into the text the model reads,
 * and is refused when it claims the constraint and omits one.
 *
 * What it does NOT settle: distinctness up, and mean plausibility down by no
 * more than 10%. Both are a person blind-rating the two sets, and both stay
 * with a person. Green here means the constraint is real, not that it works.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  VARIATION_DIMENSIONS,
  assertForcedVariation,
  buildIdeationPrompt,
  checkForcedVariation,
  isVariationDimension,
  variationAssignments,
  type IdeationPrompt,
} from "../../src/knowledge/forced-variation.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import type { Vault } from "../../src/ost/vault.js";

const OPPORTUNITY = "When I ask for options I get three phrasings of one idea";

describe("the variation dimensions", () => {
  test("every dimension is named, labelled, and asks a question a candidate can answer", () => {
    for (const d of VARIATION_DIMENSIONS) {
      expect(d.id).toMatch(/^[a-z-]+$/);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.ask).toMatch(/\?$/);
    }
    expect(new Set(VARIATION_DIMENSIONS.map((d) => d.id)).size).toBe(VARIATION_DIMENSIONS.length);
  });

  test("the four the solution node names are among them", () => {
    const ids = VARIATION_DIMENSIONS.map((d) => d.id);
    expect(ids).toContain("who-does-the-work");
    expect(ids).toContain("automated-vs-manual");
    expect(ids).toContain("bought-vs-built");
    expect(ids).toContain("what-is-given-up");
  });

  test("isVariationDimension recognises exactly the named dimensions", () => {
    for (const d of VARIATION_DIMENSIONS) expect(isVariationDimension(d.id)).toBe(true);
    expect(isVariationDimension("novelty")).toBe(false);
    expect(isVariationDimension("")).toBe(false);
  });
});

describe("an ideation prompt built for a target opportunity", () => {
  test("names an explicit variation dimension for every candidate requested", () => {
    const prompt = buildIdeationPrompt({ opportunity: OPPORTUNITY, candidates: 3 });
    expect(prompt.forcedVariation).toBe(true);
    expect(prompt.candidates).toHaveLength(3);
    for (const c of prompt.candidates) {
      expect(c.dimension).not.toBeNull();
      expect(isVariationDimension(c.dimension!.id)).toBe(true);
    }
  });

  test("names a DIFFERENT dimension for each sibling candidate", () => {
    const prompt = buildIdeationPrompt({ opportunity: OPPORTUNITY, candidates: 3 });
    const ids = prompt.candidates.map((c) => c.dimension!.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("carries each dimension into the text the model actually reads", () => {
    const prompt = buildIdeationPrompt({ opportunity: OPPORTUNITY, candidates: 3 });
    expect(prompt.text).toContain(OPPORTUNITY);
    for (const c of prompt.candidates) {
      expect(prompt.text).toContain(c.dimension!.id);
      expect(prompt.text).toContain(c.dimension!.label);
      expect(prompt.text).toContain(c.dimension!.ask);
    }
    // A constraint the prompt names and then forgets to enforce is a hope again.
    expect(prompt.text).toMatch(/must take a position on that dimension/);
  });

  test("lists the existing siblings, so a new candidate differs from them too", () => {
    const prompt = buildIdeationPrompt({
      opportunity: OPPORTUNITY,
      existingSolutions: ["Independent ideators that never see each other's candidates"],
      candidates: 2,
    });
    expect(prompt.text).toContain("Independent ideators that never see each other's candidates");
  });

  test("a second request on the same opportunity starts where the first left off", () => {
    // One sibling already exists: it took the first dimension, so the next two
    // candidates are asked on the second and third — not on the first again.
    const fresh = buildIdeationPrompt({ opportunity: OPPORTUNITY, candidates: 3 });
    const later = buildIdeationPrompt({ opportunity: OPPORTUNITY, existingSolutions: ["Taken"], candidates: 2 });
    expect(later.candidates.map((c) => c.dimension!.id)).toEqual(
      fresh.candidates.slice(1).map((c) => c.dimension!.id),
    );
  });

  test("passes its own check, and its assignments are the compact form of its slots", () => {
    const prompt = buildIdeationPrompt({ opportunity: OPPORTUNITY, candidates: 4 });
    expect(checkForcedVariation(prompt)).toEqual([]);
    expect(() => assertForcedVariation(prompt)).not.toThrow();
    const assigned = variationAssignments(prompt);
    expect(assigned.map((a) => a.candidate)).toEqual([1, 2, 3, 4]);
    expect(assigned.map((a) => a.dimension)).toEqual(prompt.candidates.map((c) => c.dimension!.id));
  });

  test("can ask for every named dimension at once, and not one more", () => {
    const all = buildIdeationPrompt({ opportunity: OPPORTUNITY, candidates: VARIATION_DIMENSIONS.length });
    expect(new Set(all.candidates.map((c) => c.dimension!.id)).size).toBe(VARIATION_DIMENSIONS.length);
    // Refused rather than doubling a dimension up: a request the constraint
    // cannot be honoured for is not quietly honoured for most of it.
    expect(() => buildIdeationPrompt({ opportunity: OPPORTUNITY, candidates: VARIATION_DIMENSIONS.length + 1 })).toThrow(
      /distinct variation dimensions/,
    );
  });

  test("refuses a request for zero candidates", () => {
    expect(() => buildIdeationPrompt({ opportunity: OPPORTUNITY, candidates: 0 })).toThrow(/at least one candidate/);
  });
});

describe("a prompt built with the constraint enabled that omits the dimension", () => {
  function sound(): IdeationPrompt {
    return buildIdeationPrompt({ opportunity: OPPORTUNITY, candidates: 3 });
  }

  test("fails when a candidate carries no dimension", () => {
    const p = sound();
    const tampered: IdeationPrompt = {
      ...p,
      candidates: p.candidates.map((c) => (c.candidate === 2 ? { ...c, dimension: null } : c)),
    };
    const violations = checkForcedVariation(tampered);
    expect(violations).toEqual([expect.objectContaining({ candidate: 2, kind: "missing-dimension" })]);
    expect(() => assertForcedVariation(tampered)).toThrow(/candidate 2: missing-dimension/);
    expect(() => variationAssignments(tampered)).toThrow(/missing-dimension/);
  });

  test("fails when two candidates share a dimension", () => {
    const p = sound();
    const tampered: IdeationPrompt = {
      ...p,
      candidates: p.candidates.map((c) => (c.candidate === 3 ? { ...c, dimension: p.candidates[0].dimension } : c)),
    };
    expect(checkForcedVariation(tampered).map((v) => v.kind)).toContain("repeated-dimension");
    expect(() => assertForcedVariation(tampered)).toThrow(/candidate 3: repeated-dimension/);
  });

  test("fails when a candidate names a dimension nobody defined", () => {
    const p = sound();
    const tampered: IdeationPrompt = {
      ...p,
      candidates: p.candidates.map((c) =>
        c.candidate === 1 ? { ...c, dimension: { id: "novelty", label: "Novelty", ask: "Is it new?" } } : c,
      ),
    };
    expect(checkForcedVariation(tampered).map((v) => v.kind)).toContain("unknown-dimension");
  });

  test("fails when the dimension is assigned but never reaches the text", () => {
    const p = sound();
    const tampered: IdeationPrompt = { ...p, text: `Ideate 3 candidate solution(s) for "${OPPORTUNITY}".` };
    const kinds = checkForcedVariation(tampered).map((v) => v.kind);
    expect(kinds).toEqual(["unnamed-in-text", "unnamed-in-text", "unnamed-in-text"]);
  });
});

describe("the unconstrained arm", () => {
  test("carries no dimension, so a human has a control set to blind-rate against", () => {
    const prompt = buildIdeationPrompt({ opportunity: OPPORTUNITY, candidates: 3, forcedVariation: false });
    expect(prompt.forcedVariation).toBe(false);
    expect(prompt.candidates.map((c) => c.dimension)).toEqual([null, null, null]);
    for (const d of VARIATION_DIMENSIONS) expect(prompt.text).not.toContain(d.id);
  });

  test("promises nothing, so the check has nothing to refuse", () => {
    const prompt = buildIdeationPrompt({ opportunity: OPPORTUNITY, candidates: 3, forcedVariation: false });
    expect(checkForcedVariation(prompt)).toEqual([]);
    expect(variationAssignments(prompt)).toEqual([]);
  });

  test("is not bounded by the dimension count — the constraint is what bounds a request", () => {
    const prompt = buildIdeationPrompt({
      opportunity: OPPORTUNITY,
      candidates: VARIATION_DIMENSIONS.length + 2,
      forcedVariation: false,
    });
    expect(prompt.candidates).toHaveLength(VARIATION_DIMENSIONS.length + 2);
  });
});

describe("the constraint reaches the surface the model actually reads", () => {
  /** The `minSolutionsPerOpportunity` every other spec in this repo fixtures against. */
  const MIN = 3;
  let dir: string;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-forced-variation-"));
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function opportunity(vault: Vault, title: string): void {
    vault.createNode({ title, layer: "Opportunity", evidence: "observed", source: "INBOX:n.md", body: "b", tags: [], links: [] });
    vault.linkNodes("Retention", title);
  }
  function solution(vault: Vault, title: string, parent: string): void {
    vault.createNode({ title, layer: "Solution", evidence: "assertion", body: "b", tags: [], links: [] });
    vault.linkNodes(parent, title);
  }

  test("ost_next_work assigns a distinct dimension to each candidate an under-served opportunity still needs", () => {
    const vault = buildPassContext(dir).vault;
    opportunity(vault, OPPORTUNITY);
    solution(vault, "Independent ideators that never see each other's candidates", OPPORTUNITY);

    const entry = computeNextWork(buildPassContext(dir).vault, dir, MIN).underservedOpportunities.find(
      (o) => o.title === OPPORTUNITY,
    );
    expect(entry).toBeDefined();
    expect(entry!.solutions).toBe(1);
    // One sibling exists and three are needed: two candidates, two dimensions, no repeats.
    expect(entry!.variation).toHaveLength(MIN - 1);
    const ids = entry!.variation.map((v) => v.dimension);
    expect(new Set(ids).size).toBe(ids.length);
    for (const v of entry!.variation) {
      expect(isVariationDimension(v.dimension)).toBe(true);
      expect(v.ask.length).toBeGreaterThan(0);
    }
    // And it is the prompt builder's own assignment, not a second copy of the rule.
    expect(ids).toEqual(
      buildIdeationPrompt({ opportunity: OPPORTUNITY, existingSolutions: ["x"], candidates: MIN - 1 }).candidates.map(
        (c) => c.dimension!.id,
      ),
    );
  });

  test("an opportunity with no solutions yet is asked on the first dimensions; one with a sibling is asked on the next", () => {
    const vault = buildPassContext(dir).vault;
    opportunity(vault, "Nothing here yet");
    opportunity(vault, "One sibling already");
    solution(vault, "The first idea", "One sibling already");

    const work = computeNextWork(buildPassContext(dir).vault, dir, MIN);
    const bare = work.underservedOpportunities.find((o) => o.title === "Nothing here yet")!;
    const partial = work.underservedOpportunities.find((o) => o.title === "One sibling already")!;
    expect(bare.variation.map((v) => v.dimension)).toEqual(VARIATION_DIMENSIONS.slice(0, 3).map((d) => d.id));
    expect(partial.variation.map((v) => v.dimension)).toEqual(VARIATION_DIMENSIONS.slice(1, 3).map((d) => d.id));
  });
});
