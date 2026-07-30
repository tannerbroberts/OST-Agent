/**
 * Deterministic large-tree fixtures, shared by the Gate Z scale tests.
 *
 * Not a `.test.ts` file, so vitest does not collect it (`include:
 * test/(star)(star)/(star).test.ts`); it exists so the Z2 response-size pin and
 * the Z3 wall-clock pin measure the SAME tree. Two hand-rolled fixtures would
 * make a size result and a timing result impossible to read against each other,
 * and the two criteria are only meaningful together — Z1's history is what
 * happens when a scale defect moves between columns unnoticed.
 *
 * Everything here is seeded. `Math.random()` in a benchmark means a run that
 * fails once and passes on retry, which trains everyone to hit retry.
 */
import type { Vault } from "../../src/ost/vault.js";

/**
 * Mulberry32 — a small, fast, seeded PRNG.
 *
 * Written out rather than imported so the fixture cannot drift with a dependency
 * upgrade: a different sequence is a different tree, and a timing budget pinned
 * against a tree that quietly changed is not pinned against anything.
 */
export function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A vocabulary wide enough that titles are mostly distinct.
 *
 * That is the realistic case and the one the criterion's own measurements were
 * taken over ("distinct titles"). A vault of near-identical titles is a
 * different fixture with a different point — the number of *pairs* above the
 * threshold is quadratic there no matter what algorithm finds them, so it
 * measures the size of the answer rather than the cost of finding it. Z1's
 * fixture is that one; this is not.
 */
const STEMS = [
  "export", "import", "onboard", "checkout", "latency", "mobile", "notify", "search",
  "billing", "dashboard", "offline", "sync", "tutorial", "invite", "referral",
  "permission", "archive", "filter", "report", "upload",
];

const VOCABULARY: string[] = [];
for (const stem of STEMS) for (let k = 0; k < 25; k++) VOCABULARY.push(`${stem}${k}`);

/** A deterministic three-word phrase. */
export function phraseFrom(rnd: () => number): string {
  const pick = (): string => VOCABULARY[Math.floor(rnd() * VOCABULARY.length)];
  return `${pick()} ${pick()} ${pick()}`;
}

export interface LargeTreeShape {
  opportunities: number;
  solutions: number;
  assumptionTests: number;
}

/**
 * Build a tree of the given shape under an already-initialised vault, wired the
 * way a real one is: opportunities under the outcome, solutions under
 * opportunities.
 *
 * The wiring matters to what is being measured. `checkInvariants` resolves
 * parents by scanning, and an unwired fixture would report every node as an
 * orphan — a tree that is cheap in a way no real vault is.
 */
export function buildLargeTree(vault: Vault, outcome: string, shape: LargeTreeShape, seed = 7): void {
  const rnd = seededRandom(seed);
  const opportunities: string[] = [];
  const solutions: string[] = [];

  for (let i = 0; i < shape.opportunities; i++) {
    const title = `Customers cannot ${phraseFrom(rnd)} o${i}`;
    opportunities.push(title);
    vault.createNode({ title, layer: "Opportunity", evidence: "observed", source: "INBOX:n.md", body: "b", tags: [], links: [] });
  }
  for (let i = 0; i < shape.solutions; i++) {
    const title = `Ship a ${phraseFrom(rnd)} s${i}`;
    solutions.push(title);
    vault.createNode({ title, layer: "Solution", evidence: "observed", body: "b", tags: [], links: [] });
  }
  for (let i = 0; i < shape.assumptionTests; i++) {
    vault.createNode({
      title: `Test whether ${phraseFrom(rnd)} t${i}`,
      layer: "AssumptionTest",
      evidence: "observed",
      body: "b",
      tags: [],
      links: [],
    });
  }

  for (const title of opportunities) vault.linkNodes(outcome, title);
  for (let i = 0; i < solutions.length; i++) vault.linkNodes(opportunities[i % opportunities.length], solutions[i]);
}
