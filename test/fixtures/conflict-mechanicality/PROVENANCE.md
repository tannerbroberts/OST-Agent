# Where this corpus came from

These files are the census behind "Count how many vault conflicts are mechanical, to see
what a human-only rule would actually cost" — the assumption test under the solution "No
agent resolves a conflict it did not create; the merge is handed back to a human". They are
committed so the count is a number in the suite rather than something somebody once ran.

Regenerate with:

```bash
npx tsx scripts/harvest-conflict-corpus.ts ~/ost-agent-meta test/fixtures/conflict-mechanicality
```

The script clones the vault `--mirror` into a temp directory and replays every merge there,
so the subject is only ever read. It takes about 40s.

## What is in here

| file | what it is |
| --- | --- |
| `corpus.json` | the cut: which repo, at which commit, how much history, how many merges |
| `observed-verdicts.jsonl` | one row per conflicted file in a merge that **actually happened** |
| `generated-verdicts.jsonl` | one row per conflicted file from replaying **every pair of branches that coexisted** |
| `slices/*.diff3` | the verbatim `git merge-file --diff3` conflict blocks, one per distinct verdict-and-reason |
| `slices.jsonl` | what each slice is, and the verdict the census test must reproduce from its bytes |

Two corpora because they answer different questions. The observed one is the rate an
operator really pays — how often the work, sequenced the way it actually was, stopped on a
conflict. The generated one is what the assumption test's design asked for ("generate
realistic conflicts by replaying concurrent work"), and it is the only way to see conflicts
at all in a history whose merges landed promptly enough to produce almost none.

The slices hold only the `<<<<<<<`…`>>>>>>>` regions, not the whole merged file. Everything
dropped is text `parseDiff3` skips, so a slice classifies identically to the file it came
from — which is the thing `conflict-mechanicality-census.test.ts` asserts on every run.
Keeping the whole files would put ~260 kB of an agent's own scratch briefing in this
repository's history to carry three conflicts.

## The cut is a rule, not a selection

Nobody chose which conflicts appear here. Pass one takes every merge commit in the history;
pass two takes every unordered pair of the 42 remote branches. The slices are the *smallest*
example of each distinct verdict-and-reason, which is a tie-break, not a judgement about
which conflicts are interesting. Disagree with the rule by editing the script and re-running
it; the numbers in the test will move and that is the point.

## What the numbers said the last time this was cut

Recorded here so a diff to the fixture is legible as a change in the world rather than as
noise. The test asserts these; this table is for reading.

- **35 real merges over 4.7 weeks; 1 conflicted.** In `OST-Agent (meta).md`, and mechanical:
  two sides appending a different section at the same empty insertion point.
- **861 branch pairs; 201 conflicted, all 201 in `.ost-agent/NEXT-BUILD.md`** — the loop's
  own scratch briefing, which every agent branch rewrites wholesale. Not one landed in a
  vault node. The concurrent-work corpus measures the machine's state file, not the
  knowledge the vault is for.
