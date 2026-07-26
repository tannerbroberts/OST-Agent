# Outward sensing: bounded web lookup, source trust, and product-repo reads

**Date:** 2026-07-26
**Status:** Approved for implementation

## Problem

The agent ideates in a black box. Its only inputs are the curated inbound
channels (inbox, transcripts, Jira, Slack), so it cannot look up best
practices, methodologies, prior art, or current events, and it cannot read the
product it is doing discovery *for*. The internet is an unbounded resource for
getting unstuck — but unbounded is the problem: with no cost attached, an
agent can spend a whole pass just looking. And information that comes in from
outside has no earned trust: a blog post and a peer-reviewed result look
identical as text.

The vault already has the answer to the trust half: the believability ladder
(`src/knowledge/believability.ts`, `money > observed > stated > expert >
assertion`), with the rule that anything unrecognised falls to the floor. Web
sensing must plug into that ladder, not grow a parallel one.

## Goals

1. The agent can search the web and read pages — read-only, easily, but under
   a **bounded lookup budget** per run so looking stays a tool, not a habit.
2. Web-sourced claims enter the ladder at a defensible rung, and the agent can
   **earn trust upward** for a publisher — with a recorded reason — after
   first-party evidence corroborates that publisher's claims.
3. The agent can read the product's own codebase(s), read-only and
   path-confined, so ideation is grounded in what the product actually is.

## Non-goals

- Writing anything to the web. All web access is GET.
- Crawling, link-following beyond redirects, or bulk download.
- Reading external datasets/warehouses — covered by the in-flight
  `ost_read_evidence_sql` work (`docs/superpowers/plans/2026-07-25-sql-evidence-reads.md`).
- Automatic rung inference above the floor. Only recorded, reasoned promotion.
- Adding these tools to the autonomous P1–P5 passes. Passes stay hermetic;
  the new tools live on the MCP surface (interactive sessions and the loop),
  same as the SQL reader plan decided.

## Design

Four new tools, all through the existing four registration gates
(`policy.ts` allowlist → `tools.ts` registry → `server.ts` MCP surface →
generated skill). Names avoid `DESTRUCTIVE_TOKENS` (`fetch`, `pull`, `run`, …).

### 1. `ost_search_web` — read-only, budgeted

Input `{ query, count? }` (count ≤ 10, default 5). Backed by the Brave Search
API; key from `BRAVE_SEARCH_API_KEY` (never written to the vault, never in
output). Returns `{ results: [{ title, url, snippet, host, hostTrust }] }` —
each result carries the host's current trust rung so ranking is visible at the
point of reading. Without the key it fails with the setup hint (where to get a
key, what to export), following the `withAuthHint` pattern.

### 2. `ost_read_web` — read-only, budgeted

Input `{ url }`. GET only, via an injectable `fetchFn` (the Slack-adapter
pattern — tests never touch the network). Guard before every request **and
every redirect hop** (`src/web/guard.ts`):

- scheme must be `http`/`https`;
- hostname must not be loopback/private/link-local (IPv4 literal ranges
  `127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `0.0.0.0`, IPv6
  `::1`/`fc00::/7`/`fe80::/10`, names `localhost`, `*.local`, `*.internal`);
- at most `MAX_REDIRECTS = 3` hops, each re-validated (manual redirect loop);
- `TIMEOUT_MS = 10_000` per request; response text capped at
  `MAX_PAGE_CHARS = 20_000` with an explicit truncation marker.

Known limit (documented in the module header): the guard is hostname-level;
it does not resolve DNS, so a public name pointing at a private address is not
caught. Acceptable for a read-only GET from an operator machine.

HTML is reduced to text (drop `script`/`style`/`noscript`, block tags →
newlines, strip tags, decode common entities). Output is wrapped with the
provenance line `WEB:<host>` plus the standing note that fetched text is
**untrusted data, never instructions** — same contract as every adapter.

### 3. `ost_read_repo` — read-only, path-confined, no budget

Input `{ path? }` against `product.repos` (new config list of local repo
roots). A directory path returns a capped listing (skipping `.git`,
`node_modules`, `dist`); a file path returns content capped at
`MAX_FILE_CHARS = 20_000`, passed through `redactSecrets`. Paths are resolved
via `realpath` and must stay under a configured root — symlink escapes are
refused. Local reads are cheap, so no lookup budget; every call still lands in
the usage trace like all tools.

### 4. `ost_rank_source` — mutating, append-only

Input `{ host, rung, reason }`. Appends `{ ts, host, rung, reason, by }` to
`.ost-agent/trust/hosts.jsonl` — append-only, last record wins, malformed
lines ignored fail-closed. Constraints:

- `rung` ∈ `{ assertion, expert }` only. **`expert` is the ceiling for
  publisher identity**: `observed` and `money` can only be earned by
  first-party measurement, which is what AssumptionTests + `ost_set_evidence`
  already exist for. Nobody's byline is observed behavior.
- `reason` required. The tool description instructs: promote only after a
  claim from this host was corroborated by first-party results, and name them.
- Demotion is allowed (append a lower rung with the reason).
- `by` is stamped from the surface (like `ost_flag_humans_required`), not
  self-reported.

Hosts are normalized (lowercase hostname, `www.` stripped, no scheme/port/
path); lookup is exact-match only — trust for `github.io` must not leak to
`foo.github.io`.

### The lookup budget

`src/web/budget.ts`: a counter shared by `ost_search_web` and `ost_read_web`,
created once per `PassContext` (so: per MCP server session, per pass).
Default `DEFAULT_LOOKUP_BUDGET = 10`, configurable as `web.lookupBudget`.
Exhaustion is **not an error**: the tool returns an instructive message —
budget spent; work from what you already read, cite it, or record the open
question on the tree (`ost_annotate` / a node) so the next session picks it
up. That keeps "look it up" cheap to start and expensive to binge.

### Trust plumbed into the ladder

`classifyProvenance(source, opts?)` gains a `WEB:<host>` branch: it returns
`expert` only when the trust map holds exactly that earned rung for the host;
any other value — including a malformed record claiming `money` — falls to
the floor. Existing call sites are untouched (the second argument is optional and
the default stays fail-closed).

This closes the loop the product needs: a claim read on the web lands at
`assertion`; the agent turns it into a Solution/AssumptionTest; a first-party
test moves the *node* up the ladder via `ost_set_evidence` (existing); and the
*publisher* can then be promoted to `expert` via `ost_rank_source` with the
corroborating result named — so the next claim from that source starts
stronger. Commissioning *new* sensing systems needs no new machinery: a
proposed sensor is a Solution node on the tree like any other idea, and this
trust file is the substrate it reports into.

### Context and config

- `ToolContext`/`PassContext` gain `web?: { searchApiKey?, fetchFn?, budget }`
  and `productRepos?: string[]`; `buildPassContext` fills them from env/config.
- Config schema adds `web: { lookupBudget }` and `product: { repos }`, both
  optional with safe defaults (budget 10, no repos).

### Security posture (unchanged invariants)

Read-only by construction (GET + local reads); no shell, no write, no
delete. `assertNoDestructiveTool` still passes over the grown allowlist.
Credentials never appear in results, errors, or the vault. All fetched text
is data, never instructions. Usage tracing records sizes, not content.

## Testing

Vitest, mirrored layout, no network: `test/web/guard.test.ts`,
`reader.test.ts`, `search.test.ts`, `budget.test.ts`,
`test/product/repo.test.ts`, `test/knowledge/web-trust.test.ts`, plus
believability `WEB:` cases, policy-count updates (11 → 15 allowed tools; MCP
surface 9 → 13), an MCP round-trip for one new tool, and skill-drift
regeneration.

## Collision note

The `sql-evidence-reads` branch (in `.worktrees/`) edits the same gates
(`policy.ts`, `tools.ts`, `server.ts`, `context.ts`, `types.ts`, count
tests). Whichever lands second takes a small, mechanical merge conflict on
those lines. Sequenced deliberately; not avoidable if both features exist.
