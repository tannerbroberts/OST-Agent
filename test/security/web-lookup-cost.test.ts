/**
 * A web lookup does not cost a full vault parse. (V1 readiness, Z5.)
 *
 * This was true by accident and recorded as false. The per-class lookup budget
 * needed to know which class to charge, and computing that scanned the vault on
 * every single lookup; the gene's default was an empty map, so nothing was ever
 * charged and the scan bought nothing. Deleting the genome deleted the scan with
 * it (`src/web/budget.ts:16-19`), and the criterion stayed on *not met* pointing
 * at a `spendClass` that no longer exists anywhere in `src/`.
 *
 * So the property now has a test instead of a memory. The verdict is
 * size-independent — a three-node vault proves it as well as a five-thousand-node
 * one, and a large fixture would only make this slow.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { createLookupBudget } from "../../src/web/budget.js";
import { Vault } from "../../src/ost/vault.js";
import type { WebFetchFn } from "../../src/web/reader.js";

let dir: string;
let vault: Vault;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-z5-"));
  vault = new Vault(dir);
  // Three nodes, so "zero parses" is a claim about the code path and not about
  // an empty directory being cheap to walk.
  vault.createNode({ title: "Outcome", layer: "Outcome", body: "the metric\n", tags: [], links: [], evidence: "assertion" });
  vault.createNode({ title: "Opp", layer: "Opportunity", body: "a friction\n", tags: [], links: [], evidence: "assertion" });
  vault.createNode({ title: "Sol", layer: "Solution", body: "an idea\n", tags: [], links: [], evidence: "assertion" });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OST_UNKNOWN;
  fs.rmSync(dir, { recursive: true, force: true });
});

type Runnable = { name: string; run: (i: unknown) => Promise<string> };

function tool(ctx: ToolContext, name: string): Runnable {
  return buildOstTools(ctx).find((t) => t.name === name) as unknown as Runnable;
}

const braveFetch: WebFetchFn = async () => ({
  status: 200,
  ok: true,
  headers: { get: () => null },
  text: async () => JSON.stringify({ web: { results: [{ title: "t", url: "https://example.com/a", description: "d" }] } }),
});

describe("Z5 — a web lookup does not cost a vault parse", () => {
  // Three assertions of "not called" are worth nothing if the spy could never
  // observe a call. This is the control: same spy, same vault instance, a tool
  // that genuinely parses.
  //
  // The spy is on `readTreeCensus` rather than on `readTree`, because that is the
  // walk — `readTree` and `readQuarantined` are each one line delegating to it.
  // Spying on the wrapper measured only the callers that happened to use the
  // wrapper, so "zero parses" would have been satisfied by a caller that reached
  // the census directly and parsed the whole vault.
  test("the spy observes a parse when one actually happens", async () => {
    const spy = vi.spyOn(Vault.prototype, "readTreeCensus");
    const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test" };
    await tool(ctx, "ost_read_tree").run({});
    expect(spy).toHaveBeenCalled();
  });

  test("ost_search_web against a provider parses the tree zero times", async () => {
    process.env.OST_UNKNOWN = "Unknown what we cannot see";
    const spy = vi.spyOn(Vault.prototype, "readTreeCensus");
    const ctx: ToolContext = {
      vault,
      dir,
      remote: { enabled: false },
      surface: "test",
      web: { searchApiKey: "k", fetchFn: braveFetch, budget: createLookupBudget(5) },
    };
    await tool(ctx, "ost_search_web").run({ query: "how do MCP hosts launch servers" });
    expect(spy).not.toHaveBeenCalled();
  });

  // The default path — no provider configured — is the one most sessions take,
  // so a parse reintroduced there would be the expensive one to miss.
  test("the no-provider delegation path parses the tree zero times", async () => {
    const spy = vi.spyOn(Vault.prototype, "readTreeCensus");
    const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test", web: { budget: createLookupBudget(5) } };
    await tool(ctx, "ost_search_web").run({ query: "q" });
    expect(spy).not.toHaveBeenCalled();
  });

  test("ost_read_web parses the tree zero times", async () => {
    const htmlFetch: WebFetchFn = async () => ({
      status: 200,
      ok: true,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/html" : null) },
      text: async () => "<title>T</title><p>hello</p>",
    });
    const spy = vi.spyOn(Vault.prototype, "readTreeCensus");
    const ctx: ToolContext = {
      vault,
      dir,
      remote: { enabled: false },
      surface: "test",
      web: { fetchFn: htmlFetch, budget: createLookupBudget(5) },
    };
    await tool(ctx, "ost_read_web").run({ url: "https://example.com/post" });
    expect(spy).not.toHaveBeenCalled();
  });
});
