# Record-replay corpus — how it was cut, and what it does and does not show

`test/loop/record-replay-sufficiency.test.ts` implements the mechanical half of "Try to
reproduce ten recorded failures from the record alone" (the assumption test beneath
"Every recorded step carries the directory and argv it actually ran with", in the meta
vault): whether the record carries enough — `cwd` and `argv` — to reconstruct an
executable invocation. The pre-committed bar is **at least 5 of 10**.

## The cut

The source is the meta vault's own loop health ledger, `.git/ost-agent/runs.jsonl` under
`/Users/tanner/ost-agent-meta` — the same file `readRuns` (`src/loop/health.ts`) reads.
`scripts/harvest-record-replay-corpus.ts` re-runs the extraction exactly:

```
npx tsx scripts/harvest-record-replay-corpus.ts /Users/tanner/ost-agent-meta
```

1. Flatten every step of every recorded run.
2. Keep steps with a non-zero `exit` **and no `refused` marker** — see "What was
   deliberately excluded" below.
3. Sort by the step's own `at`, newest first, and keep 10.
4. Redact (`redactSecrets`, the same masking `src/adapters/transcript.ts` applies before
   committed fixtures elsewhere in this repo) and cap each `argv` element at 200
   characters, since several of the ten are `claude -p <prompt>` invocations tens of
   kilobytes long. The cap changes nothing the test measures: {@link reconstructInvocation}
   only checks that `cwd` and `argv` are present and well-formed, never their content.

As of 2026-08-19, that cut is entirely `pass`-phase steps, `claude -p …` exiting 1,
2026-08-09 through 2026-08-16. That is not a curated sample — it is what the ten most
recent real non-refused failures in this vault's ledger actually are.

## What was deliberately excluded, and why that is a finding, not a cleanup

The **literal** 10 most recent non-zero exits in the real ledger, unfiltered, are ten
`check --vault .` steps that all carry `"refused": "spend-ceiling"` and `"exit": 13`, one
after another. Every one of them carries perfect `cwd` and `argv` — trivially, because the
CLI stamps both from its own process state *before* the spend-ceiling check runs
(`src/cli/loop.ts`, the `refused: "spend-ceiling"` branch), never from a child process that
was spawned and observed. A refused step is not a command that ran and failed; it is a
command that was never attempted, and its `cwd`/`argv` say what *would* have run, not what
did.

Had this corpus been cut from the literal top 10 without excluding those, the assumption
test's own 5-of-10 bar would be cleared **by construction**, on data that cannot fail it
and that exercises none of the reproducibility question the test exists to ask — none of
the ten would ever reach "still not reproducible," the bucket the assumption test's own
body calls the point of the exercise. `recentNonZeroExitSteps` (`src/loop/replay.ts`)
excludes `refused` steps for exactly this reason, and this fixture is cut through that
function rather than around it.

## What is mechanical and what is authored

Everything in `steps.json` is mechanical — read verbatim off the real ledger, through
`recentNonZeroExitSteps` and the redaction/cap above. No field is invented; there are no
synthetic entries mixed in to make the "still not reproducible" bucket interesting. What
follows from that: this fixture cannot exercise a record missing `cwd`/`argv`, because no
step in this vault's ledger since 2026-08-02 (the ledger's own start) lacks them — the
2026-07-27 fix has held for every failure recorded since. Unit tests directly against
{@link reconstructInvocation} (not this fixture) cover the missing-field cases, since a
real example of one is not available to cut.

## What a green result does and does not show

Green says: of the 10 most recent real non-refused failures, at least 5 carry a record
sufficient to reconstruct the exact invocation. It does not say running that reconstructed
command reproduces the original exit code — that is a person's judgement, per the
assumption test's own "who runs it: a human." It also does not say anything about `check`
or `pnpm`-shaped failures, the kind the fix was originally motivated by: this cut, being
mechanical and time-ordered rather than stratified by phase, happens to land entirely on
one recurring `pass`-phase failure. A corpus cut on a day with a wider mix of failing
phases would test more of the surface the fix claims to cover; this one tests what this
vault actually had.
