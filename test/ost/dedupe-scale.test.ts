/**
 * Z3 — the near-duplicate scan is no longer quadratic, and gives the same answer.
 *
 * `findNearDuplicateIssues` ran on every `computeNextWork` and was measured at
 * 98 / 374 / 1,513 / 6,078 / 24,121 ms for 500 / 1k / 2k / 4k / 8k distinct
 * titles — 4× per doubling, because `similarity` re-tokenized both titles and
 * built two fresh Sets on each of ~n²/2 comparisons. It is now an inverted index
 * over a prefix of each title's rarest tokens.
 *
 * **Two things have to be true, and one of them is not about speed.** An
 * "optimization" that stopped reporting some duplicates would be a hygiene gate
 * going quietly blind, which is strictly worse than the slowness. So this file
 * carries the pre-Z3 implementation verbatim as a REFERENCE and asserts the two
 * agree element-for-element, in order, before it asserts anything about time.
 *
 * **Why the speed assertion is a ratio against that reference rather than a bare
 * millisecond bound.** A wall-clock number is a property of the machine; on a
 * fast one, a regression all the way back to quadratic can still come in under
 * any bound loose enough not to be flaky. Running both algorithms over the same
 * fixture in the same process cancels the machine out. The absolute budget the
 * criterion names is pinned separately, at the tool surface, in
 * `test/mcp/wall-clock-budget.test.ts`.
 */
import { describe, expect, test } from "vitest";
import { findNearDuplicateIssues } from "../../src/ost/dedupe.js";
import { seededRandom } from "./fixture-vault.js";

/* ------------------------------------------------------------------------- *
 * The pre-Z3 algorithm, copied unchanged from `src/ost/dedupe.ts` as it stood
 * before the rewrite. It is the specification: whatever it reports is what the
 * indexed scan must report. Kept here rather than imported so that "the old
 * behaviour" cannot be edited into agreement with a new bug.
 * ------------------------------------------------------------------------- */

const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "and", "or", "i", "we", "my", "our", "it",
  "is", "are", "be", "for", "in", "on", "want", "need", "with", "that", "this",
]);

function referenceTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0 && !STOPWORDS.has(t)),
  );
}

function referenceSimilarity(a: string, b: string): number {
  const ta = referenceTokens(a);
  const tb = referenceTokens(b);
  if (ta.size === 0 || tb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return inter / union;
}

function referenceScan(
  nodes: readonly { title: string; layer: string }[],
  threshold = 0.7,
): { title: string; issue: string }[] {
  const byLayer = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.layer === "Outcome") continue;
    const list = byLayer.get(n.layer) ?? [];
    list.push(n.title);
    byLayer.set(n.layer, list);
  }
  const issues: { title: string; issue: string }[] = [];
  for (const titles of byLayer.values()) {
    const sorted = [...titles].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const score = referenceSimilarity(sorted[i], sorted[j]);
        if (score >= threshold) {
          issues.push({ title: sorted[j], issue: `possible duplicate of "${sorted[i]}" (similarity ${score.toFixed(2)})` });
        }
      }
    }
  }
  return issues;
}

/* ------------------------------------------------------------------------- */

const LAYERS = ["Opportunity", "Solution", "AssumptionTest"];

/**
 * A tree that is DENSE in duplicates: three words drawn from a twelve-word pool,
 * so a large fraction of pairs clear 0.7 and the equivalence comparison has
 * thousands of elements to disagree on.
 *
 * It deliberately also contains the degenerate shapes the fast path has to
 * special-case — titles made entirely of stopwords (no significant tokens, so
 * the score falls back to string equality), titles that are only punctuation,
 * and the same words spread across different layers, which must never be
 * compared with each other.
 */
function denseFixture(n: number, seed: number): { title: string; layer: string }[] {
  const rnd = seededRandom(seed);
  const pool = ["export", "button", "find", "users", "cannot", "screen", "slow", "login", "save", "file", "share", "sync"];
  const nodes: { title: string; layer: string }[] = [
    { title: "Retention", layer: "Outcome" },
    { title: "the a of", layer: "Opportunity" },
    { title: "The  a   OF", layer: "Opportunity" }, // same normalized string, no tokens
    { title: "!!! ???", layer: "Opportunity" },
    { title: "the a of", layer: "Solution" }, // same words, another layer — never compared
  ];
  for (let i = 0; i < n; i++) {
    const w = [0, 1, 2].map(() => pool[Math.floor(rnd() * pool.length)]);
    nodes.push({ title: `${w[0]} ${w[1]} ${w[2]}`, layer: LAYERS[i % LAYERS.length] });
  }
  return nodes;
}

/**
 * A tree of mostly-DISTINCT titles — the realistic shape, and the one the
 * criterion's measurements were taken over. The answer here is small, so the
 * time is the cost of the search rather than the cost of the answer.
 *
 * One title in every hundred is a deliberate reword of the one before it, which
 * is what makes the result non-empty. Without those, `toEqual` would be
 * comparing two empty arrays and the ratio test would be timing two searches
 * that never found anything — a fixture on which deleting the whole detector
 * passes.
 */
function sparseFixture(n: number, seed: number): { title: string; layer: string }[] {
  const rnd = seededRandom(seed);
  const stems = ["export", "import", "onboard", "checkout", "latency", "mobile", "notify", "search", "billing", "dashboard"];
  const vocab: string[] = [];
  for (const s of stems) for (let k = 0; k < 60; k++) vocab.push(`${s}${k}`);
  const nodes: { title: string; layer: string }[] = [];
  let previous: string[] = [];
  for (let i = 0; i < n; i++) {
    // Eight significant tokens per title, so reusing all four vocabulary words
    // and changing only the trailing serial scores 7/9 ≈ 0.78 — over the 0.7
    // threshold, and over it by a margin that does not depend on the seed.
    const w = i > 0 && i % 100 === 0 ? previous : [0, 1, 2, 3].map(() => vocab[Math.floor(rnd() * vocab.length)]);
    previous = w;
    nodes.push({ title: `Customers cannot ${w[0]} the ${w[1]} ${w[2]} without ${w[3]} n${i}`, layer: "Opportunity" });
  }
  return nodes;
}

describe("the indexed scan reports exactly what the all-pairs scan reported", () => {
  for (const threshold of [0.4, 0.6, 0.7, 0.9]) {
    test(`identical issue list, in order, at threshold ${threshold}`, () => {
      const nodes = denseFixture(400, 20260730 + Math.round(threshold * 100));
      const expected = referenceScan(nodes, threshold);

      // Non-vacuity, stated as an assertion rather than as a hope: two empty
      // arrays are deep-equal, so a comparison over a fixture with no duplicates
      // would pass no matter what the new code did.
      expect(expected.length).toBeGreaterThan(50);

      expect(findNearDuplicateIssues(nodes, threshold)).toEqual(expected);
    });
  }

  test("agrees on the sparse fixture too, where nearly every pair is a rejection", () => {
    const nodes = sparseFixture(1500, 99);
    const expected = referenceScan(nodes);
    // The interesting half of this one is the rejections; the fixture still
    // carries duplicates so the comparison is not vacuous in either direction.
    expect(expected.length).toBeGreaterThan(0);
    expect(findNearDuplicateIssues(nodes)).toEqual(expected);
  });

  /**
   * The control for every `toEqual` above: prove that the comparison can fail.
   *
   * This repo has shipped green tests that asserted nothing three separate
   * times. Here the risk is specific — `toEqual` over two lists produced by two
   * implementations of the same idea is exactly the assertion that goes quiet if
   * the fixture stops containing anything interesting.
   */
  test("the equivalence assertion is discriminating — it fails when the answers differ", () => {
    const nodes = denseFixture(400, 5);
    const strict = findNearDuplicateIssues(nodes, 0.7);
    const loose = referenceScan(nodes, 0.6);

    expect(strict.length).toBeGreaterThan(0);
    expect(loose.length).toBeGreaterThan(strict.length);
    expect(strict).not.toEqual(loose);

    // And the direction that matters most: dropping a single issue is visible.
    expect(strict.slice(0, -1)).not.toEqual(strict);
  });
});

describe("the scan is no longer quadratic", () => {
  /**
   * Both algorithms, same fixture, same process, same millisecond clock.
   *
   * At 2,000 distinct titles the reference takes ~2,200 ms and the indexed scan
   * ~10 ms — a factor of ~200. The bar is 20×, an order of magnitude of slack,
   * because the number that has to survive CI is a ratio between two things that
   * slow down together. Nothing short of a real algorithmic regression can cross
   * it: keeping the index but restoring the per-comparison re-tokenization would
   * land around 5×, and removing the index entirely returns to 1×.
   */
  test("beats the all-pairs reference by more than an order of magnitude at 2,000 titles", () => {
    const nodes = sparseFixture(2000, 4242);

    const startReference = Date.now();
    const expected = referenceScan(nodes);
    const referenceMs = Date.now() - startReference;

    const startIndexed = Date.now();
    const actual = findNearDuplicateIssues(nodes);
    const indexedMs = Date.now() - startIndexed;

    // Same answer, or the speed means nothing.
    expect(actual).toEqual(expected);
    // The reference must actually be slow here, or the ratio is measuring noise.
    expect(referenceMs).toBeGreaterThan(200);
    expect(Math.max(indexedMs, 1) * 20).toBeLessThan(referenceMs);
  });

  /**
   * The advantage holds as the tree grows — it is not a fixed head start that
   * erodes.
   *
   * **The boundary, stated because it is real and a looser test would hide it.**
   * Prefix filtering is not an asymptotic cure. With a fixed vocabulary the
   * number of titles sharing a rare token grows with n, so the candidate set
   * still grows superlinearly; what the index buys is a constant of roughly two
   * hundred. A naïve "4× the input must cost far less than 16× the time" check
   * therefore proves nothing — measured, the indexed scan's own ratio over a 4×
   * fixture is ~7–13, and an all-pairs scan that merely stopped re-tokenizing
   * comes in at ~16 and would pass any bound loose enough to be stable. (That
   * exact mutation was run: it passes a 40× bound and fails the ratio test
   * above.) So the shape assertion is made where it can be measured — the same
   * speedup at two sizes, four times apart.
   *
   * A regression that reintroduced all-pairs comparison would fail this at both
   * sizes; one whose cost grew back into the reference's curve would fail it at
   * the larger one first.
   */
  test("the speedup does not erode between 500 and 2,000 titles", () => {
    for (const n of [500, 2000]) {
      const nodes = sparseFixture(n, 11);

      const startReference = Date.now();
      const expected = referenceScan(nodes);
      const referenceMs = Date.now() - startReference;

      const startIndexed = Date.now();
      const actual = findNearDuplicateIssues(nodes);
      const indexedMs = Date.now() - startIndexed;

      expect(actual, `answers differ at n=${n}`).toEqual(expected);
      expect(referenceMs, `reference too fast at n=${n} to measure against`).toBeGreaterThan(30);
      expect(Math.max(indexedMs, 1) * 20, `speedup eroded at n=${n}`).toBeLessThan(referenceMs);
    }
  });
});
