# The two ledgers the refuse-on-unknown-context price was taken over

The assumption test "Measure how much signal a refuse-on-unknown-context rule
would delete" says to take the last hundred recorded steps. This vault has two
files that look like that list, and only one of them is it. Both are committed
here, because the difference between them is most of the finding.

## `runs-current.jsonl` — the ledger the loop actually keeps

The corpus the threshold names. `readRuns` resolves the health ledger to
`<vault>/.git/ost-agent/runs.jsonl` (`src/loop/state.ts` explains why it lives
inside `.git`: every mutating MCP tool commits with `git add -A`, so a record in
the working tree is swept into the next `mcp:` commit). Taken from the
`ost-agent-meta` vault on 2026-08-31 at vault commit
`b3a88897661091d963b39d42acee618de88aa928`, the whole ledger was **347 runs and
625 recorded steps**, of which **none** is missing `cwd` and **none** is missing
`argv`. 82 of those 625 steps failed.

What is committed here is the newest 54 runs — 101 steps, spanning
2026-08-28T07:55:59Z to 2026-09-01T02:57:30Z — enough to cover the hundred the
threshold names with one to spare.

`scripts/harvest-unknown-context-corpus.ts` re-runs the cut exactly:

```
npx tsx scripts/harvest-unknown-context-corpus.ts /Users/tanner/ost-agent-meta
```

**It is a projection, and here is exactly what was changed.** Per step, kept:
`phase`, `command`, `argv`, `cwd`, `exit`, `durationMs`, `at`, `refused`. Per run,
kept: `runId`, `startedAt`, `cliVersion`, `verdict`. Everything else on the run
record — `goal`, `stopCondition`, `toolSurface`, `degradations`, `fallback`,
`ceiling`, `headBefore`/`headAfter` — was dropped. Every `command` and every
`argv` element went through `redactSecrets` (the same masking
`src/adapters/transcript.ts` applies before every other committed corpus in this
repo) and was capped at 160 characters with `…[truncated N chars]` appended. The
full ledger is 42 MB, almost all of it the `claude -p "<the whole brief>"` string
on every `pass` step.

None of that can move the count. The predicate reads whether `cwd` is present and
absolute, whether `argv` is present and non-empty, and whether `command` is
non-empty — redacting or truncating a present string leaves it present and
non-empty, and no dropped field is read at all.
`test/telemetry/unknown-context-refusal-cost.test.ts` does not take that on trust:
where the live vault is reachable it runs the same census over the untruncated
ledger and holds the two to the same refusal count.

**The zero is corroborated by work that already shipped.** "Every recorded step
carries the directory and argv it actually ran with" was built and its instrument
discharged (`src/loop/replay.ts`, `test/loop/record-replay-sufficiency.test.ts`,
`test/fixtures/record-replay/PROVENANCE.md`), against a 5-of-10 bar it cleared at
10 of 10. That is the sibling solution which made this one inert: the field the
refusal would demand is unconditionally captured, so the refusal has nothing to
refuse.

## `runs-legacy.jsonl` — the ledger nothing reads

A byte copy of `<vault>/.ost-agent/health/runs.jsonl`, the working-tree file the
loop wrote **before** the state directory moved into `.git`. Six runs, thirty
steps, 2026-07-26T19:43Z to 2026-07-27T16:05Z, CLI v0.14.0 through v0.21.0. It is
still committed in the vault and no code path opens it — `healthDir()` resolves
to `.git/ost-agent` and nothing else names that path.

Twenty-one of its thirty steps carry no `cwd` and no `argv`, because the field did
not exist when they were written. The refusal would delete all twenty-one, and one
of them is this:

```
2026-07-27T00:53:59.556Z  build  exit 1  bash -c npx vitest run
```

That is the founding failure of the opportunity this whole branch of the tree
hangs from — `npx vitest run` invoked from a home directory instead of the repo,
so vitest collected four repositories and exited 1. Somebody acted on it three
times inside twenty minutes:

- **63 seconds later**, a corrected re-run in the same run record:
  `bash -c cd /home/user/OST-Agent && npx vitest run`, exit 0;
- **75 seconds later**, the friction note
  `.ost-agent/inbox/2026-07-27-friction-loop-step-records-the-command-and-its-exit-code-.md`,
  which reads *"Ran 'loop step --phase build -- npx vitest run' from the home dir
  instead of the repo … The health record shows exit 1 against a command that
  passes in its intended cwd"* — and which is the source of the opportunity
  "A recorded failure can't be reproduced, because the record omits where it ran";
- **17 minutes later**, the commit that landed that note.

## The follow-up trace, captured

The second clause of the threshold needs the vault's git history, which a fixture
cannot carry. What it carries instead is the output of the real read, so the spec
is driven by recorded data rather than by an invention:

```
$ git -C ost-agent-meta log --all -n200 -S'npx vitest run' \
    --since=2026-07-27T00:53:59.556Z --until=2026-07-28T00:53:59.556Z \
    --format='%H %cI %s' -- . ':(exclude).ost-agent/health'
09db0067493998f09c47282d546c3b0a197cd83b 2026-07-27T16:06:22Z ost: the fourteenth pass — the count learns what it was taken over
6306c2c1ccd438dfdcb27d7313ddab0cac76c422 2026-07-27T11:17:52Z ost: the thirteenth pass — the recorder was lied to, and fixed
62fefd84221d6c2aa9a8bddeebd72cdcd2f0e8f1 2026-07-27T01:10:35Z ost: the sweep that measured only the files it could open
```

`62fefd84` is the commit that added the friction note.

`:(exclude).ost-agent/health` keeps the pickaxe off the ledger being measured.
`runs.jsonl` used to be committed there, so without it the commit that *recorded*
the failure would come back as a commit that *addressed* it, and the second clause
could never fail. See `src/git/follow-up-sight.ts`.
