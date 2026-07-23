# OST-Agent MCP Server — Design

- **Date:** 2026-07-23
- **Status:** Draft for review
- **Author:** Tanner Roberts (with Claude)
- **Depends on:** [`2026-07-22-ost-agent-design.md`](./2026-07-22-ost-agent-design.md)

## 1. Summary

Add an `ost-agent mcp` subcommand that runs a **stdio MCP server** exposing the
existing append-only OST tools. This inverts control relative to the shipped
`run`/`schedule` path: instead of the Node process owning the agent loop and
calling the model itself (`new Anthropic()` → tool runner, which requires
`ANTHROPIC_API_KEY`), the *thinking* moves to whatever Claude Code session
connects to the server. The server executes only safe, append-only tools and
commits the result. There is **no model and no API key inside the server.**

This is the "Model B" execution mode: driving the tree becomes as low-friction as
running a skill, because the compute is the operator's already-authenticated
Claude Code session (interactive, or a scheduled/headless `claude -p` run). The
`src/runner/tool.ts` docstring already names this surface: *"the exact surface an
`ost-agent mcp` server would expose."* This spec builds it.

## 2. Goals and non-goals

### Goals
- New subcommand `ost-agent mcp --vault <dir>` that speaks MCP over stdio.
- Reuse the existing safe tool layer (`buildOstTools`) verbatim — no schema
  rewrite, no second source of truth for tool definitions.
- Preserve every safety invariant of the shipped system: append-only, allowlist,
  fail-closed guard, git-forward-only, confinement to one vault.
- Operate with **zero `ANTHROPIC_API_KEY`** — the server calls no model.
- Every mutating tool call produces exactly one new git commit (auto-commit per
  write), so the "every change is a revertible commit" promise holds without a
  pass boundary.
- Registerable in Claude Code via `claude mcp add`, surfacing tools as
  `mcp__ost-agent__ost_*`.

### Non-goals
- No model, no ideation logic in the server. Reasoning lives in the connecting
  session (a future skill packages the `registry.ts` process prompts; out of
  scope here).
- No bootstrap. The server does not create the Outcome or `init` a vault — the
  outcome stays human-set.
- No `git_commit` / `git_push` tool exposed to the caller. Commits are internal;
  remote push is out of scope for this prototype.
- No impact-ranking / prioritization process (a separate future addition).
- No solving of cross-process git contention (see §8 limitation).

## 3. Architecture

```
Claude Code session  ──stdio(JSON-RPC)──▶  ost-agent mcp server  ──▶  Vault (git)
  (the "intelligence",                       (protocol shell +          append-only
   no API key needed)                         auto-commit wrapper)       .md nodes
                                                    │
                                                    └── buildOstTools() ── the SAME
                                                        allowlisted, append-only
                                                        tool objects used by run/schedule
```

The server is a thin protocol shell over the existing tool layer plus a
commit-per-write wrapper. Chosen approach (of three considered): **low-level MCP
`Server` + request handlers, reusing the built tools' `input_schema` and `run`
directly.** Rejected: high-level `McpServer.registerTool` (would duplicate every
schema in Zod, causing drift); shelling out to `ost-agent tool` per call (process
spawn per call, awkward commit serialization).

## 4. Components

New directory `src/mcp/`:

- **`src/mcp/server.ts`** — `createOstMcpServer(ctx): Server`. Builds the MCP
  `Server`, registers a `ListTools` handler and a `CallTool` handler over
  `buildOstTools(ctx, MCP_TOOL_NAMES)`. Returns the server unconnected, so tests
  can attach an in-memory transport and production can attach stdio. Depends on:
  `@modelcontextprotocol/sdk`, `security/tools.ts`, `security/policy.ts`,
  `mcp/commit.ts`.
- **`src/mcp/commit.ts`** — a serialized commit queue: `enqueueCommit(dir, msg)`
  that chains on a module-level promise so concurrent `CallTool` handlers cannot
  race the git index. Wraps `git/safe-git.ts#gitCommit`. Depends on:
  `git/safe-git.ts`.
- **`src/cli/index.ts`** — add the `mcp` command: build the pass context, run the
  startup guard (§7), create the server, connect `StdioServerTransport`, and keep
  the process alive until stdin closes.
- **`package.json`** — add dependency `@modelcontextprotocol/sdk`.

`MCP_TOOL_NAMES` is defined in `src/mcp/server.ts` as the six non-git tools:
`["ost_read_tree", "ost_create_node", "ost_append_to_node", "ost_link_nodes",
"ost_set_status", "ost_annotate"]`.

## 5. Tool surface

Six tools, mapped straight from `buildOstTools(ctx, MCP_TOOL_NAMES)`:

| Tool | Kind | Commits? |
|---|---|---|
| `ost_read_tree` | read-only | no |
| `ost_create_node` | mutating | yes |
| `ost_append_to_node` | mutating | yes |
| `ost_link_nodes` | mutating | yes |
| `ost_set_status` | mutating | yes |
| `ost_annotate` | mutating | yes |

`git_commit` / `git_push` are **not** exposed — the caller never holds a git tool,
yet every change is still a commit. Each built tool's `input_schema` (JSON Schema,
per `betaTool`) maps directly to the MCP tool's `inputSchema`; its `run` handler is
invoked with the raw call arguments.

## 6. Data flow (one `CallTool`)

1. `assertNoDestructiveTool([name])` — fail-closed; a name off the allowlist is
   rejected before any work.
2. Look up the tool in the built set; unknown name → MCP error result.
3. `const out = await tool.run(args)` — the real append-only operation.
4. If `name` is a mutating tool: `await enqueueCommit(dir, "mcp: <name> — <detail>")`.
   Read-only (`ost_read_tree`) skips the commit.
5. Return MCP text content: the tool's string result, plus `{ committed, sha }`
   when a commit fired.

A `run()` that throws (bad hierarchy, missing parent, etc.) is caught and returned
as an MCP `isError` result — the session reads the message and self-corrects. No
commit fires on a failed write, and the tools are single-node append operations, so
nothing partial is left behind.

## 7. Startup guard

`ost-agent mcp` refuses to start unless the vault:
1. exists as a directory,
2. is a git repository (`.git` present),
3. contains at least one node whose layer is `Outcome` — checked via
   `ctx.vault.readTree().some(n => n.layer === "Outcome")`.

Otherwise it exits non-zero with a message pointing at `ost-agent init` /
`ost-agent set-outcome`. Rationale: the outcome is human-set; the server maintains
the tree, it does not bootstrap one.

## 8. Error handling & concurrency

- **Per-call errors** never crash the server — they become MCP `isError` results.
- **Commit serialization**: `enqueueCommit` chains commits on a single promise so
  `git` commits never run concurrently (which would race on `.git/index.lock` and
  throw). Sequential tool calls each get their own commit; under a concurrent burst,
  writes already on disk when a commit fires are folded into it — still committed,
  still revertible, nothing lost.
- **Vault binding**: the server binds to one vault at launch (`--vault`, env
  fallback `OST_VAULT`); there is no per-call vault path, so a prompt-injected call
  cannot retarget an arbitrary directory. Confinement is preserved.
- **Known limitation (documented, not solved here)**: multiple *separate* server
  processes pointed at the same vault can still race on the git index. Guidance:
  run one server per vault (fits the one-founder-one-OST model). A future revision
  could add a lockfile.

## 9. Testing

Uses the MCP SDK's `InMemoryTransport.createLinkedPair()` so tests exercise the
real protocol without a subprocess:

1. **Surface**: client `ListTools` returns exactly the six OST tools; asserts
   `git_commit`/`git_push` are absent.
2. **Create + commit**: `CallTool ost_create_node` against a temp `init`-ed vault →
   the node `.md` exists **and** `git log` gained exactly one commit. This is the
   no-API-key path, asserted directly.
3. **Read-only**: `ost_read_tree` produces no new commit.
4. **Hierarchy violation**: creating a `Solution` under the `Outcome` → `isError`,
   tree unchanged.
5. **Startup guard**: constructing/guarding against a non-initialized dir throws.
6. **Poisoned-input parity**: a `CallTool` for a fabricated destructive tool name is
   rejected by the allowlist (mirrors the existing safety test).

All run offline with `ANTHROPIC_API_KEY` unset.

## 10. Live wire-up (the "done" bar)

1. **Automated no-key proof**: a throwaway MCP client script drives the built stdio
   server with `ANTHROPIC_API_KEY` explicitly unset — creates a node, prints the
   commit sha. Demonstrates Model B end-to-end with zero key.
2. **Register in Claude Code** against a *throwaway* vault (not the operator's real
   Obsidian vault):
   ```
   claude mcp add ost-agent -- node <abs>/dist/cli/index.js mcp --vault <abs-vault>
   ```
   The tools appear in a session as `mcp__ost-agent__ost_*`.
3. **Honest caveat**: a *running* session picks up a newly-added MCP server only
   after reload, so live in-session confirmation happens in a fresh session; the
   automated client script (step 1) is the reload-independent proof.

## 11. Out of scope / future work

- A **skill** packaging the `registry.ts` process prompts so a session runs the
  full P2/P3/P4/P5 discovery loop against these tools.
- **Impact ranking / prioritization** process and tool.
- **`git_push`** exposure / remote sync for the MCP path.
- **Cross-process git locking** for multi-server setups.
- **Write-back tools for peer coding agents** already work via `ost_create_node` /
  `ost_append_to_node`; a dedicated convenience tool is deferred.
