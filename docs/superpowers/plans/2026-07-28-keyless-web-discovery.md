# Keyless Web Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make web discovery work with no API key — host delegation as the zero-config default, opt-in keyless federated sources as the fallback — and let the lookup budget refill so an agent can run for weeks.

**Architecture:** Invert `src/web/search.ts` behind a `SearchProvider` interface so Brave becomes one implementation among several. When no provider resolves, `ost_search_web` *returns* an instruction to use the host's own web search and feed URLs to `ost_read_web` (it currently throws). A `federatedProvider` fans out over keyless official APIs for hosts with no search of their own. `createLookupBudget` becomes a token bucket with an injectable clock: burst capacity unchanged, refilling at a configurable hourly rate.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Zod for config, Vitest. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-07-28-keyless-web-discovery-design.md`

## Global Constraints

- **Branch:** `spec/keyless-web-discovery` (already exists and is checked out).
- **ESM imports:** all relative imports use the `.js` extension, even from `.ts` files. Match the existing files.
- **No network in tests.** Every test injects a `WebFetchFn`. Never call real `fetch`.
- **Every outbound URL routes through `assertAllowedUrl`** (`src/web/guard.ts`). Federated sources are not exempt.
- **Never echo a request that carried a key.** The Brave error path stays status-only (`web search failed with HTTP ${status}`) — do not add the URL or headers to any error.
- **Result text is untrusted DATA.** Do not change the DATA framing in tool descriptions or output.
- **Test command:** `npx vitest run <path>` for one file, `npm test` for all.
- **`ctx.web` is declared in two places** — `src/security/tools.ts:79` and `src/processes/types.ts:26`. They must stay identical; changing only one is a type error waiting to happen.
- **Commit after every task.** Conventional-commit prefixes (`feat:`, `refactor:`, `test:`, `docs:`), matching recent history.

---

### Task 1: Token-bucket lookup budget

Makes the budget refill over time so a weeks-long session is not capped at 10 lookups for its entire life. Burst capacity is unchanged, so a runaway loop is still bounded.

**Files:**
- Modify: `src/web/budget.ts` (whole file)
- Modify: `src/config/schema.ts:69-73` (WebSchema), `src/config/schema.ts:156` (commented YAML)
- Modify: `src/runner/context.ts:110-114`
- Test: `test/web/budget.test.ts` (add to existing)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `LookupBudget` gains `refund(): void` and `msUntilNext(): number`. `createLookupBudget(limit?: number, opts?: { refillPerHour?: number; now?: () => number })`. `budgetSpentMessage(limit: number, msUntilNext?: number): string` — second parameter optional, defaults to `Infinity`, which reproduces today's wording exactly.

- [ ] **Step 1: Write the failing tests**

Append to `test/web/budget.test.ts`, inside the existing `describe("createLookupBudget", ...)` block:

```ts
  test("refills over time at the configured hourly rate", () => {
    let clock = 0;
    const b = createLookupBudget(10, { refillPerHour: 10, now: () => clock });
    for (let i = 0; i < 10; i++) b.take();
    expect(b.take()).toBe(false);

    clock += 6 * 60 * 1000; // six minutes = one token at 10/hour
    expect(b.remaining()).toBe(1);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });

  test("never refills past the burst capacity", () => {
    let clock = 0;
    const b = createLookupBudget(10, { refillPerHour: 10, now: () => clock });
    b.take();
    clock += 24 * 60 * 60 * 1000; // a full day of refill
    expect(b.remaining()).toBe(10);
  });

  test("refillPerHour: 0 reproduces the old non-refilling behaviour", () => {
    let clock = 0;
    const b = createLookupBudget(2, { refillPerHour: 0, now: () => clock });
    b.take();
    b.take();
    clock += 365 * 24 * 60 * 60 * 1000;
    expect(b.take()).toBe(false);
    expect(b.msUntilNext()).toBe(Infinity);
  });

  test("refund returns a token without exceeding capacity", () => {
    const b = createLookupBudget(2, { refillPerHour: 0 });
    b.take();
    b.refund();
    expect(b.remaining()).toBe(2);
    b.refund(); // already full
    expect(b.remaining()).toBe(2);
  });

  test("msUntilNext reports the wait once exhausted", () => {
    let clock = 0;
    const b = createLookupBudget(1, { refillPerHour: 60, now: () => clock }); // one per minute
    b.take();
    expect(b.msUntilNext()).toBe(60_000);
    clock += 30_000;
    expect(b.msUntilNext()).toBe(30_000);
  });

  test("the spent message names the wait when one is known", () => {
    expect(budgetSpentMessage(10, 12 * 60 * 1000)).toMatch(/12 minutes/);
    expect(budgetSpentMessage(10, Infinity)).not.toMatch(/minutes/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/web/budget.test.ts`
Expected: FAIL — `createLookupBudget` does not accept a second argument, and `b.refund` / `b.msUntilNext` are not functions.

- [ ] **Step 3: Rewrite `src/web/budget.ts`**

Replace the whole file:

```ts
/**
 * The lookup budget — why looking outward stays a tool and not a habit.
 *
 * A token bucket. `lookupBudget` is the burst capacity: no session can spend
 * more than that in quick succession, so a runaway loop is still bounded.
 * `refillPerHour` is the sustained rate, which is what makes a long-lived
 * session workable — the process may live for weeks, and a per-process cap
 * would be a per-lifetime cap.
 *
 * Refill is computed on demand from elapsed time, never by a timer, so an
 * idle process and a busy one behave identically. The clock is injectable so
 * tests never sleep.
 *
 * Exhaustion is not an error: the tools answer with an instruction to work
 * from what was already read and to record what is still unknown on the tree.
 */

export const DEFAULT_LOOKUP_BUDGET = 10;
export const DEFAULT_REFILL_PER_HOUR = 10;

const MS_PER_HOUR = 60 * 60 * 1000;

export interface LookupBudget {
  /** Spend one lookup. False when the bucket is empty. */
  take(): boolean;
  /** Return a token spent on a lookup that yielded nothing (e.g. every source failed). */
  refund(): void;
  remaining(): number;
  /** Milliseconds until at least one token is available; 0 if one is, Infinity if never. */
  msUntilNext(): number;
  /** Burst capacity. */
  limit: number;
}

export interface LookupBudgetOptions {
  refillPerHour?: number;
  now?: () => number;
}

export function createLookupBudget(limit = DEFAULT_LOOKUP_BUDGET, opts: LookupBudgetOptions = {}): LookupBudget {
  const refillPerHour = opts.refillPerHour ?? DEFAULT_REFILL_PER_HOUR;
  const now = opts.now ?? (() => Date.now());

  let tokens = limit;
  let last = now();

  function refill(): void {
    const t = now();
    if (refillPerHour > 0 && t > last) {
      tokens = Math.min(limit, tokens + ((t - last) / MS_PER_HOUR) * refillPerHour);
    }
    last = t;
  }

  return {
    limit,
    take: () => {
      refill();
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
    refund: () => {
      refill();
      tokens = Math.min(limit, tokens + 1);
    },
    remaining: () => {
      refill();
      return Math.floor(tokens);
    },
    msUntilNext: () => {
      refill();
      if (tokens >= 1) return 0;
      if (refillPerHour <= 0) return Infinity;
      return Math.ceil(((1 - tokens) / refillPerHour) * MS_PER_HOUR);
    },
  };
}

/** What a tool answers once the budget is spent — an instruction, not a refusal. */
export function budgetSpentMessage(limit: number, msUntilNext: number = Infinity): string {
  const wait =
    Number.isFinite(msUntilNext) && msUntilNext > 0
      ? ` Another lookup becomes available in about ${Math.max(1, Math.round(msUntilNext / 60_000))} minutes.`
      : "";
  return (
    `Lookup budget spent (${limit} web lookups in this burst).${wait} ` +
    `Work from what you have already read and cite it. If something essential is still unknown, ` +
    `record it as an open question on the relevant node (ost_annotate or a note in the body) ` +
    `so the next session can pick it up with a fresh budget.`
  );
}
```

- [ ] **Step 4: Run the budget tests**

Run: `npx vitest run test/web/budget.test.ts`
Expected: PASS, including the four pre-existing tests (the old `budgetSpentMessage(10)` call still works because the second parameter defaults to `Infinity`).

- [ ] **Step 5: Add the config field**

In `src/config/schema.ts`, replace the `WebSchema` block at lines 67-73:

```ts
// Outward web sensing. `lookupBudget` is the burst capacity (search + page
// reads share it); `lookupRefillPerHour` is the sustained rate, which is what
// lets a session that lives for weeks keep working. Set the rate to 0 to get
// the old non-refilling behaviour.
const WebSchema = z
  .object({
    lookupBudget: z.number().int().positive().default(10),
    lookupRefillPerHour: z.number().int().nonnegative().default(10),
  })
  .default({ lookupBudget: 10, lookupRefillPerHour: 10 });
```

Note `nonnegative()`, not `positive()` — `0` is a documented setting.

Then replace the commented YAML at line 156:

```yaml
web:
  lookupBudget: 10          # burst: web lookups (search + page reads) available at once
  lookupRefillPerHour: 10   # sustained rate; 0 disables refill (one burst per process)
```

- [ ] **Step 6: Wire the rate through the context**

In `src/runner/context.ts`, replace the `budget:` line (line 113) so the configured rate is used:

```ts
      budget: createLookupBudget(config.web.lookupBudget, { refillPerHour: config.web.lookupRefillPerHour }),
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS. If `test/config/` asserts the exact default `web` object, update it to include `lookupRefillPerHour: 10`.

- [ ] **Step 8: Commit**

```bash
git add src/web/budget.ts src/config/schema.ts src/runner/context.ts test/web/budget.test.ts
git commit -m "feat(web): refill the lookup budget so long-lived sessions keep working"
```

---

### Task 2: `SearchProvider` seam

Pure refactor. Brave becomes one provider behind an interface, with no behaviour change, so later tasks can add providers without touching the tool handler again.

**Files:**
- Modify: `src/web/search.ts` (append; leave `searchWeb` untouched)
- Modify: `src/security/tools.ts:79` and `:341-346`, `src/processes/types.ts:26`
- Modify: `src/runner/context.ts:110-115`
- Test: `test/web/search.test.ts` (add to existing)

**Interfaces:**
- Consumes: `LookupBudget` from Task 1.
- Produces:
  - `interface SearchOutcome { results: SearchResult[]; failures: { source: string; reason: string }[] }`
  - `interface SearchProvider { readonly name: string; search(query: string, count: number, fetchFn?: WebFetchFn): Promise<SearchOutcome> }`
  - `function braveProvider(apiKey: string): SearchProvider`
  - `ctx.web` gains `provider?: SearchProvider` (keeping `searchApiKey` for compatibility).

- [ ] **Step 1: Write the failing test**

Append to `test/web/search.test.ts`:

```ts
describe("braveProvider", () => {
  test("wraps searchWeb and reports no failures", async () => {
    const fetchFn: WebFetchFn = async () => ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: async () => braveBody,
    });
    const out = await braveProvider("k").search("q", 2, fetchFn);
    expect(out.results).toHaveLength(2);
    expect(out.results[0].url).toBe("https://example.com/ab");
    expect(out.failures).toEqual([]);
    expect(braveProvider("k").name).toBe("brave");
  });
});
```

Add `braveProvider` to the existing import from `../../src/web/search.js`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/web/search.test.ts`
Expected: FAIL — `braveProvider is not a function`.

- [ ] **Step 3: Append the seam to `src/web/search.ts`**

Add at the end of the file (leave `searchWeb` and `safeHost` exactly as they are):

```ts
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/web/search.test.ts`
Expected: PASS.

- [ ] **Step 5: Widen the `ctx.web` type in both declarations**

In `src/security/tools.ts` line 79, and identically in `src/processes/types.ts` line 26, replace the `web?:` member with:

```ts
  web?: { searchApiKey?: string; provider?: SearchProvider; fetchFn?: WebFetchFn; budget?: LookupBudget };
```

Add `SearchProvider` to the existing type import from `../web/search.js` in each file.

- [ ] **Step 6: Resolve the provider in the tool handler**

In `src/security/tools.ts`, replace lines 341-347 (the `const apiKey = ...` block through the closing brace of the `if (!apiKey)` throw) with:

```ts
        const provider =
          ctx.web?.provider ?? (ctx.web?.searchApiKey ? braveProvider(ctx.web.searchApiKey) : undefined);
        if (!provider) {
          throw new Error(
            "web search is not configured — set BRAVE_SEARCH_API_KEY (free tier at brave.com/search/api) in the environment that starts ost-agent. ost_read_web still works for direct URLs.",
          );
        }
```

Then replace the `const results = await searchWeb(...)` line with:

```ts
        const { results } = await provider.search(input.query, input.count ?? DEFAULT_SEARCH_RESULTS, ctx.web?.fetchFn);
```

Add `braveProvider` to the value import from `../web/search.js`. The error message is deliberately unchanged in this task — Task 3 replaces it.

- [ ] **Step 7: Build the provider in the context**

In `src/runner/context.ts`, replace the `web:` block (lines 110-115) with:

```ts
    // The key is optional: ost_read_web works without it, and ost_search_web
    // answers at call time — with results if a provider resolved, otherwise
    // with the delegation instruction.
    web: {
      searchApiKey: process.env.BRAVE_SEARCH_API_KEY,
      provider: process.env.BRAVE_SEARCH_API_KEY ? braveProvider(process.env.BRAVE_SEARCH_API_KEY) : undefined,
      budget: createLookupBudget(config.web.lookupBudget, { refillPerHour: config.web.lookupRefillPerHour }),
    },
```

Add `braveProvider` to the imports from `../web/search.js`.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS with no changes to any existing assertion — this task is behaviour-preserving.

- [ ] **Step 9: Commit**

```bash
git add src/web/search.ts src/security/tools.ts src/processes/types.ts src/runner/context.ts test/web/search.test.ts
git commit -m "refactor(web): put Brave behind a SearchProvider seam"
```

---

### Task 3: Delegation as the zero-config default

Turns the unconfigured case from a dead end into the intended workflow. This is the change that makes the plugin work on install in Claude Code.

**Files:**
- Modify: `src/security/tools.ts` (the `if (!provider)` block from Task 2)
- Test: `test/security/web-tools.test.ts:43-45` (rewrite the existing test)

**Interfaces:**
- Consumes: the `provider` resolution from Task 2.
- Produces: `SEARCH_DELEGATION_MESSAGE`, exported from `src/web/search.ts`.

- [ ] **Step 1: Rewrite the failing test**

In `test/security/web-tools.test.ts`, replace the existing test at lines 43-45 (`"without a key, answers with the setup hint..."`) with:

```ts
  test("without a provider, instructs the agent to use its own search — and spends no budget", async () => {
    const budget = createLookupBudget(5);
    const out = await tool(baseCtx({ web: { budget } }), "ost_search_web").run({ query: "q" });
    expect(out).toMatch(/your own web search|host's web search/i);
    expect(out).toMatch(/ost_read_web/);
    expect(budget.remaining()).toBe(5); // the dead-end branch must not charge for a lookup
  });
```

Note this asserts a returned string, not a rejection: exhaustion and unavailability are instructions in this codebase, not errors.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/security/web-tools.test.ts`
Expected: FAIL — the handler throws instead of returning.

- [ ] **Step 3: Export the message from `src/web/search.ts`**

Append:

```ts
/**
 * What ost_search_web answers when no provider resolved.
 *
 * MCP gives a server no way to call the host's tools, so delegation cannot be
 * hidden behind this tool — it has to be said to the agent, which is what this
 * is. Provenance is unaffected: however a URL is found, ost_read_web is what
 * fetches and records it.
 */
export const SEARCH_DELEGATION_MESSAGE =
  "No server-side search provider is configured, which is the normal setup. " +
  "Use your own web search tool to find candidate URLs, then call ost_read_web on each one — " +
  "that is what records provenance as WEB:<host> and puts the claim on the believability ladder. " +
  "If you have no web search of your own, either enable the keyless federated sources " +
  "(web.search.federated.enabled in ost.config.yaml) or set BRAVE_SEARCH_API_KEY. Neither is required.";
```

- [ ] **Step 4: Return it instead of throwing**

In `src/security/tools.ts`, replace the `throw new Error(...)` inside `if (!provider)` with:

```ts
        if (!provider) return SEARCH_DELEGATION_MESSAGE;
```

Add `SEARCH_DELEGATION_MESSAGE` to the import from `../web/search.js`. Confirm this branch still sits **above** `lookupBudget.take()` — the ordering is what makes the budget assertion in Step 1 pass.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/security/web-tools.test.ts && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/search.ts src/security/tools.ts test/security/web-tools.test.ts
git commit -m "feat(web): delegate search to the host when no provider is configured"
```

---

### Task 4: Keyless source adapters

Three officially-documented, keyless endpoints. Each maps its own API shape onto `SearchResult`. No merging logic here — that is Task 5.

**Files:**
- Create: `src/web/sources.ts`
- Test: `test/web/sources.test.ts`

**Interfaces:**
- Consumes: `SearchResult` from `src/web/search.js`.
- Produces:
  - `interface KeylessSource { readonly name: string; url(query: string, count: number): string; parse(body: string): SearchResult[] }`
  - `function wikipediaSource(): KeylessSource`
  - `function hackerNewsSource(): KeylessSource`
  - `function discourseSource(host: string): KeylessSource`
  - `function stripHtml(s: string): string`

- [ ] **Step 1: Write the failing tests**

Create `test/web/sources.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/web/sources.test.ts`
Expected: FAIL — cannot resolve `../../src/web/sources.js`.

- [ ] **Step 3: Create `src/web/sources.ts`**

```ts
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

/** Search APIs return snippets with markup in them; results are read as text. */
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (m) => ENTITIES[m] ?? m)
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
      const p = new URLSearchParams({
        action: "query",
        list: "search",
        format: "json",
        origin: "*",
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
      const p = new URLSearchParams({ query, hitsPerPage: String(count) });
      return `https://hn.algolia.com/api/v1/search?${p}`;
    },
    parse: (body) => {
      const data = parseJson(body, "hackernews") as {
        hits?: { title?: string; url?: string | null; objectID?: string; story_text?: string }[];
      };
      const hits = data.hits ?? [];
      return hits
        .filter((h): h is { title: string; url?: string | null; objectID?: string; story_text?: string } =>
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
  const clean = host.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
  return {
    name: `discourse:${clean}`,
    url: (query, count) => {
      const p = new URLSearchParams({ q: query, per_page: String(count) });
      return `https://${clean}/search.json?${p}`;
    },
    parse: (body) => {
      const data = parseJson(body, `discourse:${clean}`) as {
        topics?: { id?: number; slug?: string; title?: string }[];
      };
      const topics = data.topics ?? [];
      return topics
        .filter((t): t is { id: number; slug: string; title: string } =>
          typeof t.id === "number" && typeof t.slug === "string" && typeof t.title === "string",
        )
        .map((t) => ({
          title: t.title,
          url: `https://${clean}/t/${t.slug}/${t.id}`,
          snippet: "",
          host: clean,
        }));
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/web/sources.test.ts`
Expected: PASS (17 assertions across 11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/web/sources.ts test/web/sources.test.ts
git commit -m "feat(web): keyless source adapters for Wikipedia, Hacker News and Discourse"
```

---

### Task 5: The federated provider

Fan-out, partial-failure reporting, all-fail signalling, dedupe, round-robin merge, and per-source cooldown. This is where a weeks-long run either survives a flaky source or does not.

**Files:**
- Create: `src/web/federated.ts`
- Test: `test/web/federated.test.ts`

**Interfaces:**
- Consumes: `KeylessSource` (Task 4), `SearchProvider` / `SearchOutcome` / `SearchResult` (Task 2), `assertAllowedUrl` (`src/web/guard.js`).
- Produces: `function federatedProvider(sources: KeylessSource[], opts?: { now?: () => number; cooldownMs?: number }): SearchProvider`, and `class AllSourcesFailedError extends Error` with a `failures` property.

- [ ] **Step 1: Write the failing tests**

Create `test/web/federated.test.ts`:

```ts
/**
 * The federated provider: many keyless sources, one result set. Over a long
 * run a source WILL be down, so partial failure is the normal path, not the
 * exception.
 */
import { describe, expect, test } from "vitest";
import { federatedProvider, AllSourcesFailedError } from "../../src/web/federated.js";
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/web/federated.test.ts`
Expected: FAIL — cannot resolve `../../src/web/federated.js`.

- [ ] **Step 3: Create `src/web/federated.ts`**

```ts
/**
 * The federated provider — several keyless sources behind one SearchProvider.
 *
 * Two decisions worth keeping:
 *
 * Partial failure is the normal path. Over a run measured in weeks some source
 * will be down, and an agent that gets three results and is TOLD it missed one
 * source can record an honest gap. Silently returning three would make the
 * coverage look complete when it is not.
 *
 * Merge is round-robin, not scored. There is no comparable relevance signal
 * between MediaWiki and Algolia, so a synthesised cross-source ranking would
 * be fiction presented as judgement.
 */
import { assertAllowedUrl, TIMEOUT_MS } from "./guard.js";
import type { WebFetchFn } from "./reader.js";
import type { SearchOutcome, SearchProvider, SearchResult } from "./search.js";
import type { KeylessSource } from "./sources.js";

/** Thrown when not one source answered — the caller should refund the lookup. */
export class AllSourcesFailedError extends Error {
  readonly failures: { source: string; reason: string }[];
  constructor(failures: { source: string; reason: string }[]) {
    super(`every search source failed: ${failures.map((f) => `${f.source} (${f.reason})`).join(", ")}`);
    this.name = "AllSourcesFailedError";
    this.failures = failures;
  }
}

export const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Wikimedia serves 403 at the edge to clients that send no descriptive
 * User-Agent, and Node sends none by default — so without this, Wikipedia
 * never works. Identifying the tool is also just the polite way to use
 * somebody's free API.
 */
export const FEDERATED_USER_AGENT = "ost-agent (+https://github.com/tannerbroberts/OST-Agent)";

export interface FederatedOptions {
  now?: () => number;
  cooldownMs?: number;
}

export function federatedProvider(sources: KeylessSource[], opts: FederatedOptions = {}): SearchProvider {
  const now = opts.now ?? (() => Date.now());
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  // Per-provider, not module-global: one instance per session, no shared state.
  const cooling = new Map<string, number>();

  async function one(src: KeylessSource, query: string, count: number, fetchFn: WebFetchFn): Promise<SearchResult[]> {
    const until = cooling.get(src.name);
    if (until !== undefined && now() < until) {
      throw new Error(`cooling down after a rate limit for another ${Math.ceil((until - now()) / 1000)}s`);
    }

    const url = assertAllowedUrl(src.url(query, count)); // federated sources are not exempt from the guard
    const res = await fetchFn(url.toString(), {
      method: "GET",
      headers: { accept: "application/json", "user-agent": FEDERATED_USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 429) {
      cooling.set(src.name, now() + cooldownMs);
      throw new Error("HTTP 429 (rate limited) — cooling this source down");
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    return src.parse(await res.text());
  }

  return {
    name: "federated",
    search: async (query, count, fetchFn) => {
      const fetcher = fetchFn ?? (globalThis.fetch as unknown as WebFetchFn);
      const settled = await Promise.all(
        sources.map(async (src) => {
          try {
            return { src, results: await one(src, query, count, fetcher) };
          } catch (err) {
            return { src, reason: err instanceof Error ? err.message : String(err) };
          }
        }),
      );

      const failures = settled
        .filter((s): s is { src: KeylessSource; reason: string } => "reason" in s)
        .map((s) => ({ source: s.src.name, reason: s.reason }));

      const answered = settled.filter((s): s is { src: KeylessSource; results: SearchResult[] } => "results" in s);
      if (answered.length === 0) throw new AllSourcesFailedError(failures);

      return { results: interleave(answered.map((a) => a.results), count), failures } satisfies SearchOutcome;
    },
  };
}

/** Round-robin across sources, deduped on URL, capped at `count`. */
function interleave(lists: SearchResult[][], count: number): SearchResult[] {
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < depth && out.length < count; i++) {
    for (const list of lists) {
      if (out.length >= count) break;
      const r = list[i];
      if (!r) continue;
      const key = r.url.replace(/\/+$/, "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/web/federated.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/web/federated.ts test/web/federated.test.ts
git commit -m "feat(web): federated provider with partial failure, dedupe and cooldown"
```

---

### Task 6: Wire federated into config, context and the tool surface

Makes the fallback reachable, surfaces unavailable sources to the agent, and refunds the budget when a lookup returned nothing.

**Files:**
- Modify: `src/config/schema.ts` (WebSchema, commented YAML)
- Modify: `src/runner/context.ts` (provider resolution)
- Modify: `src/security/tools.ts` (failure reporting + refund)
- Test: `test/security/web-tools.test.ts` (add), `test/config/` (update defaults if asserted)

**Interfaces:**
- Consumes: `federatedProvider`, `AllSourcesFailedError` (Task 5); the source constructors (Task 4); `refund()` (Task 1).
- Produces: config path `web.search.federated.{enabled,discourseHosts}`.

- [ ] **Step 1: Write the failing tests**

Append to `test/security/web-tools.test.ts`, inside `describe("ost_search_web", ...)`:

```ts
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
```

Add to the imports at the top of the file:

```ts
import { AllSourcesFailedError } from "../../src/web/federated.js";
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/security/web-tools.test.ts`
Expected: FAIL — `sourcesUnavailable` is undefined, and the second test rejects instead of returning a message.

- [ ] **Step 3: Report failures and refund in the handler**

In `src/security/tools.ts`, replace the `const { results } = await provider.search(...)` line and the `return JSON.stringify(...)` block that follows it with:

```ts
        // Clamp here, not in the provider: `searchWeb` clamps internally for Brave,
        // but a federated source would otherwise turn `count: 500` into srlimit=500
        // against a live third-party API. Every provider gets a sane count.
        const count = Math.min(Math.max(1, input.count ?? DEFAULT_SEARCH_RESULTS), MAX_SEARCH_RESULTS);
        let outcome;
        try {
          outcome = await provider.search(input.query, count, ctx.web?.fetchFn);
        } catch (err) {
          if (err instanceof AllSourcesFailedError) {
            // An outage cost a lookup that bought nothing — refund it. An
            // all-cooling failure touched no network and returned instantly, so
            // refunding it would make retrying free AND instant in exactly the
            // state where an agent is most likely to spin. The budget is the
            // only backpressure this system has; do not hand it back here.
            if (!err.allCooling) lookupBudget.refund();
            const charged = err.allCooling
              ? "This attempt was charged: every source is rate-limited, so retrying immediately will not help."
              : "Nothing was charged against the lookup budget.";
            return `${err.message}. ${charged} Use your own web search and call ost_read_web on the URLs you find.`;
          }
          lookupBudget.refund();
          throw err;
        }
        const trust = readHostTrust(dir);
        return JSON.stringify(
          {
            lookupsRemaining: lookupBudget.remaining(),
            results: outcome.results.map((r) => ({ ...r, hostTrust: hostRung(trust, r.host) })),
            ...(outcome.failures.length > 0 ? { sourcesUnavailable: outcome.failures } : {}),
          },
          null,
          2,
        );
```

There is exactly one `const trust = readHostTrust(dir);` in the handler, immediately after the `provider.search` call. The replacement block above re-introduces it — delete the original so you do not end up with two. Add `AllSourcesFailedError` to the imports from `../web/federated.js`, and confirm `MAX_SEARCH_RESULTS` is already imported from `../web/search.js` (it is — the tool's `inputSchema` uses it).

- [ ] **Step 4: Run the handler tests**

Run: `npx vitest run test/security/web-tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the federated config block**

In `src/config/schema.ts`, replace the `WebSchema` from Task 1 with:

```ts
// Outward web sensing. `lookupBudget` is the burst capacity (search + page
// reads share it); `lookupRefillPerHour` is the sustained rate, which is what
// lets a session that lives for weeks keep working. Set the rate to 0 to get
// the old non-refilling behaviour.
//
// Federated search is OFF by default and that is deliberate: if it defaulted
// on, provider resolution would never reach the delegation branch, and an
// agent in a host that HAS web search would call ost_search_web, get the
// narrower federated results, and never learn its own search was better.
// discourseHosts is capped because the merge fills from the front: with more
// sources than result slots, the tail contributes nothing to a given call while
// still costing a live request against somebody's free forum. The provider
// rotates who goes first so starvation is temporary, but a long list is still
// mostly wasted traffic. Five is generous for a fallback.
const FederatedSchema = z
  .object({
    enabled: z.boolean().default(false),
    discourseHosts: z.array(z.string()).max(5).default([]),
  })
  .default({ enabled: false, discourseHosts: [] });

const WebSchema = z
  .object({
    lookupBudget: z.number().int().positive().default(10),
    lookupRefillPerHour: z.number().int().nonnegative().default(10),
    search: z.object({ federated: FederatedSchema }).default({ federated: { enabled: false, discourseHosts: [] } }),
  })
  .default({
    lookupBudget: 10,
    lookupRefillPerHour: 10,
    search: { federated: { enabled: false, discourseHosts: [] } },
  });
```

And replace the commented YAML `web:` block:

```yaml
web:
  lookupBudget: 10          # burst: web lookups (search + page reads) available at once
  lookupRefillPerHour: 10   # sustained rate; 0 disables refill (one burst per process)
  search:
    federated:
      enabled: false        # keyless fallback for hosts with NO web search of their own.
                            # Leave off if your host has search — ost_search_web will tell
                            # the agent to use it, which is better than these sources.
      discourseHosts: []    # e.g. [forum.obsidian.md]
```

- [ ] **Step 6: Resolve the federated provider in the context**

In `src/runner/context.ts`, replace the `provider:` line with a resolution that follows the spec's order — Brave, else federated, else none:

```ts
      provider: resolveSearchProvider(config),
```

And add above the `export` that contains it (module scope, after the imports):

```ts
/**
 * Brave if a key is set, else the keyless federated sources if they are turned
 * on, else nothing — in which case ost_search_web tells the agent to use its
 * host's own search, which is the normal path in Claude Code.
 */
function resolveSearchProvider(config: Config): SearchProvider | undefined {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (key) return braveProvider(key);
  if (!config.web.search.federated.enabled) return undefined;
  const sources = [
    wikipediaSource(),
    hackerNewsSource(),
    ...config.web.search.federated.discourseHosts.map((h) => discourseSource(h)),
  ];
  return federatedProvider(sources);
}
```

Add these imports to `src/runner/context.ts` — none of them are present yet:

```ts
import type { Config } from "../config/schema.js";
import { braveProvider } from "../web/search.js";
import type { SearchProvider } from "../web/search.js";
import { federatedProvider } from "../web/federated.js";
import { wikipediaSource, hackerNewsSource, discourseSource } from "../web/sources.js";
```

(`braveProvider` was already added in Task 2 Step 7; do not add it twice.)

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS. If a config test asserts the exact default `web` object, extend it with `lookupRefillPerHour: 10` and `search: { federated: { enabled: false, discourseHosts: [] } }`.

- [ ] **Step 8: Update the docs that now state something false**

`CHANGELOG.md:294` describes `ost_search_web` as "(Brave Search, `BRAVE_SEARCH_API_KEY`)". Add an entry under the current unreleased section:

```markdown
- **Web search no longer needs an API key.** `ost_search_web` now tells the agent
  to use its host's own web search and feed URLs to `ost_read_web`, which is what
  records provenance. Keyless federated sources (Wikipedia, Hacker News, Discourse)
  are available as an opt-in fallback for hosts with no search of their own, and a
  `BRAVE_SEARCH_API_KEY` remains supported as an optional upgrade.
- **The lookup budget refills.** It was capped per process, which meant a session
  running for weeks got 10 lookups in total. Burst capacity is unchanged;
  `web.lookupRefillPerHour` (default 10) sets the sustained rate.
```

Then grep for other stale claims and fix any that say a key is required:

```bash
grep -rn "BRAVE_SEARCH_API_KEY" --include="*.md" . | grep -v node_modules
```

- [ ] **Step 9: Tell the skill about delegation**

The runtime message reaches the agent at the moment it matters, but a fresh agent should know the workflow before hitting it.

`.claude/skills/opportunity-solution-tree/SKILL.md` is **generated** — do not edit it directly, there is a drift test. Edit `scripts/gen-skill.ts` line 77, replacing the `ost_search_web` bullet with:

```ts
- **ost_search_web** — read-only web search. Spends 1 from the session's shared lookup budget; when the budget is spent, work from what you read and record open questions on the tree instead of looking more. If it reports that no provider is configured, that is the normal setup: use your own web search tool to find candidate URLs, then call ost_read_web on each — that is what records provenance, so traceability is identical either way.
```

Then regenerate and verify:

Run: `npm run gen:skill && npx vitest run test/skill/`
Expected: `SKILL.md` is rewritten and the skill tests pass.

- [ ] **Step 10: Verify end to end, then commit**

Run: `npm test && npm run build`
Expected: PASS and a clean compile.

```bash
git add -A
git commit -m "feat(web): opt-in keyless federated search, wired through config and the tool surface"
```

---

## Self-Review

**Spec coverage.** Every numbered section of the spec maps to a task: the `SearchProvider` seam → Task 2; delegation default → Task 3; federated sources → Tasks 4-5; token bucket → Task 1; one-lookup-per-call → Task 5 (a single `search()` call spends one token in the handler, regardless of fan-out); partial failure → Tasks 5 and 6; round-robin merge → Task 5; config → Tasks 1 and 6; skill layer → Task 6 Step 9; the subagent note is operational rather than code and is called out below.

**Known gap, deliberately left out of scope:** the spec's non-goals exclude the title round-trip defect, and no task here touches `sanitizeTitle`.

**Type consistency.** `SearchOutcome` is defined in Task 2 and consumed unchanged in Tasks 5 and 6. `KeylessSource` is defined in Task 4 and consumed in Task 5. `refund()` and `msUntilNext()` are defined in Task 1 and consumed in Task 6 and the spent message respectively. `braveProvider` keeps the same signature everywhere it appears.

**Checked, so the implementer does not have to:** `test/config/` contains no assertion on `lookupBudget` or the `web` config object, so adding fields there breaks nothing. The conditional notes in Tasks 1 and 6 are belt-and-braces; `npm test` is still the authority.

## After the plan

Delegation depends on the calling agent having a web search tool. The benchmark subagent definitions (`ost08`, `ost09`, `ost10`) grant only `mcp__ostNN__*`, so delegation will silently do nothing there while working in the main terminal. Add `WebSearch` to those agent definitions before re-running the benchmark, or the feature will look broken.
