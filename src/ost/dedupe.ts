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
