# Unblock-leverage graph — how it was cut, what it came out as, and what it does not settle

`test/rank/unblock-leverage-distribution.test.ts` implements "Compute the unblock-count
distribution over this vault and require it to be non-flat" — the assumption test beneath
"Rank every node by how many blocked tests one build would unblock", in the meta vault. The
pre-committed bar, fixed on 2026-08-06 before this corpus existed, is **max ≥ 3× median,
and the top decile carrying ≥ 25% of all unblockings**.

The measured result is **refuted, under all three readings**.

| reading | candidates | unblockings | median | max | max/median | top decile share | bar |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| unanswered (widest) | 441 | 494 | 1 | 3 | 3.00 ✅ | 18.6% ❌ | **missed** |
| instrumented | 441 | 367 | 1 | 2 | 2.00 ❌ | 12.8% ❌ | **missed** |
| pre-committed | 441 | 289 | 1 | 2 | 2.00 ❌ | 16.3% ❌ | **missed** |

## The cut

The source is the OST-Agent meta vault at `/Users/tanner/ost-agent-meta`, HEAD
`14a00434dcca324560ee49c9d8c78f82837a8619`, 2026-08-31.
`scripts/harvest-unblock-leverage-corpus.ts` re-runs the extraction exactly:

```
npx tsx scripts/harvest-unblock-leverage-corpus.ts /Users/tanner/ost-agent-meta test/fixtures/unblock-leverage
```

**This is the whole tree, not a sample.** All 1,596 nodes — 1 Outcome, 163 Opportunity, 441
Solution, 495 Assumption, 494 AssumptionTest, 2 Unknown — are read, and the test asserts
those layer counts and that every Solution became a candidate, so a later re-cut cannot
quietly become a selection.

Nothing is inferred from prose. Every field is read by the same functions the product uses:
`resolveTestsUnderSolution` for coverage, `prerequisiteEdges` for declared ordering,
`hasRecordedResult` for whether a test is answered. A snapshot is committed rather than the
live vault being read, because a test that reads a path only the maintainer's machine has
skips on CI, and `vitest.config.ts` refuses that by name: a skipped file reports green, and
a green that measured nothing is the failure mode "A sweep that cannot read its subject
reports a clean result" describes.

## Why it is flat, and it is the reason the assumption itself named

The assumption node predicted this: *"A tree whose tests are mostly independent — which is
the shape you would expect if each solution got its own bespoke test, and this tree's 297
tests under 291 solutions is exactly that shape — would produce a flat distribution and
refute the ranking's whole premise."* That shape held as the tree grew: **494 tests under
441 solutions, a ratio of 1.12**, and **390 of the 441 candidates unblock exactly one
test**. The maximum is 3.

The load-bearing fact underneath, and the one the node did not anticipate:

> **The vault declares zero prerequisite edges.**

`src/ost/prerequisites.ts` shipped the field an ordering claim lives in, along with cycle
refusal, dangling-edge reporting and a sweep that treats an unmet prerequisite as blocking.
Nothing has ever written one. So the only what-unblocks-what edge available to this sweep
is **coverage** — shipping a solution makes the tests beneath it readable — and coverage is
**fan-out, not leverage**: it can only ever count a solution's own children, which is why
the maximum here is 3 rather than the four-tests-spanning-a-top-level-opportunity the
tetrix instance reported and this whole idea was generalized from.

That matters for how the refutation should be read. This sweep is a true reading of the
tree as it stands, and it is not a clean test of the *belief*, because the mechanism the
belief needs is present in the code and empty in the data. The two nodes that would change
that are already in the tree and are human-only: "Prerequisite edges between assumption
tests" (built — that is the module above) and **"Paper-map prerequisite pairs among the
sixty existing tests"**, which is the hand reading of the test bodies that would populate
the field. Until that map exists, a re-cut of this corpus will keep returning coverage
fan-out and keep refuting, and the refutation will keep being partly about the vault's
authoring rather than about the tree's structure.

## Sensitivity: the verdict does not turn on the arguable call

The arguable call is what "becomes readable" means. The widest reading — any test with no
recorded result — is the node's own wording, and it is also the *most* favourable to the
ranking: it is the only one that clears the ratio clause, and it clears it exactly (3 over a
median of 1, not a margin above it). Tightening it in either defensible direction makes
things worse, not better:

- requiring an `instrument:` drops the maximum to 2 and the decile share to 12.8%;
- requiring a fixed `threshold:` as well leaves the maximum at 2 and the share at 16.3%.

For scale: a **perfectly uniform** field of 441 candidates — every one unblocking exactly
one test — scores 10.2% in the top decile. The measured 18.6% sits between that and the 25%
bar. This tree is nearer to uniform than to a ranking with a head.

## The one reading that clears the bar, and why it is not the claim

If the candidate layer is widened from Solution to **Opportunity**, the distribution
separates sharply: 163 candidates, max 85, median 3, ratio 28.3, top decile 44.3% — it
clears both clauses. It is reported by the test rather than left out, and disqualified
there by its own total: **1,015 unblockings over a tree that holds 494 tests.**
Opportunities nest, so a test beneath a sub-opportunity is counted again for every
ancestor. That is hierarchy depth, not leverage, and no build corresponds to a row of it —
an opportunity is a problem, not a thing anyone ships. It is in the record because a sweep
that reported only the readings that failed would be hiding the one that did not.

## What a red-shaped verdict does and does not license

Straight from the assumption test, and it survives this corpus intact: *"red here means do
not build the graph machinery, and do not spend an operator's afternoon on the study beneath
this solution, because it would be a study of a ranking that cannot rank."*

- **Do not** commission "Hand-compute unblock counts and see if the operator's pick changes"
  on this evidence. The numbers it would show a person are 1, 1, 1, 1, 2.
- **Do not** wire an unblock-leverage ranking into the tool surface.
  `src/ost/unblock-leverage.ts` is on the module-reachability debt register for exactly this
  reason.
- **Do not** read this as a general finding. The assumption test's own caveat stands: this
  is one tree, authored largely by one agent under one ruleset, and a stranger's tree could
  have any shape. What it settles is this vault.

What would change the answer is not more compute. It is the paper map — a person reading
test bodies and declaring the prerequisites that exist — after which this corpus can be
re-cut against a graph that has the cross-branch edges the ranking was always about.
