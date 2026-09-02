# human-gate-latency corpus

`corpus.json` is the whole evidence base for
`test/release/human-gate-latency.test.ts`, which scores the assumption test
"Measure how long the last human-gated release actually waited". That node says
the data "is already on disk" and needs "no build, no publish rights and no new
instrumentation", so this corpus is exactly the records that were already there
— two git histories and the vault's own dated lines. No authored readings, no
labels, no judgement calls beyond the three the node itself specified.

Regenerate with:

```bash
npx tsx scripts/harvest-human-gate-corpus.ts /path/to/vault
```

Captured 2026-09-02 at `94ac1c1e706f86b2916f91030b5b7f5d459aae34` (the tip of
`main` when the test was written) against vault
`e0d9facef950241d0de74bde3f643bffc15b1e50`. Both are recorded in the corpus, as
is `asOf` — the instant the cut was taken, which every still-open wait is
measured against. Storing `asOf` rather than reading the clock is what makes the
test deterministic: an open wait that grew with wall-clock time would give a
different verdict on every run, and the fixture would be unfalsifiable.

## What a gate is

An artefact that reached a state where the only remaining work was **one action
by a person**. Three classes, exactly the three the node enumerates.

**`release`** (25) — every commit reachable from `HEAD` that *added* a
`"version": "X.Y.Z"` line to `package.json`, newest first. A bump rather than a
tag is the unit for the same reason the release-propagation corpus gives: most
of this history was never tagged, so scoring on tags would drop the releases
that are the finding. Ready is the *committer* date; acted is the tag `vX.Y.Z`,
if one exists at all. 19 of the 25 have no tag and are open.

**`result-filing`** (244) — every AssumptionTest in the vault whose instrument
has been observed **green** at least once, dated from that first green's own
recorded line. At that moment there is a run outcome on disk and the only work
left is one `ost-agent result` call. Tests observed only red are deliberately
**not** gates: those wait on a builder, not on a person, and counting them would
inflate the open share with waits no human ever owned. The 244 matches the
independent "observed green" tally `ost-agent rollup` reports.

**`verdict-draft`** (5) — every `ost-agent result "<test>"` command drafted under
`.ost-agent/drafts/`, each dated by the vault commit that *first carried that
command string* (a pickaxe, not the file's creation date, because the docket grew
over three commits and two commands arrived after the first).

## The one rule that decides the verdict

Still-open waits are recorded with their running duration and **counted**. The
node insisted on this and gave the reason; the corpus makes the reason
measurable. Score only the gates that closed and this same data returns six
gates, zero open, a median of 0.00 days, and a cleanly cleared bar. Score it as
specified and it returns 274 gates, 268 open, a median of 15.42 days, and a bar
missed on both clauses.

## What the corpus records that is not a measurement

**Every tag in this repository is lightweight.** `git for-each-ref` returns
`objecttype commit` for all seven, and `%(taggerdate)` is empty for all seven —
`creatordate` silently falls back to the commit the tag points at. So the instant
a human *tagged* a release is not recorded anywhere in this repository. The six
tagged releases are carried with `actedAtIsLowerBound: true` and score at zero,
which is the earliest the act could have happened and the reading most
favourable to the candidate. They are not evidence that tagging was fast. An
annotated tag (`git tag -a`) carries a tagger date, and from the first one on
this measurement would have a real closed-gate series.

**`resultsHeadingCommits` is 0 over 3918 vault commits.** `## Results` is the
section `ost-agent result` writes and nothing else does. It has never been
written. That is a stronger statement than "no gate in this corpus has closed",
which is why it is harvested from the history rather than inferred from the gate
list.

**`draftEstimates`** carries the drafts' own stated cost — `3 minutes.` for the
2026-07-24 compute docket, whose five commands have now been open for more than
five weeks.

## What it deliberately does not cover

One operator, one project. The node says this plainly and it is repeated here
because the median is quotable and the limit is not: this says nothing about
whether a human gate is affordable for anyone else, and it cannot decide whether
the honest form of the candidate is the sibling it names — a single autonomous
train with a human veto after the fact rather than a human action before it.
