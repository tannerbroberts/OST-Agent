/**
 * The instrument for "Do blind parallel ideators produce more distinct
 * candidates than one agent asked for three" — the half of it a repository can
 * answer.
 *
 * The test's own premise is that anchoring, not model capability, is what
 * narrows a candidate set. That presumes the ideators are genuinely blind to
 * each other. This asserts exactly that and nothing more: each parallel
 * ideator's assembled prompt contains none of its siblings' candidate text, and
 * a round configured as blind that leaks a sibling candidate into a prompt
 * fails. It runs against the real prompt-assembly path — the one
 * `ost_next_work` publishes from — so it goes red on a leak rather than on the
 * absence of a module.
 *
 * What it does NOT settle: whether the blind set is more distinct. The
 * assumption test's pre-committed threshold is a human blind-rating shuffled
 * sets on three opportunities, and it stays with that human. Green here means
 * the blindness the solution is named for actually holds, not that it works.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  COLLISION_THRESHOLD,
  MIN_CHECKABLE_WORDS,
  assertBlindIdeation,
  buildIdeationRound,
  checkBlindness,
  checkRoundIsolation,
  mergeIdeationRound,
  roundAssignments,
  type IdeationRound,
  type IdeatorReturn,
} from "../../src/knowledge/blind-ideation.js";
import { VARIATION_DIMENSIONS, isVariationDimension } from "../../src/knowledge/forced-variation.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import type { Vault } from "../../src/ost/vault.js";

const OPPORTUNITY = "When I ask for options I get three phrasings of one idea";

/** Three candidates an ideator might plausibly return, each long enough to be checkable. */
const RETURNED: IdeatorReturn[] = [
  { ideator: 1, candidates: ["A weekly digest a person reads and triages by hand"] },
  { ideator: 2, candidates: ["A scheduled job that files the findings without anyone asking"] },
  { ideator: 3, candidates: ["Buy the incumbent's alerting product and wire it to the vault"] },
];

function round(candidates = 3, existingSolutions: string[] = []): IdeationRound {
  return buildIdeationRound({ opportunity: OPPORTUNITY, existingSolutions, candidates });
}

describe("a blind round", () => {
  test("is one independent ideator per candidate, each asking for exactly one", () => {
    const r = round(3);
    expect(r.arm).toBe("blind");
    expect(r.candidates).toBe(3);
    expect(r.ideators).toHaveLength(3);
    expect(r.ideators.map((i) => i.ideator)).toEqual([1, 2, 3]);
    for (const it of r.ideators) expect(it.prompt.candidates).toHaveLength(1);
  });

  test("assembles every prompt from the same frozen shared context and nothing else", () => {
    const r = round(3, ["Something already under it"]);
    expect(r.shared).toEqual({ opportunity: OPPORTUNITY, existingSolutions: ["Something already under it"] });
    for (const it of r.ideators) {
      expect(it.prompt.text).toContain(OPPORTUNITY);
      expect(it.prompt.text).toContain("Something already under it");
    }
  });

  test("gives each ideator its own dimension and names no sibling's in its prompt", () => {
    const r = round(3);
    const ids = r.ideators.map((it) => it.prompt.candidates[0].dimension!.id);
    expect(new Set(ids).size).toBe(3);
    for (const it of r.ideators) {
      const own = it.prompt.candidates[0].dimension!.id;
      for (const other of ids) {
        if (other === own) continue;
        expect(it.prompt.text).not.toContain(other);
      }
    }
  });

  test("passes its own isolation check before any model has run", () => {
    const r = round(3);
    expect(checkRoundIsolation(r)).toEqual([]);
    expect(() => assertBlindIdeation(r)).not.toThrow();
  });

  test("no ideator's prompt contains a sibling's candidate text", () => {
    const r = round(3);
    expect(checkBlindness(r, RETURNED)).toEqual([]);
    expect(() => assertBlindIdeation(r, RETURNED)).not.toThrow();
    // Said the other way round, over the raw text, so a reader can see the claim
    // without trusting the checker that makes it.
    for (const it of r.ideators) {
      for (const other of RETURNED) {
        if (other.ideator === it.ideator) continue;
        for (const c of other.candidates) expect(it.prompt.text).not.toContain(c);
      }
    }
  });

  test("starts after the dimensions the existing siblings already took", () => {
    const fresh = round(3);
    const later = round(2, ["Taken"]);
    expect(later.ideators.map((i) => i.prompt.candidates[0].dimension!.id)).toEqual(
      fresh.ideators.slice(1).map((i) => i.prompt.candidates[0].dimension!.id),
    );
  });

  test("refuses a round it cannot give distinct dimensions to, and one asking for nothing", () => {
    expect(() => buildIdeationRound({ opportunity: OPPORTUNITY, candidates: VARIATION_DIMENSIONS.length + 1 })).toThrow(
      /distinct variation dimensions/,
    );
    expect(() => buildIdeationRound({ opportunity: OPPORTUNITY, candidates: 0 })).toThrow(/at least one candidate/);
  });
});

describe("a round configured as blind that leaks", () => {
  test("fails when a sibling's candidate is spliced into a prompt", () => {
    const r = round(3);
    const leaked = "A weekly digest a person reads and triages by hand";
    const tampered: IdeationRound = {
      ...r,
      ideators: r.ideators.map((it) =>
        it.ideator === 2 ? { ...it, prompt: { ...it.prompt, text: `${it.prompt.text}\nAlready proposed: ${leaked}` } } : it,
      ),
    };
    const violations = checkBlindness(tampered, RETURNED);
    expect(violations).toEqual([expect.objectContaining({ ideator: 2, kind: "sibling-candidate-in-prompt" })]);
    expect(() => assertBlindIdeation(tampered, RETURNED)).toThrow(/ideator 2: sibling-candidate-in-prompt/);
    // And the merge refuses it, so a leaked set cannot be laundered into the tree.
    expect(() => mergeIdeationRound(tampered, RETURNED)).toThrow(/sibling-candidate-in-prompt/);
  });

  test("fails on a leak that was reformatted on the way in", () => {
    const r = round(3);
    const tampered: IdeationRound = {
      ...r,
      ideators: r.ideators.map((it) =>
        it.ideator === 3
          ? { ...it, prompt: { ...it.prompt, text: `${it.prompt.text}\n"A WEEKLY digest, a person reads   and triages by hand."` } }
          : it,
      ),
    };
    expect(checkBlindness(tampered, RETURNED).map((v) => v.kind)).toEqual(["sibling-candidate-in-prompt"]);
  });

  test("fails the assembly check too, because the prompt is no longer what the shared context yields", () => {
    const r = round(3);
    const tampered: IdeationRound = {
      ...r,
      ideators: r.ideators.map((it) =>
        it.ideator === 1 ? { ...it, prompt: { ...it.prompt, text: `${it.prompt.text}\nsomething from outside` } } : it,
      ),
    };
    // This is the half that needs no candidates at all: an accumulating loop —
    // the natural way to write parallel ideation wrong — cannot survive it.
    expect(checkRoundIsolation(tampered)).toEqual([expect.objectContaining({ ideator: 1, kind: "context-drift" })]);
  });

  test("fails when an ideator is told which dimension a sibling took", () => {
    const r = round(3);
    const siblingDimension = r.ideators[1].prompt.candidates[0].dimension!.id;
    const tampered: IdeationRound = {
      ...r,
      ideators: r.ideators.map((it) =>
        it.ideator === 1
          ? {
              ...it,
              // Rebuilt to match, so only the coordination is left to catch.
              prompt: { ...it.prompt, text: `${it.prompt.text}` },
            }
          : it,
      ),
    };
    tampered.ideators[0] = {
      ...tampered.ideators[0],
      prompt: { ...tampered.ideators[0].prompt, text: `${tampered.ideators[0].prompt.text}\nIdeator 2 has ${siblingDimension}.` },
    };
    const kinds = checkRoundIsolation(tampered).map((v) => v.kind);
    expect(kinds).toContain("sibling-dimension-in-prompt");
  });

  test("fails when the ideators are misnumbered", () => {
    const r = round(3);
    const tampered: IdeationRound = { ...r, ideators: [r.ideators[0], r.ideators[2]] };
    expect(checkRoundIsolation(tampered)).toEqual([expect.objectContaining({ kind: "context-drift" })]);
  });

  test("refuses a return it cannot place, and an ideator that returned nothing", () => {
    const r = round(3);
    expect(checkBlindness(r, [...RETURNED, { ideator: 9, candidates: ["From nowhere in this round"] }])).toEqual([
      expect.objectContaining({ ideator: 9, kind: "unknown-ideator" }),
    ]);
    expect(checkBlindness(r, RETURNED.slice(0, 2))).toEqual([
      expect.objectContaining({ ideator: 3, kind: "missing-return" }),
    ]);
  });

  test("refuses a candidate too short to tell a leak from a coincidence", () => {
    const r = round(3);
    const terse: IdeatorReturn[] = [{ ideator: 1, candidates: ["Digest"] }, RETURNED[1], RETURNED[2]];
    const violations = checkBlindness(r, terse);
    expect(violations).toEqual([expect.objectContaining({ ideator: 1, kind: "uncheckable-candidate" })]);
    expect(violations[0].detail).toContain(`${MIN_CHECKABLE_WORDS} words`);
  });

  test("does not call the shared context a leak — every prompt carries it by design", () => {
    const shared = "A scheduled job that files the findings without anyone asking";
    const r = round(3, [shared]);
    const echoing: IdeatorReturn[] = [{ ideator: 1, candidates: [shared] }, RETURNED[1], RETURNED[2]];
    expect(checkBlindness(r, echoing)).toEqual([]);
  });
});

describe("the anchored arm", () => {
  test("is one ideator asked for all of them, so a person has a set to rate the blind one against", () => {
    const r = buildIdeationRound({ opportunity: OPPORTUNITY, candidates: 3, arm: "anchored" });
    expect(r.arm).toBe("anchored");
    expect(r.ideators).toHaveLength(1);
    expect(r.ideators[0].prompt.candidates).toHaveLength(3);
  });

  test("promises no isolation, so the blindness check has nothing to refuse", () => {
    const r = buildIdeationRound({ opportunity: OPPORTUNITY, candidates: 3, arm: "anchored" });
    expect(checkRoundIsolation(r)).toEqual([]);
    expect(checkBlindness(r, [{ ideator: 1, candidates: ["Anything at all, said at some length"] }])).toEqual([]);
  });

  test("asks for the same dimensions as the blind round, so the arms differ only in isolation", () => {
    const blind = buildIdeationRound({ opportunity: OPPORTUNITY, candidates: 3 });
    const anchored = buildIdeationRound({ opportunity: OPPORTUNITY, candidates: 3, arm: "anchored" });
    expect(anchored.ideators[0].prompt.candidates.map((c) => c.dimension!.id)).toEqual(
      blind.ideators.map((i) => i.prompt.candidates[0].dimension!.id),
    );
  });
});

describe("the merge — the only step at which the candidates meet", () => {
  test("keeps every candidate and says which ideator drew it", () => {
    const merged = mergeIdeationRound(round(3), RETURNED);
    expect(merged.candidates.map((c) => c.candidate)).toEqual([1, 2, 3]);
    expect(merged.candidates.map((c) => c.ideator)).toEqual([1, 2, 3]);
    expect(merged.candidates.map((c) => c.text)).toEqual(RETURNED.flatMap((r) => r.candidates));
    for (const c of merged.candidates) expect(isVariationDimension(c.dimension!)).toBe(true);
    expect(merged.collisions).toEqual([]);
  });

  test("reports two independent draws landing on one idea rather than dropping either", () => {
    const collided: IdeatorReturn[] = [
      RETURNED[0],
      { ideator: 2, candidates: ["A weekly digest a person reads and triages by hand as well"] },
      RETURNED[2],
    ];
    const merged = mergeIdeationRound(round(3), collided);
    expect(merged.candidates).toHaveLength(3);
    expect(merged.collisions).toEqual([
      expect.objectContaining({ kind: "coincidence", candidate: 2, duplicateOf: 1 }),
    ]);
    expect(merged.collisions[0].score).toBeGreaterThanOrEqual(COLLISION_THRESHOLD);
  });

  test("separates a candidate that only restated something already under the opportunity", () => {
    const existing = "A scheduled job that files the findings without anyone asking";
    const merged = mergeIdeationRound(round(3, [existing]), [
      { ideator: 1, candidates: [existing] },
      RETURNED[1],
      RETURNED[2],
    ]);
    // Ideator 2's genuinely-new candidate happens to be the same sentence, so the
    // pair is named by kind: restating shared context is not two ideators agreeing.
    expect(merged.collisions.filter((c) => c.kind === "restates-shared-context").map((c) => c.candidate)).toContain(1);
  });
});

describe("blind ideation reaches the surface the model actually reads", () => {
  const MIN = 3;
  let dir: string;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-blind-ideation-"));
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function opportunity(vault: Vault, title: string): void {
    vault.createNode({ title, layer: "Opportunity", evidence: "observed", source: "INBOX:n.md", body: "b", tags: [], links: [] });
    vault.linkNodes("Retention", title);
  }

  test("ost_next_work marks an under-served opportunity blind and assigns one ideator per candidate", () => {
    opportunity(buildPassContext(dir).vault, OPPORTUNITY);
    const entry = computeNextWork(buildPassContext(dir).vault, dir, MIN).underservedOpportunities.find(
      (o) => o.title === OPPORTUNITY,
    );
    expect(entry).toBeDefined();
    expect(entry!.ideation).toBe("blind");
    expect(entry!.variation).toHaveLength(MIN);
    expect(entry!.variation.map((v) => v.candidate)).toEqual([1, 2, 3]);
    // And it is the round builder's own assignment, not a second copy of the rule.
    expect(entry!.variation).toEqual(
      roundAssignments(buildIdeationRound({ opportunity: OPPORTUNITY, candidates: MIN })),
    );
  });

  test("the assignments a blind round publishes are the ones a single anchored prompt would have made", () => {
    // The two arms ask the same questions; what differs is how many contexts
    // they are asked in. A surface whose dimensions moved when isolation was
    // switched on would be measuring two changes at once.
    const blind = roundAssignments(buildIdeationRound({ opportunity: OPPORTUNITY, candidates: 3 }));
    const anchored = roundAssignments(buildIdeationRound({ opportunity: OPPORTUNITY, candidates: 3, arm: "anchored" }));
    expect(blind).toEqual(anchored);
  });
});
