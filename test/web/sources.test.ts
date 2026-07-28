/**
 * Keyless source adapters: each turns one free, officially-documented API's
 * response into SearchResult[]. No key, no scraping.
 */
import { describe, expect, test } from "vitest";
import { wikipediaSource, hackerNewsSource, discourseSource, stripHtml } from "../../src/web/sources.js";

describe("stripHtml", () => {
  test("removes tags and decodes the entities search APIs emit", () => {
    expect(stripHtml('a <span class="searchmatch">b</span> c')).toBe("a b c");
    expect(stripHtml("x &amp; y &quot;z&quot;")).toBe('x & y "z"');
  });
});

describe("wikipediaSource", () => {
  const src = wikipediaSource();

  test("builds a keyless MediaWiki search URL", () => {
    const u = new URL(src.url("opportunity solution tree", 3));
    expect(u.hostname).toBe("en.wikipedia.org");
    expect(u.searchParams.get("action")).toBe("query");
    expect(u.searchParams.get("list")).toBe("search");
    expect(u.searchParams.get("srsearch")).toBe("opportunity solution tree");
    expect(u.searchParams.get("srlimit")).toBe("3");
    expect(u.searchParams.get("format")).toBe("json");
    // `origin` drives CORS headers only a browser enforces; server-side it does
    // nothing but vary the edge-cache key.
    expect(u.searchParams.has("origin")).toBe(false);
  });

  test("maps hits to results with article URLs and stripped snippets", () => {
    const body = JSON.stringify({
      query: { search: [{ title: "Product discovery", snippet: 'a <span class="searchmatch">tree</span>' }] },
    });
    const [r] = src.parse(body);
    expect(r.title).toBe("Product discovery");
    expect(r.url).toBe("https://en.wikipedia.org/wiki/Product%20discovery");
    expect(r.snippet).toBe("a tree");
    expect(r.host).toBe("en.wikipedia.org");
  });

  test("returns [] when the payload has no results", () => {
    expect(src.parse(JSON.stringify({ query: { search: [] } }))).toEqual([]);
    expect(src.parse("{}")).toEqual([]);
  });

  test("throws on unparseable JSON so the caller can record a source failure", () => {
    expect(() => src.parse("<html>nope")).toThrow(/wikipedia/i);
  });
});

describe("hackerNewsSource", () => {
  const src = hackerNewsSource();

  test("builds a keyless Algolia URL", () => {
    const u = new URL(src.url("mcp hosts", 5));
    expect(u.hostname).toBe("hn.algolia.com");
    expect(u.searchParams.get("query")).toBe("mcp hosts");
    expect(u.searchParams.get("hitsPerPage")).toBe("5");
    // Without tags=story the search spans comments, whose hits have title:null.
    // They would be dropped by the parser, so a comment-heavy query would come
    // back empty and look like "nothing found" rather than "asked wrongly".
    expect(u.searchParams.get("tags")).toBe("story");
  });

  test("prefers the story URL and falls back to the HN item page", () => {
    const body = JSON.stringify({
      hits: [
        { title: "A", url: "https://example.com/a", objectID: "1", story_text: "sn" },
        { title: "B", url: null, objectID: "2" },
      ],
    });
    const rs = src.parse(body);
    expect(rs[0].url).toBe("https://example.com/a");
    expect(rs[0].host).toBe("example.com");
    expect(rs[1].url).toBe("https://news.ycombinator.com/item?id=2");
    expect(rs[1].host).toBe("news.ycombinator.com");
  });

  test("skips hits with no title", () => {
    expect(src.parse(JSON.stringify({ hits: [{ url: "https://x.com", objectID: "9" }] }))).toEqual([]);
  });
});

describe("discourseSource", () => {
  const src = discourseSource("forum.obsidian.md");

  test("builds a keyless search URL on the configured host", () => {
    const u = new URL(src.url("graph view", 5));
    expect(u.hostname).toBe("forum.obsidian.md");
    expect(u.pathname).toBe("/search.json");
    expect(u.searchParams.get("q")).toBe("graph view");
  });

  test("maps topics to canonical topic URLs", () => {
    const body = JSON.stringify({ topics: [{ id: 116494, slug: "stable-graph", title: "Stable graph" }] });
    const [r] = src.parse(body);
    expect(r.url).toBe("https://forum.obsidian.md/t/stable-graph/116494");
    expect(r.title).toBe("Stable graph");
    expect(r.host).toBe("forum.obsidian.md");
  });

  test("names the host in its source name so failures are attributable", () => {
    expect(src.name).toBe("discourse:forum.obsidian.md");
  });

  // Subpath-hosted forums are common. Provenance is WEB:<host> and trust is
  // looked up by host, so "example.com/forum" as a host would match nothing.
  test("derives a real hostname when the forum lives on a subpath", () => {
    const sub = discourseSource("example.com/forum");
    expect(new URL(sub.url("q", 5)).pathname).toBe("/forum/search.json");
    const [r] = sub.parse(JSON.stringify({ topics: [{ id: 7, slug: "s", title: "T" }] }));
    expect(r.host).toBe("example.com");
    expect(r.url).toBe("https://example.com/forum/t/s/7");
  });
});
