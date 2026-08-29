# Open-assumption corpus — what was cut, and who labelled it

`test/web/public-movable-assumptions.test.ts` asks how many of this tree's open
assumptions could be moved by anything public at all. The assumption test it implements
("Count how many open assumptions in this tree could be moved by anything public at all",
in the meta vault) fixed its bar before this fixture existed: **at least 15 open
assumptions must yield a specific, searchable question.**

## The cut — `open-assumptions.json`

Snapshot of the meta vault on **2026-08-29**, taken by
`scripts/harvest-open-assumptions.ts`, which is committed so the cut can be re-run rather
than trusted:

```bash
npx tsx scripts/harvest-open-assumptions.ts ../../ost-agent-meta
```

Every `type: Assumption` node whose status is not `validated`, `shipped` or `deferred`
and which carries no `## Results` block — **483 of them**, which is every Assumption node
the vault held that day. None was excluded by judgement, and the harvest reports its own
count.

Per node it keeps the title, the prose above the first `##` heading, and the title and
`instrument` of each child AssumptionTest. It keeps no `## History`, no `## Instrument
Log` and no test design prose, because the classifier reads none of them.

**This is a snapshot, not the vault.** The vault is a sibling checkout on the
maintainer's machine (`ost.vault.yaml` → `../../ost-agent-meta`) and CONTRIBUTING
requires the suite to be offline and deterministic, so a test that read the live tree
would measure something different on every run and nothing at all on CI. The count in the
spec is therefore "483 open assumptions as of 2026-08-29" and never "the tree today".
Re-run the harvest to move the date, and expect the numbers the spec pins to move with it.

## The answer key — `hand-labels.json`

`src/web/public-movable.ts` was written by reading this corpus, so it cannot also be the
judge of its own accuracy. `hand-labels.json` is a human reading of individual
assumptions, written against the belief text rather than against the classifier's rules,
and the spec scores the classifier against it.

Two strata, both mechanically selected so the key cannot be cut to flatter the code:

1. **`positives`** — *all seventeen* assumptions the classifier calls public-movable. Not
   a sample; every one is adjudicated, so precision is measured rather than estimated.
2. **`negativeSample`** — every 20th assumption in the classifier's 466 private-only
   list, in the corpus's own alphabetical order (indices 0, 20, 40, … 460): 24 nodes.
   The stride was fixed before any of them was read.

The key's own claim is modest. It is one reader's judgement of whether a published
document could raise or lower belief, made without going and looking — which is exactly
the limit the vault's assumption test already states: *judging that a public source could
help is not the same as one existing.* Nothing here spends a lookup, and no entry claims
an answer was found.

## What the key says, so the numbers in the spec have a source

- Of the 17 the classifier called movable, **14 survive** hand adjudication. The three it
  gets wrong share one shape: a public thing is named, and the *proposition* is still
  about this tree's own data — how often this loop waits, what this tree's arithmetic
  emitted, whether this machine's disk can take it.
- Of the 24 sampled private-only assumptions, **2 are misses** — an assumption about
  agreement between independent model judges (published literature), and one about how a
  prompting CLI behaves with no controlling terminal (documented behaviour of a tool the
  belief never names). At that rate the 466 private-only nodes hide on the order of forty
  more, which is why the spec treats the classifier's count as a **floor**.

Both misses are the same defect and it is worth naming: the belief describes an external
thing by its *role* ("the prompting tool", "independent judges") rather than by its name,
and a registry of named referents cannot see a role.
