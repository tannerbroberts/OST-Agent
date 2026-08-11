# Shell-necessity corpus — how it was cut

The census in `test/runner/shell-necessity-census.test.ts` counts how many of the commands
this machine's sessions ever handed to a shell needed a shell at all. It has to run offline
and give the same answer next year, so the corpus lives here rather than being read off the
machine that produced it. This file records exactly what was taken, so anyone can disagree
with the cut instead of with the number.

## What is here

| File | What it is |
| --- | --- |
| `commands.jsonl.gz` | Every distinct `Bash` tool command in **679** session transcripts under `~/.claude/projects` — 13,933 distinct texts carrying 14,802 invocations, each line `{command, count, sessions}`. Gzipped because the honest denominator is every command: the plain text is 5 MB and the compressed corpus 1.1 MB, and the census gunzips it with `zlib`. |
| `corpus.json` | How many transcripts were found, how many were nested, and which session was excluded. |

`redactSecrets` was run over every command before it was written.

## How the commands were lifted

Every `tool_use` block named `Bash` in every transcript on the machine, its `command` string
taken verbatim and aggregated by exact text. **Nothing is filtered and nothing is sampled**:
the census's claim is a share, and a share is only as honest as its denominator —
`git status` repeated four hundred times weighs exactly what it cost, and dropping the
boring bulk would decide the number in the cut instead of in the classifier.

The walk recurses, which is load-bearing rather than tidy: a subagent's transcript lands
under `<project>/subagents/**`, and 347 of the 680 files on this machine are nested — more
than half the record.

## What was deliberately left out

- **The session that built this census** (`32d756a5-…`, excluded by id in `corpus.json`).
  It types shell probes all afternoon — `/bin/[ a '==' a ]`, `echo ====` — and quotes the
  failing forms back to itself while writing the classifier. A count must not include the
  commands its own construction caused. (Two of those probes failed exactly the way the
  recorded corpus fails, which is corroboration, but it belongs in this file, not in the
  number.)
- **Nothing else.** Unreadable commands (unbalanced quoting after unescaping — 194
  invocations, 1.3%) are in the corpus and classified `unreadable`, counted neither way.

## Fidelity

- The classifier runs **live over the committed texts** at test time; nothing here stores a
  verdict. Re-running `scripts/harvest-shell-necessity-corpus.ts` against the machine will
  find *more* than 14,802 invocations — the transcripts keep growing — which is why the
  corpus is frozen here.
- Classification is deliberately conservative in one visible place: an escaped `\;` (as in
  `find -exec … \;`) unescapes to a bare `;` word and reads as a `sequence`, so a handful of
  `find` invocations that an argv path could in fact serve are counted shell-bound. The
  error direction only ever *understates* the argv share, and the measured share is 12.3%
  against a bar of 70% — the direction of the miss is not in doubt.

## What the corpus cannot support

- **It counts commands AS WRITTEN by callers who knew a shell was there.** A caller who
  knew the default was shell-less would compose differently — the harness's own directory
  reset makes `cd <repo> && …` a prefix on thousands of lines, and the census reports
  separately (`cdRecoverableInvocations`) that forgiving just that prefix lifts the share
  only from 12.3% to 15.6%.
- **One machine, one operator.** Every invocation here was issued by this project's own
  sessions over this operator's repositories. It is evidence about how an OST-Agent pass
  uses a shell, not about how anyone else would.
- **It does not settle what happens to the 87.7% that genuinely need a shell** — only how
  many they are.
