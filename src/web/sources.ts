/**
 * Keyless search sources — free, officially documented JSON APIs that need no
 * key and no scraping.
 *
 * Each source is deliberately dumb: build a URL, parse a body, map onto
 * SearchResult. Fan-out, failure handling and cooldown all live in the
 * federated provider, so one broken API is one small file to fix.
 *
 * These are a fallback for hosts with no web search of their own. They are
 * narrower than a general web index and will not answer every question — the
 * honest failure is an empty result, not an invented one.
 */
import type { SearchResult } from "./search.js";

export interface KeylessSource {
  /** Stable identifier, used to attribute failures and cooldowns. */
  readonly name: string;
  url(query: string, count: number): string;
  /** Parse a response body. Throws if the body is not this API's shape. */
  parse(body: string): SearchResult[];
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/**
 * Search APIs return snippets with markup in them; results are read as text.
 *
 * Numeric entities are decoded generically rather than table-matched: the same
 * character arrives spelled several ways (`&#39;` and the zero-padded `&#039;`
 * both appear in MediaWiki output), and a table can only ever list the
 * spellings someone happened to hit.
 */
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;|&lt;|&gt;|&quot;|&nbsp;/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function parseJson(body: string, source: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${source} returned unparseable JSON`);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** English Wikipedia via the MediaWiki search API. */
export function wikipediaSource(): KeylessSource {
  const HOST = "en.wikipedia.org";
  return {
    name: "wikipedia",
    url: (query, count) => {
      // No `origin` parameter: it exists to drive CORS headers a browser would
      // enforce, does nothing for a server-side GET, and varies the edge-cache
      // key for no gain. The thing Wikimedia actually cares about is a
      // descriptive User-Agent, which the fetch layer sends.
      const p = new URLSearchParams({
        action: "query",
        list: "search",
        format: "json",
        srsearch: query,
        srlimit: String(count),
      });
      return `https://${HOST}/w/api.php?${p}`;
    },
    parse: (body) => {
      const data = parseJson(body, "wikipedia") as { query?: { search?: { title?: string; snippet?: string }[] } };
      const hits = data.query?.search ?? [];
      return hits
        .filter((h): h is { title: string; snippet?: string } => typeof h.title === "string" && h.title.length > 0)
        .map((h) => ({
          title: h.title,
          url: `https://${HOST}/wiki/${encodeURIComponent(h.title)}`,
          snippet: stripHtml(h.snippet ?? ""),
          host: HOST,
        }));
    },
  };
}

/** Hacker News via the public Algolia endpoint. */
export function hackerNewsSource(): KeylessSource {
  return {
    name: "hackernews",
    url: (query, count) => {
      // `tags=story` is load-bearing. Without it the search spans comments too,
      // and comment hits have `title: null` — so they pass through the API,
      // get dropped by the filter below, and the caller sees "no results"
      // rather than a failure. Asking for stories is asking for what we can use.
      const p = new URLSearchParams({ query, tags: "story", hitsPerPage: String(count) });
      return `https://hn.algolia.com/api/v1/search?${p}`;
    },
    parse: (body) => {
      const data = parseJson(body, "hackernews") as {
        hits?: { title?: string; url?: string | null; objectID?: string; story_text?: string }[];
      };
      const hits = data.hits ?? [];
      return hits
        .filter(
          (h): h is { title: string; url?: string | null; objectID?: string; story_text?: string } =>
            typeof h.title === "string" && h.title.length > 0,
        )
        .map((h) => {
          const url = h.url || `https://news.ycombinator.com/item?id=${h.objectID ?? ""}`;
          return { title: h.title, url, snippet: stripHtml(h.story_text ?? ""), host: hostOf(url) };
        });
    },
  };
}

/** Any Discourse forum's public search endpoint. */
export function discourseSource(host: string): KeylessSource {
  const clean = host
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  // Forums are commonly hosted on a subpath (example.com/forum), so `clean` is
  // not necessarily a hostname. Provenance is `WEB:<host>` and trust is looked
  // up by host, so derive a real one rather than storing "example.com/forum",
  // which would never match a trust entry.
  const hostname = hostOf(`https://${clean}`) || clean;
  return {
    name: `discourse:${clean}`,
    url: (query) => {
      // `/search.json` documents only `q` and `page` — there is no per_page, and
      // sending one would be noise. The caller caps the merged result set.
      const p = new URLSearchParams({ q: query });
      return `https://${clean}/search.json?${p}`;
    },
    parse: (body) => {
      const data = parseJson(body, `discourse:${clean}`) as {
        topics?: { id?: number; slug?: string; title?: string }[];
      };
      const topics = data.topics ?? [];
      return topics
        .filter(
          (t): t is { id: number; slug: string; title: string } =>
            typeof t.id === "number" && typeof t.slug === "string" && typeof t.title === "string",
        )
        .map((t) => ({
          title: t.title,
          url: `https://${clean}/t/${t.slug}/${t.id}`,
          snippet: "",
          host: hostname,
        }));
    },
  };
}
