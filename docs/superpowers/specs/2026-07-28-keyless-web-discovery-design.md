# Keyless web discovery: host delegation, federated sources, and a refilling budget

**Date:** 2026-07-28
**Status:** Approved for implementation

## Problem

Web search requires a Brave API key. That is a bad price of entry: a user who
installs the plugin should get a working agent, and commissioning a key is a
signup, a credential to store, and a quota to own. Discovery is the one
capability where "works out of the box" matters most, because an agent that
cannot look anything up cannot start.

The three benchmark vault runs on 2026-07-28 (vaults 08, 09, 10) all ran with
`BRAVE_SEARCH_API_KEY` unset. Every agent degraded honestly — each said so in
its report, and none invented facts to cover the gap — but coverage collapsed
to whatever URLs happened to be reachable from pages already read. Vault 09
named the consequence exactly: *"a convenience sample with an undefined
denominator."* No negative claim in any of the three trees is supported at the
strength a reader would assume.

A second problem surfaced during those runs, and it blocks the stated goal
harder than the key does. `createLookupBudget` is instantiated once per
`PassContext` (`src/runner/context.ts:113`), and `src/web/budget.ts` describes
that scope as "per MCP session, per pass" — treating the two as equivalent.
For a stdio server they are: the budget lives as long as the process. The
target deployment is an agent running for **weeks** in a Claude Code terminal,
which under the current model gets **10 web lookups for the entire run**.
Vault 10 spent 8 of 10 in eleven minutes.

The budget's intent is right and is preserved here. `budgetSpentMessage`
degrades into an instruction rather than an error, which is why the agents
behaved well on exhaustion, and *"looking is cheap to start and expensive to
binge"* remains the governing idea. Only the refill model is wrong: a
per-session cap on an unbounded session is a per-lifetime cap.

## Goals

1. **Search works with no API key and no signup**, in the target deployment
   (Claude Code, main terminal or subagent), on first run.
2. **A weeks-long run keeps working** — sustained lookup access, with bingeing
   still capped.
3. **Provenance is identical on every path.** However a URL is discovered, it
   is `ost_read_web` that fetches and records it, so evidence traceability
   does not depend on which discovery route was used.
4. Brave remains supported as an optional upgrade, never a requirement.

## Non-goals

- Scraping general-web search engines. The DuckDuckGo HTML endpoint and public
  SearXNG instances were considered and rejected: a multi-week agent generates
  traffic that looks like a bot because it is one, and volunteer instances
  disappear. A default that silently degrades is worse than one that is
  honestly absent.
- Changing the security posture. Every outbound URL, including every federated
  source, continues through `assertAllowedUrl`.
- Changing `SearchResult`, `ost_read_web`, `ost_read_repo`, or the
  believability ladder.
- Fixing the title round-trip defect (colons in titles are stripped by
  `sanitizeTitle` while lookups match on the unsanitized string). Real, and
  it corrupts `unknown:` attribution, but it is a separate subsystem and
  should not wait on this design.

## Design

### Constraint that shapes everything: MCP has no server-to-client tool calls

A server cannot invoke the host's tools. MCP offers sampling (server requests
a completion) and elicitation (server requests user input), but nothing that
would let `ost_search_web` proxy to Claude Code's `WebSearch`. Host delegation
therefore cannot be hidden behind the existing tool — it has to happen at the
prompt layer, where the agent uses its own search and hands URLs to
`ost_read_web`.

This is cheaper than it sounds, because the unconfigured branch already
returns a message. It just does not currently say the useful thing.

### 1. A `SearchProvider` seam

`searchWeb()` in `src/web/search.ts` currently takes an `apiKey` and hardcodes
`BRAVE_ENDPOINT`. Invert it:

```ts
export interface SearchProvider {
  readonly name: string;
  search(query: string, count: number, fetchFn: WebFetchFn): Promise<SearchResult[]>;
}
```

- `braveProvider(apiKey)` wraps the existing body with no behavior change. The
  key still travels only in the request header, and its failure path stays
  status-only so nothing from a key-carrying request is echoed.
- `federatedProvider(sources)` fans out across keyless endpoints and merges
  into the same `SearchResult[]`.

`SearchResult` and the injectable `fetchFn` are unchanged, so existing tests
keep their meaning.

Resolution happens once, in `src/runner/context.ts`:

1. `BRAVE_SEARCH_API_KEY` set → Brave.
2. Else `web.search.federated.enabled` → federated.
3. Else → no provider (delegation).

### 2. Delegation as the zero-config default

When no provider resolves, `src/security/tools.ts:345` returns an instruction
instead of a dead end: use the host's web search to find candidate URLs, then
call `ost_read_web` on each so provenance is recorded. It should also name the
optional upgrades (a Brave key, or enabling federated sources) without
implying either is required.

The existing ordering is already correct and must be preserved: the
unconfigured branch returns *before* `lookupBudget.take()`, so a delegation
hint costs no budget.

In Claude Code this is the primary path, and it is the most durable one
available: search is harness-provided, already authenticated, quota-managed
upstream, and maintained by someone else. Over a multi-week run there is
nothing to rate-limit, scrape, or repair.

**Subagent note.** A subagent with a restricted tool list has no `WebSearch`
unless it is granted. The benchmark harness must include it in the agent
definitions, or delegation silently fails there while working in the main
terminal.

### 3. Federated keyless sources

For hosts with no search of their own. Ship three, keep the list extensible:

- **Wikipedia / MediaWiki** — `action=query&list=search`.
- **Hacker News via Algolia** — `hn.algolia.com/api/v1/search`.
- **Discourse** — `/search.json` against a configured list of forum hosts.
  Vault 10 discovered this route unaided mid-run and got real evidence from
  it, which is the empirical case for including it.

All are officially documented, keyless, and free — no scraping, no ToS gray
area. Each fetch routes through `assertAllowedUrl`, so the SSRF posture is
unchanged.

**Honest limitation.** Federated search is weaker than delegation and for some
questions is close to useless: vault 08's "which MCP hosts can run OST-Agent"
gets nothing from Wikipedia and little from Hacker News. It is the answer to
"this host has no search at all," not a peer to delegation. Documentation
should not oversell it.

### 4. The budget becomes a token bucket

Capacity stays `web.lookupBudget` (default 10), so a binge is still capped at
10 in quick succession. Add `web.lookupRefillPerHour` (default 10). A
weeks-long run gets sustained access; a runaway loop still cannot burn a
hundred lookups in a minute.

`createLookupBudget` grows an injectable clock, matching the `fetchFn`
injection pattern already used throughout `src/web`. Refill is computed on
demand from elapsed time rather than by a timer, so there is no background
work and no behavior difference between an idle and a busy process.

`budgetSpentMessage` gains the time until the next lookup becomes available,
which turns "stop looking" into "stop looking for now" — the correct
instruction for a long-lived agent, and one it can act on.

### 5. One lookup per call, regardless of fan-out

A three-source federated search spends one budget unit, not three. The budget
models the agent's attention, not network traffic; the sources are free and
their limits are per-source. This also keeps budget semantics identical to
today's, so the change is invisible to the Brave path.

### 6. Partial failure is the normal case

Over weeks a source will be down. Federated search therefore:

- Returns the sources that answered and **names the ones that did not**, inline
  in the result. An agent that gets partial results and knows what it missed
  can record an honest `#Unknown` — the benchmark runs demonstrated all three
  agents already do this when told the truth about coverage.
- Errors only when **every** source fails, and in that case **refunds** the
  budget token. A provider outage should not drain a bucket the agent got no
  value from.
- Puts a source that returns 429 on a short cooldown. Across a multi-week run
  this is the difference between one rate-limit response and thousands.

### 7. Merge by round-robin, not by score

There is no comparable relevance signal between MediaWiki and Algolia, so
results interleave by source, dedupe on normalized URL, and truncate to
`count`. A synthesized cross-source ranking would be fiction presented as
judgement.

### Config

```yaml
web:
  lookupBudget: 10           # burst capacity
  lookupRefillPerHour: 10    # sustained rate; a weeks-long run needs this > 0
  search:
    federated:
      enabled: false         # off by default — see below
      discourseHosts: []     # e.g. forum.obsidian.md
```

`lookupRefillPerHour` must accept `0` (unlike `lookupBudget`, which is
`z.number().int().positive()`), because `0` is the documented way to restore
today's non-refilling behavior.

**Federated defaults to off, and that is deliberate.** If it defaulted on, the
resolution order would never reach delegation, and in the target deployment
the agent would call `ost_search_web`, receive inferior federated results, and
never learn that the host's own search — better on every axis — was sitting
right there. Defaulting off means Claude Code gets the good path with no
config, and a host without search gets a message naming the exact setting to
turn on. That leaves federated one config edit away from working rather than
zero, which is the correct trade: it is the fallback, not the default.

The existing comment at `src/config/schema.ts:156` ("set BRAVE_SEARCH_API_KEY
to enable search") becomes false and must be rewritten, along with any install
documentation repeating it. `CHANGELOG.md:294` also names Brave as the search
backend.

### Skill layer

The runtime message is the reliable delegation channel because it arrives
exactly when the agent needs it. The `opportunity-solution-tree` skill should
also state it, so a fresh agent knows the workflow before hitting the wall
rather than after.

## Testing

Follows the existing injectable-`fetchFn` discipline; no test touches the
network.

- **Per provider:** API shape → `SearchResult` mapping, malformed JSON, empty
  results. Brave keeps its existing status-only error assertion.
- **Federated:** partial failure returns successes and names failures;
  all-fail refunds the budget; URL dedupe; round-robin interleave and `count`
  truncation; 429 places a source on cooldown and skips it while cooling.
- **Budget:** refill against an injected clock, capacity ceiling (no
  over-refill past burst), take-at-empty, and refund.
- **Tool handler:** no provider → delegation message *and* unchanged budget
  (assert `remaining()` is untouched — this is the regression most likely to
  slip); provider present → normal path.
- **Guard:** unchanged, and federated source URLs are asserted to route
  through it.

**Known test breakage:** `test/security/web-tools.test.ts:44` asserts the
current `/BRAVE_SEARCH_API_KEY/` rejection text. That message becomes the
delegation instruction, so the test must be rewritten rather than deleted —
its replacement asserts the delegation wording and the untouched budget.

## Risks

- **Delegation depends on the host having search.** Mitigated by the federated
  fallback, and by the message naming the upgrades. In a host with neither,
  the agent is no worse off than today.
- **Federated sources are third-party and can change shape.** Each provider is
  isolated behind `SearchProvider`, and partial-failure handling means one
  broken source degrades rather than breaks the call.
- **A refilling budget weakens the anti-binge property over long horizons.** A
  weeks-long run can spend far more than 10 lookups in total — by design. The
  burst cap is what prevents a single runaway loop; the hourly rate is what
  makes multi-week operation possible. Both are configurable, and setting
  `lookupRefillPerHour: 0` restores exactly today's behavior.
