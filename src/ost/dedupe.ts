/**
 * Lightweight near-duplicate detection for node titles.
 *
 * Used by opportunity mapping so the agent links to an existing opportunity
 * instead of creating a slightly-reworded duplicate. Deliberately simple
 * (normalized token Jaccard) — tune the threshold with real data.
 */

const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "and", "or", "i", "we", "my", "our", "it",
  "is", "are", "be", "for", "in", "on", "want", "need", "with", "that", "this",
]);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0 && !STOPWORDS.has(t)),
  );
}

/** Jaccard similarity of two titles' significant token sets, in [0, 1]. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return inter / union;
}

export interface Match {
  title: string;
  score: number;
}

/**
 * Flag near-duplicate titles that already coexist in the tree (same layer only).
 * Returns append-only hygiene issues — P5 annotates them and `ost_next_work`
 * reports them; nothing is ever merged automatically (that is a human decision).
 *
 * The direction is stable: within a layer, titles are sorted and the later one is
 * flagged as "possible duplicate of" the earlier, so re-runs annotate the same
 * node with the same string (idempotent). The threshold is higher than mapping's
 * link threshold to keep false positives low.
 */
export function findNearDuplicateIssues(
  nodes: readonly { title: string; layer: string }[],
  threshold = 0.7,
): { title: string; issue: string }[] {
  const byLayer = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.layer === "Outcome") continue; // exactly one Outcome — nothing to dedupe
    const list = byLayer.get(n.layer) ?? [];
    list.push(n.title);
    byLayer.set(n.layer, list);
  }
  const issues: { title: string; issue: string }[] = [];
  for (const titles of byLayer.values()) {
    const sorted = [...titles].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const score = similarity(sorted[i], sorted[j]);
        if (score >= threshold) {
          issues.push({ title: sorted[j], issue: `possible duplicate of [[${sorted[i]}]] (similarity ${score.toFixed(2)})` });
        }
      }
    }
  }
  return issues;
}

/**
 * Best match for `candidate` among `existing` above `threshold`, or null.
 * Default threshold is conservative to avoid merging distinct opportunities.
 */
export function bestMatch(candidate: string, existing: string[], threshold = 0.6): Match | null {
  let best: Match | null = null;
  for (const title of existing) {
    const score = similarity(candidate, title);
    if (score >= threshold && (best === null || score > best.score)) {
      best = { title, score };
    }
  }
  return best;
}
