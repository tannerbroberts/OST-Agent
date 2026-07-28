/**
 * The federated provider: many keyless sources, one result set. Over a long
 * run a source WILL be down, so partial failure is the normal path, not the
 * exception.
 */
import { describe, expect, test } from "vitest";
import { federatedProvider, AllSourcesFailedError, FEDERATED_USER_AGENT } from "../../src/web/federated.js";
import type { KeylessSource } from "../../src/web/sources.js";
import type { WebFetchFn } from "../../src/web/reader.js";

function source(name: string, host: string, titles: string[]): KeylessSource {
  return {
    name,
    url: () => `https://${host}/search`,
    parse: () => titles.map((t) => ({ title: t, url: `https://${host}/${t}`, snippet: "", host })),
  };
}

function okFetch(status = 200): WebFetchFn {
  return async () => ({ status, ok: status < 300, headers: { get: () => null }, text: async () => "{}" });
}

function statusByHost(map: Record<string, number>): WebFetchFn {
  return async (url) => {
    const status = map[new URL(url).hostname] ?? 200;
    return { status, ok: status < 300, headers: { get: () => null }, text: async () => "{}" };
  };
}

describe("federatedProvider", () => {
  test("merges sources round-robin and truncates to count", async () => {
    const p = federatedProvider([source("a", "a.com", ["a1", "a2"]), source("b", "b.com", ["b1", "b2"])]);
    const out = await p.search("q", 3, okFetch());
    expect(out.results.map((r) => r.title)).toEqual(["a1", "b1", "a2"]);
    expect(out.failures).toEqual([]);
  });

  test("returns what answered and names what did not", async () => {
    const p = federatedProvider([source("a", "a.com", ["a1"]), source("b", "b.com", ["b1"])]);
    const out = await p.search("q", 5, statusByHost({ "b.com": 500 }));
    expect(out.results.map((r) => r.title)).toEqual(["a1"]);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].source).toBe("b");
    expect(out.failures[0].reason).toMatch(/500/);
  });

  test("throws AllSourcesFailedError when every source fails", async () => {
    const p = federatedProvider([source("a", "a.com", ["a1"]), source("b", "b.com", ["b1"])]);
    await expect(p.search("q", 5, statusByHost({ "a.com": 500, "b.com": 503 }))).rejects.toBeInstanceOf(
      AllSourcesFailedError,
    );
  });

  test("dedupes identical URLs across sources", async () => {
    const dup = (name: string): KeylessSource => ({
      name,
      url: () => "https://x.com/search",
      parse: () => [{ title: name, url: "https://same.com/page", snippet: "", host: "same.com" }],
    });
    const out = await federatedProvider([dup("a"), dup("b")]).search("q", 5, okFetch());
    expect(out.results).toHaveLength(1);
  });

  test("a 429 puts that source on cooldown and skips it while cooling", async () => {
    let clock = 0;
    const p = federatedProvider([source("a", "a.com", ["a1"]), source("b", "b.com", ["b1"])], {
      now: () => clock,
      cooldownMs: 60_000,
    });

    const first = await p.search("q", 5, statusByHost({ "b.com": 429 }));
    expect(first.failures[0].reason).toMatch(/429/);

    // still cooling: b is skipped without a request, and reported as cooling
    let bRequested = false;
    const spy: WebFetchFn = async (url) => {
      if (new URL(url).hostname === "b.com") bRequested = true;
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => "{}" };
    };
    clock += 30_000;
    const second = await p.search("q", 5, spy);
    expect(bRequested).toBe(false);
    expect(second.failures[0].reason).toMatch(/cooling/i);

    // cooldown elapsed: b is tried again
    clock += 40_000;
    await p.search("q", 5, spy);
    expect(bRequested).toBe(true);
  });

  test("refuses a source whose URL fails the outbound guard", async () => {
    const bad: KeylessSource = { name: "bad", url: () => "http://localhost/search", parse: () => [] };
    const out = await federatedProvider([source("a", "a.com", ["a1"]), bad]).search("q", 5, okFetch());
    expect(out.results).toHaveLength(1);
    expect(out.failures[0].source).toBe("bad");
  });

  /**
   * Not in the plan, added because it is the likeliest way this feature fails in
   * production and no other test would catch it: Wikimedia answers 403 at the
   * edge to clients that send no descriptive User-Agent, and Node's fetch sends
   * none by default. A silent drop of this header would pass every test above
   * and then return zero Wikipedia results forever.
   */
  test("sends a descriptive User-Agent to every source", async () => {
    const seen: Record<string, string | undefined> = {};
    const spy: WebFetchFn = async (url, init) => {
      seen[new URL(url).hostname] = init.headers["user-agent"];
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => "{}" };
    };
    const p = federatedProvider([source("a", "a.com", ["a1"]), source("b", "b.com", ["b1"])]);
    await p.search("q", 5, spy);

    expect(Object.keys(seen).sort()).toEqual(["a.com", "b.com"]);
    expect(seen["a.com"]).toBe(FEDERATED_USER_AGENT);
    expect(seen["b.com"]).toBe(FEDERATED_USER_AGENT);
    // Descriptive, not a bare token: an identifiable name and a contact URL.
    expect(FEDERATED_USER_AGENT).toMatch(/ost-agent/);
    expect(FEDERATED_USER_AGENT).toMatch(/https?:\/\//);
  });
});
