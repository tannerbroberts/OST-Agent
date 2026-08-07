# Search-literality corpus — how it was cut

The census in `test/telemetry/search-literality-census.test.ts` counts how many of the
searches this project issued over node text were literal lookups, and how many of those
arguments came out of the tree. It has to run offline and give the same answer next year,
so the corpus lives here rather than being read off the machine that produced it. This file
records exactly what was taken, so anyone can disagree with the cut instead of with the
number.

## What is here

| File | What it is |
| --- | --- |
| `search-arguments.jsonl` | Every search argument over node text found in **214** session transcripts under `~/.claude/projects` — 850 arguments from 708 calls, in the order they were issued. |
| `unread-searches.jsonl` | The 39 searches whose arguments the reader refused to guess at, kept so the denominator is visible rather than quietly smaller. |
| `tree-titles.txt` | The 1072 node titles in the `ost-agent-meta` vault as of 2026-08-06 — the tree text an argument may have been copied from. |
| `corpus.json` | How many sessions were read, how many calls were found, and which session was excluded. |
| `6e66c934-….jsonl`, `8a9777ad-….jsonl` | Two entries each, cut from the real transcripts: the two recorded ripgrep refusals, with the calls that caused them. |

`redactSecrets` was run over everything committed here; it found nothing to mask.

## How the arguments were lifted

Every `Grep`, `Glob` and `Bash` tool call in every transcript on the machine, filtered to
those whose **subject is node text** — a path under the vault, or a tool-result file
holding an `ost_` tool's output (a pass that greps a dumped tree is searching node text
through a file).

Scope is resolved per invocation, not per session, and that distinction moved the count by
more than a third: 1394 arguments before it, 850 after. A session sitting in the vault
routinely runs `cd ~/dev/OST-Agent && grep -rn "compileGlob" src`, and reading the
session's directory as the subject counted every one of those as a search over node text —
which would have filled the hand-written cells with source-code patterns and quietly
changed what the census was about. The reader follows `cd` across `&&`, `;` and `|`, and
uses a search's path operands when it has them.

Two arguments come out of a single call where one is present: `Grep`'s `glob` filter is
lifted beside its `pattern`, because the two recorded failures in this vault were in the
`glob` field, not the pattern.

## What was deliberately left out

- **The session that built this census** (`ab3c3d75-…`, excluded by id in `corpus.json`).
  A count must not include the searches its own construction caused. It contributed three
  arguments.
- **Searches over source code**, per the scope rule above. The assumption is about node
  text; a grep over `src/` is a different corpus with different conventions.
- **Anything the reader would have had to guess at.** A command containing `$(…)`,
  backticks, `${…}` or unbalanced quoting is recorded in `unread-searches.jsonl` and
  counted neither way. This bucket is **not neutral**: at least one of the 39 is a `for`
  loop over quoted node titles, which is a tree-derived literal lookup the census does not
  get to count. The unread bucket most likely holds more literal lookups than patterns, so
  the headline share is, if anything, understated by it.

## Fidelity

The reader was run over the live corpus (215 sessions, every project directory under
`~/.claude/projects`) and the committed arguments are its output verbatim, minus the
excluded session. Re-running it live will now find *more* than 850 arguments — the
transcripts keep growing, including with the searches the next pass issues — which is why
the corpus is frozen here.

The two committed transcript slices exist so the reader itself is tested against the shape
of the real record, not only against synthetic entries: they contain the exact `Grep` calls
whose `glob` field ripgrep rejected.

## What the corpus cannot support

- **It records searches that were issued, not searches that were wanted.** A pass that
  avoided a pattern search because the last one failed is recorded here as never having
  needed one. That bias runs toward the answer the solution under test wants, and nothing
  in the corpus can correct it.
- **Provenance is inferred from text, not observed.** An argument is "tree-derived" when a
  literal run of it, at least 16 characters long, matches a node title. Body phrases that
  quote no title are therefore classified hand-written, and `tree-titles.txt` is titles
  only — a body-phrase search is undercounted on the tree side. The provenance ladder in
  the census reports the count at 8, 12, 16 and 24 characters so the threshold is visible.
- **One vault, one operator.** Every search here was issued by this project's own passes
  over its own tree. It is evidence about how an OST-Agent pass searches, not about how
  anyone else would.
