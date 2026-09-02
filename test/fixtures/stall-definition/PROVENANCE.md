# Stall-definition corpus — how it was cut, and what it does and does not show

`test/loop/stall-definition-replay.test.ts` is the instrument for "Replay historical runs
against a stall definition" — the assumption test beneath "Supervisor heartbeat with
automatic restart" in the meta vault. The pre-committed threshold is a confusion matrix
over runs that already happened: **every known stall detected AND zero false alarms on the
healthy runs.**

Read the last two sections before believing the green. The two halves of that threshold
are not equally measurable against this corpus, and the difference is the finding.

## The cut

The source is the meta vault at `/Users/tanner/ost-agent-meta`, and three files it already
had. `scripts/harvest-stall-definition-corpus.ts` re-runs the extraction exactly:

```
npx tsx scripts/harvest-stall-definition-corpus.ts /Users/tanner/ost-agent-meta
```

1. `.git/ost-agent/runs.jsonl` (`readRuns`) — every firing's window and the verdict it
   sealed with. **All 369, not a sample:** 282 `healthy`, 85 `unhealthy`, 2 `no-op`,
   2026-08-02 (the ledger's own start) through 2026-09-02.
2. `.git/ost-agent/journal.jsonl` (`readJournal`) — every line each run wrote forward,
   reduced to its timestamp. 280 of the 369 runs have journal lines; the journal starts
   later than the ledger.
3. `git log --format=%aI` — every commit in the vault, kept where it falls inside a run's
   window. This is the mark that matters, and the section below says why.

Only timestamps and the verdict word cross into `runs.json`. No command, path, prompt or
commit subject: the definition reads *when* something happened and nothing else, so a
corpus carrying content would be carrying material the measurement cannot use and a
redactor would have to guard. Offsets are stored relative to each run's start.

## Why commits are in the corpus at all

The obvious definition — silence in the journal — cannot work, and the corpus is what says
so rather than an argument. A discovery firing writes `open`, one `step` line when the pass
process finally exits, and `seal`. Nothing is written *during* the pass, so "time since the
last journal line" equals "time since the run opened" for the whole of the only step.

Measured over this corpus, journal lines alone:

| population | longest silence while alive |
| --- | --- |
| firings that moved the tree (282) | **244.6 min** |
| firings that sealed `unhealthy` (85) | 316.9 min |

Those overlap, so no threshold on journal silence separates them. Fold in commits — every
mutating tool commits (`git add -A`, `src/git/safe-git.ts`), so a commit during a run is
the pass demonstrating it did something — and the same measurement becomes:

| population | longest silence while alive |
| --- | --- |
| firings that moved the tree (282) | **95.3 min** |
| firings that sealed `unhealthy` (85) | 230.5 min |

`PROGRESS_SILENCE_BUDGET_MS` (120 min) sits in that gap. The replay test asserts the 95.3
against the corpus, so the margin is structural: a corpus that grows a longer live silence
fails the build rather than turning into a false alarm in the field.

## What the false-alarm half rests on: 282 real firings

The negatives are the firings the ledger calls `healthy`, and that word is not a synonym
for "finished fine" — `computeVerdict` returns it only when HEAD differs before and after,
so each of these is a firing that demonstrably produced work and was therefore
unambiguously alive for its whole open window. The test evaluates the definition at every
instant of every one of those 282 lives (every moment silence peaks, which is all that is
needed since the assessment is monotone between marks) and requires zero flags.

`unhealthy` firings are deliberately **not** in the negative set. Such a firing might have
been working hard and failed at the end, or might have hung — the record does not say
which, and counting them as negatives would force the budget above 230 minutes on the
strength of a guess.

## What the detection half rests on: nothing observed

**This corpus contains no run that any recorder ever labelled stalled.** Not one `crashed`
verdict in 369 firings, not one `crash` line in the journal, not one unsealed run. The
`.ost-agent/runs/` directory the assumption test names by hand holds 15 per-phase records
from 2026-07-24/25, superseded by the ledger above; 14 are `done: true` and the fifteenth
is `done: false` with an authentication error — a failure that reported itself, not a
stall.

So the "every known stall detected" half has an empty positive set, and a test that
reported it satisfied would be reporting a green earned by counting to zero. Two things
follow, both in the instrument:

- Detection is measured against **reconstructed deaths** — a real run's own marks, cut at
  the point a process would have died, with no seal. Every mark in one is a mark that
  really happened at the time it really happened, but it models exactly one way of dying:
  a process that stops emitting. It does not model a pass that keeps emitting while making
  no real progress, which is the failure the node calls "restarts a subtly broken pass
  forever" — nothing here detects that.
- The zero is **pinned as an assertion**, so the day a real stall lands in the record the
  test fails and whoever re-cuts the corpus has to face sensitivity with a positive in hand.

## What a green result does and does not show

Green says: over every firing this vault has recorded, a definition of progress built from
journal lines and commits raises zero false alarms on the 282 that demonstrably moved the
tree, and flags a run whose marks stop once two hours have passed. It would have raised a
report on four `unhealthy` firings while they were still open.

It does not say automatic restart is safe, and the solution node's own text draws the same
line. A detector whose sensitivity has never met an actual stall is a reporter's input, not
a killer's, which is why `liveness.ts` is classified as a pure module in
`test/release/gate-f-deciders.test.ts` and reaches no exit code: `loop health` prints it and
nothing else consumes it.

It also does not say detection is fast enough to matter. A firing in this vault that was
working normally went 95 minutes without producing anything observable, so zero false
alarms costs a detection latency of at least that. Sub-hour detection is not a tuning
question — it needs the pass to emit a heartbeat it does not currently emit.
