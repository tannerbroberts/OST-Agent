# Plugin-only distribution: retire npm, retire the API-key runner

**Date:** 2026-07-27
**Status:** Approved for implementation

## Problem

OST-Agent ships two products through one repo, and only one of them is wanted.

The first is a **Claude Code plugin**: a skill, nine `/ost-*` slash commands,
and an append-only MCP server. Claude Code does all the thinking; the MCP
server only reads and appends to the vault. It costs the user nothing beyond
the Claude subscription they already have.

The second is a **standalone autonomous runner**: `src/runner/driver.ts` calls
the Anthropic SDK directly, `run`/`loop`/`schedule` drive it, and it demands an
`ANTHROPIC_API_KEY`. It serves a different audience on a different billing
relationship, and it is the reason the repo publishes to npm at all.

Worse, the two are entangled at the distribution layer. The plugin's own
manifest launches its MCP server with `npx -y ost-agent@latest mcp`, so the
plugin — the wanted product — cannot start without the npm package, the
unwanted one. A plugin install is really an npm install wearing a costume.

The decision: **the plugin is the entire product.** Claude Code is the only
thing that ever calls a model. npm goes away completely.

## Goals

1. Installing the plugin is the *only* install path, and it touches no registry.
2. No code path in the repo calls a model. `ANTHROPIC_API_KEY` stops meaning
   anything.
3. The model-free analysis commands (`check`, `debt`, `status`, `gate`) survive
   the CLI's demotion by becoming MCP tools, so Claude reaches them directly
   instead of through `Bash(...)` grants.
4. The `ost-agent` package is removed from npm without destroying source that
   exists nowhere else.

## Non-goals

- Preserving compatibility for anyone currently running `npx ost-agent`. There
  is no migration path and none is wanted; existing installs are expected to
  break loudly.
- Rewriting the MCP server to drop dependencies. Bundling solves distribution;
  a dependency-free rewrite is a different project with real protocol risk.

## Findings that shaped the design

Three assumptions were wrong on inspection, each in a way that would have
caused damage during implementation:

**`src/runner/` is not all runner.** `src/mcp/server.ts` imports
`buildPassContext` from `runner/context.ts`, and `src/processes/` imports from
`runner/driver.ts`. Deleting the directory breaks the MCP server.

**`src/eval/` is not all eval.** `coverage.ts`, `evidence-debt.ts`, and
`invariants.ts` are the deterministic analysis behind `check`, `debt`,
`status`, and `gate` — the exact code Goal 3 promotes — and `src/ost/results.ts`
and `src/ost/lanes.ts` import them independently of the CLI. Only `judge.ts`,
`run.ts`, and `scorecard.ts` belong to the model-driven efficacy harness.

**npm holds source that git does not.** npm has `0.20.0`, `0.21.0`, and
`0.22.0` published under `latest`. Git's tags stop at `v0.19.1`, and the three
live branches sit at `0.9.0`, `0.14.0`, and `0.4.0`. Whatever shipped in those
three releases exists only as registry tarballs. Unpublishing before archiving
destroys it.

## Design

### Phase 1 — Archive the npm tarballs

Before any deletion, run in a scratch directory:

```
npm pack ost-agent@0.20.0 ost-agent@0.21.0 ost-agent@0.22.0
```

Attach the three tarballs to a GitHub release tagged `npm-archive` on this
repo. This is strictly a safety net for source that has no other copy; it is
not a distribution channel.

This phase must complete and be verified before Phase 5.

### Phase 2 — Excise the model-calling layer

**Delete outright:**

| Path | Why |
| --- | --- |
| `src/runner/driver.ts` | the Anthropic SDK call |
| `src/runner/credentials.ts` | `ANTHROPIC_API_KEY` presence checks |
| `src/runner/errors.ts` | auth-failure hint layer, driver-only |
| `src/runner/pass.ts` | model-driven pass loop |
| `src/runner/tool.ts` | backs the `tool` command |
| `src/runner/journal.ts` | run journals only the runner writes |
| `src/processes/registry.ts` | the six model-driven passes P1–P6 |
| `src/eval/judge.ts`, `run.ts`, `scorecard.ts` | efficacy harness |
| `src/loop/health.ts` | loop-only |
| `src/cli/loop.ts` | loop command registration |
| `eval/` (corpus, `outcome.txt`) | efficacy fixtures |

**CLI commands removed:** `run`, `loop`, `schedule`, `tool`.

**CLI commands surviving:** `mcp`, `init`, `set-outcome`, `check`, `debt`,
`status`, `gate`, `result`, `friction`, `lanes`, `lane`. Every one is
model-free. They remain reachable through the committed bundle (Phase 4); what
disappears is the published `ost-agent` binary, not the commands themselves.

**Dependencies removed:** `@anthropic-ai/sdk`, `croner`.

**`src/security/tools.ts` loses its SDK import.** It uses `betaTool` purely as
a raw-JSON-Schema wrapper, and its own header comment records that it chose
raw JSON Schema over `betaZodTool` specifically to avoid coupling to a
dependency's versioning. Replace it with a local helper of the same shape:

```ts
export interface OstTool<I> {
  name: string;
  description: string;
  input_schema: object;
  run(input: I): Promise<unknown> | unknown;
}
export function tool<I>(spec: OstTool<I>): OstTool<I> { return spec; }
```

This finishes a decoupling the file already wanted; it is not new debt.

**`src/processes/types.ts` sheds its driver surface.** `PassDriver`, `ToolSet`,
`ProcessResult`, `drivesModel`, and `OstProcess.run()` all go. `PassContext`
stays — `src/mcp/server.ts` and `src/mcp/bootstrap.ts` both depend on it.

**`status` loses its journal sections.** `printLastFailure` and `printLastRuns`
read run journals that nothing writes once the runner is gone. Both are
deleted, along with the "last failure" and "last runs" output. The tree-shape,
believability, coverage, and threshold sections are unaffected.

### Phase 3 — Promote the analysis commands to MCP tools

`check`, `debt`, `status`, and `gate` become `ost_check`, `ost_debt`,
`ost_status`, and `ost_gate`. All four join the `READ_ONLY` set in
`src/mcp/server.ts`, so none can trigger the commit queue.

The wording in these commands is load-bearing — `debt` in particular ends with
a paragraph explaining that it counts mechanically and never judges, and
`server.ts` already states the principle for `ost_next_work` that its wording
"cannot fork". So the tools must not re-implement the prose.

Each command body is extracted into a pure renderer:

```ts
// src/eval/render.ts — moves to src/analysis/render.ts in Phase 6
export function renderCheck(tree: OstNode[]): { text: string; violations: number };
export function renderDebt(tree: OstNode[]): string;
export function renderStatus(ctx: PassContext): string;
export function renderGate(tree: OstNode[], solution: string): { text: string; cleared: boolean };
```

These land in `src/eval/` beside the analysis modules they call, and take
`PassContext` under its current name. Phase 6 relocates and renames them; Phase
3 must not depend on Phase 6 having run.

The CLI action prints `text` and sets `process.exitCode` from `violations`/
`cleared`. The MCP tool returns `text` as its text content. One source of
wording, two callers.

`gate`'s non-zero exit has no MCP equivalent; `cleared` is carried in the
returned text as today's `gate: CLEARED — …` / `gate: BLOCKED — …` lines, which
already say it unambiguously.

`ost_status` takes no arguments. `ost_check` and `ost_debt` take none.
`ost_gate` takes `{ solution: string }`.

With these as tools, the corresponding `Bash(...)` grants leave
`scripts/gen-skill.ts` and the `/ost-*` command frontmatter.

### Phase 4 — Bundle, and make the bundle the launch path

Add `esbuild` as a devDependency and a bundle script:

```
esbuild src/cli/index.ts --bundle --platform=node --target=node20 \
  --format=esm --outfile=dist/ost-agent.mjs
```

`dist/ost-agent.mjs` is **committed**. `.gitignore` keeps ignoring `dist/` but
negates that one path:

```
dist/
!dist/ost-agent.mjs
```

`.claude-plugin/plugin.json` launches it directly:

```json
"mcpServers": {
  "ost-agent": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs", "mcp"],
    "env": { "OST_VAULT": "${CLAUDE_PROJECT_DIR}" }
  }
}
```

This requires `node` on `PATH`. That is strictly weaker than today's
requirement of `npx`, so no user who works now stops working.

**Drift guard.** A committed build artifact is only safe if it cannot silently
diverge from source. A CI job rebuilds the bundle and fails if the result
differs from the committed file:

```
npm run bundle && git diff --exit-code dist/ost-agent.mjs
```

This is the single control that makes the whole approach sound. It is not
optional.

**`package.json`** gets `"private": true` and loses `bin`, `files`,
`publishConfig`, `prepack`, and `prepublishOnly`. `"private": true` makes an
accidental `npm publish` fail at the client before it reaches the registry.

### Phase 5 — Remove the package from npm

Gated on Phase 1 being verified complete.

1. `npm unpublish ost-agent --force` — **run by the maintainer**; it needs npm
   auth this repo's tooling does not have. Permitted outside the 72-hour window
   because the package has no registry dependents, is under 300 weekly
   downloads, and has a single maintainer.
2. Delete `.github/workflows/npm-publish.yml`.

Two consequences to accept knowingly: the name `ost-agent` is locked for 24
hours afterward, and those version numbers can never be republished. Any
surviving plugin install pointing at `npx -y ost-agent@latest mcp` fails at
launch rather than degrading quietly — which is the desired signal.

### Phase 6 — Re-layout (separable)

After Phase 2, four directory names describe things that no longer exist:
`runner/` runs nothing, `eval/` evaluates nothing, `processes/` holds no
processes, `loop/` is empty.

| From | To |
| --- | --- |
| `src/runner/context.ts` | `src/ost/context.ts` (`PassContext` → `VaultContext`) |
| `src/runner/init.ts` | `src/ost/init.ts` |
| `src/runner/set-outcome.ts` | `src/ost/set-outcome.ts` |
| `src/eval/{coverage,evidence-debt,invariants}.ts` | `src/analysis/` |
| `src/processes/tree.ts` | `src/ost/tree.ts` |
| `src/processes/types.ts` | folded into `src/ost/context.ts` |

Leaving `src/` as: `adapters`, `analysis`, `cli`, `config`, `git`, `knowledge`,
`mcp`, `ost`, `product`, `security`, `telemetry`, `web`.

This phase is mechanical but touches import paths across most of `src/` and
`test/`. It is specified last and separately so it can be deferred without
blocking Phases 1–5; nothing in those phases depends on it.

### Phase 7 — Documentation and tests

**Docs.** `README.md` quickstart collapses to the plugin path, dropping
`npm install -g ost-agent` and the `npx` line. `RELEASING.md` is rewritten
around tag-and-bundle with no publish step. `docs/consuming-from-claude-code.md`
collapses from three install options to one.

**Skill and command generation.** `scripts/gen-skill.ts` and
`.claude/commands/ost-setup.md` drop their `Bash(npx -y ost-agent@latest …)`
grants. Setup shells out to `node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs`
for `init` and `set-outcome`.

**Tests deleted:** `test/runner/{driver,credentials,errors,pass,tool,journal}`,
`test/eval/` (harness portions only), `test/loop/`, and the
`test/processes/` cases covering `registry.ts`.

**Tests updated:** `test/skill/setup-command.test.ts`'s allowlist regex, and
`test/release/` for the changed `package.json` shape.

**Tests kept:** `test/cli/*` continue to exec `npx tsx src/cli/index.ts`. That
is a dev-time invocation of a local file, not a registry dependency, and is
unaffected by this work.

**Test added:** the Phase 4 drift guard, plus a case asserting
`.claude-plugin/plugin.json` references no `npx`.

## Risks

**The committed bundle drifts from source.** Mitigated by the Phase 4 CI guard,
which is the reason that guard is mandatory rather than nice-to-have.

**`node` is absent from a user's PATH.** The MCP server then fails to connect,
and Claude Code surfaces a connection error rather than a diagnosis. Accepted:
the current `npx` requirement is strictly stronger, so this regresses nobody.

**Phase 6's rename collides with in-flight branches.** Three branches
(`sql-evidence-reads`, `feat/transcript-harvester`, `web-lookup-trust`) predate
this work and touch `src/runner/` and `src/eval/`. Phase 6 is separable
precisely so it can be sequenced after those land or be abandoned cheaply.

## Success criteria

1. `grep -rn "npx\|npm install" README.md .claude-plugin/ .claude/ docs/consuming-from-claude-code.md`
   returns nothing. (`CONTRIBUTING.md` keeps its `npm install` for contributors,
   and `docs/superpowers/specs/` is historical record — both are out of scope.)
2. `grep -rn "ANTHROPIC_API_KEY\|@anthropic-ai/sdk" src/` returns nothing.
3. A fresh `/plugin install` on a machine with no network access to the npm
   registry brings up the MCP server and `/ost-status` answers.
4. `npm view ost-agent` 404s.
5. `npm run bundle && git diff --exit-code dist/ost-agent.mjs` passes in CI.
6. `ost_check`, `ost_debt`, `ost_status`, and `ost_gate` appear in
   `MCP_TOOL_NAMES` and return byte-identical text to their CLI counterparts.
