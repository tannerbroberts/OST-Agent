# Scaffold-init corpus — how it was cut

The census in `test/runner/unconditional-scaffold-init.test.ts` asks whether initialising
**only the directories this tool scaffolded** would have prevented the exit-128 failures
this project actually hit, and whether initialising is safe everywhere it would have run.
It has to run offline and give the same answer next year, so the corpus lives here rather
than being read off the machine that produced it. This file records exactly what was
taken, so anyone can disagree with the cut instead of with the number.

Everything here was produced by `scripts/harvest-scaffold-init-corpus.ts`, committed so
the cut is a rule anyone can re-run:

```bash
npx tsx scripts/harvest-scaffold-init-corpus.ts ~/.claude/projects test/fixtures/scaffold-init
```

## Two halves, cut from different places

Unlike the workspace-state harvest beside it, this one **cannot** read a committed file
alone, and the reason is worth stating because it bounds the result.

| Half | Source | Reproducible offline? |
| --- | --- | --- |
| The failures | the committed `test/fixtures/path-failure-attribution/failures.jsonl` | **Yes.** `failures.json` is re-derived from it inside the spec, so a stale fixture cannot survive a change to the classifier. |
| Creation evidence, scaffold targets, working-tree directories | `~/.claude/projects` transcripts | **No.** Every one of these facts is established by a call that *succeeded*, and the upstream file holds only failing calls. |

That asymmetry is the corpus's main limitation. The second half is machine state, it
decays, and the corpus records the decay rather than hiding it: `sessionsMissingFromDisk`
names the two sessions this census counts whose transcripts no longer exist, and the
directories they failed in carry `absent: "transcript-gone"` instead of a silent "not
tool-created".

## What is here

| File | What it is |
| --- | --- |
| `failures.json` | The **6** uninitialised-repository failures, each with the directory it happened in, read off the command's own `cd`. |
| `corpus.json` | The counts, the scaffold targets, the working-tree directories, the `git worktree add` targets, the creation evidence, and the prose exclusion. |

## The failure cut

One shape only: git's own `fatal: not a git repository (or any of the parent
directories)`. Not the exit code — `Exit code 128` also covers divergent branches, an
existing branch name, a bad pathspec and a missing upstream, and none of those asks
whether the directory is a repository at all.

Out of **719** failing tool calls, **6** match, in **4** directories:

| Directory | Failures | Sessions | Created by, per the record |
| --- | --- | --- | --- |
| `/Users/tanner/dev/apple-epoch-primes` | 3 | 3 | the coding agent's own `Write` of `index.mjs` |
| `/Users/tanner/dev/ost-benchmarks` | 1 | 1 | **unknown — transcript gone** |
| `/tmp/ost-main` | 1 | 1 | `git worktree add /tmp/ost-main main`, which had just failed |
| `/tmp/ost-npm-archive` | 1 | 1 | **unknown — transcript gone** |

The solution node cites four *sessions*. The record holds six, and three of them are one
directory failing three times over one afternoon. Two of the six —
`0f940e60-…` and `agent-a022e255367d9bdf0` — are not in the node's list at all.

## Working-tree directories, not repository roots

`trees` is a list of directories the record shows to be **inside** a git working tree,
because a git *read* succeeded there. It is deliberately not a list of repository roots: a
successful `git status` in `.../tetrix-game-monorepo/apps/frontend` proves that directory
is inside a working tree and says nothing about where the tree begins. Clause two asks
about containment, so containment is the fact recorded.

Only reads count — `git init`, `git clone` and `git worktree add` can create the
repository they run against, and a working tree established by one of those would be the
census assuming its own conclusion. An **unpaired** tool call (no result in the
transcript) is treated as failed, so a working tree is never established by a command
nobody saw the answer to.

## Scaffold targets

Every `ost-agent init` in the record, resolved against the cwd the command states, folding
**every** `cd` in the command rather than only the leading one — `cd /tmp && mkdir x && cd
x && … init --vault .` is the shape this record is full of, and reading only the first
`cd` puts the target one directory too high.

19 invocations. 13 resolve to a path; 6 do not, and are counted as **unchecked** rather
than as passes:

| Unresolved because | n |
| --- | --- |
| the target is a shell variable — `$V`, `"$d/vault"`, `"$D/v"` | 4 |
| the target is documentation placeholder text — `<folder>` | 2 |

One further segment was excluded as **prose**: a PR body writing ``run `ost-agent init`
first`` splits into a segment indistinguishable from an invocation. A backtick is the
marker — every real invocation in this record uses `$(…)` for substitution — and the
excluded row is kept in `corpus.json` under `prose` rather than dropped silently.

## What the cut cannot tell you

- **All 13 checked targets are throwaways** under `/tmp`, `/private/tmp` or a scratchpad.
  Clause two passes, and it passes on an empty room: nobody has ever pointed `ost-agent
  init` at a directory inside a real repository, so the record says what has been *tried*,
  not what is safe. The census reports this as `nesting.vacuous`.
- **`worktreesAdded` is a floor.** Only nested repositories created by a Bash `git
  worktree add` can be attributed. The harness's own worktree-isolation tool makes them
  too and leaves no such command in the record, so the record holds more nested working
  trees than this count names.
- **Consent is not measurable here.** Whether an operator accepts an unrequested write to
  their disk at all is not a coverage question, and the assumption test says so itself.
- **One machine, one operator.** Every failure counted here was caused by this project's
  own passes.
