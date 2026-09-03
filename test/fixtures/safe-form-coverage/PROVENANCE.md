# Safe-form coverage corpus — how it was cut

The census in `test/knowledge/safe-form-coverage.test.ts` asks how much of what callers
actually wrote a curated set of first-class forms would have expressed — and, separately,
how much of what they wrote that **failed**. It has to run offline and give the same answer
next year, so the corpus lives here rather than being read off the machine that produced it.
This file records exactly what was taken, so anyone can disagree with the cut instead of
with the number.

Everything here was produced by `scripts/harvest-safe-form-corpus.ts`, which is committed so
the cut is a rule anyone can re-run:

```bash
npx tsx scripts/harvest-safe-form-corpus.ts ~/.claude/projects \
  test/fixtures/safe-form-coverage \
  --exclude 62543b0f-3666-4ac3-91cd-50a86c67e143
```

The set it is scored against — `src/knowledge/safe-forms.ts` — was committed **before** this
corpus was cut (commit `a43e1b4`, one commit ahead of the fixture). That ordering is
load-bearing rather than tidy, and it is the whole defence against the obvious way to cheat
this particular measurement: a set of forms chosen after seeing which shell ingredients turn
out to be common scores against the sample it was fitted to and looks identical to one that
was not. The module also imports no `fs` and names no fixture, which the test asserts, so it
structurally could not have read what it is measured against.

## What is here

| File | What it is |
| --- | --- |
| `commands.jsonl.gz` | Every distinct `Bash` tool command in the **1,262** session transcripts read (1,263 found, one excluded) under `~/.claude/projects` — 27,959 distinct texts carrying 31,519 invocations, each line `{command, count, sessions, failures, unpaired}`. Gzipped because the honest denominator is every command. |
| `corpus.json` | How many transcripts were found, how many were nested, which session was excluded, and the failing and unpaired counts. |

`redactSecrets` was run over every command before it was written.

## What this corpus has that `test/fixtures/shell-necessity/` does not

The same walk over the same machine, and largely the same commands — but that corpus is
aggregated by command text alone, and **this one records the outcome of every invocation**.
Each `tool_use` is paired back to its `tool_result` and counted as a failure only when the
result carried `is_error`. The failing bar cannot be read off the sibling fixture at all,
which is why there are two.

`is_error` is the only signal used. Anything inferred from the *text* of a result would be
this reader's judgement about what an error message looks like, and the census would then be
scoring its own guess.

**Every one of the 31,519 invocations was paired** — `unpairedInvocations` is 0. That is
worth stating because the reader has a whole branch for calls whose result never arrives,
and on this record that branch never fires.

## How the commands were lifted

Every `tool_use` block named `Bash` in every transcript on the machine, its `command` string
taken verbatim, aggregated by exact text, with the outcome of each invocation attached.
**Nothing is filtered and nothing is sampled**: the census makes two claims and both are
shares, so a cut that kept only the interesting commands would decide the first number in
the selection instead of in the classifier. `git status` repeated four hundred times weighs
exactly what it cost.

The walk recurses, which is load-bearing rather than tidy: a subagent's transcript lands
under `<project>/subagents/**`, and 390 of the 1,263 files on this machine are nested.

## What was deliberately left out

- **The session that built this census** (`62543b0f-…`, excluded by id in `corpus.json`).
  It reads the recorded failures back to itself and runs probe commands against the
  classifier while writing it, and a count must not include the commands its own
  construction caused.
- **Nothing else.** Unreadable commands (unbalanced quoting after unescaping — 364
  invocations, 1.2%) are in the corpus and classified `unreadable`, counted in neither
  numerator nor denominator.

## Fidelity, and the one place the classifier is known to be conservative

- The classifier runs **live over the committed texts** at test time; nothing here stores a
  verdict. Re-running the harvest against the machine will find *more* than 31,519
  invocations — the transcripts keep growing — which is why the corpus is frozen here.
- **A heredoc body is scanned as if it were shell.** `classifyShellNecessity`, which this
  census decomposes commands with, has no heredoc-body state: a `(`, a `$` or a backtick
  inside the literal text of a `cat > f <<'EOF' … EOF` is counted as `grouping`,
  `expansion` or `substitution` even though the shell never evaluates it. 1,867 of the
  5,033 not-fully-expressible invocations contain a heredoc, and 74 of the 311 failing
  ones do.

  The error direction only ever **understates** coverage, and the test pins the ceiling:
  counting every heredoc-bodied command as fully expressible lifts the failing share from
  64.9% to 73.3% — still short of the 80% bar. The finding survives its own known bias,
  which is why the bias is recorded here rather than fixed to move a number.

## What the corpus cannot support

- **It counts commands AS WRITTEN by callers who had only a shell.** This is the node's own
  caution and it is the sharpest limit here: what a caller would write with these forms
  available is not visible in this record at all. High coverage of past commands is weak
  evidence about future ones — and *low* coverage is the more trustworthy of the two
  results, because it names cases that were reached for even under a shell's own idioms.
- **One machine, one operator.** Every invocation was issued by this project's own sessions
  over this operator's repositories. It is evidence about how an OST-Agent pass uses a
  shell, not about how anyone else would.
- **It does not settle what a caller does when the forms miss.** The node asserts they fall
  back to the failing form. This corpus can show that the miss and the failures coincide —
  and it does — but coincidence in a record of shell-only callers is not the same claim.
