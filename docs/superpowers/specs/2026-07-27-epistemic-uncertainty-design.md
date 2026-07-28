# Epistemic Uncertainty as an Exploration Signal — Design

**Date:** 2026-07-27
**Status:** Approved by Tanner (brainstorming session, 2026-07-27)

## Problem

OST-Agent cannot want to know something.

`computeNextWork` (`src/mcp/next-work.ts`) is entirely deficit-shaped. It reports unmapped evidence, opportunities under the solution minimum, solutions with no assumption test, and hygiene issues; `done` is those four counts reaching zero. Every stage is a hole in a structure the tree already has.

Not-knowing, meanwhile, only ever subtracts:

- the believability ladder sinks anything unjustified to the `assertion` floor (`src/knowledge/believability.ts`);
- `gateSolution` refuses to clear a solution whose assumptions are untested (`src/eval/evidence-debt.ts`);
- an exhausted lookup budget tells the session to "record what is still unknown on the tree" (`src/web/budget.ts`) — and nothing ever reads it back.

The agent already files its own epistemic limits at the point of pain. `FRICTION_KINDS` is `blocked`, `guessed`, `unclear-rule`, `missing-affordance`, `slow` (`src/adapters/friction.ts`) — a first-person record of the moment it could not see. But a filing becomes one inbox note, one evidence item, and re-enters the same deficit pipeline. **Nothing counts filings, nothing thresholds them, and nothing changes behavior because of them.**

So uncertainty is a tax, never a destination. An instance that cannot see something has no way to spend attention on becoming able to see it.

## Model

Three claims, in dependency order.

**1. Sensing extends through subscriptions, not new organs.** A household subscribes to many magazines without building a second mailbox. `Source` (`src/adapters/source.ts`) is the mailbox — a closed interface, `fetchSince(cursor) → EvidenceItem[]`, behind every channel that exists. What an instance points those channels at is unbounded and local. When an instance cannot see something about its product, the fix is usually not a new faculty but **observability work on the product itself**, so the business emits data the existing mailbox already accepts. Its loop's Build phase already ships product code. The rare case — a genuinely new *kind* of channel — is ordinary product work for whichever instance has the OST-Agent codebase as its product.

**2. There is one kind of instance.** Telemetry is an ordinary channel, available to any instance, fed by any product. The instance pointed at the OST-Agent codebase is not architecturally special; it merely writes code it will eventually consume, after proving and regression. Recursive self-improvement is a consequence of where an instance is pointed, not a second architecture. This design therefore adds no engineer/consumer distinction at the sensing layer.

**3. Unknowns have shapes, and the shapes are not ours to declare.** "Measure a dark cabinet", "make a sale door-knocking", "get a job", "find the theoretical ceiling on flops per gram", "reach 10,000 DAU at 50% paid", "become multi-planetary" are all goals under uncertainty, spanning minutes to centuries. They differ along several axes at once — time-to-first-signal, cost per trial, decomposability, precedent density, and whether the goal requires changing the world at all (only the flops-per-gram question does not). Any taxonomy we hand-author is a guess. **A taxonomy is good exactly insofar as it predicts cost-to-resolve**, and that is measurable, so the agent can discover its own.

The unifying consequence: *"which unknown deserves the next token"* and *"which gene deserves the next sample"* are the same question — expected uncertainty reduction per unit of attention. One instrument answers both.

## Non-negotiables inherited

- **No new capability at the tool surface.** The genome is data; interpreting data adds no tool. `ALLOWED_TOOL_NAMES` stays a frozen `as const` and `assertNoDestructiveTool` keeps failing closed. The evolutionary harness runs *outside* the agent's tool surface, as ordinary repo tooling.
- **Deterministic measurement, never self-report.** Fitness and resolution are computed from traces and exit codes, on the precedent set by health records. There is no `--fitness` flag, as there is no `--verdict` flag.
- **Append-only. Losers are retained** — see [Failure utilization](#failure-utilization), where discarding them destroys the measurement.
- **The founder sets the mandate, never the method.** `set-outcome` is human-only (`src/runner/set-outcome.ts`). Asking a human which genome is wide enough would be the agent delegating its own epistemics; it is the same category error as marking its own ideas validated.

## Architecture

Four parts. Parts 1–2 are useful standing alone; 3–4 need them.

### 1. The unknown record

Split by cadence, mirroring the existing division between knowledge (tree) and mechanical trace (sidecar).

**On the tree** — a fifth type tag, `#Unknown`, one Markdown file, append-only, linking to the node it darkens. Darkness becomes a visible region of the Obsidian graph, the way `#unvalidated` made speculation visually distinct. The node carries the contract:

| Field | Meaning |
|---|---|
| **Format** | The schema-valid shape a valid answer must take. |
| **Methodology** | The mechanism by which the data would be collected. |
| **Rationale** | The wikilink to the darkened node, plus the metric it serves. |

The contract is what binds a commissioned faculty to a purpose, and it is what prevents open-ended chasing: **Format is the stopping condition.**

**In the sidecar** — `.ost-agent/attention/<unknown-id>.jsonl`, append-only, machine-written, never narrated. Same discipline and location convention as `usage/events.jsonl` and `health/runs.jsonl`. Cost accrues here rather than in the node body, which would fight the never-rewrite rule and drown the prose.

**Attribution rides existing plumbing.** `withUsageTracing` already stamps every event with `OST_SESSION` (`src/telemetry/usage.ts:72`). An `OST_UNKNOWN` marker, set when the loop picks up an unknown, adds one optional field to `UsageEvent` and every tool call self-attributes.

**Cost comes from the transcript channel, and is not a single number.** Token spend is unreachable from the tool tracer — since the API-key runner was deleted, OST-Agent never calls the model. It *is* carried in Claude Code session JSONL, as a `usage` object per assistant message with `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens`. `src/adapters/transcript.ts` already parses those files, but reads message text only; extracting `usage` is new work, not existing plumbing.

The four tiers must stay separate. Cached reads are priced roughly an order of magnitude below fresh input, so summing them yields a number that tracks conversation length rather than attention spent — and because fitness *is* cost, a naive sum would corrupt selection toward variants that merely re-read context. The ledger records the tiers unmixed and applies a weighting declared in the genome, which makes the cost model itself an allele rather than an assumption baked into the harness.

**Resolution is recorded, never claimed.** An unknown terminates as `satisfied` (an answer matching its declared Format was recorded), `abandoned` (budget exhausted), or `superseded`. Abandonment leaves the spend that bought nothing fully visible; that is the point.

### 2. The genome

**The kernel becomes an interpreter of a genome.** A declarative `genome.yaml` holds every policy governing how unknowns are handled: the classifier, the budget policy per class, the pivot threshold that trades exploitation for exploration, channel priority, ideation parameters, and the token-tier weighting that defines what attention costs.

The design rule is blunt and worth stating as a rule, because it is easy to violate by accident: **anything compiled in is a trait excluded from evolution.** A policy expressed as a TypeScript table cannot breed.

The v1 default genome ships a deliberately crude classifier — class by contract completeness: Format and Methodology both declarable → *bounded*; Format only → *unreached*, the case where observability work gets commissioned; neither → *unbounded*. It ships as **one allele of the classifier gene, expected to lose on evidence.** Its only virtue is being mechanically checkable rather than a judgment about how mysterious something feels — the same deliberate crudeness as `hasRecordedResult`.

### 3. The harness

An **environment** is a vault plus a product plus an answer key. Running a genome in an environment produces a fitness record computed from that run's ledger: how fast the variant got its bearings, and what its commissioned observations returned.

**Environments come from three sources, with different jobs:**

- **Generated** (the workhorse) — a generator plants discoverable facts into channels from a spec; the spec *is* the key. Cheap, so n is large, which is the whole statistical advantage over waiting on real users.
- **Replayed** (the holdout) — a real vault's history truncated at time T, where ground truth is what actually became known after T. Scarce and realistic. **Promotion requires surviving this set**, which is the guard against overfitting to the generator.
- **Hand-authored** (the adversarial cases) — including the mandatory **null environments**, where nothing is findable and the fit response is to spend little and say so. Without them, fitness selects for hyperactive exploration: variants that always sail, because in a world where sailing always pays, sailing always pays. The loop already treats a dry backlog as a clean `no-op` rather than a failure; this is the same principle at population scale.

**Search procedure.** Start wide. Sample randomly and sparsely rather than on a grid — random search dominates grid search in high dimensions precisely because effective dimensionality is low. Terminate bad configurations early on partial evaluation so most of the budget lands on survivors. Then decompose fitness variance by gene.

**Promotion rule.** A gene change promotes when its effect replicates across environments *and* the variance is attributable to the gene rather than to the environment. Narrowing to the measured carriers is allowed; it must be provisional, with periodic re-widening against the pruned set, because a gene inert alone can be decisive in combination and a hard prune locks in a local optimum with no way to see out of it.

**What can and cannot be proven.** There is no theorem here. What is available is a statistical bound conditional on the environment set, stated falsifiably — *"gene G explains under x% of fitness variance across environments E at n samples"* — checkable, replicable, and wrong in a way that shows. Underpowered comparison is the live danger: small effect sizes plus large noise plus small n produces confident garbage, and human genetics spent years on loci that would not replicate. Our advantage is that n is manufacturable. Replication is mandatory and affordable.

### 4. Tree-native selection

The evolutionary machinery is mostly the OST it already is:

| Evolutionary concept | Existing OST construct |
|---|---|
| Candidate genome | `#Solution` on the meta tree, `unvalidated` |
| Benchmark run | `#AssumptionTest` beneath it |
| Fitness recorded | `hasRecordedResult` (`evidence-debt.ts:37`) |
| Promotion gate | `gateSolution` — no genome promotes on an untested assumption |

Ideation proposes alleles; the harness is a deterministic runner; the gate is the promotion rule. Nothing here needs a new layer of the tree.

## Failure utilization

**A tournament that keeps only winners destroys its own dataset.** Variance decomposition runs on the failures: an inert gene is discoverable only from the variants that carried it and lost. Every genome and every run is retained — the repo's append-only instinct, load-bearing here for a new reason.

This also makes the two tiers of learning a partition of variance rather than a judgment call:

- variance explained by **environment** → an instance-specific gotcha, recorded in that instance's tree;
- variance explained by **gene, replicating across environments** → a category-level lesson, and a candidate change to the kernel.

## Data flow

```
friction filing / failed evaluation / unanswerable node
  → #Unknown node on the tree (Format · Methodology · Rationale)
  → classifier gene assigns a class
  → budget policy gene allocates attention
  → work: subscribe · re-read · commission observability · look outward
  → every tool call self-attributes via OST_UNKNOWN
  → tokens correlate in from the transcript channel
  → resolution recorded: satisfied | abandoned | superseded
  → ledger yields cost-to-resolve per unknown, per class
       ├─ instance: which unknowns are worth attention
       └─ harness: fitness for the genome that produced them
             → variance decomposition across environments
             → replicated, gene-attributable effects promote
```

## Error handling

- **Unattributed spend.** A tool call with no `OST_UNKNOWN` marker is recorded unattributed rather than dropped or guessed. Unattributed share is itself a reported metric — a variant that cannot say what it spent attention on is measurably worse.
- **Telemetry failure stays fail-open.** `recordUsageEvent` never throws, by contract. Ledger writes inherit that: a lost event, never a failed mutation.
- **Missing token data.** If transcript correlation is unavailable, cost falls back to calls and wall-clock, and the record says so. Fitness comparisons that mix cost bases are refused rather than silently normalized.
- **Harness crash mid-run.** A run with no terminal record is `crashed`, not `failed` — the same distinction health records already draw, so a dead harness cannot be mistaken for a bad genome.
- **Answer-key leakage.** A generated environment whose key is reachable through a channel invalidates that run. Detection is a key-material scan over ingested evidence; affected runs are excluded from decomposition and reported.

## Testing

- **Unit** — contract-completeness classification; budget allocation per class; resolution state machine; attribution stamping; variance decomposition on synthetic fixtures with known effect sizes (including a known-null gene, which must not promote).
- **Integration** — a genome run end-to-end against a temp vault, asserting ledger contents including a deliberately abandoned unknown and a deliberately crashed run.
- **Population** — the null-environment guard as an executable test: a population run over environments containing nothing findable must not select for higher exploration spend.
- **Regression** — with the default genome, behavior matches today's. Genome extraction is a refactor first and a capability second.

## Scope and sequencing

Four phases, each its own implementation plan. Phase 1 answers the original problem statement standing alone.

1. **The ledger** — `#Unknown` node type, attention sidecar, `OST_UNKNOWN` attribution, transcript cost correlation, resolution recording. Makes uncertainty visible and measurable with no harness in sight.
2. **Genome extraction** — move policy out of code into declarative data; kernel interprets. Verified by behavioral identity under the default genome.
3. **Harness and environments** — generator, replay holdout, null environments, fitness computation.
4. **Selection** — variance decomposition, replication requirement, promotion gate, periodic re-widening.

## Least-settled

Recorded as assumptions, not decisions, so they are cheap to overturn:

- **Generated environments carry generator bias the agent cannot see.** The replay holdout is the mitigation, but the holdout supply is small, and small-n validation is exactly the failure mode named above. This is the weakest joint in the design.
- **`unreached` may not earn its own class.** It may be `bounded` with a blocker, in which case the v1 classifier has two classes, not three. It will lose or survive on predictive power like any allele.
- **Link direction** — whether an `#Unknown` links to the node it darkens or is linked from it. A graph-shape call with real consequences for how visible darkness is in Obsidian, deferred to implementation.
- **Fitness weighting** between orientation speed and observation quality is unspecified. It is itself a candidate gene, but bootstrapping it requires a starting value chosen by hand.

## Out of scope (YAGNI)

- No new tool on the OST surface, and no runtime tool registration. The allowlist stays frozen.
- No real-user fleet telemetry as the primary evolution signal — too slow and too distal to be the *first* loop. It remains valid and is not removed; it is demoted behind the in-house population.
- No cross-instance genome exchange. One instance determines the shape of the others via ordinary release.
- No probability estimates on opportunities. Ranking is by measured cost-to-resolve, not by an invented prior.
