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

`DEFAULT_WEIGHTED_TOKEN_SPEND` was readable, parameterised, well-factored — and inert, because
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
weightedTokenSpend:
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
