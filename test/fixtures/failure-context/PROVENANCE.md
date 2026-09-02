# Failure-context corpus — how it was cut, and what it does and does not show

`test/telemetry/failure-context-coverage.test.ts` is the instrument for the meta vault's
assumption test **"Check past failures against the snapshot fields before building the
snapshot"**, beneath the solution **"Snapshot the resolved environment, but only for the
step that failed"**. The pre-committed bar, quoted from the node: *at least 7 of the 10
most recent recorded failures are fully explained by working directory, resolved argv,
tool versions and git SHA alone.*

The node is explicit that the test may stop the build: *below 7 of 10 the honest response
is to widen the fields or prefer "Replay a recorded failure in its recorded context on
demand", which does not have to predict what will matter.*

`scripts/harvest-failure-context-corpus.ts` re-runs the whole extraction:

```
npx tsx scripts/harvest-failure-context-corpus.ts /Users/tanner/ost-agent-meta
```

## The result, as of 2026-09-01

**Refuted: 0 of 10.** Not one of the ten most recent recorded failures is explained by any
of the four fields, and the most generous reading available (`explained + partly`) is also
zero. Nine are explained by things no snapshot of the invocation carries — seven by the
host suspending mid-response, one by an upstream 529, one by the account's weekly limit —
and the tenth has no surviving record and is counted `unread`, never as a refutation.

The control corpus comes out **2 of 2 explained**, so this is not a classifier that
answers "not explained" to everything.

## The two corpora

### `current` — the ten most recent non-refused failures

Source: the meta vault's live loop health ledger, `.git/ost-agent/runs.jsonl`, the file
`readRuns` (`src/loop/health.ts`) opens. Cut through `recentNonZeroExitSteps`
(`src/loop/replay.ts`) — the *same* function the sibling instrument
`test/loop/record-replay-sufficiency.test.ts` cuts through — so the two instruments score
the same population and their numbers can be read against each other.

`refused` steps are excluded for the reason `test/fixtures/record-replay/PROVENANCE.md`
gives at length: a step the loop refused on its spend ceiling never spawned a child, so its
`cwd`/`argv` say what *would* have run. All 19 refusals in this ledger are that.

**What the ledger actually holds is the first finding.** Of 661 recorded steps, 82 exit
non-zero; of those, 19 are spend-ceiling refusals and **all 63 remaining failures are the
same command** — a `pass`-phase `claude -p …` exiting 1. There is exactly one failing
invocation shape in this vault. The ten most recent are ten instances of it, and no cut of
this ledger could have produced a mix.

### `legacy` — the two failures of the era that motivated the branch

Source: `test/fixtures/unknown-context-price/runs-legacy.jsonl`, already committed to this
repository. These are the only recorded failures anybody ever fixed by changing a
directory, and they are the founding case for the whole opportunity — a build step run
from the home directory instead of the repo.

They are in the corpus **as the positive control**. The node's own caution is that a result
carried by the case that inspired the design is not a result; the inverse is also true, and
a census that reported "not explained" over a corpus where the fields genuinely do explain
the failures would be measuring its own classifier. Both come out `explained`, via the
corrected-re-run channel, so the classifier demonstrably fires.

They are **not** counted toward the bar. `readCensus` returns `undecidable` for any corpus
holding fewer than the ten failures the threshold names — a two-failure corpus cannot fail
a 7-of-10 bar, and allowing it to would make a short cut a way to manufacture a refutation.

## How "what explained it" was decided — two channels, neither authored

Nothing in this fixture is a judgement typed in by whoever ran the harvest. Both channels
are read off records that already existed, and both are written into `failures.json`
verbatim so a reader can disagree with the classification without re-running anything.

**Channel one — the terminating record.** Each `pass` step is a `claude -p` invocation that
writes its session to the directory the run itself names (`ceiling.sessionsDir`, stamped on
every run record — the harvest reads it from the ledger rather than guessing a path). The
join is the clock: the session whose last timestamped entry falls within 5s of the step's
recorded `at`. Every one of the current ten that matched landed inside 700ms; the tolerance
is tight on purpose, because a wide one starts matching the wrong session on a busy hour,
and that is a label the census invented rather than read. The terminating entry's text is
then classified by `TERMINATION_PATTERNS` (`src/telemetry/failure-context.ts`), committed
with the rule before the corpus was counted.

**Channel two — the corrected re-run.** The next *successful* step of the same phase running
the same payload (`payloadOf`, `src/telemetry/unknown-context-census.ts`), and which of the
four fields differed between the two attempts. This is the stronger channel: it does not ask
what *would* have explained the failure, it shows which field actually differed between an
attempt that failed and an attempt that passed.

A failure the terminating text calls field-explained but no re-run corroborates scores
`partly`, never `explained` — the node asks for *fully* explained, and one channel is not
full. On these corpora nothing lands in `partly`, so the strict and generous readings agree
and the verdict does not turn on that choice.

## Three things the cut exposed that the node does not say

**1. The recorded `cwd` would not have discriminated the founding case.** Both legacy
failures were fixed by inserting `cd <repo> &&` *inside* the `bash -c` payload. `loop step`
stamps the directory it spawned from, not the one the shell then moved to — so the failing
build at `2026-07-27T15:56:45Z` and the passing re-run 73 seconds later carry the **same**
recorded `cwd`, `/home/user/ost-agent-meta`. The discriminability reading says so:
`cwd: cannot-discriminate` on the legacy corpus. The corrected-re-run channel catches it
only because the `cd` is visible in the command *text*. A snapshot field that records where
the recorder stood is not a record of where the work happened, and the one case everybody
agrees the field explains is a case the field as currently written down does not separate.

**2. The git SHA looks like it explains everything, and explains nothing.** On the current
corpus the ten failures carry ten distinct `headBefore` values and the 299 successes carry
299 more, with zero overlap. Read naively that is a field which perfectly separates every
failure from every success — in *any* ledger where runs do not share a commit, which is all
of them. `discriminate` reports that as `uninformative` rather than `discriminates`, and the
distinction is the difference between a finding and an artefact of cardinality.

**3. The failing step cannot be diffed against anything, by construction.** The node states
this as its worst case — *a flaky step is the hardest case and this handles it worst … you
get a snapshot of the failing attempt but nothing to diff it against, because the passing
run recorded nothing.* Over this ledger the worst case is not a corner: it is 100% of the
population. Every `pass` failure carries a `claude -p` argv whose prompt embeds the current
tree, so no two invocations are ever textually identical and no corrected re-run can be
found for any of them — `rerun` is absent on all ten. The one channel that could have proven
a field mattered is unavailable for every failure this vault records.

## What is mechanical and what is authored

Everything in `failures.json` is mechanical: read verbatim off the two ledgers and the
session transcripts, redacted with `redactSecrets` (`src/adapters/transcript.ts`) and capped
at 400 characters for termination text and 200 per argv element. No failure is synthetic and
none was dropped. The `phases` field records which phases the cut landed on, and the success
projections are restricted to those phases — a `sense` step legitimately runs from a
different directory than a `build` step, and mixing them would report `cwd` varying for a
reason that is not a failure.

Two argv projections are committed, because the reading turns on which one you take.
`fieldsFull` is the resolved argv exactly as the node words it, prompt included, which makes
every `pass` argv unique. `fieldsShape` reduces it to executable plus option *names*, which
makes them all identical. The first reads `uninformative`, the second `cannot-discriminate`,
and neither reads `discriminates` — so the verdict survives either choice. That is the point
of committing both.

## What this result does and does not settle

It settles the feasibility question the node asked, for this vault, today: the four fields
do not carry the failures this loop actually has. It does **not** say the fields are
worthless — the control corpus is two real failures they do carry, and a vault whose loop
ran shell build steps rather than one long agent invocation would very likely score
differently. What changed is not the value of the fields but the population: the sibling
"Every recorded step carries the directory and argv it actually ran with" shipped, `loop
step` now stamps `cwd` and `argv` unconditionally before it spawns anything, and the
wrong-directory failure class has not recurred since 2026-07-27. The failures that replaced
it are host, upstream and quota events.

It also does not settle desirability, which the node says in its own words: *whether an
operator would trust an enriched record enough to stop re-running the failure by hand … no
coverage count reaches it.*

**And it names a field nobody proposed.** The thing that explained 9 of the 10 is the
terminating text of the failing process — an API error the child wrote and the step record
does not keep. It is not one of the four, and it is not one of the five the solution's prose
lists either. This census could only read it by going outside the record, to a transcript
that happens to survive; for the one failure whose transcript did not, the answer is
`unread`. A record that kept the child's last words would have explained nine of ten on its
own.
