# Symbol-failure corpus — how it was cut

The census in `test/telemetry/symbol-failure-census.test.ts` counts how many of the
compiler errors "I cannot see that symbol" that reached a run were a **dropped intention**
— a symbol the run meant to add and had not — rather than a symbol that was already there.
It has to run offline and give the same answer next year, so the corpus lives here rather
than being read off the machine that produced it. This file records exactly what was taken,
so anyone can disagree with the cut instead of with the number.

Cut on 2026-08-22 by:

```
npx tsx scripts/harvest-symbol-failure-corpus.ts ~/.claude/projects test/fixtures/symbol-failure \
  --exclude c2cc5547-780a-41f9-861f-2ef9b5f9fb52 \
  --slice e335a680-ee48-4171-b8ad-4cfb526e4129 \
  --slice 10002eba-85b9-4400-92dd-6fc8f5e4333f
```

## What is here

| File | What it is |
| --- | --- |
| `resolutions.jsonl` | The **25** distinct symbol failures a compiler produced across **1426** session transcripts under `~/.claude/projects`, each with the repair the session made for it. |
| `citations.jsonl` | The **30** tool results carrying **36** more symbol errors that reached a run *without* a compiler having just produced them. Kept because this bucket is larger than the one being counted. |
| `corpus.json` | How many sessions were read, how many errors were seen, and which session was excluded. |
| `e335a680-….jsonl` | The session the tree cites for both of its captures — `reconcileWithUsage` and `configProblem`. |
| `10002eba-….jsonl` | The `processes` failure: a wrong receiver, the class the parent solution's taxonomy has no cell for. |

`redactSecrets` was run over everything committed here; it found nothing to mask.

The two slices keep only the entries that carry a failure, the call that produced it, and
the edit that repaired it. **Line positions are preserved by padding the gaps with blank
lines**, because `classifyResolution` walks forward from `failure.entry` and a shifted index
would point the reader at the wrong edit. Getting that wrong is how the reader's own entry
numbering was found to be inconsistent — it counted non-blank entries while the resolver
indexed raw lines, which agree on every real transcript and disagreed on the first sliced
one.

## The two scope rules, and why they carry the whole count

A compiler error is text, and this project writes its own failures into the vault as
evidence. Every later pass that reads that node, dumps the tree, or greps the record
re-emits the same error into its own transcript. **69 symbol errors reached a run in the
record read here and only 33 came out of a compiler.** Below the reader, on raw text, it is
worse: a `grep -ro "error TS2552:\|error TS2304:\|error TS2339:"` over `~/.claude/projects`
returned 377 occurrences at the time of this cut, and 208 of them — well over half — are the
strings `reconcileWithUsage` and `configProblem` travelling as quoted evidence. That figure
grows every time a pass reads the node, which is the point. Counting occurrences would have
reported the same two failures two hundred times and called it a corpus.

So:

1. **A failure counts only when the text came out of a typecheck, build or test command.**
   The rule is `SYMBOL_FAILURE_RULE.producers` and it matches the *command*, never the
   output. An earlier draft matched the word `typecheck` anywhere and counted four `Read`s
   of the node titled "I call a symbol I never wrote, and a whole-project **typecheck** at
   the end of the batch is what tells me" as four compiler runs.
2. **Within a session, a symbol counts once.** A `tsc` re-run after a failed repair emits
   the same error again. That is one failure.

## How a failure is classified

By what the session **did next** — the first edit after the failure that touches the
symbol. The repair is observable; the intention is not.

| Repair | Meaning | Count |
| --- | --- | --- |
| `defined` | the session went on to write the symbol — **a dropped intention** | 2 |
| `imported` | the session added it to an import clause; it existed elsewhere | 4 |
| `renamed` | the reference was replaced or deleted | 6 |
| `rehomed` | the name survived; what it was asked of changed | 4 |
| `unresolved` | the session never touched it again — counted neither way | 9 |

`imported` and `rehomed` are both "the symbol existed, under exactly this name". Neither is
a dropped intention and neither is a wrong name. **The parent solution's taxonomy has two
values and the corpus needs five**, and the two it lacks account for eight of the sixteen
repairs — four times the dropped-intention cell.

Reading the repair requires reading the edit, and this project's passes edit through
`python3 - <<'PY'` heredocs at least as often as through `Edit`. A reader that understood
only the structured tools scored **fourteen** of twenty-five failures `unresolved`; five of
those had been repaired by an `s.replace(old, new)` in a heredoc a few entries later. That
is not a coverage detail — `unresolved` is the bucket the most generous denominator turns
into dropped intentions, so missing heredocs moves the answer toward a green.

## The verdict, and the fact that it moves

The bar was fixed at **3 in 10** before the count. The headline reading says **2 of 16
(13%)**, which **misses**. But the census publishes every defensible reading, and they do
not agree:

| Reading | Count | Verdict |
| --- | --- | --- |
| what the session did next (headline) | 2/16 = 13% | MISSES |
| the compiler offered no `Did you mean` | 23/25 = 92% | meets |
| unresolved failures were all dropped intentions | 11/25 = 44% | meets |
| unresolved failures were none of them dropped intentions | 2/25 = 8% | MISSES |

`ruleDecides` is therefore true and the report says so on its face. Two things a reader
should weigh before splitting the difference:

- **The suggestion reading is refuted by the corpus's own exemplar.** The tree reads
  `Did you mean 'reconcileWithGit'?` as proof that "the correct name was recoverable from
  the project the whole time". It was not the correct name. The run had written
  `reconcileWithUsage` into `src/ost/census.ts` earlier in the same session — the tool
  result even prints `src/security/tools.ts:40:import { reconcileWithGit, reconcileWithUsage }`
  right above the error — and the repair at entry 295 was to add the import to
  `src/cli/index.ts`. Following the compiler's suggestion would have been the bug.
- **The generous denominator clears the bar by calling `URL` a symbol somebody meant to
  write.** Every one of the nine unrepaired failures has a mundane explanation that is not
  a dropped intention. Three are `AbortSignal`, `URL` and `ImportMeta.url` — standard
  library names missing from a `lib` setting in a scratchpad project, which no declaration
  ledger would have caught. The other six are subagents whose transcript ends after the
  failing typecheck, so "never repaired" there is a fact about where the recording stops.

## Where the error, if any, points

One of the two dropped intentions is `hits` in `e6e8542c`, where the run added
`get hits(): readonly T[]` to `src/ost/search.ts` as a **mutation probe** and restored the
file from `/tmp/search.bak.ts` twelve entries later. It is a definition by the rule and it
was not a repair. The census does not model file restores, so it counts it — an error in
the direction that *helps* the solution under test. Corrected by hand the headline would be
1 of 16 (6%).

## What the corpus cannot support

- **It sees failures that reached a typecheck.** A symbol a run declared, forgot and never
  called leaves no compiler error at all — and that is the abandonment the ledger claims to
  catch at its purest. This census can size how much of the *observed* failure traffic the
  ledger would cover. It cannot size the silent case, so a share below the bar is an
  argument about cost-effectiveness rather than a proof that dropped intentions are rare.
- **Twenty-five is a small n.** At 2 of 16 the 95% interval on the share runs to roughly
  38%, which brushes the bar. What carries the finding is not the point estimate but the
  composition: the two classes the solution's taxonomy does not have are four times the
  size of the one it addresses, and that gap is not a sampling artefact.
- **Fifteen sessions contribute, and they are not fifteen independent voices.** Six of the
  25 failures come from other repositories (tetrix, a scratchpad plugin) and eight come from
  four *subagent* transcripts rather than from sessions a person watched. All are kept: the
  claim under test is about how a run behaves, not about this codebase. But every one of
  them is this operator's agent, and six of the nine unrepaired failures are subagents whose
  transcript simply ends — which is a fact about how a subagent terminates at least as much
  as about what the run intended.
- **The repair is read as the first edit that touches the symbol.** A run whose first
  response is unrelated to the failure is misread, and there is no second rule here that
  would catch that without stacking another inference on the first.
