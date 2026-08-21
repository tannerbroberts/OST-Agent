# The golden set

Eight small vaults, each a complete Opportunity Solution Tree in the on-disk format
`src/ost/node.ts` reads, committed so that `src/eval/golden-set.ts` has something
fixed to be judged against. `test/eval/golden-set-discrimination.test.ts` scores all
eight and asserts that every `good/` vault outscores every `degraded/` vault by a
fixed margin, per pair.

## `good/` — three sound trees, three domains

Authored by hand on 2026-08-20, each in a different domain so the scorer cannot pass
by recognising one vocabulary:

- `discovery-tool` — a product-discovery tool (this product's own domain)
- `cafe-loyalty` — a café owner's loyalty scheme
- `data-platform` — an internal analytics platform

Each is nine nodes: one Outcome, two Opportunities stated in the customer's voice
and sourced to an interview or channel, one Solution under each, one Assumption
under each Solution, one AssumptionTest under each Assumption with a numeric bar in
its `threshold` field. Every one passes `checkInvariants` with zero violations —
the spec asserts that, so "good" is the product's own gate saying so and not the
author's.

## `degraded/` — five copies of `discovery-tool`, each broken one way

Every degraded vault is `good/discovery-tool` with a single named breakage, so a
score gap is attributable to that breakage and nothing else. The breakages are the
ones the assumption test names, plus the two floors the product already gates on:

| vault | what was broken | dimension it must drag down |
|---|---|---|
| `solutions-as-opportunities` | both Opportunities retitled and rewritten as features ("Add a tree quality dashboard") | `need-shaped` |
| `ungrounded-nodes` | every node beneath the Outcome has its `source` removed | `grounded` |
| `solutions-without-assumptions` | both Solutions lose their Assumption and AssumptionTest | `tested` |
| `unfixed-bars` | both AssumptionTests lose their `threshold` field; one defers the bar in prose, one never states it | `fixed-bars` |
| `broken-structure` | a dangling edge, a Solution hung off the Outcome, an Opportunity nothing links to, a test its Assumption no longer links | `structure` |

## What this set does not settle

The degraded vaults are broken in ways their author already imagined. A margin over
them says the scorer sees those five breakages; it is no evidence the scorer would
recognise a bad tree nobody planted, and it says nothing about whether the score
tracks anything a human would call quality. Both of those are the humans-required
half of the assumption test this set serves.

Regenerate by hand if the node format changes; there is no generator in the repo, on
purpose — a fixture that a script can rewrite is a fixture a scoring change can
quietly rewrite to fit.
