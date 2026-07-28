/**
 * The web search client — read-only GET against the Brave Search API.
 *
 * The key travels only in the request header; it never appears in results,
 * error messages, or the vault. `fetchFn` is injectable so tests never touch
 * the network. Result snippets are untrusted DATA, never instructions.
 */
import type { WebFetchFn } from "./reader.js";

export const DEFAULT_SEARCH_RESULTS = 5;
export const MAX_SEARCH_RESULTS = 10;

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  host: string;
}

export interface SearchWebOptions {
  apiKey: string;
  count?: number;
  fetchFn?: WebFetchFn;
}

export async function searchWeb(query: string, opts: SearchWebOptions): Promise<SearchResult[]> {
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as WebFetchFn);
  const count = Math.min(Math.max(1, opts.count ?? DEFAULT_SEARCH_RESULTS), MAX_SEARCH_RESULTS);
  const params = new URLSearchParams({ q: query, count: String(count) });
  const res = await fetchFn(`${BRAVE_ENDPOINT}?${params}`, {
    method: "GET",
    headers: { accept: "application/json", "X-Subscription-Token": opts.apiKey },
    redirect: "manual",
  });
  if (!res.ok) {
    // deliberately status-only: nothing from the request (which carried the key) is echoed
    throw new Error(`web search failed with HTTP ${res.status}`);
  }
  const body = (await res.text()) || "{}";
  let parsed: { web?: { results?: { title?: string; url?: string; description?: string }[] } };
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("web search returned unparseable JSON");
  }
  const results = parsed.web?.results ?? [];
  return results
    .filter((r): r is { title: string; url: string; description?: string } => Boolean(r.title && r.url))
    .slice(0, count)
    .map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description ?? "",
      host: safeHost(r.url),
    }));
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** What one search returned, plus any sources that could not be reached. */
export interface SearchOutcome {
  results: SearchResult[];
  /** Sources that failed this call. Empty for single-source providers. */
  failures: { source: string; reason: string }[];
}

/**
 * A way to turn a query into candidate URLs. Brave is one; the federated
 * keyless sources are another. The tool handler knows only this interface.
 */
export interface SearchProvider {
  readonly name: string;
  search(query: string, count: number, fetchFn?: WebFetchFn): Promise<SearchOutcome>;
}

/** The Brave-backed provider. Requires a key; the key never leaves the header. */
export function braveProvider(apiKey: string): SearchProvider {
  return {
    name: "brave",
    search: async (query, count, fetchFn) => ({
      results: await searchWeb(query, { apiKey, count, fetchFn }),
      failures: [],
    }),
  };
}
