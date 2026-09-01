# Path-root coverage corpus — how it was cut

The census in `test/runner/path-root-coverage.test.ts` asks how much of this machine's
recorded path failure a handful of named roots could ever have covered. It has to run
offline and give the same answer next year, so the corpus lives here rather than being read
off the machine that produced it. This file records exactly what was taken, so anyone can
disagree with the cut instead of with the number.

Everything here was produced by `scripts/harvest-path-root-corpus.ts`, which is committed so
the cut is a rule anyone can re-run:

```bash
npx tsx scripts/harvest-path-root-corpus.ts ~/.claude/projects \
  test/fixtures/path-root-coverage \
  --exclude 5eb77dd5-30f7-4c49-9ce6-9a714a0c28c6 \
  --slice 0d27cebf-9b5d-4cff-906c-0134512573bc \
  --slice 0555db5d-cab6-4293-868f-48c1ef8eb1fa
```

The vocabulary it is scored against — `src/runner/path-roots.ts` — was committed **before**
this corpus was cut (commit `b1a7f83`, one commit ahead of the fixture). The node makes that
ordering load-bearing rather than the threshold: a set of roots chosen after seeing which
prefixes failed scores against the sample it was fitted to and looks identical to one that
was not. The module also imports no `fs` and names no fixture, which the test asserts, so it
structurally could not have read what it is measured against.

## What is here

| File | What it is |
| --- | --- |
| `failures.jsonl` | **131** path failures whose message named a path, out of 2,004 failing calls in 1,219 session transcripts. Session, working directory, tool, the named subject, the failure class, the clipped error and command. |
| `successes.jsonl.gz` | **66,366** paths addressed by calls that came back without an error, each with the directory it was addressed from. The comparison group the assumption test asked for, and the only control that catches a vocabulary which merely describes where the work happens. Gzipped: 10.4 MB plain, 462 KB compressed. |
| `corpus.json` | How many transcripts were found, how many were nested, the session excluded, the clipping bounds, and every population the read could not use. |
| `0d27cebf-….jsonl`, `0555db5d-….jsonl` | Two sessions cut to their path-failure and first-twelve-success call/result pairs, kept **verbatim**, so the reader is exercised against the real record's shape — `cwd` field, content-block nesting, tool-result pairing — and not only against synthetic entries. |

## The two sliced sessions, and why those two

- `0d27cebf-…` carries the failure the solution node quotes as its own evidence:
  `/Users/tanner/dev/ost-agent-meta` where the directory is `/Users/tanner/ost-agent-meta`.
  It is in the corpus exactly once, and it arrived inside an `rm -rf`.
- `0555db5d-…` is a build-loop session: its working directory is the **vault** and its work
  is in the **repository**, four of its commands `cd` from one to the other, and its failure
  addresses the repository absolutely from a vault cwd. It is the case no derivation from a
  working directory can serve, because the run genuinely has two roots — which is the
  solution's own argument, and the reason `project` is recounted bound per session and bound
  machine-wide.

The sibling fixture `test/fixtures/path-failure-attribution/` also holds a slice of
`0d27cebf-…`, cut to its failures alone. This one keeps successes as well, because this
census's control needs them.

## How the paths were lifted

Every `tool_use` block paired to its `tool_result` by `tool_use_id`, in file order, in every
transcript on the machine at any depth — 390 of the 1,220 files are nested under
`<project>/subagents/**`. **No filtering by tool, by session, or by what the call did.** A
failing result becomes a failed path when `classifyPathFailure` recognises the error as
`missing-path`, `no-matches` or `not-a-repo` *and* `subjectOf` names the thing that was not
there; a non-failing result contributes every path its call addressed.

### The working directory, which is the whole reason this census can be run

Every transcript entry carries `cwd`, and the call's is taken from the entry that carried
it. The sibling path-guess corpus's provenance says resolving a relative path "needs a
working directory the transcript does not record". It does record one, on every entry, and
`corpus.json` reports `failuresWithoutCwd: 0` — all 131 have one.

**A leading `cd` is honoured, and it is not a nicety.** 14,493 of 60,707 calls — 24% — open
with `cd`, and this repository's own build passes run from the vault and `cd` into the code
repository in the same command. Without honouring it, every relative path in those calls
resolves into the wrong repository, which manufactures a wrong prefix and then reads it back
as evidence for the solution: the first cut of this census reported seven head errors, and
five of them were this artefact. A `cd` in the *middle* of a command is not honoured, because
it changes the directory for part of the command only and guessing which part would put
paths in the corpus that no run addressed.

## What was dropped, counted rather than in silence

| Dropped | How many | Why |
| --- | --- | --- |
| Failures whose message named nothing | 52 | `File does not exist.` names no subject. A path cannot be classified against a root without being named. |
| Named subjects that are not paths | 38 | `--include=*.ts`, `ENOENT`, a bare program name — prose hands back a flag where a path should be. |
| `denied-path` failures | 0 | The path exists and the grant does not, so no root causes it or prevents it. There are none in this corpus. |
| Assignment words in commands | ~1,000 successes | `D=/private/tmp/scratch` is an assignment, not an address. Found by reading this census's first cut, where it resolved against the working directory and manufactured a location no run ever addressed. |
| **The session that cut this corpus** (`5eb77dd5-…`) | 1 session | A count must not include the calls its own construction caused, and this one spends its life addressing paths across the vault and the repository — the exact behaviour being measured. |

Nothing else. Every call is here, including the tens of thousands that address nothing
interesting, because the share is only as honest as its denominator.

`redactSecrets` was run over every path, command and error committed here.

## The ten loose head-error matches, read by hand

The census counts a failure as a **head error** when the same tail was reached successfully
from under a declared root with a different head — the class a declared root actually
prevents, as opposed to the territory a coverage share measures. Requiring two trailing
segments to match gives **1**; requiring one gives **10**. The truth is between them, so both
are reported. The ten, and what each is:

| Failed path → the successful path that shares its tail | Read |
| --- | --- |
| `/Users/tanner/dev/ost-agent-meta` → `/Users/tanner/ost-agent-meta` | **head error** — the node's own example |
| `/Users/tanner/ost-agent-meta/src` → `/Users/tanner/dev/OST-Agent/src` | **head error** — asked the vault for the repository's source |
| `~/.claude/projects/-Users-tanner-dev-pentagram/memory/MEMORY.md` → `…-Users-tanner-dev-OST-Agent/memory/MEMORY.md` | **head error**, and the root that would prevent it (`~/.claude/projects/<project>`) is not one of the four names |
| `…/OST-Agent/src/ost/set-outcome.ts` → `…/OST-Agent/src/runner/set-outcome.ts` | interior — the root was never in doubt |
| `…/tetrix…/worktrees/campaign-numerator-rules/.env.test` → `…/tetrix…/.env.test` | interior |
| `/Users/tanner/dev/ost-benchmarks/bin` → `/Users/tanner/dev/pentagram/src/bin` (twice) | coincidence — `bin` |
| `/Users/tanner/dev/pentagram/docs` → `/Users/tanner/dev/chaotic-nature/docs` | coincidence — `docs` |
| `/tmp/w6probe/v` → `…/scratchpad/req/v` | coincidence — `v` |
| `/Users/tanner/ost-agent-meta/.ost-agent/ost.config.yaml` → `/tmp/repos/…/ost.config.yaml` | coincidence |

Three genuine head errors in 131 failed paths, and one of the three names a root the
vocabulary does not carry.

## What this corpus cannot support

- **It counts coverage, and coverage is not prevention.** A failed path that lands *inside*
  a declared root is one whose prefix was already right — the mistake was in the tail the
  caller still writes by hand. The two measures point opposite ways, which is why the head
  error count is reported beside the share rather than instead of it.
- **It says nothing about the failure the node calls the more dangerous one.** A root
  pointing somewhere wrong produces confident, uniform, wrong paths everywhere at once, and
  no coverage number would show it. That risk needs its own check.
- **Every path here was reached for by a run that had no root vocabulary.** The corpus is
  shaped by the absence of the thing being tested, and cannot say how the habit changes once
  one exists.
- **A relative path is credited to the directory it was issued from.** That is on the record
  rather than invented, but the `cwd` a transcript carries is the session's, and a command
  that changes directory in the middle of itself is not followed.
- **One machine, one operator, five repositories.** Every call here was issued by this
  project's passes and the subagents they spawned. It is evidence about how one agent
  addresses paths, not about how anyone else does.
