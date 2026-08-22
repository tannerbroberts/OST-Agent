# Pass-shape corpus — how it was cut, and what it does and does not show

`test/loop/pass-shape-classifier.test.ts` implements "Paper-classify the existing commit
history as structure versus commentary" — the assumption test beneath "Structure and
commentary are separable from the shape of the output alone", in the meta vault. The
pre-committed bar, fixed before this corpus existed, is **at least 90% agreement between
the rule and the labels**.

The measured result is **91.12%** (2,688 of 2,950).

## The cut

The source is the OST-Agent meta vault's own git history at
`/Users/tanner/ost-agent-meta`, HEAD `c2fc84fea832d6a16f21502f3772b02f97c21e56`, 2,950
commits from 2026-07-24 to 2026-08-21. `scripts/harvest-pass-shape-corpus.ts` re-runs the
extraction exactly:

```
npx tsx scripts/harvest-pass-shape-corpus.ts /Users/tanner/ost-agent-meta test/fixtures/pass-shape
```

**This is the whole history, not a sample.** No commit was dropped for being awkward, and
the test asserts the row count and the uniqueness of the SHAs so that a later re-cut cannot
quietly become a selection.

Each commit is read twice, through two deliberately unequal windows, and the inequality is
the entire reason the number means anything:

- **The subject**, kept verbatim up to 240 characters. This is all the rule
  (`src/loop/pass-shape.ts`) ever sees. The cap only bites on `ost_ingest_inbox`, whose
  subjects fold a per-channel report into the first line and run to a kilobyte; every
  `mcp:` tool name and the node title after it fits well inside 240.
- **The diff**, reduced to ten counts (`nodesAdded`, `linksChanged`, `statusChanged`, …).
  These are the labels' only input, and the rule never sees them.

If both sides read the subject, agreement would be 100% and would measure nothing. What is
actually being asked is whether what a commit *says* it did reproduces what it *did*.

## The label predicate

`labelFromFacts` in the harvest script, re-implemented as `label()` in the test so the
definition is visible where it is used:

> **structure** iff `nodesAdded + nodesRemoved + nodesRenamed + linksChanged +
> statusChanged + instrumentChanged + evidenceChanged > 0`; **commentary** otherwise.

That is a direct transcription of the definition the assumption test gives — "structure =
new nodes/links/status; commentary = annotations/appends only". The label is recomputed
from the committed counts on every load rather than stored as a string, so disagreeing with
the predicate is a one-line edit and does not need a re-harvest.

Two decisions inside it are worth stating because a re-cutter might reverse them:

**A wikilink counts only when it is the whole line.** A line whose entire trimmed content
is `[[Title]]` is how this vault writes a parent link and a "Proving this" backlink. A
wikilink inside a sentence is a reference, not an edge. The first cut of this corpus
counted any `[[…]]` and mislabelled 42 `ost_append_to_node` commits structural in one
stroke: the vault contains a much-repeated appended paragraph reading ``Named in plain
quoted text rather than as a `[[wikilink]]``` — prose *about* not making a link, which the
looser rule read as making one. Tightening it moved measured agreement from 88.8% to
91.1%, i.e. across the bar. A corpus this sensitive to one regex is a corpus to re-read
before trusting, which is what this file is for.

**`instrument:` and `evidence:` count as "status".** An instrument is what makes an
assumption test runnable; an evidence rung is what makes a node believable. Both change
what the tree claims without adding to it. This is the arguable call, and the next section
measures it rather than defending it.

## Sensitivity: it does not matter which reading you take, only that you take one twice

The stricter reading — only nodes, links and `status:`/`type:`/`done:` — is equally
defensible. Both are measured, and both clear the bar:

| labels | rule | agreement |
| --- | --- | --- |
| wide (`instrument`/`evidence` structural) | wide (`ost_set_instrument`/`ost_set_evidence` structural) | **91.12%** ✅ |
| strict | narrow (those two tools read as commentary) | **91.97%** ✅ |
| strict | wide | 85.46% ❌ |
| wide | narrow | 84.61% ❌ |

**The six-point cliff is on the off-diagonal.** The feasibility claim survives either
definition of "the tree moved"; what it does not survive is the classifier and the thing it
is judged against using different ones. For whoever builds idle-down, that is the real
constraint this corpus establishes, and it is not the constraint the solution node
anticipated.

## What the number is made of

| subject | commits | structure | commentary |
| --- | ---: | ---: | ---: |
| `ost_create_node` | 955 | 955 | 0 |
| `ost_append_to_node` | 617 | 199 | 418 |
| *(no recognised tool)* | 581 | 40 | 541 |
| `ost_ingest_inbox` | 389 | 0 | 389 |
| `ost_set_instrument` | 187 | 187 | 0 |
| `ost_annotate` | 164 | 17 | 147 |
| `ost_edit_node` | 19 | 3 | 16 |
| `ost_set_status` | 16 | 13 | 3 |
| `ost_merge_nodes` | 14 | 14 | 0 |
| `ost_set_evidence` | 5 | 5 | 0 |
| `ost_detach_nodes` | 3 | 3 | 0 |

**199 of the 262 disagreements — 76% — are one tool.** `ost_append_to_node` writes an
identical subject whether it appended a paragraph of prose or a "## Proving this" section
carrying a wikilink to a new assumption test. Those two commits are indistinguishable from
outside and 32% of appends are the second kind.

That error is not a tuning problem. An oracle allowed to see everything a subject reveals,
and to pick each group's majority label, scores **91.80%** on this corpus. The rule is
within 0.7 points of it. Reading diffs is the only way past that, and reading diffs is the
cost the solution's cheapness argument was built to avoid.

## What was NOT done, and it is the important caveat

**No human labelled these commits.** The assumption test says "hand-label this vault's full
commit history" and is marked "to be run by a human". These labels were cut by a script
from the diffs, by a predicate transcribed from the definition the test itself supplies.

That is stronger than hand labels in one way — it is reproducible, auditable row by row,
and immune to a labeller drifting across 2,950 decisions — and weaker in exactly the way
the node cares about: **a machine transcription of a definition cannot notice that the
definition is wrong.** If "structure" as the vault's author means it is not what the
predicate computes, this corpus will agree with itself at 91% and say nothing true. A human
re-cut is the thing that would settle that, and it has not happened.

## What a green run does not settle

The assumption test's own note, which survives this corpus intact: a green exit says the
rule agrees with the labels. It does not say the labels were right, and it does not say
throttling on this signal is a good idea.

The solution's stated counter-example is untouched. The most valuable artefact of the
tetrix run that first showed the decay was a builder briefing; it was commentary-only, and
it was the last commit of the run. A classifier at 100% agreement would have idled the loop
immediately after the best thing the agent did. Detection is not value, and nothing in this
directory licenses a spending decision.
