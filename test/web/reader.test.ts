/**
 * The bounded page reader: GET-only over an injected fetchFn, guard re-checked
 * on every redirect hop, HTML reduced to text, output capped and truncation
 * made visible. Tests never touch the network.
 */
import { describe, expect, test } from "vitest";
import { readWebPage, htmlToText, type WebFetchFn } from "../../src/web/reader.js";

function fakeFetch(routes: Record<string, { status?: number; headers?: Record<string, string>; body?: string }>): WebFetchFn {
  return async (url) => {
    const r = routes[url];
    if (!r) throw new Error(`unexpected fetch of ${url}`);
    const headers = new Map(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      status: r.status ?? 200,
      ok: (r.status ?? 200) < 300,
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
      text: async () => r.body ?? "",
    };
  };
}

describe("htmlToText", () => {
  test("strips tags, drops script/style, decodes entities, keeps block breaks", () => {
    const html = `<html><head><title>My Page</title><style>p{color:red}</style></head>
      <body><script>alert("evil")</script><h1>Heading</h1><p>One &amp; two &lt;three&gt;</p><li>item</li></body></html>`;
    const { title, text } = htmlToText(html);
    expect(title).toBe("My Page");
    expect(text).toContain("Heading");
    expect(text).toContain("One & two <three>");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("<p>");
  });
});

describe("readWebPage", () => {
  test("reads a page and reports host, title, and text", async () => {
    const fetchFn = fakeFetch({
      "https://example.com/guide": {
        headers: { "content-type": "text/html" },
        body: "<title>Guide</title><p>Retention beats acquisition.</p>",
      },
    });
    const page = await readWebPage("https://example.com/guide", { fetchFn });
    expect(page.host).toBe("example.com");
    expect(page.title).toBe("Guide");
    expect(page.text).toContain("Retention beats acquisition.");
    expect(page.truncated).toBe(false);
  });

  test("follows redirects, re-validating each hop, and stops at the cap", async () => {
    const fetchFn = fakeFetch({
      "https://a.com/": { status: 301, headers: { location: "https://b.com/x" } },
      "https://b.com/x": { headers: { "content-type": "text/plain" }, body: "landed" },
    });
    const page = await readWebPage("https://a.com/", { fetchFn });
    expect(page.text).toBe("landed");
    expect(page.host).toBe("b.com");
  });

  test("refuses a redirect into a private address", async () => {
    const fetchFn = fakeFetch({
      "https://a.com/": { status: 302, headers: { location: "http://169.254.169.254/latest" } },
    });
    await expect(readWebPage("https://a.com/", { fetchFn })).rejects.toThrow();
  });

  test("refuses more than MAX_REDIRECTS hops", async () => {
    const fetchFn = fakeFetch({
      "https://a.com/": { status: 301, headers: { location: "https://a.com/1" } },
      "https://a.com/1": { status: 301, headers: { location: "https://a.com/2" } },
      "https://a.com/2": { status: 301, headers: { location: "https://a.com/3" } },
      "https://a.com/3": { status: 301, headers: { location: "https://a.com/4" } },
    });
    await expect(readWebPage("https://a.com/", { fetchFn })).rejects.toThrow(/redirect/i);
  });

  test("refuses a private URL outright without fetching", async () => {
    const fetchFn: WebFetchFn = async () => {
      throw new Error("must not be called");
    };
    await expect(readWebPage("http://localhost:8080/", { fetchFn })).rejects.toThrow(/private|loopback|local/i);
  });

  test("surfaces HTTP errors with the status, and no credential material", async () => {
    const fetchFn = fakeFetch({ "https://example.com/gone": { status: 404, body: "nope" } });
    await expect(readWebPage("https://example.com/gone", { fetchFn })).rejects.toThrow(/404/);
  });

  test("caps the text and marks truncation", async () => {
    const fetchFn = fakeFetch({
      "https://example.com/big": { headers: { "content-type": "text/plain" }, body: "x".repeat(50_000) },
    });
    const page = await readWebPage("https://example.com/big", { fetchFn, maxChars: 1000 });
    expect(page.text.length).toBe(1000);
    expect(page.truncated).toBe(true);
  });
});
