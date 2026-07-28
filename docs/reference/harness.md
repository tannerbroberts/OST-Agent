# The harness — environments, runs, and fitness

Phase 3 of the [epistemic-uncertainty design](../superpowers/specs/2026-07-27-epistemic-uncertainty-design.md). This is the reference for what the harness measures and, just as importantly, what it deliberately refuses to measure. Where this document and the [Phase 3 plan](../superpowers/plans/2026-07-28-harness-and-environments.md) disagree, this document is the live contract.

Run it with:

```
npm run harness -- <output-vault-dir>
```

Each environment is planted in its own throwaway temp vault. Only the fitness records survive, appended to `<output-vault-dir>/.ost-agent/harness/runs.jsonl`.

## An environment

An environment is a vault plus an answer key. Both come from one `EnvironmentSpec` (`src/harness/spec.ts`) — for generated environments the design is explicit that *the spec is the key*.

| Field | Meaning |
|---|---|
| `kind` | `generated` · `null` · `adversarial` · `replay` |
| `seed` | The environment is a pure function of this. |
| `nodes` | Planted Outcome / Opportunity / Solution nodes. |
| `unknowns` | Planted `#Unknown` nodes, each with `darkens`, `sections`, `findable`, `answer`. |
| `evidence` | What lands in `.ost-agent/evidence/` — the channel a findable answer is discoverable in. |

**The key never touches the vault.** `generateEnvironment` writes config, nodes and evidence, and never writes the spec. Findable *answers* do reach the vault, through planted evidence — that is what findable means — but the key that says *which* unknowns are findable does not. The design names answer-key leakage as an error mode that invalidates a run, so this is foreclosed structurally rather than by remembering to be careful.

**The edge direction is settled and non-negotiable.** The darkened node carries the `[[Unknown]]` link; the unknown links to nothing. `computeNextWork` resolves `darkens` by finding the non-`Unknown` node that links *to* the unknown. A generator emitting the edge the other way would resolve `darkens: null` for every planted unknown and degrade every coverage metric **without erroring** — which is why `test/harness/generate.test.ts` asserts it against the real `computeNextWork` rather than against the generator's intent.

### Null environments are mandatory, and are not empty vaults

A null environment plants unknowns whose answers are discoverable in no channel. The fit response is to spend little and say so.

Without them, fitness selects for hyperactive exploration — variants that always sail, because in a world where sailing always pays, sailing always pays. An **empty** vault would not do the job: it has no `Unknown` layer at all, so the rollup is empty, every variant scores identically, and the guard passes while proving nothing.

`test/harness/null-guard.test.ts` therefore asserts its own non-vacuity first: it proves the thrifty and spendthrift variants genuinely differ in exploration spend *before* asserting that the bigger spender does not score better.

## A run

A run is **model-free**, and that is the measurement rather than a simplification. Every gene is deterministic policy over vault data; none needs a model to observe its effect. Put a model in the loop and its stochasticity becomes the dominant variance term, swamping every gene effect at any *n* we can afford — the design's own "confident garbage" failure.

`runEnvironment` plants the environment, writes the genome variant, builds a pass context with `skipSources: true`, and walks the open unknowns in the order the genome ranked them. Real production code decides everything that matters: `computeNextWork` decides what is surfaced and in what order, `createLookupBudget` decides how much looking is allowed, and the **spec** — never a model — decides whether the answer was there to find.

**A crash is not a bad genome.** A run that does not reach a terminal record is `crashed`, not `failed`, following the precedent health records already set. Collapsing the two would let a broken harness read as a bad genome, which is the one confusion that would quietly poison selection.

**A refused lookup costs zero calls.** If every visit recorded a call regardless of the budget, two variants with wildly different budgets would record identical spend, and the null-environment guard would compare nothing while appearing to compare thrift against extravagance.

## Fitness

Two normalised terms, combined **1:1**.

- **Orientation** — `1 / (1 + explorationSpend)`. Monotone decreasing, hits 1 at zero spend, approaches 0 without reaching it, and carries no tuning constant that could itself be bred.
- **Quality** — agreement with the answer key. Emphatically **not** `resolutionState`: that calls itself "a floor, not a verdict", and the `## Answer` heading it reads is one allowlisted `ost_append_to_node` away. Scoring on it would let a run mark its own homework. Claiming to resolve an *unfindable* unknown therefore earns exactly nothing.

A null environment has no findable unknowns, so quality is `0` — there was nothing to observe, so no observation quality was demonstrated. A run that resolves nothing scores `0`, never `undefined`.

### Exploration spend switches on the measured basis

`explorationSpend` reads `rollup.costBasis`:

| Basis | Spend |
|---|---|
| `tokens` | total `weightedCost` |
| `calls-and-ms` | total `calls + ms/1000` |

This is load-bearing, not defensive. `weightedCost` is *purely token-derived*, and a model-free run correlates no tokens — so under `calls-and-ms` it is `0` for **every** unknown. Summing it would report that a thrifty variant and a spendthrift one spent exactly the same.

The same trap governs `pivot.ranking: "cost-to-resolve"`, which is why its cost index switches basis identically. Ranking on an all-zero `weightedCost` would silently reproduce tree order *while claiming to rank by cost* — worse than not implementing the allele, because it would not announce itself.

### The refusal

`assertComparable` throws on a set mixing cost bases rather than normalising one into the other. Tokens and calls-and-ms are not the same quantity in different units; they are different measurements, and averaging them yields a number with no referent.

**The authority is `rollup.costBasis`, never `genome.tokenSplit.costBasis`.** `resolveCostBasis` downgrades unconditionally when nothing correlated, so the genome's field is a *declaration* and the rollup's is a *measurement*. Reading the declaration is how a fitness record starts lying about itself.

## What is deliberately not evolvable

`FITNESS_WEIGHTS` joins the not-a-gene list that `docs/reference/genome.md` maintains.

A weight that is itself bred is **unidentifiable**: the weight and the genes it weights are confounded in a single fitness scalar, so variance decomposition cannot separate them. It ships as a constant, is stamped into every fitness record so a later reader knows what a number was scored under, and is revisited in Phase 4. A harness that could breed its own scoring function would select for variants that game the scorer.

## Why the harness is repo tooling, not a tool

The design requires it — "the evolutionary harness runs *outside* the agent's tool surface, as ordinary repo tooling" — and the security model enforces it independently. `DESTRUCTIVE_TOKENS` contains `run`, `exec`, `spawn`, `eval` and `system`, and tokenization splits on both non-alphanumerics and camelCase, so `ost_run_generation`, `ost_eval_fitness` and `ost_spawn_variant` all throw before they can be registered. `ALLOWED_TOOL_NAMES` stays at exactly 20, pinned by three tests and a runtime assert.

Fitness records live in `.ost-agent/harness/runs.jsonl` for the same reason: `hasRecordedResult` clears on `status === "validated"` **or** a literal `## Results` heading, and both are reachable from the allowlist. A tree-native fitness record would let a refereed run mark its own benchmark recorded.

`harness/` rather than the existing `.ost-agent/runs/` because that directory is scaffolded by `init` and read or written by nothing in the repo; writing there would look like joining a convention with no code on the other side.

## Losers are retained

A tournament that keeps only winners destroys its own dataset. Variance decomposition runs on the failures — an inert gene is discoverable only from the variants that carried it and lost. Nothing filters, and nothing rewrites.

## What Phase 3 does NOT do

Stated so nothing here reads as more than it is:

- **No replay holdout.** The design names it as the guard against generator bias and makes promotion depend on surviving it. `EnvironmentSpec.kind` carries `"replay"` so the shape exists, but nothing builds one — and **nothing may be promoted until it does**.
- **No token correlation end-to-end.** A model-free run produces no transcript, so `correlateTokens` has nothing to read and every Phase 3 rollup honestly reports `calls-and-ms`. Synthesising a transcript to exercise the real correlator is the natural first task of Phase 4. `assertComparable` exists precisely so a later mixed set cannot be silently averaged.
- **No variance decomposition, no promotion gate, no periodic re-widening.** All Phase 4.
- **No search procedure.** The harness runs a fixed built-in set against one genome. Random sparse sampling and early termination on partial evaluation are Phase 4.
