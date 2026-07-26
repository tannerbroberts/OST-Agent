/**
 * The web search client: read-only GET against the Brave Search API over an
 * injected fetchFn. The key travels only in the request header — never in
 * results or error messages.
 */
import { describe, expect, test } from "vitest";
import { searchWeb, DEFAULT_SEARCH_RESULTS, MAX_SEARCH_RESULTS } from "../../src/web/search.js";
import type { WebFetchFn } from "../../src/web/reader.js";

const braveBody = JSON.stringify({
  web: {
    results: [
      { title: "A/B testing guide", url: "https://example.com/ab", description: "How to run experiments" },
      { title: "Retention loops", url: "https://blog.example.org/loops", description: "Acquisition tactics" },
    ],
  },
});

function fakeFetch(onCall: (url: string, init: { headers: Record<string, string> }) => void, status = 200, body = braveBody): WebFetchFn {
  return async (url, init) => {
    onCall(url, init as { headers: Record<string, string> });
    return {
      status,
      ok: status < 300,
      headers: { get: () => null },
      text: async () => body,
    };
  };
}

describe("searchWeb", () => {
  test("returns title/url/snippet/host per result and sends the key only as a header", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const results = await searchWeb("game acquisition strategy", {
      apiKey: "sk-test-123",
      fetchFn: fakeFetch((url, init) => {
        seenUrl = url;
        seenHeaders = init.headers;
      }),
    });
    expect(seenUrl).toContain("q=game+acquisition+strategy");
    expect(seenHeaders["X-Subscription-Token"]).toBe("sk-test-123");
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "A/B testing guide",
      url: "https://example.com/ab",
      snippet: "How to run experiments",
      host: "example.com",
    });
    expect(results[1].host).toBe("blog.example.org");
  });

  test("clamps count to MAX_SEARCH_RESULTS and defaults it", async () => {
    let seenUrl = "";
    await searchWeb("q", { apiKey: "k", count: 99, fetchFn: fakeFetch((u) => (seenUrl = u)) });
    expect(seenUrl).toContain(`count=${MAX_SEARCH_RESULTS}`);
    await searchWeb("q", { apiKey: "k", fetchFn: fakeFetch((u) => (seenUrl = u)) });
    expect(seenUrl).toContain(`count=${DEFAULT_SEARCH_RESULTS}`);
  });

  test("API failure surfaces the status but never the key", async () => {
    const err = await searchWeb("q", { apiKey: "sk-secret-xyz", fetchFn: fakeFetch(() => {}, 429, "slow down") }).catch(
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/429/);
    expect((err as Error).message).not.toContain("sk-secret-xyz");
  });
});
