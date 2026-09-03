# Gate-signal-density corpus — how it was cut

`test/telemetry/gate-signal-density.test.ts` asks how buried each of three gate
firings was in the output around it, on the one session where all three happened:
`89ac8277-29ce-4d80-827e-cefea0bebabf`, 2026-08-06, the session the solution node
"Three gates fired correctly in one session and every one of them read as noise
first" is written from. The census has to run offline and give the same answer
next year, so the session lives here rather than being read off a machine whose
`~/.claude/projects` will be pruned. This file records exactly what was taken, so
anyone can disagree with the cut instead of with the number.

Cut by `scripts/harvest-gate-signal-corpus.ts` on 2026-09-03:

```bash
npx tsx scripts/harvest-gate-signal-corpus.ts ~/.claude/projects \
  test/fixtures/gate-signal-density 89ac8277-29ce-4d80-827e-cefea0bebabf
```

**1,269 transcripts** were walked to find it, including the subagent transcripts
under `subagents/`. Only the one named session is committed: the measure is about
three specific firings, and a second session would add lines nobody in this
experiment read.

## What is here

| File | What it is |
| --- | --- |
| `89ac8277-….jsonl` | The session reduced to what a reader saw — every assistant text block, every tool call, every tool result, in order, **untruncated**. |
| `corpus.json` | The stream length and, per firing, its position, both attribution rules' counts, the flip radius and the distance to the next line of prose. |

`redactSecrets` was run over the committed transcript. It masked nothing.

## Nothing a reader read was dropped, and that is checked rather than claimed

Line counts *are* the measurement, so a reduction that truncates a long tool
result is a reduction that changes the answer. The fields dropped are only the
ones no reader reads — uuids, parent links, token usage, timestamps, and the
`toolUseResult` mirror of content the message already carries. Thinking blocks go
too, and cost nothing: all 96 of them are empty in this transcript.

The harvester flattens the original and the reduction with the same
`readerLines` and records both counts. They are **6,554 and 6,554**, and
`corpus.json` carries the pair so the test can fail on a reduction that moved a
line. 2,349,408 bytes of transcript became 644,933 of fixture with the reader
stream identical.

## The three firings, and how each is located

Not by line number — by a pattern that matches the first line at which that gate
is shown *failing*, so the corpus can be re-cut and still find them:

| Firing | Opens with | First read as | What it was |
| --- | --- | --- | --- |
| `corrections-ledger-quiet-window` | `❯ test/loop/corrections-ledger.test.ts (18 tests \| 1 failed)` | "stale fixture, ignore" | a test asserting the age of the working copy, green only for 30 minutes after checkout |
| `wall-clock-budget-z3` | `→ ost_next_work took 2183ms: expected 2183 to be less than 2000` | "flaky timing test, slow runner" | a 3× regression — three `tree.filter(...)`-per-node scans, 44% of CPU |
| `commit-enotempty` | `→ ENOTEMPTY: directory not empty, rmdir '/tmp/ost-commitq-…/.git'` | "CI flake" | the fixture deletes a repository while `git gc --auto` is still writing in it |

The wall-clock gate prints a **green** line for the same test file 287 reader
lines earlier in this session. The pattern is written against the failing
assertion rather than the file name so that green line cannot be mistaken for the
firing.

## The one number the assumption test did not fix, and what was done about it

The bar is a human's, fixed before anything was measured: *fewer than 10
unrelated output lines in the surrounding window.* The **size** of that window
was left open, and the count rises monotonically with it — so a window chosen
after looking would let either hypothesis claim the result, which is the failure
the assumption test names outright.

The size is therefore taken from something with nothing to do with the outcome:
the window is the reader's screen, 12 lines each side, a 25-line viewport — the
classic 24-line terminal, and the **smallest screen anybody actually reads on**.
Every larger screen raises every count, so this is the cut most favourable to the
hypothesis under test.

Because it is still a choice, the test pins the whole curve rather than one point:
`flipRadius` is the smallest radius at which a firing reaches the bar, and it is
asserted for all three under both attribution rules. A reader who thinks 12 is
the wrong screen can read the answer at their own.

## Both attribution rules are committed, and the generous one is the check

Deciding whether a line is "about" the gate is the arguable half of this measure,
so both readings are implemented and both are pinned:

- **strict** — a line is related if it matches the firing's subject patterns, or
  continues a related line *forward* inside the same output block, which is the
  grammar vitest prints. Backward propagation is refused: it would hand the four
  `question(s), budget` CI log lines that happen to sit above the ENOTEMPTY error
  to the ENOTEMPTY gate.
- **generous** — every line of a block containing a related line is related,
  unless it names another test file. This is the rule most favourable to the
  wording hypothesis.

The verdict is the same under both for two of the three firings. It differs for
one, and the difference is recorded rather than resolved — see the test.
