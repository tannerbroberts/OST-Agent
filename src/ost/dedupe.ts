/**
 * Lightweight near-duplicate detection for node titles.
 *
 * Used by opportunity mapping so the agent links to an existing opportunity
 * instead of creating a slightly-reworded duplicate. The *measure* is
 * deliberately simple (normalized token Jaccard) — tune the threshold with real
 * data. What is not simple is how the pairs are found, and that is Z3.
 *
 * **Why the candidate search is indexed rather than all-pairs.** This pass ran
 * on every `computeNextWork`, comparing every title against every other and
 * re-tokenizing both sides of each comparison: measured at 98 / 374 / 1,513 /
 * 6,078 / 24,121 ms for 500 / 1k / 2k / 4k / 8k distinct titles — a clean 4× per
 * doubling, which is what a 10,000-node vault turns into a minute of wall clock.
 * Two things fixed it, and only the second one changes the complexity class:
 *
 *   1. Tokenize once per title, not twice per comparison. That is a constant
 *      factor, and on its own it buys maybe 5×.
 *   2. Only compare pairs that can possibly clear the threshold, found through
 *      an inverted index over a *prefix* of each title's tokens (below). That
 *      takes the pair count from n²/2 down to the pairs sharing a rare word:
 *      measured ~200× fewer at 2,000 titles.
 *
 * **What that does not buy, said plainly.** It is a very large constant, not an
 * asymptotic cure. Titles are drawn from a finite vocabulary, so the number
 * sharing any given token still grows with the tree and the candidate set with
 * it. On a vault of genuinely near-identical titles the *answer* is quadratic
 * and no search can shorten it — which is why the other half of holding this
 * bounded is that `detectHygiene` never materializes the whole answer (Z2).
 *
 * **The answer is identical, not approximate.** The prefix filter is exact for
 * Jaccard, and `test/ost/dedupe-scale.test.ts` pins that by running the old
 * all-pairs algorithm beside this one over randomized fixtures and asserting the
 * two issue lists are deep-equal, element for element and in order. An
 * "optimization" that silently stopped reporting a duplicate would be a hygiene
 * gate quietly going blind, which is worse than the slowness it replaced.
 *
 * The scan is a generator so the caller can bound what it materializes. At 500
 * near-identical titles the honest answer is 125,750 pairs; a caller that only
 * ever shows 25 of them should not have to build the other 125,725 objects to
 * find that out (Z2).
 */

import { countOperation } from "../telemetry/operation-budget.js";

const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "and", "or", "i", "we", "my", "our", "it",
  "is", "are", "be", "for", "in", "on", "want", "need", "with", "that", "this",
]);

/**
 * The significant tokens of a title.
 *
 * Exported because the whole point of the rewrite is that a title is tokenized
 * ONCE and the resulting set is reused across every comparison it takes part in.
 * A caller that has a set already must never go back through {@link similarity},
 * which would re-tokenize both sides.
 */
export function tokensOf(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0 && !STOPWORDS.has(t)),
  );
}

/**
 * Jaccard over two ALREADY-tokenized titles, with the raw strings kept only for
 * the degenerate case.
 *
 * A title made entirely of stopwords and punctuation has no significant tokens,
 * so Jaccard is 0/0. That case falls back to exact (trimmed, lowercased) string
 * equality — which is why the raw strings are still parameters. Note that one
 * side being empty forces the other to be too whenever the fallback could fire:
 * tokenization lowercases, so two strings equal after `trim().toLowerCase()`
 * produce the same token set. A mixed pair therefore always scores 0.
 *
 * This is the one place a pair of titles is ever scored, which is why the
 * `titleComparison` counter lives here rather than at the call sites: the whole
 * point of the indexed scan is that it computes far fewer of these than the
 * all-pairs version did, and a counter that missed a scoring path would report
 * the saving rather than the work. See `src/telemetry/operation-budget.ts`.
 */
function jaccard(ta: Set<string>, tb: Set<string>, a: string, b: string): number {
  countOperation("titleComparison");
  if (ta.size === 0 || tb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  // Iterate the smaller set. Same answer, half the lookups on a lopsided pair.
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let inter = 0;
  for (const t of small) if (large.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Jaccard similarity of two titles' significant token sets, in [0, 1]. */
export function similarity(a: string, b: string): number {
  return jaccard(tokensOf(a), tokensOf(b), a, b);
}

export interface Match {
  title: string;
  score: number;
}

/** One flagged pair, in the shape `ost_next_work` reports it. */
export interface DuplicateIssue {
  title: string;
  issue: string;
}

/**
 * Flag near-duplicate titles that already coexist in the tree (same layer only).
 * Yields append-only hygiene issues — P5 annotates them and `ost_next_work`
 * reports them; nothing is ever merged automatically (that is a human decision).
 *
 * The direction is stable: within a layer, titles are sorted and the later one is
 * flagged as "possible duplicate of" the earlier, so re-runs annotate the same
 * node with the same string (idempotent). The threshold is higher than mapping's
 * link threshold to keep false positives low.
 *
 * A **generator**, so a caller can stop pulling. The number of pairs above the
 * threshold is quadratic in the size of a genuinely duplicated cluster and no
 * algorithm can make that list short — what a caller can do is decline to build
 * all of it, which is what `detectHygiene` does.
 *
 * `nodes` is the set the scan is taken over, and the caller decides what belongs
 * in it: `computeNextWork` hands this the *live* tree, with retired nodes already
 * withheld (Z4, `withoutRetiredNodes`).
 */
export function* scanNearDuplicates(
  nodes: readonly { title: string; layer: string }[],
  threshold = 0.7,
): Generator<DuplicateIssue> {
  const byLayer = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.layer === "Outcome") continue; // exactly one Outcome — nothing to dedupe
    const list = byLayer.get(n.layer) ?? [];
    list.push(n.title);
    byLayer.set(n.layer, list);
  }
  for (const titles of byLayer.values()) yield* scanLayer(titles, threshold);
}

/**
 * Materialize the whole scan. Kept because mapping and the tests want a list,
 * and because it is the definition the equivalence test compares against.
 *
 * Callers on a hot path should prefer {@link scanNearDuplicates} — this one has
 * no bound, and on a duplicated tree the bound is the point.
 */
export function findNearDuplicateIssues(
  nodes: readonly { title: string; layer: string }[],
  threshold = 0.7,
): DuplicateIssue[] {
  return [...scanNearDuplicates(nodes, threshold)];
}

/**
 * The scan for one layer.
 *
 * Emission order is `i` ascending then `j` ascending over the sorted titles —
 * byte-for-byte the order the all-pairs double loop produced, because the order
 * of this list is what a human sees and what an idempotent annotation sweep
 * walks. The index is only used to skip pairs, never to reorder the survivors.
 */
function* scanLayer(titles: readonly string[], threshold: number): Generator<DuplicateIssue> {
  const sorted = [...titles].sort();
  const n = sorted.length;
  if (n < 2) return;

  // Tokenized once. Everything below reads these; nothing re-tokenizes.
  const sets = sorted.map(tokensOf);
  const norms = sorted.map((t) => t.trim().toLowerCase());

  const flag = (i: number, j: number): DuplicateIssue | null => {
    const score = jaccard(sets[i], sets[j], sorted[i], sorted[j]);
    if (score < threshold) return null;
    // Named, not linked: this annotation lands in another node's `## Issues`, and
    // a wikilink there is a second backlink to a node that already has a parent.
    return { title: sorted[j], issue: `possible duplicate of "${sorted[i]}" (similarity ${score.toFixed(2)})` };
  };

  // The prefix filter below is derived from `J(A,B) >= t`, so it says nothing at
  // all when `t <= 0` — at a threshold of zero every pair qualifies, including
  // pairs sharing no token, and an index over shared tokens cannot find those.
  // Nothing in the product calls it that way; the fallback exists so that a
  // caller who does gets the honest all-pairs answer rather than a silently
  // shorter list.
  if (!(threshold > 0)) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const issue = flag(i, j);
        if (issue) yield issue;
      }
    }
    return;
  }

  // Global token order: rarest first, ties broken lexicographically so the order
  // is total and deterministic. Rarest-first is what makes the prefixes cheap —
  // the words every title shares ("users", "export") sort to the end and mostly
  // fall outside the prefix, so they never become a posting list everything is on.
  const df = new Map<string, number>();
  for (const s of sets) for (const t of s) df.set(t, (df.get(t) ?? 0) + 1);
  const byRarity = (x: string, y: string): number => (df.get(x)! - df.get(y)!) || (x < y ? -1 : x > y ? 1 : 0);

  /*
   * Prefix filter, and why it is exact rather than a heuristic.
   *
   * Write a = |A|, b = |B|, o = |A ∩ B|, and assume J(A,B) = o/(a+b-o) >= t.
   *   - o >= t(a+b)/(1+t)  (rearranged), and since a+b >= 2·min(a,b) and t <= 1,
   *     that gives o >= t·min(a,b).
   *   - J <= min(a,b)/max(a,b), so J >= t also forces min(a,b) >= t·max(a,b),
   *     hence o >= t·a AND o >= t·b — for BOTH sets, not just the smaller one.
   *     That is what lets each title compute its prefix from its own size alone,
   *     with no pairwise bookkeeping.
   *   - Prefix lemma: under a fixed total order on tokens, if o >= α then the
   *     (a-α+1)-prefix of A and the (b-α+1)-prefix of B must share a token.
   *     (Suppose not; let w be the later of the two prefixes' last tokens, say
   *     it is A's. Every common token at or before w is in both prefixes —
   *     contradiction — so all o common tokens lie strictly after A's prefix,
   *     of which there are only α-1.)
   *   - Taking α = ⌈t·s⌉ for each set's own size s gives prefix length
   *     s - ⌈t·s⌉ + 1, which is <= the lemma's requirement because α <= o.
   *
   * So: any pair that would clear the threshold shares a token in the two
   * prefixes. Indexing prefixes and probing prefixes therefore loses nothing.
   * At t = 0.7 a six-token title indexes two tokens instead of six.
   */
  const index = new Map<string, number[]>(); // token → positions, ascending by construction
  const prefixes: string[][] = new Array(n);
  for (let p = 0; p < n; p++) {
    const size = sets[p].size;
    if (size === 0) {
      prefixes[p] = []; // no tokens to index — handled by `emptyIndex` below
      continue;
    }
    // `t > 1` makes this zero or negative: nothing can clear the threshold, so
    // nothing is indexed and nothing probes.
    const len = Math.max(size - Math.ceil(threshold * size) + 1, 0);
    prefixes[p] = [...sets[p]].sort(byRarity).slice(0, len);
    for (const token of prefixes[p]) {
      const list = index.get(token);
      if (list) list.push(p);
      else index.set(token, [p]);
    }
  }

  // Titles with no significant tokens score by exact string equality, so their
  // candidates are the other titles with the same normalized string — a second,
  // tiny index rather than an exception the main loop has to remember.
  const emptyIndex = new Map<string, number[]>();
  for (let p = 0; p < n; p++) {
    if (sets[p].size > 0) continue;
    const list = emptyIndex.get(norms[p]);
    if (list) list.push(p);
    else emptyIndex.set(norms[p], [p]);
  }

  const candidates = new Set<number>();
  for (let i = 0; i < n; i++) {
    candidates.clear();
    const a = sets[i].size;
    // Probing prefix is the same prefix that was indexed — the lemma above needs
    // both sides trimmed, and using one array for both is what makes that true
    // by construction rather than by two expressions staying in agreement.
    const postings = a === 0 ? [emptyIndex.get(norms[i])] : prefixes[i].map((t) => index.get(t));
    for (const list of postings) {
      if (!list) continue;
      // Postings are ascending, so skip straight past everything already emitted
      // as some earlier `i`'s partner.
      for (let k = lowerBound(list, i + 1); k < list.length; k++) {
        const j = list[k];
        // Length filter: J <= min/max, so a pair whose sizes are too far apart
        // cannot clear the threshold no matter how much it overlaps. Cheaper
        // than a set intersection and provably drops only pairs that score
        // below the threshold.
        const b = sets[j].size;
        if (a > 0 && b > 0 && Math.min(a, b) < threshold * Math.max(a, b)) continue;
        candidates.add(j);
      }
    }
    if (candidates.size === 0) continue;
    for (const j of [...candidates].sort((x, y) => x - y)) {
      const issue = flag(i, j);
      if (issue) yield issue;
    }
  }
}

/** First index in the ascending array `list` whose value is >= `value`. */
function lowerBound(list: readonly number[], value: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Best match for `candidate` among `existing` above `threshold`, or null.
 * Default threshold is conservative to avoid merging distinct opportunities.
 *
 * The candidate is tokenized once here rather than once per `existing` entry —
 * the same constant factor the scan above removes, on the call mapping makes for
 * every evidence item it distills.
 */
export function bestMatch(candidate: string, existing: string[], threshold = 0.6): Match | null {
  const ca = tokensOf(candidate);
  let best: Match | null = null;
  for (const title of existing) {
    const score = jaccard(ca, tokensOf(title), candidate, title);
    if (score >= threshold && (best === null || score > best.score)) {
      best = { title, score };
    }
  }
  return best;
}
