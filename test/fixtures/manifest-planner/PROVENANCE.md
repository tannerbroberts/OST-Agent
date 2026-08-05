# The planner corpus — how it was cut, and how the manifest was filled

`test/product/manifest-ranking-shift.test.ts` asks one question: does declaring the
operator's resources change which work comes first? The answer has to be the same next
year and has to run offline, so the subject lives here rather than being read off the
machine that produced it. This file records exactly what was taken, so anyone can
disagree with the cut instead of with the number.

## What is here

| File | What it is |
| --- | --- |
| `candidates.jsonl` | 78 nodes — every solution `ost-agent buildable` listed against the `ost-agent-meta` vault on 2026-08-04, plus every `AssumptionTest` each one links to. One `readTree()` record per line, serialized verbatim, in tree order. |
| `hand-filled.ost.resources.yaml` | The manifest, filled by hand for that same vault on that same day. |

## How the cut was made

```
tree      = new Vault("<ost-agent-meta>", {create:false}).readTree()
keep      = { b.solution for b in buildableSolutions(tree) }
          ∪ { c.title for c in tree if c.layer == "AssumptionTest" and c is linked from a kept solution }
cut       = [ n for n in tree if n.title in keep ]     # tree order preserved: filtered, never re-sorted
```

**The cut is the planner's whole input, not a sample of it.** `rankBuildableWork` ranks
`buildableSolutions(tree)` and reads the assumption tests beneath each one; it never looks
at anything else on the tree. So "which nodes were chosen" is not a question anyone has to
answer about this corpus — the rule chose them, and the rule is the one the planner runs.

39 solutions, 39 assumption tests. Two properties of the corpus matter enough to be
asserted by the spec rather than remembered here:

- **Every one of the 39 solutions rests on `evidence: assertion`.** The merit term is
  therefore flat across the whole corpus, and the manifest-absent order is exactly the
  order `ost-agent buildable` prints today.
- **Not one of the 39 assumption tests carries a `lane:` field.** The lane vocabulary
  fails closed, so all 39 read as needing a person — which makes the `hours` field a
  constant on this corpus, and a constant orders nothing.

## How the manifest was filled

Every field was read off a fact already recorded in the vault, on 2026-08-04. Nothing was
invented for the spec, and nothing was chosen after looking at what it would do to the
ranking.

| Field | Declared | Read off |
| --- | --- | --- |
| `hours.perWeek` | 0 | The bucket *"I need the tree's output to be actionable by compute alone, because my hours don't exist"*, and *"The goal I care about is too far from anything I can act on this week"*. |
| `socialReach.contactStrangers` | false | Recorded on the solution this manifest was built for: the cold-offer test was sequenced RUN FIRST on 2026-07-24 and killed on 2026-07-25 with *"that isn't going to fly"*. |
| `credentials.withheld` | `[publish]` | The assumption test's own words: *"no publish credential reachable from the container"*. One name, because one name is what an operator writes — the word the work would use for the thing. |
| `compute` | 1,000,000 / 5h | *"a token budget with a reset schedule"*. The shape is the operator's; the numbers are their plan, and nothing in this repository reads them. |
| `capital.amount` | 0 | The same test's words: *"no capital"*. |

## What this corpus cannot support

- **It cannot say the new order is better.** It shows the ranking is sensitive to declared
  resources. Which of two orderings a person would rather act on is not a question a
  fixture can answer, and the spec does not pretend to.
- **It cannot say an operator would keep a manifest true.** This one was filled once, by
  hand, by the person who wrote the tool. Staleness is the cost that would actually sink
  the candidate and nothing here measures it.
- **Three of the five declared fields did no ordering work.** `capital` and `compute`
  deferred nothing; `hours` deferred all 39 and therefore reordered nothing. The movement
  in the top five comes from `social-reach` (4 candidates) and `credentials` (1). The spec
  asserts those counts, so a future change that quietly loses the only two fields that
  work fails here instead of passing on the strength of the other three.
