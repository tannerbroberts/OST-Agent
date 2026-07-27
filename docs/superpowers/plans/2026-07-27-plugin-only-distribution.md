# Plugin-Only Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Claude Code plugin the only way to run OST-Agent — no npm package, no API-key runner, no code path that calls a model.

**Architecture:** The plugin stops launching its MCP server through `npx` and instead runs a committed single-file esbuild bundle with `node`. Everything that calls the Anthropic SDK is deleted; the deterministic analysis commands that survive are promoted from CLI-plus-`Bash`-grant to first-class read-only MCP tools. A CI drift guard keeps the committed bundle honest.

**Tech Stack:** TypeScript (ESM, Node >=20), `@modelcontextprotocol/sdk`, `commander`, `zod` v3, `vitest`, `esbuild` (new), `gray-matter`, `yaml`, `simple-git`.

**Spec:** `docs/superpowers/specs/2026-07-27-plugin-only-distribution-design.md`

## Global Constraints

- Node >=20. Bundle target is `node20`, format `esm`.
- No new runtime dependencies. `esbuild` is a devDependency only.
- After Task 6, `grep -rn "@anthropic-ai/sdk\|ANTHROPIC_API_KEY" src/` must return nothing.
- The vault is append-only. No task may add a delete, edit, or shell tool, and `assertNoDestructiveTool` stays in the call path on every surface.
- Tool wording is single-sourced. Where CLI and MCP surface the same text, exactly one function produces it (`src/mcp/server.ts` already states this principle for `ost_next_work`).
- Run tests with `npx vitest run <path>`. Full suite: `npm test`.
- Commit after every task. Never use `git add -A`; name the paths.

---

## File Structure

**New files:**

| Path | Responsibility |
| --- | --- |
| `src/security/tool.ts` | Local `tool()` helper replacing the SDK's `betaTool` |
| `src/eval/render.ts` | Pure renderers for `check`/`debt`/`status`/`gate` (moves to `src/analysis/` in Task 10) |
| `test/mcp/tool-input-validation.test.ts` | The MCP surface refuses input its schema rejects |
| `test/mcp/analysis-tools.test.ts` | The four promoted tools exist, are read-only, match CLI text |
| `test/release/bundle.test.ts` | Plugin manifest references no `npx`; bundle entry exists |
| `.github/workflows/ci.yml` | Test + bundle drift guard |

**Deleted files:** listed per task; the full set is in the spec's Phase 2 table.

**Heavily modified:** `src/mcp/server.ts` (validation + four tools), `src/cli/index.ts` (four commands removed, four rewired to renderers), `src/security/tools.ts` (import swap only), `package.json`, `.claude-plugin/plugin.json`, `.gitignore`, `vitest.config.ts`.

---

### Task 1: Archive the npm tarballs before anything is deleted

npm has `0.20.0`, `0.21.0`, and `0.22.0`. Git's tags stop at `v0.19.1` and no branch carries those versions. These tarballs are the only copy of that source. This task must complete before Task 9 unpublishes.

**Files:**
- Create: `docs/npm-archive.md`

- [ ] **Step 1: Download the three tarballs**

```bash
mkdir -p /tmp/ost-npm-archive && cd /tmp/ost-npm-archive
npm pack ost-agent@0.20.0 ost-agent@0.21.0 ost-agent@0.22.0
ls -la
```

Expected: three files, `ost-agent-0.20.0.tgz`, `ost-agent-0.21.0.tgz`, `ost-agent-0.22.0.tgz`. `npm pack` of a published version needs no auth.

- [ ] **Step 2: Verify each tarball is non-empty and contains dist**

```bash
for v in 0.20.0 0.21.0 0.22.0; do
  echo "=== $v ==="
  tar -tzf /tmp/ost-npm-archive/ost-agent-$v.tgz | head -5
done
```

Expected: each lists `package/package.json` and `package/dist/...` entries. If any tarball is missing or empty, STOP and report — do not proceed to Task 9.

- [ ] **Step 3: Attach them to a GitHub release**

```bash
cd /Users/tanner/dev/OST-Agent
gh release create npm-archive \
  --title "npm archive: 0.20.0–0.22.0" \
  --notes "Source for the three npm releases that were never tagged in git. Preserved before \`npm unpublish\`. Not a distribution channel." \
  /tmp/ost-npm-archive/ost-agent-0.20.0.tgz \
  /tmp/ost-npm-archive/ost-agent-0.21.0.tgz \
  /tmp/ost-npm-archive/ost-agent-0.22.0.tgz
```

If `gh` is not authenticated, STOP and ask the maintainer to run `gh auth login`.

- [ ] **Step 4: Verify the release exists with all three assets**

```bash
gh release view npm-archive --json assets --jq '.assets[].name'
```

Expected: exactly the three `.tgz` names.

- [ ] **Step 5: Record the archive so Task 9 can check it**

Create `docs/npm-archive.md`:

```markdown
# npm archive

`ost-agent` published 0.20.0, 0.21.0, and 0.22.0 to npm. Git was never tagged
at those versions and no branch carries them, so the registry tarballs were the
only copy of that source.

They are preserved as assets on the `npm-archive` GitHub release, downloaded
with `npm pack` before `npm unpublish` ran.

This is a safety net for source with no other copy. It is not a distribution
channel — OST-Agent installs only as a Claude Code plugin.
```

- [ ] **Step 6: Commit**

```bash
git add docs/npm-archive.md
git commit -m "docs: preserve the three untagged npm releases before unpublishing

npm had 0.20.0, 0.21.0 and 0.22.0 under latest. Tags stop at v0.19.1 and no
branch carries those versions, so the registry tarballs were the only copy of
that source. Archived to the npm-archive release first; unpublishing is gated
on this."
```

---

### Task 2: Validate tool input on the MCP surface

**This is a safety regression guard, not a refactor.** `validateToolInput` exists and is called only from `src/runner/tool.ts`. `handleOstCall` in `src/mcp/server.ts` calls `tool.run(args)` with no schema check, so the bug documented in `test/runner/tool-input-validation.test.ts` — `ost_annotate` given `note` instead of `issue`, permanently writing `"undefined"` into an append-only vault and reporting success — is still live on the MCP surface. Task 6 deletes `src/runner/tool.ts`, which would leave the validator with no caller at all.

**Files:**
- Create: `test/mcp/tool-input-validation.test.ts`
- Modify: `src/mcp/server.ts` (`handleOstCall`)

**Interfaces:**
- Consumes: `validateToolInput(schema: ToolSchema | undefined, input: unknown, path?: string): string[]` and `type ToolSchema` from `src/security/validateToolInput.ts`. Returns `[]` on pass; never throws.
- Produces: no new exports. `handleOstCall` gains a rejection branch returning `{ content: [{type:"text", text}], isError: true }`.

- [ ] **Step 1: Write the failing test**

Create `test/mcp/tool-input-validation.test.ts`:

```ts
/**
 * The MCP surface must refuse a call its own schema rejects.
 *
 * The CLI path (`runTool`) has validated since the `ost_annotate({note})`
 * incident, which appended the literal string "undefined" over an annotation,
 * permanently, and reported success. The MCP path — the only surface that
 * survives plugin-only distribution — never got the same guard.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { createLazyOstMcpServer } from "../../src/mcp/server.js";

let dir: string;
// initVault is async and positional: (dir, outcome, outcomeTitle?). The third
// argument is not optional in practice here — it defaults to the directory
// basename, which for a mkdtemp path is unpredictable, and these tests read the
// outcome node by filename.
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-mcp-validate-"));
  await initVault(dir, "Reach ten returning operators.", "Reach ten returning operators");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function connect(vaultDir: string): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createLazyOstMcpServer(vaultDir);
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

test("a misnamed property is refused, and nothing is written", async () => {
  const client = await connect(dir);
  const before = fs.readdirSync(dir);

  const res = (await client.callTool({
    name: "ost_annotate",
    // `note` is not in the schema; the declared property is `issue`.
    arguments: { title: "Reach ten returning operators", note: "a real observation" },
  })) as { isError?: boolean; content: Array<{ text: string }> };

  expect(res.isError).toBe(true);
  expect(res.content[0].text).toMatch(/invalid input for "ost_annotate"/);
  expect(res.content[0].text).toMatch(/issue/);
  // The refusal must say the vault was untouched, because a caller that
  // retries blind is how the original damage compounded.
  expect(res.content[0].text).toMatch(/Nothing was written/);

  const outcome = fs.readFileSync(path.join(dir, "Reach ten returning operators.md"), "utf8");
  expect(outcome).not.toMatch(/undefined/);
  expect(fs.readdirSync(dir).sort()).toEqual(before.sort());
});

test("a valid call still succeeds", async () => {
  const client = await connect(dir);
  const res = (await client.callTool({
    name: "ost_annotate",
    arguments: { title: "Reach ten returning operators", issue: "a real observation" },
  })) as { isError?: boolean; content: Array<{ text: string }> };

  expect(res.isError).toBeFalsy();
  const outcome = fs.readFileSync(path.join(dir, "Reach ten returning operators.md"), "utf8");
  expect(outcome).toMatch(/a real observation/);
});
```

- [ ] **Step 2: Run it and confirm the first test fails**

```bash
npx vitest run test/mcp/tool-input-validation.test.ts
```

Expected: `a misnamed property is refused` FAILS — `isError` is undefined and the outcome file contains `undefined`. The second test PASSES. If the first test passes, STOP: the premise is wrong, re-read `handleOstCall`.

- [ ] **Step 3: Add the guard to `handleOstCall`**

In `src/mcp/server.ts`, add the import:

```ts
import { validateToolInput, type ToolSchema } from "../security/validateToolInput.js";
```

In `handleOstCall`, after the `readiness` check and before `tool.run`:

```ts
  // The allowlist above says which tool may run; this says with what. Without
  // it a constructive tool is destructive in an append-only vault: `ost_annotate`
  // handed `note` instead of the declared `issue` read it as `undefined` and
  // wrote that string over the annotation, permanently, reporting success.
  // Wording matches the CLI refusal deliberately — one incident, one sentence.
  const problems = validateToolInput(tool.inputSchema as ToolSchema, args ?? {});
  if (problems.length > 0) {
    return {
      content: [
        {
          type: "text",
          text:
            `invalid input for "${name}":\n${problems.map((p) => `  - ${p}`).join("\n")}\n` +
            "Nothing was written. Fix the call and retry — this vault is append-only, so a bad write cannot be taken back.",
        },
      ],
      isError: true,
    };
  }
```

- [ ] **Step 4: Run the test and confirm both pass**

```bash
npx vitest run test/mcp/tool-input-validation.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Run the full suite for regressions**

```bash
npm test
```

Expected: all pass. A pre-existing test that called an MCP tool with sloppy arguments may now fail — that is the guard working; fix the test's arguments to match the declared schema, do not weaken the guard.

- [ ] **Step 6: Commit**

```bash
git add test/mcp/tool-input-validation.test.ts src/mcp/server.ts
git commit -m "fix(mcp): validate tool input on the surface that survives

validateToolInput had exactly one caller, runTool, on the CLI path. The MCP
server handed arguments straight to run — so the ost_annotate({note}) failure
that wrote the literal string \"undefined\" over an annotation, permanently,
and reported success was still live on the surface the plugin actually uses.

Plugin-only distribution deletes runTool. Without this the validator would
have had no caller at all, and 'incapable of destructive action by
construction' would have been a claim about the CLI we no longer ship."
```

---

### Task 3: Replace `betaTool` with a local helper

`src/security/tools.ts` imports `betaTool` from `@anthropic-ai/sdk` purely as a JSON-Schema wrapper. The SDK's implementation is nine lines: it checks `inputSchema.type === "object"` and returns `{type, name, input_schema, description, run, parse}`. Nothing in `src/` or `test/` reads `type` or `parse`. Its own header comment records that it chose raw JSON Schema over `betaZodTool` specifically to avoid dependency coupling — this finishes that.

**Files:**
- Create: `src/security/tool.ts`
- Modify: `src/security/tools.ts` (import line only), `vitest.config.ts`

**Interfaces:**
- Produces: `tool<I>(spec): OstToolDef` — accepts `{name, description, inputSchema, run}` and returns an object exposing `input_schema` (snake_case). `src/mcp/server.ts:buildDefs` and `src/runner/tool.ts` both read `input_schema`, so that field name is load-bearing.

- [ ] **Step 1: Write the failing test**

Create `test/security/tool-helper.test.ts`:

```ts
/**
 * The local tool() helper must be a drop-in for the SDK's betaTool: same
 * accepted shape, same `input_schema` output key that the MCP server and the
 * input validator both read.
 */
import { expect, test } from "vitest";
import { tool } from "../../src/security/tool.js";

test("normalises inputSchema to input_schema", () => {
  const t = tool({
    name: "ost_example",
    description: "d",
    inputSchema: { type: "object", properties: { a: { type: "string" } }, additionalProperties: false },
    run: async () => "ok",
  });
  expect(t.name).toBe("ost_example");
  expect(t.description).toBe("d");
  expect(t.input_schema).toEqual({
    type: "object",
    properties: { a: { type: "string" } },
    additionalProperties: false,
  });
});

test("runs the handler", async () => {
  const t = tool({
    name: "ost_example",
    description: "d",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => "ran",
  });
  expect(await t.run({})).toBe("ran");
});

test("refuses a non-object schema", () => {
  expect(() =>
    tool({ name: "bad", description: "d", inputSchema: { type: "string" }, run: async () => "" }),
  ).toThrow(/must be an object/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run test/security/tool-helper.test.ts
```

Expected: FAIL — cannot resolve `../../src/security/tool.js`.

- [ ] **Step 3: Write the helper**

Create `src/security/tool.ts`:

```ts
/**
 * The tool definition helper.
 *
 * Was `betaTool` from the Anthropic SDK, used purely as a raw-JSON-Schema
 * wrapper. tools.ts already chose raw JSON Schema over betaZodTool to avoid
 * coupling the tool surface to a dependency's versioning; now that no code
 * path calls a model, the SDK itself is that coupling, so the nine lines it
 * contributed live here instead.
 *
 * `input_schema` is snake_case on the way out because the MCP server and the
 * input validator both read that key.
 */

export interface ToolSpec<I> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown> & { type?: string };
  run: (input: I) => Promise<string | unknown> | string | unknown;
}

export interface OstToolDef<I = unknown> {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run: (input: I) => Promise<string | unknown> | string | unknown;
}

export function tool<I>(spec: ToolSpec<I>): OstToolDef<I> {
  if (spec.inputSchema.type !== "object") {
    throw new Error(
      `JSON schema for tool "${spec.name}" must be an object, but got ${spec.inputSchema.type}`,
    );
  }
  return {
    name: spec.name,
    description: spec.description,
    input_schema: spec.inputSchema,
    run: spec.run,
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run test/security/tool-helper.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Swap the import in `tools.ts`**

In `src/security/tools.ts`, replace line 12:

```ts
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
```

with:

```ts
import { tool as betaTool } from "./tool.js";
```

Aliasing to `betaTool` keeps this step a one-line diff across ~13 call sites. Rename the call sites to `tool(` in the same step only if `npx tsc --noEmit` stays clean; otherwise leave the alias and move on — the alias is not worth a broken build.

Also update the file's header comment, which currently names `betaTool`/`betaZodTool`:

```
 * Tools are defined with the local `tool()` helper (raw JSON Schema) rather
 * than a Zod-bound one, so the tool schemas do not couple us to a specific Zod
 * major version — or, since the runner was removed, to the Anthropic SDK.
```

- [ ] **Step 6: Drop the SDK alias from the vitest config**

In `vitest.config.ts`, delete the `sdkJsonSchemaHelper` constant, the `fileURLToPath`/`URL` import if now unused, and the whole `resolve.alias` block. The comment explaining the bare-wildcard export map goes with it. Result:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // git-subprocess + init tests are legitimately slow under parallel load
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
```

- [ ] **Step 7: Typecheck and run the full suite**

```bash
npx tsc --noEmit && npm test
```

Expected: clean typecheck, all tests pass. `src/security/tools.ts` no longer imports the SDK.

- [ ] **Step 8: Commit**

```bash
git add src/security/tool.ts test/security/tool-helper.test.ts src/security/tools.ts vitest.config.ts
git commit -m "refactor(security): own the tool() helper instead of borrowing betaTool

betaTool was nine lines of the Anthropic SDK used as a JSON Schema wrapper —
and the reason vitest needed a resolve alias for a deep .mjs path. tools.ts
already avoided betaZodTool to keep the tool surface uncoupled from a
dependency's versioning; with no code path calling a model, the SDK is that
coupling. The alias goes too."
```

---

### Task 4: Extract the four analysis commands into pure renderers

`check`, `debt`, `status`, and `gate` print prose that is deliberately worded — `debt` closes by explaining that it counts mechanically and never judges. That text must not fork between the CLI and the MCP tools, so both call one renderer.

**Files:**
- Create: `src/eval/render.ts`
- Modify: `src/cli/index.ts` (the four command bodies)
- Test: `test/eval/render.test.ts`

**Interfaces:**
- Consumes: `checkInvariants` (`src/eval/invariants.ts`), `computeEvidenceDebt`, `gateSolution` (`src/eval/evidence-debt.ts`), `computeCoverageDebt`, `computeCoveragePairs`, `computeUnfixedThresholds` (`src/eval/coverage.ts`), `believabilityRollup` (`src/knowledge/believability.ts`), `buildPassContext` (`src/runner/context.ts`), `type PassContext` (`src/processes/types.ts`), `type OstNode` (`src/ost/node.ts`).
- Produces, consumed by Task 5:

```ts
export function renderCheck(tree: OstNode[]): { text: string; violations: number };
export function renderDebt(tree: OstNode[]): string;
export function renderStatus(ctx: PassContext): string;
export function renderGate(tree: OstNode[], solution: string): { text: string; cleared: boolean };
```

These live in `src/eval/` beside the analysis modules they call and take `PassContext` under its current name. Task 10 relocates and renames them. **Task 4 must not depend on Task 10 having run.**

- [ ] **Step 1: Capture the current CLI output as the fixture to preserve**

```bash
cd /Users/tanner/dev/OST-Agent
mkdir -p /tmp/ost-render-baseline
npx tsx src/cli/index.ts check  --vault . > /tmp/ost-render-baseline/check.txt  2>&1 || true
npx tsx src/cli/index.ts debt   --vault . > /tmp/ost-render-baseline/debt.txt   2>&1 || true
npx tsx src/cli/index.ts status --vault . > /tmp/ost-render-baseline/status.txt 2>&1 || true
cat /tmp/ost-render-baseline/debt.txt
```

If this repo is not itself a vault, create a scratch one first with `npx tsx src/cli/index.ts init --vault /tmp/ost-render-vault` and use that path throughout. Keep these files: Step 6 diffs against them.

- [ ] **Step 2: Write the failing test**

Create `test/eval/render.test.ts`:

```ts
/**
 * The renderers are the single source of the analysis wording. The CLI prints
 * what they return and the MCP tools return it verbatim, so the text cannot
 * fork between surfaces.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { renderCheck, renderDebt, renderGate, renderStatus } from "../../src/eval/render.js";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-render-"));
  await initVault(dir, "Reach ten returning operators.", "Reach ten returning operators");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test("renderCheck reports a passing tree with zero violations", () => {
  const ctx = buildPassContext(dir);
  const out = renderCheck(ctx.vault.readTree());
  expect(out.violations).toBe(0);
  expect(out.text).toMatch(/invariants: PASS \(0 violations\)/);
});

test("renderDebt keeps the sentence that says it never judges", () => {
  const ctx = buildPassContext(dir);
  const text = renderDebt(ctx.vault.readTree());
  expect(text).toMatch(/Solutions: /);
  // Load-bearing: debt flags, it never refuses. Losing this line changes what
  // the tool claims about itself.
  expect(text).toMatch(/Mechanical only/);
  expect(text).toMatch(/is a human call/);
});

test("renderStatus names the vault and the outcome", () => {
  const ctx = buildPassContext(dir);
  const text = renderStatus(ctx);
  expect(text).toMatch(/Vault: /);
  expect(text).toMatch(/Outcome: Reach ten returning operators\./);
  expect(text).toMatch(/Nodes: /);
  expect(text).toMatch(/the tree as a whole rests on its weakest rung/);
});

test("renderGate blocks an unknown solution and says so", () => {
  const ctx = buildPassContext(dir);
  const out = renderGate(ctx.vault.readTree(), "A solution that does not exist");
  expect(out.cleared).toBe(false);
  expect(out.text).toMatch(/^gate: BLOCKED — /);
});

test("renderers return text, never print", () => {
  const ctx = buildPassContext(dir);
  const logged: unknown[] = [];
  const real = console.log;
  console.log = (...a: unknown[]) => void logged.push(a);
  try {
    renderCheck(ctx.vault.readTree());
    renderDebt(ctx.vault.readTree());
    renderStatus(ctx);
    renderGate(ctx.vault.readTree(), "x");
  } finally {
    console.log = real;
  }
  expect(logged).toEqual([]);
});
```

- [ ] **Step 3: Run it and confirm it fails**

```bash
npx vitest run test/eval/render.test.ts
```

Expected: FAIL — cannot resolve `../../src/eval/render.js`.

- [ ] **Step 4: Write the renderers by moving the command bodies verbatim**

Create `src/eval/render.ts`. Move the bodies of the four command `.action(...)` callbacks out of `src/cli/index.ts`:

- `check` — currently `src/cli/index.ts:161-175`
- `debt` — currently `src/cli/index.ts:207-291`
- `status` — currently `src/cli/index.ts:438-478`
- `gate` — currently `src/cli/index.ts:421-437`

Mechanical rules for the move, applied to every line:

1. Replace each `console.log(x)` with `lines.push(x)`; each `console.error(x)` likewise.
2. Open each renderer with `const lines: string[] = [];` and close with `return lines.join("\n")` (or the documented object).
3. A bare `console.log()` becomes `lines.push("")`.
4. Leading `\n` inside a string (as in `` `\nCoverage: ...` ``) stays exactly as written — do not "tidy" it into a separate empty push. The output must be byte-identical.
5. `process.exitCode = 1` is removed; the caller decides. `renderCheck` returns `violations`, `renderGate` returns `cleared`.
6. **Every comment moves with its code.** The block comments in `debt` and `status` explaining what the numbers do and do not mean are the reason this text is careful.

For `renderStatus`, drop the journal lines only — `readRunJournals`, `printLastFailure(journals)`, and `printLastRuns(journals)`. Task 6 deletes `src/runner/journal.ts`, and nothing writes journals once the runner is gone. Everything from `Vault:` through the threshold census is preserved.

Header comment for the new file:

```ts
/**
 * The analysis renderers: one source of wording for four surfaces' worth of
 * output. The CLI prints what these return; the MCP tools return it verbatim.
 *
 * These print nothing and exit nothing. `check` and `gate` hand back the fact
 * the CLI turns into an exit code, because an MCP tool has no exit code and
 * the text has to carry the verdict either way.
 */
```

- [ ] **Step 5: Rewire the four CLI commands to the renderers**

In `src/cli/index.ts`:

```ts
program
  .command("check")
  .description("run the deterministic tree invariants (no model needed)")
  .option("--vault <dir>", "vault directory", ".")
  .action((opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    const { text, violations } = renderCheck(ctx.vault.readTree());
    console.log(text);
    if (violations > 0) process.exitCode = 1;
  });
```

```ts
program
  .command("debt")
  .description("what each solution owes in evidence before anyone builds it (no model needed)")
  .option("--vault <dir>", "vault directory", ".")
  .action((opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    console.log(renderDebt(ctx.vault.readTree()));
  });
```

```ts
program
  .command("status")
  .option("--vault <dir>", "vault directory", ".")
  .action((opts: { vault: string }) => {
    console.log(renderStatus(buildPassContext(opts.vault)));
  });
```

```ts
program
  .command("gate")
  .description("refuse to build against untested assumptions: exits non-zero unless a solution has a tested assumption")
  .argument("<solution>", "title of the Solution node about to be built")
  .option("--vault <dir>", "vault directory", ".")
  .action((solution: string, opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    const { text, cleared } = renderGate(ctx.vault.readTree(), solution);
    if (cleared) { console.log(text); return; }
    console.error(text);
    process.exitCode = 1;
  });
```

Add the import:

```ts
import { renderCheck, renderDebt, renderGate, renderStatus } from "../eval/render.js";
```

Remove any import from `src/cli/index.ts` that only these four bodies used — `checkInvariants`, `computeEvidenceDebt`, `gateSolution`, `computeCoverageDebt`, `computeCoveragePairs`, `computeUnfixedThresholds`, `believabilityRollup` — but keep `BELIEVABILITY_LADDER` and `RungId` if `result` or `lanes` still reference them. `npx tsc --noEmit` names anything left unused.

- [ ] **Step 6: Verify the output is byte-identical to the baseline**

```bash
npx tsx src/cli/index.ts check  --vault . > /tmp/ost-render-after-check.txt  2>&1 || true
npx tsx src/cli/index.ts debt   --vault . > /tmp/ost-render-after-debt.txt   2>&1 || true
diff /tmp/ost-render-baseline/check.txt /tmp/ost-render-after-check.txt
diff /tmp/ost-render-baseline/debt.txt  /tmp/ost-render-after-debt.txt
```

Expected: both diffs empty. Use the same `--vault` path as Step 1.

`status` will differ by exactly the removed journal lines. Confirm that and nothing else:

```bash
npx tsx src/cli/index.ts status --vault . > /tmp/ost-render-after-status.txt 2>&1 || true
diff /tmp/ost-render-baseline/status.txt /tmp/ost-render-after-status.txt
```

Expected: only "last failure" / "last run" lines removed. Any other difference is a transcription error — fix it before continuing.

- [ ] **Step 7: Run the tests**

```bash
npx vitest run test/eval/render.test.ts && npm test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/eval/render.ts test/eval/render.test.ts src/cli/index.ts
git commit -m "refactor(eval): one source of wording for check, debt, status, gate

These four print carefully-written prose — debt closes by saying it counts
mechanically and never judges — and they are about to have a second caller in
the MCP tools. server.ts already states the rule for ost_next_work: the
wording cannot fork. So the text moves into renderers and both surfaces read
from there.

status loses its run-journal sections; nothing writes journals once the runner
is gone."
```

---

### Task 5: Promote the four renderers to read-only MCP tools

**Files:**
- Modify: `src/mcp/server.ts` (`MCP_TOOL_NAMES`, `READ_ONLY`), `src/security/tools.ts` (four new definitions), `src/security/policy.ts` (`ALLOWED_TOOL_NAMES`)
- Test: `test/mcp/analysis-tools.test.ts`

**Interfaces:**
- Consumes: `renderCheck`, `renderDebt`, `renderStatus`, `renderGate` from Task 4.
- Produces: tool names `ost_check`, `ost_debt`, `ost_status`, `ost_gate` on `MCP_TOOL_NAMES`, all in `READ_ONLY`.

`ost_check`, `ost_debt`, and `ost_status` take no arguments. `ost_gate` takes `{ solution: string }`.

- [ ] **Step 1: Write the failing test**

Create `test/mcp/analysis-tools.test.ts`:

```ts
/**
 * The analysis commands as MCP tools. They were reachable only through a
 * Bash grant on the published binary; with the binary gone they have to be on
 * the tool surface, and being read-only they must never enqueue a commit.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { createLazyOstMcpServer, MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { renderCheck, renderDebt, renderGate, renderStatus } from "../../src/eval/render.js";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-analysis-"));
  await initVault(dir, "Reach ten returning operators.", "Reach ten returning operators");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function connect(vaultDir: string): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createLazyOstMcpServer(vaultDir);
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
}

// `initVault` runs `git init` but commits nothing, so a fresh vault has zero
// commits and `git rev-parse HEAD` throws. Counting tolerates that; reading
// .git/HEAD would not work at all — it holds `ref: refs/heads/<branch>` and
// never changes when a commit lands.
function commitCount(d: string): number {
  try {
    return Number(
      execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: d, encoding: "utf8" }).trim(),
    );
  } catch {
    return 0;
  }
}

test("all four are on the surface", () => {
  for (const n of ["ost_check", "ost_debt", "ost_status", "ost_gate"]) {
    expect(MCP_TOOL_NAMES).toContain(n);
  }
});

test("ost_check returns exactly what the renderer returns", async () => {
  const client = await connect(dir);
  const res = await call(client, "ost_check");
  expect(res.isError).toBeFalsy();
  expect(res.content[0].text).toBe(renderCheck(buildPassContext(dir).vault.readTree()).text);
});

test("ost_debt returns exactly what the renderer returns", async () => {
  const client = await connect(dir);
  const res = await call(client, "ost_debt");
  expect(res.content[0].text).toBe(renderDebt(buildPassContext(dir).vault.readTree()));
});

test("ost_status returns exactly what the renderer returns", async () => {
  const client = await connect(dir);
  const res = await call(client, "ost_status");
  expect(res.content[0].text).toBe(renderStatus(buildPassContext(dir)));
});

test("ost_gate carries the verdict in its text", async () => {
  const client = await connect(dir);
  const res = await call(client, "ost_gate", { solution: "A solution that does not exist" });
  expect(res.content[0].text).toBe(
    renderGate(buildPassContext(dir).vault.readTree(), "A solution that does not exist").text,
  );
  expect(res.content[0].text).toMatch(/^gate: BLOCKED — /);
});

test("read-only: no commit is appended and git history does not grow", async () => {
  const client = await connect(dir);
  const before = commitCount(dir);
  for (const n of ["ost_check", "ost_debt", "ost_status"]) {
    const res = await call(client, n);
    // The commit suffix the mutating path appends. Its absence is the assertion.
    expect(res.content[0].text).not.toMatch(/committed [0-9a-f]{8}/);
    expect(res.content[0].text).not.toMatch(/no changes to commit/);
  }
  expect(commitCount(dir)).toBe(before);
});

test("ost_gate rejects a call with no solution", async () => {
  const client = await connect(dir);
  const res = await call(client, "ost_gate", {});
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toMatch(/invalid input for "ost_gate"/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run test/mcp/analysis-tools.test.ts
```

Expected: FAIL — `MCP_TOOL_NAMES` does not contain the four names.

- [ ] **Step 3: Add the four names to the policy allowlist**

In `src/security/policy.ts`, add to `ALLOWED_TOOL_NAMES` before `git_commit`:

```ts
  // The deterministic analysis surface: no model, no writes. These were CLI
  // commands reachable only through a Bash grant on a published binary; with
  // the binary gone they belong on the tool surface like everything else.
  "ost_check",
  "ost_debt",
  "ost_status",
  "ost_gate",
```

- [ ] **Step 4: Define the four tools**

In `src/security/tools.ts`, import the renderers:

```ts
import { renderCheck, renderDebt, renderGate, renderStatus } from "../eval/render.js";
```

`renderStatus` needs a `PassContext`, but `ToolContext` carries `vault`, `dir`, and `config` separately. Add the type import to `src/security/tools.ts`:

```ts
import type { PassContext } from "../processes/types.js";
```

then add an optional `passContext` field to `ToolContext`:

```ts
  /** The full pass context, needed by the tools that report on the whole vault. */
  passContext?: PassContext;
```

and pass `ctx` through from `buildDefs` in `src/mcp/server.ts`:

```ts
      passContext: ctx,
```

Then add the definitions to the `all` array:

```ts
    betaTool({
      name: "ost_check",
      description:
        "Run the deterministic tree invariants and report every violation. No model, no writes — the same check the CI gate runs. Read-only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => renderCheck(vault.readTree()).text,
    }),

    betaTool({
      name: "ost_debt",
      description:
        "Report what each Solution owes in evidence before anyone builds it: which solutions have no assumption test, which tests have run, and which recorded results never said what they failed to cover. Counts mechanically and never judges whether the RIGHT assumption was tested — that is a human call. Read-only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => renderDebt(vault.readTree()),
    }),

    betaTool({
      name: "ost_status",
      description:
        "Report the tree's shape and health: node counts by layer, how many are agent-ideated and awaiting review, the believability rollup and the weakest rung the tree rests on, and any coverage or threshold gaps. Read-only.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => {
        if (!ctx.passContext) throw new Error("ost_status needs a pass context");
        return renderStatus(ctx.passContext);
      },
    }),

    betaTool({
      name: "ost_gate",
      description:
        "Ask whether a named Solution has a tested assumption behind it. Returns CLEARED or BLOCKED with the reason. Advisory: it reports, it does not prevent. Read-only.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          solution: { type: "string", description: "Title of the Solution node about to be built." },
        },
        required: ["solution"],
      },
      run: async (input: { solution: string }) => renderGate(vault.readTree(), input.solution).text,
    }),
```

- [ ] **Step 5: Add the names to the MCP surface and mark them read-only**

In `src/mcp/server.ts`, append to `MCP_TOOL_NAMES`:

```ts
  "ost_check",
  "ost_debt",
  "ost_status",
  "ost_gate",
```

and add all four to `READ_ONLY`:

```ts
const READ_ONLY = new Set<string>([
  "ost_read_tree",
  "ost_next_work",
  "ost_search_web",
  "ost_read_web",
  "ost_read_repo",
  // Analysis: they read the tree and format it. Nothing they do can produce a
  // diff, so a commit would always be empty.
  "ost_check",
  "ost_debt",
  "ost_status",
  "ost_gate",
]);
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run test/mcp/analysis-tools.test.ts
```

Expected: 7 passed.

- [ ] **Step 7: Run the full suite**

```bash
npm test
```

Expected: all pass. A test asserting the exact size or contents of `MCP_TOOL_NAMES` (`test/mcp/setup-mode.test.ts` and the "exposes exactly" case) will need its expected list extended — that is a correct update, not a weakening.

- [ ] **Step 8: Commit**

```bash
git add src/security/policy.ts src/security/tools.ts src/mcp/server.ts test/mcp/analysis-tools.test.ts
git commit -m "feat(mcp): check, debt, status and gate become tools

They were CLI commands the skill reached through a Bash grant on a published
binary. With no published binary the grant has nothing to point at, and a
plugin that shells out to read its own tree was always the wrong shape.

All four are read-only and derive no commit. Each returns exactly what the
renderer returns, so the CLI and the tool cannot drift."
```

---

### Task 6: Excise the model-calling layer

**Files:**
- Delete: `src/runner/driver.ts`, `src/runner/credentials.ts`, `src/runner/errors.ts`, `src/runner/pass.ts`, `src/runner/tool.ts`, `src/runner/journal.ts`, `src/processes/registry.ts`, `src/eval/judge.ts`, `src/eval/run.ts`, `src/eval/scorecard.ts`, `src/loop/health.ts`, `src/cli/loop.ts`, `eval/` (directory)
- Delete tests: `test/runner/{driver,credentials,errors,pass,journal,tool,tool-input-validation,set-outcome,context}.test.ts` (keep what still has a subject — see Step 3), `test/eval/`, `test/loop/`, `test/processes/`
- Modify: `src/cli/index.ts`, `src/processes/types.ts`, `package.json`

- [ ] **Step 1: Delete the model-driven source**

```bash
git rm src/runner/driver.ts src/runner/credentials.ts src/runner/errors.ts \
       src/runner/pass.ts src/runner/tool.ts src/runner/journal.ts \
       src/processes/registry.ts \
       src/eval/judge.ts src/eval/run.ts src/eval/scorecard.ts \
       src/loop/health.ts src/cli/loop.ts
git rm -r eval
```

Note what is NOT deleted: `src/runner/{context,init,set-outcome}.ts`, `src/eval/{coverage,evidence-debt,invariants,render}.ts`, and `src/processes/{types,tree}.ts` all have live consumers on the MCP path.

- [ ] **Step 2: Remove the four commands and their imports from the CLI**

In `src/cli/index.ts`, delete the `run`, `loop`, `schedule`, and `tool` command blocks, and these imports:

```ts
import { Cron } from "croner";
import { runPass } from "../runner/pass.js";
import { failed, lastFailedRun, lastRunPerProcess, readRunJournals, type RunJournalEntry } from "../runner/journal.js";
import { runTool } from "../runner/tool.js";
import { anthropicDriver } from "../runner/driver.js";
import { anthropicCredentialsPresent, credentialGuidance } from "../runner/credentials.js";
import { getProcess, PROCESSES } from "../processes/registry.js";
import { drivesModel } from "../processes/types.js";
import { ALLOWED_TOOL_NAMES } from "../security/policy.js";
import { withAuthHint } from "../runner/errors.js";
import { registerLoopCommands } from "./loop.js";
```

Also delete the `registerLoopCommands(program)` call and the `printLastFailure`/`printLastRuns` helper functions.

Surviving commands, all model-free: `mcp`, `init`, `set-outcome`, `check`, `debt`, `status`, `gate`, `result`, `friction`, `lanes`, `lane`.

- [ ] **Step 3: Strip the driver surface from `processes/types.ts`**

Delete `PassDriver`, `ToolSet`, `ProcessResult`, `drivesModel`, and `OstProcess.run()`, plus the `import type { PassDriver, ToolSet } from "../runner/driver.js"` line. Keep `PassContext` — `src/mcp/server.ts` and `src/mcp/bootstrap.ts` both import it.

Then delete the test files whose subject is gone — **named individually, never by directory.** `test/eval/` in particular holds six files and only one of them tests deleted code; the other five cover the analysis modules that are now the core of the product.

```bash
git rm test/runner/credentials.test.ts \
       test/runner/errors.test.ts \
       test/runner/journal.test.ts \
       test/runner/pass.test.ts \
       test/runner/tool.test.ts \
       test/runner/tool-input-validation.test.ts \
       test/eval/scorecard.test.ts \
       test/loop/health.test.ts \
       test/processes/bootstrap.test.ts \
       test/processes/model-free.test.ts
```

**Kept, and not optional:**

| Kept | Subject |
| --- | --- |
| `test/runner/context.test.ts`, `set-outcome.test.ts` | `src/runner/{context,set-outcome}.ts`, both live on the MCP path |
| `test/eval/coverage.test.ts`, `coverage-pairs.test.ts`, `evidence-debt.test.ts`, `invariants.test.ts`, `unfixed-thresholds.test.ts` | the analysis modules behind `ost_check`, `ost_debt`, `ost_status`, `ost_gate` |
| `test/eval/render.test.ts` | the Task 4 renderers |

`test/runner/tool-input-validation.test.ts` is deleted on purpose: Task 2 replaced it with `test/mcp/tool-input-validation.test.ts`, covering the same incident on the surface that survives. **Confirm that file exists and passes before deleting the old one** — it is the only guard on the product's central claim.

- [ ] **Step 3b: Confirm the count before moving on**

```bash
ls test/eval test/runner
```

Expected: `test/eval` holds exactly `coverage.test.ts`, `coverage-pairs.test.ts`, `evidence-debt.test.ts`, `invariants.test.ts`, `render.test.ts`, `unfixed-thresholds.test.ts`; `test/runner` holds exactly `context.test.ts` and `set-outcome.test.ts`. `test/loop` and `test/processes` are empty and can be removed with `rmdir`.

- [ ] **Step 4: Drop the two dependencies**

```bash
npm uninstall @anthropic-ai/sdk croner
```

- [ ] **Step 5: Remove the eval script, and fix what `init` tells the user to run next**

Delete the `"eval": "tsx src/eval/run.ts"` line from `package.json` `scripts`.

`src/cli/index.ts`'s `init` action ends by printing a next step that names a
command this task deletes:

```ts
    console.log(`\nDrop notes into ${path.join(dir, inboxPath)}/ and run:  ost-agent run P1_ingest --vault ${dir}`);
```

`run` is gone, and so is the `ost-agent` binary. Replace it with the plugin's
actual next step:

```ts
    console.log(`\nDrop notes into ${path.join(dir, inboxPath)}/, then run /ost-map in Claude Code to fold them into the tree.`);
```

Then sweep for any other console output naming a deleted command:

```bash
grep -rn "ost-agent \(run\|loop\|schedule\|tool\)" --include="*.ts" src
```

Expected after the fix: no output.

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean. Any error naming a deleted module is a missed import — remove it. Do not re-add a deleted file to satisfy an import.

- [ ] **Step 7: Prove nothing calls a model**

```bash
grep -rn "@anthropic-ai/sdk\|ANTHROPIC_API_KEY\|ANTHROPIC_AUTH_TOKEN\|croner" src/ package.json
```

Expected: no output. If anything matches, it is a leftover — remove it.

- [ ] **Step 8: Run the full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add -u && git add package.json package-lock.json
git commit -m "feat!: delete the API-key runner — Claude Code is the only model caller

OST-Agent shipped two products: a plugin that costs the user nothing beyond
the subscription they have, and a standalone runner billed to their own API
key. Only the first was wanted, and the second was the only reason npm was
ever involved.

Gone: the Anthropic driver, the six model-driven passes, the efficacy harness,
the loop and schedule supervisors, and run/loop/schedule/tool. Kept, because
the MCP server depends on them: context, init, set-outcome, the deterministic
analysis modules, and the tree helpers.

BREAKING CHANGE: ANTHROPIC_API_KEY no longer means anything to this project."
```

---

### Task 7: Bundle the CLI and point the plugin at it

**Files:**
- Modify: `package.json`, `.gitignore`, `.claude-plugin/plugin.json`
- Create: `dist/ost-agent.mjs` (committed build output), `.github/workflows/ci.yml`
- Test: `test/release/bundle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/release/bundle.test.ts`:

```ts
/**
 * Distribution invariants. The plugin must launch its own committed bundle —
 * not a registry package — and package.json must be unable to publish.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));

test("the plugin launches node against the committed bundle", () => {
  const plugin = readJson(".claude-plugin/plugin.json");
  const server = plugin.mcpServers["ost-agent"];
  expect(server.command).toBe("node");
  expect(server.args).toEqual(["${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs", "mcp"]);
  expect(server.env.OST_VAULT).toBe("${CLAUDE_PROJECT_DIR}");
});

test("no plugin asset reaches for npm", () => {
  const files = [
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    ...fs.readdirSync(path.join(root, ".claude/commands")).map((f) => `.claude/commands/${f}`),
  ];
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), "utf8");
    expect(text, `${f} still references npx`).not.toMatch(/npx/);
    expect(text, `${f} still references npm install`).not.toMatch(/npm install/);
  }
});

test("package.json cannot publish", () => {
  const pkg = readJson("package.json");
  expect(pkg.private).toBe(true);
  expect(pkg.bin).toBeUndefined();
  expect(pkg.files).toBeUndefined();
  expect(pkg.publishConfig).toBeUndefined();
  expect(pkg.scripts.prepack).toBeUndefined();
  expect(pkg.scripts.prepublishOnly).toBeUndefined();
});

test("the committed bundle exists and is a real bundle", () => {
  const bundle = path.join(root, "dist/ost-agent.mjs");
  expect(fs.existsSync(bundle)).toBe(true);
  const text = fs.readFileSync(bundle, "utf8");
  // Inlined, not a thin wrapper around node_modules.
  expect(text.length).toBeGreaterThan(100_000);
  expect(text).not.toMatch(/require\(["']@modelcontextprotocol/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run test/release/bundle.test.ts
```

Expected: all four FAIL.

- [ ] **Step 3: Add esbuild and the bundle script**

```bash
npm install --save-dev esbuild
```

In `package.json` `scripts`, add:

```json
    "bundle": "esbuild src/cli/index.ts --bundle --platform=node --target=node20 --format=esm --outfile=dist/ost-agent.mjs",
```

- [ ] **Step 4: Make package.json unpublishable**

Add `"private": true` at the top level; delete `bin`, `files`, `publishConfig`, and the `prepack` and `prepublishOnly` scripts. `"private": true` makes `npm publish` fail client-side before it can reach the registry.

- [ ] **Step 5: Un-ignore the one committed artifact**

In `.gitignore`, replace `dist/` with:

```
dist/
!dist/ost-agent.mjs
```

- [ ] **Step 6: Build it**

```bash
npm run bundle && ls -la dist/ost-agent.mjs && node dist/ost-agent.mjs --help
```

Expected: the file exists, is a few hundred KB, and `--help` lists the surviving commands with no `run`, `loop`, `schedule`, or `tool`.

- [ ] **Step 7: Verify the bundle actually serves MCP**

```bash
mkdir -p /tmp/ost-bundle-check && cd /tmp/ost-bundle-check
# `init` takes a positional folder, not --vault. `mcp` is the one that takes --vault.
node /Users/tanner/dev/OST-Agent/dist/ost-agent.mjs init . --outcome "Smoke test outcome."
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | node /Users/tanner/dev/OST-Agent/dist/ost-agent.mjs mcp --vault . 2>/dev/null \
  | head -c 2000
cd /Users/tanner/dev/OST-Agent && rm -rf /tmp/ost-bundle-check
```

Expected: a JSON-RPC response listing the tools, including `ost_check`, `ost_debt`, `ost_status`, and `ost_gate`. If the bundle throws a module-resolution error, a dependency did not inline — check for dynamic `import()` calls esbuild could not follow and add `--external:` only as a last resort, since an external defeats the purpose.

- [ ] **Step 8: Point the plugin at the bundle**

In `.claude-plugin/plugin.json`, replace the `mcpServers` block:

```json
  "mcpServers": {
    "ost-agent": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs", "mcp"],
      "env": {
        "OST_VAULT": "${CLAUDE_PROJECT_DIR}"
      }
    }
  }
```

- [ ] **Step 9: Add the CI drift guard**

A committed build artifact is only safe if it cannot silently diverge from source. Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm test

  bundle-drift:
    # The plugin launches a committed artifact. If it can drift from source,
    # what users run is whatever was last remembered to be rebuilt — so this
    # job is the control that makes committing it safe.
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run bundle
      - name: Fail if the committed bundle is stale
        run: |
          if ! git diff --exit-code dist/ost-agent.mjs; then
            echo "::error::dist/ost-agent.mjs is stale. Run 'npm run bundle' and commit the result."
            exit 1
          fi
```

- [ ] **Step 10: Run the tests**

```bash
npx vitest run test/release/bundle.test.ts
```

Expected: 4 passed. The "no plugin asset reaches for npm" case may still fail on `.claude/commands/ost-setup.md` — that is Task 8's job. If so, note it and let Task 8 turn it green.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json .gitignore .claude-plugin/plugin.json \
        dist/ost-agent.mjs .github/workflows/ci.yml test/release/bundle.test.ts
git commit -m "feat: the plugin carries its own engine

The plugin launched its MCP server with 'npx -y ost-agent@latest mcp', so a
plugin install was an npm install wearing a costume — and the wanted product
could not start without the unwanted one. It now runs a committed single-file
bundle with node, which is a strictly weaker requirement than the npx it
needed before, so nobody who worked stops working.

A committed artifact is only honest if it cannot drift, so CI rebuilds it and
fails on any diff. package.json is private with no bin and no publish hooks:
an accidental publish now fails at the client."
```

---

### Task 8: Rewrite the docs and the skill's grants

**Files:**
- Modify: `README.md`, `RELEASING.md`, `docs/consuming-from-claude-code.md`, `scripts/gen-skill.ts`, `.claude/commands/ost-setup.md`, `.claude/skills/opportunity-solution-tree/` (regenerated)
- Test: `test/skill/setup-command.test.ts`

- [ ] **Step 1: Update the setup command's allowlist**

`.claude/commands/ost-setup.md` frontmatter currently grants:

```
allowed-tools: mcp__ost-agent__ost_next_work, Bash(ost-agent init:*), Bash(ost-agent set-outcome:*), Bash(npx -y ost-agent@latest init:*), Bash(npx -y ost-agent@latest set-outcome:*)
```

Replace with:

```
allowed-tools: mcp__ost-agent__ost_next_work, Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs init:*), Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs set-outcome:*)
```

Update any body text naming `npx -y ost-agent@latest` to the `node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs` form.

- [ ] **Step 2: Update the skill generator to match**

In `scripts/gen-skill.ts`, replace the two grant strings (currently around lines 135-136):

```ts
    "Bash(npx -y ost-agent@latest init:*)",
    "Bash(npx -y ost-agent@latest set-outcome:*)",
```

with:

```ts
    "Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs init:*)",
    "Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs set-outcome:*)",
```

Remove the bare `Bash(ost-agent init:*)` / `Bash(ost-agent set-outcome:*)` grants too — no `ost-agent` binary is on any PATH now.

- [ ] **Step 3: Update the assertion in the skill test**

`test/skill/setup-command.test.ts:53` asserts:

```ts
      expect(grant).toMatch(/^Bash\((ost-agent|npx -y ost-agent@latest) (init|set-outcome):\*\)$/);
```

Replace with:

```ts
      // One launch path: the bundle the plugin ships. No PATH binary, no registry.
      expect(grant).toMatch(
        /^Bash\(node \$\{CLAUDE_PLUGIN_ROOT\}\/dist\/ost-agent\.mjs (init|set-outcome):\*\)$/,
      );
```

- [ ] **Step 4: Regenerate the skill and run its tests**

```bash
npm run gen:skill && npx vitest run test/skill/
```

Expected: pass.

- [ ] **Step 5: Rewrite the README quickstart**

In `README.md`, delete the install block at line ~88:

```
npm install -g ost-agent          # or: npx ost-agent ...
```

The quickstart becomes the plugin path only:

````markdown
## Install

OST-Agent is a Claude Code plugin. It needs a Claude subscription and `node` on
your PATH; it is not on npm and there is nothing to install globally.

```
/plugin marketplace add tannerbroberts/OST-Agent
/plugin install ost-agent@ost-agent
```

Then, in the folder you want the tree to live in:

```
/ost-setup
```
````

Sweep the rest of the file for `npm install -g`, `npx ost-agent`, and any text describing the standalone runner, `ANTHROPIC_API_KEY`, `ost-agent run`, `ost-agent loop`, or `ost-agent schedule`. All of that is gone.

- [ ] **Step 6: Rewrite RELEASING.md**

Replace the publish flow with tag-and-bundle:

```markdown
# Releasing

OST-Agent is not published anywhere. A release is a git tag plus a rebuilt
bundle, and users get it by updating the plugin.

1. `npm test` and `npx tsc --noEmit` — both clean.
2. Bump `version` in `package.json` AND `.claude-plugin/plugin.json`. They must
   match; `test/release/version.test.ts` enforces it.
3. `npm run bundle` — rebuild `dist/ost-agent.mjs`.
4. Commit the bump and the rebuilt bundle together. CI fails the build if the
   committed bundle does not match a fresh one.
5. Update `CHANGELOG.md`.
6. `git tag vX.Y.Z && git push --tags`.

There is no publish step. There is no npm package. `package.json` is `private`,
so `npm publish` fails at the client before it reaches the registry.
```

- [ ] **Step 7: Collapse the consuming doc to one option**

`docs/consuming-from-claude-code.md` presents three install options (checkout, npm package, plugin). Delete the npm section entirely and the checkout section's framing as a *consumer* path — keep a checkout note for contributors only, marked as such. Option C (plugin) becomes the whole document, and its "Con: depends on option B being published to npm" line is deleted; it is no longer true.

- [ ] **Step 8: Verify no user-facing doc reaches for npm**

```bash
grep -rn "npx\|npm install" README.md .claude-plugin/ .claude/ docs/consuming-from-claude-code.md
```

Expected: no output. `CONTRIBUTING.md` keeps its `npm install` for contributors; `docs/superpowers/specs/` and `CHANGELOG.md` are historical record. Both are out of scope.

- [ ] **Step 9: Run the full suite**

```bash
npm test
```

Expected: all pass, including `test/release/bundle.test.ts`'s npm sweep from Task 7.

- [ ] **Step 10: Commit**

```bash
git add README.md RELEASING.md docs/consuming-from-claude-code.md \
        scripts/gen-skill.ts .claude/commands/ost-setup.md .claude/skills \
        test/skill/setup-command.test.ts
git commit -m "docs: one install path, and it isn't npm

README offered a global install and an npx invocation; consuming-from-claude-code
offered three options and warned that the plugin depended on the npm package
being published. Both described a product that no longer exists.

The setup grants stop naming a binary that is on nobody's PATH and name the
bundle the plugin ships instead."
```

---

### Task 9: Remove the package from npm

**Gated on Task 1.** Do not start until the `npm-archive` release exists with all three tarballs.

**Files:**
- Delete: `.github/workflows/npm-publish.yml`

- [ ] **Step 1: Re-verify the archive**

```bash
gh release view npm-archive --json assets --jq '.assets[].name'
```

Expected: `ost-agent-0.20.0.tgz`, `ost-agent-0.21.0.tgz`, `ost-agent-0.22.0.tgz`. If any is missing, STOP and return to Task 1. Unpublishing is irreversible.

- [ ] **Step 2: Unpublish — maintainer runs this**

This needs npm auth the repo tooling does not have. Ask the maintainer to run:

```bash
npm unpublish ost-agent --force
```

Permitted outside the 72-hour window because the package has no registry dependents, is under 300 weekly downloads, and has a single maintainer. Two irreversible consequences, both intended: the name `ost-agent` is locked for 24 hours, and those version numbers can never be republished.

- [ ] **Step 3: Verify it is gone**

```bash
npm view ost-agent 2>&1 | head -3
```

Expected: a 404. Registry propagation can lag a minute or two.

- [ ] **Step 4: Delete the publish workflow**

```bash
git rm .github/workflows/npm-publish.yml
```

- [ ] **Step 5: Confirm no workflow can publish**

```bash
grep -rn "npm publish\|NPM_TOKEN\|npm-publish" .github/
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git commit -m "chore: unpublish from npm and delete the release workflow

The package is off the registry and the workflow that put it there is gone.
package.json has been private since the bundle landed, so this closes the last
path back.

The three untagged releases (0.20.0-0.22.0) are preserved on the npm-archive
release; see docs/npm-archive.md."
```

---

### Task 10: Re-layout (separable — defer freely)

After Task 6, four directory names describe things that no longer exist: `runner/` runs nothing, `eval/` evaluates nothing, `processes/` holds no processes, `loop/` is empty. This task is mechanical, touches import paths across most of `src/` and `test/`, and **nothing in Tasks 1-9 depends on it**. Three in-flight branches (`sql-evidence-reads`, `feat/transcript-harvester`, `web-lookup-trust`) touch `src/runner/` and `src/eval/`; if any is still open, defer this task until they land.

**Files:**

| From | To |
| --- | --- |
| `src/runner/context.ts` | `src/ost/context.ts` |
| `src/runner/init.ts` | `src/ost/init.ts` |
| `src/runner/set-outcome.ts` | `src/ost/set-outcome.ts` |
| `src/eval/coverage.ts` | `src/analysis/coverage.ts` |
| `src/eval/evidence-debt.ts` | `src/analysis/evidence-debt.ts` |
| `src/eval/invariants.ts` | `src/analysis/invariants.ts` |
| `src/eval/render.ts` | `src/analysis/render.ts` |
| `src/processes/tree.ts` | `src/ost/tree.ts` |
| `src/processes/types.ts` | folded into `src/ost/context.ts` |

- [ ] **Step 1: Confirm the suite is green before moving anything**

```bash
npm test && npx tsc --noEmit
```

Expected: both clean. A rename on top of a red suite is untraceable.

- [ ] **Step 2: Move the files with git mv**

```bash
mkdir -p src/analysis
git mv src/runner/context.ts src/ost/context.ts
git mv src/runner/init.ts src/ost/init.ts
git mv src/runner/set-outcome.ts src/ost/set-outcome.ts
git mv src/eval/coverage.ts src/analysis/coverage.ts
git mv src/eval/evidence-debt.ts src/analysis/evidence-debt.ts
git mv src/eval/invariants.ts src/analysis/invariants.ts
git mv src/eval/render.ts src/analysis/render.ts
git mv src/processes/tree.ts src/ost/tree.ts
```

- [ ] **Step 3: Fold `PassContext` into `src/ost/context.ts` and rename it**

Move the `PassContext` interface from `src/processes/types.ts` into `src/ost/context.ts`, rename it `VaultContext`, and re-export the old name so the diff can land in one step:

```ts
/** @deprecated Renamed to VaultContext — nothing runs a pass any more. */
export type PassContext = VaultContext;
```

Then delete `src/processes/types.ts` and the now-empty `src/processes/` and `src/eval/` and `src/runner/` and `src/loop/` directories.

- [ ] **Step 4: Fix every import path**

```bash
grep -rln "runner/\|processes/\|eval/" --include="*.ts" src test
```

Work through each file. The mapping is the table above. `npx tsc --noEmit` is the checklist — repeat until clean.

- [ ] **Step 5: Move the test directories to match**

```bash
git mv test/eval test/analysis
mkdir -p test/ost
git mv test/runner/context.test.ts test/ost/context.test.ts
git mv test/runner/set-outcome.test.ts test/ost/set-outcome.test.ts
rmdir test/runner
```

Fix the import paths inside them the same way.

- [ ] **Step 6: Drop the deprecated alias**

Replace every remaining `PassContext` with `VaultContext`:

```bash
grep -rln "PassContext" --include="*.ts" src test
```

Then delete the `@deprecated` re-export from `src/ost/context.ts`.

- [ ] **Step 7: Verify the layout**

```bash
ls src
```

Expected exactly: `adapters`, `analysis`, `cli`, `config`, `git`, `index.ts`, `knowledge`, `mcp`, `ost`, `product`, `security`, `telemetry`, `web`.

- [ ] **Step 8: Rebuild the bundle — its input paths changed**

```bash
npm run bundle && node dist/ost-agent.mjs --help
```

Expected: help output. A stale bundle here would fail CI's drift guard anyway, but catching it locally is cheaper.

- [ ] **Step 9: Typecheck and run the full suite**

```bash
npx tsc --noEmit && npm test
```

Expected: both clean.

- [ ] **Step 10: Commit**

```bash
git add -u && git add src/analysis src/ost dist/ost-agent.mjs
git commit -m "refactor: name the directories after what they now contain

runner/ ran nothing, eval/ evaluated nothing, processes/ held no processes and
loop/ was empty — all four were named for the API-key product that was deleted.
The deterministic analysis becomes analysis/, the vault machinery joins ost/,
and PassContext becomes VaultContext because nothing runs a pass.

Pure moves and renames; no behaviour changes."
```

---

## Self-Review

**Spec coverage:**

| Spec phase | Task |
| --- | --- |
| Phase 1 — archive tarballs | Task 1 |
| Phase 2 — excise model layer | Task 6 (+ Task 3 for the `betaTool` swap) |
| Phase 3 — promote to MCP tools | Tasks 4 and 5 |
| Phase 4 — bundle + drift guard | Task 7 |
| Phase 5 — unpublish | Task 9 |
| Phase 6 — re-layout | Task 10 |
| Phase 7 — docs and tests | Task 8 (tests are folded into the task that changes their subject) |

Success criteria map to: (1) Task 8 Step 8, (2) Task 6 Step 7, (3) Task 7 Step 7, (4) Task 9 Step 3, (5) Task 7 Step 9, (6) Task 5 Step 1 and its byte-equality cases.

**Added beyond the spec:** Task 2. The spec deletes `src/runner/tool.ts`, the only caller of `validateToolInput`, without noticing the MCP surface never validated at all — which would have left the product's central safety claim unguarded on the only surface that survives. Flagged to the maintainer separately.

**Ordering note:** Task 4 precedes Task 6 so the renderers exist before `status`'s journal dependency is deleted. Task 2 precedes Task 6 so validation lands on the MCP path before `runTool` is removed — there is no window where nothing validates.
