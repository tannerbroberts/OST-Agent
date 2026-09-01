# Path-guess hit-rate corpus — how it was cut

The census in `test/friction/path-guess-hit-rate.test.ts` replays a
look-before-you-address guard over every session on this machine and counts how many of the
calls it would have blocked were about to fail anyway. It has to run offline and give the
same answer next year, so the corpus lives here rather than being read off the machine that
produced it. This file records exactly what was taken, so anyone can disagree with the cut
instead of with the number.

Everything here was produced by `scripts/harvest-path-guess-corpus.ts`, which is committed
so the cut is a rule anyone can re-run:

```bash
npx tsx scripts/harvest-path-guess-corpus.ts ~/.claude/projects \
  test/fixtures/path-guess-hit-rate \
  --exclude 38e379cb-7b7b-42e3-a5c7-f52d0603c9a2 \
  --slice agent-abf938e2353ceae33 \
  --slice agent-adfe86f7f96570999
```

## What is here

| File | What it is |
| --- | --- |
| `streams.jsonl.gz` | **1,219** session transcripts under `~/.claude/projects`, each reduced to the ordered events a guard replay needs — one line per session, 60,472 tool calls in the order they were issued. Gzipped for the same reason the shell-necessity corpus is: the honest denominator is every call, which is ~10 MB plain and 2.0 MB compressed, and the census reads it back with `zlib`. |
| `corpus.json` | How many transcripts were found, how many were nested, the session excluded, the clipping bounds, and the compression proof (below). |
| `agent-abf938e2353ceae33.jsonl`, `agent-adfe86f7f96570999.jsonl` | Two sessions kept **raw and whole**, so the reader is exercised against the shape of the real record and not only against synthetic entries. One is the case where the guard would have paid for itself, the other the case where it would have been pure tax. |

## Why this corpus is raw transcripts and can never be anything else

**The denominator of this census is successes.** That is the whole reason it exists: a
guard that refuses first contact is only worth having if first contacts fail often, and
"often" is a share whose bottom half is the calls that worked.

This product's own distilled friction records (`.ost-agent/evidence/TRANSCRIPT_*.md`) hold
**failures only**. A census run over them sees no successful guess anywhere, computes a hit
rate of 100%, and passes resoundingly while measuring nothing at all. The assumption test
that named this census predicted exactly that trap, so the refusal is built in and asserted
in both directions:

- `assertRawTranscripts` throws on a friction digest, recognised by shape (a transcript is
  JSONL; a digest is markdown with YAML frontmatter) *and* by marker. Shape is checked
  first, and that ordering is load-bearing: raw transcripts routinely **quote** those
  digests, and the first cut of this census threw away 1 of 1,216 real sessions for
  containing the words it was told to look for.
- `assertNotFailuresOnly` throws on any corpus carrying no successful path-taking call at
  all — the shape a reader would reach for first, the sibling census's `failures.jsonl`.

## How the events were lifted

Every `tool_use` block in every transcript on the machine, paired to its `tool_result` by
`tool_use_id`, emitted in file order. **No filtering by tool, by session, or by what the
call did**: which calls are path-taking, what counts as having looked, and which failures
the guard actually saves are all decided by `GUESS_RULE` *inside the test*, where they can
be argued with. The stream carries the tool name, the `Bash` command, the declared path
field, and the failure text — nothing pre-classified.

A call whose result never came back is `unread`, never "succeeded". There is exactly one in
60,472, and it is counted **for** the guard in every upper bound.

The walk recurses, which is load-bearing rather than tidy: a subagent's transcript lands
under `<project>/subagents/**`, and 390 of the 1,220 files on this machine are nested.

## The one thing that is dropped, and the proof it changed nothing

Observation tokens that no call in that session ever addresses. This is a **lossless
compression of the replay** — a path nothing addresses cannot change any call's verdict —
and the harvest script proves it rather than asserting it: the census is computed twice,
once over the full token stream and once over the filtered one, and both go into
`corpus.json`.

| | Unfiltered | Filtered |
| --- | --- | --- |
| Observation tokens | 210,119 | 60,522 |
| First-contact calls | 17,427 | 17,427 |
| Wrong guesses | 143 | 143 |

If a future re-cut makes those counts differ, the fixture is wrong and the number is an
artefact of it. `test/friction/path-guess-hit-rate.test.ts` asserts the equality.

## Clipping

Error text is clipped to 800 characters and commands to 600, head and tail with an ellipsis
between, never the head alone — a compound command's signature failure line is routinely
its *last* line. The bounds are the sibling census's, and were checked there against
unbounded classification over the same machine's record.

`redactSecrets` was run over every command, path and error committed here.

## What was deliberately left out

- **The session that cut this corpus** (`38e379cb-…`, excluded by id in `corpus.json`). A
  count must not include the calls its own construction caused, and that session spends its
  life addressing paths across two repositories — the exact behaviour being measured.
- **Nothing else.** Every call is here, including the 17,360 that address no path under any
  reading, because the share is only as honest as its denominator.

## Judgements in the rule that could be argued the other way

Each is recounted in full rather than chosen, and `PathGuessCensus.readingDecides` says on
the report's face whether any of them moved the verdict. None did.

- **Which calls the guard governs.** `declared` counts only tools that name a path in a
  field (`Read`, `Edit`, `Write`, …). `all` adds paths parsed out of `Bash` commands, which
  is where the parent opportunity's failures actually live.
- **What counts as having looked.** `strict` needs the whole path to have appeared;
  `generous` lets a basename do it, because a listing prints basenames.
- **A glob is not a path.** `ls src/**/*.ts` addresses a pattern, and the guard as written
  has nothing to refuse. The exclusion drops calls that were mostly *succeeding*, which runs
  toward the answer the solution wants.
- **A permission denial is not a save.** The path exists; looking first returns the same
  denial. The solution node says so itself. There are 0 among the blocked calls, so the
  exclusion did not decide anything.

## What the corpus cannot support

- **It counts turns; it cannot weigh them.** The solution's own argument is that the turn
  the guard forces is worth *more* than the turn it replaces — a listing returns a whole
  directory where a failure returns one negation — which would justify the guard even at a
  poor ratio. Nothing here prices a turn, and at 121 taxed addresses per save the price
  would have to be extraordinary.
- **It reads the guesses that were made, not the ones that were avoided.** A pass that
  stopped guessing because its last three guesses failed appears here as never having needed
  the layout. That bias runs toward the answer the solution wants and nothing corrects it.
- **The aggregate hides its own counter-examples.** `agent-abf938e2353ceae33` is committed
  raw precisely because it comes out at 62% — a subagent told about a vault in prose that it
  never listed. The corpus says the guard is not worth applying to every call; it does not
  say there is no population where it would pay.
- **A relative path is compared as written.** `src/a.ts` and `/repo/src/a.ts` are different
  strings here, because resolving them needs a working directory the transcript does not
  record and inventing one would put paths in the observed set the run never saw. The error
  makes calls look like first contact when they were not, which *inflates* the denominator
  and runs against the assumption — the direction a limit of this kind should fail in.
- **One machine, one operator.** Every call here was issued by this project's own passes and
  by subagents it spawned across five repositories. It is evidence about how an agent
  addresses paths, not about how anyone else does.
