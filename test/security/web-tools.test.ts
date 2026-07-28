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
import { defaultGenome } from "../../src/genome/load.js";
import { hostTrustPath } from "../../src/knowledge/web-trust.js";
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
  test("without a key, answers with the setup hint (and never a stack of vault errors)", async () => {
    await expect(tool(baseCtx(), "ost_search_web").run({ query: "q" })).rejects.toThrow(/BRAVE_SEARCH_API_KEY/);
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

describe("the exhaustion instruction is genome policy, not a constant", () => {
  test("the default genome answers with today's sentence — extraction changed nothing an operator can see", async () => {
    const ctx = baseCtx({ genome: defaultGenome(), web: { fetchFn: htmlFetch, budget: createLookupBudget(1) } });
    const read = tool(ctx, "ost_read_web");
    await read.run({ url: "https://example.com/a" });
    const refused = await read.run({ url: "https://example.com/b" });
    expect(refused).toMatch(/open question|annotate/i);
    expect(refused).not.toContain("ost_create_node");
  });

  test("onExhaustion record-unknown tells the session to file the darkness on the tree instead", async () => {
    const g = defaultGenome();
    const ctx = baseCtx({
      genome: { ...g, budgets: { ...g.budgets, onExhaustion: "record-unknown" } },
      web: { fetchFn: htmlFetch, budget: createLookupBudget(1) },
    });
    const read = tool(ctx, "ost_read_web");
    await read.run({ url: "https://example.com/a" });
    const refused = await read.run({ url: "https://example.com/b" });
    expect(refused).toMatch(/budget spent/i);
    expect(refused).toContain("ost_create_node");
    expect(refused).toContain("## Format");
  });
});

describe("the per-class cap bites at the spend site — the marker is what charges it", () => {
  test("a second lookup for a bounded unknown is refused while the shared pool still has room", async () => {
    const g = defaultGenome();
    const ctx = baseCtx({
      genome: { ...g, budgets: { ...g.budgets, sharedPool: 10, perClass: { bounded: 1 } } },
      web: { fetchFn: htmlFetch },
    });
    // A bounded unknown on the tree: the classifier reaches a class only through
    // a node, so a marker naming nothing real charges nothing in particular.
    ctx.vault.createNode({
      title: "How many users hit the export path",
      layer: "Unknown",
      tags: [],
      links: [],
      evidence: "assertion",
      body: "## Format\na count\n\n## Methodology\nquery the log\n\n## Rationale\nserves the outcome",
    });
    const read = tool(ctx, "ost_read_web");

    process.env.OST_UNKNOWN = "How many users hit the export path";
    const first = await read.run({ url: "https://example.com/a" });
    const second = await read.run({ url: "https://example.com/b" });

    expect(first).toContain("hello");
    expect(second).toMatch(/budget spent/i);

    // …and the shared pool is untouched by that class's exhaustion: an
    // unmarked lookup still goes through. This is the assertion that fails if
    // the class never reaches `take()` — with `take()` called blind, the
    // per-class cap is invisible and BOTH lookups above succeed.
    delete process.env.OST_UNKNOWN;
    expect(await read.run({ url: "https://example.com/c" })).toContain("hello");
  });
});
