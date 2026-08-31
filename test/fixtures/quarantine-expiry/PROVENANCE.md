# Quarantine-expiry timelines — how they were cut

`test/telemetry/quarantine-expiry-period.test.ts` replays every quarantine this project
ever opened against every candidate expiry period, to answer one question the solution
"quarantine entries expire, so a workaround cannot become permanent by inattention" cannot
be built without: **is there a period that would have helped?**

The timelines live here rather than being recomputed, because three of the five dates each
one carries cannot be read mechanically — see *What a machine could not do* below. This
file records exactly what was taken and where each date comes from, so anyone can disagree
with the cut instead of with the verdict.

## What is here

| File | What it is |
| --- | --- |
| `timelines.jsonl` | The four quarantines on record, one per line — the flake first, then the three that were not one. |

## The subjects, and why these four

The population is the four distinct test files this project has ever suppressed by typing
an exclusion into a runner invocation. That set is not asserted here — it is the output of
`test/telemetry/hand-exclusion-census.test.ts`, which read 657 session transcripts and
found 19 exclusions across 14 invocations, and the replay asserts its own subjects against
that census's committed corpus (`test/fixtures/hand-exclusion/exclusions.jsonl`) rather
than restating them. If the census's number moves, this replay's subject list fails first.

A flake nobody excluded and nobody filed is invisible to both. That is the honest limit
here: this replay can say what an expiry would have done to the quarantines that happened,
and it cannot see one that was never typed.

## Where each date comes from

**`quarantinedAt` / `lastExcludedAt` / `exclusions` / `sessions`** — the hand-exclusion
corpus, verbatim. The expiry clock starts at the first hand-typed exclusion, because that
is the moment an entry would have been written.

**`firstObservedAt`** — the earliest recorded failure of that file. For
`wall-clock-budget.test.ts` that is the friction note filed at 2026-08-01T19:30:22.444Z
(`.ost-agent/friction/2026-08-01-friction-wall-clock-budget-test-flaked-once-…`), which is
three days before the exclusion. For the other three there is no record earlier than the
exclusion itself.

**`resolvedAt` / `resolutionEvidence`** — read from git, and classified by
`ResolutionEvidence`. Two classes are resolutions; three are not, and
`QUARANTINE_EXPIRY_RULE.doesNotCount` states why on each. The one that matters:
`record-ends` — "the failure simply stops appearing" — is **not** scored as a resolution,
because nobody mentioning something again is precisely the inattention this candidate
exists to defend against, and counting it would let the sweep grade the candidate on the
outcome the candidate is meant to prevent. The test runs the sweep both ways anyway, so a
reader can see the verdict does not turn on that choice.

- The three `test/release/*` files: **94b43a9** (`feat(gate-f)`, 2026-07-29T21:38:31-05:00
  = 2026-07-30T02:38:31Z) committed the `src/loop` files the excluding session's own
  command line names as the cause — it printed `=== the failure's cause is entirely
  untracked src/loop files ===` beside the exclusion. Resolution lands 40–46 minutes after
  each entry was opened.
- `test/mcp/wall-clock-budget.test.ts`: **no resolution exists.** The file is byte-identical
  to its first commit (3fd68a8, 2026-07-30) — `git log --follow` returns exactly one commit
  for it — so `BUDGET_MS = 2000`, an absolute bound with no tolerance for suite-level
  contention, is still the assertion in the suite today. That bound is the root cause both
  friction notes name. 4d000fd (2026-08-17, #138) built a same-run baseline-ratio instrument
  *beside* it and left this one in place, which is a replacement measurement rather than a
  repair.

**`priorResolutionClaims`** — dates this record asserted the failure was over and then
contradicted. They are never scored as resolutions; they are kept because the sweep is
scored against resolution dates, and this record produced two wrong ones for the same
failure inside three days:

- **2026-08-02, `declared-retired`.** `.ost-agent/NEXT-BUILD.md`, twenty-fifth pass: *"Four
  clean runs against two flaky ones is enough to close this out: calling the flake retired
  rather than carrying it forward again."* Seven later passes repeat that the call "stands".
  No code changed. The pass log carries a date without a time; midnight UTC is the earliest
  moment consistent with it, which is the reading most generous to the claim.
- **2026-08-03T20:18:49Z, `cause-fixed-in-commit`.** cc4ea95 (`perf(buildable)`) — CI caught
  `ost_next_work` at 3151ms against the 2000ms budget *in this very test*, and the quadratic
  `testsUnder` scan was replaced with an index. `git merge-base --is-ancestor cc4ea95
  c2f767d` exits 0, so that fix was already in the tree the 2026-08-04 session was working
  in when it excluded the test ten times, 21 hours later.

Both were falsified at 2026-08-04T17:08:34.672Z by the first of those ten exclusions.

**`forgottenAt`** — the last dated act on that failure by anybody: an exclusion, a filing,
or a commit that names it. After that date an expiry fires into an empty room. It is read
from the record rather than modelled, deliberately: a rule like "forgotten fourteen days
after the last mention" would introduce a second guessed constant in order to score a
sweep whose entire purpose is to avoid shipping on a guessed one. Where the record allowed
a choice it was read **generously, in the candidate's favour** — the wall-clock flake is
credited with attention all the way to 4d000fd on 2026-08-17, sixteen days past its last
exclusion, because that commit replays its two 2026-08-01 failures by name.

**`flake`** — whether the failure was non-deterministic at all. One of the four was. The
other three are a subagent working around failures its own uncommitted files were causing,
three of them inside two minutes, in a state that was gone by its next commit. They are
kept in the population because they are quarantines that really happened, and reported
separately because nobody would have committed an entry for them.

## What a machine could not do

`resolvedAt`, `forgottenAt` and `flake` were each read by a person out of prose — a commit
message, a friction note's context line, a pass log's narrative. Nothing in this repository
extracts them, and this replay does not pretend to: it reads a committed timeline. That is
a cost worth naming, because it means the sweep cannot be re-run against next quarter's
record without the same hand reading. The dates it *can* take mechanically —
`quarantinedAt`, `lastExcludedAt`, `exclusions`, `sessions` — come from the hand-exclusion
corpus and are checked against it by the test.

## Fidelity

Everything here is dated from a source that already existed before this replay was written:
the hand-exclusion corpus (cut 2026-08-10), two friction notes (2026-08-01), the pass log
in `.ost-agent/NEXT-BUILD.md`, and four commits in this repository's history. No timestamp
was invented, and the one date-only source is marked as such above.
