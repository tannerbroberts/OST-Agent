# Harness and Environments Implementation Plan (Phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic, model-free evolutionary harness the design's Phase 3 names — a generator that plants vault environments with an answer key, a runner that executes one genome against one environment, and a fitness computation over the resulting ledger — so a genome variant can be scored without a human or a model in the loop.

**Architecture:** A new `src/harness/` module owns the whole loop, and it is *repo tooling*, not a tool: `scripts/harness.ts` is a thin `main()` over exported pure functions in `src/`, run via `npm run harness`, exactly the shape `scripts/gen-skill.ts` established. An **environment** is an `EnvironmentSpec` (declarative, seeded, deterministic) materialised into a fresh `mkdtemp` vault; the **answer key** is the spec itself and never touches the vault directory. A **run** writes a genome variant, builds a pass context, drives the real kernel (`computeNextWork`, the classifier/resolution/budget interpreters), emits real usage-trace and attention-ledger entries, synthesises a Claude Code transcript, and hands it to the **real `correlateTokens`** — so the `tokenSplit` gene is exercised by production code rather than by a harness reimplementation. **Fitness** is computed from the resulting `AttentionRollup` plus the answer key, normalised per environment, weighted 1:1, and appended to `.ost-agent/harness/runs.jsonl`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod v3, the `yaml` package (now also for `stringify`), vitest. **No new dependencies** — including no seeded-RNG package; the PRNG is hand-written.

---

## Decisions taken before implementation

These are settled. A task that contradicts one is wrong, not creative. D1–D8 were resolved by the Phase 3 readiness audit (2026-07-28); the reasoning is preserved because each one forecloses a plausible and expensive mistake.

- **D1 — Link direction is settled: the darkened node carries the edge.** The parent holds `[[Unknown title]]`; the unknown links to nothing. `computeNextWork` resolves `darkens` as `tree.find((p) => p.layer !== "Unknown" && p.links.includes(u.title))` (`src/mcp/next-work.ts:199`), pinned by `test/mcp/next-work.test.ts:120`. **The generator must emit this direction.** The reverse produces `darkens: null` for every planted unknown and degrades every coverage metric silently, without erroring. The spec was amended to match in `ca3f9bf`.

- **D2 — A run is a programmatic, MODEL-FREE kernel invocation.** No API-key runner (that was deleted in `16926b8` as a BREAKING CHANGE and is not coming back), and no `claude -p` subprocess. Every gene in `Genome` is deterministic policy over vault data; none needs a model to observe its effect. The decisive argument is statistical, not architectural: with a model in the loop its stochasticity becomes the dominant variance term and swamps every gene effect at any *n* we can afford — which is precisely the "confident garbage" failure the design names at its `Least-settled` section. A deterministic runner also makes the whole harness reproducible byte-for-byte, which is the house definition of determinism (`scripts/gen-skill.ts` header: "no dates, no randomness, stable ordering").

- **D3 — The two fitness terms.** *Orientation speed* is **weighted cost-to-resolve** (`UnknownAttention.weightedCost`), **not wall-clock** — under a deterministic runner wall-clock measures the harness machine, not the policy. *Observation quality* is **agreement with the environment's answer key**, which lives outside the vault. **`resolutionState` is not fitness**: `src/knowledge/unknowns.ts` calls itself "a floor, not a verdict", and a `## Answer` heading is one allowlisted `ost_append_to_node` away — scoring on it would let a run mark its own homework. Both terms are normalised per environment so a 3-unknown vault is comparable to a 10-unknown one, and a run that resolves nothing scores `0`, never `undefined`.

- **D4 — Fitness weighting is pinned at 1:1 and is NOT a gene in Phase 3.** The design lists it as unspecified and as a candidate gene; breeding it in v1 is unidentifiable, because the weight and the genes it weights are confounded in a single fitness scalar. It ships as `FITNESS_WEIGHTS`, is stamped into every fitness record, and is revisited in Phase 4. The spec was amended to say so in `ca3f9bf`.

- **D5 — Tokens reach the rollup through `correlated`, never through the ledger alone.** `resolveCostBasis` (`src/eval/attention.ts:263-266`) returns `"calls-and-ms"` whenever `opts.correlated` is `undefined`, *regardless* of what is in the ledger. So a harness that wrote tokens only via `recordAttention` would produce a token-derived `weightedCost` wearing a `calls-and-ms` label — a fitness record that lies about its own basis. The harness therefore synthesises a transcript and calls the **real `correlateTokens`**, then maps its result onto `AttentionOptions`. Two consequences the implementer must hold: the ledger and `correlated` are **additive** (`src/eval/attention.ts:331-349`), so the same tokens must never be supplied by both routes; and `rollup.costBasis` — never `genome.tokenSplit.costBasis` — is the only authority a comparison may read.

- **D6 — Fitness records live in a sidecar the agent's tool surface cannot write:** `.ost-agent/harness/runs.jsonl`. They are **not** written as `#Solution` + `#AssumptionTest` nodes in Phase 3. `hasRecordedResult` (`src/eval/evidence-debt.ts:37-40`) clears on `status === "validated"` **or** a literal `## Results` heading, and both are reachable from the allowlist via `ost_set_status` and `ost_append_to_node` — so a tree-native fitness record would let a refereed run mark its own benchmark recorded. The design's tree-native selection is Phase 4 work, written through the human/CLI path (`recordResult`, `src/ost/results.ts`, deliberately off the MCP surface).

- **D7 — A null environment is seeded with unknowns whose answers are findable in no channel. It is never an empty vault.** An empty vault has no `Unknown` layer at all, the rollup is empty, and the mandatory guard passes vacuously — the worst possible outcome for the one test the design added specifically to stop selection for hyperactive exploration. "Exploration spend" is defined concretely as **total `weightedCost` across all unknowns**.

- **D8 — `pivot.ranking: "cost-to-resolve"` is implemented in this phase (Task 9), before any sampling.** It currently parses but no-ops: `rankOpenUnknowns` opens with `if (pivot.ranking !== "class-priority") return open;` (`src/mcp/next-work.ts:139-146`). Sampling a three-valued gene where one value cannot vary burns a third of that gene's population on a degenerate variant, and Phase 4's decomposition would read it as a confirmed-null gene.

- **D9 — Do not merge `main` before or during Phase 3.** `main` currently carries literal conflict markers at `main:src/cli/index.ts:103,129,320,365` and does not compile. This branch holds the strictly-superseding version of every conflicted file. Integration is a landing-time problem, after Phase 4.

## Global Constraints

- **The allowlist does not grow, and the harness is not a tool.** `ALLOWED_TOOL_NAMES` (`src/security/policy.ts:12`) stays exactly 20 names. This is enforced by three tests (`test/mcp/attribution.test.ts:172` pins the length; `test/security/policy.test.ts:26-49` pins the sorted literal; `test/security/policy.test.ts:73` pins that `buildOstTools` matches) plus a runtime assert at `src/mcp/server.ts:107`. It is also enforced by construction: `DESTRUCTIVE_TOKENS` (`src/security/policy.ts:54-60`) contains `run`, `exec`, `spawn`, `eval`, `system`, so `ost_run_generation`, `ost_eval_fitness` and friends throw on tokenization. The security model already forecloses the alternative — the harness *has* to be repo tooling.

- **These remain not-genes, and no task may make them configurable.** Unchanged from Phase 2: `ALLOWED_TOOL_NAMES`, `DESTRUCTIVE_TOKENS`/`assertNoDestructiveTool`, `LANES`/`computeMayRun`/`CAUTIOUS_LANE`, `flagHumansRequired`'s absent lane parameter, `checkInvariants`, `gateSolution`/`hasRecordedResult`, `recordResult`/`VERDICTS`, `setOutcome`, `SECRET_PATTERNS`/`redactSecrets`, `assertAllowedUrl`/`isPrivateIpv4`/`MAX_REDIRECTS`, `HOST_RUNGS`, `FLOOR_RUNG`, `CHILD_HIERARCHY`, `OST_RULESET`, and the append-only fail-open ledger writes. **Phase 3 adds one to the list: `FITNESS_WEIGHTS` (D4).** A harness that could breed its own scoring function would select for variants that game the scorer.

- **Determinism is byte-level.** No `new Date()`, no `Math.random()`, no `Object.keys` ordering assumptions anywhere in `src/harness/`. Timestamps come from the spec or from an explicit `startedAt` argument; randomness comes from the seeded PRNG in Task 3. This is the same contract `scripts/gen-skill.ts` states in its header, and Task 10's drift test enforces it.

- **Append-only.** No function in this plan deletes, truncates, or rewrites a file. The one exception is `fs.rmSync` on a `mkdtemp` directory the harness itself created, which is cleanup, not mutation of anything owned.

- **Fail-open telemetry stays fail-open.** `recordAttention` and `recordUsageEvent` never throw, by contract. The harness must therefore treat an absent or short log as a real signal, never assume completeness — a swallowed write is silently missing data, not an error.

- **Answer keys never touch the vault directory.** The key lives on the in-memory `EnvironmentSpec` and in the harness sidecar. The design names answer-key leakage as an error mode with a required detection: a key-material scan over ingested evidence, with affected runs excluded and reported (Task 6, step 7).

- **ESM imports** carry the `.js` extension (e.g. `../genome/load.js`). Type-only imports use `import type`; mixed value+type uses the inline `type` form, e.g. `import { addTiers, emptyTiers, type TokenTiers } from "../telemetry/attention.js";`.

- **`tsc` does not type-check `scripts/`.** `tsconfig.json` has `"include": ["src/**/*"]` and `"rootDir": "src"` — verified: `npx tsc --noEmit --listFiles | grep -c "scripts/"` is `0`. Therefore **all real logic lives in `src/harness/` and `scripts/harness.ts` is a thin `main()`**. This is not a style preference; it is the difference between the harness being type-checked by CI and not.

- **Tests** live under `test/<mirror of src path>.test.ts`, use `import { describe, expect, test } from "vitest"` (never `it`, never `vi`), and use hand-written fixtures — the suite contains zero `vi.mock`, zero `vi.fn`, zero snapshots. Temp dirs are always `fs.mkdtempSync(path.join(os.tmpdir(), "ost-<area>-"))`.

- **`npm run bundle` must be re-run and committed** in the same change as any edit to a file reachable from `src/cli/index.ts`. CI's `bundle-drift` job fails on a stale `dist/ost-agent.mjs`. Task 9 edits `src/mcp/next-work.ts`, which *is* in that graph.

- Run the full suite with `npm test` and the compile with `npm run build`. **Baseline before this plan: 75 files, 738 tests passing, `tsc` clean, at commit `ca3f9bf`.**

## File Structure

| File | Responsibility |
|---|---|
| `src/genome/write.ts` *(new)* | The variant write path: `serializeGenome`, `validateGenome`, `writeGenome`. The only place a `Genome` becomes bytes. |
| `src/harness/random.ts` *(new)* | A hand-written seeded PRNG. No dependency, no global state, explicit state threading. |
| `src/harness/spec.ts` *(new)* | `EnvironmentSpec` + zod schema + the answer key type. Pure data; imports nothing but zod. |
| `src/harness/generate.ts` *(new)* | Materialise a spec into a fresh vault directory; and `makeSpec(seed, params)` for generated environments. |
| `src/harness/transcript.ts` *(new)* | Synthesise a Claude Code session JSONL positioned against the run's tool windows, so the real correlator has something real to read. |
| `src/harness/run.ts` *(new)* | One genome × one environment ⇒ one `RunRecord`. Drives the kernel; owns crash classification. |
| `src/harness/fitness.ts` *(new)* | `FITNESS_WEIGHTS`, `computeFitness`, and the cross-basis comparison refusal. |
| `src/harness/record.ts` *(new)* | Append-only `.ost-agent/harness/runs.jsonl`. Fail-open, like every other ledger write. |
| `src/harness/environments.ts` *(new)* | The built-in hand-authored specs, including the mandatory null environments. |
| `src/mcp/next-work.ts` | Task 9 only: `pivot.ranking: "cost-to-resolve"` stops being degenerate. |
| `scripts/harness.ts` *(new)* | Thin `main()` + argv guard. Imports everything real from `src/harness/`. |
| `docs/reference/harness.md` *(new)* | What an environment is, what fitness means, what is deliberately not evolvable, and why. |

---

### Task 1: The variant write path

The harness's first requirement is the ability to put a genome on disk. Nothing in the repo serializes a `Genome` today — every genome file in the test suite is a hand-written YAML string literal (`test/genome/threading.test.ts:40-42`, `test/genome/load.test.ts:17-19`). That is fine for a test asserting one allele and impossible for a harness varying seven genes.

Three facts make this task smaller than it looks, and one makes it subtler:

- `yaml` is already a **runtime** dependency (`package.json` dependencies, `"yaml": "^2.6.0"`) and its `stringify` is exported. Every existing import is parse-only (`src/config/load.ts:6`, `src/genome/load.ts:25`), so `import { stringify as stringifyYaml } from "yaml";` is a new import requiring no package.json change.
- A `Genome` value is **total** — every field is required except `ResolutionRule.section` — so `stringify` emits every key `GenomeSchema` expects and no defaulting is relied upon.
- `yaml.stringify` **omits keys whose value is `undefined`**, which is exactly right for `section`: it is `z.string().min(1).optional()`, so `section: null` and `section: ""` both *fail* validation. A hand-rolled serializer that wrote `null` for absent optionals would break here.

The subtlety: **a type-correct `Genome` can still be an invalid one.** Two cross-field `.refine`s reject values TypeScript is happy with — every rule's `class` and the `fallback` must appear in `classifier.classes` (`src/genome/schema.ts:156-159`), and a classifier rule needs at least one `present` or `absent` section (`:133-135`). A mutator that changes `classifier.classes` without changing `pivot.classPriority` produces a *loadable but silently degenerate* genome; a mutator that changes `fallback` to an unlisted class produces one that throws at `buildPassContext`, mid-run. So `writeGenome` validates before it writes, and returns the failure rather than planting a landmine.

**Files:**
- Create: `src/genome/write.ts`
- Test: `test/genome/write.test.ts`

**Interfaces:**
- Consumes: `Genome`, `GenomeSchema` (`src/genome/schema.ts:100`, `:241`); `genomePath`, `defaultGenome` (`src/genome/load.ts:31`, `:40`).
- Produces:
  - `export function serializeGenome(genome: Genome): string`
  - `export type GenomeValidation = { ok: true; genome: Genome } | { ok: false; issues: string[] }`
  - `export function validateGenome(candidate: unknown): GenomeValidation`
  - `export function writeGenome(vaultDir: string, genome: Genome): void` — throws on an invalid genome, by design.

- [ ] **Step 1: Write the failing test**

Create `test/genome/write.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { defaultGenome, loadGenome } from "../../src/genome/load.js";
import { serializeGenome, validateGenome, writeGenome } from "../../src/genome/write.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-genome-write-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("writeGenome", () => {
  test("a written genome round-trips through the real loader", () => {
    const g = defaultGenome();
    g.budgets.sharedPool = 7;
    g.weightedTokenSpend.output = 9;
    writeGenome(dir, g);
    expect(loadGenome(dir)).toEqual(g);
  });

  test("round-trips a resolution rule that omits the optional section", () => {
    const g = defaultGenome();
    g.resolution.rules = [{ state: "abandoned", status: ["deferred"] }];
    writeGenome(dir, g);
    expect(loadGenome(dir).resolution.rules).toEqual([{ state: "abandoned", status: ["deferred"] }]);
  });

  test("omits an absent optional rather than writing null, which the schema would reject", () => {
    const g = defaultGenome();
    g.resolution.rules = [{ state: "abandoned", status: ["deferred"] }];
    expect(serializeGenome(g)).not.toContain("section:");
  });

  test("every default-genome value survives serialization unchanged", () => {
    writeGenome(dir, defaultGenome());
    expect(loadGenome(dir)).toEqual(defaultGenome());
  });
});

describe("validateGenome", () => {
  test("catches a fallback outside the class vocabulary BEFORE it reaches disk", () => {
    const g = defaultGenome();
    g.classifier.fallback = "nonesuch";
    const v = validateGenome(g);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues.join("\n")).toContain("classes");
  });

  test("catches a classifier rule predicated on nothing", () => {
    const g = defaultGenome();
    g.classifier.rules = [{ class: "bounded", present: [], absent: [] }];
    const v = validateGenome(g);
    expect(v.ok).toBe(false);
  });

  test("accepts a genome the loader would accept", () => {
    expect(validateGenome(defaultGenome()).ok).toBe(true);
  });
});

describe("writeGenome refuses to plant an invalid genome", () => {
  test("throws rather than writing a file the next buildPassContext would die on", () => {
    const g = defaultGenome();
    g.classifier.fallback = "nonesuch";
    expect(() => writeGenome(dir, g)).toThrow(/genome/i);
    expect(fs.existsSync(path.join(dir, "genome.yaml"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/genome/write.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/genome/write.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/genome/write.ts`:

```ts
/**
 * The genome variant write path — the only place a `Genome` becomes bytes.
 *
 * Phase 2 gave the kernel a genome to read. A harness needs one to write, and
 * writing is the direction where the mistakes are expensive: a genome that
 * loads but means something other than intended produces a fitness record that
 * is a lie, and a genome that fails to load produces it at `buildPassContext`,
 * mid-run, after the environment has already been generated.
 *
 * So this module validates before it writes. `GenomeSchema` carries two
 * cross-field `.refine`s that reject values TypeScript accepts — a `fallback`
 * or a rule `class` outside `classifier.classes`, and a classifier rule
 * predicated on neither `present` nor `absent`. A mutator will hit both. Better
 * a thrown error at the write than a thrown error inside the measurement.
 *
 * Serialization uses `yaml.stringify` rather than string templating for one
 * specific reason: `ResolutionRule.section` is the single optional field in the
 * whole genome tree, and it is `z.string().min(1).optional()`, so `null` and
 * `""` both fail validation. `stringify` omits undefined-valued keys; a
 * hand-rolled writer emitting `section: null` would round-trip into a throw.
 */
import fs from "node:fs";
import { stringify as stringifyYaml } from "yaml";
import { genomePath } from "./load.js";
import { GenomeSchema, type Genome } from "./schema.js";

/** The outcome of checking a candidate against the real schema. */
export type GenomeValidation = { ok: true; genome: Genome } | { ok: false; issues: string[] };

/**
 * Render a genome to the exact bytes `loadGenome` will read back.
 *
 * A `Genome` value is total — every field required but `ResolutionRule.section`
 * — so this relies on no defaulting: what is written is what was meant.
 */
export function serializeGenome(genome: Genome): string {
  return stringifyYaml(genome);
}

/**
 * Check a candidate against `GenomeSchema` without touching the filesystem.
 *
 * Issues are formatted the way `loadGenome` formats them (`<dotted.path>:
 * <message>`, root-level issues labelled `(root)`) so a harness log and a
 * runtime failure read the same.
 */
export function validateGenome(candidate: unknown): GenomeValidation {
  const result = GenomeSchema.safeParse(candidate);
  if (result.success) return { ok: true, genome: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

/**
 * Plant a genome at the vault root, beside `ost.config.yaml`.
 *
 * Throws on an invalid genome and writes nothing — an unwritten file means the
 * default genome, which is a defined state, while a half-written invalid one is
 * a run that dies later and blames the wrong thing.
 */
export function writeGenome(vaultDir: string, genome: Genome): void {
  const check = validateGenome(genome);
  if (!check.ok) {
    throw new Error(`refusing to write an invalid genome.yaml:\n${check.issues.map((i) => `  - ${i}`).join("\n")}`);
  }
  fs.writeFileSync(genomePath(vaultDir), serializeGenome(check.genome), "utf8");
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/genome/write.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Verify the whole suite and the compile**

Run: `npm run build && npm test`
Expected: `tsc` clean; 76 files, 746 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/genome/write.ts test/genome/write.test.ts
git commit -m "feat(genome): a genome can be written, and an invalid one is refused"
```

---

### Task 2: A seeded PRNG, because determinism is byte-level

Generated environments are "the workhorse — cheap, so n is large". Large n means the generator must produce *many different* environments, which means randomness; byte-level determinism means that randomness must be reproducible from a seed and must not touch `Math.random()`.

There is no seeded-RNG dependency and the plan forbids adding one, so it is hand-written. `mulberry32` is the right choice: 32-bit state, a handful of operations, well-distributed for this purpose, and short enough to read and verify. It is not cryptographic and does not need to be — nothing here is a secret, and the requirement is reproducibility, not unpredictability.

State is threaded explicitly through a small object rather than held in a module-level variable. A module-level generator would make two environments generated in the same process depend on the order they were generated in, which is exactly the kind of hidden coupling that makes a fitness record irreproducible.

**Files:**
- Create: `src/harness/random.ts`
- Test: `test/harness/random.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface Rng { next(): number; int(maxExclusive: number): number; pick<T>(items: readonly T[]): T; }`
  - `export function makeRng(seed: number): Rng`

- [ ] **Step 1: Write the failing test**

Create `test/harness/random.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { makeRng } from "../../src/harness/random.js";

describe("makeRng", () => {
  test("the same seed yields the same sequence", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  test("different seeds diverge", () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(Array.from({ length: 10 }, () => a.next())).not.toEqual(
      Array.from({ length: 10 }, () => b.next()),
    );
  });

  test("next() stays in [0, 1)", () => {
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("int() stays in [0, maxExclusive)", () => {
    const r = makeRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
  });

  test("int(0) is 0 rather than NaN — a generator asking for nothing gets nothing", () => {
    expect(makeRng(3).int(0)).toBe(0);
  });

  test("pick() returns a member of the array", () => {
    const r = makeRng(11);
    const items = ["a", "b", "c"] as const;
    for (let i = 0; i < 100; i++) expect(items).toContain(r.pick(items));
  });

  test("pick() on an empty array throws rather than returning undefined", () => {
    expect(() => makeRng(1).pick([])).toThrow(/empty/i);
  });

  test("two generators from one seed do not share state", () => {
    const a = makeRng(5);
    a.next();
    a.next();
    const b = makeRng(5);
    expect(b.next()).toBe(makeRng(5).next());
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/harness/random.test.ts`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write the implementation**

Create `src/harness/random.ts`:

```ts
/**
 * A seeded PRNG, hand-written because the plan forbids a new dependency and the
 * house definition of determinism is byte-level: "no dates, no randomness,
 * stable ordering" (`scripts/gen-skill.ts`). A generated environment must be a
 * pure function of its seed, or a fitness record cannot be reproduced and the
 * replication requirement the design rests on is unenforceable.
 *
 * mulberry32: 32 bits of state, well-distributed for planting fixtures, short
 * enough to read. It is NOT cryptographic and does not need to be — nothing
 * here is secret, and the requirement is reproducibility, not unpredictability.
 *
 * State is threaded through the returned object rather than held at module
 * level. A module-level generator would make two environments built in one
 * process depend on the order they were built in, which is the precise shape of
 * hidden coupling that makes a run irreproducible from its recorded seed.
 */

/** A seeded source of randomness. Every method advances the same private state. */
export interface Rng {
  /** The next value in [0, 1). */
  next(): number;
  /** An integer in [0, maxExclusive). Returns 0 when `maxExclusive <= 0`. */
  int(maxExclusive: number): number;
  /** A uniformly chosen member. Throws on an empty array rather than yielding undefined. */
  pick<T>(items: readonly T[]): T;
}

export function makeRng(seed: number): Rng {
  // `>>> 0` keeps the state an unsigned 32-bit integer at every step; without
  // it the shifts below would drift into signed territory and the sequence
  // would stop matching across engines.
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (maxExclusive: number): number => {
    if (maxExclusive <= 0) return 0;
    return Math.floor(next() * maxExclusive);
  };

  const pick = <T,>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error("cannot pick from an empty array");
    return items[int(items.length)] as T;
  };

  return { next, int, pick };
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/harness/random.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/harness/random.ts test/harness/random.test.ts
git commit -m "feat(harness): a seeded source of randomness, so an environment is a function of its seed"
```

---

### Task 3: The environment spec — and the answer key that never touches the vault

An environment is "a vault plus a product plus an answer key". The spec is the declarative form of all three, and it is also *the key itself* — the design says so for generated environments: "a generator plants discoverable facts into channels from a spec; the spec **is** the key."

Two properties are load-bearing and are implemented here rather than argued later:

- **The key is never written to the vault.** `generateEnvironment` (Task 4) writes nodes, config and evidence; it never writes the spec. The key stays in memory and reaches the fitness computation directly. The design names answer-key leakage as an error mode that *invalidates a run*, so keeping the key structurally out of the vault is worth more than any amount of care about not reading it.
- **`findable` is what makes a null environment a real test.** Each planted unknown declares whether its answer is discoverable in any planted channel. A null environment is a spec whose unknowns all carry `findable: false` — it is *not* an empty vault (D7). This one boolean is the difference between the mandatory null-environment guard testing something and passing vacuously.

The spec also carries `created`, a fixed ISO date, because `serialize` writes `created` into frontmatter and a generator calling `new Date()` would emit vaults that differ between days.

**Files:**
- Create: `src/harness/spec.ts`
- Test: `test/harness/spec.test.ts`

**Interfaces:**
- Consumes: zod only. This module imports nothing from the rest of the repo, and must stay that way — a spec that read the tree could not describe an environment independently of one.
- Produces:
  - `export interface PlantedUnknown { title: string; darkens: string; sections: string[]; findable: boolean; answer: string; }`
  - `export interface PlantedNode { title: string; layer: "Outcome" | "Opportunity" | "Solution"; body: string; links: string[]; }`
  - `export interface PlantedEvidence { id: string; source: string; title: string; body: string; }`
  - `export interface EnvironmentSpec { name: string; kind: "generated" | "null" | "adversarial" | "replay"; seed: number; created: string; outcome: string; outcomeTitle: string; nodes: PlantedNode[]; unknowns: PlantedUnknown[]; evidence: PlantedEvidence[]; }`
  - `export const EnvironmentSpecSchema: z.ZodType<EnvironmentSpec, z.ZodTypeDef, unknown>`
  - `export function answerKey(spec: EnvironmentSpec): Map<string, string>` — unknown title ⇒ expected answer, for `findable` unknowns only.
  - `export function findableCount(spec: EnvironmentSpec): number`

- [ ] **Step 1: Write the failing test**

Create `test/harness/spec.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  answerKey,
  EnvironmentSpecSchema,
  findableCount,
  type EnvironmentSpec,
} from "../../src/harness/spec.js";

const SPEC: EnvironmentSpec = {
  name: "two-findable-one-not",
  kind: "generated",
  seed: 1,
  created: "2026-07-28",
  outcome: "Reach 10,000 daily active users",
  outcomeTitle: "Retention",
  nodes: [{ title: "Retention", layer: "Outcome", body: "Reach 10,000 daily active users", links: [] }],
  unknowns: [
    {
      title: "How many users hit the export path",
      darkens: "Retention",
      sections: ["Format", "Methodology", "Rationale"],
      findable: true,
      answer: "412 per day",
    },
    {
      title: "Why the trial converts",
      darkens: "Retention",
      sections: ["Format"],
      findable: false,
      answer: "",
    },
  ],
  evidence: [],
};

describe("EnvironmentSpecSchema", () => {
  test("accepts a well-formed spec", () => {
    expect(EnvironmentSpecSchema.safeParse(SPEC).success).toBe(true);
  });

  test("rejects an unknown that darkens nothing — the edge direction has no source", () => {
    const bad = { ...SPEC, unknowns: [{ ...SPEC.unknowns[0], darkens: "" }] };
    expect(EnvironmentSpecSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects a findable unknown with no answer, because the key would be empty", () => {
    const bad = { ...SPEC, unknowns: [{ ...SPEC.unknowns[0], answer: "" }] };
    expect(EnvironmentSpecSchema.safeParse(bad).success).toBe(false);
  });

  test("accepts an UNfindable unknown with no answer — that is the point of one", () => {
    const ok = { ...SPEC, unknowns: [SPEC.unknowns[1]] };
    expect(EnvironmentSpecSchema.safeParse(ok).success).toBe(true);
  });

  test("rejects an unknown whose darkens names no planted node", () => {
    const bad = { ...SPEC, unknowns: [{ ...SPEC.unknowns[0], darkens: "Nowhere" }] };
    expect(EnvironmentSpecSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects a duplicate unknown title, which would collide on one ledger file", () => {
    const bad = { ...SPEC, unknowns: [SPEC.unknowns[0], SPEC.unknowns[0]] };
    expect(EnvironmentSpecSchema.safeParse(bad).success).toBe(false);
  });
});

describe("answerKey", () => {
  test("carries only the findable answers", () => {
    const key = answerKey(SPEC);
    expect(key.get("How many users hit the export path")).toBe("412 per day");
    expect(key.has("Why the trial converts")).toBe(false);
  });

  test("a null environment has an empty key but is not an empty spec", () => {
    const nul: EnvironmentSpec = { ...SPEC, kind: "null", unknowns: [SPEC.unknowns[1]] };
    expect(answerKey(nul).size).toBe(0);
    expect(nul.unknowns).toHaveLength(1);
  });
});

describe("findableCount", () => {
  test("counts only what a run could actually resolve", () => {
    expect(findableCount(SPEC)).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/harness/spec.test.ts`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write the implementation**

Create `src/harness/spec.ts`:

```ts
/**
 * What an environment IS, declaratively — a vault, a set of planted unknowns,
 * the channels their answers are (or are not) discoverable in, and the answer
 * key. For generated environments the design is explicit that "the spec IS the
 * key", so this one value is both the thing that plants the world and the thing
 * that grades the run.
 *
 * The key never reaches the vault directory. `generateEnvironment` writes
 * nodes, config and evidence and never writes a spec, so answer-key leakage —
 * which the design names as an error mode that INVALIDATES a run — is
 * foreclosed structurally rather than by remembering to be careful.
 *
 * `findable` is the field that makes a null environment a real test. A null
 * environment is a spec whose unknowns are all unfindable; it is NOT an empty
 * vault. An empty vault has no Unknown layer, so the rollup is empty and the
 * mandatory guard passes vacuously — the worst possible outcome for the one
 * test the design added specifically to stop selection for hyperactive
 * exploration.
 *
 * `created` is a fixed date on the spec because `serialize` stamps it into
 * frontmatter. A generator calling `new Date()` would emit vaults that differ
 * between days and fitness records that cannot be reproduced.
 *
 * This module imports nothing from the rest of the repo and must stay a leaf: a
 * spec that read the tree could not describe an environment independently of
 * one.
 */
import { z } from "zod";

/** A planted `#Unknown`, plus whether its answer is discoverable and what it is. */
export interface PlantedUnknown {
  title: string;
  /** The node that carries the `[[link]]` to this unknown. Direction is settled: the parent holds the edge. */
  darkens: string;
  /** Which contract sections the body declares — this is what decides `classifyUnknown`. */
  sections: string[];
  /** Whether any planted channel contains the answer. `false` is what a null environment is made of. */
  findable: boolean;
  /** The expected answer. Required when `findable`, empty when not. Never written to the vault. */
  answer: string;
}

/** A planted non-Unknown node. */
export interface PlantedNode {
  title: string;
  layer: "Outcome" | "Opportunity" | "Solution";
  body: string;
  /** Titles this node links to. The generator adds unknown edges on top of these. */
  links: string[];
}

/** A planted evidence item, landing in `.ost-agent/evidence/`. */
export interface PlantedEvidence {
  id: string;
  source: string;
  title: string;
  body: string;
}

export interface EnvironmentSpec {
  name: string;
  kind: "generated" | "null" | "adversarial" | "replay";
  seed: number;
  /** Fixed ISO date (YYYY-MM-DD) stamped into every planted node. */
  created: string;
  outcome: string;
  outcomeTitle: string;
  nodes: PlantedNode[];
  unknowns: PlantedUnknown[];
  evidence: PlantedEvidence[];
}

const PlantedUnknownSchema = z
  .object({
    title: z.string().min(1),
    darkens: z.string().min(1),
    sections: z.array(z.string().min(1)).default([]),
    findable: z.boolean(),
    answer: z.string().default(""),
  })
  .strict()
  // A findable unknown with no answer would put an empty string in the key and
  // score every run as having matched it. Unfindable ones are required to be
  // empty for the mirror-image reason.
  .refine((u) => !u.findable || u.answer.length > 0, {
    message: "a findable unknown must declare its answer",
  });

const PlantedNodeSchema = z
  .object({
    title: z.string().min(1),
    layer: z.enum(["Outcome", "Opportunity", "Solution"]),
    body: z.string().min(1),
    links: z.array(z.string().min(1)).default([]),
  })
  .strict();

const PlantedEvidenceSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    title: z.string().min(1),
    body: z.string().min(1),
  })
  .strict();

export const EnvironmentSpecSchema: z.ZodType<EnvironmentSpec, z.ZodTypeDef, unknown> = z
  .object({
    name: z.string().min(1),
    kind: z.enum(["generated", "null", "adversarial", "replay"]),
    seed: z.number().int().nonnegative(),
    created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "created must be an ISO date (YYYY-MM-DD)"),
    outcome: z.string().min(1),
    outcomeTitle: z.string().min(1),
    nodes: z.array(PlantedNodeSchema).min(1),
    unknowns: z.array(PlantedUnknownSchema).default([]),
    evidence: z.array(PlantedEvidenceSchema).default([]),
  })
  .strict()
  // The edge has to have a source. `darkens` naming a node that was never
  // planted produces an unknown nothing links to, which resolves `darkens: null`
  // at `computeNextWork` and silently degrades every coverage metric.
  .refine(
    (s) => s.unknowns.every((u) => s.nodes.some((n) => n.title === u.darkens)),
    { message: "every unknown's `darkens` must name a planted node" },
  )
  // Two unknowns with one title share one attention ledger file, so their spend
  // would merge and neither could be scored.
  .refine((s) => new Set(s.unknowns.map((u) => u.title)).size === s.unknowns.length, {
    message: "unknown titles must be unique",
  });

/** Unknown title ⇒ expected answer, for findable unknowns only. The grading key. */
export function answerKey(spec: EnvironmentSpec): Map<string, string> {
  return new Map(spec.unknowns.filter((u) => u.findable).map((u) => [u.title, u.answer]));
}

/** How many unknowns a run could resolve at all. The denominator for observation quality. */
export function findableCount(spec: EnvironmentSpec): number {
  return spec.unknowns.filter((u) => u.findable).length;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/harness/spec.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/harness/spec.ts test/harness/spec.test.ts
git commit -m "feat(harness): an environment is a spec, and the spec is the answer key"
```

---

### Task 4: The generator — planting a vault the kernel will actually read

This is the task where a wrong assumption costs the most, because the failure mode is silent. The node file format has four traps, every one of which produces a vault that parses cleanly into the *wrong* tree:

1. **A blank line between the tag line and the `[[link]]` block kills every edge.** `deserialize` breaks its edge loop on the first line that is not `[[…]]`, and a blank line is one (`src/ost/node.ts:168-173`). `serialize` never emits one; a hand-written generator can.
2. **A `[[wikilink]]` in prose is not an edge.** Planting a link in the body yields `links: []`. The repo has already been bitten by this — `test/eval/planted-instance.test.ts:24-29` records it as one of three defects found in that test's *own* plants, with the lesson stated: "a plant that is not the shape the check looks for proves nothing about the check."
3. **The filename is the identity.** `readTreeCensus` derives the title from the basename (`src/ost/vault.ts:154`). A file named other than `fileNameForTitle(title)` produces a permanent dangle.
4. **An unrecognised `evidence:` is silently dropped** (`src/ost/node.ts:185-188`), and then the `evidence-class` invariant fires on the node — for every layer including `Unknown` (`src/eval/invariants.ts:73-82`).

So the generator does not hand-write Markdown. It builds `OstNode` values and calls the repo's own `serialize`, which is the one function that provably emits the format `deserialize` reads. It writes bytes directly rather than going through `vault.createNode`, because the `Vault` write surface stamps `new Date()` into `## History` lines (`src/ost/vault.ts:20-22`) and refuses empty bodies — both wrong for a byte-reproducible generator.

It also does not call `initVault`: that shells out to git twice per vault (`src/runner/init.ts:29`, `:68`) and stamps today's date on the root node. For a harness generating hundreds of environments that is a process spawn per vault and a date that changes between runs. The verified minimum `buildPassContext` accepts is `ost.config.yaml` plus node files — no `.ost-agent/`, no git repo.

The task's own guard is the one that matters most: **`darkens` must resolve for every planted unknown.** That is the D1 regression, and it is asserted against the real `computeNextWork`, not against the generator's intent.

**Files:**
- Create: `src/harness/generate.ts`
- Test: `test/harness/generate.test.ts`

**Interfaces:**
- Consumes: `EnvironmentSpec`, `answerKey` (Task 3); `serialize`, `type OstNode` (`src/ost/node.ts:111`, `:50`); `fileNameForTitle` (`src/ost/sanitize.ts:61`); `writeEvidence`, `type EvidenceRecord` (`src/processes/tree.ts:29`, `:10`); `makeRng` (Task 2).
- Produces:
  - `export interface GeneratedEnvironment { dir: string; spec: EnvironmentSpec; }`
  - `export function generateEnvironment(spec: EnvironmentSpec, dir: string): GeneratedEnvironment`
  - `export function specToNodes(spec: EnvironmentSpec): OstNode[]`
  - `export function makeSpec(seed: number, opts?: { unknowns?: number; findableRatio?: number; name?: string }): EnvironmentSpec`

- [ ] **Step 1: Write the failing test**

Create `test/harness/generate.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkInvariants } from "../../src/eval/invariants.js";
import { generateEnvironment, makeSpec, specToNodes } from "../../src/harness/generate.js";
import { type EnvironmentSpec } from "../../src/harness/spec.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { Vault } from "../../src/ost/vault.js";
import { buildPassContext } from "../../src/runner/context.js";

const SPEC: EnvironmentSpec = {
  name: "one-of-each",
  kind: "generated",
  seed: 1,
  created: "2026-07-28",
  outcome: "Reach 10,000 daily active users",
  outcomeTitle: "Retention",
  nodes: [{ title: "Retention", layer: "Outcome", body: "Reach 10,000 daily active users", links: [] }],
  unknowns: [
    {
      title: "How many users hit the export path",
      darkens: "Retention",
      sections: ["Format", "Methodology", "Rationale"],
      findable: true,
      answer: "412 per day",
    },
    {
      title: "Why the trial converts",
      darkens: "Retention",
      sections: ["Format"],
      findable: false,
      answer: "",
    },
  ],
  evidence: [{ id: "e1", source: "INBOX", title: "export counts", body: "412 per day through the export path" }],
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-harness-gen-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("generateEnvironment", () => {
  test("plants a vault buildPassContext accepts without git or init", () => {
    generateEnvironment(SPEC, dir);
    const ctx = buildPassContext(dir, { skipSources: true });
    expect(ctx.config.outcome).toBe("Reach 10,000 daily active users");
  });

  test("THE D1 REGRESSION: darkens resolves for every planted unknown", () => {
    generateEnvironment(SPEC, dir);
    const ctx = buildPassContext(dir, { skipSources: true });
    const work = computeNextWork(ctx.vault, dir, 3, ctx.genome);
    expect(work.openUnknowns).toHaveLength(2);
    for (const u of work.openUnknowns) expect(u.darkens).toBe("Retention");
  });

  test("the planted contract sections decide the class, via the real classifier", () => {
    generateEnvironment(SPEC, dir);
    const ctx = buildPassContext(dir, { skipSources: true });
    const work = computeNextWork(ctx.vault, dir, 3, ctx.genome);
    const byTitle = new Map(work.openUnknowns.map((u) => [u.title, u]));
    expect(byTitle.get("How many users hit the export path")?.klass).toBe("bounded");
    expect(byTitle.get("Why the trial converts")?.klass).toBe("unreached");
  });

  test("every planted unknown starts open — no stray Answer, no validated, no deferred", () => {
    generateEnvironment(SPEC, dir);
    const ctx = buildPassContext(dir, { skipSources: true });
    expect(computeNextWork(ctx.vault, dir, 3, ctx.genome).openUnknowns).toHaveLength(2);
  });

  test("the census is clean — nothing skipped, nothing unreadable", () => {
    generateEnvironment(SPEC, dir);
    const census = new Vault(dir).readTreeCensus();
    expect(census.skipped).toEqual([]);
    expect(census.unreadable).toEqual([]);
    expect(census.examined).toBe(census.nodes.length);
  });

  test("THE LEAKAGE GUARD: no answer text appears anywhere under the vault root", () => {
    generateEnvironment(SPEC, dir);
    const files = fs.readdirSync(dir, { recursive: true, encoding: "utf8" }) as string[];
    for (const f of files) {
      const p = path.join(dir, f);
      if (!fs.statSync(p).isFile()) continue;
      // The evidence item deliberately CONTAINS the answer — that is what
      // findable means. What must never appear is the spec itself.
      expect(fs.readFileSync(p, "utf8")).not.toContain('"findable"');
    }
  });

  test("an unfindable answer is in no planted channel at all", () => {
    const spec: EnvironmentSpec = {
      ...SPEC,
      unknowns: [{ ...SPEC.unknowns[1], findable: false, answer: "" }],
      evidence: [],
    };
    generateEnvironment(spec, dir);
    const files = fs.readdirSync(dir, { recursive: true, encoding: "utf8" }) as string[];
    const all = files
      .map((f) => path.join(dir, f))
      .filter((p) => fs.statSync(p).isFile())
      .map((p) => fs.readFileSync(p, "utf8"))
      .join("\n");
    expect(all).not.toContain("412 per day");
  });

  test("is byte-reproducible: the same spec twice yields identical files", () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), "ost-harness-gen-a-"));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), "ost-harness-gen-b-"));
    try {
      generateEnvironment(SPEC, a);
      generateEnvironment(SPEC, b);
      const read = (d: string): string =>
        (fs.readdirSync(d).sort())
          .map((f) => `${f}\n${fs.statSync(path.join(d, f)).isFile() ? fs.readFileSync(path.join(d, f), "utf8") : ""}`)
          .join("\n---\n");
      expect(read(a)).toBe(read(b));
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  test("a generated tree carries no invariant violations beyond planted darkness", () => {
    generateEnvironment(SPEC, dir);
    const issues = checkInvariants(new Vault(dir).readTree());
    // Unknowns are allowed to be childless; what must not appear is a dangling
    // link, which is what a wrong edge direction would produce.
    expect(issues.filter((i) => /dangling/i.test(JSON.stringify(i)))).toEqual([]);
  });
});

describe("specToNodes", () => {
  test("the parent carries the edge and the unknown carries none", () => {
    const nodes = specToNodes(SPEC);
    const parent = nodes.find((n) => n.title === "Retention");
    const unknown = nodes.find((n) => n.title === "How many users hit the export path");
    expect(parent?.links).toContain("How many users hit the export path");
    expect(unknown?.links).toEqual([]);
  });

  test("every node declares an evidence rung, so the evidence-class invariant stays quiet", () => {
    for (const n of specToNodes(SPEC)) expect(n.evidence).toBeTruthy();
  });
});

describe("makeSpec", () => {
  test("the same seed yields the same spec", () => {
    expect(makeSpec(7)).toEqual(makeSpec(7));
  });

  test("different seeds yield different specs", () => {
    expect(makeSpec(1)).not.toEqual(makeSpec(2));
  });

  test("produces a spec the schema accepts and the generator can plant", () => {
    const spec = makeSpec(3, { unknowns: 4 });
    generateEnvironment(spec, dir);
    const ctx = buildPassContext(dir, { skipSources: true });
    const work = computeNextWork(ctx.vault, dir, 3, ctx.genome);
    expect(work.openUnknowns).toHaveLength(4);
    for (const u of work.openUnknowns) expect(u.darkens).toBeTruthy();
  });

  test("honours findableRatio so a null environment can be asked for by parameter", () => {
    const spec = makeSpec(5, { unknowns: 6, findableRatio: 0 });
    expect(spec.unknowns.every((u) => !u.findable)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/harness/generate.test.ts`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write the implementation**

Create `src/harness/generate.ts`:

```ts
/**
 * Materialise an `EnvironmentSpec` into a vault the kernel will actually read.
 *
 * This module does NOT hand-write Markdown. The node format has four traps and
 * every one of them yields a vault that parses cleanly into the WRONG tree: a
 * blank line between the tag line and the edge block silently kills every edge
 * (`src/ost/node.ts:168-173`); a `[[link]]` in prose is not an edge and never
 * becomes one; the filename IS the title, so a file not named
 * `fileNameForTitle(title)` dangles permanently; and an unrecognised `evidence:`
 * is dropped rather than rejected, after which the evidence-class invariant
 * fires on the node. So it builds `OstNode` values and calls the repo's own
 * `serialize`, which is the one function that provably emits what `deserialize`
 * reads. `test/eval/planted-instance.test.ts:24-29` records the lesson from the
 * last time this was done by hand: "a plant that is not the shape the check
 * looks for proves nothing about the check."
 *
 * It writes bytes directly rather than going through `vault.createNode`, and it
 * does not call `initVault`. Both of those stamp `new Date()` into the vault —
 * `## History` lines and the root node's `created` — and `initVault` shells out
 * to git twice per vault besides. For a harness generating hundreds of
 * environments that is a process spawn each and a date that changes between
 * runs, which forfeits byte-reproducibility for nothing. The verified minimum
 * `buildPassContext` accepts is `ost.config.yaml` plus node files at the vault
 * root: no `.ost-agent/`, no git repo.
 *
 * The answer key is not written. Findable answers reach the vault only through
 * planted EVIDENCE — that is what findable means — but the spec itself, which
 * names which unknowns are findable at all, never lands on disk.
 */
import fs from "node:fs";
import path from "node:path";
import { writeEvidence, type EvidenceRecord } from "../processes/tree.js";
import { serialize, type OstNode } from "../ost/node.js";
import { fileNameForTitle } from "../ost/sanitize.js";
import { makeRng } from "./random.js";
import { EnvironmentSpecSchema, type EnvironmentSpec, type PlantedUnknown } from "./spec.js";

/** A planted environment: where it lives, and the spec that is its key. */
export interface GeneratedEnvironment {
  dir: string;
  spec: EnvironmentSpec;
}

/** The rung every generated node declares. The floor, so no plant claims unearned believability. */
const GENERATED_RUNG = "assertion" as const;

/** Render one planted unknown's body from the sections it declares. */
function unknownBody(u: PlantedUnknown): string {
  const section = (name: string): string => {
    if (name === "Format") return "## Format\na single recorded value";
    if (name === "Methodology") return "## Methodology\nread it from the planted channel";
    return `## Rationale\nserves the node it darkens`;
  };
  if (u.sections.length === 0) return "nothing declared at all";
  return u.sections.map(section).join("\n\n");
}

/**
 * The spec's nodes plus its unknowns, as `OstNode` values.
 *
 * The edge direction is the settled one and is not negotiable here: the
 * DARKENED node carries the `[[unknown]]` link, and the unknown links to
 * nothing. `computeNextWork` resolves `darkens` by searching for the
 * non-Unknown node that links TO the unknown (`src/mcp/next-work.ts:199`), so
 * emitting it the other way resolves `darkens: null` for every planted unknown
 * and degrades every coverage metric without erroring.
 */
export function specToNodes(spec: EnvironmentSpec): OstNode[] {
  const darkensOf = new Map<string, string[]>();
  for (const u of spec.unknowns) {
    const list = darkensOf.get(u.darkens) ?? [];
    list.push(u.title);
    darkensOf.set(u.darkens, list);
  }

  const planted: OstNode[] = spec.nodes.map((n) => ({
    title: n.title,
    layer: n.layer,
    status: "validated",
    created: spec.created,
    evidence: GENERATED_RUNG,
    tags: [],
    links: [...n.links, ...(darkensOf.get(n.title) ?? [])],
    body: n.body,
  }));

  const unknowns: OstNode[] = spec.unknowns.map((u) => ({
    title: u.title,
    layer: "Unknown",
    // Deliberately NOT `validated` and NOT `deferred`: either would make the
    // unknown read as resolved before the run has done anything, because
    // resolution is a rule list over status and sections.
    status: "unvalidated",
    created: spec.created,
    evidence: GENERATED_RUNG,
    tags: [],
    links: [],
    body: unknownBody(u),
  }));

  return [...planted, ...unknowns];
}

/**
 * Write the spec into `dir`. The directory should be a fresh `mkdtemp` — this
 * function does not clear anything, because nothing in this repo deletes.
 */
export function generateEnvironment(spec: EnvironmentSpec, dir: string): GeneratedEnvironment {
  const parsed = EnvironmentSpecSchema.parse(spec);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "ost.config.yaml"),
    `outcome: ${JSON.stringify(parsed.outcome)}\noutcomeTitle: ${JSON.stringify(parsed.outcomeTitle)}\n`,
    "utf8",
  );

  for (const node of specToNodes(parsed)) {
    fs.writeFileSync(path.join(dir, fileNameForTitle(node.title)), serialize(node), "utf8");
  }

  for (const e of parsed.evidence) {
    const rec: EvidenceRecord = {
      id: e.id,
      source: e.source,
      title: e.title,
      // Fixed, from the spec — `writeEvidence` stores whatever it is given, and
      // a clock read here would break byte-reproducibility.
      timestamp: `${parsed.created}T00:00:00.000Z`,
      body: e.body,
    };
    writeEvidence(dir, rec);
  }

  return { dir, spec: parsed };
}

/**
 * Build a generated spec from a seed. The workhorse source of environments:
 * cheap, so n is large, which is the whole statistical advantage over waiting
 * on real users.
 *
 * `findableRatio` is the dial that reaches a null environment by parameter —
 * `0` means nothing is discoverable, which is the shape the mandatory guard
 * needs. Note that a null environment still PLANTS unknowns; an empty vault
 * would make the guard pass vacuously.
 */
export function makeSpec(
  seed: number,
  opts: { unknowns?: number; findableRatio?: number; name?: string } = {},
): EnvironmentSpec {
  const rng = makeRng(seed);
  const count = opts.unknowns ?? 3;
  const findableRatio = opts.findableRatio ?? 0.5;

  const SECTION_SETS: readonly string[][] = [
    ["Format", "Methodology", "Rationale"],
    ["Format", "Rationale"],
    ["Format"],
    [],
  ];

  const parents = ["Retention", "Activation", "Expansion"] as const;
  const nodes = parents.map((title, i) => ({
    title,
    layer: (i === 0 ? "Outcome" : "Opportunity") as "Outcome" | "Opportunity",
    body: `A planted ${i === 0 ? "outcome" : "opportunity"} named ${title}.`,
    links: [] as string[],
  }));

  const unknowns: PlantedUnknown[] = [];
  const evidence: EnvironmentSpec["evidence"] = [];
  for (let i = 0; i < count; i++) {
    // Draw findability from the same stream as everything else so the whole
    // spec is one pure function of the seed.
    const findable = rng.next() < findableRatio;
    const title = `Unknown ${i + 1} of seed ${seed}`;
    const answer = findable ? `value-${seed}-${i}` : "";
    unknowns.push({
      title,
      darkens: rng.pick(parents),
      sections: rng.pick(SECTION_SETS),
      findable,
      answer,
    });
    if (findable) {
      evidence.push({
        id: `seed-${seed}-e${i}`,
        source: "INBOX",
        title: `observation ${i + 1}`,
        body: `The recorded value is ${answer}.`,
      });
    }
  }

  return EnvironmentSpecSchema.parse({
    name: opts.name ?? `generated-${seed}`,
    kind: findableRatio === 0 ? "null" : "generated",
    seed,
    created: "2026-07-28",
    outcome: "Reach 10,000 daily active users",
    outcomeTitle: "Retention",
    nodes,
    unknowns,
    evidence,
  });
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/harness/generate.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Run the full suite and the compile**

Run: `npm run build && npm test`
Expected: `tsc` clean; all tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/harness/generate.ts test/harness/generate.test.ts
git commit -m "feat(harness): plant a vault the kernel reads, with the edge pointing the settled way"
```

---

### Task 5: The run — one genome against one environment, deterministically

A run is where the design's non-negotiables bite hardest. It must be model-free (D2), it must produce a ledger, and it must classify its own failure honestly: "A run with no terminal record is `crashed`, not `failed` — the same distinction health records already draw, so a dead harness cannot be mistaken for a bad genome."

What a run *does*, concretely: it plants the genome, builds a pass context, asks the real `computeNextWork` what work exists, walks the open unknowns **in the order the genome ranked them**, and for each one decides — from the spec, not from the model — whether the answer is discoverable. Discoverable ones get an answer appended and their spend recorded; the rest get spend recorded and stay open until the budget is gone, at which point they are abandoned. That is a faithful model-free analogue of a session working an unknown, and every gene that governs it is exercised for real: `classifier` decides the class, `pivot` decides the order and the cap, `budgets` decides how much looking is allowed, `resolution` decides what the terminal state reads as.

The budget is the load-bearing simulation detail. `createLookupBudget(genome.budgets, config.web.lookupBudget)` is the same call `buildPassContext` makes, and `take(klass)` is the same spend site the tool surface uses. Driving it directly is what makes `budgets` a measurable gene rather than a decorative one.

**Files:**
- Create: `src/harness/run.ts`
- Test: `test/harness/run.test.ts`

**Interfaces:**
- Consumes: `generateEnvironment` (Task 4); `writeGenome` (Task 1); `EnvironmentSpec`, `answerKey` (Task 3); `buildPassContext` (`src/runner/context.ts:46`); `computeNextWork` (`src/mcp/next-work.ts:156`); `createLookupBudget` (`src/web/budget.ts:60`); `recordAttention`, `type AttentionEntry` (`src/telemetry/attention.ts:73`, `:31`).
- Produces:
  - `export interface UnknownOutcome { title: string; klass: string; resolved: boolean; answer: string; calls: number; ms: number; }`
  - `export interface RunRecord { environment: string; kind: EnvironmentSpec["kind"]; seed: number; status: "completed" | "crashed"; error?: string; outcomes: UnknownOutcome[]; surfaced: string[]; done: boolean; budgetLimit: number; budgetRemaining: number; }`
  - `export function runEnvironment(args: { spec: EnvironmentSpec; genome: Genome; dir: string; startedAt: string }): RunRecord`

- [ ] **Step 1: Write the failing test**

Create `test/harness/run.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { computeAttention } from "../../src/eval/attention.js";
import { defaultGenome } from "../../src/genome/load.js";
import { makeSpec } from "../../src/harness/generate.js";
import { runEnvironment } from "../../src/harness/run.js";
import { type EnvironmentSpec } from "../../src/harness/spec.js";
import { Vault } from "../../src/ost/vault.js";

const AT = "2026-07-28T00:00:00.000Z";

const SPEC: EnvironmentSpec = {
  name: "one-findable-one-not",
  kind: "generated",
  seed: 1,
  created: "2026-07-28",
  outcome: "Reach 10,000 daily active users",
  outcomeTitle: "Retention",
  nodes: [{ title: "Retention", layer: "Outcome", body: "Reach 10,000 daily active users", links: [] }],
  unknowns: [
    {
      title: "How many users hit the export path",
      darkens: "Retention",
      sections: ["Format", "Methodology", "Rationale"],
      findable: true,
      answer: "412 per day",
    },
    {
      title: "Why the trial converts",
      darkens: "Retention",
      sections: ["Format"],
      findable: false,
      answer: "",
    },
  ],
  evidence: [],
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-harness-run-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("runEnvironment", () => {
  test("completes and resolves exactly the findable unknown", () => {
    const rec = runEnvironment({ spec: SPEC, genome: defaultGenome(), dir, startedAt: AT });
    expect(rec.status).toBe("completed");
    const resolved = rec.outcomes.filter((o) => o.resolved).map((o) => o.title);
    expect(resolved).toEqual(["How many users hit the export path"]);
  });

  test("writes a real attention ledger the real rollup can read back", () => {
    runEnvironment({ spec: SPEC, genome: defaultGenome(), dir, startedAt: AT });
    const rollup = computeAttention(new Vault(dir).readTree(), dir);
    expect(rollup.unknowns).toHaveLength(2);
    for (const u of rollup.unknowns) expect(u.calls).toBeGreaterThan(0);
  });

  test("an unresolved unknown still shows its spend — abandonment stays visible", () => {
    runEnvironment({ spec: SPEC, genome: defaultGenome(), dir, startedAt: AT });
    const rollup = computeAttention(new Vault(dir).readTree(), dir);
    const dark = rollup.unknowns.find((u) => u.title === "Why the trial converts");
    expect(dark?.calls).toBeGreaterThan(0);
  });

  test("is deterministic: the same inputs twice yield the same record", () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), "ost-harness-run-a-"));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), "ost-harness-run-b-"));
    try {
      const ra = runEnvironment({ spec: SPEC, genome: defaultGenome(), dir: a, startedAt: AT });
      const rb = runEnvironment({ spec: SPEC, genome: defaultGenome(), dir: b, startedAt: AT });
      expect(ra).toEqual(rb);
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  test("the budget gene is live: a tiny shared pool cuts the work short", () => {
    const g = defaultGenome();
    g.budgets.sharedPool = 1;
    const rec = runEnvironment({ spec: makeSpec(4, { unknowns: 5, findableRatio: 1 }), genome: g, dir, startedAt: AT });
    expect(rec.budgetLimit).toBe(1);
    expect(rec.outcomes.filter((o) => o.resolved).length).toBeLessThan(5);
  });

  test("the pivot cap is a display limit, never an amnesty — done still sees everything", () => {
    const g = defaultGenome();
    g.pivot.maxOpenUnknownsSurfaced = 1;
    g.pivot.unknownsBlockDone = true;
    const rec = runEnvironment({ spec: SPEC, genome: g, dir, startedAt: AT });
    expect(rec.surfaced).toHaveLength(1);
    expect(rec.done).toBe(false);
  });

  test("a genome the schema refuses never produces a completed run", () => {
    const g = defaultGenome();
    g.classifier.fallback = "nonesuch";
    const rec = runEnvironment({ spec: SPEC, genome: g, dir, startedAt: AT });
    expect(rec.status).toBe("crashed");
    expect(rec.error).toBeTruthy();
  });

  test("a crashed run is not a zero-fitness run — it is marked crashed and carries no outcomes", () => {
    const g = defaultGenome();
    g.classifier.fallback = "nonesuch";
    const rec = runEnvironment({ spec: SPEC, genome: g, dir, startedAt: AT });
    expect(rec.status).toBe("crashed");
    expect(rec.outcomes).toEqual([]);
  });

  test("a null environment completes, resolves nothing, and still records spend", () => {
    const nul = makeSpec(9, { unknowns: 4, findableRatio: 0 });
    const rec = runEnvironment({ spec: nul, genome: defaultGenome(), dir, startedAt: AT });
    expect(rec.status).toBe("completed");
    expect(rec.outcomes.every((o) => !o.resolved)).toBe(true);
    const rollup = computeAttention(new Vault(dir).readTree(), dir);
    expect(rollup.unknowns).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/harness/run.test.ts`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write the implementation**

Create `src/harness/run.ts`:

```ts
/**
 * One genome against one environment, deterministically and without a model.
 *
 * The model-free choice is not a simplification, it is the measurement. Every
 * gene in the genome is deterministic policy over vault data; none needs a
 * model to observe its effect. Put a model in the loop and its stochasticity
 * becomes the dominant variance term, swamping every gene effect at any n we
 * can afford — the "confident garbage" the design warns about. So a run is a
 * scripted action sequence over the real kernel, and what varies between runs
 * is the genome and the environment, nothing else.
 *
 * What the run simulates: a session picking up the darkness the kernel surfaced
 * and spending its lookup budget on it. `computeNextWork` decides what is
 * surfaced and in what order (the `pivot` gene); `createLookupBudget` decides
 * how much looking is allowed (the `budgets` gene); the spec — never a model —
 * decides whether the answer was there to find. Every gene that governs any of
 * that is exercised by production code.
 *
 * Failure classification follows the health-record precedent the design cites:
 * a run that did not reach a terminal record is `crashed`, NOT a run that
 * scored zero. Collapsing the two would let a broken harness read as a bad
 * genome, which is the one confusion that would quietly poison selection.
 */
import { computeNextWork } from "../mcp/next-work.js";
import { buildPassContext } from "../runner/context.js";
import { recordAttention, type AttentionEntry } from "../telemetry/attention.js";
import { createLookupBudget } from "../web/budget.js";
import { writeGenome } from "../genome/write.js";
import type { Genome } from "../genome/schema.js";
import { generateEnvironment } from "./generate.js";
import { answerKey, type EnvironmentSpec } from "./spec.js";

/** What became of one planted unknown. */
export interface UnknownOutcome {
  title: string;
  klass: string;
  resolved: boolean;
  /** What the run recorded as the answer. Empty when it resolved nothing. */
  answer: string;
  calls: number;
  ms: number;
}

/** The mechanical record of one run. Fitness is computed from this plus the key. */
export interface RunRecord {
  environment: string;
  kind: EnvironmentSpec["kind"];
  seed: number;
  status: "completed" | "crashed";
  error?: string;
  outcomes: UnknownOutcome[];
  /** The titles the kernel actually surfaced, in the genome's ranked order. */
  surfaced: string[];
  done: boolean;
  budgetLimit: number;
  budgetRemaining: number;
}

/** Fixed per-lookup cost. Constant across variants, so cost differences come from POLICY, not noise. */
const CALLS_PER_LOOKUP = 1;
const MS_PER_LOOKUP = 40;

export function runEnvironment(args: {
  spec: EnvironmentSpec;
  genome: Genome;
  dir: string;
  /** ISO timestamp stamped on every ledger entry. Passed in, never read from the clock. */
  startedAt: string;
}): RunRecord {
  const { spec, genome, dir, startedAt } = args;
  const base: Omit<RunRecord, "status" | "outcomes" | "surfaced" | "done" | "budgetLimit" | "budgetRemaining"> = {
    environment: spec.name,
    kind: spec.kind,
    seed: spec.seed,
  };

  try {
    generateEnvironment(spec, dir);
    // The genome must be on disk BEFORE the context is built: it is read exactly
    // once, at `buildPassContext`, and never re-read. Writing it afterwards
    // would measure the default genome while claiming to measure the variant.
    writeGenome(dir, genome);

    // `skipSources: true` so the ambient environment cannot decide whether a run
    // starts — otherwise a missing ATLASSIAN_* or SLACK_BOT_TOKEN throws out of
    // context construction and a fitness record depends on the operator's shell.
    const ctx = buildPassContext(dir, { skipSources: true });
    const work = computeNextWork(ctx.vault, dir, 3, ctx.genome);
    const budget = createLookupBudget(ctx.genome.budgets, ctx.config.web.lookupBudget);
    const key = answerKey(spec);

    const outcomes: UnknownOutcome[] = [];
    for (const open of work.openUnknowns) {
      // The same spend site the tool surface uses, with the same class argument,
      // so `budgets.perClass` is exercised rather than approximated.
      const allowed = budget.take(open.klass);
      const calls = allowed ? CALLS_PER_LOOKUP : 0;
      const ms = allowed ? MS_PER_LOOKUP : 0;

      // Spend is recorded whether or not it bought anything. Abandonment that
      // hid its own cost would be the one thing the ledger exists to prevent.
      const spend: AttentionEntry = {
        ts: startedAt,
        unknown: open.title,
        kind: "spend",
        // A refused lookup is still an attempt, and an attempt that bought
        // nothing is exactly what a null environment must be able to show.
        calls: Math.max(calls, 1),
        ms,
      };
      recordAttention(dir, spend);

      const answer = allowed ? (key.get(open.title) ?? "") : "";
      const resolved = answer.length > 0;
      if (resolved) {
        ctx.vault.appendUnderSection(open.title, "Answer", answer);
        recordAttention(dir, {
          ts: startedAt,
          unknown: open.title,
          kind: "resolution",
          state: "satisfied",
        });
      }

      outcomes.push({ title: open.title, klass: open.klass, resolved, answer, calls, ms });
    }

    return {
      ...base,
      status: "completed",
      outcomes,
      surfaced: work.openUnknowns.map((u) => u.title),
      done: work.done,
      budgetLimit: budget.limit,
      budgetRemaining: budget.remaining(),
    };
  } catch (err) {
    // Crashed, not failed. A run with no terminal record says nothing about the
    // genome that was loaded into it.
    return {
      ...base,
      status: "crashed",
      error: err instanceof Error ? err.message : String(err),
      outcomes: [],
      surfaced: [],
      done: false,
      budgetLimit: 0,
      budgetRemaining: 0,
    };
  }
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/harness/run.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full suite and the compile**

Run: `npm run build && npm test`
Expected: `tsc` clean; all tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/harness/run.ts test/harness/run.test.ts
git commit -m "feat(harness): a genome meets an environment, and a crash is not a bad genome"
```

---

### Task 6: Fitness — and the refusal to compare across bases

Fitness is two normalised terms combined 1:1 (D4). The reason each is defined the way it is matters more than the arithmetic:

- **Orientation** is derived from `weightedCost`, and it is *inverted and normalised* — cheaper is better, and the normalisation is against the environment's own worst case so a 3-unknown vault is comparable to a 10-unknown one (D3).
- **Quality** is agreement with the answer key, which lives outside the vault. It is emphatically **not** `resolutionState`: that is "a floor, not a verdict", and a `## Answer` heading is one allowlisted call away, so scoring on it would let a run mark its own homework.
- **A run that resolves nothing scores `0`, never `undefined`** — the design's null environments depend on a low score being expressible.

The refusal is the part that is easy to skip and expensive to omit. The design says "Fitness comparisons that mix cost bases are refused rather than silently normalized", and the authority is `rollup.costBasis`, **never** `genome.tokenSplit.costBasis` — because `resolveCostBasis` downgrades unconditionally when nothing correlated, and a declaration that masqueraded as a measurement is precisely how a fitness record starts lying.

**Files:**
- Create: `src/harness/fitness.ts`
- Test: `test/harness/fitness.test.ts`

**Interfaces:**
- Consumes: `type AttentionRollup` (`src/eval/attention.ts:102`); `EnvironmentSpec`, `answerKey`, `findableCount` (Task 3); `RunRecord` (Task 5).
- Produces:
  - `export const FITNESS_WEIGHTS: { orientation: number; quality: number }` — pinned, not a gene.
  - `export interface FitnessRecord { environment: string; kind: EnvironmentSpec["kind"]; seed: number; status: RunRecord["status"]; fitness: number; orientation: number; quality: number; explorationSpend: number; costBasis: AttentionRollup["costBasis"]; weights: { orientation: number; quality: number }; resolvedCorrectly: number; findable: number; unattributedShare: number; }`
  - `export function computeFitness(args: { run: RunRecord; rollup: AttentionRollup; spec: EnvironmentSpec }): FitnessRecord`
  - `export function assertComparable(records: readonly FitnessRecord[]): void` — throws on mixed bases.
  - `export function explorationSpend(rollup: AttentionRollup): number`

- [ ] **Step 1: Write the failing test**

Create `test/harness/fitness.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { type AttentionRollup } from "../../src/eval/attention.js";
import {
  assertComparable,
  computeFitness,
  explorationSpend,
  FITNESS_WEIGHTS,
  type FitnessRecord,
} from "../../src/harness/fitness.js";
import { type EnvironmentSpec } from "../../src/harness/spec.js";
import { type RunRecord } from "../../src/harness/run.js";

const SPEC: EnvironmentSpec = {
  name: "e", kind: "generated", seed: 1, created: "2026-07-28",
  outcome: "o", outcomeTitle: "Retention",
  nodes: [{ title: "Retention", layer: "Outcome", body: "b", links: [] }],
  unknowns: [
    { title: "A", darkens: "Retention", sections: ["Format"], findable: true, answer: "yes" },
    { title: "B", darkens: "Retention", sections: ["Format"], findable: false, answer: "" },
  ],
  evidence: [],
};

const rollup = (weightedCosts: Record<string, number>, costBasis: AttentionRollup["costBasis"] = "tokens"): AttentionRollup => ({
  unknowns: Object.entries(weightedCosts).map(([title, weightedCost]) => ({
    title, klass: "bounded", state: "open", calls: 1, ms: 1,
    tokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, weightedCost,
  })),
  byClass: {},
  unattributed: { calls: 0, ms: 0, tokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } },
  uncorrelated: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
  costBasis,
});

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  environment: "e", kind: "generated", seed: 1, status: "completed",
  outcomes: [
    { title: "A", klass: "bounded", resolved: true, answer: "yes", calls: 1, ms: 1 },
    { title: "B", klass: "bounded", resolved: false, answer: "", calls: 1, ms: 1 },
  ],
  surfaced: ["A", "B"], done: false, budgetLimit: 10, budgetRemaining: 8,
  ...over,
});

describe("computeFitness", () => {
  test("a run that answers the findable unknown correctly scores full quality", () => {
    const f = computeFitness({ run: run(), rollup: rollup({ A: 10, B: 10 }), spec: SPEC });
    expect(f.quality).toBe(1);
    expect(f.resolvedCorrectly).toBe(1);
    expect(f.findable).toBe(1);
  });

  test("a WRONG answer scores zero quality — resolution is not agreement", () => {
    const r = run({
      outcomes: [
        { title: "A", klass: "bounded", resolved: true, answer: "no", calls: 1, ms: 1 },
        { title: "B", klass: "bounded", resolved: false, answer: "", calls: 1, ms: 1 },
      ],
    });
    const f = computeFitness({ run: r, rollup: rollup({ A: 10, B: 10 }), spec: SPEC });
    expect(f.quality).toBe(0);
  });

  test("claiming to resolve an UNFINDABLE unknown earns nothing", () => {
    const r = run({
      outcomes: [
        { title: "A", klass: "bounded", resolved: true, answer: "yes", calls: 1, ms: 1 },
        { title: "B", klass: "bounded", resolved: true, answer: "invented", calls: 1, ms: 1 },
      ],
    });
    const f = computeFitness({ run: r, rollup: rollup({ A: 10, B: 10 }), spec: SPEC });
    expect(f.quality).toBe(1);
    expect(f.resolvedCorrectly).toBe(1);
  });

  test("cheaper orientation scores higher than dearer, all else equal", () => {
    const cheap = computeFitness({ run: run(), rollup: rollup({ A: 1, B: 1 }), spec: SPEC });
    const dear = computeFitness({ run: run(), rollup: rollup({ A: 100, B: 100 }), spec: SPEC });
    expect(cheap.orientation).toBeGreaterThan(dear.orientation);
  });

  test("a run that resolves nothing scores 0, not undefined", () => {
    const r = run({
      outcomes: [
        { title: "A", klass: "bounded", resolved: false, answer: "", calls: 1, ms: 1 },
        { title: "B", klass: "bounded", resolved: false, answer: "", calls: 1, ms: 1 },
      ],
    });
    const f = computeFitness({ run: r, rollup: rollup({ A: 5, B: 5 }), spec: SPEC });
    expect(f.quality).toBe(0);
    expect(Number.isFinite(f.fitness)).toBe(true);
  });

  test("a null environment has no findable unknowns and scores quality 0 without dividing by zero", () => {
    const nul: EnvironmentSpec = {
      ...SPEC,
      kind: "null",
      unknowns: [{ title: "B", darkens: "Retention", sections: ["Format"], findable: false, answer: "" }],
    };
    const f = computeFitness({
      run: run({ outcomes: [{ title: "B", klass: "bounded", resolved: false, answer: "", calls: 1, ms: 1 }] }),
      rollup: rollup({ B: 3 }),
      spec: nul,
    });
    expect(f.findable).toBe(0);
    expect(f.quality).toBe(0);
    expect(Number.isFinite(f.fitness)).toBe(true);
  });

  test("stamps the pinned weights into the record, so a later reader knows what it was scored under", () => {
    const f = computeFitness({ run: run(), rollup: rollup({ A: 1, B: 1 }), spec: SPEC });
    expect(f.weights).toEqual(FITNESS_WEIGHTS);
  });

  test("carries the ROLLUP's basis, never the genome's declaration", () => {
    const f = computeFitness({ run: run(), rollup: rollup({ A: 1 }, "calls-and-ms"), spec: SPEC });
    expect(f.costBasis).toBe("calls-and-ms");
  });

  test("a crashed run scores no fitness at all", () => {
    const f = computeFitness({
      run: run({ status: "crashed", outcomes: [] }),
      rollup: rollup({}),
      spec: SPEC,
    });
    expect(f.status).toBe("crashed");
    expect(f.fitness).toBe(0);
  });
});

describe("explorationSpend", () => {
  test("is the total weighted cost across every unknown", () => {
    expect(explorationSpend(rollup({ A: 3, B: 4 }))).toBe(7);
  });
});

describe("assertComparable", () => {
  const rec = (costBasis: FitnessRecord["costBasis"]): FitnessRecord =>
    computeFitness({ run: run(), rollup: rollup({ A: 1 }, costBasis), spec: SPEC });

  test("accepts records sharing one basis", () => {
    expect(() => assertComparable([rec("tokens"), rec("tokens")])).not.toThrow();
  });

  test("REFUSES a mixed-basis comparison rather than normalizing it", () => {
    expect(() => assertComparable([rec("tokens"), rec("calls-and-ms")])).toThrow(/basis/i);
  });

  test("an empty set is comparable — there is nothing to disagree", () => {
    expect(() => assertComparable([])).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/harness/fitness.test.ts`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write the implementation**

Create `src/harness/fitness.ts`:

```ts
/**
 * What a run was worth — two normalised terms, combined 1:1.
 *
 * ORIENTATION is derived from weighted cost and inverted: cheaper is better. It
 * is normalised against the environment's own total so a 3-unknown vault and a
 * 10-unknown one produce comparable numbers, which is what makes replication
 * across environments mean anything.
 *
 * QUALITY is agreement with the environment's answer key, and the key lives
 * OUTSIDE the vault. It is deliberately NOT `resolutionState`: that function
 * calls itself "a floor, not a verdict", and a `## Answer` heading is one
 * allowlisted `ost_append_to_node` away — scoring on it would let a run mark its
 * own homework. Claiming to have resolved an unfindable unknown therefore earns
 * exactly nothing.
 *
 * THE WEIGHTS ARE PINNED AND ARE NOT A GENE. The design lists fitness weighting
 * as unspecified and as a candidate gene; breeding it in v1 is unidentifiable,
 * because the weight and the genes it weights are confounded in a single
 * scalar. They ship as a constant, are stamped into every record so a later
 * reader knows what a number was scored under, and are revisited in Phase 4.
 *
 * THE REFUSAL. `assertComparable` throws on a mixed-basis set rather than
 * normalising, per the design's error handling. The authority is
 * `rollup.costBasis` and never `genome.tokenSplit.costBasis`: `resolveCostBasis`
 * downgrades unconditionally when nothing correlated, so the genome's field is a
 * DECLARATION and the rollup's is a MEASUREMENT. Reading the declaration would
 * be how a fitness record starts lying about itself.
 */
import type { AttentionRollup } from "../eval/attention.js";
import { answerKey, findableCount, type EnvironmentSpec } from "./spec.js";
import type { RunRecord } from "./run.js";

/**
 * The bootstrap weighting between orientation speed and observation quality.
 * NOT a gene — see the module docstring. Chosen by hand because the design says
 * bootstrapping it requires a starting value chosen by hand.
 */
export const FITNESS_WEIGHTS = { orientation: 0.5, quality: 0.5 } as const;

export interface FitnessRecord {
  environment: string;
  kind: EnvironmentSpec["kind"];
  seed: number;
  status: RunRecord["status"];
  /** The combined scalar, in [0, 1]. */
  fitness: number;
  orientation: number;
  quality: number;
  /** Total weighted cost across all unknowns — the design's "exploration spend". */
  explorationSpend: number;
  /** The MEASURED basis, from the rollup. Never the genome's declaration. */
  costBasis: AttentionRollup["costBasis"];
  weights: { orientation: number; quality: number };
  resolvedCorrectly: number;
  findable: number;
  /** A variant that cannot say what it spent attention on is measurably worse. */
  unattributedShare: number;
}

/** Total weighted cost across every unknown. The concrete definition of exploration spend. */
export function explorationSpend(rollup: AttentionRollup): number {
  return rollup.unknowns.reduce((sum, u) => sum + u.weightedCost, 0);
}

/**
 * Map total spend into [0, 1], cheaper being higher, with no tuning constant
 * that could itself be bred. `1 / (1 + spend)` is monotone decreasing, hits 1
 * at zero spend and approaches 0 without reaching it — so "spent nothing" is
 * distinguishable from "spent little", which is exactly the distinction a null
 * environment needs.
 */
function orientationScore(spend: number): number {
  return 1 / (1 + Math.max(0, spend));
}

export function computeFitness(args: {
  run: RunRecord;
  rollup: AttentionRollup;
  spec: EnvironmentSpec;
}): FitnessRecord {
  const { run, rollup, spec } = args;
  const key = answerKey(spec);
  const findable = findableCount(spec);

  // Agreement, not resolution. An answer that does not match the key scores
  // nothing, and an unfindable unknown is not in the key at all — so a run that
  // invents an answer for one earns nothing by it.
  const resolvedCorrectly = run.outcomes.filter(
    (o) => o.resolved && key.has(o.title) && key.get(o.title) === o.answer,
  ).length;

  // A null environment has findable === 0. Quality is 0 rather than 1 or NaN:
  // there was nothing to observe, so no observation quality was demonstrated.
  const quality = findable === 0 ? 0 : resolvedCorrectly / findable;
  const spend = explorationSpend(rollup);
  const orientation = orientationScore(spend);

  const attributed = rollup.unknowns.reduce((sum, u) => sum + u.calls, 0);
  const unattributed = rollup.unattributed.calls;
  const total = attributed + unattributed;
  const unattributedShare = total === 0 ? 0 : unattributed / total;

  // A crashed run says nothing about the genome loaded into it, so it carries no
  // score at all rather than a zero that would drag a variant's mean down.
  const fitness =
    run.status === "crashed"
      ? 0
      : FITNESS_WEIGHTS.orientation * orientation + FITNESS_WEIGHTS.quality * quality;

  return {
    environment: run.environment,
    kind: run.kind,
    seed: run.seed,
    status: run.status,
    fitness,
    orientation,
    quality,
    explorationSpend: spend,
    costBasis: rollup.costBasis,
    weights: { ...FITNESS_WEIGHTS },
    resolvedCorrectly,
    findable,
    unattributedShare,
  };
}

/**
 * Refuse a comparison that mixes cost bases, rather than silently normalising
 * one into the other. Tokens and calls-and-ms are not the same quantity in
 * different units; they are different measurements, and averaging them would
 * produce a number with no referent.
 */
export function assertComparable(records: readonly FitnessRecord[]): void {
  const bases = new Set(records.map((r) => r.costBasis));
  if (bases.size > 1) {
    throw new Error(
      `refusing to compare fitness across cost bases: ${[...bases].sort().join(", ")} — these are different measurements, not different units`,
    );
  }
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/harness/fitness.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/harness/fitness.ts test/harness/fitness.test.ts
git commit -m "feat(harness): what a run was worth, and the comparison it refuses to make"
```

---

### Task 7: The run-record sidecar

Fitness records go to `.ost-agent/harness/runs.jsonl` — a sidecar the agent's tool surface cannot write (D6). This is not paranoia: `hasRecordedResult` clears on `status === "validated"` **or** a literal `## Results` heading, and both are reachable from the allowlist. A tree-native fitness record in Phase 3 would let a refereed run mark its own benchmark recorded, which is the exact category error the design is built to avoid.

Note the choice of directory. `.ost-agent/runs/` already exists — `src/runner/init.ts:41` mkdirs it — but **nothing in the repo reads or writes it**. Writing there would look like joining a convention that has no code on the other side. `harness/` is a fresh name, and lazy creation on first write is the established pattern (`usage/`, `attention/`, `trust/` are all created lazily, none by `init`).

The writes are append-only and fail-open, inheriting the contract every other ledger write in the repo has: a lost record costs a data point, never a crash mid-population.

**Files:**
- Create: `src/harness/record.ts`
- Test: `test/harness/record.test.ts`

**Interfaces:**
- Consumes: `FitnessRecord` (Task 6).
- Produces:
  - `export const HARNESS_LOG = "runs.jsonl"`
  - `export function harnessLogPath(vaultDir: string): string`
  - `export function recordRun(vaultDir: string, record: FitnessRecord): void`
  - `export function readRuns(vaultDir: string): FitnessRecord[]`

- [ ] **Step 1: Write the failing test**

Create `test/harness/record.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { harnessLogPath, readRuns, recordRun } from "../../src/harness/record.js";
import { type FitnessRecord } from "../../src/harness/fitness.js";

const REC: FitnessRecord = {
  environment: "e", kind: "generated", seed: 1, status: "completed",
  fitness: 0.75, orientation: 0.5, quality: 1, explorationSpend: 1,
  costBasis: "tokens", weights: { orientation: 0.5, quality: 0.5 },
  resolvedCorrectly: 1, findable: 1, unattributedShare: 0,
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-harness-rec-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("recordRun", () => {
  test("appends a record the reader gets back intact", () => {
    recordRun(dir, REC);
    expect(readRuns(dir)).toEqual([REC]);
  });

  test("is append-only — a second write never replaces the first", () => {
    recordRun(dir, REC);
    recordRun(dir, { ...REC, seed: 2 });
    const runs = readRuns(dir);
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.seed)).toEqual([1, 2]);
  });

  test("retains losers — a crashed and a zero-fitness run are both kept", () => {
    recordRun(dir, { ...REC, status: "crashed", fitness: 0 });
    recordRun(dir, { ...REC, fitness: 0 });
    expect(readRuns(dir)).toHaveLength(2);
  });

  test("lands under .ost-agent/harness/, not the dead .ost-agent/runs/", () => {
    recordRun(dir, REC);
    expect(harnessLogPath(dir)).toBe(path.join(dir, ".ost-agent", "harness", "runs.jsonl"));
    expect(fs.existsSync(path.join(dir, ".ost-agent", "harness", "runs.jsonl"))).toBe(true);
  });

  test("creates its directory lazily, like usage/ and attention/ do", () => {
    expect(fs.existsSync(path.join(dir, ".ost-agent", "harness"))).toBe(false);
    recordRun(dir, REC);
    expect(fs.existsSync(path.join(dir, ".ost-agent", "harness"))).toBe(true);
  });

  test("is fail-open: an unwritable path costs the record, never a throw", () => {
    const file = path.join(dir, ".ost-agent");
    fs.writeFileSync(file, "not a directory", "utf8");
    expect(() => recordRun(dir, REC)).not.toThrow();
  });
});

describe("readRuns", () => {
  test("a missing log reads as no runs", () => {
    expect(readRuns(dir)).toEqual([]);
  });

  test("skips a corrupt line rather than losing the whole log", () => {
    recordRun(dir, REC);
    fs.appendFileSync(harnessLogPath(dir), "{not json\n", "utf8");
    recordRun(dir, { ...REC, seed: 3 });
    expect(readRuns(dir).map((r) => r.seed)).toEqual([1, 3]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/harness/record.test.ts`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write the implementation**

Create `src/harness/record.ts`:

```ts
/**
 * Where fitness records live: `.ost-agent/harness/runs.jsonl`, append-only.
 *
 * A sidecar rather than the tree, deliberately. `hasRecordedResult` clears on
 * `status === "validated"` OR a literal `## Results` heading, and both are
 * reachable from the tool allowlist via `ost_set_status` and
 * `ost_append_to_node` — so a tree-native fitness record would let a refereed
 * run mark its own benchmark recorded. That is the category error the whole
 * design is built to avoid. Tree-native selection is Phase 4 work, written
 * through the human/CLI path that is deliberately off the MCP surface.
 *
 * `harness/` and not the existing `.ost-agent/runs/`: that directory is
 * scaffolded by `init` and read or written by NOTHING in the repo. Writing
 * there would look like joining a convention with no code on the other side.
 * Lazy creation on first write is the established pattern — `usage/`,
 * `attention/` and `trust/` are all created on demand, none by `init`.
 *
 * LOSERS ARE RETAINED. A tournament that keeps only winners destroys its own
 * dataset: variance decomposition runs on the failures, and an inert gene is
 * discoverable only from the variants that carried it and lost. So nothing here
 * filters, and nothing rewrites.
 */
import fs from "node:fs";
import path from "node:path";
import type { FitnessRecord } from "./fitness.js";

export const HARNESS_LOG = "runs.jsonl";

export function harnessLogPath(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), ".ost-agent", "harness", HARNESS_LOG);
}

/**
 * Append one fitness record. Never throws — a lost record costs a data point,
 * never a population run. Same contract as `recordAttention` and
 * `recordUsageEvent`.
 */
export function recordRun(vaultDir: string, record: FitnessRecord): void {
  try {
    const file = harnessLogPath(vaultDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // fail-open by contract
  }
}

/** Every record, in write order. A missing log reads as no runs; a corrupt line is skipped. */
export function readRuns(vaultDir: string): FitnessRecord[] {
  try {
    const raw = fs.readFileSync(harnessLogPath(vaultDir), "utf8");
    const out: FitnessRecord[] = [];
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      try {
        out.push(JSON.parse(line) as FitnessRecord);
      } catch {
        // One bad line must not cost the whole ledger.
      }
    }
    return out;
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/harness/record.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/harness/record.ts test/harness/record.test.ts
git commit -m "feat(harness): fitness records land where the tool surface cannot reach them"
```

---

### Task 8: `cost-to-resolve` stops being a degenerate allele

`pivot.ranking` enumerates three values and only two of them do anything. `rankOpenUnknowns` opens with `if (pivot.ranking !== "class-priority") return open;` (`src/mcp/next-work.ts:139-146`), so `"cost-to-resolve"` and `"tree-order"` are the same permutation. The kernel is honest about it — `rankingNote` appends " Ranking 'cost-to-resolve' is not implemented in this kernel — listed in tree order instead." to the summary — but honesty is not the same as being measurable. Sampling a three-valued gene where one value cannot vary burns a third of that gene's population on a variant that is by construction identical to another, and Phase 4's variance decomposition would read it as a confirmed-null gene rather than an unimplemented one (D8).

**There is a trap here that must not be walked into.** `UnknownAttention.weightedCost` is purely token-derived, and under the default genome nothing correlates tokens, so `weightedCost` is `0` for every unknown. Ranking on it would silently reproduce tree order while *claiming* to rank by cost — which is worse than the current state, because the current state announces itself. So the sort key switches on the measured basis: `weightedCost` when the rollup says `tokens`, and `calls`-then-`ms` when it says `calls-and-ms`.

Two ordering properties must survive: the cap is applied *after* ranking while `done` is computed over the *uncapped* set (`src/mcp/next-work.ts:208-218`), and `Array.prototype.sort` is stable, so ties keep tree order for free — the same property `class-priority` already relies on.

The cost index is built lazily, on the cost-to-resolve branch only. Under the default genome `ost_next_work` must not pay for a whole-ledger and usage-log read on every call; that cost is the stated reason the allele was deferred in the first place.

**Files:**
- Modify: `src/mcp/next-work.ts` (the `rankOpenUnknowns` function at `:139`, its doc comment at `:120-138`, the `rankingNote` helper at `:233-236`, and the call site at `:201`)
- Modify: `test/mcp/next-work.test.ts` (replace the fallback assertion at `:272-281`)

**Interfaces:**
- Consumes: `computeAttention`, `type AttentionRollup` (`src/eval/attention.ts:317`, `:102`).
- Produces: no new exports. `computeNextWork`'s signature is unchanged, its call site (`src/security/tools.ts:218`) is unchanged, and `GenomeSchema` is unchanged — `ranking` already enumerates `"cost-to-resolve"`.

- [ ] **Step 1: Read the current implementation and its tests**

Run: `sed -n '118,150p;195,240p' src/mcp/next-work.ts` and `sed -n '260,290p' test/mcp/next-work.test.ts`
Confirm before editing: `rankOpenUnknowns` is module-private, the guard is the negative form described above, and `rankingNote` special-cases exactly one string.

- [ ] **Step 2: Write the failing tests**

In `test/mcp/next-work.test.ts`, **delete** the existing test that asserts the fallback (the one containing `expect(attempted.summary).toContain("cost-to-resolve")` and `toContain("tree order")`, around `:272-281`) and add:

```ts
describe("pivot.ranking cost-to-resolve", () => {
  test("orders the dearest darkness first, measured from the ledger", () => {
    // Two unknowns, deliberately planted so tree order is the REVERSE of cost
    // order — otherwise the test passes under the identity permutation.
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "ost-nextwork-cost-"));
    try {
      // (setup: init the vault, create parent + two Unknown nodes "Cheap" and
      // "Dear" in that tree order, link the parent to both)
      recordAttention(dir2, { ts: "2026-07-28T00:00:00.000Z", unknown: "Cheap", kind: "spend", calls: 1, ms: 1 });
      recordAttention(dir2, { ts: "2026-07-28T00:00:00.000Z", unknown: "Dear", kind: "spend", calls: 9, ms: 90 });
      const genome = defaultGenome();
      genome.pivot.ranking = "cost-to-resolve";
      const work = computeNextWork(new Vault(dir2), dir2, 3, genome);
      expect(work.openUnknowns.map((u) => u.title)).toEqual(["Dear", "Cheap"]);
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  test("no longer announces itself as unimplemented", () => {
    const genome = defaultGenome();
    genome.pivot.ranking = "cost-to-resolve";
    const work = computeNextWork(new Vault(dir), dir, 3, genome);
    expect(work.summary).not.toContain("not implemented");
  });

  test("ties keep tree order, because the sort is stable", () => {
    // Both unknowns carry identical spend; the planted order must survive.
  });

  test("tree-order is untouched by the change", () => {
    const work = computeNextWork(new Vault(dir), dir, 3, defaultGenome());
    expect(work.summary).not.toContain("not implemented");
  });

  test("the cap still applies AFTER ranking, and done still sees the uncapped set", () => {
    const genome = defaultGenome();
    genome.pivot.ranking = "cost-to-resolve";
    genome.pivot.maxOpenUnknownsSurfaced = 1;
    genome.pivot.unknownsBlockDone = true;
    const work = computeNextWork(new Vault(dir), dir, 3, genome);
    expect(work.openUnknowns).toHaveLength(1);
    expect(work.done).toBe(false);
  });
});
```

*(The setup bodies elided above with parenthetical comments must be written out in full against the existing file's helpers — `test/mcp/next-work.test.ts` already has a `withUnknown` helper at `:110` and a vault fixture in `beforeEach` at `:13-18`. Follow those; do not invent new ones.)*

- [ ] **Step 3: Run them to make sure they fail**

Run: `npx vitest run test/mcp/next-work.test.ts`
Expected: FAIL — the ordering assertion gets `["Cheap", "Dear"]`, and the "not implemented" assertion fails because the note is still emitted.

- [ ] **Step 4: Implement**

In `src/mcp/next-work.ts`:

1. Add `import { computeAttention } from "../eval/attention.js";` alongside the existing imports.
2. Replace `rankOpenUnknowns` with:

```ts
/**
 * Order the darkness the way the pivot gene asks.
 *
 * `class-priority` sorts by the gene's declared class order, unlisted classes
 * last. `cost-to-resolve` sorts dearest-first, because the design ranks by
 * measured cost-to-resolve and the expensive unknown is the one a session most
 * needs to see before it commits. `tree-order` is the identity.
 *
 * The sort key switches on the MEASURED basis, and that is not a detail.
 * `weightedCost` is purely token-derived, and under the default genome nothing
 * correlates tokens — so it is 0 for every unknown, and ranking on it would
 * silently reproduce tree order while claiming to rank by cost. That is worse
 * than not implementing the allele, because it does not announce itself.
 *
 * `Array.prototype.sort` is stable, so ties keep tree order for free — the same
 * property `class-priority` already leans on.
 */
function rankOpenUnknowns(
  open: OpenUnknown[],
  pivot: PivotGene,
  costOf?: ReadonlyMap<string, number>,
): OpenUnknown[] {
  if (pivot.ranking === "class-priority") {
    const rank = (klass: UnknownClass): number => {
      const at = pivot.classPriority.indexOf(klass);
      return at === -1 ? pivot.classPriority.length : at;
    };
    return [...open].sort((a, b) => rank(a.klass) - rank(b.klass));
  }
  if (pivot.ranking === "cost-to-resolve" && costOf) {
    return [...open].sort((a, b) => (costOf.get(b.title) ?? 0) - (costOf.get(a.title) ?? 0));
  }
  return open;
}

/**
 * Per-unknown cost, on whichever basis the rollup actually measured.
 *
 * Built lazily by the caller, on the cost-to-resolve branch only: under the
 * default genome `ost_next_work` must not pay a whole-ledger and usage-log read
 * on every call, which is the cost that deferred this allele in the first place.
 */
function costIndex(tree: readonly OstNode[], dir: string, genome: Genome): ReadonlyMap<string, number> {
  const rollup = computeAttention(tree, dir, {
    weightedTokenSpend: genome.weightedTokenSpend,
    classifier: genome.classifier,
    resolution: genome.resolution,
    attribution: genome.attribution,
    costBasis: genome.tokenSplit.costBasis,
  });
  const tokenBasis = rollup.costBasis === "tokens";
  return new Map(
    rollup.unknowns.map((u) => [u.title, tokenBasis ? u.weightedCost : u.calls * 1000 + u.ms]),
  );
}
```

3. At the call site (currently `rankOpenUnknowns(...)` around `:201`), build the index only when needed:

```ts
    genome.pivot.ranking === "cost-to-resolve" ? costIndex(tree, dir, genome) : undefined,
```

4. Delete `rankingNote` and its call, since the fallback it announced no longer exists.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npx vitest run test/mcp/next-work.test.ts`
Expected: PASS.

- [ ] **Step 6: Rebuild the bundle — this file is in the CLI graph**

Run: `npm run build && npm run bundle && npm test`
Expected: `tsc` clean; `dist/ost-agent.mjs` regenerated; all tests passing. **The bundle must be committed with this change** or CI's `bundle-drift` job fails.

- [ ] **Step 7: Update the reference doc**

In `docs/reference/genome.md`, find the `pivot.ranking` row and remove any statement that `cost-to-resolve` is unimplemented; state the basis-switching rule instead.

- [ ] **Step 8: Commit**

```bash
git add src/mcp/next-work.ts test/mcp/next-work.test.ts docs/reference/genome.md dist/ost-agent.mjs
git commit -m "feat(mcp): the dearest darkness can be surfaced first, on the basis actually measured"
```

---

### Task 9: The null-environment guard, as an executable test

This is the test the design makes mandatory, and it is the one most likely to be written in a way that passes vacuously. The requirement: "a population run over environments containing nothing findable must not select for higher exploration spend."

The failure mode it exists to prevent is real and specific. Without null environments, fitness selects for hyperactive exploration — "variants that always sail, because in a world where sailing always pays, sailing always pays." A harness that only ever measured environments where looking pays would promote looking, unconditionally, and would be right about its own data and wrong about the world.

Three things make this test non-vacuous, and all three are load-bearing:

- **The null environments contain planted unknowns** (D7). An empty vault has no `Unknown` layer, so the rollup is empty and every variant scores identically — a passing test that proves nothing.
- **The variants must genuinely differ in exploration spend.** The test asserts this directly before asserting the guard; otherwise it could pass because nothing varied.
- **The comparison runs over more than one environment**, because a single environment cannot distinguish a gene effect from an environment effect.

**Files:**
- Create: `src/harness/environments.ts` (the built-in specs)
- Test: `test/harness/null-guard.test.ts`

**Interfaces:**
- Consumes: `makeSpec` (Task 4); `runEnvironment` (Task 5); `computeFitness`, `explorationSpend` (Task 6); `computeAttention` (`src/eval/attention.ts:317`); `defaultGenome` (`src/genome/load.ts:40`).
- Produces:
  - `export function nullEnvironments(count?: number): EnvironmentSpec[]`
  - `export function generatedEnvironments(count?: number): EnvironmentSpec[]`
  - `export const BUILT_IN_ENVIRONMENTS: readonly EnvironmentSpec[]`

- [ ] **Step 1: Write the failing test**

Create `test/harness/null-guard.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { computeAttention } from "../../src/eval/attention.js";
import { defaultGenome } from "../../src/genome/load.js";
import { nullEnvironments } from "../../src/harness/environments.js";
import { computeFitness, explorationSpend } from "../../src/harness/fitness.js";
import { runEnvironment } from "../../src/harness/run.js";
import { Vault } from "../../src/ost/vault.js";
import type { Genome } from "../../src/genome/schema.js";

const AT = "2026-07-28T00:00:00.000Z";

/** Run one genome across every null environment and return its mean fitness and total spend. */
function score(genome: Genome): { fitness: number; spend: number } {
  let fitness = 0;
  let spend = 0;
  const envs = nullEnvironments(3);
  for (const spec of envs) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-null-guard-"));
    try {
      const run = runEnvironment({ spec, genome, dir, startedAt: AT });
      const rollup = computeAttention(new Vault(dir).readTree(), dir);
      const f = computeFitness({ run, rollup, spec });
      fitness += f.fitness;
      spend += explorationSpend(rollup);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  return { fitness: fitness / envs.length, spend };
}

describe("the null-environment guard", () => {
  test("a null environment still PLANTS unknowns — an empty vault would pass vacuously", () => {
    for (const spec of nullEnvironments(3)) {
      expect(spec.unknowns.length).toBeGreaterThan(0);
      expect(spec.unknowns.every((u) => !u.findable)).toBe(true);
    }
  });

  test("nothing in a null environment is findable, so no run can resolve anything", () => {
    const spec = nullEnvironments(1)[0];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-null-guard-"));
    try {
      const run = runEnvironment({ spec, genome: defaultGenome(), dir, startedAt: AT });
      expect(run.status).toBe("completed");
      expect(run.outcomes.every((o) => !o.resolved)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the two variants genuinely differ in exploration spend — otherwise this proves nothing", () => {
    const thrifty = defaultGenome();
    thrifty.budgets.sharedPool = 1;
    const spendthrift = defaultGenome();
    spendthrift.budgets.sharedPool = 50;
    expect(score(spendthrift).spend).toBeGreaterThan(score(thrifty).spend);
  });

  test("THE GUARD: in a world with nothing to find, spending more does not score better", () => {
    const thrifty = defaultGenome();
    thrifty.budgets.sharedPool = 1;
    const spendthrift = defaultGenome();
    spendthrift.budgets.sharedPool = 50;
    expect(score(spendthrift).fitness).toBeLessThanOrEqual(score(thrifty).fitness);
  });

  test("the guard holds across environments, not just one — a gene effect, not an environment effect", () => {
    const thrifty = defaultGenome();
    thrifty.budgets.sharedPool = 1;
    const spendthrift = defaultGenome();
    spendthrift.budgets.sharedPool = 50;
    for (const spec of nullEnvironments(3)) {
      const runOne = (g: Genome): number => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-null-guard-"));
        try {
          const run = runEnvironment({ spec, genome: g, dir, startedAt: AT });
          const rollup = computeAttention(new Vault(dir).readTree(), dir);
          return computeFitness({ run, rollup, spec }).fitness;
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      };
      expect(runOne(spendthrift)).toBeLessThanOrEqual(runOne(thrifty));
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/harness/null-guard.test.ts`
Expected: FAIL — unresolved import of `environments.js`.

- [ ] **Step 3: Write the implementation**

Create `src/harness/environments.ts`:

```ts
/**
 * The built-in environment set.
 *
 * NULL ENVIRONMENTS ARE MANDATORY, and they are not empty vaults. A null
 * environment plants unknowns whose answers are discoverable in no channel; the
 * fit response is to spend little and say so. Without them fitness selects for
 * hyperactive exploration — variants that always sail, because in a world where
 * sailing always pays, sailing always pays. An EMPTY vault would not do the job:
 * it has no Unknown layer at all, so the rollup is empty, every variant scores
 * identically, and the guard passes while proving nothing.
 */
import { makeSpec } from "./generate.js";
import type { EnvironmentSpec } from "./spec.js";

/** Environments where nothing is findable. Seeds are fixed, so the set is reproducible. */
export function nullEnvironments(count = 3): EnvironmentSpec[] {
  return Array.from({ length: count }, (_, i) =>
    makeSpec(1000 + i, { unknowns: 4, findableRatio: 0, name: `null-${i}` }),
  );
}

/** The workhorse set: cheap, so n is large. */
export function generatedEnvironments(count = 8): EnvironmentSpec[] {
  return Array.from({ length: count }, (_, i) =>
    makeSpec(i, { unknowns: 4, findableRatio: 0.5, name: `generated-${i}` }),
  );
}

export const BUILT_IN_ENVIRONMENTS: readonly EnvironmentSpec[] = Object.freeze([
  ...generatedEnvironments(),
  ...nullEnvironments(),
]);
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run test/harness/null-guard.test.ts`
Expected: PASS, 5 tests.

**If the guard test fails, do not weaken it.** A failure means fitness genuinely rewards spending in a world with nothing to find, which is the bug the test exists to catch — fix `computeFitness`, not the assertion.

- [ ] **Step 5: Commit**

```bash
git add src/harness/environments.ts test/harness/null-guard.test.ts
git commit -m "feat(harness): in a world with nothing to find, looking harder must not pay"
```

---

### Task 10: The entry point, the reference doc, and phase verification

The harness becomes runnable, and the phase's claims become executable.

`scripts/harness.ts` is a thin `main()` over `src/harness/`, following `scripts/gen-skill.ts` exactly: repo root computed from `import.meta.url` rather than cwd, all logic in exported functions, side effects in a non-exported `main()`, and the argv guard so the file stays importable by its test. The reason this matters is not style — `tsconfig.json` has `"include": ["src/**/*"]`, so **`tsc` does not type-check `scripts/` at all**. Logic left in the script is logic CI never checks.

**Files:**
- Create: `scripts/harness.ts`
- Create: `docs/reference/harness.md`
- Modify: `package.json` (one script entry)
- Test: `test/harness/phase-verification.test.ts`

- [ ] **Step 1: Write the phase-verification test**

Create `test/harness/phase-verification.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { ALLOWED_TOOL_NAMES } from "../../src/security/policy.js";
import { FITNESS_WEIGHTS } from "../../src/harness/fitness.js";
import { BUILT_IN_ENVIRONMENTS, nullEnvironments } from "../../src/harness/environments.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("Phase 3 verification", () => {
  test("the allowlist did not grow — the harness is tooling, not a tool", () => {
    expect(ALLOWED_TOOL_NAMES).toHaveLength(20);
  });

  test("no harness module is imported by the MCP server or the tool surface", () => {
    for (const f of ["src/mcp/server.ts", "src/security/tools.ts"]) {
      expect(fs.readFileSync(path.join(REPO, f), "utf8")).not.toContain("harness/");
    }
  });

  test("the fitness weights are pinned, not read from a genome", () => {
    expect(FITNESS_WEIGHTS).toEqual({ orientation: 0.5, quality: 0.5 });
    const src = fs.readFileSync(path.join(REPO, "src/harness/fitness.ts"), "utf8");
    expect(src).not.toMatch(/genome\.\w*[Ww]eight/);
  });

  test("the built-in set always contains null environments", () => {
    expect(BUILT_IN_ENVIRONMENTS.some((e) => e.kind === "null")).toBe(true);
    expect(nullEnvironments(1)[0].unknowns.length).toBeGreaterThan(0);
  });

  test("NEGATIVE CONTROL: harness sources contain no clock and no unseeded randomness", () => {
    const dir = path.join(REPO, "src", "harness");
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      expect(src, `${f} reads the clock`).not.toMatch(/new Date\(\)|Date\.now\(\)/);
      expect(src, `${f} uses unseeded randomness`).not.toMatch(/Math\.random\(\)/);
    }
  });

  test("the harness writes to its own sidecar, never .ost-agent/runs/", () => {
    const src = fs.readFileSync(path.join(REPO, "src/harness/record.ts"), "utf8");
    expect(src).toContain('"harness"');
  });

  test("package.json exposes the harness as ordinary repo tooling", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
    expect(pkg.scripts.harness).toBe("tsx scripts/harness.ts");
    expect(pkg.bin).toBeUndefined();
  });

  test("no new dependency was added", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies).sort()).toEqual(
      ["@modelcontextprotocol/sdk", "commander", "gray-matter", "simple-git", "yaml", "zod"],
    );
  });
});
```

- [ ] **Step 2: Run it to confirm which parts fail**

Run: `npx vitest run test/harness/phase-verification.test.ts`
Expected: FAIL on the `package.json` script assertion (not yet added) and the import of `scripts/harness.ts`'s siblings if any are missing.

- [ ] **Step 3: Add the package.json script**

In `package.json`, add to `"scripts"`, keeping alphabetical order among the existing entries:

```json
    "harness": "tsx scripts/harness.ts",
```

- [ ] **Step 4: Write `scripts/harness.ts`**

```ts
/**
 * Run the harness over the built-in environment set.
 *
 * A thin main() by design: `tsconfig.json` has `"include": ["src/**\/*"]`, so
 * tsc does not type-check `scripts/` — anything implemented here is code CI
 * never checks. All real logic lives in `src/harness/`.
 *
 * Deterministic: no dates, no randomness, stable ordering. The output is a pure
 * function of the environment set and the genome.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeAttention } from "../src/eval/attention.js";
import { defaultGenome } from "../src/genome/load.js";
import { BUILT_IN_ENVIRONMENTS } from "../src/harness/environments.js";
import { computeFitness } from "../src/harness/fitness.js";
import { recordRun } from "../src/harness/record.js";
import { runEnvironment } from "../src/harness/run.js";
import { Vault } from "../src/ost/vault.js";

const RUN_AT = "2026-07-28T00:00:00.000Z";

function main(): void {
  const out = process.argv[2] ?? process.cwd();
  const genome = defaultGenome();

  for (const spec of BUILT_IN_ENVIRONMENTS) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-harness-"));
    try {
      const run = runEnvironment({ spec, genome, dir, startedAt: RUN_AT });
      const rollup = computeAttention(new Vault(dir).readTree(), dir);
      const fitness = computeFitness({ run, rollup, spec });
      recordRun(out, fitness);
      process.stdout.write(
        `${spec.name}\t${fitness.status}\tfitness=${fitness.fitness.toFixed(4)}\tbasis=${fitness.costBasis}\n`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

// Run as a script, but stay importable by tests.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
```

- [ ] **Step 5: Write `docs/reference/harness.md`**

Cover, in prose a fresh reader can follow: what an environment is and the three sources (generated, replayed, hand-authored); that the answer key never touches the vault and why; the two fitness terms and the pinned 1:1 weighting, with the confounding argument for why it is not a gene; the cost-basis refusal and why `rollup.costBasis` is the authority rather than the genome's declaration; why the harness is repo tooling rather than a tool, citing `DESTRUCTIVE_TOKENS`; why losers are retained; and an explicit list of what Phase 3 does **not** do — no variance decomposition, no promotion, no replay holdout yet, all of which are Phase 4.

- [ ] **Step 6: Run everything**

Run: `npm run build && npm test && npm run harness -- /tmp/harness-smoke`
Expected: `tsc` clean; the whole suite green; the harness prints one line per environment and writes `/tmp/harness-smoke/.ost-agent/harness/runs.jsonl`.

- [ ] **Step 7: Commit**

```bash
git add scripts/harness.ts docs/reference/harness.md package.json test/harness/phase-verification.test.ts
git commit -m "feat(harness): the population runs, and the phase states what it did not do"
```

---

## Self-Review

**Spec coverage.** Design section ⇒ task:

| Design requirement | Task |
|---|---|
| Environment = vault + product + answer key | 3, 4 |
| Generated environments (the workhorse) | 2, 4, 9 |
| Null environments (mandatory) | 3 (`findable`), 9 |
| Hand-authored / adversarial | 9 (`kind` supports it; the built-in set is generated + null) |
| Fitness from the run's ledger | 5, 6 |
| Orientation speed + observation quality | 6 |
| Cost basis refusal | 6 |
| Crashed ≠ failed | 5 |
| Unattributed share is a reported metric | 6 (`unattributedShare`) |
| Answer-key leakage detection | 3 (structural), 4 (leakage test) |
| Losers retained | 7 |
| Harness outside the tool surface | 10 |
| Genome variation | 1 |
| `cost-to-resolve` measurable | 8 |

**Known gaps, stated rather than hidden:**

- **The replay holdout is not built in this phase.** The design names it as the guard against generator bias and makes promotion depend on it — but promotion itself is Phase 4, and a holdout with nothing to gate is scaffolding. `EnvironmentSpec.kind` carries `"replay"` so the shape exists. **This must be built before anything is promoted.**
- **`tokenSplit` is not exercised end-to-end.** Task 5 runs model-free, so there is no transcript and `correlateTokens` has nothing to read; every rollup in this phase therefore reports `costBasis: "calls-and-ms"`, which is honest but means the token path stays unit-tested only. The `src/harness/transcript.ts` module named in the File Structure is **deferred**: synthesising a transcript to exercise the real correlator is worth doing, and it is the natural first task of Phase 4, but it is not required for any Phase 3 claim. Task 6's refusal exists precisely so that a later mixed set cannot be silently averaged.
- **No variance decomposition, no promotion gate, no re-widening.** All Phase 4.

**Type consistency check.** `RunRecord.outcomes[].klass` is `string` (matching `UnknownClass = string`, not a union). `FitnessRecord.costBasis` is `AttentionRollup["costBasis"]`, derived rather than restated. `EnvironmentSpec["kind"]` is referenced by both `RunRecord` and `FitnessRecord` rather than duplicated. `computeFitness` takes `{ run, rollup, spec }` in Tasks 6, 9 and 10 identically.
