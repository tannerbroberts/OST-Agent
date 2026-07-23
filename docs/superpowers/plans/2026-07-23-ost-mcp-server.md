# OST-Agent MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `ost-agent mcp` stdio server that exposes the six append-only OST tools to any connecting Claude Code session, auto-committing each write, with no model and no API key inside the server.

**Architecture:** A thin MCP protocol shell over the existing `buildOstTools` layer. The connecting session supplies the reasoning; the server executes only allowlisted append-only tools and commits per write via a serialized queue. Reuses the safe tool layer verbatim (no schema rewrite) — this is the "Model B" seam already named in `src/runner/tool.ts`.

**Tech Stack:** TypeScript (ESM, strict), Node ≥20, `@modelcontextprotocol/sdk` (new), `simple-git` (existing), `vitest`. Spec: `docs/superpowers/specs/2026-07-23-ost-mcp-server-design.md`.

## Global Constraints

- **ESM with explicit `.js` import extensions** — the repo is `"type": "module"`; every relative import ends in `.js` even though the source is `.ts`.
- **Node ≥20** (`package.json` engines).
- **No destructive tool is ever exposed.** The MCP surface is exactly the six non-git OST tools; `git_commit`/`git_push` are NOT exposed.
- **Auto-commit per write** — every mutating tool call is followed by exactly one commit; `ost_read_tree` never commits.
- **Single-vault binding** — the server binds to one vault at launch (`--vault`, env fallback `OST_VAULT`); there is no per-call vault path.
- **stdio hygiene** — on the stdio transport, stdout is the JSON-RPC channel. All human-facing logging MUST use `console.error` (stderr), never `console.log`.
- **Startup guard** — refuse to serve a vault with no git repo or no `Outcome` node; never bootstrap.
- Follow existing patterns: temp-vault tests via `fs.mkdtempSync` + `initVault(dir, outcome, title)` (see `test/runner/tool.test.ts`).

---

### Task 1: Serialized commit queue

**Files:**
- Create: `src/mcp/commit.ts`
- Test: `test/mcp/commit.test.ts`

**Interfaces:**
- Consumes: `gitCommit(dir: string, message: string): Promise<CommitResult>` and `type CommitResult = { sha: string; committed: boolean }` from `src/git/safe-git.ts`.
- Produces: `enqueueCommit(dir: string, message: string): Promise<CommitResult>` — commits are chained so concurrent callers never interleave `git add -A` + `commit`; a rejecting commit does not wedge the chain.

- [ ] **Step 1: Write the failing test**

```typescript
// test/mcp/commit.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { simpleGit } from "simple-git";
import { initVault } from "../../src/runner/init.js";
import { enqueueCommit } from "../../src/mcp/commit.js";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-commitq-"));
  await initVault(dir, "Reach 10,000 daily active users", "Retention");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("enqueueCommit", () => {
  test("serializes concurrent commits into ordered, separate commits", async () => {
    const before = (await simpleGit(dir).log()).total;
    // two writes + two commits fired without awaiting between them
    fs.writeFileSync(path.join(dir, "a.md"), "---\ntype: Opportunity\n---\nA\n");
    const p1 = enqueueCommit(dir, "mcp: first");
    fs.writeFileSync(path.join(dir, "b.md"), "---\ntype: Opportunity\n---\nB\n");
    const p2 = enqueueCommit(dir, "mcp: second");
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.committed).toBe(true);
    expect(r2.committed).toBe(true);
    // exactly two new commits, no index race
    expect((await simpleGit(dir).log()).total).toBe(before + 2);
  });

  test("a clean-tree commit reports committed:false without wedging later commits", async () => {
    const r1 = await enqueueCommit(dir, "mcp: nothing to commit"); // clean tree
    expect(r1.committed).toBe(false);
    fs.writeFileSync(path.join(dir, "c.md"), "---\ntype: Opportunity\n---\nC\n");
    const r2 = await enqueueCommit(dir, "mcp: after clean");
    expect(r2.committed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mcp/commit.test.ts`
Expected: FAIL — `Cannot find module '../../src/mcp/commit.js'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/mcp/commit.ts
/**
 * Serialized commit queue. Auto-commit-per-write means multiple CallTool
 * handlers may fire near-simultaneously; chaining every commit on one promise
 * guarantees `git add -A` + `commit` never interleave (which could otherwise
 * sweep one write's files into another write's commit). A rejected commit is
 * swallowed on the chain so a single failure cannot wedge all later commits.
 */
import { gitCommit, type CommitResult } from "../git/safe-git.js";

let chain: Promise<unknown> = Promise.resolve();

export function enqueueCommit(dir: string, message: string): Promise<CommitResult> {
  const next = chain.then(() => gitCommit(dir, message));
  chain = next.catch(() => undefined);
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mcp/commit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/commit.ts test/mcp/commit.test.ts
git commit -m "feat(mcp): serialized commit queue for auto-commit-per-write"
```

---

### Task 2: MCP server factory + startup guard

**Files:**
- Create: `src/mcp/server.ts`
- Test: `test/mcp/server.test.ts`
- Modify: `package.json` (add `@modelcontextprotocol/sdk` dependency)

**Interfaces:**
- Consumes: `buildOstTools(ctx, allowedNames?)` and `type RemoteConfig` from `src/security/tools.ts`; `assertNoDestructiveTool(names)` from `src/security/policy.ts`; `type PassContext` from `src/processes/types.ts`; `enqueueCommit` from `src/mcp/commit.ts` (Task 1); `VERSION` from `src/index.ts`. Each built tool object exposes `{ name, description, input_schema, run }` (per `betaTool`).
- Produces:
  - `MCP_TOOL_NAMES: readonly string[]` — the six exposed tool names.
  - `assertVaultReady(ctx: PassContext): void` — throws unless `.git` exists and the tree has an `Outcome` node.
  - `createOstMcpServer(ctx: PassContext): Server` — an unconnected MCP `Server` with `ListTools` + `CallTool` handlers; caller attaches a transport.

- [ ] **Step 1: Install the MCP SDK**

Run: `npm install @modelcontextprotocol/sdk`
Expected: `@modelcontextprotocol/sdk` (a 1.x version) added to `dependencies` in `package.json`; `package-lock.json` updated.

- [ ] **Step 2: Write the failing test**

```typescript
// test/mcp/server.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { simpleGit } from "simple-git";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { createOstMcpServer, assertVaultReady, MCP_TOOL_NAMES } from "../../src/mcp/server.js";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-mcp-"));
  await initVault(dir, "Reach 10,000 daily active users", "Retention");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function connect(vaultDir: string): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createOstMcpServer(buildPassContext(vaultDir));
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

// result content is [{ type: "text", text }]; helper reads the first text block
function textOf(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content.map((c) => c.text ?? "").join("\n");
}

describe("createOstMcpServer", () => {
  test("exposes exactly the six OST tools and no git tools", async () => {
    const client = await connect(dir);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...MCP_TOOL_NAMES].sort());
    expect(names).not.toContain("git_commit");
    expect(names).not.toContain("git_push");
  });

  test("creating a node writes the file AND makes exactly one commit (no API key)", async () => {
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    const client = await connect(dir);
    const before = (await simpleGit(dir).log()).total;
    const res = await client.callTool({
      name: "ost_create_node",
      arguments: {
        title: "I want a reason to come back every day",
        layer: "Opportunity",
        parent: "Retention",
        body: "Players want a daily reason to return.",
        source: "INBOX:x",
      },
    });
    expect(res.isError).toBeFalsy();
    expect(textOf(res as never)).toMatch(/committed [0-9a-f]{8}/);
    expect(buildPassContext(dir).vault.has("I want a reason to come back every day")).toBe(true);
    expect((await simpleGit(dir).log()).total).toBe(before + 1);
  });

  test("ost_read_tree makes no commit", async () => {
    const client = await connect(dir);
    const before = (await simpleGit(dir).log()).total;
    const res = await client.callTool({ name: "ost_read_tree", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect((await simpleGit(dir).log()).total).toBe(before);
  });

  test("a hierarchy violation is returned as an error and does not mutate the tree", async () => {
    const client = await connect(dir);
    const before = buildPassContext(dir).vault.readTree().length;
    const res = await client.callTool({
      name: "ost_create_node",
      arguments: { title: "S", layer: "Solution", parent: "Retention", body: "b" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res as never)).toMatch(/must attach under Opportunity/);
    expect(buildPassContext(dir).vault.readTree().length).toBe(before);
  });

  test("a call to a tool that is not on the surface is refused (no destructive tool reachable)", async () => {
    const client = await connect(dir);
    for (const bad of ["ost_delete_node", "bash", "git_push"]) {
      const res = await client.callTool({ name: bad, arguments: {} });
      expect(res.isError).toBe(true);
      expect(textOf(res as never)).toMatch(/unknown tool/);
    }
  });

  test("assertVaultReady throws when the vault has no Outcome node", () => {
    fs.rmSync(path.join(dir, "Retention.md")); // remove the only Outcome node
    expect(() => assertVaultReady(buildPassContext(dir))).toThrow(/no Outcome node/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/mcp/server.test.ts`
Expected: FAIL — `Cannot find module '../../src/mcp/server.js'`.

- [ ] **Step 4: Write minimal implementation**

```typescript
// src/mcp/server.ts
/**
 * Stdio-agnostic MCP server exposing the append-only OST tools.
 *
 * Holds NO model and NO API key: the connecting Claude Code session supplies
 * the reasoning, this server only executes allowlisted append-only tools and
 * commits each write. Reuses buildOstTools verbatim, so the allowlist +
 * fail-closed guard remain the single source of truth for what is callable.
 */
import fs from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildOstTools } from "../security/tools.js";
import { assertNoDestructiveTool } from "../security/policy.js";
import type { PassContext } from "../processes/types.js";
import { enqueueCommit } from "./commit.js";
import { VERSION } from "../index.js";

export const MCP_TOOL_NAMES = [
  "ost_read_tree",
  "ost_create_node",
  "ost_append_to_node",
  "ost_link_nodes",
  "ost_set_status",
  "ost_annotate",
] as const;

const MUTATING = new Set<string>([
  "ost_create_node",
  "ost_append_to_node",
  "ost_link_nodes",
  "ost_set_status",
  "ost_annotate",
]);

/** Throw unless the vault is initialized: a git repo with an Outcome node. */
export function assertVaultReady(ctx: PassContext): void {
  if (!fs.existsSync(path.join(ctx.dir, ".git"))) {
    throw new Error(`vault at ${ctx.dir} is not a git repository — run \`ost-agent init\` first`);
  }
  if (!ctx.vault.readTree().some((n) => n.layer === "Outcome")) {
    throw new Error(
      `vault at ${ctx.dir} has no Outcome node — run \`ost-agent init\` / \`ost-agent set-outcome\` first. ` +
        `The MCP server maintains an existing tree; it does not bootstrap one.`,
    );
  }
}

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (input: unknown) => Promise<unknown>;
}

export function createOstMcpServer(ctx: PassContext): Server {
  const built = buildOstTools({ vault: ctx.vault, dir: ctx.dir, remote: ctx.remote }, MCP_TOOL_NAMES);
  assertNoDestructiveTool(built.map((t) => t.name)); // belt-and-suspenders, fail-closed

  const defs: McpToolDef[] = built.map((t) => {
    const raw = t as unknown as {
      name: string;
      description: string;
      input_schema: Record<string, unknown>;
      run: (i: unknown) => Promise<unknown>;
    };
    return { name: raw.name, description: raw.description, inputSchema: raw.input_schema, run: (i) => raw.run(i) };
  });
  const byName = new Map(defs.map((d) => [d.name, d]));

  const server = new Server({ name: "ost-agent", version: VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: defs.map((d) => ({ name: d.name, description: d.description, inputSchema: d.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = req.params.arguments ?? {};
    const tool = byName.get(name);
    if (!tool) {
      return { content: [{ type: "text", text: `unknown tool "${name}" — not on the OST surface` }], isError: true };
    }
    try {
      const out = await tool.run(args);
      let text = typeof out === "string" ? out : JSON.stringify(out);
      if (MUTATING.has(name)) {
        const commit = await enqueueCommit(ctx.dir, `mcp: ${name}`);
        text += commit.committed ? `\ncommitted ${commit.sha.slice(0, 8)}` : `\n(no changes to commit)`;
      }
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  });

  return server;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/mcp/server.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Full suite still green**

Run: `npm test`
Expected: all prior tests + the new mcp tests PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/mcp/server.ts test/mcp/server.test.ts
git commit -m "feat(mcp): server factory exposing six append-only OST tools + startup guard"
```

---

### Task 3: `ost-agent mcp` CLI command + stdio end-to-end proof

**Files:**
- Modify: `src/cli/index.ts` (add the `mcp` command; new imports)
- Test: `test/mcp/stdio.test.ts`

**Interfaces:**
- Consumes: `buildPassContext` (`src/runner/context.js`), `createOstMcpServer` + `assertVaultReady` + `MCP_TOOL_NAMES` (`src/mcp/server.js`), `StdioServerTransport` (`@modelcontextprotocol/sdk/server/stdio.js`).
- Produces: the `ost-agent mcp --vault <dir>` command. Bootstraps a stdio MCP server; guard failures print to stderr and exit non-zero.

- [ ] **Step 1: Write the failing test**

This spawns the real CLI over stdio with `ANTHROPIC_API_KEY` removed from the child env, proving no-key operation through the actual transport. Runs via `tsx` (a devDependency), so no build step is needed.

```typescript
// test/mcp/stdio.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { initVault } from "../../src/runner/init.js";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-mcp-stdio-"));
  await initVault(dir, "Reach 10,000 daily active users", "Retention");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("ost-agent mcp (stdio, no API key)", () => {
  test("spawns, lists tools, and creates a node over real stdio", async () => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "ANTHROPIC_API_KEY" && v !== undefined) env[k] = v;
    }
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/cli/index.ts", "mcp", "--vault", dir],
      env,
    });
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("ost_create_node");
      const res = await client.callTool({
        name: "ost_create_node",
        arguments: { title: "Daily streak", layer: "Opportunity", parent: "Retention", body: "b", source: "INBOX:y" },
      });
      expect(res.isError).toBeFalsy();
    } finally {
      await client.close();
    }
    // the write landed and was committed by the server process
    expect(fs.existsSync(path.join(dir, "Daily streak.md"))).toBe(true);
  }, 30_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mcp/stdio.test.ts`
Expected: FAIL — the `mcp` command does not exist, so the child exits and `client.connect` rejects.

- [ ] **Step 3: Add the imports to `src/cli/index.ts`**

Add these alongside the existing imports near the top of `src/cli/index.ts`:

```typescript
import { createOstMcpServer, assertVaultReady, MCP_TOOL_NAMES } from "../mcp/server.js";
```

- [ ] **Step 4: Add the `mcp` command**

Insert this block after the `status` command and before the `schedule` command in `src/cli/index.ts`:

```typescript
program
  .command("mcp")
  .description("run a stdio MCP server exposing the append-only OST tools (no API key needed)")
  .option("--vault <dir>", "vault directory", process.env.OST_VAULT ?? ".")
  .action(async (opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    assertVaultReady(ctx);
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const server = createOstMcpServer(ctx);
    await server.connect(new StdioServerTransport());
    // stdout is the JSON-RPC channel — log only to stderr.
    console.error(`ost-agent mcp serving ${ctx.dir} over stdio. Tools: ${MCP_TOOL_NAMES.join(", ")}`);
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/mcp/stdio.test.ts`
Expected: PASS (1 test). If it times out, confirm `npx tsx src/cli/index.ts mcp --vault <a-temp-initialized-vault>` starts and prints the stderr banner.

- [ ] **Step 6: Full suite green + typecheck**

Run: `npm test && npm run build`
Expected: all tests PASS; `tsc` emits `dist/` with no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/cli/index.ts test/mcp/stdio.test.ts
git commit -m "feat(mcp): ost-agent mcp stdio command + no-API-key e2e test"
```

---

### Task 4: Live wire-up into Claude Code + README

**Files:**
- Modify: `README.md` (document the `mcp` command and Model-B usage)

**Interfaces:**
- Consumes: the built `dist/cli/index.js` from Task 3 (`npm run build`).
- Produces: a registered `ost-agent` MCP server in the operator's Claude Code config (against a throwaway vault) and README docs. No new source.

- [ ] **Step 1: Build and prepare a throwaway vault**

```bash
npm run build
node dist/cli/index.js init /private/tmp/claude-502/-Users-tannerbrobers-Documents-Obsidian-Vault-Discovery-OST-Agent/166bae97-8a6e-4357-b03c-acc79bd54052/scratchpad/ost-mcp-demo \
  --outcome "Demo: prove the MCP path works with no API key" --title "MCPDemo"
```
Expected: `Initialized vault at …/ost-mcp-demo` with git + an Outcome node.

- [ ] **Step 2: Register the server in Claude Code**

```bash
claude mcp add ost-agent -- node "$(pwd)/dist/cli/index.js" mcp --vault \
  /private/tmp/claude-502/-Users-tannerbrobers-Documents-Obsidian-Vault-Discovery-OST-Agent/166bae97-8a6e-4357-b03c-acc79bd54052/scratchpad/ost-mcp-demo
claude mcp list
```
Expected: `ost-agent` appears in `claude mcp list`. (This edits the operator's `~/.claude` config — expected and approved.)

- [ ] **Step 3: Confirm the no-key path once more via stdio**

The Task 3 stdio test already proves create-over-stdio with `ANTHROPIC_API_KEY` unset. Re-run it as the acceptance check:

Run: `npx vitest run test/mcp/stdio.test.ts`
Expected: PASS — a node is created and committed by a server process that never held an API key.

- [ ] **Step 4: Document in README**

Add a subsection under "How it runs" (after the `Quickstart` block) in `README.md`:

```markdown
### Drive it from a Claude Code session (no API key)

Besides the standalone `run`/`schedule` path (which calls Claude directly and needs
`ANTHROPIC_API_KEY`), OST-Agent can run as an **MCP server** whose *reasoning* is
supplied by your existing Claude Code session — so no separate API key is needed,
just like running a skill.

```bash
ost-agent init ./discovery-vault --outcome "…"   # one-time; sets the human Outcome
claude mcp add ost-agent -- ost-agent mcp --vault ./discovery-vault
```

The six append-only tools then appear in any session as
`mcp__ost-agent__ost_create_node`, `…_ost_append_to_node`, `…_ost_read_tree`, etc.
Every write is auto-committed; no `git`, delete, or shell tool is ever exposed, so a
prompt-injected instruction still maps to no dangerous tool. The server refuses to
start on a vault that has no human-set Outcome — it maintains a tree, it never
bootstraps one. A newly added MCP server is picked up on the next session start.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(mcp): document the no-API-key MCP (Model B) usage path"
```

---

## Self-Review

**1. Spec coverage** (against `2026-07-23-ost-mcp-server-design.md`):
- §3 architecture / control inversion → Task 2 (`createOstMcpServer`, no model) + Task 3 (CLI).
- §4 components: `mcp/server.ts` → Task 2; `mcp/commit.ts` → Task 1; CLI command → Task 3; `package.json` dep → Task 2 Step 1. ✓
- §5 tool surface (six tools, no git tools) → Task 2 test "exposes exactly the six". ✓
- §6 data flow (guard → run → commit-if-mutating → text result; errors as isError) → Task 2 impl + tests. ✓
- §7 startup guard (git repo + Outcome) → `assertVaultReady` (Task 2) + Task 3 CLI wiring. ✓
- §8 concurrency (serialized commits, single-vault binding, no per-call path) → Task 1 + `--vault`/`OST_VAULT` in Task 3. ✓
- §9 testing (in-memory transport, no-key proof, hierarchy error, guard, poisoned parity) → Task 2 tests. ✓
- §10 live wire-up (no-key stdio proof + `claude mcp add` + reload caveat) → Task 3 + Task 4. ✓
- §11 out of scope → nothing built here; confirmed absent. ✓

**2. Placeholder scan:** No TBD/TODO; every code and command step is complete. Concrete throwaway-vault path uses the session scratchpad. ✓

**3. Type consistency:** `enqueueCommit(dir, message): Promise<CommitResult>` defined in Task 1, consumed in Task 2. `createOstMcpServer`/`assertVaultReady`/`MCP_TOOL_NAMES` defined in Task 2, consumed in Task 3. Built-tool shape `{ name, description, input_schema, run }` matches `betaTool`'s return. `initVault(dir, outcome, title)` and Outcome title `"Retention"` consistent across all test setups. ✓
