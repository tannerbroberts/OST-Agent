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
  /** `cooling` distinguishes "skipped, no request made" from "tried and failed". */
  failures: { source: string; reason: string; cooling: boolean }[];
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

/**
 * What ost_search_web answers when no provider resolved.
 *
 * MCP gives a server no way to call the host's tools, so delegation cannot be
 * hidden behind this tool — it has to be said to the agent, which is what this
 * is. Provenance is unaffected: however a URL is found, ost_read_web is what
 * fetches and records it.
 */
export function searchDelegationMessage(query: string): string {
  return (
    `Use your own web search tool to find candidate URLs for "${query}", then call ost_read_web ` +
    "on each one — that is what fetches the page and records provenance as WEB:<host>, so " +
    "traceability is identical either way. (This server has no search provider of its own, which " +
    "is the normal setup — nothing is broken and nothing needs installing.)"
  );
}
