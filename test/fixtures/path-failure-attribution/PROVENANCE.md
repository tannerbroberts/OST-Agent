# Path-failure attribution corpus — how it was cut

The census in `test/friction/path-failure-attribution.test.ts` counts how many of the path
failures this project's passes actually hit arrived through a tool this repository
controls. It has to run offline and give the same answer next year, so the corpus lives
here rather than being read off the machine that produced it. This file records exactly
what was taken, so anyone can disagree with the cut instead of with the number.

Everything here was produced by `scripts/harvest-path-failure-corpus.ts`, which is
committed so the cut is a rule anyone can re-run:

```bash
npx tsx scripts/harvest-path-failure-corpus.ts ~/.claude/projects \
  test/fixtures/path-failure-attribution \
  --exclude 598061c2-bd9c-4964-b0d3-017cb5f78f2a \
  --slice 0d27cebf-9b5d-4cff-906c-0134512573bc \
  --slice d0008f2c-86ea-4db8-90cf-364ce6047c99
```

## What is here

| File | What it is |
| --- | --- |
| `failures.jsonl` | **Every** failing tool call found in 646 session transcripts under `~/.claude/projects` — 719 of them, out of 26,132 calls, in the order they were issued. Tool name, `Bash` command, error text. |
| `corpus.json` | How many transcripts were read, how many calls and failures were found, the clipping bounds, and the session excluded. |
| `0d27cebf-….jsonl`, `d0008f2c-….jsonl` | Two sessions cut down to their path-shaped failures, kept raw so the reader is exercised against the shape of the real record and not only against synthetic entries. |

**All 719 failures are committed, not the 76 path-shaped ones.** The census's negative
direction is the half that matters: a classifier that answered "path failure" to everything
would satisfy every assertion about a corpus that came out high, and 643 failures it must
*not* count are the only thing that catches it. Committing only the positives would have
made the fixture agree with any classifier at all.

`redactSecrets` was run over every command and error committed here; it found nothing to
mask.

## How the failures were lifted

Every `tool_result` carrying `is_error: true` in every transcript on the machine, paired
back to its `tool_use` for the tool name and — for `Bash` — the command. No filtering by
tool, by session, or by what the error says: the classifier is what selects, and it runs
inside the test where it can be argued with.

**The command is why this corpus is cut from raw transcripts rather than from the vault's
own harvested evidence.** The assumption test that named this census proposed reading
`.ost-agent/evidence/TRANSCRIPT_*.md` and matching on "the tool name each friction event
already records". Those records drop the command, and this product's CLI is invoked through
`Bash` — so on that route every `ost-agent …` failure that ever happened is filed under a
tool this repository does not control, and the census answers its own question by
construction. The cut here keeps the command so `attributeSurface` can read it.

The choice does not decide the answer, which is the point of saying it: run the same
classifier over the vault's 117 harvested `TRANSCRIPT_*.md` files (597 friction events) and
it finds **30** path-shaped failures, **0** of them through a tool this repository controls
— the same verdict off a corpus a quarter the size.

## Clipping

Error text is clipped to 800 characters and commands to 600, head and tail with an ellipsis
between, never the head alone — a compound command's signature failure line is routinely
its *last* line. The harvest script classifies the corpus twice, once clipped and once not,
and writes both counts into `corpus.json`: `pathShapedBounded` and `pathShapedUnbounded` are
both 76, so the clip changed nothing about what the classifier sees. If a future re-cut
makes those two differ, the fixture is wrong and the number is an artefact of it.

## What was deliberately left out

- **The session that cut this corpus** (`598061c2-…`, excluded by id in `corpus.json`). A
  count must not include the failures its own construction caused, and that session spends
  its whole life addressing paths across two repositories — the exact behaviour being
  measured. It contributed 0 path-shaped failures at the time of the cut; the exclusion is
  there so a re-cut stays clean rather than because it changed the number.
- **`ERR_MODULE_NOT_FOUND`**, which is a path failure by any plain reading. It is excluded
  because it is a module resolver's failure rather than a file operation's, and the four
  shapes counted here are the ones the assumption test named before anyone counted. The
  exclusion is published rather than defended: `PathFailureCensus.excludedByRule` reports
  that counting all 10 of them **and** crediting every one to this repository would give
  11.6%, still short of the 40% bar, so the exclusion is not what decided the verdict.
- **Tool-grant refusals and user rejections** — "Claude requested permissions to use
  `mcp__ost-agent__ost_check`, but you haven't granted it yet", and a human declining a
  call. Both are refusals about a *tool*, not about a *path*. This is the largest single
  judgement in the cut: there are 122 of them, 83 against this repository's own MCP tools,
  and admitting them would hand the assumption a majority made entirely of failures that
  are not about layout at all.

## Fidelity

The reader was run over the live corpus (647 transcripts under every project directory in
`~/.claude/projects`) and `failures.jsonl` is its output verbatim, minus the excluded
session. Re-running it live will now find *more* than 719 — the transcripts keep growing,
including with the failures the next pass causes — which is why the corpus is frozen here.

## What the corpus cannot support

- **It records failures that were suffered, not failures that were avoided.** A pass that
  stopped guessing at paths because its last three guesses failed appears here as never
  having needed the layout. That bias runs toward the answer the solution under test wants,
  and nothing in the corpus can correct it.
- **Which program in a compound command failed is not recorded.** `cd ~/vault && ost-agent
  status` keeps one exit code. The census reports a lower and an upper bound rather than
  choosing; both are in the test.
- **One machine, one operator.** Every failure here was caused by this project's own passes.
  It is evidence about how an OST-Agent pass addresses paths, not about how anyone else
  would — and in particular it says nothing about a user whose sessions never touch a shell.
