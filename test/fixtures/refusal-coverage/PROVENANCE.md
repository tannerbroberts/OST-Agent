# The refusal corpus — why this directory holds no corpus

`test/preflight/manifest-covers-observed-refusals.test.ts` counts what fraction of the
distinct refusal classes this project's passes hit could have been named by a manifest
folded out of tool schemas. It reads its corpus from
**`test/fixtures/path-failure-attribution/failures.jsonl`** — the file
`test/friction/path-failure-attribution.test.ts` already reads — and cuts nothing new.

That is deliberate, and it is the strongest property this census has.

## Why re-use rather than re-cut

The obvious move was to harvest a fresh corpus of refusals from
`~/.claude/projects` and commit it here. The problem with it is the problem this
repository has already had to withdraw findings over: a corpus cut by the pass that is
about to count it is a corpus whose cut can be tuned, consciously or not, to the number it
wants. Nobody can tell from the outside whether a row was kept because it belonged or
because it helped.

`failures.jsonl` was cut on 2026-08-09 for a different question — which of the path
failures a pass hit arrived through a tool this repository controls (PR #84). Its rule was
"every failing tool call, kept whole, nothing selected", precisely so that its own census's
negative direction survived. It contains 719 rows from 646 session transcripts across every
project on the machine, and 643 of them were irrelevant to the question it was cut for.
Those 643 are where most of this census's classes live.

So the rows here were chosen by somebody who did not know this measurement would be taken
over them. That removes "which refusals were chosen" as a question about the finding, in a
way no fresh cut of mine could have.

## What the corpus is

| Property | Value |
| --- | --- |
| Rows | 719 failing tool calls |
| Sessions | 646 transcripts under `~/.claude/projects`, all depths |
| Cut rule | every `tool_result` with `is_error: true`, paired to its `tool_use` by id |
| Fields | `session`, `tool`, `command` (Bash only), `error` — all `redactSecrets`-ed |
| Bounds | `error` clipped to 800 chars, `command` to 600, head-and-tail with `…` between |

See `test/fixtures/path-failure-attribution/PROVENANCE.md` for the cut in full.

## How this census divides those 719

- **330** are tool preconditions and fall into **24 distinct classes**. That is the
  denominator every share is over.
- **374** are `subprocess-failure` — a program's own exit code (`ls: -d: No such file`,
  `Exit code 143 Command timed out`). A program answering its own arguments is not a tool
  refusing a precondition, and admitting them would drown the question in shell noise.
- **10** are `user-declined` — a human saying no to one specific call. Not a rule that
  existed before the call, so not a rule a manifest could have carried.
- **5** are `remote-failure` — HTTP 404, `ENOTFOUND`, a request timing out. The
  precondition, if there is one, is the remote's and not the tool's.
- **0** are unclassified. The test asserts that by name; a census with an unnamed blind
  spot is the shape this repository has been wrong in before.

Every exclusion is published as a count in the census output rather than defended in prose,
so a reader who disagrees with one can see exactly what it costs.

## What this corpus cannot support

- **It is one machine's record.** 24 classes is a fact about eleven months of one
  developer's work across two vaults and one repository, not a population estimate of how
  many preconditions exist on a tool surface in general.
- **It is bounded by what a transcript keeps.** A refusal in a session whose transcript has
  been rotated away is not here, and nothing in the count can see it.
- **It says nothing about whether a manifest changes behaviour.** The census measures what
  a manifest *could carry*. Whether a run that receives one composes fewer colliding calls
  is a separate, behavioural claim — and this project already ships a partial instance of
  the idea (the corrections header in the unattended prompt) that sessions kept hitting
  refusals around.
