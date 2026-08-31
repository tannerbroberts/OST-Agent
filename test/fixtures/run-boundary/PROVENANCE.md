# Run-boundary corpus — how it was cut, and what it does and does not show

`test/loop/run-boundary-from-history.test.ts` implements "Try to bound five past runs
within the commit history without being told where they started" — the assumption test
beneath "Reconstruct what finished from the commit history, so no run has to be trusted to
report", in the meta vault. The pre-committed bar, fixed before this corpus existed, is
**at least 4 of 5 runs bounded correctly from the history alone**.

The measured result is **317 of 319 (99.4%)**.

## The cut

The source is the OST-Agent meta vault's own git history at `/Users/tanner/ost-agent-meta`,
HEAD `8cbf191dd4dbb2f14aed74b427bb1b93b5adbdb2`, the 1,500 commits from
`b86a1022` (2026-08-14T23:35Z) to `497b12b1` (2026-08-31T12:43Z).
`scripts/harvest-run-boundary-corpus.ts` re-runs the extraction exactly:

```
npx tsx scripts/harvest-run-boundary-corpus.ts \
  /Users/tanner/ost-agent-meta ~/.claude/projects/-Users-tanner-ost-agent-meta \
  test/fixtures/run-boundary --until 2026-08-31T13:00:00Z --limit 1500
```

**This is every commit in the window, not a sample.** No commit was dropped for being
awkward, and the test asserts the row count, the uniqueness of the SHAs and their ordering
so that a later re-cut cannot quietly become a selection. `--until 13:00Z` is 20 minutes
behind the cut; it is there so that a run still in flight at harvest time is not half in
the corpus.

Each run is described twice, through two deliberately unequal windows, and the inequality
is the entire reason the number means anything:

- **`git log`** — sha, subject (verbatim to 240 characters), author name and email, author
  date, committer date. This is all the rule (`src/loop/run-boundary.ts`) ever sees. The
  240-character cap only bites on `ost_ingest_inbox`, whose subject folds a per-channel
  report into the first line and runs to a kilobyte; every tool name and every marker the
  rule reads sits in the first eighty.
- **The Claude Code session transcripts** under `~/.claude/projects/…`, which git has never
  seen and which nothing in `src/` reads. These are the only input to the labels.

If both sides read the commit log, agreement would be 100% and would measure nothing. What
is actually being asked is whether the log can be made to say where a run began and ended
without the run being asked.

## The label predicate

Two kinds of run, labelled two ways, because the two loops leave different traces.

**Discovery passes — call-level match, the strong label.** A transcript records
`mcp__ost-agent__ost_append_to_node` at 10:02:39; the vault carries a commit whose subject
names `ost_append_to_node` at 10:02:39. The commit is that session's. Every one of the
1,500 window's `mcp:` commits matched exactly one session this way — `unmatchedToolCommits`
and `ambiguousToolCommits` are both **0**, and the test asserts it, because a harvest that
starts dropping the awkward ones is choosing its own corpus. This label never touches the
gap between commits, the author, or the run's shape, which is everything the rule uses.

**Build firings — session-window match, the weaker label.** The build loop's instrument
sweeps are run by the shell *around* the builder session rather than by the session, so
there is no tool call to match. The label is instead "every `chore(instruments)` commit
between the session's first transcript event minus 600s and its last plus 1,200s". Weaker,
and deliberately free of the subject forms the rule keys on — it is a time window and
nothing else — so the rule cannot score its own assumption back.

Which kind a session is comes from the transcript, not the commits: a session that wrote
through the MCP surface is a discovery pass, one that did not is a builder session.

## What was dropped, and why that is not the same as dropping the failures

Two filters remove labels, both counted in `corpus.json` (`droppedContestedLabels: 15`,
`droppedClippedLabels: 0`) and both pinned by the test, so a re-cut that starts discarding
labels to move the score shows up as a change to those numbers rather than as a better
result.

- **Contested (15 sessions).** Two builder sessions can be open at once, and a padded time
  window is not sharp enough to say which of them a sweep belongs to. Where one commit was
  claimed by two sessions' windows, *both* labels come out — neither firing's extent is
  established by the record, and keeping one would be inventing an answer the record does
  not give. Dropping only the one that scored badly would be worse than either.
- **Clipped (0).** A run the 1,500-commit window cut in half cannot be scored: label and
  reconstruction are truncated by the same edge, so agreeing about it says nothing. Judged
  from the session window, which is the independent record, not from where the commits land.

**This filter was written after seeing that it removed misses, and that is worth stating
plainly.** On the first cut of this corpus (600 commits, no filters) the rule scored 105 of
115, and three of the ten misses were contested build labels. The filter is defensible on
its own terms — a corpus where two labels claim the same commit is a corpus contradicting
itself, and no rule can be right about both — but a reader who does not accept that should
read the score as the pre-filter one. Both clear the bar with room; neither is close to it.

## What the number is, sliced

| slice | bounded |
| --- | --- |
| all labelled runs | 317 / 319 (99.4%) |
| runs of 2+ commits | 293 / 295 (99.3%) |
| runs of 3+ commits | 130 / 132 (98.5%) |
| discovery passes | 168 / 169 (99.4%) |
| build firings | 149 / 150 (99.3%) |

"Bounded" is commit-set equality, which is strictly harder than naming the right endpoints:
it also requires that nothing else was swept into the span. The corpus has 565 commits of
one run sitting inside the wall-clock span of another, so that is not a hypothetical.

24 of the 319 runs wrote a single commit, and bounding one of those is free. The slices
above are asserted separately for that reason.

## What the alternatives score on the same corpus

The solution node proposes reading "the commits between the run's first and last", with
arrival time separating one run from the next. Measured:

| rule | best threshold | bounded |
| --- | --- | --- |
| idle gap alone | 600s | 86 / 319 (27.0%) |
| actor split + idle gap | 1,800s | 267 / 319 (83.7%) |
| actor split + opening marker + idle gap | 480–900s | 317 / 319 (99.4%) |

The 27% is the number to carry, not the 99%. Everything above it comes from knowing which
loop wrote each commit and what that loop's first act looks like — a contract with *this*
repository's loops, not a property of git. A vault whose loops have no recognisable opening
act should expect the first row.

The middle row is the one that decides between two defensible rules, and it decides on
stability rather than on its peak: actor-split-plus-gap reaches 83.7% at 1,800s and falls
to 56.4% at 600s and 5.6% at 5,400s, so its answer is a property of its threshold. With the
marker the score is flat at 99.4% across 480s–900s and clears the bar everywhere from 300s
to 1,800s, because the gap is only being asked to separate two markers rather than to find
the boundary itself.

## The two misses, named

- **`discovery:e1f4855f`** — a pass that went quiet for 17 minutes before its *closing*
  ingest, so the closing act reads as an opening one and the pass comes out as two runs.
  This is not fixable from git: the discovery loop opens and closes with the same call, and
  the two commits are the same kind of event byte for byte. Closing it means giving the
  loop a distinguishable closing act, which is a change to the brief.
- **`build-loop:85aae0ea`** — the label's 1,200s trailing pad swallowed the *next* firing's
  opening sweep, so the label says three commits and the rule says two. This one is most
  likely the label being wrong rather than the rule; it is kept, and counted against the
  rule, because tightening a pad after seeing which way it fell is how a corpus stops
  meaning anything.

## What a green run does not settle

It proves the boundaries are recoverable, not that the account inside them is worth reading.
The solution's own stated weakness survives every assertion in the test: **a run that wrote
nothing is not here at all.** An hour spent correctly concluding that nothing needed doing
leaves no commit, so this reconstructs it as an hour that did not happen. No threshold moves
that, and no exit code touches it.

The assumption test's design asks for a *second person* given only the history. Nobody was
asked; a program was written instead. The design says which direction that errs in — "a
person doing this by eye may use cues a program could not, so success here is an upper bound
on what an automated reconstruction would achieve" — so the number above is a **lower** bound
on the question as the node framed it, which is the direction that can be acted on, because
the program is the thing that would run unattended.
