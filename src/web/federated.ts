/**
 * The federated provider — several keyless sources behind one SearchProvider.
 *
 * Two decisions worth keeping:
 *
 * Partial failure is the normal path. Over a run measured in weeks some source
 * will be down, and an agent that gets three results and is TOLD it missed one
 * source can record an honest gap. Silently returning three would make the
 * coverage look complete when it is not.
 *
 * Merge is round-robin, not scored. There is no comparable relevance signal
 * between MediaWiki and Algolia, so a synthesised cross-source ranking would
 * be fiction presented as judgement.
 */
import { assertAllowedUrl, TIMEOUT_MS } from "./guard.js";
import type { WebFetchFn } from "./reader.js";
import type { SearchOutcome, SearchProvider, SearchResult } from "./search.js";
import type { KeylessSource } from "./sources.js";

/** Thrown when not one source answered — the caller should refund the lookup. */
export class AllSourcesFailedError extends Error {
  readonly failures: { source: string; reason: string }[];
  constructor(failures: { source: string; reason: string }[]) {
    super(`every search source failed: ${failures.map((f) => `${f.source} (${f.reason})`).join(", ")}`);
    this.name = "AllSourcesFailedError";
    this.failures = failures;
  }
}

export const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Wikimedia serves 403 at the edge to clients that send no descriptive
 * User-Agent, and Node sends none by default — so without this, Wikipedia
 * never works. Identifying the tool is also just the polite way to use
 * somebody's free API.
 */
export const FEDERATED_USER_AGENT = "ost-agent (+https://github.com/tannerbroberts/OST-Agent)";

export interface FederatedOptions {
  now?: () => number;
  cooldownMs?: number;
}

export function federatedProvider(sources: KeylessSource[], opts: FederatedOptions = {}): SearchProvider {
  const now = opts.now ?? (() => Date.now());
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  // Per-provider, not module-global: one instance per session, no shared state.
  const cooling = new Map<string, number>();

  async function one(src: KeylessSource, query: string, count: number, fetchFn: WebFetchFn): Promise<SearchResult[]> {
    const until = cooling.get(src.name);
    if (until !== undefined && now() < until) {
      throw new Error(`cooling down after a rate limit for another ${Math.ceil((until - now()) / 1000)}s`);
    }

    const url = assertAllowedUrl(src.url(query, count)); // federated sources are not exempt from the guard
    const res = await fetchFn(url.toString(), {
      method: "GET",
      headers: { accept: "application/json", "user-agent": FEDERATED_USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 429) {
      cooling.set(src.name, now() + cooldownMs);
      throw new Error("HTTP 429 (rate limited) — cooling this source down");
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    return src.parse(await res.text());
  }

  return {
    name: "federated",
    search: async (query, count, fetchFn) => {
      const fetcher = fetchFn ?? (globalThis.fetch as unknown as WebFetchFn);
      const settled = await Promise.all(
        sources.map(async (src) => {
          try {
            return { src, results: await one(src, query, count, fetcher) };
          } catch (err) {
            return { src, reason: err instanceof Error ? err.message : String(err) };
          }
        }),
      );

      const failures = settled
        .filter((s): s is { src: KeylessSource; reason: string } => "reason" in s)
        .map((s) => ({ source: s.src.name, reason: s.reason }));

      const answered = settled.filter((s): s is { src: KeylessSource; results: SearchResult[] } => "results" in s);
      if (answered.length === 0) throw new AllSourcesFailedError(failures);

      return { results: interleave(answered.map((a) => a.results), count), failures } satisfies SearchOutcome;
    },
  };
}

/** Round-robin across sources, deduped on URL, capped at `count`. */
function interleave(lists: SearchResult[][], count: number): SearchResult[] {
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < depth && out.length < count; i++) {
    for (const list of lists) {
      if (out.length >= count) break;
      const r = list[i];
      if (!r) continue;
      const key = r.url.replace(/\/+$/, "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}
