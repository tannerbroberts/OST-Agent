# Genome Extraction Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every policy governing how unknowns are handled out of TypeScript and into a declarative `genome.yaml` that the kernel interprets — and wire the Phase 1 ledger into a production path, so the genome is data something actually reads.

**Architecture:** A new `src/genome/` module owns a zod-validated `Genome` shape whose defaults *are* today's behavior. `buildPassContext` loads it once per pass and threads it onto `PassContext`, which reaches the tool surface through `ToolContext`. Each extracted policy — the token-tier weighting, the unknown classifier, the resolution state machine, the lookup budget, the pivot rule — becomes an interpreter over genome data behind a defaulted parameter, so every existing call site keeps working unchanged. Transcript token correlation lands as a new `src/eval/correlate.ts`, off by default, joining Claude Code session JSONL to the usage trace by `cwd` and tool-call intervals.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod v3, the `yaml` package (already a dependency, parse-only), vitest. **No new dependencies.**

## Why this phase is larger than "move some constants"

Phase 1 built the ledger and left it unwired. Verified before writing this plan:

- `computeAttention`, `readSessionTokens`, and `recordAttention` have **no production caller** — each appears only in its own module and its own test.
- **Nothing anywhere sets `OST_SESSION` or `OST_UNKNOWN`.** `src/telemetry/usage.ts:74,78` read them; the only writers in the repo are tests.
- `grep -rn "nknown" .claude/` returns **zero hits**. `.claude/commands/ost-pass.md` enumerates four work buckets; `openUnknowns` — shipped in Phase 1 — is not among them. A session running `/ost-pass` today cannot know unknowns exist.

So three of the genes the design names have no execution path at all. Extraction alone would produce a genome nothing reads and a fitness signal that is structurally zero. The wiring lands here, with the extraction, because the design says so: token correlation "has nothing real to correlate against until `OST_UNKNOWN` is set by the loop rather than by hand, which is this same phase."

## Decisions taken before implementation

These are settled. A task that contradicts one is wrong, not creative.

- **D1 — Location.** `genome.yaml` lives at the **vault root**, beside `ost.config.yaml`. It is **never scaffolded by `init`**; an absent file means the default genome, which keeps exactly one source of truth for defaults (the schema).
- **D2 — Strictness.** The genome schema is `.strict()`, unlike `ost.config.yaml` which strips unknown keys. A config strips so a pre-runner vault keeps loading; a genome is the artifact a harness mutates, and a misspelled allele silently dropped would read as "behaviour unchanged" — the one failure mode that corrupts a fitness record without announcing itself. Absent file ⇒ defaults, silently. Malformed file ⇒ throw.
- **D3 — Widened types.** `UnknownClass` and `ResolutionState` widen from string-literal unions to `string`, because zod cannot yield a compile-time union from runtime YAML. The design requires this: its own Least-settled section says `unreached` may not earn its own class, and a genome that can only emit three compiled-in labels cannot express that allele. The lost exhaustiveness is compensated by a schema `refine` that rejects a rule emitting a class outside the declared `classes` list.
- **D4 — Attribution mechanism.** `OST_UNKNOWN` is set from an **optional `unknown` property added to existing tools' `inputSchema`**, which `handleOstCall` writes into the environment around `await tool.run(args)` and clears in a `finally`. **No new tool name.** `ALLOWED_TOOL_NAMES` stays a frozen `as const` and the phase's verification asserts its length is unchanged.
- **D5 — `minSolutionsPerOpportunity` stays an operator knob** in `ost.config.yaml`. It is the one field an operator most plausibly tunes per vault, and the design names "ideation parameters" plural — the unnamed ones have no representation at all and are Phase 3 work. What this phase must still do: collapse the duplicate literal `?? 3` at `src/security/tools.ts:95` so one source of truth exists.
- **D6 — The budget fork.** `config.web.lookupBudget` remains **the operator's number**. `genome.budgets.sharedPool` defaults to `null`, meaning "use the operator's configured number"; only an explicit number overrides it. This is deliberate: `DEFAULT_LOOKUP_BUDGET` and `config.web.lookupBudget` are both `10` today, and shipping a third number that could silently disagree with either is worse than the duplication it would replace.
- **D7 — Token split is off by default.** `tokenSplit.enabled: false`. Under the default genome the correlator never runs, tokens stay `{0,0,0,0}`, and `weightedCost` stays `0` — exactly today. The correlator ships fully tested and is exercised by an explicit non-default genome. This is what "behavior matches today's" means for a subsystem that has never run in production.
- **D8 — Import direction.** `src/genome/` imports nothing from `src/knowledge/`. The direction is knowledge → genome and eval → genome. No cycles.

## Global Constraints

- **The allowlist does not grow.** `ALLOWED_TOOL_NAMES` (`src/security/policy.ts:12`, 18 names) and `MCP_TOOL_NAMES` (`src/mcp/server.ts:22`) are untouched by every task in this plan. `MUTATING` is derived as the complement of `READ_ONLY` precisely so a new tool cannot silently skip its auto-commit; `assertNoDestructiveTool` keeps running on the resolved set.
- **These are not genes, and no task may make them configurable.** Each is a fail-closed mechanism whose configurability would let a variant score well by corrupting the measurement rather than by being better: `ALLOWED_TOOL_NAMES`, `DESTRUCTIVE_TOKENS`/`assertNoDestructiveTool`, `LANES`/`computeMayRun`/`CAUTIOUS_LANE`, `flagHumansRequired`'s deliberately absent lane parameter, `checkInvariants`, `gateSolution`/`hasRecordedResult`, `recordResult`/`VERDICTS`, `setOutcome`, `SECRET_PATTERNS`/`redactSecrets`, `assertAllowedUrl`/`isPrivateIpv4`/`MAX_REDIRECTS`, `HOST_RUNGS`, `FLOOR_RUNG`, `CHILD_HIERARCHY`, and the append-only fail-open ledger writes. `OST_RULESET` is also **explicitly out of scope** — it is the largest policy table in the repo, but it is distilled Torres canon and safety rules, not unknown-handling policy.
- **The regression contract.** With the default genome — and with no `genome.yaml` present — behavior is identical to today's. Genome extraction is a refactor first and a capability second. Task 14 makes this executable, including a negative control, because items that only assert sameness can all pass vacuously.
- **Append-only.** No function in this plan deletes, truncates, or rewrites a file.
- **Fail-open telemetry.** `recordUsageEvent` and `recordAttention` never throw, by contract. The correlator inherits this: a missing transcript dir, an unreadable session file, or a malformed `usage` object degrades to an empty result, never a throw. A correlator that threw would take down `ost_status`.
- **Token tiers stay unmixed** in storage. Weighting is a read-time decision. Any genome-driven summing at write time would select for variants that merely re-read context — the exact corruption the discipline exists to prevent.
- **The genome is loaded once per pass**, in `buildPassContext`, and threaded. Never call `loadGenome` inside a tool closure. `src/security/tools.ts:485` and `src/adapters/friction.ts:78` both call `loadConfig` inside a run function; that is the anti-pattern, and copying it would let the genome change mid-pass and corrupt that run's fitness record.
- **ESM imports** carry the `.js` extension (e.g. `../knowledge/unknowns.js`). Omitting it compiles under `tsc` and fails at runtime under Node ESM — and `npm run bundle` produces the artifact the plugin actually launches.
- **Tests** live under `test/<mirror of src path>.test.ts`, use `import { describe, expect, test } from "vitest"` (never `it`), and use hand-written fixtures — the suite contains zero `vi.mock`, zero `vi.fn`, and zero snapshots.
- Run the full suite with `npm test` and the compile with `npm run build`. **Baseline before this plan: 69 files, 583 tests passing.**

## File Structure

| File | Responsibility |
|---|---|
| `src/genome/schema.ts` *(new)* | The `Genome` shape and its zod schema. Defaults live here and nowhere else — they *are* today's behavior. |
| `src/genome/load.ts` *(new)* | Discovery, parse, validate, default. `GENOME_FILENAME`, `genomePath`, `defaultGenome`, `loadGenome`. |
| `src/eval/correlate.ts` *(new)* | Joins Claude Code session JSONL to the usage trace and apportions tokens across unknowns. The only genuinely new subsystem in this phase. |
| `src/knowledge/unknowns.ts` | Classifier and resolution become interpreters over genome data. Types widen. |
| `src/eval/attention.ts` | Weighting becomes an option; the rollup gains a token dimension, a fourth spend bucket, and a recorded cost basis. |
| `src/adapters/tokens.ts` | Gains a timestamped extractor so a temporal split is possible at all. |
| `src/web/budget.ts` | One class-blind counter becomes a shared pool with optional per-class caps. |
| `src/mcp/next-work.ts` | The pivot gene decides what darkness is surfaced, in what order, and whether it blocks `done`. |
| `src/mcp/server.ts` | The single dispatch point sets and clears the `OST_UNKNOWN` marker. |
| `src/runner/context.ts`, `src/processes/types.ts`, `src/security/tools.ts` | Threading. One field each. |
| `src/eval/render.ts` | Attention finally reaches a human-readable surface, shared by the CLI and the MCP tool. |
| `scripts/gen-skill.ts`, `.claude/commands/ost-pass.md` | The loop learns that darkness is work it can pick up. |
| `docs/reference/genome.md` *(new)* | What an allele is, what is deliberately not evolvable, and why. |

---

### Task 1: The genome schema and loader

The genome is the whole phase's foundation: every later task takes its policy from a `Genome` value, and every later task's behavioral-identity claim rests on this file's defaults being today's values exactly. Nothing here reads the tree, the ledger, or the config — the genome module is a leaf, and stays one (design rule D8: direction is knowledge → genome, eval → genome, never back).

Two decisions are load-bearing and are implemented here rather than argued later:

- **`.strict()`, not strip.** `src/config/schema.ts:86-92` documents that config deliberately *strips* undeclared keys so a pre-runner vault keeps loading. A genome has no legacy vaults to protect — it does not exist yet — and it is the artifact a harness mutates. A misspelled allele silently dropped would read as "behaviour unchanged", which is the one failure mode that corrupts a fitness record without announcing itself. It must throw.
- **Absent ⇒ default, silently; malformed ⇒ throw.** `LoadConfigOptions.missing` (`src/config/load.ts:25-35`) exists because a *config* absence means "this is not a vault". A *genome* absence means nothing at all, so there is no `missing` option and no caller may ask for one. An invalid genome still throws, matching `loadConfig`'s documented rule that "a broken file is a mistake to report, not a state to tolerate".

**Files:**
- Create: `src/genome/schema.ts` (zod schema + the exported gene interfaces)
- Create: `src/genome/load.ts` (`GENOME_FILENAME`, `genomePath`, `defaultGenome`, `loadGenome`)
- Test: `test/genome/load.test.ts`

**Interfaces:**
- Consumes: nothing from this repo. `zod` (`^3.24.0`, already a dependency) and `parse as parseYaml` from `"yaml"` (`^2.6.0`, already a dependency, and `src/config/load.ts:6` is the only other importer). No new dependencies.
- Produces — every later task in Phase 2 imports from exactly these two modules:
  ```ts
  // src/genome/schema.ts
  export interface TokenWeightsGene { input: number; output: number; cacheCreate: number; cacheRead: number }
  export interface ClassifierRule { class: string; present: string[]; absent: string[] }
  export interface ClassifierGene { contractSections: string[]; classes: string[]; fallback: string; rules: ClassifierRule[] }
  export interface ResolutionRule { state: string; status: string[]; section?: string }
  export interface ResolutionGene { answerSection: string; fallback: string; rules: ResolutionRule[] }
  export interface BudgetsGene { sharedPool: number | null; perClass: Record<string, number>; onExhaustion: "instruct" | "record-unknown" }
  export interface PivotGene { unknownsBlockDone: boolean; maxOpenUnknownsSurfaced: number; ranking: "tree-order" | "cost-to-resolve" | "class-priority"; classPriority: string[] }
  export interface AttributionGene { staleAttribution: "drop" | "unattributed" }
  export interface TokenSplitGene { enabled: boolean; source: "transcript"; transcriptDir: string; method: "proportional-by-calls" | "proportional-by-ms" | "winner-take-all" | "none"; residual: "unattributed" | "proportional" | "nearest-preceding"; costBasis: "tokens" | "calls-and-ms" }
  export interface Genome { version: number; tokenWeights: TokenWeightsGene; classifier: ClassifierGene; resolution: ResolutionGene; budgets: BudgetsGene; pivot: PivotGene; attribution: AttributionGene; tokenSplit: TokenSplitGene }
  export const GenomeSchema: z.ZodType<Genome, z.ZodTypeDef, unknown>;

  // src/genome/load.ts
  export const GENOME_FILENAME = "genome.yaml";
  export function genomePath(vaultDir: string): string;
  export function defaultGenome(): Genome;
  export function loadGenome(vaultDir: string): Genome;
  ```

The interfaces are **hand-written and the schema is annotated with them** (`z.ZodType<Genome, …>`), rather than `type Genome = z.infer<typeof GenomeSchema>` as `src/config/schema.ts:119` does. That is deliberate: the gene interfaces are the contract nine other tasks are written against, they must be readable without running zod's inference, and the annotation makes any drift between schema and contract a compile error in *this* file rather than a mystery at a call site. (Verified: the annotation type-checks under the repo's `tsc --strict` NodeNext config.)

**Reference — the default genome as YAML.** This document is **documentation, not a file to write.** `init` must never scaffold it (`test/mcp/setup-mode.test.ts:65` and `test/mcp/bootstrap.test.ts:120` assert `fs.readdirSync(dir)).toEqual([])` after a refused call, and more importantly "absent ⇒ default" keeps exactly one source of truth for defaults — `defaultConfigYaml` (`src/config/schema.ts:123`) already demonstrates the drift hazard of a hand-authored template duplicating schema defaults). Everything below is what `defaultGenome()` returns:

```yaml
# OST-Agent genome — the policy the kernel interprets.
#
# Everything here is an ALLELE: a value the evolutionary harness may vary and
# measure. Anything NOT here is a trait excluded from evolution, deliberately:
# the tool allowlist, the lane gate, the invariant checker, the SSRF guard, the
# believability floor, and the promotion gate are fail-closed mechanisms, not
# policy. A variant that could relax them would score well by breaking the
# measurement rather than by being better.
#
# This file is optional, and it is never scaffolded. An absent genome.yaml IS
# this file.

version: 1

# What attention costs. Ratios, not currency — output is the dear one, a cache
# write costs a little more than fresh input, a cache read roughly a tenth.
tokenWeights:
  input: 1
  output: 5
  cacheCreate: 1.25
  cacheRead: 0.1

# How darkness is classed. Rules are first-match-wins; `fallback` is the floor.
# `classes` is the vocabulary, and it is data so that dropping `unreached` is an
# allele rather than a rewrite.
classifier:
  contractSections: [Format, Methodology, Rationale]   # order is load-bearing: contractGaps returns it
  classes: [bounded, unreached, unbounded]
  fallback: unbounded
  rules:
    - { class: unbounded, absent: [Format] }
    - { class: bounded, present: [Format, Methodology] }
    - { class: unreached, present: [Format] }

# How an unknown terminates. Order IS precedence: abandonment is checked first,
# so the human's call outranks a drafted answer.
resolution:
  answerSection: Answer
  fallback: open
  rules:
    - { state: abandoned, status: [deferred] }
    - { state: satisfied, status: [validated], section: Answer }

# How much looking outward one session may do. `sharedPool: null` means "use the
# operator's `web.lookupBudget`" — the genome does not shadow the operator's
# number until an allele explicitly names one. `perClass: {}` means one shared
# pool, class-blind: exactly today's single counter.
budgets:
  sharedPool: null
  perClass: {}
  onExhaustion: instruct

# What the loop does with darkness. v1 never pivots: exploration is reported,
# never blocks `done`, and is offered in tree order.
pivot:
  unknownsBlockDone: false
  maxOpenUnknownsSurfaced: 0    # 0 = unlimited
  ranking: tree-order
  classPriority: []

# What happens to a marker naming a title no longer on the tree.
attribution:
  staleAttribution: drop

# How one Claude Code session's tokens divide across the unknowns it touched.
# OFF in v1: nothing correlates tokens today, so `enabled: false` is what
# "behavior matches today's" means.
tokenSplit:
  enabled: false
  source: transcript
  transcriptDir: ""             # "" ⇒ derive from the VAULT dir, never the product repo
  method: proportional-by-calls
  residual: unattributed
  costBasis: tokens
```

- [ ] **Step 1: Write the failing test**

Create `test/genome/load.test.ts`:

```typescript
/**
 * The genome loader is the one place a policy can enter the kernel from
 * outside, so its two failure directions are opposite on purpose and both are
 * pinned here: an ABSENT genome is silently the default (every vault that
 * exists today has none, and behaviour must not change), while a PRESENT but
 * wrong genome is fatal (a misspelled allele that read as "behaviour
 * unchanged" would corrupt a fitness record without announcing itself).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { GENOME_FILENAME, defaultGenome, genomePath, loadGenome } from "../../src/genome/load.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ost-genome-"));

function write(dir: string, yaml: string): void {
  fs.writeFileSync(genomePath(dir), yaml, "utf8");
}

describe("defaultGenome", () => {
  test("materialises every gene from an empty document — the defaults live in the schema, nowhere else", () => {
    const g = defaultGenome();
    expect(g.version).toBe(1);
    expect(g.tokenWeights).toEqual({ input: 1, output: 5, cacheCreate: 1.25, cacheRead: 0.1 });
    expect(g.classifier.contractSections).toEqual(["Format", "Methodology", "Rationale"]);
    expect(g.classifier.classes).toEqual(["bounded", "unreached", "unbounded"]);
    expect(g.classifier.fallback).toBe("unbounded");
    expect(g.classifier.rules).toEqual([
      { class: "unbounded", present: [], absent: ["Format"] },
      { class: "bounded", present: ["Format", "Methodology"], absent: [] },
      { class: "unreached", present: ["Format"], absent: [] },
    ]);
    expect(g.resolution.answerSection).toBe("Answer");
    expect(g.resolution.fallback).toBe("open");
    expect(g.resolution.rules).toEqual([
      { state: "abandoned", status: ["deferred"] },
      { state: "satisfied", status: ["validated"], section: "Answer" },
    ]);
    expect(g.budgets.perClass).toEqual({});
    expect(g.budgets.onExhaustion).toBe("instruct");
    expect(g.pivot).toEqual({
      unknownsBlockDone: false,
      maxOpenUnknownsSurfaced: 0,
      ranking: "tree-order",
      classPriority: [],
    });
    expect(g.attribution.staleAttribution).toBe("drop");
    expect(g.tokenSplit.source).toBe("transcript");
    expect(g.tokenSplit.method).toBe("proportional-by-calls");
    expect(g.tokenSplit.residual).toBe("unattributed");
    expect(g.tokenSplit.costBasis).toBe("tokens");
  });

  test("sharedPool defaults to null — the operator's configured budget stays THE number until a genome says otherwise", () => {
    expect(defaultGenome().budgets.sharedPool).toBeNull();
  });

  test("tokenSplit is OFF by default — nothing correlates tokens today, and identity means today", () => {
    expect(defaultGenome().tokenSplit.enabled).toBe(false);
  });

  test("the resolution order IS the precedence — abandonment is checked before any drafted answer", () => {
    expect(defaultGenome().resolution.rules[0].state).toBe("abandoned");
  });
});

describe("loadGenome — an absent file", () => {
  test("an absent genome.yaml IS the default genome, silently — every vault alive today has none", () => {
    expect(loadGenome(tmp())).toEqual(defaultGenome());
  });

  test("reading a vault with no genome writes nothing — the file is NEVER scaffolded", () => {
    const dir = tmp();
    loadGenome(dir);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test("an empty genome.yaml is the default genome too — a file of comments declares nothing", () => {
    const dir = tmp();
    write(dir, "# a genome that overrides nothing\n");
    expect(loadGenome(dir)).toEqual(defaultGenome());
  });
});

describe("loadGenome — a partial genome", () => {
  test("one stated allele leaves every other gene at its default", () => {
    const dir = tmp();
    write(dir, "tokenWeights:\n  output: 9\n");
    const g = loadGenome(dir);
    expect(g.tokenWeights.output).toBe(9);
    expect(g.tokenWeights.input).toBe(1);
    expect(g.tokenWeights.cacheRead).toBe(0.1);
    expect(g.pivot.ranking).toBe("tree-order");
    expect(g.classifier.rules).toHaveLength(3);
  });

  test("an explicit sharedPool is the override the null default exists to allow", () => {
    const dir = tmp();
    write(dir, "budgets:\n  sharedPool: 4\n  perClass: { bounded: 3, unbounded: 1 }\n");
    const g = loadGenome(dir);
    expect(g.budgets.sharedPool).toBe(4);
    expect(g.budgets.perClass).toEqual({ bounded: 3, unbounded: 1 });
    expect(g.budgets.onExhaustion).toBe("instruct");
  });

  test("a two-class classifier parses — the vocabulary is data, so dropping `unreached` is an allele, not a rewrite", () => {
    const dir = tmp();
    write(
      dir,
      [
        "classifier:",
        "  classes: [bounded, unbounded]",
        "  fallback: unbounded",
        "  rules:",
        "    - { class: bounded, present: [Format] }",
        "",
      ].join("\n"),
    );
    const g = loadGenome(dir);
    expect(g.classifier.classes).toEqual(["bounded", "unbounded"]);
    expect(g.classifier.rules).toEqual([{ class: "bounded", present: ["Format"], absent: [] }]);
  });
});

describe("loadGenome — a wrong genome is fatal", () => {
  test("a misspelled gene throws rather than reading as `behaviour unchanged`", () => {
    const dir = tmp();
    write(dir, "tokenWeigths:\n  output: 9\n");
    expect(() => loadGenome(dir)).toThrow(/tokenWeigths/);
  });

  test("a misspelled allele inside a gene throws too — strictness goes all the way down", () => {
    const dir = tmp();
    write(dir, "pivot:\n  ranking: tree-order\n  maxOpen: 3\n");
    expect(() => loadGenome(dir)).toThrow(/maxOpen/);
  });

  test("a rule emitting a class outside `classes` throws — the guard that replaces the lost compile-time union", () => {
    const dir = tmp();
    write(
      dir,
      [
        "classifier:",
        "  classes: [bounded, unbounded]",
        "  fallback: unbounded",
        "  rules:",
        "    - { class: unreached, present: [Format] }",
        "",
      ].join("\n"),
    );
    expect(() => loadGenome(dir)).toThrow(/classes/);
  });

  test("a fallback outside `classes` throws — the floor must be a class something can read", () => {
    const dir = tmp();
    write(dir, "classifier:\n  classes: [bounded]\n  fallback: nope\n  rules: []\n");
    expect(() => loadGenome(dir)).toThrow(/classes/);
  });

  test("a classifier rule matching on nothing throws — it would fire on every node", () => {
    const dir = tmp();
    write(dir, "classifier:\n  rules:\n    - { class: unbounded }\n");
    expect(() => loadGenome(dir)).toThrow(/present/);
  });

  test("a resolution rule matching on nothing throws — satisfaction is NEVER claimed on absence of evidence", () => {
    const dir = tmp();
    write(dir, "resolution:\n  rules:\n    - { state: satisfied }\n");
    expect(() => loadGenome(dir)).toThrow(/status/);
  });

  test("an unparseable file names itself in the error — a vault carries more than one YAML", () => {
    const dir = tmp();
    write(dir, "classifier: [unclosed\n");
    expect(() => loadGenome(dir)).toThrow(new RegExp(GENOME_FILENAME));
  });

  test("a wrongly-typed leaf throws, naming the path to the gene", () => {
    const dir = tmp();
    write(dir, "tokenWeights:\n  output: heavy\n");
    expect(() => loadGenome(dir)).toThrow(/tokenWeights\.output/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/genome/load.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/genome/load.js"`; no test executes.

- [ ] **Step 3: Write the implementation**

Create `src/genome/schema.ts`:

```typescript
/**
 * `genome.yaml` schema + defaults — the policy the kernel interprets.
 *
 * Every field has a default, and the defaults ARE today's behavior: a vault
 * with no genome.yaml behaves exactly as it did before Phase 2. That is not a
 * convenience, it is the regression contract (design, "Testing → Regression").
 * The design rule this file exists to satisfy is blunt: anything compiled in is
 * a trait excluded from evolution. A policy expressed as a TypeScript table
 * cannot breed.
 *
 * Unlike `ost.config.yaml`, this schema is STRICT at every level. Config strips
 * undeclared keys on purpose (see `config/schema.ts`), so a pre-runner vault
 * keeps loading. A genome has no legacy vaults to protect — it did not exist
 * until now — and it is the artifact a harness mutates. A misspelled allele
 * silently dropped would read as "behaviour unchanged", which is the one
 * failure mode that corrupts a fitness record without announcing itself.
 *
 * The gene interfaces below are hand-written rather than inferred, and the
 * schema is annotated with them. Nine other modules are written against these
 * names; they must be readable without running zod's inference, and any drift
 * between the schema and the contract must be a compile error HERE rather than
 * a mystery at a call site.
 *
 * This module imports nothing from the rest of the repo, and must not start.
 * The direction is knowledge → genome and eval → genome; a genome that read the
 * tree could not be evaluated independently of one.
 */
import { z } from "zod";

/** Relative cost per token tier. Ratios, not currency. */
export interface TokenWeightsGene {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

/** One classifier rule: every `present` section must exist, every `absent` one must not. */
export interface ClassifierRule {
  class: string;
  present: string[];
  absent: string[];
}

export interface ClassifierGene {
  /** The contract's sections, in the order a session should declare them. Order is returned by `contractGaps`. */
  contractSections: string[];
  /** The class vocabulary. Data, so that dropping a class is an allele rather than a rewrite. */
  classes: string[];
  /** The floor, applied when no rule matches. */
  fallback: string;
  /** Evaluated top to bottom; first match wins. */
  rules: ClassifierRule[];
}

/** One resolution rule: any listed `status`, or the presence of `section`, matches. */
export interface ResolutionRule {
  state: string;
  status: string[];
  section?: string;
}

export interface ResolutionGene {
  answerSection: string;
  fallback: string;
  /** Order IS the precedence: abandonment before satisfaction. */
  rules: ResolutionRule[];
}

export interface BudgetsGene {
  /** `null` ⇒ use the operator's `config.web.lookupBudget`. Only an explicit number overrides it. */
  sharedPool: number | null;
  /** `{}` ⇒ class-blind, one shared counter — exactly today. */
  perClass: Record<string, number>;
  onExhaustion: "instruct" | "record-unknown";
}

export interface PivotGene {
  unknownsBlockDone: boolean;
  /** 0 = unlimited. */
  maxOpenUnknownsSurfaced: number;
  ranking: "tree-order" | "cost-to-resolve" | "class-priority";
  classPriority: string[];
}

export interface AttributionGene {
  staleAttribution: "drop" | "unattributed";
}

export interface TokenSplitGene {
  enabled: boolean;
  source: "transcript";
  /** `""` ⇒ derive from the VAULT dir, never the product repo. */
  transcriptDir: string;
  method: "proportional-by-calls" | "proportional-by-ms" | "winner-take-all" | "none";
  residual: "unattributed" | "proportional" | "nearest-preceding";
  costBasis: "tokens" | "calls-and-ms";
}

export interface Genome {
  version: number;
  tokenWeights: TokenWeightsGene;
  classifier: ClassifierGene;
  resolution: ResolutionGene;
  budgets: BudgetsGene;
  pivot: PivotGene;
  attribution: AttributionGene;
  tokenSplit: TokenSplitGene;
}

// What attention costs. Output is the dear one, a cache write costs a little
// more than fresh input, a cache read roughly a tenth — the published pricing
// order, carried as ratios so the weighting can be varied without a currency.
const TokenWeightsSchema = z
  .object({
    input: z.number().nonnegative().default(1),
    output: z.number().nonnegative().default(5),
    cacheCreate: z.number().nonnegative().default(1.25),
    cacheRead: z.number().nonnegative().default(0.1),
  })
  .strict()
  .default({});

const ClassifierRuleSchema = z
  .object({
    class: z.string().min(1),
    present: z.array(z.string().min(1)).default([]),
    absent: z.array(z.string().min(1)).default([]),
  })
  .strict()
  // A rule predicated on nothing matches every node, including one that
  // declares nothing at all — the fallback's job, not a rule's.
  .refine((r) => r.present.length > 0 || r.absent.length > 0, {
    message: "a classifier rule needs at least one `present` or `absent` section",
  });

// The v1 default reproduces `classifyUnknown` exactly: no Format → unbounded;
// Format and Methodology → bounded; Format alone → unreached.
const ClassifierSchema = z
  .object({
    contractSections: z.array(z.string().min(1)).default(["Format", "Methodology", "Rationale"]),
    classes: z.array(z.string().min(1)).min(1).default(["bounded", "unreached", "unbounded"]),
    fallback: z.string().min(1).default("unbounded"),
    rules: z.array(ClassifierRuleSchema).default([
      { class: "unbounded", present: [], absent: ["Format"] },
      { class: "bounded", present: ["Format", "Methodology"], absent: [] },
      { class: "unreached", present: ["Format"], absent: [] },
    ]),
  })
  .strict()
  .default({})
  // The compensating guard for widening `UnknownClass` to `string`: zod cannot
  // yield a compile-time union from runtime YAML, so exhaustiveness moves here.
  // A rule emitting a class outside the vocabulary would produce a `byClass`
  // bucket no reader expects, and would do it silently.
  .refine(
    (c) => c.rules.every((r) => c.classes.includes(r.class)) && c.classes.includes(c.fallback),
    { message: "every rule's `class` and the `fallback` must appear in `classes`" },
  );

const ResolutionRuleSchema = z
  .object({
    state: z.string().min(1),
    status: z.array(z.string().min(1)).default([]),
    section: z.string().min(1).optional(),
  })
  .strict()
  // Pinned, NOT an allele: satisfaction is never claimed on the absence of
  // evidence. A rule matching on nothing would fire on an unknown with no
  // answer at all, which is the one direction the ladder never runs.
  .refine((r) => r.status.length > 0 || r.section !== undefined, {
    message: "a resolution rule needs a `status` list or a `section` probe",
  });

// Order IS precedence. Abandonment is checked first so a deferred unknown reads
// as abandoned even when an answer was drafted — the human's call outranks the
// draft, and the spend that bought nothing stays visible.
const ResolutionSchema = z
  .object({
    answerSection: z.string().min(1).default("Answer"),
    fallback: z.string().min(1).default("open"),
    rules: z.array(ResolutionRuleSchema).default([
      { state: "abandoned", status: ["deferred"] },
      { state: "satisfied", status: ["validated"], section: "Answer" },
    ]),
  })
  .strict()
  .default({});

// `sharedPool: null` is the deliberate fork: `config.web.lookupBudget` stays
// THE operator's number, and the genome does not shadow it until an allele
// explicitly names one. Two numbers that can silently disagree would be worse
// than an unevolved budget.
const BudgetsSchema = z
  .object({
    sharedPool: z.number().int().positive().nullable().default(null),
    perClass: z.record(z.string(), z.number().int().nonnegative()).default({}),
    onExhaustion: z.enum(["instruct", "record-unknown"]).default("instruct"),
  })
  .strict()
  .default({});

// v1 never pivots. An unbounded unknown has no stopping condition, so counting
// it toward `done` would wedge every pass forever; exploration is reported and
// discretionary, exactly as it is today.
const PivotSchema = z
  .object({
    unknownsBlockDone: z.boolean().default(false),
    maxOpenUnknownsSurfaced: z.number().int().nonnegative().default(0), // 0 = unlimited
    ranking: z.enum(["tree-order", "cost-to-resolve", "class-priority"]).default("tree-order"),
    classPriority: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .default({});

const AttributionSchema = z
  .object({
    staleAttribution: z.enum(["drop", "unattributed"]).default("drop"),
  })
  .strict()
  .default({});

// OFF in v1. Nothing correlates tokens today, so `enabled: false` is what
// "behavior matches today's" means: tokens stay {0,0,0,0} and weighted cost
// stays 0. `costBasis` rides on every rollup so a comparison that mixes bases
// can be refused rather than silently normalized.
const TokenSplitSchema = z
  .object({
    enabled: z.boolean().default(false),
    source: z.enum(["transcript"]).default("transcript"),
    transcriptDir: z.string().default(""),
    method: z
      .enum(["proportional-by-calls", "proportional-by-ms", "winner-take-all", "none"])
      .default("proportional-by-calls"),
    residual: z.enum(["unattributed", "proportional", "nearest-preceding"]).default("unattributed"),
    costBasis: z.enum(["tokens", "calls-and-ms"]).default("tokens"),
  })
  .strict()
  .default({});

export const GenomeSchema: z.ZodType<Genome, z.ZodTypeDef, unknown> = z
  .object({
    version: z.number().int().positive().default(1),
    tokenWeights: TokenWeightsSchema,
    classifier: ClassifierSchema,
    resolution: ResolutionSchema,
    budgets: BudgetsSchema,
    pivot: PivotSchema,
    attribution: AttributionSchema,
    tokenSplit: TokenSplitSchema,
  })
  .strict();
```

Create `src/genome/load.ts`:

```typescript
/**
 * Load the genome from a vault directory.
 *
 * Two failure directions, opposite on purpose:
 *
 * ABSENT ⇒ the default genome, silently, always. There is no `missing` option
 * and no caller may ask for one. `loadConfig`'s equivalent exists because a
 * missing *config* means "this directory is not a vault"; a missing *genome*
 * means nothing at all — every vault in existence has none, and every one of
 * them must keep behaving exactly as it does today.
 *
 * PRESENT BUT WRONG ⇒ throws, naming the file and every offending path, on the
 * precedent `loadConfig` sets: a broken file is a mistake to report, not a
 * state to tolerate. Combined with the schema's strictness this is the point of
 * the whole module — a typo'd allele must never read as "behaviour unchanged",
 * because a fitness record computed under a policy nobody applied is worse than
 * no record.
 *
 * Load it ONCE per pass, in `buildPassContext`, and thread it. Never call this
 * inside a tool closure: a genome re-read mid-pass would let the policy change
 * under a run whose fitness is being measured.
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { GenomeSchema, type Genome } from "./schema.js";

export const GENOME_FILENAME = "genome.yaml";

/** Beside `ost.config.yaml` at the vault root: policy a human reads lives where a human looks. */
export function genomePath(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), GENOME_FILENAME);
}

/**
 * The genome that reads no file at all. Defaults come from the schema and are
 * never restated in a hand-kept object — a second copy is a second thing to
 * drift, and the whole regression contract rests on there being one.
 */
export function defaultGenome(): Genome {
  return GenomeSchema.parse({});
}

/** Read + validate the genome. An absent file is the default; a broken one throws. */
export function loadGenome(vaultDir: string): Genome {
  const p = genomePath(vaultDir);
  if (!fs.existsSync(p)) return defaultGenome();
  let raw: unknown;
  try {
    raw = parseYaml(fs.readFileSync(p, "utf8")) ?? {};
  } catch (err) {
    // The YAML parser's own error names a line, not a file, and a vault carries
    // more than one YAML. Say which one.
    throw new Error(`invalid ${GENOME_FILENAME}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = GenomeSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`invalid ${GENOME_FILENAME}:\n${issues}`);
  }
  return result.data;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/genome/load.test.ts`
Expected: PASS — 18 tests.

Then run: `npm run build`
Expected: clean compile. The `z.ZodType<Genome, z.ZodTypeDef, unknown>` annotation is the assertion that the schema's inferred output matches the hand-written contract; if it errors, fix the *schema* to match the interface, never the interface to match the schema — nine later tasks are written against the interface.

Then run: `npm test`
Expected: PASS — 70 files (69 + `test/genome/load.test.ts`), 601 tests (583 + 18). No existing file is touched by this task, so any other failure is unrelated and must be investigated before proceeding.

- [ ] **Step 5: Commit**

```bash
git add src/genome/schema.ts src/genome/load.ts test/genome/load.test.ts
git commit -m "feat(genome): the policy the kernel interprets, written down"
```

---

### Task 2: Thread the genome through every context

The genome is loaded in exactly one place — `buildPassContext` — and handed down. Nothing else in the repo may call `loadGenome`.

This is the task where a real anti-pattern already in the tree becomes tempting: `ost_ingest_inbox` calls `loadConfig(dir)` **inside its `run`** (`src/security/tools.ts:485`), and `fileFriction` does the same (`src/adapters/friction.ts:78`). Both re-read config on every invocation, ignoring the config the pass already loaded. A `loadGenome(dir)` written that way would let the policy a pass is being measured under change *while the pass is running* — which does not produce a slightly wrong number, it produces a fitness record that describes no genome at all. **Do not copy that shape.** Load once, in `buildPassContext`, and thread it. The MCP server already caches its `PassContext` for the process lifetime (`src/mcp/server.ts:225-241`, `live` + `acquire`), which is exactly the once-per-pass property a fitness record needs.

Nothing *reads* the genome yet — Tasks 4-11 do. What this task establishes is the single load point, the single resolution point, and the guarantee that neither can be bypassed later.

This task also collapses the duplicated `minSolutionsPerOpportunity` default (D5). It stays an operator knob in `ost.config.yaml`, not an allele — it is the one field an operator most plausibly tunes per vault. But `src/config/schema.ts:94` declares `.default(3)`, `src/config/schema.ts:163` scaffolds the literal `3` into the YAML, and `src/security/tools.ts:95` independently hard-codes `?? 3`. Three literals, no source of truth. One exported constant, used in all three.

**Files:**
- Modify: `src/config/schema.ts` (export `DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY`; use it in `ProcessSchema` and in `defaultConfigYaml`)
- Modify: `src/processes/types.ts` (`PassContext` gains `genome: Genome`)
- Modify: `src/runner/context.ts` (`buildPassContext` loads the genome once, beside `loadConfig`, respecting `listingOnly`)
- Modify: `src/security/tools.ts` (`ToolContext` gains `genome?: Genome`; `buildOstTools` resolves `ctx.genome ?? defaultGenome()` once; `minSolutions` uses the constant)
- Modify: `src/mcp/server.ts` (`buildDefs` passes `genome: ctx.genome`)
- Test: `test/genome/threading.test.ts`

**Interfaces:**
- Consumes (Task 1): `Genome` from `src/genome/schema.js`; `GENOME_FILENAME`, `genomePath(vaultDir: string): string`, `defaultGenome(): Genome`, `loadGenome(vaultDir: string): Genome` from `src/genome/load.js`.
- Produces:
  - `PassContext.genome: Genome` — non-optional; every `buildPassContext` return carries it.
  - `ToolContext.genome?: Genome` — optional; absent ⇒ `defaultGenome()`, which is today's behaviour exactly.
  - `export const DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY = 3` from `src/config/schema.js`.
  - Task 6 reads `genome.budgets` at the `buildOstTools` resolution point; Task 8 reads `genome.pivot` there; Task 11 reads `ctx.genome` off `PassContext` in `renderStatus`.

- [ ] **Step 1: Write the failing test**

Create `test/genome/threading.test.ts`:

```typescript
/**
 * The genome is loaded ONCE per pass, at the assembly point, and threaded down.
 *
 * This file exists because the shortcut is already in the codebase to copy:
 * `ost_ingest_inbox` calls `loadConfig(dir)` inside its `run`, and `fileFriction`
 * does the same. A `loadGenome(dir)` written that way would let the policy a pass
 * is measured under change while the pass is running — which does not produce a
 * wrong number, it produces a fitness record that describes no genome at all.
 *
 * So these tests pin the load POINT, not only the loaded value: they mutate
 * genome.yaml after the context is built and insist that nothing notices. They
 * also pin the absence contract — `init` never scaffolds a genome, and a vault
 * without one runs on defaults that are today's behaviour written down.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY } from "../../src/config/schema.js";
import { defaultGenome, genomePath } from "../../src/genome/load.js";
import { buildPassContext } from "../../src/runner/context.js";
import { initVault } from "../../src/runner/init.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";

const OUTCOME = "Reach 10,000 daily active users";
const ROOT = "Retention";

interface Runnable {
  name: string;
  run: (input: unknown) => Promise<string>;
}

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-genome-thread-"));
  await initVault(dir, OUTCOME, ROOT);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function writeGenome(yaml: string): void {
  fs.writeFileSync(genomePath(dir), yaml, "utf8");
}

function toolsFrom(ctx: ToolContext): Runnable[] {
  return buildOstTools(ctx) as unknown as Runnable[];
}

/** Build a fresh context, find the tool, run it — the ordinary one-call path. */
async function call(name: string, input: unknown): Promise<string> {
  const tool = toolsFrom(buildPassContext(dir)).find((t) => t.name === name);
  if (!tool) throw new Error(`no such tool: ${name}`);
  return tool.run(input);
}

describe("the genome a pass runs on", () => {
  test("a vault with no genome.yaml runs on the default genome — absence IS the default", () => {
    expect(fs.existsSync(genomePath(dir))).toBe(false); // init NEVER scaffolds one
    const ctx = buildPassContext(dir);
    expect(ctx.genome).toEqual(defaultGenome());
    // The budget fork: a null shared pool means "use the operator's configured
    // number", so a vault never carries two lookup limits that can disagree.
    expect(ctx.genome.budgets.sharedPool).toBeNull();
  });

  test("a genome.yaml beside ost.config.yaml is what the pass runs on", () => {
    writeGenome("tokenWeights:\n  output: 9\nbudgets:\n  sharedPool: 4\n");
    const ctx = buildPassContext(dir);
    expect(ctx.genome.tokenWeights.output).toBe(9);
    expect(ctx.genome.budgets.sharedPool).toBe(4);
    // An untouched leaf keeps its default, and an untouched section materialises
    // whole — a partial genome is a genome, not a hole.
    expect(ctx.genome.tokenWeights.input).toBe(1);
    expect(ctx.genome.pivot.ranking).toBe("tree-order");
  });

  test("a misspelled allele throws from buildPassContext — a typo may NOT read as behaviour unchanged", () => {
    writeGenome("tokenWieghts:\n  output: 9\n");
    expect(() => buildPassContext(dir)).toThrow(/genome\.yaml/);
    expect(() => buildPassContext(dir)).toThrow(/tokenWieghts/);
  });

  test("a listing-only context takes the defaults without reading the file — a broken genome cannot take down the tool listing", () => {
    writeGenome("tokenWieghts: {}\n");
    const ctx = buildPassContext(dir, { listingOnly: true });
    expect(ctx.genome).toEqual(defaultGenome());
  });
});

describe("the genome reaches the tools, and never changes under them", () => {
  test("the object handed to buildOstTools carries the pass's genome", () => {
    writeGenome("budgets:\n  sharedPool: 4\n");
    const toolCtx: ToolContext = buildPassContext(dir);
    expect(toolCtx.genome?.budgets.sharedPool).toBe(4);
    expect(toolsFrom(toolCtx).map((t) => t.name)).toContain("ost_next_work");
  });

  test("a tool set built with NO genome still builds — an absent genome is the default one", () => {
    const ctx: ToolContext = { vault: buildPassContext(dir).vault, dir, remote: { enabled: false } };
    expect(ctx.genome).toBeUndefined();
    expect(toolsFrom(ctx).map((t) => t.name)).toContain("ost_read_tree");
  });

  test("the genome does NOT change mid-pass — the tools hold the one the pass began with", async () => {
    writeGenome("budgets:\n  sharedPool: 4\n");
    const ctx = buildPassContext(dir);
    const readTree = toolsFrom(ctx).find((t) => t.name === "ost_read_tree")!;

    // Replace the file with one that would THROW if anything re-read it.
    writeGenome("tokenWieghts:\n  output: 9\n");

    const out = await readTree.run({});
    expect(out).toContain(ROOT);
    expect(ctx.genome.budgets.sharedPool).toBe(4);
  });
});

describe("minSolutionsPerOpportunity has exactly one literal", () => {
  test("the schema default, the scaffolded config, and the tool-side fallback are the SAME constant", async () => {
    // 1. the schema default, reached through the config `init` scaffolded
    expect(buildPassContext(dir).config.processes["P3_ideate"].minSolutionsPerOpportunity).toBe(
      DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY,
    );

    // 2. the tool-side fallback. A PassContext carries no `minSolutionsPerOpportunity`
    // field at all, so building tools from one exercises the `??` branch directly.
    await call("ost_create_node", {
      title: "Exports are slow",
      layer: "Opportunity",
      parent: ROOT,
      body: "customers say the export takes minutes",
      evidence: "assertion",
    });
    const work = JSON.parse(await call("ost_next_work", {}));
    expect(work.underservedOpportunities[0].title).toBe("Exports are slow");
    expect(work.underservedOpportunities[0].needed).toBe(DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/genome/threading.test.ts`

Expected: FAIL — the file does not even load. Vite resolves the named import first: `SyntaxError: The requested module '/src/config/schema.ts' does not provide an export named 'DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY'`. After Step 3's config edit lands, the next failure is from the first test — `expected undefined to deeply equal { version: 1, tokenWeights: { input: 1, output: 5, … }, … }` — because `buildPassContext` does not yet return a `genome`.

- [ ] **Step 3: Write the implementation**

**3a.** In `src/config/schema.ts`, replace the `ProcessSchema` block (currently lines 84-95) with the constant plus a schema that references it:

```typescript
/**
 * How many candidate solutions an opportunity needs before `ost_next_work`
 * stops calling it under-served.
 *
 * Exported because three places need this number — the schema default, the
 * scaffolded `ost.config.yaml`, and the fallback in `buildOstTools` for a
 * ToolContext assembled without a config — and until now the third was an
 * independent literal `3` that could drift from the other two silently.
 *
 * It stays an OPERATOR knob rather than a genome allele: it is the single field
 * an operator most plausibly tunes per vault, and `test/config/load.test.ts`
 * pins it there. But a policy with two sources of truth cannot be reasoned
 * about at all, evolvable or not.
 */
export const DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY = 3;

// Per-process tuning. `minSolutionsPerOpportunity` is the only knob left: it is
// what `ost_next_work` uses to decide an opportunity is under-served.
//
// Vaults created before the API-key runner was deleted still carry `cron`,
// `triggers`, and `limits` here, and `model` at the top level — they scheduled
// and bounded passes that no longer exist. Those keys are deliberately NOT
// declared and deliberately NOT rejected: this schema uses Zod's default
// object behaviour, which strips undeclared keys instead of failing, so an
// existing vault keeps loading and simply stops being asked about a model.
// (`genome.yaml` is deliberately the opposite — strict — because a dropped
// allele would read as "behaviour unchanged".)
const ProcessSchema = z.object({
  minSolutionsPerOpportunity: z.number().int().positive().default(DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY),
});
```

In the same file, inside `defaultConfigYaml`'s template literal, replace the scaffolded literal:

```typescript
processes:
  P3_ideate:
    minSolutionsPerOpportunity: ${DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY}   # how many candidate solutions an opportunity needs before \`ost_next_work\` stops calling it under-served
```

**3b.** In `src/processes/types.ts`, add the import and the field. Put `genome` immediately after `config` — the two are loaded together and mean the same kind of thing at different altitudes (what the operator set, versus what the kernel interprets):

```typescript
import type { Genome } from "../genome/schema.js";
```

```typescript
export interface PassContext {
  vault: Vault;
  /** Vault directory (git working tree + `.ost-agent/`). */
  dir: string;
  config: Config;
  /**
   * The policy this pass interprets: every allele governing how unknowns are
   * classed, resolved, budgeted, and costed. Loaded exactly ONCE, by
   * `buildPassContext`, and never re-read — a pass whose policy could change
   * underneath it produces a fitness record that describes no genome at all.
   *
   * Non-optional. An absent `genome.yaml` is not a missing genome; it is the
   * default genome, which is today's behaviour written down.
   */
  genome: Genome;
  ruleset: typeof OST_RULESET;
  /** Enabled read-only sources. */
  sources: Source[];
  remote: RemoteConfig;
  /** Outward web sensing: search key, injectable fetch, per-session lookup budget. */
  web?: { searchApiKey?: string; fetchFn?: WebFetchFn; budget?: LookupBudget };
  /** Local product repo roots the agent may read (config `product.repos`). */
  productRepos?: readonly string[];
}
```

**3c.** In `src/runner/context.ts`, add the import beside the config one:

```typescript
import { defaultGenome, loadGenome } from "../genome/load.js";
```

and load it directly under the `config` line (currently line 47):

```typescript
  const dir = path.resolve(vaultDir);
  const config = opts.listingOnly ? defaultConfig() : loadConfig(dir, opts.allowMissingConfig ? { missing: "defaults" } : {});
  // The genome is loaded exactly ONCE per pass, here, beside the config — and
  // never inside a tool's `run`. Two functions in this repo re-read config per
  // invocation (`ost_ingest_inbox` in src/security/tools.ts, `fileFriction` in
  // src/adapters/friction.ts); the same shape applied to the genome would let a
  // pass change its own policy while running, which corrupts the fitness record
  // rather than merely the run. There is no `allowMissingConfig` analogue: an
  // absent genome.yaml is not a missing vault, it is the default policy, always
  // and silently. A malformed one throws, exactly as a malformed config does.
  // `listingOnly` renders a tool listing for a directory that may not be a vault
  // and must not read vault files, so it takes the defaults without touching disk.
  const genome = opts.listingOnly ? defaultGenome() : loadGenome(dir);
  const skipSources = opts.skipSources === true || opts.listingOnly === true;
```

and add it to the returned object, beside `config`:

```typescript
  return {
    vault: new Vault(dir, { create: !opts.listingOnly }),
    dir,
    config,
    genome,
    ruleset: OST_RULESET,
    sources,
    remote: { enabled: config.remote.enabled, url: config.remote.url },
    // The key is optional: ost_read_web works without it, and ost_search_web
    // answers with the setup hint at call time rather than failing the build.
    web: {
      searchApiKey: process.env.BRAVE_SEARCH_API_KEY,
      budget: createLookupBudget(config.web.lookupBudget),
    },
    productRepos: config.product.repos,
  };
```

**3d.** In `src/security/tools.ts`, add the imports (note `loadConfig` is already imported from `../config/load.js`; the constant comes from the schema module):

```typescript
import { DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY } from "../config/schema.js";
import { defaultGenome } from "../genome/load.js";
import type { Genome } from "../genome/schema.js";
```

Add the field to `ToolContext`, after `minSolutionsPerOpportunity`:

```typescript
  /**
   * The pass's genome — the policy this tool set interprets. Optional because a
   * ToolContext is also assembled by hand (tests, the CLI's narrow surfaces);
   * absent means the default genome, which is today's behaviour exactly. A
   * `PassContext` satisfies this structurally, so the MCP and CLI surfaces get
   * it for free.
   */
  genome?: Genome;
```

And in `buildOstTools`, replace the `minSolutions` line and add the single resolution point:

```typescript
export function buildOstTools(ctx: ToolContext, allowedNames?: readonly string[]) {
  const { vault, dir, remote } = ctx;
  const minSolutions = ctx.minSolutionsPerOpportunity ?? DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY;
  // Resolved ONCE here, at tool-set construction, and captured by every closure
  // below — never re-read inside a tool's `run`. `ost_ingest_inbox` further down
  // this file calls `loadConfig(dir)` per invocation; that is the shape to avoid,
  // not the shape to copy. Nothing reads `genome` yet (the budget gene lands in
  // Task 6, the pivot gene in Task 8); the resolution point exists first so that
  // when they do, there is exactly one of it and it is above every closure.
  const genome: Genome = ctx.genome ?? defaultGenome();
  // One budget for all web lookups this pass/session — created here if the
  // context didn't bring one, so the bound holds on every surface.
  const lookupBudget = ctx.web?.budget ?? createLookupBudget();
  const rankedBy = `agent${ctx.surface ? `:${ctx.surface}` : ""}`;
```

`tsconfig.json` does not set `noUnusedLocals`, so an as-yet-unread local is not a build error. **Do not delete the line, and do not silence it with `void genome`** — Task 6 reads it.

**3e.** In `src/mcp/server.ts`, `buildDefs` (line 89), add one line to the `buildOstTools` call:

```typescript
function buildDefs(ctx: PassContext): McpToolDef[] {
  const built = buildOstTools(
    {
      vault: ctx.vault,
      dir: ctx.dir,
      remote: ctx.remote,
      genome: ctx.genome,
      minSolutionsPerOpportunity: ctx.config.processes["P3_ideate"]?.minSolutionsPerOpportunity,
      surface: "mcp",
      web: ctx.web,
      productRepos: ctx.productRepos,
      passContext: ctx,
    },
    MCP_TOOL_NAMES,
  );
```

The lazy server caches its `PassContext` for the process lifetime (`createLazyOstMcpServer`, `live` + `acquire`), so this reads the genome once per server launch — one genome per long-lived session, which is the unit a fitness record is about.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/genome/threading.test.ts`
Expected: PASS — 8 tests.

Then the full gate:

Run: `npm test && npm run build`
Expected: PASS — the whole suite, plus a clean `tsc`. Two things to watch:
- `test/config/load.test.ts:28,61` still assert `3` and `5` as literals. They must keep passing untouched — the constant is a refactor, not a value change. If either fails, the constant is wrong.
- `test/security/policy.test.ts`, `test/security/web-tools.test.ts`, and `test/security/lane-capability.test.ts` build hand-written `ToolContext` literals with no `genome`. They must compile and pass unchanged; that is what `genome?` being optional buys.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/processes/types.ts src/runner/context.ts src/security/tools.ts src/mcp/server.ts test/genome/threading.test.ts
git commit -m "feat(genome): one genome per pass, loaded where the pass begins"
```

---

### Task 3: G1 — the token-weighting gene

The cost model stops being a constant in `eval/` and becomes an allele the genome supplies. This is the smallest genuine extraction in Phase 2 and the one that establishes the pattern every later gene copies: **the numbers live in `GenomeSchema`'s defaults and nowhere else**, the old exported const survives as a *reader* of those defaults rather than a second literal, and the function grows an options object instead of a fourth positional.

`computeAttention`'s third positional is already load-bearing (`weights`), and Tasks 5 and 11 need to hand it three more things (classifier, resolution, correlated tokens). Widening it to `AttentionOptions` now — while exactly one field is read and there are nine two-argument call sites to protect — is cheaper than doing it under load later.

**Verified before writing:** all nine `computeAttention` call sites in `test/eval/attention.test.ts` (`:45, :55, :66, :84, :97, :103, :114, :128, :140`) use the two-argument form. Zero production callers exist anywhere in `src/` or `scripts/` — the only other mention is a doc comment at `src/adapters/tokens.ts:24`, which needs no edit. `DEFAULT_TOKEN_WEIGHTS` is imported by name at `test/eval/attention.test.ts:5` and spread at `:33`; deleting it is a compile error, so it stays exported.

**Files:**
- Modify: `src/eval/attention.ts` (module JSDoc; `TokenWeights` becomes an alias of `TokenWeightsGene`; `DEFAULT_TOKEN_WEIGHTS` derives from `defaultGenome()`; new `AttentionOptions`; `computeAttention`'s third parameter changes from `weights` to `opts`)
- Test: `test/eval/attention.test.ts` (append one `describe` block; add two imports)

**Interfaces:**
- Consumes (Task 1):
  - `export interface TokenWeightsGene { input: number; output: number; cacheCreate: number; cacheRead: number }` from `src/genome/schema.js`
  - `export function defaultGenome(): Genome` and `export function loadGenome(vaultDir: string): Genome` from `src/genome/load.js`
- Produces:
  - `export type TokenWeights = TokenWeightsGene` — kept as an alias so every existing importer compiles unchanged
  - `export const DEFAULT_TOKEN_WEIGHTS: TokenWeights` — **derived**, `= defaultGenome().tokenWeights`, not a literal
  - `export interface AttentionOptions { weights?: TokenWeightsGene; classifier?: ClassifierGene; resolution?: ResolutionGene; attribution?: AttributionGene }` — all four declared here in one go; Task 11 adds the last two fields (`correlated?`, `costBasis?`)
  - `export function computeAttention(tree: readonly OstNode[], vaultDir: string, opts?: AttentionOptions): AttentionRollup`
  - `weightedTokenCost(tokens: TokenTiers, weights?: TokenWeights): number` — signature unchanged; it already took the weights

**The one-source-of-truth decision, stated:** the four numbers live as `.default(…)` values inside `TokenWeightsSchema` in `src/genome/schema.ts`. `DEFAULT_TOKEN_WEIGHTS` **reads** them at module load via `defaultGenome().tokenWeights`. It is not a mirror and not a duplicate — there is one literal `5` for output cost in the repo after this task, and it is in the schema. A vault with no `genome.yaml` and a vault carrying the shipped default therefore cannot disagree, because they resolve through the same parse.

- [ ] **Step 1: Write the failing test**

Add two imports at the top of `test/eval/attention.test.ts`, after the vitest import and before the `src/eval/attention.js` import (alphabetical by path, matching the file's existing order):

```typescript
import { defaultGenome, loadGenome } from "../../src/genome/load.js";
```

Then append this block to the end of `test/eval/attention.test.ts`:

```typescript
describe("the token-weighting gene", () => {
  test("the exported default IS the genome's default — one literal for the cost model, or none", () => {
    // A drift guard, not a behavior test: it passes today because two hand-kept
    // literals happen to agree, and its job is to fail the moment they stop.
    expect(DEFAULT_TOKEN_WEIGHTS).toEqual(defaultGenome().tokenWeights);
  });

  test("the shipped default preserves published pricing order — cache reads are cheap, output is dear", () => {
    const w = defaultGenome().tokenWeights;
    expect(w.cacheRead).toBeLessThan(w.input);
    expect(w.input).toBeLessThan(w.cacheCreate);
    expect(w.cacheCreate).toBeLessThan(w.output);
  });

  test("a genome that prices output cheaply lowers what the same answer cost", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "U", kind: "spend", calls: 1, ms: 1,
      tokens: { input: 100, output: 10, cacheCreate: 0, cacheRead: 0 } });
    fs.writeFileSync(
      path.join(dir, "genome.yaml"),
      "tokenWeights:\n  input: 1\n  output: 1\n  cacheCreate: 1.25\n  cacheRead: 0.1\n",
      "utf8",
    );

    const shipped = computeAttention([unknown("U")], dir);
    const cheap = computeAttention([unknown("U")], dir, { weights: loadGenome(dir).tokenWeights });

    expect(shipped.unknowns[0].weightedCost).toBe(150); // 100×1 + 10×5
    expect(cheap.unknowns[0].weightedCost).toBe(110); // 100×1 + 10×1
    expect(shipped.unknowns[0].tokens).toEqual(cheap.unknowns[0].tokens); // tiers stay unmixed either way
  });

  test("a class rollup is weighted by the supplied gene too, not only the per-unknown line", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "U", kind: "spend", calls: 1, ms: 1,
      tokens: { input: 0, output: 100, cacheCreate: 0, cacheRead: 0 } });
    const dear = computeAttention([unknown("U")], dir);
    const flat = computeAttention([unknown("U")], dir, {
      weights: { ...DEFAULT_TOKEN_WEIGHTS, output: 1 },
    });
    expect(dear.byClass.bounded.weightedCost).toBeGreaterThan(flat.byClass.bounded.weightedCost);
  });

  test("omitting the options object reproduces the default genome exactly — an absent gene is the shipped one", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "U", kind: "spend", calls: 2, ms: 40,
      tokens: { input: 100, output: 10, cacheCreate: 8, cacheRead: 900 } });
    const bare = computeAttention([unknown("U")], dir);
    expect(computeAttention([unknown("U")], dir, {})).toEqual(bare);
    expect(computeAttention([unknown("U")], dir, { weights: defaultGenome().tokenWeights })).toEqual(bare);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/eval/attention.test.ts`

Expected: FAIL — 3 of the 5 new tests. The third parameter is still `weights: TokenWeights`, so `{ weights: … }` is read as a weights object whose four tier fields are all `undefined`, and every multiplication in `weightedTokenCost` yields `NaN`:

- `a genome that prices output cheaply…` → `expected NaN to be 110`
- `a class rollup is weighted by the supplied gene too…` → `expected NaN to be greater than NaN`
- `omitting the options object reproduces the default genome exactly…` → `expected { …weightedCost: NaN } to deeply equal { …weightedCost: 150 }`

The two remaining tests pass before the change — they are drift and ordinal guards, and their passing here is the point. `npm run build` stays clean — `tsconfig.json` excludes `test/`, so a test-file type error surfaces only as the runtime failure above.

- [ ] **Step 3: Write the implementation**

Three edits to `src/eval/attention.ts`.

**(a)** Replace the second paragraph of the module JSDoc (`:10-12`) — it currently promises this task as future work, and after this task it is describing the present:

```typescript
 * The token weighting lives here rather than in the store on purpose. Summing
 * tiers at write time would bake in a cost model; here it is read-time policy,
 * and as of Phase 2 the numbers themselves are an allele — `tokenWeights` in
 * `genome.yaml` — rather than a constant this module owns. `DEFAULT_TOKEN_WEIGHTS`
 * below is a READER of the genome's defaults, not a second copy of them: a vault
 * with no genome.yaml and a vault carrying the shipped default resolve through
 * the same parse and therefore cannot disagree.
```

**(b)** Add the genome imports at the head of the import block (alphabetical by path, so before `../knowledge/unknowns.js`), and replace the `TokenWeights` interface and `DEFAULT_TOKEN_WEIGHTS` const (`:31-48`) with the alias and the derived default:

```typescript
import { defaultGenome } from "../genome/load.js";
import type { AttributionGene, ClassifierGene, ResolutionGene, TokenWeightsGene } from "../genome/schema.js";
import { classifyUnknown, resolutionState, UNKNOWN_CLASSES, type ResolutionState, type UnknownClass } from "../knowledge/unknowns.js";
import type { OstNode } from "../ost/node.js";
import { addTiers, emptyTiers, readAttention, type TokenTiers } from "../telemetry/attention.js";
import { usageLogPath } from "../telemetry/usage.js";
import fs from "node:fs";

/**
 * The cost model, structurally identical to the genome's `tokenWeights` gene
 * because it IS that gene. The alias is kept exported so every existing
 * importer compiles unchanged while the numbers move out of TypeScript.
 */
export type TokenWeights = TokenWeightsGene;

/**
 * Relative cost per tier, tracking published pricing ratios: output is the
 * dear one, a cache write costs a little more than fresh input, and a cache
 * read is roughly a tenth. These are ratios, not currency.
 *
 * Read from the genome schema's defaults rather than restated here. There is
 * exactly one literal `5` for the cost of an output token in this repo and it
 * lives in `GenomeSchema`; this const is how the rest of `eval/` reaches it.
 */
export const DEFAULT_TOKEN_WEIGHTS: TokenWeights = defaultGenome().tokenWeights;
```

The import direction is eval → genome. The genome module imports nothing from `eval/` or `knowledge/`, so there is no cycle.

**(c)** Replace `computeAttention`'s signature (`:146-151`) and add the options interface immediately above it. Everything from `const darkNodes = …` onward is unchanged except that `weights` is now a local:

```typescript
/**
 * Which alleles this rollup is computed under. An object rather than more
 * positionals: the third argument is already load-bearing at nine call sites,
 * and later genes (the classifier, the resolution machine, correlated token
 * cost) need to arrive here too without any of them becoming a fourth slot
 * whose meaning depends on argument order.
 *
 * Every field is optional and every omission means "the shipped default",
 * which is what makes a vault with no genome.yaml behave exactly as it did.
 */
export interface AttentionOptions {
  /** The cost model. Omitted ⇒ {@link DEFAULT_TOKEN_WEIGHTS}, i.e. the genome's default. */
  weights?: TokenWeightsGene;
  /** The classification thresholds. Declared here; read from Task 4 onward. */
  classifier?: ClassifierGene;
  /** The resolution machine's parameters. Declared here; read from Task 5 onward. */
  resolution?: ResolutionGene;
  /** How spend is attributed to unknowns. Declared here; read from Task 7 onward. */
  attribution?: AttributionGene;
}

/** Per-unknown and per-class attention across the tree in `vaultDir`. */
export function computeAttention(
  tree: readonly OstNode[],
  vaultDir: string,
  opts: AttentionOptions = {},
): AttentionRollup {
  const weights = opts.weights ?? DEFAULT_TOKEN_WEIGHTS;
  const darkNodes = tree.filter((n) => n.layer === "Unknown");
```

Only `weights` is READ in this task; `classifier`, `resolution` and `attribution` are declared-but-unread until Tasks 4, 5 and 7 wire them, and declaring them here rather than growing the interface three times keeps one definition of the options bag. (`correlated` and `costBasis` are added later, by Task 11.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/eval/attention.test.ts`
Expected: PASS — the file grows by 5 tests; nothing previously green goes red. The nine two-argument call sites are untouched and must not have been edited; if any of them needed changing, the options object was introduced wrongly.

Then run: `npm test`
Expected: PASS — 70 files. `test/genome/load.test.ts` (Task 1) must still pass: this task reads the schema's defaults but does not alter them.

Then run: `npm run build`
Expected: clean `tsc`, no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/eval/attention.ts test/eval/attention.test.ts
git commit -m "feat(eval): what attention costs is an allele, not a constant"
```

---

### Task 4: G2 — the classifier gene

The hardest genuine extraction in Phase 2. `classifyUnknown` stops being a two-line branch and becomes an interpreter over a rule list the genome supplies: first-match-wins, every name in `present` must satisfy `hasSection`, every name in `absent` must not, no match ⇒ `fallback`. The class *vocabulary* moves with the rules, because the design's own Least-settled note ("`unreached` may not earn its own class… the v1 classifier has two classes, not three") is unexpressible by a genome that can only emit three compiled-in labels.

Two consequences fall out. `UnknownClass` widens to `string` (D3) — zod cannot yield a compile-time union from runtime YAML, and pretending otherwise produces `z.enum` gymnastics that defeat the point. And `CONTRACT_SECTIONS`, module-private since Phase 1, becomes an export and a parameter, because `contractGaps` returns the section list *in order* (`test/knowledge/unknowns.test.ts:58` asserts `toEqual(["Format","Methodology","Rationale"])`, an ordered equality) and that order is now genome data.

Behavioral identity is the whole contract here: the five direct-call tests at `test/knowledge/unknowns.test.ts:13-31` and the class assertions at `test/eval/attention.test.ts:74-80` and `test/mcp/next-work.test.ts:116,132` must survive **unedited**, carried by the default parameter.

**Files:**
- Modify: `src/knowledge/unknowns.ts` (interpret `ClassifierGene`; widen `UnknownClass`; export `CONTRACT_SECTIONS` and `DEFAULT_CLASSIFIER`; `contractGaps` takes an optional section list)
- Modify: `src/eval/attention.ts` (`byClass` keys off the genome's `classes`, not the frozen `UNKNOWN_CLASSES`; `classifyUnknown` receives `opts.classifier`)
- Test: `test/knowledge/unknowns.test.ts` (replace the import line, append one `describe`, extend the `contractGaps` block), `test/eval/attention.test.ts` (append one `describe`)
- Unchanged but verified: `src/mcp/next-work.ts:41` — `OpenUnknown.klass: UnknownClass` widens automatically with the alias and needs no edit. Threading the genome into `computeNextWork` is Task 8.

**Interfaces:**
- Consumes (Task 1):
  - `interface ClassifierRule { class: string; present: string[]; absent: string[] }`
  - `interface ClassifierGene { contractSections: string[]; classes: string[]; fallback: string; rules: ClassifierRule[] }` from `src/genome/schema.js`
  - `defaultGenome(): Genome` from `src/genome/load.js`
- Consumes (Task 3): `computeAttention(tree: readonly OstNode[], vaultDir: string, opts?: AttentionOptions)`, where `AttentionOptions` already *declares* all four gene fields up front — `weights`, `classifier`, `resolution`, `attribution` — and nothing yet reads them. The interface does not grow here; this task gives exactly one declared field, `classifier?: ClassifierGene`, its meaning. `opts.resolution` stays unread until Task 5 threads it (Task 5 owns `DEFAULT_RESOLUTION`), and this task touches no other option.
- Produces:
  - `type UnknownClass = string`
  - `const UNKNOWN_CLASSES: readonly string[]` — the DEFAULT vocabulary, still exported
  - `const CONTRACT_SECTIONS: readonly string[]` — newly exported
  - `const DEFAULT_CLASSIFIER: ClassifierGene`
  - `classifyUnknown(node: OstNode, classifier?: ClassifierGene): UnknownClass`
  - `contractGaps(node: OstNode, sections?: readonly string[]): string[]`
  - `AttentionRollup.byClass: Record<string, ClassRollup>`
  - Task 5 (`resolutionState`) and Task 8 (`computeNextWork(..., genome?)`) build directly on these.

- [ ] **Step 1: Write the failing test**

In `test/knowledge/unknowns.test.ts`, replace the import on line 2 with:

```typescript
import type { ClassifierGene } from "../../src/genome/schema.js";
import {
  CONTRACT_SECTIONS,
  DEFAULT_CLASSIFIER,
  UNKNOWN_CLASSES,
  classifyUnknown,
  contractGaps,
  resolutionState,
} from "../../src/knowledge/unknowns.js";
```

Then append to the same file:

```typescript
describe("classifyUnknown — the classifier as an interpreted gene", () => {
  test("the default gene reproduces the compiled classifier exactly — extraction is a refactor first", () => {
    const bodies = [
      FULL,
      "## Format\na count\n\n## Rationale\nserves [[Outcome]]",
      "## Methodology\nsail west",
      "",
      "## format\nx\n\n## METHODOLOGY\ny",
    ];
    for (const body of bodies) {
      expect(classifyUnknown(unknown(body), DEFAULT_CLASSIFIER)).toBe(classifyUnknown(unknown(body)));
    }
  });

  test("a two-class genome dropping `unreached` reclassifies every existing node with no migration", () => {
    const twoClass: ClassifierGene = {
      contractSections: ["Format", "Methodology", "Rationale"],
      classes: ["bounded", "unbounded"],
      fallback: "unbounded",
      rules: [{ class: "bounded", present: ["Format"], absent: [] }],
    };
    // The same node, unedited on disk, now reads as bounded rather than unreached.
    expect(classifyUnknown(unknown("## Format\na count"))).toBe("unreached");
    expect(classifyUnknown(unknown("## Format\na count"), twoClass)).toBe("bounded");
    expect(classifyUnknown(unknown(FULL), twoClass)).toBe("bounded");
    expect(classifyUnknown(unknown(""), twoClass)).toBe("unbounded");
  });

  test("rule order decides a tie — precedence is data, not a branch", () => {
    const rules = [
      { class: "shape-first", present: ["Format"], absent: [] },
      { class: "method-first", present: ["Methodology"], absent: [] },
    ];
    const gene = (ordered: typeof rules): ClassifierGene => ({
      contractSections: ["Format", "Methodology"],
      classes: ["shape-first", "method-first"],
      fallback: "method-first",
      rules: ordered,
    });
    expect(classifyUnknown(unknown(FULL), gene(rules))).toBe("shape-first");
    expect(classifyUnknown(unknown(FULL), gene([...rules].reverse()))).toBe("method-first");
  });

  test("an empty rule list classes everything as the fallback — the floor holds with no rules at all", () => {
    const empty: ClassifierGene = {
      contractSections: ["Format"],
      classes: ["dark"],
      fallback: "dark",
      rules: [],
    };
    expect(classifyUnknown(unknown(FULL), empty)).toBe("dark");
    expect(classifyUnknown(unknown(""), empty)).toBe("dark");
  });

  test("a custom section list keeps the heading anchoring — case-insensitive, and prose is still not a heading", () => {
    const gene: ClassifierGene = {
      contractSections: ["Shape"],
      classes: ["known", "dark"],
      fallback: "dark",
      rules: [{ class: "known", present: ["Shape"], absent: [] }],
    };
    expect(classifyUnknown(unknown("## shape\nx"), gene)).toBe("known");
    expect(classifyUnknown(unknown("## SHAPE\nx"), gene)).toBe("known");
    expect(classifyUnknown(unknown("we agreed on the Shape at length"), gene)).toBe("dark");
  });

  test("the exported vocabulary still names today's classes and sections, in today's order", () => {
    expect(UNKNOWN_CLASSES).toEqual(["bounded", "unreached", "unbounded"]);
    expect(CONTRACT_SECTIONS).toEqual(["Format", "Methodology", "Rationale"]);
    expect(DEFAULT_CLASSIFIER.fallback).toBe("unbounded");
  });
});

describe("contractGaps — the section list is genome data", () => {
  test("the supplied order is the reported order, NOT a compiled constant's", () => {
    expect(contractGaps(unknown(""), ["Rationale", "Format"])).toEqual(["Rationale", "Format"]);
  });

  test("a genome that asks for one section only ever reports that one missing", () => {
    expect(contractGaps(unknown("## Format\nx"), ["Format", "Provenance"])).toEqual(["Provenance"]);
  });
});
```

Append to `test/eval/attention.test.ts`:

```typescript
describe("computeAttention — byClass keys off the genome's vocabulary", () => {
  const twoClass = {
    contractSections: ["Format", "Methodology", "Rationale"],
    classes: ["bounded", "unbounded"],
    fallback: "unbounded",
    rules: [{ class: "bounded", present: ["Format"], absent: [] }],
  };

  test("a two-class genome produces two buckets and NO ghost `unreached`", () => {
    const rollup = computeAttention(
      [unknown("Bounded"), unknown("Shape only", "## Format\nx"), unknown("Dark", "nothing declared")],
      tmp(),
      { classifier: twoClass },
    );
    expect(Object.keys(rollup.byClass).sort()).toEqual(["bounded", "unbounded"]);
    expect(rollup.byClass.bounded.count).toBe(2);
    expect(rollup.byClass.unbounded.count).toBe(1);
  });

  test("a class the genome declares but no node earns still gets a zero bucket — absent reads as zero, not missing", () => {
    const rollup = computeAttention([unknown("Bounded")], tmp(), {
      classifier: { ...twoClass, classes: ["bounded", "unbounded", "commissioned"] },
    });
    expect(rollup.byClass.commissioned).toEqual({
      count: 0, satisfied: 0, abandoned: 0, open: 0, weightedCost: 0,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/knowledge/unknowns.test.ts test/eval/attention.test.ts`
Expected: FAIL — `SyntaxError: The requested module '/src/knowledge/unknowns.ts' does not provide an export named 'CONTRACT_SECTIONS'` (the whole `test/knowledge/unknowns.test.ts` file fails to collect), plus, in `test/eval/attention.test.ts`, `expected [ 'bounded', 'unbounded' ] to deeply equal [ 'bounded', 'unreached', 'unbounded' ]` — `emptyByClass` still enumerates the frozen `UNKNOWN_CLASSES`, and `classifyUnknown` still ignores the classifier it was handed.

- [ ] **Step 3: Write the implementation**

Replace the whole of `src/knowledge/unknowns.ts`:

```typescript
/**
 * The unknown model — what darkness declares about itself.
 *
 * An unknown carries a contract in three body sections: Format (the shape a
 * valid answer takes), Methodology (how it would be collected), Rationale
 * (which node and metric it serves). Format is the stopping condition: an
 * unknown that can state what an answer looks like knows when it is done.
 *
 * The class is DERIVED from contract completeness, never stored. That is
 * deliberate on two counts: replacing the classifier reclassifies every
 * existing node with no migration, and completeness is mechanically checkable
 * rather than a judgement about how mysterious something feels — the same
 * crudeness as `hasRecordedResult`.
 *
 * As of Phase 2 that replacement no longer requires editing this file. The
 * classifier is an INTERPRETER over a rule list carried in `genome.yaml`:
 * first match wins, a rule matches when every section it names as `present`
 * is declared and every section it names as `absent` is not, and no match at
 * all falls to `fallback`. Rule order is the precedence, the class vocabulary
 * travels with the rules — a genome that could only emit three compiled-in
 * labels could not express the two-class allele the design expects to win —
 * and `contractSections` order is what `contractGaps` reports back, so a
 * session is told what to declare in the order the genome asks for it.
 *
 * `UnknownClass` is therefore `string`, not a union. Zod cannot hand back a
 * compile-time union from a file read at runtime, and faking one would put the
 * vocabulary back in the compiler — exactly the trait-excluded-from-evolution
 * this phase exists to undo. `UNKNOWN_CLASSES` survives as the DEFAULT
 * vocabulary, which is all it ever really was.
 */
import { defaultGenome } from "../genome/load.js";
import type { ClassifierGene } from "../genome/schema.js";
import type { OstNode } from "../ost/node.js";

/** A class name is genome data now — no compile-time union can enumerate them. */
export type UnknownClass = string;

export type ResolutionState = "open" | "satisfied" | "abandoned";

/**
 * The v1 classifier, read from the genome schema's own defaults rather than
 * restated here. One place a default lives, so a hand-kept copy cannot drift
 * out from under the file that governs behaviour.
 */
export const DEFAULT_CLASSIFIER: ClassifierGene = defaultGenome().classifier;

/** The DEFAULT class vocabulary. A loaded genome may name a different one. */
export const UNKNOWN_CLASSES: readonly string[] = Object.freeze([...DEFAULT_CLASSIFIER.classes]);

/** The contract's sections, in the order a session should declare them. */
export const CONTRACT_SECTIONS: readonly string[] = Object.freeze([...DEFAULT_CLASSIFIER.contractSections]);

/**
 * Section names arrive from YAML now, so they are escaped before they reach a
 * pattern. For every default name this is a no-op; for a genome that names a
 * section `C++ interop` it is the difference between a probe and a crash.
 */
function escapeForPattern(heading: string): string {
  return heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the body carries a `## <heading>` section. Anchored to a heading so prose cannot fake one. */
function hasSection(body: string, heading: string): boolean {
  return new RegExp(String.raw`^##\s+${escapeForPattern(heading)}\b`, "im").test(body);
}

/** Which contract sections this unknown has not declared, in the order the genome lists them. */
export function contractGaps(node: OstNode, sections: readonly string[] = CONTRACT_SECTIONS): string[] {
  return sections.filter((s) => !hasSection(node.body, s));
}

/**
 * Class by the genome's rules, top to bottom, first match wins.
 *
 * The v1 default reproduces the branch this replaced: no Format → unbounded
 * (you cannot say what an answer looks like); Format and Methodology →
 * bounded (open the cabinet); Format alone → unreached (you know the answer's
 * shape and nothing emits it). A rule naming neither `present` nor `absent`
 * would match every node and swallow the list, which is why the schema refuses
 * to load one — the interpreter can then stay this small.
 */
export function classifyUnknown(node: OstNode, classifier: ClassifierGene = DEFAULT_CLASSIFIER): UnknownClass {
  for (const rule of classifier.rules) {
    const present = rule.present.every((s) => hasSection(node.body, s));
    const absent = rule.absent.every((s) => !hasSection(node.body, s));
    if (present && absent) return rule.class;
  }
  return classifier.fallback;
}

/**
 * A mechanical presence check, on the same precedent as `hasRecordedResult`
 * (`eval/evidence-debt.ts`): satisfied means an `## Answer` heading exists or a
 * human moved the node to `validated`, never that the answer was checked
 * against its declared Format. That is a floor, not a verdict — an agent can
 * still write `## Answer` on nothing, or set `status: validated` on its own
 * node, and this function will call it satisfied either way. Abandonment is
 * checked first so that a deferred unknown reads as abandoned even if an
 * answer was drafted — the human's call outranks the draft.
 */
export function resolutionState(node: OstNode): ResolutionState {
  if (node.status === "deferred") return "abandoned";
  if (node.status === "validated" || hasSection(node.body, "Answer")) return "satisfied";
  return "open";
}
```

In `src/eval/attention.ts`, four edits. First, the import from the knowledge module (line 25 today) — `UNKNOWN_CLASSES` is no longer the vocabulary this file enumerates, `DEFAULT_CLASSIFIER` is the fallback when the caller supplies no gene:

```typescript
import { classifyUnknown, resolutionState, DEFAULT_CLASSIFIER, type ResolutionState, type UnknownClass } from "../knowledge/unknowns.js";
```

Second, in `AttentionRollup`, the `byClass` field only (leave every other field as Tasks 3 and 11 leave it):

```typescript
  /** Keyed by the genome's class vocabulary — every declared class gets a bucket, earned or not. */
  byClass: Record<string, ClassRollup>;
```

Third, replace `emptyByClass` (lines 140-144 today) with a pair that takes the vocabulary as an argument:

```typescript
function emptyClassRollup(): ClassRollup {
  return { count: 0, satisfied: 0, abandoned: 0, open: 0, weightedCost: 0 };
}

/**
 * A bucket per class the genome declares, whether or not any node earned it.
 * A class that appears with zero is a measured zero; a class that is simply
 * absent from the record is indistinguishable from a class that was never
 * declared, and fitness has to be able to tell those apart.
 */
function emptyByClass(classes: readonly string[]): Record<string, ClassRollup> {
  return Object.fromEntries(classes.map((c) => [c, emptyClassRollup()]));
}
```

Fourth, inside `computeAttention`: resolve the gene once at the top of the body, next to the existing `darkNodes`/`usage` lines,

```typescript
  const classifier = opts.classifier ?? DEFAULT_CLASSIFIER;
```

pass it at the classification site (line 176 today), `klass: classifyUnknown(node),` becoming

```typescript
      klass: classifyUnknown(node, classifier),
```

and build the rollup from the gene's own vocabulary (lines 185-187 today):

```typescript
  const byClass = emptyByClass(classifier.classes);
  for (const u of unknowns) {
    // A class outside the declared vocabulary cannot arrive from a loaded
    // genome — the schema refuses one — but a hand-built gene may carry one,
    // and dropping the spend on the floor would be worse than naming it.
    const bucket = (byClass[u.klass] ??= emptyClassRollup());
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/knowledge/unknowns.test.ts test/eval/attention.test.ts`
Expected: PASS — `test/knowledge/unknowns.test.ts` grows by 8 tests and `test/eval/attention.test.ts` by 2; nothing previously green goes red, and every Phase 1 test in both files runs unedited.

Then run: `npm test`
Expected: PASS — the whole suite, 10 tests more than this task began with, across the same file count. Watch `test/mcp/next-work.test.ts:116` (`klass` `"unreached"`) and `:132` (`"unbounded"`) specifically: they are the proof that widening `UnknownClass` to `string` and routing the branch through the default gene changed no behaviour. If either moved, the interpreter is not reproducing the branch — fix the interpreter, do not edit the assertion.

Finally run: `npm run build`
Expected: clean. `src/mcp/next-work.ts:41` needs no edit — `OpenUnknown.klass: UnknownClass` widens with the alias.

- [ ] **Step 5: Commit**

```bash
git add src/knowledge/unknowns.ts src/eval/attention.ts test/knowledge/unknowns.test.ts test/eval/attention.test.ts
git commit -m "feat(genome): the classifier stops being a branch and becomes a rule list"
```

---

### Task 5: G3 — the resolution state machine gene

Replaces the three hard-coded `if`s of `src/knowledge/unknowns.ts:59-63` with an interpreter over `ResolutionGene`. The compiled-in machine encoded its precedence in statement order and defended it in a comment; the genome encodes it in rule order and defends it in a test. That is the whole trade: **rule order IS precedence**, and it is the one property a mutated genome can silently destroy — swap two rules and a human's `deferred` quietly loses to an agent's drafted `## Answer`, with no error anywhere. Nothing else in this gene can go wrong so cheaply, which is why the reversal is its headline test.

**Storage consequence, stated once so nobody discovers it later:** `ResolutionState` is persisted into `AttentionEntry.state` (`src/telemetry/attention.ts:45`, typed at `:21`) in an append-only JSONL ledger that is already on disk in real vaults. Widening the type from a three-member union to `string` (D3) widens what can appear in that column. Nothing migrates and nothing breaks — readers at `src/eval/attention.ts` compare against string literals and fall through to `open` — but a genome can now write a state no reader has a bucket for, and that is a deliberate property, not an oversight. The design (`docs/superpowers/specs/2026-07-27-epistemic-uncertainty-design.md:67`) names a fourth state, `superseded`. **Do NOT implement it.** Nothing produces it, nothing consumes it, and adding a speculative literal to a vocabulary that just stopped being a literal would be the exact mistake this task exists to undo. A genome can now express it without a code change; a test below proves that, and proving it is the substitute for shipping it.

**Files:**
- Modify: `src/knowledge/unknowns.ts` (widen `ResolutionState` to `string`; add `DEFAULT_RESOLUTION`; replace `resolutionState`'s body with a rule interpreter and its JSDoc with the order-is-precedence argument)
- Modify: `src/eval/attention.ts` (thread `opts.resolution` into the `resolutionState` call at `:177`, so the rollup obeys the same gene `ost_next_work` obeys)
- Test: `test/knowledge/unknowns.test.ts` (append one `describe` block; the 5 existing `resolutionState` tests at `:34-54` are NOT touched)
- Test: `test/eval/attention.test.ts` (append one test proving the gene reaches the rollup)

**Interfaces:**
- Consumes (Task 1): `interface ResolutionRule { state: string; status: string[]; section?: string }`; `interface ResolutionGene { answerSection: string; fallback: string; rules: ResolutionRule[] }` from `src/genome/schema.js`; `defaultGenome(): Genome` from `src/genome/load.js`.
- Consumes (Task 4): the `import { defaultGenome } from "../genome/load.js"` line and the module-private `hasSection(body, heading)` helper, both already in place. Heading-to-regex escaping is `hasSection`'s concern and is unchanged by this task.
- Produces:
  - `export type ResolutionState = string` (widened from `"open" | "satisfied" | "abandoned"`)
  - `export const DEFAULT_RESOLUTION: ResolutionGene`
  - `export function resolutionState(node: OstNode, resolution?: ResolutionGene): ResolutionState`
  - `computeAttention` honours `opts.resolution` (the `resolution?: ResolutionGene` field of `AttentionOptions`, declared by Task 4), defaulting to `DEFAULT_RESOLUTION`
- Downstream: `src/mcp/next-work.ts:148` (`resolutionState(n) === "open"`) keeps compiling untouched because the parameter is defaulted; Task 8 threads `genome.resolution` into it. `src/eval/attention.ts:177` is NOT left on the default: this task threads `opts.resolution` there itself (Step 3), because no later task does. Leaving it compiled-in would let a genome that renames `answerSection` or reorders rules change `ost_next_work` while `ost_status` kept reporting the old verdict — two surfaces silently disagreeing about the same unknown.

- [ ] **Step 1: Write the failing test**

Append to `test/knowledge/unknowns.test.ts`. Two edits to the imports at the top, and both are strictly ADDITIVE — do not retype either line from scratch, because Task 4 already put symbols on both of them that its own `describe` block depends on:

(a) add `DEFAULT_RESOLUTION` to the existing named import from `../../src/knowledge/unknowns.js`, keeping every symbol already listed there (Task 4 added `CONTRACT_SECTIONS`, `DEFAULT_CLASSIFIER` and `UNKNOWN_CLASSES` to it);
(b) add `ResolutionGene` to the existing `import type { ClassifierGene } from "../../src/genome/schema.js"` line, making it `import type { ClassifierGene, ResolutionGene } from "../../src/genome/schema.js"`.

Then append at the end of the file. The local `unknown()` factory and `FULL` const defined at `:5-9` are reused as-is:

```typescript
describe("the resolution gene — rule order IS the precedence", () => {
  const DEFERRED_FIRST: ResolutionGene = {
    answerSection: "Answer",
    fallback: "open",
    rules: [
      { state: "abandoned", status: ["deferred"] },
      { state: "satisfied", status: ["validated"], section: "Answer" },
    ],
  };

  const ANSWER_FIRST: ResolutionGene = {
    answerSection: "Answer",
    fallback: "open",
    rules: [
      { state: "satisfied", status: ["validated"], section: "Answer" },
      { state: "abandoned", status: ["deferred"] },
    ],
  };

  const DRAFTED_AND_DEFERRED = () => unknown(`${FULL}\n\n## Answer\nx`, { status: "deferred" });

  test("the default gene decides exactly what the compiled-in machine decided", () => {
    const node = DRAFTED_AND_DEFERRED();
    expect(resolutionState(node)).toBe(resolutionState(node, DEFAULT_RESOLUTION));
    expect(resolutionState(node, DEFERRED_FIRST)).toBe("abandoned");
  });

  test("reversing the two rules makes a drafted Answer beat deferred — order, and ONLY order, decides", () => {
    const node = DRAFTED_AND_DEFERRED();
    expect(resolutionState(node, DEFERRED_FIRST)).toBe("abandoned");
    expect(resolutionState(node, ANSWER_FIRST)).toBe("satisfied");
  });

  test("a genome may name its own answer section — the heading is data, never a literal in the kernel", () => {
    const finding: ResolutionGene = {
      answerSection: "Finding",
      fallback: "open",
      rules: [
        { state: "abandoned", status: ["deferred"] },
        { state: "satisfied", status: ["validated"], section: "Finding" },
      ],
    };
    expect(resolutionState(unknown(`${FULL}\n\n## Finding\n412 per day`), finding)).toBe("satisfied");
    expect(resolutionState(unknown(`${FULL}\n\n## Answer\n412 per day`), finding)).toBe("open");
  });

  test("the default gene's satisfied rule names its own answerSection — renaming the heading stays a one-line edit", () => {
    expect(DEFAULT_RESOLUTION.rules.some((r) => r.section === DEFAULT_RESOLUTION.answerSection)).toBe(true);
  });

  test("a node no rule matches takes the fallback, whatever the fallback is named", () => {
    const gene: ResolutionGene = {
      answerSection: "Answer",
      fallback: "unexamined",
      rules: [{ state: "abandoned", status: ["deferred"] }],
    };
    expect(resolutionState(unknown(FULL), gene)).toBe("unexamined");
    expect(resolutionState(unknown(FULL, { status: "validated" }), gene)).toBe("unexamined");
    expect(resolutionState(unknown(FULL, { status: "deferred" }), gene)).toBe("abandoned");
  });

  test("a status-only rule NEVER reads the body — a rule that names no section probes none", () => {
    const gene: ResolutionGene = {
      answerSection: "Answer",
      fallback: "open",
      rules: [{ state: "satisfied", status: ["validated"] }],
    };
    expect(resolutionState(unknown(`${FULL}\n\n## Answer\nx`), gene)).toBe("open");
    expect(resolutionState(unknown(FULL, { status: "validated" }), gene)).toBe("satisfied");
  });

  test("a genome can express superseded with no code change — which is the entire reason the vocabulary left TypeScript", () => {
    const gene: ResolutionGene = {
      answerSection: "Answer",
      fallback: "open",
      rules: [
        { state: "superseded", status: ["shipped"] },
        { state: "abandoned", status: ["deferred"] },
        { state: "satisfied", status: ["validated"], section: "Answer" },
      ],
    };
    expect(resolutionState(unknown(FULL, { status: "shipped" }), gene)).toBe("superseded");
    expect(resolutionState(unknown(FULL, { status: "deferred" }), gene)).toBe("abandoned");
  });
});
```

Then append one test to `test/eval/attention.test.ts`, inside the existing `describe("computeAttention", …)`. Add `ResolutionGene` to that file's type-only genome-schema import (additively — Task 4 already imports `ClassifierGene` there), or add the import line if it is the first such symbol. The file's local `unknown(title, body, extra)` factory, `FULL` const and `tmp()` helper are reused as-is; note this factory takes the title first, unlike the one in `unknowns.test.ts`:

```typescript
test("a resolution gene reaches the rollup — reversing rule order flips abandoned to satisfied", () => {
  const ANSWER_FIRST: ResolutionGene = {
    answerSection: "Answer",
    fallback: "open",
    rules: [
      { state: "satisfied", status: ["validated"], section: "Answer" },
      { state: "abandoned", status: ["deferred"] },
    ],
  };
  const node = unknown("U", `${FULL}\n\n## Answer\nx`, { status: "deferred" });

  // The default gene: abandonment outranks a drafted answer.
  expect(computeAttention([node], tmp()).byClass.bounded.abandoned).toBe(1);

  // The same node, same tree, one reordered gene — and `ost_status` now agrees
  // with what `ost_next_work` would say under that genome, which is the point.
  const rollup = computeAttention([node], tmp(), { resolution: ANSWER_FIRST });
  expect(rollup.unknowns[0].state).toBe("satisfied");
  expect(rollup.byClass.bounded.satisfied).toBe(1);
  expect(rollup.byClass.bounded.abandoned).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/knowledge/unknowns.test.ts -t "the resolution gene"`
Expected: FAIL — `SyntaxError: The requested module '/src/knowledge/unknowns.ts' does not provide an export named 'DEFAULT_RESOLUTION'`. (The whole file fails to load, so the pre-existing tests report as failures too; that resolves in Step 4.)

Run: `npx vitest run test/eval/attention.test.ts -t "a resolution gene reaches the rollup"`
Expected: FAIL — the rollup ignores the supplied gene and still reports `abandoned`, so `rollup.unknowns[0].state` is `"abandoned"`, not `"satisfied"`. Note that `tsc` never sees `test/` (`tsconfig.json` includes only `src/**/*`), so an unthreaded `opts.resolution` surfaces here as a runtime assertion failure and nowhere in `npm run build`.

- [ ] **Step 3: Write the implementation**

In `src/knowledge/unknowns.ts`, add `ResolutionGene` to the existing type-only import from the genome schema (Task 4 introduced this line for `ClassifierGene`):

```typescript
import type { ClassifierGene, ResolutionGene } from "../genome/schema.js";
```

Replace the `ResolutionState` declaration (`:23`):

```typescript
/**
 * A terminal (or non-terminal) label for an unknown. A `string`, not a union:
 * the vocabulary is genome data now, and zod cannot hand a compile-time union
 * back from a YAML file parsed at runtime. The default gene's three values —
 * `open`, `satisfied`, `abandoned` — are the v1 vocabulary, not the ceiling.
 */
export type ResolutionState = string;
```

Add beside `DEFAULT_CLASSIFIER`:

```typescript
/**
 * The v1 resolution gene, sourced from the schema so the default lives in
 * exactly one place. Imports run knowledge → genome and never back (the genome
 * module knows nothing about unknowns).
 */
export const DEFAULT_RESOLUTION: ResolutionGene = defaultGenome().resolution;
```

Replace `resolutionState` and its JSDoc (`:49-63`) wholesale:

```typescript
/**
 * Resolution is recorded, never claimed — an interpreter over the resolution
 * gene's rule list.
 *
 * A rule matches when the node's `status` appears in the rule's `status` list,
 * OR — when the rule names a `section` — when the body carries that `## <name>`
 * heading. The first matching rule wins; nothing matches, the `fallback` does.
 *
 * RULE ORDER IS THE PRECEDENCE, and that sentence is the gene's load-bearing
 * property. The machine this replaced checked abandonment first, in a statement
 * order no reader could reorder by accident, so that a human's `deferred`
 * outranked an agent's drafted `## Answer`. That guarantee now lives in the
 * position of two entries in a YAML list. Swap them and an abandoned unknown
 * with a stray answer reads as satisfied — no error, no warning, a corrupted
 * fitness record that announces nothing. It is the one mutation the schema
 * cannot catch, so it is the one the tests pin.
 *
 * The check remains mechanical, on the same precedent as `hasRecordedResult`
 * (`eval/evidence-debt.ts`): satisfaction means a heading exists or a status was
 * set, never that an answer was checked against its declared Format. That is a
 * floor, not a verdict. The fail-closed direction is pinned in the schema, not
 * here: a rule that matched on nothing would fire on every node including one
 * with no answer at all, so satisfaction can never be claimed on absence.
 *
 * `answerSection` is the gene's canonical name for the heading that means "an
 * answer exists". The interpreter reads only `rules`, so renaming it there is
 * what changes behaviour — but the default rule set names it, which keeps the
 * rename a one-line edit and is asserted as an invariant by the tests.
 */
export function resolutionState(
  node: OstNode,
  resolution: ResolutionGene = DEFAULT_RESOLUTION,
): ResolutionState {
  for (const rule of resolution.rules) {
    const byStatus = node.status !== undefined && rule.status.includes(node.status);
    const bySection = rule.section !== undefined && hasSection(node.body, rule.section);
    if (byStatus || bySection) return rule.state;
  }
  return resolution.fallback;
}
```

Then thread the gene through `src/eval/attention.ts`, which is the half of this task that a defaulted parameter quietly hides. Add `DEFAULT_RESOLUTION` to the existing named import from `../knowledge/unknowns.js` (additively — that line already carries `classifyUnknown`, `resolutionState`, `UNKNOWN_CLASSES` and the two type-only symbols):

```typescript
import { classifyUnknown, DEFAULT_RESOLUTION, resolutionState, UNKNOWN_CLASSES, type ResolutionState, type UnknownClass } from "../knowledge/unknowns.js";
```

In `computeAttention`'s body, beside the classifier line Task 4 added, resolve the gene once rather than per node:

```typescript
const resolution = opts.resolution ?? DEFAULT_RESOLUTION;
```

And at `:177`, pass it:

```typescript
state: resolutionState(node, resolution),
```

That one argument is the difference between a genome that governs the tree and a genome that governs half of it. `ost_next_work` reads its resolution from the genome (Task 8); if the rollup kept the compiled-in default, renaming `answerSection` or reordering two rules would move one surface and not the other, and the disagreement would show up as a fitness record no one could reconcile with the queue.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/knowledge/unknowns.test.ts`
Expected: PASS — the file grows by 7 tests; nothing previously green goes red. In particular the 5 original `resolutionState` tests (`:34-54`) are green **unmodified**, and so is everything Task 4 appended to this file.

Then run the two downstream suites that call `resolutionState`, to confirm the defaulted parameter kept every existing caller behaviourally identical:

Run: `npx vitest run test/eval/attention.test.ts test/mcp/next-work.test.ts`
Expected: PASS — `test/eval/attention.test.ts` grows by 1 test (the rollup-threading test from Step 1) and `test/mcp/next-work.test.ts` by none; nothing previously green goes red in either. If TypeScript complains that `state: ResolutionState` no longer narrows in `src/eval/attention.ts`, do NOT re-narrow the type: the `if (u.state === "satisfied") … else if (u.state === "abandoned") … else` chain at `src/eval/attention.ts:181-186` compares a `string` against literals, which is legal, and its `else` branch is the correct home for a state the default vocabulary does not name.

Run: `npm run build`
Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add src/knowledge/unknowns.ts src/eval/attention.ts test/knowledge/unknowns.test.ts test/eval/attention.test.ts
git commit -m "feat(knowledge): resolution becomes a rule list whose order is its precedence"
```

---

### Task 6: G4 — the per-class budget gene

The lookup budget is the one place today where the agent already decides how much attention to spend on not-knowing, and the decision is a single compiled-in integer plus a fixed English sentence. This task turns both into alleles without moving the operator's number: `budgets.sharedPool` defaults to `null`, meaning "whatever `config.web.lookupBudget` says", so a vault with no `genome.yaml` spends exactly what it spent yesterday. The interesting half is `onExhaustion`. Today's message ends the loop — it tells the session to record what is still unknown, and per the design's problem statement (line 16) *"nothing ever reads it back."* The `record-unknown` allele names the tree node and the Format/Methodology/Rationale contract that Phase 1 made readable, which is the first time an exhausted budget can produce a machine-readable artifact instead of a regret.

`take()` grows a class parameter here and **Task 7 (`OST_UNKNOWN` attribution via `handleOstCall`)** is committed to passing one: it resolves the class at the spend site from `process.env.OST_UNKNOWN` → tree lookup → `classifyUnknown` and calls `lookupBudget.take(klass)` at `src/security/tools.ts:350` and `:377`. That hand-off is planned work in this phase, not a maybe — `perClass` is dormant for exactly one task, not dead policy. Until Task 7 lands, both spend sites call `take()` with no argument and charge the shared pool — which is precisely the behavioral identity this phase is verified by. The per-class machinery ships tested and dormant, exactly as `tokenSplit` does.

**Files:**
- Modify: `src/web/budget.ts` (`LookupBudget.take` gains an optional class; `createLookupBudget` accepts `number | BudgetsGene` plus an `operatorLimit`; `budgetSpentMessage` gains `onExhaustion` and a second variant)
- Modify: `src/security/tools.ts` (defensive re-default at `:98` builds from `genome.budgets`; both spend sites at `:350` and `:377` pass `genome.budgets.onExhaustion` to `budgetSpentMessage`)
- Modify: `src/runner/context.ts:113` (`createLookupBudget(genome.budgets, config.web.lookupBudget)` — the D6 fork, in one line)
- Test: `test/web/budget.test.ts` (rewritten, all four existing tests preserved verbatim), `test/security/web-tools.test.ts` (append one describe), `test/runner/context.test.ts` (append one describe)

**Interfaces:**
- Consumes:
  - `interface BudgetsGene { sharedPool: number | null; perClass: Record<string, number>; onExhaustion: "instruct" | "record-unknown" }` from `src/genome/schema.js` (Task 1)
  - `function defaultGenome(): Genome` and `function genomePath(vaultDir: string): string` from `src/genome/load.js` (Task 1)
  - `PassContext.genome: Genome` and `ToolContext.genome?: Genome`, plus the `const genome = …` local in `buildPassContext` and in `buildOstTools` (Task 2)
- Produces:
  - `export const DEFAULT_LOOKUP_BUDGET = 10` (unchanged, still exported)
  - `export interface LookupBudget { take(klass?: string): boolean; remaining(): number; limit: number }`
  - `export function createLookupBudget(policy?: number | BudgetsGene, operatorLimit?: number): LookupBudget`
  - `export function budgetSpentMessage(limit: number, onExhaustion?: "instruct" | "record-unknown"): string`
  - **Hand-off to Task 7 (committed, not hypothetical):** Task 7 resolves the class from `process.env.OST_UNKNOWN` → tree lookup → `classifyUnknown` and calls `lookupBudget.take(klass)` at the two spend sites, `src/security/tools.ts:350` and `:377`. That is the task that activates `perClass`; nothing else in the plan depends on this task.

- [ ] **Step 1: Write the failing test**

Replace `test/web/budget.test.ts` entirely. The four existing tests are carried over word for word — they are the identity pins, and `expect(DEFAULT_LOOKUP_BUDGET).toBe(10)` in particular must survive contact with the genome:

```typescript
/**
 * The lookup budget: one counter shared by search and page reads, created per
 * PassContext. Exhaustion is an instruction to work from what you have — not
 * an error.
 *
 * Phase 2 makes the policy an allele, and this file is where the extraction is
 * held honest. Three things must NOT move: the number an operator writes in
 * `ost.config.yaml` still governs unless the genome explicitly overrides it,
 * one shared class-blind counter is still the default, and the sentence the
 * tools answer with when the budget is spent is still byte-for-byte the
 * sentence they answered with before there was a genome. The assertions below
 * that look redundant are those pins.
 */
import { describe, expect, test } from "vitest";
import { createLookupBudget, budgetSpentMessage, DEFAULT_LOOKUP_BUDGET } from "../../src/web/budget.js";
import { defaultGenome } from "../../src/genome/load.js";
import type { BudgetsGene } from "../../src/genome/schema.js";

/** The default gene, with only what a test cares about overridden. */
const gene = (over: Partial<BudgetsGene> = {}): BudgetsGene => ({
  sharedPool: null,
  perClass: {},
  onExhaustion: "instruct",
  ...over,
});

describe("createLookupBudget", () => {
  test("allows exactly `limit` takes, then refuses", () => {
    const b = createLookupBudget(3);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    expect(b.take()).toBe(false); // stays exhausted
    expect(b.remaining()).toBe(0);
  });

  test("reports remaining as it drains", () => {
    const b = createLookupBudget(2);
    expect(b.remaining()).toBe(2);
    b.take();
    expect(b.remaining()).toBe(1);
  });

  test("defaults to DEFAULT_LOOKUP_BUDGET", () => {
    expect(createLookupBudget().remaining()).toBe(DEFAULT_LOOKUP_BUDGET);
    expect(DEFAULT_LOOKUP_BUDGET).toBe(10);
  });

  test("the spent message instructs, it does not just refuse", () => {
    const msg = budgetSpentMessage(10);
    expect(msg).toMatch(/budget/i);
    expect(msg).toMatch(/annotate|record|cite|open question/i);
  });
});

describe("createLookupBudget — the operator's number and the genome's", () => {
  test("a bare number stays a positional shorthand — every pre-genome call site keeps counting", () => {
    const b = createLookupBudget(5);
    expect(b.limit).toBe(5);
    expect(b.take()).toBe(true);
    expect(b.remaining()).toBe(4);
  });

  test("a null sharedPool means the operator's configured number governs — the genome declines to have an opinion", () => {
    const b = createLookupBudget(gene(), 4);
    expect(b.limit).toBe(4);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });

  test("an explicit sharedPool is the ONLY way the genome takes the wheel from the operator", () => {
    expect(createLookupBudget(gene({ sharedPool: 2 }), 9).limit).toBe(2);
  });

  test("a null sharedPool with no operator number falls back to DEFAULT_LOOKUP_BUDGET — two absences, still ten", () => {
    expect(createLookupBudget(gene()).limit).toBe(DEFAULT_LOOKUP_BUDGET);
  });

  test("the default genome's budgets ARE today's budgets — whatever the operator wrote, unchanged", () => {
    const b = createLookupBudget(defaultGenome().budgets, 7);
    expect(b.limit).toBe(7);
    expect(b.take()).toBe(true);
    expect(b.remaining()).toBe(6);
  });
});

describe("createLookupBudget — per-class caps", () => {
  test("an empty perClass ignores the class entirely — one shared counter, exactly as before", () => {
    const b = createLookupBudget(gene({ sharedPool: 2, perClass: {} }));
    expect(b.take("bounded")).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take("unbounded")).toBe(false);
    expect(b.remaining()).toBe(0);
  });

  test("a capped class stops at its cap while the shared pool is still deep — and the refusal spends NOTHING", () => {
    const b = createLookupBudget(gene({ sharedPool: 10, perClass: { bounded: 1 } }));
    expect(b.take("bounded")).toBe(true);
    expect(b.take("bounded")).toBe(false);
    expect(b.remaining()).toBe(9);
    expect(b.take("unreached")).toBe(true); // another class is untouched by that cap
    expect(b.remaining()).toBe(8);
  });

  test("a class perClass does not name is uncapped — the map lists exceptions, NOT a whitelist", () => {
    const b = createLookupBudget(gene({ sharedPool: 3, perClass: { unbounded: 0 } }));
    expect(b.take("bounded")).toBe(true);
    expect(b.take("bounded")).toBe(true);
    expect(b.take("unbounded")).toBe(false); // a cap of zero forbids the class outright
    expect(b.remaining()).toBe(1);
  });

  test("the shared pool still bounds every class — a generous per-class cap cannot mint lookups", () => {
    const b = createLookupBudget(gene({ sharedPool: 1, perClass: { bounded: 5 } }));
    expect(b.take("bounded")).toBe(true);
    expect(b.take("bounded")).toBe(false);
  });
});

describe("budgetSpentMessage — the exhaustion instruction is an allele", () => {
  test("instruct is the default and is byte-identical to the sentence that shipped before the genome", () => {
    const expected =
      "Lookup budget spent (10 web lookups this session). " +
      "Work from what you have already read and cite it. If something essential is still unknown, " +
      "record it as an open question on the relevant node (ost_annotate or a note in the body) " +
      "so the next session can pick it up with a fresh budget.";
    expect(budgetSpentMessage(10)).toBe(expected);
    expect(budgetSpentMessage(10, "instruct")).toBe(expected);
  });

  test("record-unknown closes the loop instruct leaves open — it names the contract, not just the regret", () => {
    const msg = budgetSpentMessage(3, "record-unknown");
    expect(msg).toMatch(/budget spent/i);
    expect(msg).toContain("ost_create_node");
    expect(msg).toContain("## Format");
    expect(msg).toContain("## Methodology");
    expect(msg).toContain("## Rationale");
    expect(msg).not.toBe(budgetSpentMessage(3, "instruct"));
  });
});
```

Append to `test/security/web-tools.test.ts` — this is what proves the gene is wired rather than merely declared. Add `import { defaultGenome } from "../../src/genome/load.js";` to that file's import block, below the existing `../../src/web/budget.js` import:

```typescript
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
```

Append to `test/runner/context.test.ts` — the D6 fork, asserted at the construction site. Add `import { genomePath } from "../../src/genome/load.js";` to that file's import block:

```typescript
describe("buildPassContext budget wiring — the operator's number, unless the genome says otherwise", () => {
  test("with NO genome.yaml the budget is the operator's configured number — an absent genome changes nothing", () => {
    fs.writeFileSync(
      configPath(dir),
      `outcome: "Reach 10,000 daily active users"\nweb:\n  lookupBudget: 4\n`,
      "utf8",
    );
    expect(fs.existsSync(genomePath(dir))).toBe(false);
    expect(buildPassContext(dir).web?.budget?.limit).toBe(4);
  });

  test("a genome with a null sharedPool still defers to the operator — the default genome is not an override", () => {
    fs.writeFileSync(
      configPath(dir),
      `outcome: "Reach 10,000 daily active users"\nweb:\n  lookupBudget: 4\n`,
      "utf8",
    );
    fs.writeFileSync(genomePath(dir), `budgets:\n  perClass: {}\n`, "utf8");
    expect(buildPassContext(dir).web?.budget?.limit).toBe(4);
  });

  test("an explicit sharedPool takes the wheel and the operator's number stands down", () => {
    fs.writeFileSync(
      configPath(dir),
      `outcome: "Reach 10,000 daily active users"\nweb:\n  lookupBudget: 4\n`,
      "utf8",
    );
    fs.writeFileSync(genomePath(dir), `budgets:\n  sharedPool: 2\n`, "utf8");
    expect(buildPassContext(dir).web?.budget?.limit).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/web/budget.test.ts test/security/web-tools.test.ts test/runner/context.test.ts`

Expected: FAIL —
- `test/web/budget.test.ts` › "a null sharedPool means the operator's configured number governs": `expected { sharedPool: null, perClass: {}, onExhaustion: 'instruct' } to be 4` — the old `createLookupBudget(limit = DEFAULT_LOOKUP_BUDGET)` stores the gene object as `limit`.
- `test/web/budget.test.ts` › "record-unknown closes the loop instruct leaves open": `expected 'Lookup budget spent (3 web lookups this s…' to contain 'ost_create_node'` — the second parameter is ignored today.
- `test/security/web-tools.test.ts` › "onExhaustion record-unknown …": same `toContain('ost_create_node')` failure.
- `test/runner/context.test.ts` › "an explicit sharedPool takes the wheel": `expected 4 to be 2` — `context.ts:113` still reads only `config.web.lookupBudget`.

`npm run build` stays clean — `tsconfig.json` excludes `test/`, so a test-file type error surfaces only as the runtime failure above.

- [ ] **Step 3: Write the implementation**

Replace `src/web/budget.ts` entirely:

```typescript
/**
 * The lookup budget — why looking outward stays a tool and not a habit.
 *
 * One counter is shared by `ost_search_web` and `ost_read_web`, created once
 * per PassContext (so: per MCP session, per pass). Exhaustion is not an
 * error: the tools answer with an instruction to work from what was already
 * read and to record what is still unknown on the tree, where the next
 * session will find it. Looking is cheap to start and expensive to binge.
 *
 * How much to look, and what to say when the looking stops, are policy — and
 * policy compiled in is a trait excluded from evolution. Both now come from
 * the genome's `budgets` gene. Two properties are held deliberately fixed
 * across that extraction. First, the operator keeps their number: a
 * `sharedPool` of `null` — the default — means "whatever `web.lookupBudget`
 * says in ost.config.yaml", so a vault with no genome.yaml spends exactly what
 * it spent before, and no vault ever carries two budget numbers that can
 * silently disagree. Only an explicit non-null `sharedPool` overrides the
 * operator, and that is the harness's business, not a vault's. Second, an
 * empty `perClass` map ignores the class argument entirely: one shared,
 * class-blind counter, indistinguishable from the counter that shipped.
 *
 * `perClass` names exceptions rather than a whitelist. A class the map does
 * not mention is bounded only by the shared pool; a class it caps is bounded
 * by both, and the shared pool always wins, so a generous per-class cap can
 * never mint lookups the session was not granted. A refused take — for either
 * reason — spends nothing.
 *
 * `onExhaustion` is the more interesting allele. `instruct` is what the tools
 * have always said: work from what you have, and note the gap in prose. That
 * gap then goes nowhere, which is the loop this whole phase exists to close.
 * `record-unknown` instead asks for an `#Unknown` node carrying a
 * Format/Methodology/Rationale contract — a machine-readable artifact the
 * next pass can classify, budget, and eventually cost. Which of the two
 * actually produces better trees is a measurement, not an opinion, so both
 * ship and the genome decides.
 */
import type { BudgetsGene } from "../genome/schema.js";

export const DEFAULT_LOOKUP_BUDGET = 10;

export interface LookupBudget {
  /**
   * Spend one lookup, optionally on behalf of an unknown's class. False when
   * the shared pool is exhausted, or when `perClass` caps that class and the
   * cap is reached. A false take costs nothing.
   */
  take(klass?: string): boolean;
  /** Lookups left in the shared pool. Per-class caps do not narrow this number. */
  remaining(): number;
  limit: number;
}

/**
 * Build the session's budget. `policy` accepts a bare number as a positional
 * shorthand for a class-blind pool of that size (every pre-genome call site
 * keeps working), or the genome's `budgets` gene. `operatorLimit` is
 * `config.web.lookupBudget` — consulted only when the gene declines to have an
 * opinion by leaving `sharedPool` null, which is the default.
 */
export function createLookupBudget(
  policy: number | BudgetsGene = DEFAULT_LOOKUP_BUDGET,
  operatorLimit?: number,
): LookupBudget {
  const gene: BudgetsGene =
    typeof policy === "number"
      ? { sharedPool: policy, perClass: {}, onExhaustion: "instruct" }
      : policy;
  const limit = gene.sharedPool ?? operatorLimit ?? DEFAULT_LOOKUP_BUDGET;
  const perClass = gene.perClass ?? {};

  let used = 0;
  const usedByClass = new Map<string, number>();

  return {
    limit,
    take: (klass?: string) => {
      if (used >= limit) return false;
      if (klass !== undefined) {
        const cap = perClass[klass];
        if (cap !== undefined) {
          const spent = usedByClass.get(klass) ?? 0;
          if (spent >= cap) return false;
          usedByClass.set(klass, spent + 1);
        }
      }
      used++;
      return true;
    },
    remaining: () => limit - used,
  };
}

/** What a tool answers once the budget is spent — an instruction, not a refusal. */
export function budgetSpentMessage(
  limit: number,
  onExhaustion: BudgetsGene["onExhaustion"] = "instruct",
): string {
  if (onExhaustion === "record-unknown") {
    return (
      `Lookup budget spent (${limit} web lookups this session). ` +
      `Stop looking outward and file what is still dark, so it can be picked up rather than forgotten: ` +
      `call ost_create_node with layer "Unknown", parent set to the node the gap darkens, and a body carrying ` +
      `## Format (the shape a valid answer must take — this is the stopping condition), ` +
      `## Methodology (the mechanism that would collect it), and ` +
      `## Rationale (a wikilink to the darkened node and the metric it serves). ` +
      `Then work from what you have already read and cite it. The next session sees the unknown in ost_next_work ` +
      `and picks it up with a fresh budget.`
    );
  }
  return (
    `Lookup budget spent (${limit} web lookups this session). ` +
    `Work from what you have already read and cite it. If something essential is still unknown, ` +
    `record it as an open question on the relevant node (ost_annotate or a note in the body) ` +
    `so the next session can pick it up with a fresh budget.`
  );
}
```

In `src/runner/context.ts`, change the budget construction inside the returned `web` object (currently line 113). `genome` is the local Task 2 added beside `config` at the top of `buildPassContext`:

```typescript
    web: {
      searchApiKey: process.env.BRAVE_SEARCH_API_KEY,
      // The operator's number governs unless the genome explicitly overrides
      // it — one budget, never two that can disagree.
      budget: createLookupBudget(genome.budgets, config.web.lookupBudget),
    },
```

In `src/security/tools.ts`, `buildOstTools` already resolves `const genome = ctx.genome ?? defaultGenome();` (Task 2, alongside `import { defaultGenome } from "../genome/load.js";`) — add that line and that import if they are not yet present. Then replace the defensive re-default (currently line 96-98):

```typescript
  // One budget for all web lookups this pass/session — created here if the
  // context didn't bring one, so the bound holds on every surface. Under the
  // default gene (sharedPool: null, perClass: {}) this is the same class-blind
  // counter of ten it has always been.
  const lookupBudget = ctx.web?.budget ?? createLookupBudget(genome.budgets);
```

And at both spend sites — `ost_search_web` (currently line 350) and `ost_read_web` (currently line 377) — replace the identical line:

```typescript
        if (!lookupBudget.take()) return budgetSpentMessage(lookupBudget.limit, genome.budgets.onExhaustion);
```

`take()` is deliberately still argument-less *here*. Task 7 — a committed task in this same phase — resolves `process.env.OST_UNKNOWN` to a tree node, runs `classifyUnknown`, and edits these two lines to pass the class as `lookupBudget.take(klass)`; until then every lookup charges the shared pool, which is what makes this task a pure refactor at the spend site.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/web/budget.test.ts test/security/web-tools.test.ts test/runner/context.test.ts`
Expected: PASS — 15 tests in `test/web/budget.test.ts` (this task authors that file end to end); `test/security/web-tools.test.ts` grows by 2 tests and `test/runner/context.test.ts` grows by 3 tests, and nothing previously green in either goes red.

Then run the full gate: `npm test && npm run build`
Expected: PASS — no file other than the three above changes its count. `test/config/load.test.ts` in particular must stay green: `web.lookupBudget` is still in `ost.config.yaml` and still scaffolded by `defaultConfigYaml`, because under D6 it is the number that wins by default.

- [ ] **Step 5: Commit**

```bash
git add src/web/budget.ts src/security/tools.ts src/runner/context.ts test/web/budget.test.ts test/security/web-tools.test.ts test/runner/context.test.ts
git commit -m "feat(genome): how much looking a session may do, and what it says when it stops"
```

---

### Task 7: G5 — attribution, the missing joint

The Phase 1 ledger reads `OST_UNKNOWN` on every tool call (`src/telemetry/usage.ts:78`) and **nothing outside a test has ever written it** — verified by grep over `src/ test/ scripts/ examples/ .claude/ .claude-plugin/`. So in every real vault `UsageEvent.unknown` is always absent, `rollUpUsage` credits everything to `unattributed`, and per-unknown cost is structurally zero. This task closes the joint at the one dispatch point every MCP call passes through, and gives the reader a policy for the marker it cannot recognise.

Two halves, one commit, because they are the two ends of the same claim: the writer declares what it believes it is spending on, and the reader decides what to do with a name that is no longer on the tree.

**Files:**
- Modify: `src/security/tools.ts` (add exported `ATTRIBUTABLE_TOOLS` + `unknownProperty()`; declare the optional `unknown` property on those tools' `input_schema` inside `buildOstTools`, after the `all` array at `:541`)
- Modify: `src/security/tools.ts` — the two spend sites (`ost_search_web` at `:350`, `ost_read_web` at `:377`): resolve the marker's class once per call and hand it to `lookupBudget.take(klass)`. This is the other end of Task 6's `take(klass?)`; without it `budgets.perClass` is a gene nothing reads.
- Modify: `src/mcp/server.ts` (add `declaredUnknown()`; `handleOstCall` at `:168` takes ownership of `process.env.OST_UNKNOWN` around `await tool.run(args)` and restores it in a `finally`)
- Modify: `src/eval/attention.ts` (`rollUpUsage` at `:107` takes the `staleAttribution` allele; `computeAttention` at `:153` READS `opts.attribution?.staleAttribution` — Task 3 already declared the field on `AttentionOptions`; this task is the first thing that looks at it)
- Test: `test/mcp/attribution.test.ts` (create), `test/eval/attention.test.ts` (append one `describe`), `test/security/web-tools.test.ts` (append one `describe` — the per-class cap, wired)
- **Untouched, deliberately:** `src/security/policy.ts` (`ALLOWED_TOOL_NAMES`, 20 names) and `MCP_TOOL_NAMES` (`src/mcp/server.ts:22`, 18 names). Attribution rides existing schemas; it adds no verb.

**Interfaces:**
- Consumes: `AttributionGene { staleAttribution: "drop" | "unattributed" }` from `src/genome/schema.js` (Task 1); `AttentionOptions.attribution?: AttributionGene` on `computeAttention(tree, vaultDir, opts?)` (Task 3 declares the field — this task supplies its interpretation, and adds no field of its own); `classifyUnknown(node, classifier?)` from `src/knowledge/unknowns.js` (Task 4); `createLookupBudget(policy?, operatorLimit?)` and `LookupBudget.take(klass?: string)` from `src/web/budget.js` (Task 6 — the class parameter this task is the caller of); `ToolContext.genome?: Genome` and the resolved `genome` local in `buildOstTools` (Task 2); `validateToolInput(schema, input)` from `src/security/validateToolInput.js`; `withUsageTracing`'s per-invocation read of `process.env.OST_UNKNOWN` (`src/telemetry/usage.ts:78`, pinned by `test/telemetry/usage.test.ts:135`).
- Produces:
  - `export const ATTRIBUTABLE_TOOLS: readonly string[]` in `src/security/tools.ts` — the tools whose `inputSchema` carries the optional `unknown: { type: "string" }` property.
  - `process.env.OST_UNKNOWN` is set for exactly the span of one MCP tool call, so any code running inside `tool.run` may read it. Task 6's per-class budget takes its class from exactly there (`OST_UNKNOWN` → tree lookup → `classifyUnknown`), and **this task is what performs that resolution**: both web spend sites now call `lookupBudget.take(spendClass())`, so `budgets.perClass` becomes a gene something reads rather than one that ships dormant forever.
  - `computeAttention(..., { attribution: { staleAttribution: "unattributed" } })` folds events naming an off-tree title into `unattributed` instead of dropping them. Default stays `"drop"` — byte-identical to today.

- [ ] **Step 1: Write the failing test**

Create `test/mcp/attribution.test.ts`:

```typescript
/**
 * The joint the Phase 1 ledger was built for.
 *
 * `withUsageTracing` has read OST_UNKNOWN since Phase 1 and nothing outside a
 * test has ever written it, so every event in every real vault is unattributed
 * and per-unknown cost is structurally zero. This suite pins the mechanism that
 * closes that: an optional `unknown` property on the tools whose spend can
 * honestly belong to one unknown, read by the single MCP dispatch point and
 * held in the environment for exactly the span of one call.
 *
 * Most of what follows is about what happens when a call ENDS — normally, by
 * throwing, or with some stale value already present. A leaked marker does not
 * fail loudly: it silently bills the next call to the wrong unknown, which is
 * worse than no attribution at all, because a wrong number reads as a measured
 * one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { createOstMcpServer, MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { ALLOWED_TOOL_NAMES } from "../../src/security/policy.js";
import { ATTRIBUTABLE_TOOLS, buildOstTools } from "../../src/security/tools.js";
import { usageLogPath, type UsageEvent } from "../../src/telemetry/usage.js";

const OUTCOME = "Reach ten returning operators";
const DARK = "How many users hit the export path";

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-attribution-"));
  await initVault(dir, "Reach ten returning operators.", OUTCOME);
  delete process.env.OST_UNKNOWN;
});
afterEach(() => {
  delete process.env.OST_UNKNOWN;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function connect(): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createOstMcpServer(buildPassContext(dir));
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

function events(): UsageEvent[] {
  const file = usageLogPath(dir);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as UsageEvent);
}

function last(tool: string): UsageEvent {
  const found = events().filter((e) => e.tool === tool);
  if (found.length === 0) throw new Error(`no usage event was recorded for ${tool}`);
  return found[found.length - 1];
}

describe("a tool call that names the unknown it serves", () => {
  test("stamps that name onto the usage trace — this is where cost-to-resolve comes from", async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: "ost_annotate",
      arguments: { title: OUTCOME, issue: "checked the export funnel", unknown: DARK },
    })) as { isError?: boolean };

    expect(res.isError).toBeFalsy();
    expect(last("ost_annotate").unknown).toBe(DARK);
  });

  test("stamps NOTHING when the call names no unknown — silence is not a guess", async () => {
    const client = await connect();
    await client.callTool({
      name: "ost_annotate",
      arguments: { title: OUTCOME, issue: "ordinary housekeeping" },
    });

    expect("unknown" in last("ost_annotate")).toBe(false);
  });

  test("clears the marker when the tool THROWS — a failed exploration must not bill the next call", async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: "ost_create_node",
      arguments: {
        title: "Orphaned darkness",
        layer: "Unknown",
        parent: "no such parent",
        body: "## Format\nx",
        evidence: "assertion",
        unknown: DARK,
      },
    })) as { isError?: boolean };

    expect(res.isError).toBe(true);
    // The wasted attempt is exactly the spend worth seeing, so it is attributed.
    expect(last("ost_create_node").ok).toBe(false);
    expect(last("ost_create_node").unknown).toBe(DARK);
    // …and the marker does not outlive the call that set it.
    expect(process.env.OST_UNKNOWN).toBeUndefined();
  });

  test("a later call does NOT inherit the earlier call's marker", async () => {
    const client = await connect();
    await client.callTool({
      name: "ost_annotate",
      arguments: { title: OUTCOME, issue: "spent on the unknown", unknown: DARK },
    });
    await client.callTool({
      name: "ost_append_to_node",
      arguments: { title: OUTCOME, section: "## Notes\nspent on nothing in particular" },
    });

    expect(last("ost_annotate").unknown).toBe(DARK);
    expect("unknown" in last("ost_append_to_node")).toBe(false);
  });

  test("an ambient OST_UNKNOWN attributes nothing and survives the call unchanged — dispatch owns the variable, not the shell", async () => {
    process.env.OST_UNKNOWN = "Something an operator exported hours ago";
    const client = await connect();
    await client.callTool({
      name: "ost_annotate",
      arguments: { title: OUTCOME, issue: "declared nothing" },
    });

    expect("unknown" in last("ost_annotate")).toBe(false);
    expect(process.env.OST_UNKNOWN).toBe("Something an operator exported hours ago");
  });
});

describe("the marker is declared, never smuggled", () => {
  test("a tool that does not accept attribution REFUSES the property rather than ignoring it", async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: "ost_next_work",
      arguments: { unknown: DARK },
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/unexpected property `unknown`/);
  });

  test("every attributable tool declares the property, so the input validator lets it through", () => {
    const tools = buildOstTools(buildPassContext(dir)) as unknown as Array<{
      name: string;
      input_schema: { properties?: Record<string, unknown>; additionalProperties?: boolean };
    }>;

    for (const name of ATTRIBUTABLE_TOOLS) {
      const t = tools.find((x) => x.name === name)!;
      expect(Object.keys(t.input_schema.properties ?? {})).toContain("unknown");
      // The declaration is what makes it legal; the closed schema is what makes
      // an undeclared property an error rather than a silent no-op.
      expect(t.input_schema.additionalProperties).toBe(false);
    }
  });
});

describe("attribution added no tool", () => {
  test("the allowlist is the same 20 names and the MCP surface the same 18 — a marker is an argument, not a verb", () => {
    expect(ALLOWED_TOOL_NAMES).toHaveLength(20);
    expect(MCP_TOOL_NAMES).toHaveLength(18);
    for (const name of [...ALLOWED_TOOL_NAMES, ...MCP_TOOL_NAMES]) {
      expect(name).not.toMatch(/unknown/i);
    }
    // And every attributable name is an existing allowlisted tool, so the set
    // cannot become a back door for a new one.
    for (const name of ATTRIBUTABLE_TOOLS) {
      expect([...MCP_TOOL_NAMES] as string[]).toContain(name);
    }
  });
});
```

Append to `test/eval/attention.test.ts` (its `unknown`, `FULL` and `tmp` helpers are already in scope at `:10-16`; the assertions read fields individually rather than `toEqual`-ing the whole bucket, so they survive `unattributed` growing a `tokens` field later):

```typescript
describe("computeAttention — the staleAttribution gene", () => {
  const ghostLog = (dir: string): void => {
    fs.mkdirSync(path.dirname(usageLogPath(dir)), { recursive: true });
    fs.writeFileSync(
      usageLogPath(dir),
      [
        JSON.stringify({ ts: "a", tool: "ost_read_web", ok: true, ms: 5, surface: "mcp", argBytes: 0, unknown: "Ghost" }),
        JSON.stringify({ ts: "b", tool: "ost_read_web", ok: true, ms: 7, surface: "mcp", argBytes: 0, unknown: "U" }),
      ].join("\n"),
      "utf8",
    );
  };

  test("the default drops a marker naming a title not on the tree — an explicit `drop` and saying nothing agree", () => {
    const dir = tmp();
    ghostLog(dir);
    const byDefault = computeAttention([unknown("U")], dir);
    const explicit = computeAttention([unknown("U")], dir, { attribution: { staleAttribution: "drop" } });

    expect(byDefault.unattributed.calls).toBe(0);
    expect(explicit.unattributed.calls).toBe(0);
    expect(byDefault.unknowns[0].calls).toBe(1);
    expect(explicit.unknowns[0].calls).toBe(1);
  });

  test("`unattributed` folds a renamed unknown's spend back in — the attention was still spent on something", () => {
    const dir = tmp();
    ghostLog(dir);
    const rollup = computeAttention([unknown("U")], dir, { attribution: { staleAttribution: "unattributed" } });

    expect(rollup.unattributed.calls).toBe(1);
    expect(rollup.unattributed.ms).toBe(5);
    // The live attribution is untouched: only the ghost moves.
    expect(rollup.unknowns[0].calls).toBe(1);
    expect(rollup.unknowns[0].ms).toBe(7);
  });
});
```

Append to `test/security/web-tools.test.ts` — the marker's other end. Task 6 shipped `take(klass?)` and proved the cap works when a class is *handed* to it; this is the test that proves a class actually arrives at the spend site, which is the whole point of the marker. Add `import { defaultGenome } from "../../src/genome/load.js";` to that file's import block if Task 6 has not already put it there, and `afterEach(() => { delete process.env.OST_UNKNOWN; });`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/mcp/attribution.test.ts test/eval/attention.test.ts test/security/web-tools.test.ts`

Expected: FAIL —
- `test/mcp/attribution.test.ts` fails to collect: `No matching export in "src/security/tools.ts" for import "ATTRIBUTABLE_TOOLS"`. With that import removed by hand, the first test fails on `expected true to be falsy` because `ost_annotate` answers `invalid input for "ost_annotate":\n  - unexpected property \`unknown\` — allowed: title, issue`.
- `test/eval/attention.test.ts` → `AssertionError: expected +0 to be 1` at `expect(rollup.unattributed.calls).toBe(1)`; `computeAttention` accepts `opts.attribution` (Task 3) but nothing reads it yet.
- `test/security/web-tools.test.ts` → `AssertionError: expected '…hello…' to match /budget spent/i` on the second lookup; `take()` is still called with no class, so the `bounded` cap of 1 is never consulted.

- [ ] **Step 3: Write the implementation**

**(a) `src/security/tools.ts`** — declare the property. Insert after `CHILD_HIERARCHY` (`:59-64`):

```typescript
/**
 * The tools whose spend can honestly belong to ONE unknown.
 *
 * Attribution is declared, not inferred: each of these carries an optional
 * `unknown` property naming the #Unknown node the call is being spent on, which
 * the MCP dispatch point turns into the OST_UNKNOWN marker `withUsageTracing`
 * already reads. The alternative — inferring attribution from whichever node a
 * call happens to name — would make "unattributed share" a heuristic artifact
 * rather than the honest metric the design requires it to be.
 *
 * The line is: does this call do work on behalf of one unknown — write to the
 * tree, or reach outside the vault? The whole-tree reports (`ost_read_tree`,
 * `ost_next_work`, `ost_check`, `ost_debt`, `ost_status`, `ost_gate`) and
 * `ost_ingest_inbox` are not here: they answer questions about the tree as a
 * whole, and `ost_next_work` in particular is the call you make BEFORE you know
 * which unknown you are working.
 *
 * `ost_flag_humans_required` is excluded deliberately despite being a write. Its
 * schema is pinned to exactly two properties by a guard that exists to keep the
 * permissive lane call inexpressible (test/security/lane-capability.test.ts);
 * widening it, even with something inert, re-opens a boundary settled elsewhere,
 * and one rarely-called tool's attribution is not worth that.
 */
export const ATTRIBUTABLE_TOOLS: readonly string[] = [
  "ost_create_node",
  "ost_append_to_node",
  "ost_link_nodes",
  "ost_set_status",
  "ost_set_evidence",
  "ost_annotate",
  "ost_search_web",
  "ost_read_web",
  "ost_read_repo",
  "ost_rank_source",
] as const;

const ATTRIBUTABLE = new Set<string>(ATTRIBUTABLE_TOOLS);

/**
 * A fresh schema fragment per tool, so no two schemas share one object.
 *
 * Nothing validates the title against the tree here. A name that is not (or is
 * no longer) on the tree is a bookkeeping disagreement, and refusing an
 * otherwise-valid write over one would be a worse trade than an honestly stale
 * record; what to do with it is a read-time decision the genome makes
 * (`attribution.staleAttribution`).
 */
function unknownProperty(): Record<string, unknown> {
  return {
    type: "string",
    description:
      "Optional: the title of the #Unknown node this call is being spent on, so the attention it costs is attributed to the darkness it was meant to reduce. Omit it when the call serves no particular unknown — spend with no marker is recorded as unattributed, and an unattributed call is better than one billed to the wrong unknown.",
  };
}
```

Then, in `buildOstTools`, immediately after the `all` array literal closes (`src/security/tools.ts:541`, the `];`) and before `const names = allowedNames ? …`:

```typescript
  // Declared, never smuggled: every schema above carries
  // `additionalProperties: false`, so an undeclared `unknown` would be refused
  // by validateToolInput before the tool ever ran. Each `all` element is built
  // fresh on every call, so mutating its schema here is local to this tool set.
  for (const t of all) {
    if (!ATTRIBUTABLE.has(t.name)) continue;
    const schema = t.input_schema as { properties?: Record<string, unknown> };
    schema.properties = { ...(schema.properties ?? {}), unknown: unknownProperty() };
  }
```

**(b) `src/mcp/server.ts`** — set the marker at the one dispatch point. Add above `handleOstCall` (`:141`):

```typescript
/**
 * The attribution marker a call declares, if any.
 *
 * Reads the optional `unknown` property the attributable tools declare (see
 * ATTRIBUTABLE_TOOLS in security/tools.ts). Called only after
 * `validateToolInput` has passed, so a tool that does not declare the property
 * has already been refused rather than quietly ignored.
 */
function declaredUnknown(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const value = (args as { unknown?: unknown }).unknown;
  if (typeof value !== "string") return undefined;
  const title = value.trim();
  return title.length > 0 ? title : undefined;
}
```

Then replace the `try { … } catch { … }` block at `src/mcp/server.ts:168-178` with:

```typescript
  // OST_UNKNOWN is process-global and this server is long-lived, so dispatch
  // takes ownership of it for exactly the span of one call: SET when the call
  // declares an unknown, DELETED when it does not — silence must read as
  // silence even when some earlier value is still lying around — and restored
  // to whatever it was in a `finally`, including when the tool throws. A leaked
  // marker bills the next call to the wrong unknown, which is worse than no
  // attribution: a wrong number reads as a measured one.
  //
  // Be plain about the limit. This is correct because MCP dispatch here handles
  // one call at a time and `withUsageTracing` reads the variable inside the same
  // call it wraps (src/telemetry/usage.ts:78). It is NOT concurrency-safe in
  // general: two calls genuinely interleaved in one process would race on one
  // variable, and the loser would be attributed to the winner's unknown. If this
  // surface ever dispatches concurrently, the marker must stop being an
  // environment variable and become an argument threaded into withUsageTracing.
  const marker = declaredUnknown(args);
  const priorMarker = process.env.OST_UNKNOWN;
  try {
    if (marker) process.env.OST_UNKNOWN = marker;
    else delete process.env.OST_UNKNOWN;
    const out = await tool.run(args);
    let text = typeof out === "string" ? out : JSON.stringify(out);
    if (MUTATING.has(name)) {
      const commit = await enqueueCommit(ctx.dir, `mcp: ${name} — ${text}`);
      text += commit.committed ? `\ncommitted ${commit.sha.slice(0, 8)}` : `\n(no changes to commit)`;
    }
    return { content: [{ type: "text", text }] };
  } catch (e) {
    return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
  } finally {
    if (priorMarker === undefined) delete process.env.OST_UNKNOWN;
    else process.env.OST_UNKNOWN = priorMarker;
  }
```

**(c) `src/eval/attention.ts`** — interpret the gene. Add the type import beside the existing ones (after `:28`):

```typescript
import type { AttributionGene } from "../genome/schema.js";
```

Replace the `rollUpUsage` signature (`:107`) and the stale-attribution line (`:128`):

```typescript
function rollUpUsage(
  vaultDir: string,
  knownTitles: ReadonlySet<string>,
  staleAttribution: AttributionGene["staleAttribution"] = "drop",
): UsageRollup {
```

```typescript
      if (!knownTitles.has(event.unknown)) {
        // A marker naming a title not on this tree. `drop` (the default, and
        // exactly today) counts it neither way: crediting a title that does not
        // exist would be a fabrication, and folding it into `unattributed` would
        // conflate "said nothing" with "said something stale". `unattributed` is
        // the other honest reading — a renamed or deleted unknown still cost
        // what it cost, and losing that spend flatters the unattributed share.
        if (staleAttribution === "unattributed") {
          unattributed.calls++;
          unattributed.ms += ms;
        }
        continue;
      }
```

And thread it from `computeAttention` (`:153`):

```typescript
  const usage = rollUpUsage(
    vaultDir,
    new Set(darkNodes.map((n) => n.title)),
    opts.attribution?.staleAttribution ?? "drop",
  );
```

Finally, amend the module JSDoc at `src/eval/attention.ts:21-23` so it stops describing a policy that is now an allele — replace “or neither (an `unknown` field naming a title not on this tree, which is not credited to anything rather than guessed at)” with:

```
 * or neither — an `unknown` field naming a title not on this tree, whose fate
 * is the `attribution.staleAttribution` allele: dropped (the default, and what
 * this always did) or folded into unattributed.
```

**(d) `src/security/tools.ts` again** — spend the class, not just the pool. Task 6 gave `take` an optional class and left both spend sites calling it blind, because the class can only come from the marker this task introduces. Close it here.

Add the import beside the existing ones:

```typescript
import { classifyUnknown } from "../knowledge/unknowns.js";
```

Then, inside `buildOstTools`, immediately after the `lookupBudget` line (`:98`, where Task 6 left `createLookupBudget(genome.budgets)`) — `vault` and `genome` are both already destructured/resolved there:

```typescript
  // The class the budget charges against comes from the marker the caller set:
  // which unknown this lookup is for, classed by the genome's classifier. A call
  // with no marker charges the shared pool, exactly as before — and so does a
  // marker naming a title that is not on the tree, because a class we cannot
  // derive is not a class we may invent.
  //
  // Resolved per call rather than per tool set: the marker changes between
  // calls (dispatch owns it for exactly one call's span), so a value captured at
  // build time would bill every lookup to whichever unknown happened to be
  // current when the tools were built. The tree read is one directory scan
  // against a network fetch — the wrong thing to optimise here would be
  // correctness.
  const spendClass = (): string | undefined => {
    const title = process.env.OST_UNKNOWN;
    if (!title) return undefined;
    const node = vault.readTree().find((n) => n.layer === "Unknown" && n.title === title);
    return node ? classifyUnknown(node, genome.classifier) : undefined;
  };
```

And at both spend sites — `ost_search_web` (`:350`) and `ost_read_web` (`:377`) — the line Task 6 left as `lookupBudget.take()` becomes:

```typescript
        if (!lookupBudget.take(spendClass())) return budgetSpentMessage(lookupBudget.limit, genome.budgets.onExhaustion);
```

That is the whole of it, and it is what makes `budgets.perClass` a gene something reads. Under the default genome `perClass` is `{}`, every class is uncapped, and the counter behaves exactly as it did before either task — the wiring is observable only to a vault that writes a cap.

- [ ] **Step 4: Run tests to verify they pass, and that the allowlist did not grow**

Run: `npx vitest run test/mcp/attribution.test.ts test/eval/attention.test.ts test/security/web-tools.test.ts test/security/policy.test.ts test/security/lane-capability.test.ts test/mcp/tool-input-validation.test.ts test/security/unknown-layer.test.ts test/telemetry/usage.test.ts`

Expected: PASS — 8 tests in `test/mcp/attribution.test.ts` (this task creates that file outright); `test/eval/attention.test.ts` grows by 2 tests and `test/security/web-tools.test.ts` by 1, and nothing previously green in either goes red — both files are appended to by earlier tasks, so the number to check is the delta, not the total. Every pre-existing suite is otherwise unchanged. In particular `test/security/lane-capability.test.ts` still asserts `ost_flag_humans_required`'s schema keys are exactly `["test","why"]`, and `test/security/unknown-layer.test.ts` still gets `[]` problems from `validateToolInput` for an `ost_create_node` input with no `unknown`.

Then the frozen-surface check — this must print both lines with no diff:

```bash
git diff --exit-code src/security/policy.ts && echo "ALLOWED_TOOL_NAMES untouched"
git diff src/mcp/server.ts | grep -E '^[+-]\s+"ost_|^[+-]\s+"git_' ; test -z "$(git diff src/mcp/server.ts | grep -E '^[+-]\s+"ost_|^[+-]\s+"git_')" && echo "MCP_TOOL_NAMES untouched"
```

Then the whole gate:

```bash
npm test && npm run build
```

Expected: PASS — the suite grows by exactly one file and eleven tests relative to the count before this task (8 new + 2 in `test/eval/attention.test.ts` + 1 in `test/security/web-tools.test.ts`); `tsc` clean. No existing test is edited by this task — the two touched files are only appended to. (`tsconfig.json` includes `src/**/*` only, so `npm run build` never type-checks a test file; a type error in one of these surfaces at vitest runtime, not in the build.)

- [ ] **Step 5: Commit**

```bash
git add src/security/tools.ts src/mcp/server.ts src/eval/attention.ts test/mcp/attribution.test.ts test/eval/attention.test.ts test/security/web-tools.test.ts
git commit -m "feat(mcp): a call may name the darkness it is spent on"
```

---

### Task 8: G6 — the pivot gene

`computeNextWork` learns what the genome wants done with darkness: whether it blocks `done`, how much of it to show, and in what order. The v1 alleles (`unknownsBlockDone: false`, `maxOpenUnknownsSurfaced: 0`, `ranking: tree-order`) reproduce today's behavior exactly — the four-term `&&` at `src/mcp/next-work.ts:156-160`, the unsorted `.filter().map()` at `:147-154`, and both summary strings byte-for-byte.

Three decisions this task makes, in writing:

1. **`ranking: "cost-to-resolve"` is out of scope here, and it falls back to tree order *loudly*.** Ranking by cost requires `computeAttention` (`src/eval/attention.ts:147`) inside `computeNextWork`, which would make a read of the whole attention ledger a cost of every `ost_next_work` call — new work, and not this task's. The other option was to have `GenomeSchema` reject the allele at load time; rejected, because the enum in Task 1 is the gene *vocabulary*, and a harness that breeds a value the current kernel cannot execute should still produce a loadable genome. So the kernel accepts the allele, lists in tree order, and appends the reason to `summary`. The rule is the same one that governs the cap: a kernel that quietly does something other than what the genome said is a kernel whose fitness record is a lie.
2. **`maxOpenUnknownsSurfaced` truncates the list but never the `done` computation.** The cap is a display limit, not an amnesty — `done` is computed over the full open set before the slice, and the summary names how many were hidden. A silent cap reads as "that's all the darkness there is."
3. **`NextWork` gains no new field.** An `openUnknownsTotal` present in every response would change the JSON `ost_next_work` returns for every vault, including one with no `genome.yaml` — which is precisely what behavioral identity forbids. The truncation is announced where a session actually reads it: `summary`.

This task also threads `genome.classifier` and `genome.resolution` into the three knowledge calls `computeNextWork` already makes. That is not scope creep — `ranking: class-priority` orders by `klass`, and a `klass` derived from the compiled-in classifier while the genome declares a different vocabulary would rank against classes that do not exist.

**Files:**
- Modify: `src/mcp/next-work.ts` (import the genome; `computeNextWork` gains a 4th positional `genome`; new `rankOpenUnknowns` helper; `done`, truncation, and `summary` become pivot-driven; `classifyUnknown`/`resolutionState`/`contractGaps` receive their genes)
- Modify: `src/security/tools.ts:124` (the only production caller — pass `genome` through)
- Test: `test/mcp/next-work.test.ts` (append)

**Interfaces:**
- Consumes:
  - `defaultGenome(): Genome` and `GenomeSchema` from `src/genome/load.js` / `src/genome/schema.js` (Task 1)
  - `Genome`, `PivotGene` types (Task 1)
  - `ToolContext.genome?: Genome` and the `const genome = ctx.genome ?? defaultGenome();` local in `buildOstTools` (Task 2)
  - `classifyUnknown(node, classifier?)`, `resolutionState(node, resolution?)`, `contractGaps(node, sections?)` (Tasks 4, 5)
- Produces: `computeNextWork(vault: Vault, dir: string, min: number, genome?: Genome): NextWork`. `NextWork`'s shape is unchanged. Task 11 (identity) asserts the 3-argument call and the 4-argument call with `defaultGenome()` return deep-equal results.

**Caller audit (grep, verified):** `grep -rn "computeNextWork" src test scripts` returns exactly one production call site — `src/security/tools.ts:124`, inside `ost_next_work`'s `run`. `src/cli/index.ts` and `src/mcp/bootstrap.ts` do **not** call it; they reach `ost_next_work` through `buildOstTools`. Nothing else to update.

- [ ] **Step 1: Write the failing test**

Append to `test/mcp/next-work.test.ts`. The file already creates `dir` in `beforeEach` via `initVault(dir, "Reach 10,000 daily active users", "Retention")` — note that `"Retention"` is the **Outcome** node (`src/runner/init.ts:50-64`), which is why a fresh vault is `done` at `min: 1` and why `darkens` reads `"Retention"`.

Add these imports to the top of the file, after the existing `computeNextWork` import:

```typescript
import { defaultGenome } from "../../src/genome/load.js";
import { GenomeSchema } from "../../src/genome/schema.js";
import type { Genome } from "../../src/genome/schema.js";
```

Then append this block:

```typescript
/**
 * The pivot gene is the one allele that can change what `done` MEANS, so its
 * default is tested as an identity rather than as a behaviour: the 4-argument
 * call with the default genome must be indistinguishable from the 3-argument
 * call that every vault without a genome.yaml makes.
 *
 * Ordering assertions never hard-code a title sequence. Tree order is
 * `fs.readdirSync` order over the vault root (src/ost/vault.ts:110), which is
 * filesystem-dependent; each ranking test derives its expectation from the
 * tree-order baseline it just observed, so it tests the ranking rather than the
 * filesystem.
 */
describe("computeNextWork — the pivot gene", () => {
  const BOUNDED = "## Format\na count per day\n\n## Methodology\nquery the export log\n\n## Rationale\nserves [[Retention]]";
  const UNREACHED = "## Format\na count per day\n\n## Rationale\nserves [[Retention]]";
  const UNBOUNDED = "nothing declared at all";

  /** Attach an Unknown under the Outcome `initVault` creates. */
  function addUnknown(title: string, body: string, status?: "validated" | "deferred") {
    const ctx = buildPassContext(dir);
    ctx.vault.createNode({
      title,
      layer: "Unknown",
      body,
      tags: [],
      links: [],
      evidence: "assertion",
      ...(status ? { status } : {}),
    });
    ctx.vault.linkNodes("Retention", title);
  }

  /** Fresh read of the work, optionally under a non-default genome. */
  const work = (genome?: Genome) => computeNextWork(buildPassContext(dir).vault, dir, 1, genome);

  /** A genome that differs from the default in the pivot section only. */
  const pivot = (allele: Record<string, unknown>): Genome => GenomeSchema.parse({ pivot: allele });

  test("the default genome never pivots — passing it explicitly is indistinguishable from not passing one", () => {
    addUnknown("How many users hit the export path", UNBOUNDED);
    const implicit = work();
    const explicit = work(defaultGenome());
    expect(implicit.done).toBe(true);
    expect(explicit).toEqual(implicit);
    expect(explicit.summary).toContain("does not block done");
    expect(explicit.summary).not.toContain("Showing");
  });

  test("unknownsBlockDone makes darkness outstanding — a tree is not maintained while it cannot see", () => {
    addUnknown("How many users hit the export path", UNBOUNDED);
    const blocked = work(pivot({ unknownsBlockDone: true }));
    expect(blocked.openUnknowns).toHaveLength(1);
    expect(blocked.done).toBe(false);
    expect(blocked.summary).toContain("blocks done");
  });

  test("unknownsBlockDone changes NOTHING once the darkness is resolved — it blocks on open unknowns, not on unknowns", () => {
    addUnknown("How many users hit the export path", `${BOUNDED}\n\n## Answer\n412 per day`);
    const blocked = work(pivot({ unknownsBlockDone: true }));
    expect(blocked.openUnknowns).toHaveLength(0);
    expect(blocked.done).toBe(true);
  });

  test("maxOpenUnknownsSurfaced caps the list AND the summary says what it hid — a silent cap reads as 'that is all the darkness there is'", () => {
    addUnknown("How many users hit the export path", UNBOUNDED);
    addUnknown("Which cohort abandons at the second step", UNBOUNDED);
    addUnknown("Whether the weekly digest is ever opened", UNBOUNDED);

    const treeOrder = work().openUnknowns.map((u) => u.title);
    expect(treeOrder).toHaveLength(3);

    const capped = work(pivot({ maxOpenUnknownsSurfaced: 2 }));
    expect(capped.openUnknowns.map((u) => u.title)).toEqual(treeOrder.slice(0, 2));
    expect(capped.summary).toContain("Showing 2 of 3");
    expect(capped.summary).toContain("1 more");
  });

  test("a cap truncates the list ONLY — done is still computed over every open unknown, never the visible ones", () => {
    addUnknown("How many users hit the export path", UNBOUNDED);
    addUnknown("Which cohort abandons at the second step", UNBOUNDED);
    addUnknown("Whether the weekly digest is ever opened", UNBOUNDED);

    const capped = work(pivot({ unknownsBlockDone: true, maxOpenUnknownsSurfaced: 1 }));
    expect(capped.openUnknowns).toHaveLength(1);
    expect(capped.done).toBe(false);
    expect(capped.summary).toContain("3 open unknown(s)");
  });

  test("class-priority orders by the genome's list and puts an unlisted class last", () => {
    addUnknown("How many users hit the export path", UNBOUNDED);
    addUnknown("Which cohort abandons at the second step", UNREACHED);
    addUnknown("Whether the weekly digest is ever opened", BOUNDED);

    const ranked = work(pivot({ ranking: "class-priority", classPriority: ["bounded", "unreached"] }));
    expect(ranked.openUnknowns.map((u) => u.klass)).toEqual(["bounded", "unreached", "unbounded"]);
  });

  test("class-priority is stable within a class — two equally-ranked unknowns keep the order the tree gave them", () => {
    addUnknown("How many users hit the export path", BOUNDED);
    addUnknown("Which cohort abandons at the second step", UNBOUNDED);
    addUnknown("Whether the weekly digest is ever opened", BOUNDED);

    const treeOrder = work().openUnknowns.map((u) => u.title);
    const boundedInTreeOrder = treeOrder.filter((t) => t !== "Which cohort abandons at the second step");

    const ranked = work(pivot({ ranking: "class-priority", classPriority: ["bounded"] }));
    expect(ranked.openUnknowns.map((u) => u.klass)).toEqual(["bounded", "bounded", "unbounded"]);
    expect(ranked.openUnknowns.slice(0, 2).map((u) => u.title)).toEqual(boundedInTreeOrder);
  });

  test("tree-order is today's order — naming it explicitly reorders nothing", () => {
    addUnknown("How many users hit the export path", UNBOUNDED);
    addUnknown("Which cohort abandons at the second step", BOUNDED);
    addUnknown("Whether the weekly digest is ever opened", UNREACHED);

    const treeOrder = work().openUnknowns.map((u) => u.title);
    expect(work(pivot({ ranking: "tree-order" })).openUnknowns.map((u) => u.title)).toEqual(treeOrder);
  });

  test("cost-to-resolve is not implemented here — it lists in tree order and SAYS so rather than pretending it ranked", () => {
    addUnknown("How many users hit the export path", UNBOUNDED);
    addUnknown("Which cohort abandons at the second step", BOUNDED);

    const treeOrder = work().openUnknowns.map((u) => u.title);
    const attempted = work(pivot({ ranking: "cost-to-resolve" }));
    expect(attempted.openUnknowns.map((u) => u.title)).toEqual(treeOrder);
    expect(attempted.summary).toContain("cost-to-resolve");
    expect(attempted.summary).toContain("tree order");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/mcp/next-work.test.ts`
Expected: FAIL — `Expected 3 arguments, but got 4.` on every `work(...)` call that passes a genome (vitest reports it as a runtime mismatch: the 4th argument is ignored, so `unknownsBlockDone` has no effect and the first failing assertion is `expected true to be false` in *"unknownsBlockDone makes darkness outstanding"*). `npm run build` stays clean — `tsconfig.json` excludes `test/`, so a test-file type error surfaces only as the runtime failure above.

- [ ] **Step 3: Write the implementation**

In `src/mcp/next-work.ts`, add the genome imports beneath the existing `unknowns.js` import (ESM `.js` specifiers, as everywhere):

```typescript
import { classifyUnknown, contractGaps, resolutionState, type UnknownClass } from "../knowledge/unknowns.js";
import { defaultGenome } from "../genome/load.js";
import type { Genome, PivotGene } from "../genome/schema.js";
```

Replace the `openUnknowns` doc comment on `NextWork` (currently `src/mcp/next-work.ts:60-67`) — preserve the original argument verbatim and record that it is now the *default*, not the only, answer:

```typescript
  /**
   * Darkness the tree has declared and not yet resolved. Reported as available
   * work but, under the default genome, deliberately NOT part of `done`: an
   * unbounded unknown has no stopping condition, so counting it toward
   * completion would wedge every pass forever. `done` means maintenance is
   * complete; exploration is discretionary and budget-governed.
   *
   * `pivot.unknownsBlockDone` is the allele that may overturn that — a variant
   * that refuses to call a tree maintained while it still cannot see. It is
   * `false` in v1 because the argument above is the one we can defend today,
   * not because it is unfalsifiable.
   *
   * This list may be TRUNCATED by `pivot.maxOpenUnknownsSurfaced`. `done` never
   * is: it is computed over every open unknown, before the cap applies.
   */
  openUnknowns: OpenUnknown[];
```

Add the ranking helper immediately above `computeNextWork`:

```typescript
/**
 * Order the open unknowns the way the genome asked.
 *
 * `tree-order` is the identity — the order the tree walk produced, which is
 * what every pass before the genome saw. `class-priority` sorts by the position
 * of each unknown's class in `classPriority`, with any class the list does not
 * name sorted last; `Array.prototype.sort` is stable (ES2019), so two unknowns
 * of the same class keep their tree order and the gene stays a coarse
 * re-ordering rather than a shuffle.
 *
 * `cost-to-resolve` is a declared allele this kernel cannot execute: ranking by
 * cost means reading the attention ledger for every unknown on every
 * `ost_next_work` call, which is real work and belongs with the task that wires
 * `computeAttention` into a production path. Rather than reject the genome at
 * load time — a harness may legitimately breed an allele ahead of the kernel —
 * it falls back to tree order and the caller states the fallback in the
 * summary. A kernel that quietly does something other than what the genome said
 * produces a fitness record that is a lie.
 */
function rankOpenUnknowns(open: OpenUnknown[], pivot: PivotGene): OpenUnknown[] {
  if (pivot.ranking !== "class-priority") return open;
  const rank = (klass: UnknownClass): number => {
    const at = pivot.classPriority.indexOf(klass);
    return at === -1 ? pivot.classPriority.length : at;
  };
  return [...open].sort((a, b) => rank(a.klass) - rank(b.klass));
}
```

Change the signature and its doc comment (currently `:110-114`):

```typescript
/**
 * Compute the outstanding maintenance work for the tree in `vault` (dir holds the
 * `.ost-agent/` evidence + state sidecar). `min` is minSolutionsPerOpportunity —
 * an operator knob from `ost.config.yaml`, not an allele. `genome` carries the
 * alleles: how darkness is classed, when it is resolved, and whether it blocks
 * `done`. Both are positional and defaulted, so an absent genome.yaml and a
 * three-argument call behave exactly as they did before Phase 2.
 */
export function computeNextWork(vault: Vault, dir: string, min: number, genome: Genome = defaultGenome()): NextWork {
```

Replace everything from `const hygieneIssues = detectHygiene(tree);` (`:145`) to the end of the function:

```typescript
  const hygieneIssues = detectHygiene(tree);

  // Classification and resolution are genome-driven: `class-priority` ranking
  // orders by `klass`, and a klass derived from a compiled-in classifier while
  // the genome declares a different vocabulary would rank against classes that
  // do not exist.
  const allOpenUnknowns: OpenUnknown[] = rankOpenUnknowns(
    tree
      .filter((n) => n.layer === "Unknown" && resolutionState(n, genome.resolution) === "open")
      .map((u) => ({
        title: u.title,
        klass: classifyUnknown(u, genome.classifier),
        darkens: tree.find((p) => p.layer !== "Unknown" && p.links.includes(u.title))?.title ?? null,
        gaps: contractGaps(u, genome.classifier.contractSections),
      })),
    genome.pivot,
  );

  // The cap is a display limit, never an amnesty: `done` is computed over every
  // open unknown, and the hidden count is named in the summary. A cap that
  // silently shortened the list would read as "that is all the darkness there is".
  const cap = genome.pivot.maxOpenUnknownsSurfaced;
  const openUnknowns = cap > 0 ? allOpenUnknowns.slice(0, cap) : allOpenUnknowns;
  const hidden = allOpenUnknowns.length - openUnknowns.length;
  const blocksDone = genome.pivot.unknownsBlockDone;

  const done =
    unmappedEvidence.length === 0 &&
    underservedOpportunities.length === 0 &&
    solutionsMissingAssumptions.length === 0 &&
    hygieneIssues.length === 0 &&
    (!blocksDone || allOpenUnknowns.length === 0);

  const parts: string[] = [];
  if (unmappedEvidence.length) parts.push(`${unmappedEvidence.length} unmapped evidence item(s) → map into #Opportunity nodes`);
  if (underservedOpportunities.length) parts.push(`${underservedOpportunities.length} opportunity(ies) with < ${min} solutions → ideate #Solution nodes`);
  if (solutionsMissingAssumptions.length) parts.push(`${solutionsMissingAssumptions.length} solution(s) with no assumption test → surface #AssumptionTest nodes`);
  if (hygieneIssues.length) parts.push(`${hygieneIssues.length} hygiene issue(s) → annotate (never delete)`);
  if (allOpenUnknowns.length)
    parts.push(
      `${allOpenUnknowns.length} open unknown(s) → explore (${blocksDone ? "blocks done" : "does not block done"})`,
    );

  const truncationNote = hidden
    ? ` Showing ${openUnknowns.length} of ${allOpenUnknowns.length} — ${hidden} more open unknown(s) not listed (pivot.maxOpenUnknownsSurfaced=${cap}).`
    : "";
  const rankingNote =
    genome.pivot.ranking === "cost-to-resolve"
      ? " Ranking 'cost-to-resolve' is not implemented in this kernel — listed in tree order instead."
      : "";

  const summary = done
    ? allOpenUnknowns.length
      ? `Tree is fully maintained — nothing to do. ${allOpenUnknowns.length} open unknown(s) remain to explore (does not block done).${truncationNote}${rankingNote}`
      : "Tree is fully maintained — nothing to do."
    : `Outstanding: ${parts.join("; ")}.${truncationNote}${rankingNote}`;

  return { done, summary, unmappedEvidence, underservedOpportunities, solutionsMissingAssumptions, hygieneIssues, openUnknowns };
}
```

Under the default genome (`blocksDone` false, `cap` 0, `ranking` tree-order) `truncationNote` and `rankingNote` are both `""`, `allOpenUnknowns.length === openUnknowns.length`, and both summary strings are character-for-character what they were before this task.

Then update the one production caller. In `src/security/tools.ts`, `buildOstTools` already resolves `const genome = ctx.genome ?? defaultGenome();` beside `const minSolutions = ctx.minSolutionsPerOpportunity ?? …` (Task 2). Pass it through — replace line 124:

```typescript
      run: async () => JSON.stringify(computeNextWork(vault, dir, minSolutions, genome), null, 2),
```

If that local is somehow absent, add it beside `minSolutions` and import it — `import { defaultGenome } from "../genome/load.js";` — rather than calling `loadGenome` inside the closure: the genome is loaded exactly once per pass in `buildPassContext`, and a mid-pass reload would corrupt that run's fitness record.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/mcp/next-work.test.ts`
Expected: PASS — the file grows by 9 tests; nothing previously green goes red. The pre-existing *"an open unknown does NOT block done — an unbounded one would wedge the loop forever"* (`test/mcp/next-work.test.ts:129-137`) must still pass **unmodified** — it calls the 3-argument form and is the regression contract for this whole task.

Then run the full suite:

Run: `npm test && npm run build`
Expected: PASS — every file, clean compile. Watch `test/mcp/analysis-tools.test.ts` and `test/security/*` for any whole-object `toEqual` on an `ost_next_work` payload; `NextWork`'s shape is unchanged, so none should move.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/next-work.ts src/security/tools.ts test/mcp/next-work.test.ts
git commit -m "feat(mcp): let the genome decide whether darkness blocks done"
```

---

### Task 9: G7a — a timestamped token extractor

`readSessionTokens` (`src/adapters/tokens.ts:53`) collapses an entire session to one `TokenTiers`, and `parseUsage` (`:37`) throws away `timestamp`, `sessionId`, `uuid`, and `requestId` on the way past. Against that API no temporal split is possible: the correlator (Task 10) needs to know *when* each token was spent in order to ask which unknown's interval was open at the time. This task adds the per-record view — `readSessionUsage` — and the one join key that actually exists between a transcript and a vault — `sessionCwd` — then refolds `readSessionTokens` over the new function so the whole-file total is derived from the per-record account rather than computed beside it. One account, two views; they cannot drift.

Two facts verified against live transcript data are encoded here as tests rather than comments:

1. Real `usage` objects carry an `iterations` array whose per-iteration tiers **duplicate** the top-level fields (observed: top-level `input_tokens: 2`, `output_tokens: 125`, `cache_read_input_tokens: 15152`, `cache_creation_input_tokens: 5703`, with `iterations[0]` carrying the identical four numbers). `parseUsage` reads only the top level today and MUST keep doing so — summing both double-counts every token in the ledger, and a cost model that inflates with iteration count selects for exactly the wrong variants.
2. The join key is `cwd` (top-level, equal to the vault dir) plus `sessionId` (equal to the filename stem). Real top-level keys observed: `attributionPlugin, attributionSkill, cwd, effort, entrypoint, gitBranch, isSidechain, message, parentUuid, requestId, sessionId, timestamp, type, userType, uuid, version`.

Everything degrades to zero or `undefined` rather than throwing. This reads a file no OST-Agent process wrote — untrusted input — the discipline already stated at `src/adapters/tokens.ts:14-15`. A correlator that throws would take down `ost_status`.

The existing 7 tests in `test/adapters/tokens.test.ts` are **not modified**. They are part of the genome-independent floor: this module has zero policy content, and if Phase 2 has to change them, policy has leaked downward into extraction.

**Files:**
- Modify: `src/adapters/tokens.ts` (add `SessionUsageEntry`, `readSessionUsage`, `sessionCwd`; extract a shared line reader; refold `readSessionTokens` over `readSessionUsage`; update the module JSDoc now that the correlator is its caller)
- Test: `test/adapters/tokens.test.ts` (append — the existing 7 tests unchanged)

**Interfaces:**
- Consumes: `TokenTiers`, `emptyTiers`, `addTiers` from `src/telemetry/attention.js` (already imported).
- Produces, for Task 10 (`src/eval/correlate.ts`):
  - `export interface SessionUsageEntry { ts: string; tiers: TokenTiers; uuid?: string; requestId?: string }`
  - `export function readSessionUsage(file: string): SessionUsageEntry[];`
  - `export function sessionCwd(file: string): string | undefined;`
  - `export function readSessionTokens(file: string): TokenTiers;` — signature and behaviour UNCHANGED, implementation refolded.
  - `export function parseUsage(entry: unknown): TokenTiers | null;` — unchanged.

- [ ] **Step 1: Write the failing test**

Append to `test/adapters/tokens.test.ts` (leave lines 1-60 exactly as they are):

```typescript
/**
 * A transcript line in the shape Claude Code actually writes: the top-level
 * envelope carrying `cwd`, `sessionId`, `timestamp`, `uuid` and `requestId`,
 * with the `usage` object nested under `message`. Passing `timestamp: undefined`
 * in `top` removes the key, because JSON.stringify drops undefined values.
 */
const entryLine = (usage: Record<string, unknown>, top: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: "assistant",
    cwd: "/Users/tanner/ost-agent-vault",
    sessionId: "16e91f12-961b-4ff9-9e25-c04319461cb5",
    timestamp: "2026-07-24T15:54:24.465Z",
    uuid: "a1b2c3d4-0000-4000-8000-000000000001",
    requestId: "req_011CdM9r3kkZcDDFE8X2ZoER",
    ...top,
    message: { usage },
  });

describe("readSessionUsage", () => {
  test("keeps the timestamp each usage record arrived with — a whole-file total cannot be split in time", () => {
    const file = sessionFile([
      entryLine({ input_tokens: 1, output_tokens: 10 }, { timestamp: "2026-07-24T15:54:24.465Z" }),
      entryLine({ input_tokens: 2, output_tokens: 20 }, { timestamp: "2026-07-24T15:59:01.002Z" }),
    ]);
    const entries = readSessionUsage(file);
    expect(entries.map((e) => e.ts)).toEqual([
      "2026-07-24T15:54:24.465Z",
      "2026-07-24T15:59:01.002Z",
    ]);
    expect(entries[0].tiers).toEqual({ input: 1, output: 10, cacheCreate: 0, cacheRead: 0 });
    expect(entries[1].tiers).toEqual({ input: 2, output: 20, cacheCreate: 0, cacheRead: 0 });
  });

  test("the iterations array is IGNORED — its per-iteration tiers duplicate the top level, and summing both double-counts every token", () => {
    const observed = {
      input_tokens: 2,
      output_tokens: 125,
      cache_creation_input_tokens: 5703,
      cache_read_input_tokens: 15152,
    };
    const file = sessionFile([entryLine({ ...observed, iterations: [{ ...observed }] })]);
    const entries = readSessionUsage(file);
    expect(entries).toHaveLength(1);
    expect(entries[0].tiers).toEqual({ input: 2, output: 125, cacheCreate: 5703, cacheRead: 15152 });
    expect(readSessionTokens(file)).toEqual({ input: 2, output: 125, cacheCreate: 5703, cacheRead: 15152 });
  });

  test("carries uuid and requestId when the transcript has them, and omits them rather than inventing them", () => {
    const withIds = sessionFile([entryLine({ input_tokens: 1 })]);
    expect(readSessionUsage(withIds)[0].uuid).toBe("a1b2c3d4-0000-4000-8000-000000000001");
    expect(readSessionUsage(withIds)[0].requestId).toBe("req_011CdM9r3kkZcDDFE8X2ZoER");

    const bare = sessionFile([entryLine({ input_tokens: 1 }, { uuid: undefined, requestId: undefined })]);
    expect(readSessionUsage(bare)[0].uuid).toBeUndefined();
    expect(readSessionUsage(bare)[0].requestId).toBeUndefined();
  });

  test("an undated record still counts its tokens — uncorrelatable is NOT uncounted", () => {
    const file = sessionFile([
      entryLine({ input_tokens: 7 }, { timestamp: undefined, uuid: undefined, requestId: undefined }),
    ]);
    expect(readSessionUsage(file)).toEqual([{ ts: "", tiers: { input: 7, output: 0, cacheCreate: 0, cacheRead: 0 } }]);
    expect(readSessionTokens(file).input).toBe(7);
  });

  test("usage-free and corrupt lines contribute no entry and do not end the read", () => {
    const file = sessionFile([
      "{broken",
      JSON.stringify({ type: "user", cwd: "/Users/tanner/ost-agent-vault", message: { content: "hi" } }),
      entryLine({ input_tokens: 4 }),
    ]);
    const entries = readSessionUsage(file);
    expect(entries).toHaveLength(1);
    expect(entries[0].tiers.input).toBe(4);
  });

  test("a missing file is an empty account, not a throw — this reads a file no OST-Agent process wrote", () => {
    expect(readSessionUsage("/nonexistent/session.jsonl")).toEqual([]);
  });
});

describe("sessionCwd", () => {
  test("reads the directory the session ran in — the ONLY join key between a transcript and a vault", () => {
    const file = sessionFile([
      JSON.stringify({ type: "user", cwd: "/Users/tanner/ost-agent-vault", message: { content: "hi" } }),
      entryLine({ input_tokens: 1 }),
    ]);
    expect(sessionCwd(file)).toBe("/Users/tanner/ost-agent-vault");
  });

  test("a corrupt first line does not hide the cwd on the second", () => {
    const file = sessionFile(["{broken", entryLine({ input_tokens: 1 })]);
    expect(sessionCwd(file)).toBe("/Users/tanner/ost-agent-vault");
  });

  test("a transcript that names no cwd, and a file that is not there, are both undefined rather than a throw", () => {
    const anonymous = sessionFile([entryLine({ input_tokens: 1 }, { cwd: undefined })]);
    expect(sessionCwd(anonymous)).toBeUndefined();
    expect(sessionCwd("/nonexistent/session.jsonl")).toBeUndefined();
  });
});

describe("readSessionTokens — folded over readSessionUsage", () => {
  test("the whole-file total equals the sum of the per-record tiers — one account, two views, unable to drift", () => {
    const file = sessionFile([
      entryLine({ input_tokens: 1, output_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 }),
      entryLine({ input_tokens: 2, output_tokens: 20, cache_creation_input_tokens: 200, cache_read_input_tokens: 2000 }),
    ]);
    const folded = readSessionUsage(file).reduce(
      (acc, e) => ({
        input: acc.input + e.tiers.input,
        output: acc.output + e.tiers.output,
        cacheCreate: acc.cacheCreate + e.tiers.cacheCreate,
        cacheRead: acc.cacheRead + e.tiers.cacheRead,
      }),
      { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
    );
    expect(readSessionTokens(file)).toEqual(folded);
    expect(folded).toEqual({ input: 3, output: 30, cacheCreate: 300, cacheRead: 3000 });
  });
});
```

Change the import on line 5 to pull in the two new functions (this is the only edit above line 61):

```typescript
import { parseUsage, readSessionTokens, readSessionUsage, sessionCwd } from "../../src/adapters/tokens.js";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/adapters/tokens.test.ts`
Expected: FAIL — `SyntaxError: The requested module '../../src/adapters/tokens.js' does not provide an export named 'readSessionUsage'`, which fails the whole file including the 7 existing tests.

- [ ] **Step 3: Write the implementation**

Replace the whole of `src/adapters/tokens.ts` with:

```typescript
/**
 * Token cost, read from the only place it exists.
 *
 * Since the API-key runner was deleted, OST-Agent never calls the model —
 * Claude Code does — so the tool tracer cannot see token spend at all. It is
 * carried instead in Claude Code's session JSONL, one `usage` object per
 * assistant message.
 *
 * The four tiers are lifted SEPARATELY and never summed here. Cached reads are
 * priced roughly an order of magnitude below fresh input; a single number
 * would track conversation length rather than attention, and the cost model
 * belongs at read time where it can be varied (see eval/attention.ts).
 *
 * Every parse failure degrades to zero rather than to NaN or a throw: this
 * reads a file no OST-Agent process wrote, so it is untrusted input. A
 * correlator that threw on a malformed transcript would take down `ost_status`.
 *
 * Two views of the same account. `readSessionUsage` is the per-record view:
 * every usage object with the timestamp it arrived at, so a session's spend can
 * be cut against the intervals during which a given unknown was being worked.
 * `readSessionTokens` is the whole-file total, and is a FOLD over the per-record
 * view rather than a second traversal — derived, so the two can never disagree.
 *
 * `iterations` is deliberately not read. Real `usage` objects carry an
 * `iterations` array whose per-iteration tiers duplicate the top-level fields
 * exactly (observed live: top-level input 2 / output 125 / cache_creation 5703 /
 * cache_read 15152, with `iterations[0]` carrying the identical four numbers).
 * Summing both would double-count every token, and since fitness is cost, an
 * inflated cost model selects against whatever iterates — the opposite of what
 * the ledger is for.
 *
 * `cwd` is the join key. A transcript names the directory its session ran in,
 * and for a maintenance pass that directory is the vault; the filename stem is
 * the `sessionId`. Nothing else links a Claude Code session to an OST tree —
 * `OST_SESSION` has no writer anywhere in the repo — so `sessionCwd` is what
 * makes self-correlation possible at all (see eval/correlate.ts).
 */
import fs from "node:fs";
import { addTiers, emptyTiers, type TokenTiers } from "../telemetry/attention.js";

/** One assistant message's token cost, with the metadata needed to place it in time. */
export interface SessionUsageEntry {
  /** ISO timestamp the record was written with, or "" when the transcript carried none. */
  ts: string;
  /** The four tiers, unmixed. */
  tiers: TokenTiers;
  /** Claude Code's per-entry id, when present. */
  uuid?: string;
  /** The API request id, when present — a second dedupe handle. */
  requestId?: string;
}

/** A non-negative finite number, or 0. Never NaN. */
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** A non-empty string, or undefined. An absent field and a blank one are the same claim: nothing. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Every JSON-object line of a transcript, in file order. Corrupt lines are
 * skipped rather than fatal, and an unreadable file yields nothing at all —
 * one bad line must not cost the rest of the session.
 */
function* readEntries(file: string): Generator<Record<string, unknown>> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (entry && typeof entry === "object") yield entry as Record<string, unknown>;
  }
}

/**
 * Lift one transcript entry's token usage, or null when it carries none.
 *
 * Reads the TOP LEVEL of `usage` only. See the module note on `iterations`.
 */
export function parseUsage(entry: unknown): TokenTiers | null {
  if (!entry || typeof entry !== "object") return null;
  const message = (entry as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const usage = (message as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  return {
    input: count(u.input_tokens),
    output: count(u.output_tokens),
    cacheCreate: count(u.cache_creation_input_tokens),
    cacheRead: count(u.cache_read_input_tokens),
  };
}

/**
 * Every usage record in a session transcript, in file order, each with the time
 * it arrived. An entry missing its timestamp keeps `ts: ""` and its tokens: it
 * cannot be placed in an interval, but uncorrelatable is not uncounted — it
 * belongs to the residual, which the correlator reports rather than hides.
 */
export function readSessionUsage(file: string): SessionUsageEntry[] {
  const entries: SessionUsageEntry[] = [];
  for (const entry of readEntries(file)) {
    const tiers = parseUsage(entry);
    if (!tiers) continue;
    const uuid = text(entry.uuid);
    const requestId = text(entry.requestId);
    entries.push({
      ts: text(entry.timestamp) ?? "",
      tiers,
      ...(uuid ? { uuid } : {}),
      ...(requestId ? { requestId } : {}),
    });
  }
  return entries;
}

/**
 * The directory a session ran in, taken from the first entry that names one.
 * Undefined when the file is missing, unreadable, or names no `cwd` — a
 * transcript that will not say where it ran cannot be joined to a vault, and
 * saying so is the correct answer.
 */
export function sessionCwd(file: string): string | undefined {
  for (const entry of readEntries(file)) {
    const cwd = text(entry.cwd);
    if (cwd) return cwd;
  }
  return undefined;
}

/** Total token cost of one session transcript, tiers kept separate. */
export function readSessionTokens(file: string): TokenTiers {
  let total = emptyTiers();
  for (const { tiers } of readSessionUsage(file)) total = addTiers(total, tiers);
  return total;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/adapters/tokens.test.ts && npm run build`
Expected: PASS — `test/adapters/tokens.test.ts` grows by 10 tests (the original 7 unchanged); nothing previously green goes red, and a clean `tsc`.

Then run the full suite to confirm nothing else moved — this module has exactly one importer today (`test/adapters/tokens.test.ts`), so the blast radius is zero:

Run: `npm test`
Expected: PASS — every previously passing test still passes, plus the 10 added here.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/tokens.ts test/adapters/tokens.test.ts
git commit -m "feat(adapters): tokens learn when they were spent, and where"
```

---

### Task 10: G7b — the correlator

The genuinely new code of Phase 2. Nothing today connects a Claude Code session's token spend to the unknown it was spent on, because the two traces live in different files written by different processes: `withUsageTracing` appends `{ts, ms, unknown}` to the vault's usage log (`src/telemetry/usage.ts:88`), and Claude Code appends `{timestamp, cwd, message.usage}` to `~/.claude/projects/<slug>/<sessionId>.jsonl`. The only join available is **time**, and it is a lossy one. This task builds that join honestly: it attributes what falls inside a call's window, and it refuses to guess about the rest.

**Files:**
- Create: `src/eval/correlate.ts`
- Test: `test/eval/correlate.test.ts`

**Interfaces:**
- Consumes: `readSessionUsage(file: string): SessionUsageEntry[]` and `sessionCwd(file: string): string | undefined` from `src/adapters/tokens.ts` (Task 9); `defaultTranscriptDir(projectDir: string): string` from `src/adapters/transcript.ts`; `loadCursor(vaultDir, name)` / `saveCursor(vaultDir, name, cursor)` from `src/adapters/source.ts`; `usageLogPath(vaultDir)` from `src/telemetry/usage.ts`; `readAttention` / `addTiers` / `emptyTiers` / `TokenTiers` from `src/telemetry/attention.ts`; `Genome` from `src/genome/schema.ts` (Task 1, type-only); `defaultGenome()` from `src/genome/load.ts` (tests only).
- Produces:
  ```ts
  export interface CorrelationResult {
    byUnknown: Map<string, TokenTiers>;
    residual: TokenTiers;
    sessions: string[];
    costBasis: "tokens" | "calls-and-ms";
  }
  export function correlateTokens(vaultDir: string, tree: readonly OstNode[], genome: Genome): CorrelationResult;
  export function transcriptDirFor(vaultDir: string, genome: Genome): string;
  export function markCorrelated(vaultDir: string, sessions: readonly string[]): void;
  export const CORRELATOR_CURSOR = "token-correlator";
  ```
  Task 11 feeds `CorrelationResult.byUnknown` into `computeAttention` as `AttentionOptions.correlated`, and `CorrelationResult.residual` into `AttentionRollup.unattributed.tokens`.

**Design notes an implementer must not lose:**

1. **The transcript dir derives from the VAULT, never from `config.adapters.transcript.projectDir`.** That option is documented as "Repo whose sessions to harvest" (`src/config/schema.ts:41`), points at the *product* repo, and is `enabled: false` by default. Self-correlation wants the sessions that ran *in the vault*. Reuse `defaultTranscriptDir` (`src/adapters/transcript.ts:30`) and pass it `vaultDir` — the slug is lossy character substitution (`replace(/[^A-Za-z0-9]/g, "-")`), not a hash, so this is a pure path computation with no lookup table.
2. **`ts` is the START time, and the file is in FINISH order.** `src/telemetry/usage.ts:79` takes `started = Date.now()`, `:89` writes `ts: new Date(started).toISOString()` and `ms: Date.now() - started`, and the append at `:88` happens *after* `await tool.run`. So the log is ordered by finish while its timestamps are starts. Sort; never assume file order. The interval for one call is `[ts, ts + ms)`.
3. **Never reuse `TranscriptSource.fetchSince`'s cursor** (`src/adapters/transcript.ts:251-286`). It is a seen-id set, not a watermark, and `seen.add(id)` at `:270` fires *before* the zero-friction skip at `:272` — sharing it would silently drop exactly the sessions with the most tokens and the least friction. This module keeps its own cursor under `.ost-agent/state/token-correlator.json`.
4. **The quiet gate is not a bug to fix.** `transcript.ts:255` treats a session as finished only after 30 minutes of silence, and this module keeps that discipline so a still-writing transcript is never consumed half-read. The consequence is structural: **the pass that spends the tokens can never see its own cost.** Token attribution is retroactive by construction.
5. **The residual is large, and that is the signal, not a defect.** Tool-call windows cover execution slivers only; the majority of a session's tokens are spent between them — thinking, reading, the assistant turn that emits the call. `residual: unattributed` is the honest v1 default and is precisely what feeds the design's required unattributed-share metric.
6. **Fail-open, everywhere.** A missing dir, an unreadable file, a malformed usage object, a corrupt log line: all degrade to an empty or partial result. A correlator that throws would take down `ost_status`.

- [ ] **Step 1: Write the failing test**

Create `test/eval/correlate.test.ts`:

```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { defaultTranscriptDir } from "../../src/adapters/transcript.js";
import { correlateTokens, markCorrelated, transcriptDirFor } from "../../src/eval/correlate.js";
import { defaultGenome } from "../../src/genome/load.js";
import type { Genome } from "../../src/genome/schema.js";
import type { OstNode } from "../../src/ost/node.js";
import { recordAttention } from "../../src/telemetry/attention.js";
import { usageLogPath } from "../../src/telemetry/usage.js";

const FULL = "## Format\na count\n\n## Methodology\nquery\n\n## Rationale\nserves [[O]]";

const unknown = (title: string): OstNode => ({
  title, layer: "Unknown", tags: [], links: [], body: FULL, evidence: "assertion",
});

/** Every fixture tree carries the same three unknowns; the split decides who gets what. */
const TREE: OstNode[] = [unknown("A"), unknown("B"), unknown("U")];

const ZERO = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };

/** A fixed epoch so every window and every transcript stamp is exact, never wall-clock. */
const T0 = Date.parse("2026-07-27T12:00:00.000Z");
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** One usage-log event, shaped exactly as `withUsageTracing` writes it. */
const call = (title: string | undefined, startMs: number, ms: number) => ({
  ts: at(startMs), tool: "ost_read_tree", ok: true, ms, surface: "mcp", argBytes: 0,
  ...(title ? { unknown: title } : {}),
});

function writeUsage(vault: string, events: Record<string, unknown>[]): void {
  const file = usageLogPath(vault);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
}

/** Raw JSONL, backdated past the 30-minute quiet gate so the session reads as finished. */
function writeRaw(tdir: string, id: string, lines: string[]): string {
  const file = path.join(tdir, `${id}.jsonl`);
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  const past = Date.now() / 1000 - 3600;
  fs.utimesSync(file, past, past);
  return file;
}

function writeSession(
  tdir: string, id: string, cwd: string,
  entries: { ts: string; usage: Record<string, number> }[],
): string {
  return writeRaw(tdir, id, entries.map((e, i) => JSON.stringify({
    type: "assistant", sessionId: id, cwd, uuid: `${id}-${i}`, requestId: `req_${i}`,
    timestamp: e.ts, message: { usage: { ...e.usage, server_tool_use: { web_search_requests: 0 } } },
  })));
}

/** A vault, its usage log, and one finished session transcript whose cwd IS the vault. */
function fixture(
  events: Record<string, unknown>[],
  entries: { ts: string; usage: Record<string, number> }[],
  id = "sess-1",
): { vault: string; tdir: string } {
  const vault = tmp("ost-correlate-");
  const tdir = tmp("ost-transcripts-");
  writeUsage(vault, events);
  writeSession(tdir, id, vault, entries);
  return { vault, tdir };
}

function genomeWith(over: Partial<Genome["tokenSplit"]>): Genome {
  const g = defaultGenome();
  return { ...g, tokenSplit: { ...g.tokenSplit, ...over } };
}

const run = (vault: string, tdir: string, over: Partial<Genome["tokenSplit"]> = {}) =>
  correlateTokens(vault, TREE, genomeWith({ enabled: true, transcriptDir: tdir, ...over }));

describe("correlateTokens — the default genome", () => {
  test("the default genome correlates nothing — and the SAME fixture with enabled:true does, so the emptiness is the gene and not the fixture", () => {
    const { vault, tdir } = fixture([call("U", 0, 1000)], [{ ts: at(500), usage: { input_tokens: 100 } }]);

    const off = correlateTokens(vault, TREE, genomeWith({ transcriptDir: tdir }));
    expect(off.byUnknown.size).toBe(0);
    expect(off.residual).toEqual(ZERO);
    expect(off.sessions).toEqual([]);
    expect(off.costBasis).toBe("tokens");

    expect(run(vault, tdir).byUnknown.get("U")?.input).toBe(100);
  });
});

describe("transcriptDirFor", () => {
  test("derives from the VAULT dir, NEVER from the product repo the transcript adapter harvests", () => {
    const vault = tmp("ost-correlate-");
    expect(transcriptDirFor(vault, genomeWith({}))).toBe(defaultTranscriptDir(vault));
    expect(transcriptDirFor(vault, genomeWith({}))).not.toBe(defaultTranscriptDir("/some/product/repo"));
  });

  test("an explicit transcriptDir wins over the derived one", () => {
    const vault = tmp("ost-correlate-");
    expect(transcriptDirFor(vault, genomeWith({ transcriptDir: "/tmp/elsewhere" })))
      .toBe(path.resolve("/tmp/elsewhere"));
  });
});

describe("correlateTokens — apportioning", () => {
  test("a transcript entry inside a call's window is attributed to the unknown that call named", () => {
    const { vault, tdir } = fixture(
      [call("U", 0, 1000)],
      [{ ts: at(500), usage: { input_tokens: 100, output_tokens: 10 } }],
    );
    const res = run(vault, tdir);
    expect(res.byUnknown.get("U")).toEqual({ input: 100, output: 10, cacheCreate: 0, cacheRead: 0 });
    expect(res.residual).toEqual(ZERO);
    expect(res.sessions).toEqual(["sess-1"]);
  });

  test("tokens spent between calls stay residual — most of a session is thinking, and the split does NOT invent an owner for it", () => {
    const { vault, tdir } = fixture([call("U", 0, 100)], [
      { ts: at(50), usage: { input_tokens: 100 } },
      { ts: at(2000), usage: { input_tokens: 200 } },
      { ts: at(4000), usage: { input_tokens: 200 } },
    ]);
    const res = run(vault, tdir);
    expect(res.byUnknown.get("U")?.input).toBe(100);
    expect(res.residual.input).toBe(400);
    expect(res.residual.input).toBeGreaterThan(res.byUnknown.get("U")!.input);
  });

  test("two windows covering the same instant split it by calls", () => {
    const { vault, tdir } = fixture(
      [call("A", 0, 1000), call("B", 0, 1000)],
      [{ ts: at(500), usage: { input_tokens: 100 } }],
    );
    const res = run(vault, tdir);
    expect(res.byUnknown.get("A")?.input).toBe(50);
    expect(res.byUnknown.get("B")?.input).toBe(50);
    expect(res.residual).toEqual(ZERO);
  });

  test("proportional-by-ms weights the longer window heavier", () => {
    const { vault, tdir } = fixture(
      [call("A", 0, 300), call("B", 0, 100)],
      [{ ts: at(50), usage: { input_tokens: 400 } }],
    );
    const res = run(vault, tdir, { method: "proportional-by-ms" });
    expect(res.byUnknown.get("A")?.input).toBe(300);
    expect(res.byUnknown.get("B")?.input).toBe(100);
  });

  test("winner-take-all gives the whole entry to the innermost window", () => {
    const { vault, tdir } = fixture(
      [call("A", 0, 1000), call("B", 400, 200)],
      [{ ts: at(500), usage: { input_tokens: 100 } }],
    );
    const res = run(vault, tdir, { method: "winner-take-all" });
    expect(res.byUnknown.get("B")?.input).toBe(100);
    expect(res.byUnknown.get("A")).toBeUndefined();
  });

  test("method: none attributes nothing — every token is residual", () => {
    const { vault, tdir } = fixture(
      [call("U", 0, 1000)],
      [{ ts: at(500), usage: { input_tokens: 100 } }],
    );
    const res = run(vault, tdir, { method: "none", residual: "proportional" });
    expect(res.byUnknown.size).toBe(0);
    expect(res.residual.input).toBe(100);
  });

  test("residual: proportional spreads the leftover on the same basis the method used", () => {
    const { vault, tdir } = fixture(
      [call("A", 0, 10), call("A", 20, 10), call("A", 40, 10), call("B", 60, 10)],
      [{ ts: at(5000), usage: { input_tokens: 400 } }],
    );
    const res = run(vault, tdir, { residual: "proportional" });
    expect(res.byUnknown.get("A")?.input).toBe(300);
    expect(res.byUnknown.get("B")?.input).toBe(100);
    expect(res.residual).toEqual(ZERO);
  });

  test("residual: nearest-preceding credits the unknown last worked on, and credits nothing at all before the first call", () => {
    const { vault, tdir } = fixture([call("A", 0, 100)], [
      { ts: at(500), usage: { input_tokens: 100 } },
      { ts: at(-500), usage: { input_tokens: 40 } },
    ]);
    const res = run(vault, tdir, { residual: "nearest-preceding" });
    expect(res.byUnknown.get("A")?.input).toBe(100);
    expect(res.residual.input).toBe(40);
  });

  test("attribution does NOT depend on the usage log's file order — the log is appended in FINISH order while ts is START time", () => {
    const entries = [{ ts: at(105), usage: { input_tokens: 100 } }];
    const finishOrder = fixture([call("B", 100, 10), call("A", 0, 1000)], entries, "sess-f");
    const startOrder = fixture([call("A", 0, 1000), call("B", 100, 10)], entries, "sess-s");

    const a = run(finishOrder.vault, finishOrder.tdir, { method: "winner-take-all" });
    const b = run(startOrder.vault, startOrder.tdir, { method: "winner-take-all" });
    expect([...a.byUnknown.entries()]).toEqual([...b.byUnknown.entries()]);
    expect(a.byUnknown.get("B")?.input).toBe(100);
  });
});

describe("correlateTokens — idempotency and fail-open", () => {
  test("a session already named in the ledger is skipped — an append-only ledger would double-count it", () => {
    const { vault, tdir } = fixture([call("U", 0, 1000)], [{ ts: at(500), usage: { input_tokens: 100 } }]);
    recordAttention(vault, {
      ts: at(1000), unknown: "U", kind: "spend", session: "sess-1",
      tokens: { input: 100, output: 0, cacheCreate: 0, cacheRead: 0 },
    });
    const res = run(vault, tdir);
    expect(res.sessions).toEqual([]);
    expect(res.byUnknown.size).toBe(0);
  });

  test("markCorrelated makes the next run skip exactly what this one consumed", () => {
    const { vault, tdir } = fixture([call("U", 0, 1000)], [{ ts: at(500), usage: { input_tokens: 100 } }]);
    const first = run(vault, tdir);
    expect(first.sessions).toEqual(["sess-1"]);
    markCorrelated(vault, first.sessions);
    expect(run(vault, tdir).sessions).toEqual([]);
  });

  test("a session whose cwd is not the vault belongs to another project and is NOT read", () => {
    const vault = tmp("ost-correlate-");
    const tdir = tmp("ost-transcripts-");
    writeUsage(vault, [call("U", 0, 1000)]);
    writeSession(tdir, "foreign", "/some/other/project", [{ ts: at(500), usage: { input_tokens: 100 } }]);
    const res = run(vault, tdir);
    expect(res.sessions).toEqual([]);
    expect(res.byUnknown.size).toBe(0);
  });

  test("a live session is invisible while it spends — token attribution is retroactive by construction", () => {
    const { vault, tdir } = fixture([call("U", 0, 1000)], [{ ts: at(500), usage: { input_tokens: 100 } }]);
    const now = Date.now() / 1000;
    fs.utimesSync(path.join(tdir, "sess-1.jsonl"), now, now);
    expect(run(vault, tdir).sessions).toEqual([]);
  });

  test("a missing transcript directory is an empty correlation, never a throw — a correlator that throws takes ost_status down", () => {
    const vault = tmp("ost-correlate-");
    writeUsage(vault, [call("U", 0, 1000)]);
    const res = run(vault, path.join(vault, "no-such-transcripts"));
    expect(res.byUnknown.size).toBe(0);
    expect(res.residual).toEqual(ZERO);
    expect(res.costBasis).toBe("tokens");
  });

  test("a corrupt session file costs its own tokens, not the correlation", () => {
    const vault = tmp("ost-correlate-");
    const tdir = tmp("ost-transcripts-");
    writeUsage(vault, [call("U", 0, 1000)]);
    writeRaw(tdir, "sess-1", [
      JSON.stringify({ type: "user", sessionId: "sess-1", cwd: vault, timestamp: at(0), message: { content: "hi" } }),
      "{broken",
      JSON.stringify({
        type: "assistant", sessionId: "sess-1", cwd: vault, timestamp: at(500),
        message: { usage: { input_tokens: 100 } },
      }),
    ]);
    expect(run(vault, tdir).byUnknown.get("U")?.input).toBe(100);
  });

  test("the cost basis rides on every result, so a comparison that mixes bases can be refused rather than normalized", () => {
    const { vault, tdir } = fixture([call("U", 0, 1000)], [{ ts: at(500), usage: { input_tokens: 100 } }]);
    expect(run(vault, tdir, { costBasis: "calls-and-ms" }).costBasis).toBe("calls-and-ms");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/eval/correlate.test.ts`
Expected: FAIL — `Error: Failed to load url ../../src/eval/correlate.js (resolved id: .../src/eval/correlate.js). Does the file exist?`

- [ ] **Step 3: Write the implementation**

Create `src/eval/correlate.ts`:

```typescript
/**
 * Token correlation — dividing one session's spend across the unknowns it touched.
 *
 * Since the API-key runner was deleted, OST-Agent never calls the model; Claude
 * Code does. So the two traces that matter are written by two different
 * processes into two different files, and nothing links them. The usage log says
 * WHICH unknown a tool call was spent on and exactly when (`ts` start, `ms`
 * duration). The session transcript says HOW MANY tokens were spent and exactly
 * when. The only join available is the clock, and this module is that join.
 *
 * The honest part is what it refuses to do. A tool call's window covers the
 * sliver in which the tool executed; the great majority of a session's tokens
 * are spent BETWEEN those windows — thinking, reading, and the assistant turn
 * that emits the call itself. Interval overlap therefore leaves a majority
 * residual, and `residual: unattributed` keeps it visible instead of smearing
 * it over whichever unknown happened to be nearby. That number is not noise to
 * be tuned away: unattributed share is a reported fitness metric, and a variant
 * that cannot say what it spent attention on is measurably worse. How the
 * residual is treated is an allele (`tokenSplit.residual`), so a harness can
 * measure whether smearing it beats admitting it — but the default admits it.
 *
 * Two timing facts govern the read. First, the usage log is appended AFTER the
 * call returns while `ts` records when it started, so the file is in finish
 * order and its timestamps are starts; nothing here may assume file order.
 * Second, a transcript is only consumed once it has been quiet for half an
 * hour, exactly as the friction adapter requires, so a still-writing session is
 * never half-read. The consequence is structural and not a defect to fix: the
 * pass that spends the tokens can never see its own cost. Attribution is
 * retroactive by construction.
 *
 * The cursor is this module's own, under `.ost-agent/state/`. It deliberately
 * does not share `TranscriptSource`'s, whose seen-id set is marked BEFORE its
 * zero-friction skip — sharing it would silently lose exactly the sessions with
 * the most tokens and the least friction. Consumption is also checked against
 * the attention ledger itself, because that ledger is append-only and a second
 * run over the same transcript would otherwise double-count.
 *
 * Everything here is fail-open, like every other reader of a file no OST-Agent
 * process wrote: a missing directory, an unreadable transcript or a malformed
 * usage object degrades to an empty result. This runs inside `ost_status`; a
 * correlator that throws takes the status tool down with it.
 */
import fs from "node:fs";
import path from "node:path";
import { loadCursor, saveCursor } from "../adapters/source.js";
import { readSessionUsage, sessionCwd } from "../adapters/tokens.js";
import { defaultTranscriptDir } from "../adapters/transcript.js";
import type { Genome } from "../genome/schema.js";
import type { OstNode } from "../ost/node.js";
import { addTiers, emptyTiers, readAttention, type TokenTiers } from "../telemetry/attention.js";
import { usageLogPath } from "../telemetry/usage.js";

/** This module's own cursor name under `.ost-agent/state/` — never the transcript adapter's. */
export const CORRELATOR_CURSOR = "token-correlator";

/**
 * A session counts as finished only after this long untouched, matching the
 * transcript adapter's default. Consuming a live session would read half its
 * tokens and then mark it done.
 */
const QUIET_MINUTES = 30;

type SplitMethod = Genome["tokenSplit"]["method"];

export interface CorrelationResult {
  /** Tokens apportioned per unknown title. Fractional by design — the split conserves totals. */
  byUnknown: Map<string, TokenTiers>;
  /** Everything the windows could not claim. Large, and meant to be. */
  residual: TokenTiers;
  /** Session ids consumed by this run, ready for {@link markCorrelated}. */
  sessions: string[];
  /** Recorded on the result so a comparison mixing bases can be refused, not normalized. */
  costBasis: "tokens" | "calls-and-ms";
}

/** One tool call's execution window: `[start, end)`, derived from `ts` and `ms`. */
interface Interval {
  title: string;
  start: number;
  end: number;
}

/**
 * Where this vault's own sessions live. Derived from the VAULT dir, never from
 * `config.adapters.transcript.projectDir` — that names the product repo whose
 * sessions are harvested as friction evidence, which is a different question.
 */
export function transcriptDirFor(vaultDir: string, genome: Genome): string {
  const configured = genome.tokenSplit.transcriptDir.trim();
  return configured ? path.resolve(configured) : defaultTranscriptDir(vaultDir);
}

function emptyResult(costBasis: CorrelationResult["costBasis"]): CorrelationResult {
  return { byUnknown: new Map(), residual: emptyTiers(), sessions: [], costBasis };
}

function isZero(t: TokenTiers): boolean {
  return t.input === 0 && t.output === 0 && t.cacheCreate === 0 && t.cacheRead === 0;
}

function share(tiers: TokenTiers, fraction: number): TokenTiers {
  return {
    input: tiers.input * fraction,
    output: tiers.output * fraction,
    cacheCreate: tiers.cacheCreate * fraction,
    cacheRead: tiers.cacheRead * fraction,
  };
}

function credit(byUnknown: Map<string, TokenTiers>, title: string, tiers: TokenTiers): void {
  byUnknown.set(title, addTiers(byUnknown.get(title) ?? emptyTiers(), tiers));
}

/**
 * One pass over the usage trace, yielding a window per attributed call.
 *
 * Events naming a title that is not on the tree are dropped rather than folded
 * into the residual, matching the rollup's treatment of stale attribution: a
 * window belonging to nothing cannot claim tokens for anything.
 */
function readIntervals(vaultDir: string, knownTitles: ReadonlySet<string>): Interval[] {
  const out: Interval[] = [];
  let raw: string;
  try {
    raw = fs.readFileSync(usageLogPath(vaultDir), "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as { ts?: string; ms?: number; unknown?: string };
      if (!event.unknown || !knownTitles.has(event.unknown)) continue;
      const start = typeof event.ts === "string" ? Date.parse(event.ts) : Number.NaN;
      if (!Number.isFinite(start)) continue;
      const ms = typeof event.ms === "number" && Number.isFinite(event.ms) && event.ms > 0 ? event.ms : 0;
      out.push({ title: event.unknown, start, end: start + ms });
    } catch {
      // a corrupt trace line buys no window
    }
  }
  // The log is appended after the call returns, so it arrives in FINISH order
  // while `ts` is START time. Sort by start; never trust the file's order.
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

/** Under `proportional-by-ms` a window's weight is its duration; otherwise it is one call. */
function intervalWeight(iv: Interval, method: SplitMethod): number {
  return method === "proportional-by-ms" ? Math.max(iv.end - iv.start, 0) : 1;
}

function overlapping(intervals: readonly Interval[], t: number): Interval[] {
  return intervals.filter((iv) => iv.start <= t && t < iv.end);
}

/** The most recently opened of several covering windows — the innermost work. */
function innermost(hit: readonly Interval[]): Interval {
  return hit.reduce((best, iv) =>
    iv.start > best.start ||
    (iv.start === best.start && (iv.end < best.end || (iv.end === best.end && iv.title < best.title)))
      ? iv
      : best,
  );
}

/** The window that finished most recently before `t`, if any. */
function nearestPreceding(intervals: readonly Interval[], t: number): Interval | undefined {
  let best: Interval | undefined;
  for (const iv of intervals) {
    if (iv.end > t) continue;
    if (!best || iv.end > best.end || (iv.end === best.end && iv.title < best.title)) best = iv;
  }
  return best;
}

function cursorSessions(vaultDir: string): string[] {
  try {
    const raw = loadCursor(vaultDir, CORRELATOR_CURSOR);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Sessions already written into the attention ledger, which is append-only. */
function ledgerSessions(vaultDir: string, titles: readonly string[]): string[] {
  const seen: string[] = [];
  for (const title of titles) {
    for (const entry of readAttention(vaultDir, title)) {
      if (entry.kind === "spend" && entry.session) seen.push(entry.session);
    }
  }
  return seen;
}

/**
 * Record that these sessions have been consumed. `correlateTokens` never writes
 * — `eval/` stays read-only — so whoever persists a correlation calls this, and
 * the next run skips what this one already accounted for.
 */
export function markCorrelated(vaultDir: string, sessions: readonly string[]): void {
  try {
    const merged = new Set([...cursorSessions(vaultDir), ...sessions]);
    saveCursor(vaultDir, CORRELATOR_CURSOR, JSON.stringify([...merged].sort()));
  } catch {
    // fail-open: a lost cursor costs a re-read, never a crash
  }
}

/** Finished, vault-owned, not-yet-consumed session transcripts, in a stable order. */
function sessionFiles(dir: string, vaultDir: string, skip: ReadonlySet<string>): { id: string; file: string }[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const quietBefore = Date.now() - QUIET_MINUTES * 60_000;
  const vault = path.resolve(vaultDir);
  const out: { id: string; file: string }[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
    // Claude Code names each transcript for its sessionId, so the stem IS the id.
    const id = e.name.replace(/\.jsonl$/, "");
    if (skip.has(id)) continue;
    const file = path.join(dir, e.name);
    try {
      if (fs.statSync(file).mtimeMs > quietBefore) continue; // still spending; invisible until quiet
    } catch {
      continue;
    }
    const cwd = sessionCwd(file);
    if (!cwd || path.resolve(cwd) !== vault) continue; // another project's session
    out.push({ id, file });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Divide the tokens of every finished, vault-owned session across the unknowns
 * whose tool-call windows contain them. Never throws; never writes.
 */
export function correlateTokens(
  vaultDir: string,
  tree: readonly OstNode[],
  genome: Genome,
): CorrelationResult {
  const split = genome.tokenSplit;
  if (!split.enabled) return emptyResult(split.costBasis);

  try {
    const titles = tree.filter((n) => n.layer === "Unknown").map((n) => n.title);
    const skip = new Set([...cursorSessions(vaultDir), ...ledgerSessions(vaultDir, titles)]);
    const files = sessionFiles(transcriptDirFor(vaultDir, genome), vaultDir, skip);
    if (files.length === 0) return emptyResult(split.costBasis);

    const intervals = readIntervals(vaultDir, new Set(titles));
    const titleWeight = new Map<string, number>();
    let totalWeight = 0;
    for (const iv of intervals) {
      const w = intervalWeight(iv, split.method);
      titleWeight.set(iv.title, (titleWeight.get(iv.title) ?? 0) + w);
      totalWeight += w;
    }

    const byUnknown = new Map<string, TokenTiers>();
    const sessions: string[] = [];
    let leftover = emptyTiers();

    for (const s of files) {
      sessions.push(s.id);
      for (const entry of readSessionUsage(s.file)) {
        const t = Date.parse(entry.ts);
        const hit = split.method === "none" || !Number.isFinite(t) ? [] : overlapping(intervals, t);

        if (hit.length === 0) {
          if (split.method !== "none" && split.residual === "nearest-preceding" && Number.isFinite(t)) {
            const prev = nearestPreceding(intervals, t);
            if (prev) {
              credit(byUnknown, prev.title, entry.tiers);
              continue;
            }
          }
          leftover = addTiers(leftover, entry.tiers);
          continue;
        }

        if (split.method === "winner-take-all") {
          credit(byUnknown, innermost(hit).title, entry.tiers);
          continue;
        }

        const weights = new Map<string, number>();
        let sum = 0;
        for (const iv of hit) {
          const w = intervalWeight(iv, split.method);
          weights.set(iv.title, (weights.get(iv.title) ?? 0) + w);
          sum += w;
        }
        if (sum <= 0) {
          leftover = addTiers(leftover, entry.tiers);
          continue;
        }
        for (const [title, w] of weights) credit(byUnknown, title, share(entry.tiers, w / sum));
      }
    }

    // The residual is spread on exactly the basis the method used, or — the
    // default — left standing, which is the number the design asks to report.
    // `method: none` means "attribute nothing", and no residual policy may
    // override that: the windows still exist and still carry weight, so without
    // this guard `proportional` would hand every token straight back to the
    // unknowns the method just declined to credit.
    let residual = leftover;
    if (split.method !== "none" && split.residual === "proportional" && totalWeight > 0 && !isZero(leftover)) {
      for (const [title, w] of titleWeight) credit(byUnknown, title, share(leftover, w / totalWeight));
      residual = emptyTiers();
    }

    return { byUnknown, residual, sessions, costBasis: split.costBasis };
  } catch {
    // fail-open by contract: this runs inside ost_status
    return emptyResult(split.costBasis);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/eval/correlate.test.ts`
Expected: PASS — 19 tests.

Then confirm nothing else moved: `npm test` and `npm run build`.
Expected: PASS — the suite grows by one file and 19 tests over the Phase 2 baseline; `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add src/eval/correlate.ts test/eval/correlate.test.ts
git commit -m "feat(eval): split a session's tokens across the unknowns it touched"
```

---

### Task 11: G7c — correlated tokens reach the rollup

The correlator (Task 10) produces per-unknown token tiers; nothing reads them yet. This task opens the rollup to them as a **third additive source**, and — more importantly — makes the rollup say what its numbers rest on. Today `AttentionRollup` has three buckets (attributed / unattributed / silently dropped) and no token dimension outside the ledger. It gains a fourth bucket the call-based split cannot have: transcript spend in windows where **no OST tool ran at all**. That is not "a call with no `OST_UNKNOWN`" — it is the majority of a session's tokens (thinking, reading, the assistant turn that emits the call), and conflating it with unmarked calls would inflate the unattributed-share metric the design requires (line 135) with spend no tool call ever bracketed.

Under the default genome `tokenSplit.enabled` is `false`, so no caller supplies `correlated`, every token stays `{0,0,0,0}`, `weightedCost` stays 0, and `costBasis` reads `calls-and-ms` — the regression contract, with a label attached.

**Files:**
- Modify: `src/eval/attention.ts` (`CallCost` grows `tokens`; the trace parse widens into an exported `TracedCall`; `AttentionOptions` gains `correlated`/`residual`/`costBasis`; `AttentionRollup` gains `uncorrelated` and `costBasis`, and `unattributed` grows `tokens`; correlated tokens merge into the per-unknown buckets at the injection point)
- Test: `test/eval/attention.test.ts` (append one `describe`; extend two existing exact-shape assertions)

**Interfaces:**
- Consumes:
  - `computeAttention(tree: readonly OstNode[], vaultDir: string, opts?: AttentionOptions): AttentionRollup` and `AttentionOptions { weights?; classifier?; resolution?; attribution? }` as Task 3 left them.
  - `AttributionGene { staleAttribution: "drop" | "unattributed" }` from `src/genome/schema.js` (Task 1).
  - `TokenTiers`, `emptyTiers`, `addTiers`, `readAttention` from `src/telemetry/attention.js`.
  - `CorrelationResult { byUnknown: Map<string, TokenTiers>; residual: TokenTiers; sessions: string[]; costBasis }` from `src/eval/correlate.js` (Task 10) — the shape a caller destructures into the three new options.
- Produces:
  - `AttentionOptions` additionally carrying `correlated?: Map<string, TokenTiers>`, `residual?: TokenTiers`, `costBasis?: "tokens" | "calls-and-ms"`. `residual` is additive beyond the interface contract's listing and is the **only** path by which `CorrelationResult.residual` reaches a rollup; a caller wires `{ correlated: c.byUnknown, residual: c.residual, costBasis: c.costBasis }` one-to-one.
  - `AttentionRollup.unattributed: { calls: number; ms: number; tokens: TokenTiers }`
  - `AttentionRollup.uncorrelated: TokenTiers` — the fourth bucket.
  - `AttentionRollup.costBasis: "tokens" | "calls-and-ms"` — the field Phase 3's refusal-to-compare reads.
  - `export interface TracedCall { ts?: string; tool?: string; session?: string; unknown?: string; ms?: number }` — one declared shape of a usage-trace line.

- [ ] **Step 1: Write the failing test**

First **extend** (never loosen) the two exact-shape assertions on `unattributed`. In `test/eval/attention.test.ts`, the test named `"a vault with no usage log reports no unattributed spend rather than throwing"` currently asserts:

```typescript
    expect(computeAttention([unknown("U")], tmp()).unattributed).toEqual({ calls: 0, ms: 0 });
```

Replace that line with:

```typescript
    expect(computeAttention([unknown("U")], tmp()).unattributed).toEqual({
      calls: 0, ms: 0, tokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
    });
```

The test named `"an event naming an unknown not on the tree is neither attributed nor counted as unattributed"` ends with the same shape; replace its final line the same way:

```typescript
    expect(rollup.unattributed).toEqual({
      calls: 0, ms: 0, tokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
    });
```

If Tasks 3–4 added further `toEqual` assertions on `unattributed`, extend those identically — the exactness is the guard; only the field list grows.

Then append this block to the end of the file:

```typescript
const ZERO = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
const tiers = (input: number, output = 0, cacheCreate = 0, cacheRead = 0) =>
  ({ input, output, cacheCreate, cacheRead });

function usageLog(dir: string, events: Record<string, unknown>[]): void {
  fs.mkdirSync(path.dirname(usageLogPath(dir)), { recursive: true });
  fs.writeFileSync(usageLogPath(dir), events.map((e) => JSON.stringify(e)).join("\n"), "utf8");
}

describe("computeAttention — the token dimension", () => {
  test("correlated tokens are a THIRD source, added to the ledger and the trace rather than replacing either", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "U", kind: "spend", calls: 2, ms: 50, tokens: tiers(100, 10) });
    usageLog(dir, [{ ts: "b", tool: "ost_read_tree", ok: true, ms: 9, surface: "mcp", argBytes: 0, unknown: "U" }]);

    const rollup = computeAttention([unknown("U")], dir, { correlated: new Map([["U", tiers(7, 3)]]) });
    expect(rollup.unknowns[0].calls).toBe(3);
    expect(rollup.unknowns[0].ms).toBe(59);
    expect(rollup.unknowns[0].tokens).toEqual(tiers(107, 13));
    expect(rollup.unknowns[0].weightedCost).toBeGreaterThan(0);
  });

  test("an unknown the trace never mentions is still credited its correlated tokens — the transcript sees spend the call log cannot", () => {
    const rollup = computeAttention([unknown("U")], tmp(), { correlated: new Map([["U", tiers(0, 40)]]) });
    expect(rollup.unknowns[0].calls).toBe(0);
    expect(rollup.unknowns[0].tokens).toEqual(tiers(0, 40));
    expect(rollup.unknowns[0].weightedCost).toBeGreaterThan(0);
    expect(rollup.byClass.bounded.weightedCost).toBeGreaterThan(0);
  });

  test("correlated tokens naming a title not on the tree are dropped by default — crediting a ghost is a fabrication", () => {
    const rollup = computeAttention([unknown("U")], tmp(), { correlated: new Map([["Ghost", tiers(500)]]) });
    expect(rollup.unknowns[0].tokens).toEqual(ZERO);
    expect(rollup.unattributed.tokens).toEqual(ZERO);
  });

  test("staleAttribution: unattributed folds a ghost's tokens into the unattributed share — the same allele that moves its calls moves its tokens", () => {
    const rollup = computeAttention([unknown("U")], tmp(), {
      correlated: new Map([["Ghost", tiers(500)]]),
      attribution: { staleAttribution: "unattributed" },
    });
    expect(rollup.unattributed.tokens).toEqual(tiers(500));
    expect(rollup.unknowns[0].tokens).toEqual(ZERO);
  });

  test("transcript spend inside no tool window at all is its own bucket — silence is NOT an unmarked call", () => {
    const dir = tmp();
    usageLog(dir, [{ ts: "a", tool: "ost_read_tree", ok: true, ms: 5, surface: "mcp", argBytes: 0 }]);

    const rollup = computeAttention([unknown("U")], dir, {
      correlated: new Map(),
      residual: tiers(9000, 0, 0, 120000),
    });
    expect(rollup.uncorrelated).toEqual(tiers(9000, 0, 0, 120000));
    expect(rollup.unattributed).toEqual({ calls: 1, ms: 5, tokens: ZERO });
  });

  test("a declared token basis with no correlator behind it is recorded as calls-and-ms — a basis with no data is a lie a fitness comparison would believe", () => {
    expect(computeAttention([unknown("U")], tmp(), { costBasis: "tokens" }).costBasis).toBe("calls-and-ms");
  });

  test("a rollup built on a correlator records the token basis, so a mixed comparison can be refused rather than normalized", () => {
    const rollup = computeAttention([unknown("U")], tmp(), { correlated: new Map(), costBasis: "tokens" });
    expect(rollup.costBasis).toBe("tokens");
  });

  test("the default rollup is exactly today's — no correlation, no tokens, and the record says which basis it is on", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "U", kind: "spend", calls: 1, ms: 4 });

    const rollup = computeAttention([unknown("U")], dir);
    expect(rollup.unknowns[0].calls).toBe(1);
    expect(rollup.unknowns[0].ms).toBe(4);
    expect(rollup.unknowns[0].tokens).toEqual(ZERO);
    expect(rollup.unknowns[0].weightedCost).toBe(0);
    expect(rollup.uncorrelated).toEqual(ZERO);
    expect(rollup.unattributed).toEqual({ calls: 0, ms: 0, tokens: ZERO });
    expect(rollup.costBasis).toBe("calls-and-ms");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/eval/attention.test.ts`
Expected: FAIL — the two extended assertions fail with `expected { calls: 0, ms: 0 } to deeply equal { calls: 0, ms: 0, tokens: { input: 0, … } }`; the new tests fail with `expected undefined to deeply equal { input: 0, … }` on `rollup.uncorrelated` and `expected undefined to be 'calls-and-ms'` on `rollup.costBasis`, and the correlated-source tests fail with `expected { input: 0, … } to deeply equal { input: 107, output: 13, … }` because `correlated` is ignored. `npm run build` stays clean throughout: `tsconfig.json` includes only `src/**/*`, so `tsc` never sees this test file and the unknown `correlated` option is a vitest-runtime failure, never a build one.

- [ ] **Step 3: Write the implementation**

All edits are in `src/eval/attention.ts`.

**(a) Extend the module JSDoc.** Append this paragraph to the existing block, immediately before the closing `*/`:

```typescript
 * Phase 2 adds a token dimension the tool tracer cannot see. Transcript
 * correlation (`eval/correlate.ts`) arrives as a third additive source beside
 * the ledger and the trace, and with it a FOURTH bucket the call-based split
 * has no room for: transcript spend inside no tool window at all — the
 * thinking, the reading, the assistant turn that emits the call. That is not
 * the same ignorance as "a call with no OST_UNKNOWN", and folding the two
 * together would inflate the unattributed share with spend no call ever
 * bracketed, so they are reported apart. Every rollup carries the basis its
 * numbers actually rest on, because a comparison across bases must be refused
 * rather than silently normalized, and a refusal needs something to read.
 *
 * The basis is a property of what this rollup ACTUALLY RECEIVED, not of what
 * the genome wished for. No `correlated` map reaches `computeAttention` =>
 * `costBasis` is `"calls-and-ms"`, whatever `tokenSplit.costBasis` declares.
 * Under the default genome `tokenSplit.enabled` is false, the correlator never
 * runs, and nothing passes `correlated` — so every production rollup reports
 * `calls-and-ms` until an explicit non-default genome turns the split on.
```

**(b) Replace the `CallCost` / `UsageRollup` block** (today `{ calls; ms }` and its comment) with:

```typescript
/**
 * What one bucket of the trace cost. `tokens` is always `{0,0,0,0}` as read
 * from the usage log — the tool tracer never saw a token — and is filled only
 * where the correlator has something to say. One shape for both sources is
 * what lets correlated tokens merge INTO these buckets rather than shadow them.
 */
interface CallCost {
  calls: number;
  ms: number;
  tokens: TokenTiers;
}

function emptyCallCost(): CallCost {
  return { calls: 0, ms: 0, tokens: emptyTiers() };
}

interface UsageRollup {
  /** Per-unknown calls/ms/tokens, for titles present in `knownTitles` only. */
  byUnknown: Map<string, CallCost>;
  /** Spend the trace could not attribute to any unknown. */
  unattributed: CallCost;
}

/**
 * One line of the usage trace, parsed whole.
 *
 * `ts` is the START of the call (`withUsageTracing` stamps `new Date(started)`
 * and appends on finish, so the file is ordered by finish time — a reader must
 * sort, never assume file order), and `session`/`tool` are the other fields a
 * split policy joins on. The rollup itself needs only `unknown` and `ms`; the
 * shape is declared complete and exported so the correlator reads the same
 * record rather than keeping a second, drifting private copy of it.
 */
export interface TracedCall {
  ts?: string;
  tool?: string;
  session?: string;
  unknown?: string;
  ms?: number;
}
```

**(c) Inside `rollUpUsage`,** three edits — the two `CallCost` literals become `emptyCallCost()`, and the parse widens:

```typescript
  const unattributed = emptyCallCost();
```

```typescript
      const event = JSON.parse(trimmed) as TracedCall;
```

```typescript
      const bucket = byUnknown.get(event.unknown) ?? emptyCallCost();
```

Leave the stale-attribution branch Task 3 added exactly as it is; it moves calls and ms, and step (d) gives it the token half.

**(d) Add the merge and the basis resolver** immediately after `rollUpUsage`:

```typescript
/**
 * Fold the correlator's per-unknown tokens into the same buckets the trace
 * filled, so a downstream reader sees one cost per unknown rather than two
 * half-costs it has to add itself.
 *
 * A correlated title the tree does not carry gets exactly the treatment its
 * traced calls get: dropped by default, because crediting a title that does
 * not exist is a fabrication, or folded into `unattributed` when the
 * attribution gene says so. The two must agree — an allele that moved a
 * ghost's calls but not its tokens would make the unattributed share depend on
 * which dimension you asked in.
 */
function mergeCorrelated(
  usage: UsageRollup,
  knownTitles: ReadonlySet<string>,
  correlated: Map<string, TokenTiers> | undefined,
  stale: AttributionGene["staleAttribution"],
): void {
  if (!correlated) return;
  for (const [title, tokens] of correlated) {
    if (!knownTitles.has(title)) {
      if (stale === "unattributed") usage.unattributed.tokens = addTiers(usage.unattributed.tokens, tokens);
      continue;
    }
    const bucket = usage.byUnknown.get(title) ?? emptyCallCost();
    bucket.tokens = addTiers(bucket.tokens, tokens);
    usage.byUnknown.set(title, bucket);
  }
}

/**
 * What this rollup's numbers actually rest on — a property of what it
 * RECEIVED, never of what the genome declared.
 *
 * The genome may declare `tokens`, but a declaration is not data: with no
 * correlated map supplied every token is zero, and a fitness comparison on
 * that basis would read the silence as "this variant spent nothing". So the
 * rule is unconditional: `opts.correlated === undefined` => `"calls-and-ms"`,
 * regardless of `tokenSplit.costBasis` or of `opts.costBasis`. Under the
 * default genome (`tokenSplit.enabled: false`) the correlator never runs and
 * no caller passes `correlated`, so every production rollup reports
 * `calls-and-ms` until an explicit non-default genome turns the split on.
 * Supplying an EMPTY map is not the same as supplying none — it says the
 * correlator ran and found no attributable spend, which is a token measurement
 * of zero rather than the absence of a measurement.
 */
function resolveCostBasis(opts: AttentionOptions): "tokens" | "calls-and-ms" {
  if (opts.correlated === undefined) return "calls-and-ms";
  return opts.costBasis ?? "calls-and-ms";
}
```

Add `AttributionGene` to the existing genome type import (Task 3 already imports `TokenWeightsGene`, `ClassifierGene`, `ResolutionGene`, and `AttributionGene` from `../genome/schema.js`; if `AttributionGene` is not among them, add it — the import specifier keeps its `.js` extension).

**(e) Grow `AttentionOptions`.** Task 3 already declared `weights`, `classifier`, `resolution` and `attribution` up front; this task introduces none of those four and must not redeclare them. It appends the two contract fields `correlated` and `costBasis`, plus `residual` (additive beyond the interface contract's listing — see Interfaces above), after the four Task 3 declared:

```typescript
  /**
   * Per-unknown token spend from the transcript correlator (`correlateTokens`).
   * Absent means no correlation was attempted — which is the default genome,
   * where `tokenSplit.enabled` is false and this argument is never passed.
   */
  correlated?: Map<string, TokenTiers>;
  /**
   * `CorrelationResult.residual` — transcript spend the correlator could place
   * in NO tool window at all. Reported as its own bucket, never merged.
   */
  residual?: TokenTiers;
  /** The basis the genome declares; downgraded when nothing correlated. */
  costBasis?: "tokens" | "calls-and-ms";
```

**(f) Grow `AttentionRollup`,** replacing its `unattributed` line:

```typescript
  /** Spend the trace could not attribute to any unknown. */
  unattributed: { calls: number; ms: number; tokens: TokenTiers };
  /**
   * Transcript spend inside no tool window at all — the fourth bucket. Neither
   * attributable nor the same as an unmarked call, so it is neither credited
   * nor folded into `unattributed`.
   */
  uncorrelated: TokenTiers;
  /** What these numbers rest on. A comparison across bases is refused, not normalized. */
  costBasis: "tokens" | "calls-and-ms";
```

**(g) Inside `computeAttention`,** three surgical edits. Replace the line constructing `usage` with:

```typescript
  const knownTitles = new Set(darkNodes.map((n) => n.title));
  const stale = opts.attribution?.staleAttribution ?? "drop";
  const usage = rollUpUsage(vaultDir, knownTitles, stale);
  mergeCorrelated(usage, knownTitles, opts.correlated, stale);
```

If Task 3 already binds the stale-attribution value under another name, reuse that binding rather than shadowing it; the value must default to `"drop"`.

Replace the injection point — the third additive source, preserving the rule stated in the comment above it:

```typescript
    const traced = usage.byUnknown.get(node.title);
    if (traced) {
      calls += traced.calls;
      ms += traced.ms;
      tokens = addTiers(tokens, traced.tokens);
    }
```

Replace the return statement:

```typescript
  return {
    unknowns,
    byClass,
    unattributed: usage.unattributed,
    uncorrelated: opts.residual ?? emptyTiers(),
    costBasis: resolveCostBasis(opts),
  };
```

Leave the classifier, resolution, `byClass` and `weightedCost` lines exactly as Tasks 3–5 left them — in particular Task 5 threads `opts.resolution` into `resolutionState` inside `computeAttention`, and that edit stays: `weightedTokenCost` now prices correlated tokens for free, because they arrive in the same `tokens` accumulator the ledger fills.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/eval/attention.test.ts`
Expected: PASS — the file grows by 8 tests; nothing previously green goes red, including the two extended exact-shape assertions.

Then run the whole gate, because `AttentionRollup`'s shape changed:

Run: `npm test && npm run build`
Expected: PASS — no other module reads `AttentionRollup` yet (`computeAttention` has one consumer, this test file), so nothing else moves. A `tsc` error naming `unattributed` or `costBasis` means a later task's wiring landed early — extend that reader, never narrow the rollup.

- [ ] **Step 5: Commit**

```bash
git add src/eval/attention.ts test/eval/attention.test.ts
git commit -m "feat(eval): correlated tokens reach the rollup, and the record names its basis"
```

---

### Task 12: Attention reaches a production surface

`computeAttention` has no production caller — it is a rollup nothing ever renders, which makes the whole ledger unobservable. `renderStatus` is the one function both status surfaces share: the `ost-agent status` CLI command (`src/cli/index.ts:302`) and the `ost_status` MCP tool (`src/security/tools.ts:460`, on `READ_ONLY` at `src/mcp/server.ts:56`, so it carries no commit). Extending it lights both at once and adds no tool name.

The section is appended **after** the thresholds block, last in the output. That is deliberate: every existing line keeps its position, so "a vault with no unknowns is byte-identical to before" is a claim a reader can check by looking rather than by diffing. And the guard is on the tree, not on the rollup — a vault with no `Unknown` layer does not so much as open the usage log.

**`renderStatus` stays read-only.** It prices the ledger; it never runs the correlator (Task 10) and never calls `recordAttention`. `eval/` is deterministic and write-free by contract (`src/eval/render.ts:1-8`), and a status command that mutated the trace it reports on would make every reading depend on how often it was read.

**Files:**
- Modify: `src/eval/render.ts` (add the `formatCost` and `appendAttention` helpers; `renderStatus` appends the attention section as its last block; import `computeAttention` and `weightedTokenCost` from `./attention.js`)
- Test: `test/eval/render.test.ts` (append one `describe` block; add `describe` to the existing vitest import)

**Interfaces:**
- Consumes:
  - `computeAttention(tree: readonly OstNode[], vaultDir: string, opts?: AttentionOptions): AttentionRollup` and `weightedTokenCost(tokens: TokenTiers, weights?: TokenWeightsGene): number` (Tasks 3, 11), where `AttentionOptions` carries `weights?`, `classifier?`, `resolution?`, `attribution?`, `costBasis?`
  - `AttentionRollup.byClass: Record<string, ClassRollup>`, `.unattributed: { calls: number; ms: number; tokens: TokenTiers }`, `.costBasis: "tokens" | "calls-and-ms"` (Task 11)
  - `PassContext.genome: Genome` (Task 2), reading `genome.tokenWeights`, `genome.classifier`, `genome.resolution`, `genome.attribution`, `genome.tokenSplit.costBasis`
- Produces: **no new exported symbol.** `renderStatus(ctx: PassContext, census: TreeCensus): string` keeps its signature exactly, so `src/cli/index.ts:302` and `src/security/tools.ts:460` need no edit and cannot fork. The section text itself is the contract later tasks read.

- [ ] **Step 1: Write the failing test**

In `test/eval/render.test.ts`, widen the vitest import at line 9 to include `describe`, and add the two telemetry imports beside the existing ones:

```typescript
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { recordAttention } from "../../src/telemetry/attention.js";
import { usageLogPath } from "../../src/telemetry/usage.js";
```

Then append this block to the end of the file. It reuses the file's existing `beforeEach`, which creates `dir` and runs `initVault(dir, "Reach ten returning operators.", "Reach ten returning operators")`:

```typescript
describe("renderStatus — the attention section", () => {
  const FULL = "## Format\na count per day\n\n## Methodology\nquery the log\n\n## Rationale\nserves [[Reach ten returning operators]]";

  /** Attach an unknown to the vault. Darkness needs no parent to be counted. */
  function dark(title: string, body = FULL, status?: "validated" | "deferred"): void {
    buildPassContext(dir).vault.createNode({
      title,
      layer: "Unknown",
      tags: [],
      links: [],
      body,
      evidence: "assertion",
      ...(status ? { status } : {}),
    });
  }

  /** Status text read from a context built AFTER the writes above. */
  function status(): string {
    const ctx = buildPassContext(dir);
    return renderStatus(ctx, ctx.vault.readTreeCensus());
  }

  const lineFor = (text: string, prefix: string): string | undefined =>
    text.split("\n").find((l) => l.trim().startsWith(prefix));

  test("a vault with no unknowns renders exactly the status it rendered before attention existed", () => {
    const ctx = buildPassContext(dir);
    // Pinned verbatim, not by prefix: the regression contract for the whole of
    // Phase 2 is that the default genome changes nothing, and a vault with
    // nothing dark in it is where that claim is cheapest to check.
    expect(renderStatus(ctx, ctx.vault.readTreeCensus())).toBe(
      [
        `Vault: ${ctx.dir}`,
        "Outcome: Reach ten returning operators.",
        "Nodes: 1  (Outcome 1, Opportunity 0, Solution 0, AssumptionTest 0, Unknown 0)",
        "Unvalidated (agent-ideated, awaiting review): 0",
        "Believability: money 0, observed 0, stated 0, expert 0, assertion 1",
        "  the tree as a whole rests on its weakest rung: assertion",
      ].join("\n"),
    );
  });

  test("every class that carries an unknown reports its counts and what it cost", () => {
    dark("Cabinet");
    dark("Answered", FULL, "validated");
    dark("Given up", FULL, "deferred");
    dark("No method", "## Format\na count\n\n## Rationale\nserves [[Reach ten returning operators]]");
    dark("Dark", "nothing declared at all");
    recordAttention(dir, {
      ts: "2026-07-28T00:00:00Z",
      unknown: "Cabinet",
      kind: "spend",
      calls: 1,
      ms: 10,
      tokens: { input: 100, output: 10, cacheCreate: 0, cacheRead: 0 },
    });

    const text = status();
    expect(text).toContain("Attention: 5 unknown(s) — satisfied 1, abandoned 1, open 3");
    expect(lineFor(text, "bounded:")).toBe(
      "  bounded: 3 unknown(s) (satisfied 1, abandoned 1, open 1) — weighted cost 150",
    );
    expect(lineFor(text, "unreached:")).toBe(
      "  unreached: 1 unknown(s) (satisfied 0, abandoned 0, open 1) — weighted cost 0",
    );
    expect(lineFor(text, "unbounded:")).toBe(
      "  unbounded: 1 unknown(s) (satisfied 0, abandoned 0, open 1) — weighted cost 0",
    );
  });

  test("the share of spend that named no unknown is reported — a variant that cannot say what it spent attention on is measurably worse", () => {
    dark("Cabinet");
    fs.mkdirSync(path.dirname(usageLogPath(dir)), { recursive: true });
    fs.writeFileSync(
      usageLogPath(dir),
      [
        JSON.stringify({ ts: "a", tool: "ost_read_tree", ok: true, ms: 5, surface: "mcp", argBytes: 0 }),
        JSON.stringify({ ts: "b", tool: "ost_read_tree", ok: true, ms: 5, surface: "mcp", argBytes: 0 }),
        JSON.stringify({ ts: "c", tool: "ost_read_tree", ok: true, ms: 7, surface: "mcp", argBytes: 0, unknown: "Cabinet" }),
      ].join("\n"),
      "utf8",
    );

    const text = status();
    expect(lineFor(text, "unattributed:")).toBe("  unattributed: 2/3 recorded call(s) (67%) named no unknown");
    expect(text).toContain("a variant that cannot say what it spent attention on is measurably worse.");
  });

  test("status reports calls-and-ms because nothing correlated tokens — a rollup priced in calls can NEVER be read as one priced in tokens", () => {
    dark("Cabinet");
    // `renderStatus` never runs the correlator, so it never supplies
    // `correlated`, and Task 11's `resolveCostBasis` downgrades any declared
    // token basis to calls-and-ms when nothing correlated. That is the honest
    // state of the world until a non-default genome enables the split.
    expect(lineFor(status(), "cost basis:")).toBe(
      "  cost basis: calls-and-ms — no token data; a comparison against a token-based rollup is refused, never normalized",
    );
  });

  test("a class the vocabulary declares but no unknown carries stays quiet", () => {
    dark("Cabinet");
    const text = status();
    expect(text).toContain("Attention: 1 unknown(s) — satisfied 0, abandoned 0, open 1");
    expect(lineFor(text, "bounded:")).toBeDefined();
    expect(lineFor(text, "unreached:")).toBeUndefined();
    expect(lineFor(text, "unbounded:")).toBeUndefined();
  });

  test("status prices the ledger without writing to it — reading what darkness cost must NOT change it", () => {
    dark("Cabinet");
    const first = status();
    const second = status();
    expect(second).toBe(first);
    expect(fs.existsSync(path.join(dir, ".ost-agent", "attention"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/eval/render.test.ts`
Expected: FAIL — 4 of the 6 new tests. The per-class test fails first with `expected undefined to be '  bounded: 3 unknown(s) (satisfied 1, abandoned 1, open 1) — weighted cost 150'`; the unattributed, cost-basis and quiet-vocabulary tests fail the same way, on `lineFor(...)` returning `undefined`.

The byte-identity test and the read-only test **pass from the outset** — that is the point of both. They are guards that must never start failing, not work to be made green.

- [ ] **Step 3: Write the implementation**

In `src/eval/render.ts`, add the import beside the other `eval/` imports (ESM, explicit `.js`):

```typescript
import { computeAttention, weightedTokenCost } from "./attention.js";
```

Add both helpers immediately above `renderStatus`:

```typescript
/**
 * Weighted cost is a ratio, not currency, and prints like one: whole when it is
 * whole, one decimal otherwise. A float tail like 62.550000000000004 in a status
 * line reads as precision the number does not have.
 */
function formatCost(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * What darkness cost, and what it bought — the one place the attention ledger
 * reaches a human. The layer breakdown above already counts unknowns; this says
 * what was spent on them, which is the number that decides where to look next.
 *
 * Three things beyond the per-class counts are load-bearing. **Weighted cost**
 * is priced with the genome's tier weights, at read time, so the cost model
 * stays an allele rather than a constant. **Unattributed share** is reported
 * because a variant that cannot say what it spent attention on is measurably
 * worse (design, "Error handling") — the denominator is every recorded call,
 * attributed or not; a call naming a title no longer on the tree falls out of
 * both halves under `attribution.staleAttribution: drop`, because crediting it
 * to a node that does not exist would be a fabrication. **Cost basis** is
 * printed because a rollup priced in calls-and-ms and one priced in tokens are
 * not comparable, and a comparison that mixes them must be refusable rather
 * than silently normalized.
 *
 * Nothing is printed when there is no darkness. The guard reads the tree rather
 * than the rollup so an unknown-free vault does not even open the usage log:
 * silence here is the regression contract, and the cheapest way to keep a
 * contract is to do no work that could break it.
 */
function appendAttention(lines: string[], ctx: PassContext, tree: readonly OstNode[]): void {
  if (!tree.some((n) => n.layer === "Unknown")) return;

  const rollup = computeAttention(tree, ctx.dir, {
    weights: ctx.genome.tokenWeights,
    classifier: ctx.genome.classifier,
    resolution: ctx.genome.resolution,
    attribution: ctx.genome.attribution,
    costBasis: ctx.genome.tokenSplit.costBasis,
  });

  let satisfied = 0;
  let abandoned = 0;
  let open = 0;
  for (const bucket of Object.values(rollup.byClass)) {
    satisfied += bucket.satisfied;
    abandoned += bucket.abandoned;
    open += bucket.open;
  }
  lines.push(
    `Attention: ${rollup.unknowns.length} unknown(s) — satisfied ${satisfied}, abandoned ${abandoned}, open ${open}`,
  );

  // Class order comes from the genome's vocabulary, not from insertion; a class
  // nothing carries has nothing to say, so it gets no line.
  for (const [klass, bucket] of Object.entries(rollup.byClass)) {
    if (bucket.count === 0) continue;
    lines.push(
      `  ${klass}: ${bucket.count} unknown(s) (satisfied ${bucket.satisfied}, abandoned ${bucket.abandoned}, ` +
        `open ${bucket.open}) — weighted cost ${formatCost(bucket.weightedCost)}`,
    );
  }

  const attributed = rollup.unknowns.reduce((n, u) => n + u.calls, 0);
  const recorded = attributed + rollup.unattributed.calls;
  if (recorded > 0) {
    const share = Math.round((rollup.unattributed.calls / recorded) * 100);
    const stray = weightedTokenCost(rollup.unattributed.tokens, ctx.genome.tokenWeights);
    lines.push(
      `  unattributed: ${rollup.unattributed.calls}/${recorded} recorded call(s) (${share}%) named no unknown` +
        (stray > 0 ? `, weighted cost ${formatCost(stray)}` : ""),
    );
    lines.push("  a variant that cannot say what it spent attention on is measurably worse.");
  }

  lines.push(
    `  cost basis: ${rollup.costBasis}` +
      (rollup.costBasis === "tokens"
        ? ""
        : " — no token data; a comparison against a token-based rollup is refused, never normalized"),
  );
}
```

Then, in `renderStatus`, append the section as the last block — immediately before the `return`:

```typescript
  // Last, and appended rather than interleaved: every line above keeps the
  // position it had before darkness was priced, so "a vault with no unknowns
  // renders what it always did" is checkable by reading rather than diffing.
  appendAttention(lines, ctx, tree);
  return lines.join("\n");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/eval/render.test.ts test/mcp/analysis-tools.test.ts`
Expected: PASS — `test/eval/render.test.ts` grows by 6 tests; nothing previously green goes red. `test/mcp/analysis-tools.test.ts:77` compares `ost_status`'s payload against `renderStatus` directly, so it passing is the proof that both surfaces gained the section from one edit rather than two.

Then run: `npm test`
Expected: PASS — every file. Nothing else calls `renderStatus`, and its signature did not change.

- [ ] **Step 5: Commit**

```bash
git add src/eval/render.ts test/eval/render.test.ts
git commit -m "feat(eval): status prices the darkness it already counts"
```

---

### Task 13: The loop learns darkness exists

`ost_next_work` has reported `openUnknowns` since Phase 1, and nothing has ever read it. `grep -rn "nknown" .claude/` returns **0 hits across 0 files**: `.claude/commands/ost-pass.md:12-16` enumerates exactly four work buckets, and the maintenance loop hardcoded in `scripts/gen-skill.ts:86-93` enumerates the same four. A session running `/ost-pass` today literally cannot know unknowns exist, which means every gene the preceding twelve tasks extracted is a policy no session ever exercises. This task adds the fifth bucket to both doors.

Two guard situations, and they are not the same:

- **`SKILL.md` is generator-guarded.** `test/skill/drift.test.ts:11` byte-compares the committed file against `renderSkill()`, so a generator edit *forces* regeneration in the same commit. Step 4 is that regeneration.
- **`/ost-pass` is hand-authored — no generator, no drift test.** A hand edit there is unguarded: nothing in the suite would notice if a later refactor deleted the fifth bucket. The content assertions in Step 1 are the only guard that will exist over that file, which is why they read it off disk rather than from a renderer.

Two deliberate boundaries, both asserted:

- **The skill NEVER restates the class vocabulary.** It reads the class off the tool output and names the genome as the owner. A skill file that enumerated the alleles would be a compiled-in copy of the classifier gene — exactly the thing Phase 2 exists to delete.
- **The unattended sweep gains no outward-sensing grant.** `/ost-pass`'s `allowed-tools` is unchanged: exploration inside the unattended loop is confined to declaring and repairing contracts, recording an answer the pass already has grounds for, and deferring what it will not pursue. Looking outward spends money, and spending money stays the attended path — the skill, which already holds `ost_search_web` / `ost_read_web` / `ost_read_repo` and is already bounded by the lookup budget.

**Files:**
- Modify: `scripts/gen-skill.ts` (add a fifth-layer section, extend the `ost_next_work` bullet, insert loop step 6 and renumber the old step 6 to 7)
- Modify: `.claude/skills/opportunity-solution-tree/SKILL.md` (regenerated — never hand-edited)
- Modify: `.claude/commands/ost-pass.md` (fifth bucket; `done` clarified; no `allowed-tools` change)
- Test: `test/skill/open-unknowns.test.ts`

**Interfaces:**
- Consumes: `renderSkill(): string` and `COMMANDS_DIR: string` from `scripts/gen-skill.js`; the `openUnknowns: OpenUnknown[]` field of `NextWork` produced by `computeNextWork(vault, dir, min, genome?)` (Task 8), whose entries carry `{ title, klass, darkens, gaps }`; the optional `unknown` property added to existing tools' `inputSchema` in Task 7, which `handleOstCall` writes into `process.env.OST_UNKNOWN` around `await tool.run(args)`.
- Produces: no TypeScript exports. It produces the prose surface — the only place a running session is told that unknowns exist, what their contract is, and how to make its spend self-attribute. Nothing imports it; sessions read it.

- [ ] **Step 1: Write the failing test**

Create `test/skill/open-unknowns.test.ts`:

```typescript
/**
 * The loop has to know darkness exists, or the genome is a policy nothing ever
 * exercises. `ost_next_work` has reported `openUnknowns` since Phase 1 and
 * nothing in `.claude/` mentioned it — a session could not have picked one up.
 *
 * Two files, two different guards. `SKILL.md` is generated, so drift.test.ts
 * already byte-compares it against `renderSkill()`; these assertions are about
 * *content*, the same division of labour first-run.test.ts keeps. `/ost-pass`
 * is hand-authored — no generator behind it and no drift test over it — so this
 * file is the ONLY thing standing between that command and a silent regression.
 * It reads the committed file off disk on purpose.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { COMMANDS_DIR, renderSkill } from "../../scripts/gen-skill.js";

const pass = fs.readFileSync(path.join(COMMANDS_DIR, "ost-pass.md"), "utf8");

describe("the generated skill teaches the fifth bucket", () => {
  const skill = renderSkill();

  test("it names the field the tool actually returns, so the session can find the work", () => {
    expect(skill).toContain("openUnknowns");
  });

  test("it teaches all three contract sections, and names Format as the stopping condition", () => {
    expect(skill).toContain("## Format");
    expect(skill).toContain("## Methodology");
    expect(skill).toContain("## Rationale");
    expect(skill).toMatch(/Format[\s\S]{0,200}?stopping condition/i);
  });

  test("it teaches the `unknown` argument — spend that does not self-attribute teaches nothing", () => {
    expect(skill).toMatch(/`unknown:/);
  });

  test("exploration is discretionary — darkness NEVER blocks done", () => {
    expect(skill).toMatch(/never blocks? `done`|does not block `done`/);
  });

  test("the class is read off the tool output and the vocabulary is NEVER restated — the classifier is a genome allele, not a constant in a skill file", () => {
    expect(skill).toMatch(/genome/i);
    expect(skill).not.toMatch(/\bunreached\b/i);
  });
});

describe("/ost-pass — the unattended sweep knows about darkness", () => {
  test("the fifth bucket reached the command a session actually runs", () => {
    expect(pass).toContain("openUnknowns");
  });

  test("done is still done with unknowns open — the sweep must NOT loop on darkness", () => {
    expect(pass).toMatch(/never blocks? `done`|does not block `done`/);
  });

  test("an unattended pass attributes its spend too — it passes the `unknown` argument", () => {
    expect(pass).toMatch(/`unknown:/);
  });

  test("the unattended sweep holds NO outward-sensing grant — looking costs money, and money stays an attended decision", () => {
    const frontmatter = pass.slice(0, pass.indexOf("---", 3));
    expect(frontmatter).toContain("allowed-tools:");
    expect(frontmatter).not.toContain("ost_search_web");
    expect(frontmatter).not.toContain("ost_read_web");
    expect(frontmatter).not.toContain("ost_read_repo");
  });

  test("it does NOT restate the class vocabulary either — one copy of the classifier, and it lives in the genome", () => {
    expect(pass).not.toMatch(/\bunreached\b/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/skill/open-unknowns.test.ts`
Expected: FAIL — 6 of 10 tests fail. The first is `AssertionError: expected '---\nname: opportunity-solution-tree\ndescription: …' to contain 'openUnknowns'`; the `/ost-pass` bucket test fails the same way against the committed command file. The two `allowed-tools` assertions and the two `unreached` assertions pass already — they are the boundaries this task must not cross, and they are asserted so a later edit cannot cross them either.

- [ ] **Step 3: Write the implementation**

In `scripts/gen-skill.ts`, inside `renderSkill()`, replace the layers block:

```typescript
  return `---
```

…leave the frontmatter and preamble untouched, and make three edits to the body.

**Edit 1 — the fifth layer.** Replace:

```typescript
## The four layers

${layers}

## Tree rules
```

with:

```typescript
## The four layers

${layers}

## The fifth layer — what the tree cannot see

Torres's four layers hold what the team knows. This tree carries a fifth, \`#Unknown\`, for what it does not: a named piece of darkness attached under the node it darkens, at any layer. Create one with \`ost_create_node\`, \`layer: "Unknown"\`, parent = the node it darkens. Darkness is not a defect to be cleared before the real work starts — it is inventory, and naming it is what makes it costable.

An unknown declares a contract in three body sections, and the sections are the whole point:

- \`## Format\` — the shape a valid answer takes. **This is the stopping condition.** An unknown that cannot say what an answer looks like cannot know when it is done, which is exactly why the Format is worth writing *before* you go looking.
- \`## Methodology\` — how such an answer would be collected. An unknown with a Format and no Methodology is worth commissioning observability for rather than chasing further.
- \`## Rationale\` — which node this darkens and what would change if it were answered.

\`ost_next_work\` reports every open unknown with the node it \`darkens\`, the contract sections still missing (\`gaps\`), and a derived class. **Read the class off the tool output; never restate the vocabulary from memory.** The classifier is an allele of the vault's genome (an optional \`genome.yaml\` beside \`ost.config.yaml\`; absent means the default), not a constant in this file — a copy here would be a second classifier that silently disagrees with the first.

## Tree rules
```

**Edit 2 — the tool bullet.** Replace:

```typescript
- **ost_next_work** — read-only. Reports exactly what's outstanding: unmapped evidence, under-served opportunities, solutions missing assumption tests, and hygiene issues. **Start every pass here.**
```

with:

```typescript
- **ost_next_work** — read-only. Reports exactly what's outstanding: unmapped evidence, under-served opportunities, solutions missing assumption tests, hygiene issues, and \`openUnknowns\` — every declared darkness still unresolved, offered as available work that never blocks \`done\`. **Start every pass here.**
```

**Edit 3 — the maintenance loop.** Replace:

```typescript
5. **Annotate hygiene issues** (for each \`hygieneIssue\`) with \`ost_annotate\`. Never delete — flag for a human.
6. Writes auto-commit. Re-run \`ost_next_work\` to confirm what remains, and report a short summary of what you created and what a human should review.
```

with:

```typescript
5. **Annotate hygiene issues** (for each \`hygieneIssue\`) with \`ost_annotate\`. Never delete — flag for a human.
6. **Explore open unknowns** (for each \`openUnknowns\` entry). Discretionary, and taken only after 1–5 are clear. **Exploration never blocks \`done\`**: darkness with no declared Format has no stopping condition, so counting it toward completion would wedge every pass forever. Prefer the ones whose contract is already complete. For each unknown you pick up:
   - **Pass \`unknown: "<the unknown's exact title>"\` on every tool call you make on its behalf.** That argument is what makes the attention it costs self-attribute; spend that arrives unattributed is spend the tree cannot learn from.
   - If \`gaps\` is non-empty, the cheapest useful act is to close them — \`ost_append_to_node\` the missing \`## Format\`, \`## Methodology\`, or \`## Rationale\`. An unknown that can newly state what an answer looks like has been advanced even if nothing was looked up.
   - If you reach an answer, append \`## Answer\` holding it **in its declared Format**, and cite where it came from. Never write \`## Answer\` over a guess — that heading is what marks the unknown resolved.
   - If you decide not to pursue it, say so: \`ost_set_status\` \`deferred\`. Abandonment recorded is information; abandonment silent is rot.
   - Looking outward spends the session's shared lookup budget. When it is spent, stop looking, write down what you learned, and leave the rest open.
7. Writes auto-commit. Re-run \`ost_next_work\` to confirm what remains, and report a short summary of what you created, which unknowns you advanced or deferred, and what a human should review. Unknowns still open are a normal ending, not a failure.
```

In `.claude/commands/ost-pass.md`, leave the frontmatter exactly as it is — the unattended sweep gains no new grant — and edit the body. Replace:

```markdown
2. If `done: true`, stop and report the final summary.
```

with:

```markdown
2. If `done: true`, stop and report the final summary. `openUnknowns` may still be non-empty when `done` is true — that is a complete pass, not an incomplete one.
```

Replace:

```markdown
   4. **`hygieneIssues`** → `ost_annotate` each (never delete).
```

with:

```markdown
   4. **`hygieneIssues`** → `ost_annotate` each (never delete).
   5. **`openUnknowns`** → optional, last, and only once 1–4 are empty. Work within the tools this sweep already holds: close the reported `gaps` with `ost_append_to_node` (`## Format` first — it is the stopping condition, the shape a valid answer takes); append `## Answer` in that declared Format only when this pass has genuine grounds for one; `ost_set_status` `deferred` for what you will not pursue, because recorded abandonment is information. Read each unknown's class off the tool output rather than restating it — the classifier belongs to the vault's genome. Pass `unknown: "<the unknown's exact title>"` on every call you make on its behalf, so the attention self-attributes. **This bucket never blocks `done`** — advance what you can in one visit and move on; do not loop on it.
```

Replace:

```markdown
Hard rules: append-only, never mark your own ideas `validated`, never invent or change the Outcome, never run tests. Writes auto-commit as you go. End with a concise report: what you created per layer, and what a human should review.
```

with:

```markdown
Hard rules: append-only, never mark your own ideas `validated`, never invent or change the Outcome, never run tests. This unattended sweep holds no outward-sensing grant on purpose — looking things up costs money, so `ost_search_web` / `ost_read_web` / `ost_read_repo` stay on the attended path (the `opportunity-solution-tree` skill), and an unknown this sweep cannot resolve from the tree is left open or deferred, never chased. Writes auto-commit as you go. End with a concise report: what you created per layer, which unknowns you advanced or deferred, and what a human should review.
```

- [ ] **Step 4: Regenerate the guarded file**

`SKILL.md` is generated and byte-compared by `test/skill/drift.test.ts:11`, so the generator edit above leaves the committed file stale until it is re-rendered. Regenerate it in this same commit:

Run: `npm run gen:skill` (the script is `"gen:skill": "tsx scripts/gen-skill.ts"` in `package.json`)
Expected: `wrote .claude/skills/opportunity-solution-tree/SKILL.md (…bytes)` and `wrote .claude/commands/ost-setup.md (…bytes)`. `ost-setup.md` renders from `OST_RULESET.firstRun`, which this task does not touch, so it re-renders byte-identically and shows no diff. Confirm with `git diff --stat .claude/` — exactly one changed file under `.claude/skills/`, plus the hand edit to `.claude/commands/ost-pass.md`.

Then, in this same step, run the guard that made the regeneration necessary: `npx vitest run test/skill/drift.test.ts`
Expected: PASS — 1 file, 2 tests. It byte-compares the committed `SKILL.md` against `renderSkill()`, so a green run here is the proof that the regeneration actually landed; a red one means the generator edit is committed and the rendered file is not.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/skill/`
Expected: PASS — 4 files, 10 new tests in `open-unknowns.test.ts` plus the existing `drift.test.ts` (2) and `first-run.test.ts` (4) and `setup-command.test.ts`, all green. If drift fails here, Step 4 was skipped.

Then run: `npm test`
Expected: PASS — the suite grows by exactly one file (`test/skill/open-unknowns.test.ts`) and nothing previously green goes red. `OST_RULESET` is untouched, so no ruleset-derived assertion moves; the four Torres layers are still four, and the fifth layer is rendered from the generator's own prose because it is this tree's extension, not Torres canon.

- [ ] **Step 6: Commit**

```bash
git add scripts/gen-skill.ts .claude/skills/opportunity-solution-tree/SKILL.md .claude/commands/ost-pass.md test/skill/open-unknowns.test.ts
git commit -m "feat(skill): the loop learns darkness exists"
```

---

### Task 14: The identity suite, the genome reference, and phase verification

The regression contract made executable. The design's Testing section says *"with the default genome, behavior matches today's — genome extraction is a refactor first and a capability second."* Tasks 1–13 each asserted that locally; this task asserts it in one place, over the whole surface, in a file whose only job is to fail when the refactor stopped being a refactor.

The suite's load-bearing half is the **negative controls**. Items 1–5 can every one of them pass against an interpreter that quietly ignores its `genome` argument and calls the Phase 1 constants — a genome that is data nothing reads, which is exactly the failure §0 of the inventory warns about. The controls are the anti-vacuity guard, on the precedent of `test/release/examples-allowlist.test.ts:45` (*"a sanity check on the authority itself, so a typo there can't make both comparisons below pass vacuously"*).

**Files:**
- Create: `test/genome/identity.test.ts`
- Create: `docs/reference/genome.md` (what an allele is; the fail-closed exclusions; the annotated default genome)
- Modify: `README.md` (one link to the new reference, beside the two existing `docs/reference/` links)
- Modify: `CHANGELOG.md` (new `## 0.23.0` entry, long-form narrative voice)
- Modify: `package.json`, `package-lock.json`, `src/index.ts`, `.claude-plugin/plugin.json` (version 0.22.0 → 0.23.0; `test/release/version.test.ts` pins all four together)

**Interfaces:**
- Consumes (nothing new is produced by this task — it is pure verification):
  - `defaultGenome(): Genome`, `loadGenome(vaultDir: string): Genome`, `genomePath(vaultDir: string): string`, `GENOME_FILENAME` from `src/genome/load.js` (Task 1)
  - `GenomeSchema`, `type Genome` from `src/genome/schema.js` (Task 1)
  - `PassContext.genome` from `buildPassContext` (Task 2)
  - `classifyUnknown(node, classifier?)`, `resolutionState(node, resolution?)`, `contractGaps(node, sections?)` from `src/knowledge/unknowns.js` (Tasks 4, 5)
  - `computeAttention(tree, vaultDir, opts?)` with `AttentionRollup.byClass: Record<string, ClassRollup>`, `.unattributed.tokens`, `.costBasis` (Tasks 3, 11)
  - `computeNextWork(vault, dir, min, genome?)` from `src/mcp/next-work.js` (Task 8)
- Produces: nothing importable. The deliverable is a failing test whenever the default genome stops being today's behavior.

- [ ] **Step 1: Write the failing test**

Create `test/genome/identity.test.ts`:

```typescript
/**
 * The regression contract, executable.
 *
 * Phase 2 moved every policy governing unknowns out of TypeScript and into
 * `genome.yaml`. The whole move is only legitimate if it changed nothing: with
 * the shipped default genome — and with no `genome.yaml` on disk at all, which
 * is every vault that exists today — the kernel must behave byte-for-byte as it
 * did before. This file is where that claim is checked, once, over the whole
 * surface rather than a gene at a time.
 *
 * The expectation table below is written as a LITERAL rather than derived from
 * the schema. A test that computes its expectation from the thing it is testing
 * agrees with itself under any drift; this one fails loudly the moment a default
 * moves, which is the entire point of pinning it.
 *
 * The classifier and resolution assertions restate the exact body strings from
 * `test/knowledge/unknowns.test.ts` as literals, deliberately: the Phase 1
 * functions may one day be deleted, and this file must keep meaning something
 * after they are. It asserts against strings and expected labels, never against
 * the old implementation.
 *
 * The negative controls are not decoration. Every assertion above them passes
 * against an interpreter that accepts a `genome` argument and ignores it — the
 * genome as data nothing reads, which would be a worse outcome than not
 * extracting it at all, because the harness would then measure a variable that
 * does not vary. Each control mutates one allele and requires the output to
 * move. Precedent: `test/release/examples-allowlist.test.ts:45`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import { computeAttention } from "../../src/eval/attention.js";
import { GenomeSchema, type Genome } from "../../src/genome/schema.js";
import { defaultGenome, genomePath, loadGenome } from "../../src/genome/load.js";
import { classifyUnknown, contractGaps, resolutionState } from "../../src/knowledge/unknowns.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import type { OstNode } from "../../src/ost/node.js";
import { buildPassContext } from "../../src/runner/context.js";
import { initVault } from "../../src/runner/init.js";
import { recordAttention } from "../../src/telemetry/attention.js";
import { usageLogPath } from "../../src/telemetry/usage.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/**
 * The shipped genome, written out by hand. If a schema default moves, this is
 * the first thing that fails — and it is supposed to be edited only when the
 * move is intended.
 */
const SHIPPED: Genome = {
  version: 1,
  tokenWeights: { input: 1, output: 5, cacheCreate: 1.25, cacheRead: 0.1 },
  classifier: {
    contractSections: ["Format", "Methodology", "Rationale"],
    classes: ["bounded", "unreached", "unbounded"],
    fallback: "unbounded",
    rules: [
      { class: "unbounded", present: [], absent: ["Format"] },
      { class: "bounded", present: ["Format", "Methodology"], absent: [] },
      { class: "unreached", present: ["Format"], absent: [] },
    ],
  },
  resolution: {
    answerSection: "Answer",
    fallback: "open",
    rules: [
      { state: "abandoned", status: ["deferred"] },
      { state: "satisfied", status: ["validated"], section: "Answer" },
    ],
  },
  budgets: { sharedPool: null, perClass: {}, onExhaustion: "instruct" },
  pivot: {
    unknownsBlockDone: false,
    maxOpenUnknownsSurfaced: 0,
    ranking: "tree-order",
    classPriority: [],
  },
  attribution: { staleAttribution: "drop" },
  tokenSplit: {
    enabled: false,
    source: "transcript",
    transcriptDir: "",
    method: "proportional-by-calls",
    residual: "unattributed",
    costBasis: "tokens",
  },
};

// The exact fixtures from test/knowledge/unknowns.test.ts and
// test/eval/attention.test.ts, restated as literals.
const FULL = "## Format\na count\n\n## Methodology\nquery the log\n\n## Rationale\nserves [[Outcome]]";
const ROLLUP_FULL = "## Format\na count\n\n## Methodology\nquery\n\n## Rationale\nserves [[O]]";

const unknown = (body: string, extra: Partial<OstNode> = {}): OstNode => ({
  title: "U", layer: "Unknown", tags: [], links: [], body, evidence: "assertion", ...extra,
});

const node = (title: string, body = ROLLUP_FULL, extra: Partial<OstNode> = {}): OstNode => ({
  title, layer: "Unknown", tags: [], links: [], body, evidence: "assertion", ...extra,
});

/** The annotated default genome published in the reference doc. */
function documentedGenomeYaml(): string {
  const md = fs.readFileSync(path.join(REPO, "docs", "reference", "genome.md"), "utf8");
  const match = md.match(/<!-- default-genome -->\s*```yaml\n([\s\S]*?)```/);
  if (!match) throw new Error("docs/reference/genome.md has no `<!-- default-genome -->` yaml block");
  return match[1];
}

describe("the default genome is today's behavior, written down", () => {
  test("the shipped defaults are exactly this table — a drifted schema default fails here first", () => {
    expect(defaultGenome()).toEqual(SHIPPED);
  });

  test("the annotated genome in docs/reference/genome.md parses back to the shipped default", () => {
    // Documentation that drifts from the schema is worse than none: it is the
    // file an operator edits, and a wrong default there is a wrong genome.
    expect(GenomeSchema.parse(parseYaml(documentedGenomeYaml()))).toEqual(SHIPPED);
  });

  test("an absent genome.yaml IS the shipped default — every vault already carries it", () => {
    const dir = tmp("ost-genome-absent-");
    expect(fs.existsSync(genomePath(dir))).toBe(false);
    expect(loadGenome(dir)).toEqual(SHIPPED);
  });

  test("a vault initialised today has no genome.yaml and a pass context carrying the default", async () => {
    const dir = tmp("ost-genome-init-");
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    expect(fs.existsSync(genomePath(dir))).toBe(false);
    expect(buildPassContext(dir).genome).toEqual(SHIPPED);
  });

  test("the interpreter classes every Phase 1 body exactly as the hand-written classifier did", () => {
    const c = defaultGenome().classifier;
    expect(classifyUnknown(unknown(FULL), c)).toBe("bounded");
    expect(classifyUnknown(unknown("## Format\na count\n\n## Rationale\nserves [[Outcome]]"), c)).toBe("unreached");
    expect(classifyUnknown(unknown("## Methodology\nsail west\n\n## Rationale\nserves [[Outcome]]"), c)).toBe("unbounded");
    expect(classifyUnknown(unknown(""), c)).toBe("unbounded");
    expect(classifyUnknown(unknown("## format\nx\n\n## METHODOLOGY\ny"), c)).toBe("bounded");
    expect(classifyUnknown(unknown("we discussed the Format and the Methodology at length"), c)).toBe("unbounded");
  });

  test("the interpreter resolves every Phase 1 state identically, abandonment still first", () => {
    const r = defaultGenome().resolution;
    expect(resolutionState(unknown(FULL), r)).toBe("open");
    expect(resolutionState(unknown(`${FULL}\n\n## Answer\n412 per day`), r)).toBe("satisfied");
    expect(resolutionState(unknown(FULL, { status: "validated" }), r)).toBe("satisfied");
    expect(resolutionState(unknown(FULL, { status: "deferred" }), r)).toBe("abandoned");
    expect(resolutionState(unknown(`${FULL}\n\n## Answer\nx`, { status: "deferred" }), r)).toBe("abandoned");
  });

  test("contract gaps come back in the genome's declared order, not sorted", () => {
    const sections = defaultGenome().classifier.contractSections;
    expect(contractGaps(unknown(""), sections)).toEqual(["Format", "Methodology", "Rationale"]);
    expect(contractGaps(unknown(FULL), sections)).toEqual([]);
  });

  test("the golden rollup by class is unchanged — same five nodes, same ledger, same buckets", async () => {
    const dir = tmp("ost-genome-golden-");
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    recordAttention(dir, {
      ts: "2026-07-27T00:00:00Z", unknown: "Bounded", kind: "spend", calls: 1, ms: 1,
      tokens: { input: 10, output: 0, cacheCreate: 0, cacheRead: 0 },
    });

    const tree = [
      node("Bounded"),
      node("Unreached", "## Format\nx\n\n## Rationale\ny"),
      node("Dark", "no sections here"),
      node("Done", ROLLUP_FULL, { status: "validated" }),
      node("Given up", ROLLUP_FULL, { status: "deferred" }),
    ];

    expect(computeAttention(tree, dir).byClass).toEqual({
      bounded: { count: 3, satisfied: 1, abandoned: 1, open: 1, weightedCost: 10 },
      unreached: { count: 1, satisfied: 0, abandoned: 0, open: 1, weightedCost: 0 },
      unbounded: { count: 1, satisfied: 0, abandoned: 0, open: 1, weightedCost: 0 },
    });
    // Passing the default genome explicitly must be indistinguishable from not passing it.
    const g = defaultGenome();
    expect(computeAttention(tree, dir, { weights: g.tokenWeights, classifier: g.classifier, resolution: g.resolution }).byClass)
      .toEqual(computeAttention(tree, dir).byClass);
  });

  test("unattributed spend is unchanged, a stale marker is still DROPPED, and the basis is calls-and-ms", async () => {
    const dir = tmp("ost-genome-unattributed-");
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    fs.mkdirSync(path.dirname(usageLogPath(dir)), { recursive: true });
    fs.writeFileSync(usageLogPath(dir), [
      JSON.stringify({ ts: "a", tool: "ost_read_tree", ok: true, ms: 5, surface: "mcp", argBytes: 0 }),
      JSON.stringify({ ts: "b", tool: "ost_read_tree", ok: true, ms: 7, surface: "mcp", argBytes: 0, unknown: "Bounded" }),
      JSON.stringify({ ts: "c", tool: "ost_read_tree", ok: true, ms: 11, surface: "mcp", argBytes: 0, unknown: "Ghost" }),
    ].join("\n"), "utf8");

    const rollup = computeAttention([node("Bounded")], dir);
    expect(rollup.unattributed).toEqual({
      calls: 1, ms: 5, tokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
    });
    expect(rollup.unknowns[0].calls).toBe(1);
    expect(rollup.unknowns[0].ms).toBe(7);
    // tokenSplit is off, so nothing correlates: cost is still the ledger's zero.
    expect(rollup.unknowns[0].tokens).toEqual({ input: 0, output: 0, cacheCreate: 0, cacheRead: 0 });
    // `costBasis` reports what the rollup actually RECEIVED, not what the genome
    // would prefer. No `correlated` map reached it — under the default genome the
    // correlator never runs — so the record says calls and wall-clock, which is
    // exactly the design's stated fallback: "If transcript correlation is
    // unavailable, cost falls back to calls and wall-clock, and the record says so."
    expect(rollup.costBasis).toBe("calls-and-ms");
  });

  test("ost_next_work offers the same darkness, with or without a genome argument", async () => {
    const dir = tmp("ost-genome-nextwork-");
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    const ctx = buildPassContext(dir);
    ctx.vault.createNode({
      title: "How many users hit the export path",
      layer: "Unknown",
      body: "## Format\na count per day\n\n## Rationale\nserves [[Retention]]",
      tags: [], links: [], evidence: "assertion",
    });
    ctx.vault.linkNodes("Retention", "How many users hit the export path");

    const fresh = buildPassContext(dir);
    const implicit = computeNextWork(fresh.vault, dir, 1);
    const explicit = computeNextWork(fresh.vault, dir, 1, defaultGenome());

    expect(implicit.openUnknowns).toEqual([{
      title: "How many users hit the export path",
      klass: "unreached",
      darkens: "Retention",
      gaps: ["Methodology"],
    }]);
    expect(explicit.openUnknowns).toEqual(implicit.openUnknowns);
    expect(explicit.summary).toBe(implicit.summary);
  });

  test("an open unknown still does NOT block done — the default genome never pivots", async () => {
    const dir = tmp("ost-genome-done-");
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    const ctx = buildPassContext(dir);
    ctx.vault.createNode({
      title: "What is out there", layer: "Unknown", body: "nothing declared at all",
      tags: [], links: [], evidence: "assertion",
    });
    ctx.vault.linkNodes("Retention", "What is out there");

    const work = computeNextWork(buildPassContext(dir).vault, dir, 1, defaultGenome());
    expect(work.openUnknowns).toHaveLength(1);
    expect(work.openUnknowns[0].klass).toBe("unbounded");
    expect(work.done).toBe(true);
  });

  describe("negative controls — a mutated allele has to SHOW, or the genome is data nothing reads", () => {
    test("doubling the input weight doubles the weighted cost", async () => {
      const dir = tmp("ost-genome-nc-weights-");
      await initVault(dir, "Reach 10,000 daily active users", "Retention");
      recordAttention(dir, {
        ts: "a", unknown: "Bounded", kind: "spend", calls: 1, ms: 1,
        tokens: { input: 10, output: 0, cacheCreate: 0, cacheRead: 0 },
      });
      const tree = [node("Bounded")];
      expect(computeAttention(tree, dir).unknowns[0].weightedCost).toBe(10);
      expect(
        computeAttention(tree, dir, { weights: { input: 2, output: 5, cacheCreate: 1.25, cacheRead: 0.1 } })
          .unknowns[0].weightedCost,
      ).toBe(20);
    });

    test("dropping the unreached rule collapses three classes into two, buckets and all", async () => {
      // The design's own least-settled item: "`unreached` may not earn its own
      // class… the v1 classifier has two classes, not three." A genome that
      // cannot express that allele has not been extracted.
      const dir = tmp("ost-genome-nc-classifier-");
      await initVault(dir, "Reach 10,000 daily active users", "Retention");
      const twoClass = {
        contractSections: ["Format", "Methodology", "Rationale"],
        classes: ["bounded", "unbounded"],
        fallback: "unbounded",
        rules: [
          { class: "unbounded", present: [], absent: ["Format"] },
          { class: "bounded", present: ["Format", "Methodology"], absent: [] },
        ],
      };
      const tree = [
        node("Bounded"),
        node("Unreached", "## Format\nx\n\n## Rationale\ny"),
        node("Dark", "no sections here"),
      ];
      expect(classifyUnknown(tree[1], twoClass)).toBe("unbounded");
      const byClass = computeAttention(tree, dir, { classifier: twoClass }).byClass;
      expect(Object.keys(byClass).sort()).toEqual(["bounded", "unbounded"]);
      expect(byClass.unbounded.count).toBe(2);
      expect(byClass.bounded.count).toBe(1);
    });

    test("reversing resolution precedence moves a node from abandoned to satisfied", async () => {
      // The resolution gene is threaded into computeAttention by Task 5, and a
      // rollup that ignored it would still satisfy every assertion above: the
      // default order and the default fixtures agree by construction. So mutate
      // the one thing the default asserts loudest — that a human's `deferred`
      // outranks a drafted answer — and require the bucket to MOVE.
      const dir = tmp("ost-genome-nc-resolution-");
      await initVault(dir, "Reach 10,000 daily active users", "Retention");
      const tree = [node("Given up", `${ROLLUP_FULL}\n\n## Answer\n412 per day`, { status: "deferred" })];

      const before = computeAttention(tree, dir).byClass;
      expect(before.bounded.abandoned).toBe(1);
      expect(before.bounded.satisfied).toBe(0);

      // Answer-first: a drafted answer now outranks the deferral.
      const answerFirst = {
        answerSection: "Answer",
        fallback: "open",
        rules: [
          { state: "satisfied", section: "Answer" },
          { state: "abandoned", status: ["deferred"] },
        ],
      };
      expect(resolutionState(tree[0], answerFirst)).toBe("satisfied");
      const after = computeAttention(tree, dir, { resolution: answerFirst }).byClass;
      expect(after.bounded.satisfied).toBe(1);
      expect(after.bounded.abandoned).toBe(0);
    });

    test("flipping staleAttribution surfaces the ghost spend the default drops", async () => {
      const dir = tmp("ost-genome-nc-stale-");
      await initVault(dir, "Reach 10,000 daily active users", "Retention");
      fs.mkdirSync(path.dirname(usageLogPath(dir)), { recursive: true });
      fs.writeFileSync(usageLogPath(dir), [
        JSON.stringify({ ts: "a", tool: "ost_read_tree", ok: true, ms: 5, surface: "mcp", argBytes: 0 }),
        JSON.stringify({ ts: "c", tool: "ost_read_tree", ok: true, ms: 11, surface: "mcp", argBytes: 0, unknown: "Ghost" }),
      ].join("\n"), "utf8");

      const tree = [node("Bounded")];
      expect(computeAttention(tree, dir).unattributed.ms).toBe(5);
      expect(
        computeAttention(tree, dir, { attribution: { staleAttribution: "unattributed" } }).unattributed,
      ).toEqual({ calls: 2, ms: 16, tokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } });
    });

    test("flipping unknownsBlockDone makes darkness block done", async () => {
      const dir = tmp("ost-genome-nc-pivot-");
      await initVault(dir, "Reach 10,000 daily active users", "Retention");
      const ctx = buildPassContext(dir);
      ctx.vault.createNode({
        title: "What is out there", layer: "Unknown", body: "nothing declared at all",
        tags: [], links: [], evidence: "assertion",
      });
      ctx.vault.linkNodes("Retention", "What is out there");

      const vault = buildPassContext(dir).vault;
      const g = defaultGenome();
      expect(computeNextWork(vault, dir, 1, g).done).toBe(true);
      expect(
        computeNextWork(vault, dir, 1, { ...g, pivot: { ...g.pivot, unknownsBlockDone: true } }).done,
      ).toBe(false);
    });

    test("a misspelled allele THROWS while the correct spelling takes effect", () => {
      // The strict-schema contract, both directions. Without the second half a
      // loader that ignored the file entirely would pass the first half.
      const bad = tmp("ost-genome-nc-typo-");
      fs.writeFileSync(genomePath(bad), "tokenWeigths:\n  input: 2\n", "utf8");
      expect(() => loadGenome(bad)).toThrow(/genome\.yaml/);

      const good = tmp("ost-genome-nc-typo-ok-");
      fs.writeFileSync(genomePath(good), "tokenWeights:\n  input: 2\n", "utf8");
      expect(loadGenome(good).tokenWeights.input).toBe(2);
      expect(loadGenome(good).tokenWeights.output).toBe(5);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/genome/identity.test.ts`

Expected: FAIL — `Error: docs/reference/genome.md has no \`<!-- default-genome -->\` yaml block` from the documented-genome test (the doc does not exist yet), and `ENOENT … docs/reference/genome.md` where the read precedes it. Every other test in the file must already be PASSING at this point: Tasks 1–13 built the behavior; if any of them fail here, the failure is real and belongs to that task, not to this one. **Do not weaken an assertion to make it green** — the golden rollup and the `byClass` key set are the specification. In particular, if `Object.keys(byClass).sort()` returns three keys under the two-class allele, `emptyByClass` in `src/eval/attention.ts` is still seeded from `UNKNOWN_CLASSES` rather than from `classifier.classes`; fix Task 11's implementation, not this test.

- [ ] **Step 3: Write the documentation**

Create `docs/reference/genome.md`:

````markdown
# The genome — the policy OST-Agent can breed

`genome.yaml` is the declarative policy the kernel interprets when it handles what it does
not know. It sits at the **vault root, beside `ost.config.yaml`**, and it is **optional**:
an absent `genome.yaml` *is* the default printed at the bottom of this page, which is why
`ost-agent init` deliberately never writes one. There is exactly one source of truth for
the defaults — the zod schema in `src/genome/schema.ts` — and a test in
`test/genome/identity.test.ts` fails if this document drifts from it.

## What an allele is

An **allele** is one value of one gene: a number, a rule list, a policy name. The
evolutionary harness (Phase 3) varies alleles, runs the variant in an environment, and
measures what varied. So the whole file answers a single design rule, which is worth
stating bluntly because it is easy to violate by accident:

> **Anything compiled in is a trait excluded from evolution. A policy expressed as a
> TypeScript table cannot breed.**

`DEFAULT_TOKEN_WEIGHTS` was readable, parameterised, well-factored — and inert, because
nothing could vary it and record what varying it bought. Moving it here is what makes the
cost model a measurable hypothesis instead of an assumption.

Two consequences follow from the same rule:

- **The schema is `.strict()`.** `ost.config.yaml` *strips* undeclared keys on purpose, so
  a vault written before a config field existed keeps loading. A genome has no legacy
  vaults to protect, and it is the artifact a harness mutates. A misspelled allele silently
  dropped would read as *"behaviour unchanged"* — the one failure mode that corrupts a
  fitness record without announcing itself. A typo throws.
- **Absent means default; malformed means stop.** `loadGenome` returns the shipped default
  for a file that is not there, and raises for a file that is there and wrong — the same
  rule `src/config/load.ts` keeps: a broken file is a mistake to report, not a state to
  tolerate.

## What is deliberately NOT evolvable

The genome contains policy. It does not contain the fail-closed mechanisms, and the
distinction is not squeamishness — it is a measurement argument. **A variant able to relax
any of these would score well by corrupting the instrument rather than by being better**,
and a harness cannot tell those two apart from the fitness number alone.

| Mechanism | Where it lives | Why it can never be an allele |
|---|---|---|
| **The tool allowlist** | `ALLOWED_TOOL_NAMES`, `src/security/policy.ts`; `assertNoDestructiveTool` | The closed set of capabilities OST-Agent may ever hold. A genome that could add a name is a genome that could add `rm`. Phase 2 added no tool: `OST_UNKNOWN` rides an optional argument on tools that already exist. |
| **The lane gate** | `LANES`, `computeMayRun`, `CAUTIOUS_LANE`, `src/knowledge/lanes.ts`; `flagHumansRequired`, `src/ost/lanes.ts` | Exactly one lane carries `computeMayRun: true`, and `computeMayRun` fails closed on an unknown, missing, or future id. The lane setter is restrictive-only *by having no lane parameter* — the absence of the parameter is the safety argument, and a genome cannot supply what the signature does not accept. |
| **The invariant checker** | `checkInvariants`, `src/eval/invariants.ts` | Structural truths, model-independent. `no-self-validation` is the rule that stops a variant declaring its own genome validated. |
| **The SSRF guard** | `assertAllowedUrl`, `isPrivateIpv4`, `MAX_REDIRECTS`, `src/web/guard.ts` | Outward sensing crosses a trust boundary exactly once. `TIMEOUT_MS` and `MAX_PAGE_CHARS` are arguably cost parameters, but they sit inside the guard and extracting them risks loosening it by adjacency. All three stay. |
| **The believability floor** | `FLOOR_RUNG`, `src/knowledge/believability.ts`; `HOST_RUNGS`, `src/knowledge/web-trust.ts` | Anything unjustified sinks to `assertion`, and `expert` is the ceiling a byline can ever earn. Promoting a web page to first-party-measurement strength is the same category error as self-validation. |
| **The promotion gate** | `gateSolution`, `hasRecordedResult`, `src/eval/evidence-debt.ts` | Phase 3 runs genome candidates *through* this gate as `#Solution` + `#AssumptionTest`. Extracting the referee into the thing being refereed is the category error the whole design is built to avoid. |

Also compiled in, for the same family of reasons: `CHILD_HIERARCHY` (tree grammar — a
genome that rewrote it produces trees `checkInvariants` rejects, i.e. crashed runs rather
than measured ones), `SECRET_PATTERNS` (a narrowed table leaks credentials into a committed
vault), the append-only, fail-open ledger writes, and `OST_RULESET` — which is distilled
Torres canon and safety rules, not unknown-handling policy.

Two live numbers stay **operator knobs in `ost.config.yaml`**, not alleles:
`processes.P3_ideate.minSolutionsPerOpportunity`, and `web.lookupBudget`. The second is the
one worth naming: `budgets.sharedPool` below defaults to `null`, meaning *"use the
operator's configured number."* Only an explicit non-null value overrides it. Two numbers
that can silently disagree is a worse artifact than one number with a documented override.

## The default genome, annotated

This is the file. Copy it to your vault root only if you intend to change something;
otherwise leave it absent and get exactly this.

<!-- default-genome -->
```yaml
# OST-Agent genome — the policy the kernel interprets.
#
# Everything here is an ALLELE: a value the evolutionary harness may vary and
# measure. Anything NOT here is a trait excluded from evolution, deliberately —
# see "What is deliberately NOT evolvable" above.
#
# This file is optional. An absent genome.yaml IS this file.

version: 1

# What attention costs. Ratios, not currency — output is the dear one, a cache
# write costs a little more than fresh input, a cache read roughly a tenth.
# Weighting is applied at READ time so the four tiers stay unmixed in storage.
tokenWeights:
  input: 1
  output: 5
  cacheCreate: 1.25
  cacheRead: 0.1

# How darkness is classed. Rules are first-match-wins; `fallback` is the floor.
# `contractSections` order is load-bearing: it is the order contractGaps reports.
classifier:
  contractSections: [Format, Methodology, Rationale]
  classes: [bounded, unreached, unbounded]
  fallback: unbounded
  rules:
    - { class: unbounded, present: [], absent: [Format] }
    - { class: bounded, present: [Format, Methodology], absent: [] }
    - { class: unreached, present: [Format], absent: [] }

# How an unknown terminates. Order IS precedence: abandonment is checked first,
# so a human's `deferred` outranks a drafted answer. A rule with neither a
# `status` list nor a `section` probe is a schema error — satisfaction may never
# be claimed on the absence of evidence.
resolution:
  answerSection: Answer
  fallback: open
  rules:
    - { state: abandoned, status: [deferred] }
    - { state: satisfied, status: [validated], section: Answer }

# How much looking outward one session may do. `sharedPool: null` means "use the
# operator's `web.lookupBudget` from ost.config.yaml"; a number here overrides
# it. `perClass: {}` means one shared, class-blind counter — today's behavior.
budgets:
  sharedPool: null
  perClass: {}
  onExhaustion: instruct

# What the loop does with darkness. v1 never pivots: exploration is reported,
# never blocks `done`, and is offered in tree order. An unbounded unknown has no
# stopping condition, so counting it toward completion would wedge every pass.
pivot:
  unknownsBlockDone: false
  maxOpenUnknownsSurfaced: 0
  ranking: tree-order
  classPriority: []

# What happens to a spend marker naming a title no longer on the tree.
attribution:
  staleAttribution: drop

# How one Claude Code session's tokens divide across the unknowns it touched.
# OFF in v1: the correlator ships tested, but nothing correlates tokens under
# the default genome, so cost stays exactly what it was. `costBasis` is written
# onto every rollup so a comparison that mixes bases can be refused rather than
# silently normalized.
tokenSplit:
  enabled: false
  source: transcript
  transcriptDir: ""
  method: proportional-by-calls
  residual: unattributed
  costBasis: tokens
```
````

Add one line to `README.md`, immediately after the `docs/reference/evaluating-ost-agent.md` paragraph (around line 311), before the closing "The one constant across both eras" paragraph:

```markdown
The policy governing how the agent handles what it does *not* know — and the fail-closed
mechanisms deliberately excluded from it — is documented in
[`docs/reference/genome.md`](docs/reference/genome.md).
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/genome/identity.test.ts`
Expected: PASS — 17 tests.

Then the whole suite: `npm test`. Expected: PASS, every file.

- [ ] **Step 5: Write the CHANGELOG entry and bump the version**

`test/release/version.test.ts` pins `package.json`, `src/index.ts`'s `VERSION`, and
`.claude-plugin/plugin.json` to the same string, and a recent commit exists purely to
re-sync the lockfile — so the bump is four files or it is a red suite.

```bash
npm version 0.23.0 --no-git-tag-version   # package.json + package-lock.json
```

Then edit `src/index.ts` line 8 to `export const VERSION = "0.23.0";` and
`.claude-plugin/plugin.json`'s `"version"` to `"0.23.0"`.

Add to the top of `CHANGELOG.md`, immediately under `# Changelog` and above `## 0.22.0`:

```markdown
## 0.23.0

- **Every policy governing what OST-Agent does with what it cannot see is now data, and
  the default data is byte-for-byte the old code.** The previous release gave darkness a
  node, an append-only ledger and an attributed cost. What to *do* with it stayed a set of
  TypeScript constants: a three-branch classifier, a resolution state machine, a lookup
  counter, a token weighting. Each was parameterised and well-factored, and each was inert
  — a constant is a trait excluded from evolution, so nothing could vary the cost model and
  record what varying it bought. **A policy expressed as a TypeScript table cannot breed.**

  Those policies now live in an optional `genome.yaml` at the vault root, beside
  `ost.config.yaml`, which the kernel interprets. `init` deliberately never writes one:
  an absent file *is* the shipped default, so no vault that exists today changes behaviour
  and none acquires a file it did not ask for. There is exactly one source of truth for the
  defaults — the zod schema — with the annotated copy in `docs/reference/genome.md` held to
  it by a test, because a documented default that has drifted is the file an operator edits.

  The schema is **`.strict()`**, deliberately unlike `ost.config.yaml`, which strips
  undeclared keys so a pre-runner vault keeps loading. A genome has no legacy vaults to
  protect and it is the artifact a harness mutates: a misspelled allele silently dropped
  reads as *"behaviour unchanged"*, which is the one failure mode that corrupts a fitness
  record without announcing itself. A typo throws and names the field.

  Two numbers stay where an operator can reach them rather than becoming alleles.
  `web.lookupBudget` remains the operator's, and `budgets.sharedPool` defaults to `null`
  meaning *use it* — because the alternative is two numbers in two files that can silently
  disagree, and the honest failure of that arrangement is that neither is wrong. Token
  correlation ships whole and tested but `tokenSplit.enabled` defaults to `false`, so under
  the default genome nothing correlates and cost stays exactly what it was; every rollup now
  carries the `costBasis` it was computed on, so a comparison that mixes bases can be refused
  rather than quietly normalized.

  The refactor claim is made executable rather than asserted. `test/genome/identity.test.ts`
  pins the shipped defaults as a hand-written table, replays the Phase 1 classifier and
  resolution fixtures against the interpreter *as literals* so the old functions can be
  deleted without the test going hollow, and deep-equals a golden per-class rollup and the
  `ost_next_work` output. Five of those six checks pass perfectly well against an interpreter
  that accepts a genome and ignores it — which would be worse than not extracting anything,
  since the harness would then be measuring a variable that does not vary. So the suite ends
  with negative controls: doubling the input weight must double the cost, deleting the
  `unreached` rule must collapse three buckets into two, reversing resolution precedence must
  move a deferred-but-answered unknown from abandoned to satisfied, flipping `staleAttribution`
  must surface the ghost spend the default drops, and `unknownsBlockDone` must actually block.
  The same anti-vacuity guard the examples-allowlist test already carries.

  Nothing was added to the tool surface. `OST_UNKNOWN` is declared as an optional argument
  on tools that already exist; `ALLOWED_TOOL_NAMES` is unchanged at 20 names. The allowlist,
  the lane gate, the invariant checker, the SSRF guard, the believability floor and the
  promotion gate are all documented as permanently outside the genome, with the reason
  stated: a variant able to relax any of them would score well by corrupting the instrument
  rather than by being better, and a fitness number cannot tell those two apart.
```

- [ ] **Step 6: Run the full suite once more and commit**

Run: `npm test && npm run build`
Expected: PASS. `test/release/version.test.ts`'s two tests are the check on Step 5's bump.

```bash
git add test/genome/identity.test.ts docs/reference/genome.md README.md CHANGELOG.md \
        package.json package-lock.json src/index.ts .claude-plugin/plugin.json
git commit -m "docs(genome): write down which policies may breed, and prove the default is today"
```

---

## Verification

After Task 14, confirm the whole phase. Each item is a command with an expected reading — record the reading, do not infer it.

- [ ] **`npm test` — green, and grown.** Baseline before Phase 2: **69 files, 583 tests**.
      Phase 2 adds exactly six new test files — `test/genome/load.test.ts`,
      `test/genome/threading.test.ts`, `test/mcp/attribution.test.ts`, `test/eval/correlate.test.ts`,
      `test/genome/identity.test.ts`, `test/skill/open-unknowns.test.ts` — plus appended `describe`
      blocks in existing suites. Expect **69 → 75 files**, and a test total that is a **floor, not
      a target**: 583 baseline plus the tests these six files and the appended blocks add — no
      previously passing test may go red. The identity suite alone contributes 17 of them. If your
      local baseline reads 70/584, apply the same deltas — what matters is that the count **grew
      and nothing was removed**.
- [ ] **No pinned assertion was deleted or loosened.** `git diff main -- test/` must show zero
      removals among: `weightedTokenCost(tiers, {...DEFAULT_TOKEN_WEIGHTS, input: 2})).toBe(20)`
      (`test/eval/attention.test.ts:33`), `expect(DEFAULT_LOOKUP_BUDGET).toBe(10)`
      (`test/web/budget.test.ts:29`), the ordered `contractGaps(...)).toEqual(["Format","Methodology","Rationale"])`
      (`test/knowledge/unknowns.test.ts:58`), `work.done).toBe(true)` with an open unbounded unknown
      (`test/mcp/next-work.test.ts:129-137`), `expect(FLOOR_RUNG).toBe("assertion")`
      (`test/runner/init.test.ts:35`), and `fs.readdirSync(dir)).toEqual([])`
      (`test/mcp/setup-mode.test.ts:65`, `test/mcp/bootstrap.test.ts:120`). Each is a guard, not
      an incidental shape. A green suite achieved by editing one of these is not a green suite.
- [ ] **`test/telemetry/attention.test.ts` (10 tests) and `test/adapters/tokens.test.ts` (7 tests)
      are unchanged.** They carry zero policy content and are the genome-independent floor. If
      Phase 2 had to touch either, policy leaked into the store — find it before merging.
- [ ] **`npm run build`** — clean `tsc`, no new errors. `UnknownClass` widened to `string`, so
      watch for exhaustiveness assumptions that compiled only against the literal union.
- [ ] **The allowlist did not grow.**
      ```bash
      node --input-type=module -e "import {ALLOWED_TOOL_NAMES} from './dist/security/policy.js'; console.log(ALLOWED_TOOL_NAMES.length)"
      ```
      Expected: **20** — identical to before Phase 2. `npx vitest run test/security/policy.test.ts`
      is the same check with the exact sorted names, and must be green. `OST_UNKNOWN` arrives on an
      optional argument of an existing tool; if this number moved, the mechanism was implemented the
      wrong way and the design's first non-negotiable is broken.
- [ ] **A vault with no `genome.yaml` is still a vault with no `genome.yaml`.** After running
      `ost-agent init` into a temp dir and then a full `/ost-pass`, `ls` the vault root: there must
      be no `genome.yaml`. Absent-means-default is the property that keeps one source of truth for
      the defaults; a scaffolded copy re-introduces the drift `defaultConfigYaml` already demonstrates.
- [ ] **`npm run bundle`** — `dist/ost-agent.mjs` rebuilds. It is the artifact the plugin actually
      launches, and a missing `.js` specifier in `src/genome/` or `src/eval/correlate.ts` compiles
      under `tsc` and fails only here or at runtime.
