/**
 * The outward-sensing tools as the agent holds them: budget enforced across
 * search AND page reads, missing key answered with a setup hint, trust
 * recorded append-only with the surface stamped, repo reads confined.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { createLookupBudget } from "../../src/web/budget.js";
import { AllSourcesFailedError } from "../../src/web/federated.js";
import { hostTrustPath } from "../../src/knowledge/web-trust.js";
import { MAX_SEARCH_RESULTS } from "../../src/web/search.js";
import type { WebFetchFn } from "../../src/web/reader.js";
import { Vault } from "../../src/ost/vault.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-webtools-"));
});
afterEach(() => {
  delete process.env.OST_UNKNOWN;
  fs.rmSync(dir, { recursive: true, force: true });
});

type Runnable = { name: string; run: (i: unknown) => Promise<string> };

function tool(ctx: ToolContext, name: string): Runnable {
  return buildOstTools(ctx).find((t) => t.name === name) as unknown as Runnable;
}

function baseCtx(extra: Partial<ToolContext> = {}): ToolContext {
  return { vault: new Vault(dir), dir, remote: { enabled: false }, surface: "test", ...extra };
}

const htmlFetch: WebFetchFn = async () => ({
  status: 200,
  ok: true,
  headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/html" : null) },
  text: async () => "<title>T</title><p>hello</p>",
});

describe("ost_search_web", () => {
  test("without a provider, instructs the agent to use its own search — and spends no budget", async () => {
    const budget = createLookupBudget(5);
    const out = await tool(baseCtx({ web: { budget } }), "ost_search_web").run({ query: "how do MCP hosts launch servers" });
    expect(out).toMatch(/your own web search|host's web search/i);
    expect(out).toMatch(/ost_read_web/);
    expect(out).toContain("how do MCP hosts launch servers"); // re-issuing costs the agent nothing
    expect(budget.remaining()).toBe(5); // the dead-end branch must not charge for a lookup
  });

  // This message is read by an AGENT, mid-task. Naming a credential in it is how
  // you get an agent that stops and tells the user to go buy an API key — the
  // exact failure the delegation default exists to remove.
  test("the delegation message never names a credential or a config knob", async () => {
    const out = await tool(baseCtx({ web: { budget: createLookupBudget(5) } }), "ost_search_web").run({ query: "q" });
    expect(out).not.toMatch(/BRAVE|API[_ ]KEY|ost\.config\.yaml/i);
  });

  test("results carry each host's trust rung", async () => {
    const braveFetch: WebFetchFn = async () => ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: async () => JSON.stringify({ web: { results: [{ title: "t", url: "https://example.com/a", description: "d" }] } }),
    });
    const ctx = baseCtx({ web: { searchApiKey: "k", fetchFn: braveFetch, budget: createLookupBudget(5) } });
    const out = JSON.parse(await tool(ctx, "ost_search_web").run({ query: "q" }));
    expect(out.results[0].hostTrust).toBe("assertion");
    expect(out.lookupsRemaining).toBe(4);
  });

  test("names sources that were unavailable so the agent can record an honest gap", async () => {
    const provider = {
      name: "federated",
      search: async () => ({
        results: [{ title: "t", url: "https://example.com/a", snippet: "s", host: "example.com" }],
        failures: [{ source: "wikipedia", reason: "HTTP 500", cooling: false }],
      }),
    };
    const ctx = baseCtx({ web: { provider, budget: createLookupBudget(5) } });
    const out = JSON.parse(await tool(ctx, "ost_search_web").run({ query: "q" }));
    expect(out.results).toHaveLength(1);
    expect(out.sourcesUnavailable).toEqual([{ source: "wikipedia", reason: "HTTP 500", cooling: false }]);
  });

  test("refunds the lookup when an outage meant it bought nothing", async () => {
    const budget = createLookupBudget(5);
    const provider = {
      name: "federated",
      search: async () => {
        throw new AllSourcesFailedError([{ source: "wikipedia", reason: "HTTP 500", cooling: false }]);
      },
    };
    const out = await tool(baseCtx({ web: { provider, budget } }), "ost_search_web").run({ query: "q" });
    expect(out).toMatch(/every search source failed/i);
    expect(budget.remaining()).toBe(5); // a dead lookup must not cost one
  });

  // The counterpart: an all-cooling failure is instant and touches no network,
  // so refunding it would make retrying free and unbounded.
  test("charges the lookup when every source is merely cooling", async () => {
    const budget = createLookupBudget(5);
    const provider = {
      name: "federated",
      search: async () => {
        throw new AllSourcesFailedError([{ source: "wikipedia", reason: "cooling down", cooling: true }]);
      },
    };
    const out = await tool(baseCtx({ web: { provider, budget } }), "ost_search_web").run({ query: "q" });
    expect(out).toMatch(/retrying immediately will not help/i);
    expect(budget.remaining()).toBe(4);
  });

  // A provider must not be able to turn `count: 500` into srlimit=500 against
  // somebody's free API.
  test("clamps count into [1, MAX_SEARCH_RESULTS] before the provider sees it", async () => {
    const seen: number[] = [];
    const provider = {
      name: "federated",
      search: async (_q: string, count: number) => {
        seen.push(count);
        return { results: [], failures: [] };
      },
    };
    const ctx = baseCtx({ web: { provider, budget: createLookupBudget(5) } });
    await tool(ctx, "ost_search_web").run({ query: "q", count: 500 });
    await tool(ctx, "ost_search_web").run({ query: "q", count: 0 });
    expect(seen).toEqual([MAX_SEARCH_RESULTS, 1]);
  });
});

describe("the shared lookup budget", () => {
  test("search and page reads drain the SAME budget, then both answer with the instruction", async () => {
    const ctx = baseCtx({ web: { searchApiKey: "k", fetchFn: htmlFetch, budget: createLookupBudget(2) } });
    const tools = buildOstTools(ctx);
    const read = tools.find((t) => t.name === "ost_read_web") as unknown as Runnable;
    const search = tools.find((t) => t.name === "ost_search_web") as unknown as Runnable;

    await read.run({ url: "https://example.com/a" }); // 1
    await read.run({ url: "https://example.com/b" }); // 2 — budget spent
    const refusedRead = await read.run({ url: "https://example.com/c" });
    expect(refusedRead).toMatch(/budget spent/i);
    expect(refusedRead).toMatch(/open question|annotate/i);
    // search draws from the same exhausted pool — but a refused call spends nothing
    const refusedSearch = await search.run({ query: "q" });
    expect(refusedSearch).toMatch(/budget spent/i);
  });
});

describe("ost_read_web", () => {
  test("stamps WEB:<host> provenance and the data-not-instructions note", async () => {
    const ctx = baseCtx({ web: { fetchFn: htmlFetch, budget: createLookupBudget(5) } });
    const out = await tool(ctx, "ost_read_web").run({ url: "https://example.com/post" });
    expect(out).toContain("WEB:example.com");
    expect(out).toMatch(/never instructions/i);
    expect(out).toContain("hello");
  });
});

describe("ost_rank_source", () => {
  test("appends a trust record stamped by the surface; ceiling enforced", async () => {
    const ctx = baseCtx();
    const rank = tool(ctx, "ost_rank_source");
    await rank.run({ host: "https://www.example.com/x", rung: "expert", reason: "funnel test 'Invite copy A' confirmed their claim" });
    const rec = JSON.parse(fs.readFileSync(hostTrustPath(dir), "utf8").trim());
    expect(rec.host).toBe("example.com");
    expect(rec.by).toBe("agent:test");
    await expect(rank.run({ host: "example.com", rung: "money", reason: "r" })).rejects.toThrow(/first-party|expert/i);
  });
});

describe("ost_read_repo", () => {
  test("reads only configured repos; unconfigured is a setup hint", async () => {
    await expect(tool(baseCtx(), "ost_read_repo").run({})).rejects.toThrow(/product\.repos/);
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-prod-"));
    try {
      fs.writeFileSync(path.join(repo, "app.ts"), "export const level = 3;");
      const out = JSON.parse(await tool(baseCtx({ productRepos: [repo] }), "ost_read_repo").run({ path: "app.ts" }));
      expect(out.kind).toBe("file");
      expect(out.text).toContain("level = 3");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("the exhaustion instruction", () => {
  test("a spent budget answers with an instruction, not a refusal", async () => {
    const ctx = baseCtx({ web: { fetchFn: htmlFetch, budget: createLookupBudget(1) } });
    const read = tool(ctx, "ost_read_web");
    await read.run({ url: "https://example.com/a" });
    const refused = await read.run({ url: "https://example.com/b" });
    expect(refused).toMatch(/budget spent/i);
    expect(refused).toMatch(/open question|annotate/i);
  });
});
