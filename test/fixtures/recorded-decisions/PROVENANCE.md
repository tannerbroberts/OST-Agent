# Recorded-decision corpus — how it was cut, what it came out as, and what it does not settle

`test/ost/recorded-decision-ordering.test.ts` implements "Count how much of the tree a
recorded decision could actually order" — the assumption test beneath "Rank only what a
recorded decision already ordered, and leave the rest unranked", in the meta vault. The
pre-committed bar, fixed on 2026-08-02 before this corpus or the module existed, is **at
least 13 of the 32 under-served rows must trace to a recorded decision that positions them;
below 7 of 32 kills the candidate; 7–12 makes it a supplement to another candidate rather
than an answer on its own.**

| reading | rows | positioned | prioritization-lane | evidence-debt-gate | wip-hold | founder-decision | lane-label | verdict |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| under-served (the test's own wording) | **1** | 0 | 0 | 0 | 0 | 0 | 0 | **kills — but see below** |
| top-level (the rows the Prioritization section grades) | 37 | 20 | 13 | 6 | 1 | 0 | 0 | **supports** |
| all opportunities | 163 | 22 | 13 | 6 | 3 | 0 | 0 | **supports** |

## The headline finding: the denominator moved, from 32 to 1

The bar counts against *32 under-served rows*. **This vault has one.** Everything else that
was under-served when the bar was written has since been given solutions, so the row set the
assumption test named no longer exists at that size and no reading of it can reach 13. The
`kills` on the first line is arithmetic, not evidence: it is what an absolute bar of 13
returns over a denominator of 1.

The test asserts that by name (`denominatorMoved`) rather than rescaling the bar to a
percentage. A threshold quietly re-expressed to fit the number it is judging is the failure
this tree carries a whole bucket for — "My tests carry thresholds nobody ever fixed, so
nothing can come out a failure" — and rescaling here would have turned 0/1 into "0%, below
40.6%, kills", which reads like a measurement of the mechanism and is a measurement of
nothing.

So the honest reading of the bar is the second row: over the 37 top-level rows the root's
Prioritization section actually grades, **20 are positioned by a locatable recorded
decision**, which clears 13 with room. The mechanism is not empty on this vault.

## The cut

The source is the OST-Agent meta vault at `/Users/tanner/ost-agent-meta`, HEAD
`97ee01a93578e85954c76c9d5c06863a28eb1bf7`, 2026-08-31.
`scripts/harvest-recorded-decision-corpus.ts` re-runs the extraction exactly:

```
npx tsx scripts/harvest-recorded-decision-corpus.ts /Users/tanner/ost-agent-meta test/fixtures/recorded-decisions
```

**This is the whole tree, not a sample.** All 1,596 nodes — 1 Outcome, 163 Opportunity, 441
Solution, 495 Assumption, 494 AssumptionTest, 2 Unknown — are read, and the test asserts
those layer counts and that the widest reading carries every Opportunity, so a later re-cut
cannot quietly become a selection. A snapshot is committed rather than the live vault being
read, because a test that reads a path only the maintainer's machine has skips on CI, and a
skipped file reports green.

## What the coverage is actually made of, and why that is the interesting number

Twenty positioned rows, and **thirteen of them come from one section of one node**: the
root's `## Prioritization — row-by-row (2026-07-24)`, four bullets naming thirteen rows.
Six more are the identical `**Evidence-debt gate (deliberate):**` paragraph, written into
six nodes' own bodies. One is a pass ledger entry. That is the whole of this vault's
per-row governance.

Two consequences a reader should carry:

- **Coverage is not distributed, it is concentrated.** Delete that one heading from that one
  file and the top-level reading drops from 20 to **9** — from `supports` to the middle of
  `supplement`, i.e. from "an answer on its own" to "a supplement to another candidate". (It
  is 9 rather than 7 because two of the thirteen carry a second citation elsewhere; the test
  pins that number so the sensitivity is measured rather than assumed.) The mechanism is not
  reading a governed tree; it is reading one prioritization pass that happened on 2026-07-24
  and has not been re-run since.
- **Three of the five decision kinds contribute almost nothing.** Founder decisions
  contribute zero *first* citations (they are second citations on rows a gate already
  reached), WIP holds contribute one, and lane labels contribute none at all.

## Lane labels position nothing, and this is structural

Sixty lane labels are in the corpus. **Not one of them names a row any of the three readings
orders**, because a lane sits on an AssumptionTest and the rows are Opportunities two layers
above. The assumption test lists lane labels as one of the five things that could position a
row; over this vault they cannot reach one. The test asserts this by name so it reads as a
finding rather than as an empty column.

## WIP holds are written as counts, not as names

This is the second structural gap and it is the one that costs the most. The root's ledgers
hold rows *in bulk*: "WIP limit held on 20 of 23 underserved rows", "**Held: the remaining
18 rows**", "the rest are held under Torres's WIP limit". Every one of those is a real,
deliberate human decision — and **not one of them names a row**, so not one of them can be
cited per row. The single WIP hold that does contribute is the third maintenance pass's
entry, which happens to name its target in quotes.

That is a finding about the vault's writing habit rather than about the mechanism: a hold
recorded as a count is unciteable by construction, and the eighteen-to-twenty rows those
ledgers hold are exactly the rows this sweep reports as unranked. The root's own Issues
section has been asking for the fix since 2026-08-02 ("either mark the gated rows with a
status the sweep honours, or accept that `underservedOpportunities` is permanently
non-empty") — this corpus is the measurement of what the missing status costs.

## The deadlock the solution node predicted is in the record

One row comes out contradicted, and it is the one the node named in advance:

> **No one outside my own network could discover this product exists** — held by
> `**Evidence-debt gate (deliberate):** … Expand only when a non-founder artifact cites this
> need`, and advanced by the 2026-07-25 founder decision, `Distribution becomes the critical
> path`.

Both citations are published, neither is resolved, and the row is flagged. "That is arguably
the correct output, but it is a report of a deadlock rather than a priority" is the node's
own sentence about it, and it stands.

## What the detector had to be narrowed to, and why it matters to the number

The first draft read `held`, `holds`, `gated` and `do not merge` as hold declarations
anywhere they appeared. That admitted **215 passages** — a stranded-evidence census note, a
dedupe adjudication saying "DISTINCT, do not merge", a pass ledger explaining somebody
else's gate — each naming a row in passing and each then counted as a decision positioning
it. Coverage over the whole opportunity layer went from 22 rows to **73** on vocabulary
alone.

A mechanism whose entire guarantee is that it cannot invent a priority cannot afford a
detector that reads discussion as disposition, so the marker was narrowed to the
declaration itself, and `test/ost/recorded-decision-ordering.test.ts` plants all three of
the false positives above as controls. **73 is what this candidate looks like when it
cheats, and 22 is what it looks like when it does not.**

The same narrowing applies to direction. `holds` was in the hold vocabulary until the
founder decision that calls distribution the critical path — "the gate in front of every
external-evidence hope this tree *holds*" — was classified as a hold on the strength of that
one verb, which erased the contradiction above. A passage whose own words say both is
`mixed`, published as such, and deliberately does not count as a contradiction: "the
detector cannot tell" and "two humans disagreed" are different findings.

## Where the order comes from

A row's rank is the position of the earliest-*dated* decision that names it, then its
position within that decision's own list of names. Nothing scores anything.

The alternative is worth recording because it was tried first: ordering by vault read alone
ranks by **filename**, and the root's Prioritization section — the only passage in this
vault that records an *ordering* rather than a disposition — landed mid-alphabet, so eight
of its thirteen rows took their rank from whatever ledger note happened to sort earlier.
Date-first is a rule a reader can check against the record and disagree with; filename order
is a rule nobody chose.

## What a green here does not settle

- **Whether an unranked tail of 141 rows is usable by anyone.** The assumption test says so
  itself. Over the whole opportunity layer this mechanism ranks 22 and declines to rank 141,
  which is honest and may be useless; that is a question for a person reading it, not for
  this exit code.
- **Whether it works on a fresh tree.** The assumption test records this bias in advance:
  this vault is unusually heavily governed, so a pass here measures the *best* case. A
  stranger's vault on day one has no Prioritization section, no gates and no ledgers, and
  this mechanism would rank exactly nothing in it. The node's own cost line — "it gets
  better with age instead of working on day one" — is confirmed rather than tested.
- **Whether the citations render legibly**, and what an operator does with a row whose
  citations contradict each other. Both are explicitly out of this test's scope.
