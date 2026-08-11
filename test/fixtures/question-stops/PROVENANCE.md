# Question-stop corpus — how it was cut, and how the answer key was read

`test/loop/question-stop-independence-replay.test.ts` asks whether a run can tell, at the
moment it hits a fork it cannot take, which of its remaining work is independent of the
answer it does not have. The assumption test it implements ("Blind-judge what could have
continued, before reading the answer that was given", in the meta vault) pre-committed its
corpus and its bar before this fixture existed: **the seventeen `AskUserQuestion` events
across nine captured transcripts**, at least 12 of 17 stops agreeing, at most 2
false-independent calls across the whole set.

## The cut

The candidate pool is every transcript the meta vault held a `TRANSCRIPT:` evidence record
for on 2026-08-03, the day the assumption test was written — ten transcripts, 25 asks.
Two reductions, both mechanical, produce exactly the test's stated corpus:

1. **Fork deduplication.** `7e982096` and `16e9596b` share first-ask timestamps to the
   millisecond — Claude Code writes a resumed conversation as a second transcript
   replaying the same asks. Same rule as `test/fixtures/question-budget/PROVENANCE.md`:
   the longer transcript is kept (`16e9596b`, 611 entries vs 581). Drops 7 asks.
2. **Answered asks only.** `16e9596b` entry 609 was asked and never answered — the
   session ended first. A stop with no unsealed remainder has no answer key to compare
   against. Drops 1 ask.

25 − 7 − 1 = **17 stops across 9 conversations**, which is the count the assumption test
states. `scripts/harvest-question-stops.ts` re-derives the mechanical fields (entries,
timestamps, answered status, dedup) from the raw transcripts and is committed so the cut
can be re-run rather than trusted.

## What is mechanical and what is authored

The ask fields — session, entry, timestamp, question text, options, the recorded answer —
are read verbatim out of the transcripts. Two fields are **authored readings**, and saying
so plainly is the point of this file:

- **The outstanding-work lists.** The sessions in this corpus mostly did not use a task
  tool; their remaining work lives in their own prose ("Task 6 (next) deletes…", "Let me
  check two things before I write up the design"). Each item is a paraphrase of work the
  transcript names as outstanding at ask time, with the entries it was read from cited in
  its `why`. Item wording was written to describe the work as it was visible *at the ask*
  — an item must not smuggle the answer (or the dependence) into its own text.
- **The `turnsOnAnswer` labels.** Read off the unsealed remainder: an item is dependent
  when the session's handling of it, once it had the answer, took a shape the answer chose
  (a commit that landed where the answer said, a task the answer added, work the answer
  stopped); independent when it proceeded with no reference to the answer. Every label
  cites the post-ask entries it was read from.

## What the replay does and does not certify

The classifier under test (`QUESTION_DEPENDENCE_RULE`, `src/loop/question-bank.ts`) sees
only what was visible at ask time: the question, the options, and each item's text. It
never sees the answer, the labels, or anything after the ask. That is the blindness the
assumption test demands, and the test enforces it structurally by what it passes in.

Two honesty limits, stated before the number is believed:

1. **The rule was authored against this corpus.** The same pass wrote the dependence
   criteria and these labels, so the agreement figure is in-sample. The test pins it as a
   regression bar — the criteria are named so they can be argued with, and any edit that
   degrades the partition fails loudly — but it is not evidence of generalization. The
   sibling assumption test in the vault ("Draft the decision classes from the older half
   of the stops and test them on the newer half") is the holdout that question belongs to.
2. **The item lists are reconstructive.** A live run banking a question would name its own
   outstanding work; here the list was transcribed by a reader who had seen the whole
   transcript. The wording discipline above is the guard, but it is discipline, not
   structure.

The direction of the rule's errors is the deliberate part: on this corpus every
disagreement is a conservative one — independent work misread as dependent, which costs
throughput, never a false-independent, which costs correctness. The assumption test's own
framing says those are not equally important, and the rule is tilted accordingly.

## The holdout: drafting from the older half, placing the newer

`test/loop/authority-class-holdout.test.ts` implements the sibling assumption test named
above ("Draft the decision classes from the older half of the stops and test them on the
newer half"). The same seventeen stops, ordered by `askedAt`: the oldest eight are the
drafting pool for the authority contract's decision classes
(`src/loop/authority-contract.ts`, each class citing the drafting stops it was read from),
and the nine newest are placed against those classes in `holdout-placements.json` — each
placement allowed to reference only a class already written, with `null` where no clause
covers the stop.

What is mechanical: the split by timestamp, the rule that no class may cite a stop newer
than the cutoff, the rule that no placement may name a class outside the contract, the two
pre-committed bars (at least 6 of 9 covered, at least 4 of 9 proceed-classed), and the
fixed placement of the gate-refusal stop (`3d729ebc@129`) in the never-proceed governance
class. What is **authored**: the class clauses and the placements' whys, exactly as the
`turnsOnAnswer` labels above are authored readings.

The honesty limit, stated before the green is believed: both halves were performed by one
agent in one pass, and that agent had access to the whole corpus. The sealing is
procedural — the contract was written and committed citing only pre-cutoff stops before
the placements were written, and the citations are the audit trail — but it is discipline,
not structure. A reader who suspects fitting should argue with the clauses by name: each
placement's `why` states which criteria placed it, and a clause that only makes sense in
the light of a held-out stop is the tell to look for. The two uncovered stops (`a615eb46@362`,
`0d27cebf@106`) are the drafting window's real edge: both are about the run's own
persistence, cadence and spend, of which the older eight contained no instance.
