# The friction-surface corpus — how it was cut

`test/telemetry/friction-surface-rule.test.ts` replays "all 29 records" of the 2026-08-02
mapping pass through the surface rule and scores what it keeps against that pass's own
judgement of which five carried a product need. The score only means something if the
corpus is exactly what the pass was looking at, so this file records what was taken and
what did not add up, so anyone can disagree with the cut instead of with the number.

## What is here

| File | What it is |
| --- | --- |
| `records/` | The 26 `TRANSCRIPT_*.md` and 3 `USAGE_*.md` evidence records that existed in `ost-agent-meta` at commit `32a44d74`, verbatim. |
| `judgement.json` | One row per record: whether the pass judged it to carry a product need, and the pass's own reason. Transcribed by hand from the census; not derived. |
| `corpus.json` | The vault, the revision, and the counts, written by the harvest script. |

Re-cut the records with:

```bash
npx tsx scripts/harvest-friction-surface-corpus.ts \
  /Users/tanner/ost-agent-meta test/fixtures/friction-surface-rule 32a44d74
```

`32a44d74` is the commit that created the parent opportunity — the pass's own commit, and
therefore the only defensible snapshot of what it had in front of it. The vault has since
grown past 550 evidence records; "the 29" is not recoverable from the live folder.

`INBOX_*` records are excluded. The rule filters a *machine* channel, and the inbox is a
human dropping a note in a folder. Including them would put the operator's own prose on
both sides of a score about the agent's friction.

## The judgement is transcribed, not derived

Deriving "carries a product need" from the record would mean writing a second classifier
and grading the first one with it, which measures the agreement of two guesses. Every row
comes from the census the pass wrote under "The friction channel fills with my own typos,
so the signal I wanted is buried" (Issues, 2026-08-02). Five needs: `08ab58d6`, `16e9596b`,
`5bbed804`, `f48dc76d`, `USAGE:2026-07-26`. The other 24 are the pass's deliberate skips.

## Three things in the census that do not add up

None of them changes the verdict, and all three are written down rather than smoothed over.

1. **The census prose accounts for 28 records; the bar is stated over 29.** It names "22
   transcript records and 1 usage record left unmapped on purpose" plus the 5 it mapped.
   That is 28. The threshold on the assumption test says "at least twenty of the
   twenty-four judged not to", so 24 + 5 = 29. The unnamed 29th is `USAGE:2026-07-27` — a
   16-call day with zero failures, the same shape as the `USAGE:2026-07-25` the census
   *did* name as a clean day. It is recorded here as a non-need on that reading, and the
   row says so.

2. **Two of the "outstanding" records had been mapped a week earlier.**
   `TRANSCRIPT:5e5c119d` and `TRANSCRIPT:8fc8d6e3` were written into the vault's
   `.ost-agent/state/mapped.json` on 2026-07-25 (commit `07fdf23f`), seven days before the
   pass. The outstanding set on 2026-08-02 was 27, not 29. Both are non-needs and both are
   demoted by the rule under either reading, so the miscount costs the denominator and
   nothing else — the test re-scores the corpus without them and asserts the verdict holds.

3. **Two near-identical records are judged opposite ways.** `TRANSCRIPT:16e9596b` (eight
   forced clarifying questions) was mapped as a need; `TRANSCRIPT:7e982096` is the first
   seven of the same eight questions, from a sibling session, and was skipped. Both are
   demoted by the rule, so it does not move the score either — but a judgement that splits
   on a record's twin is the kind of thing a reader is entitled to see before trusting the
   five.

## What a reader who disagrees should change

Flip a `need` in `judgement.json` and re-run. The keep clause needs 4 of 5; the rule keeps
`USAGE:2026-07-26` and nothing else in 29 records, so it takes three re-judgements in the
same direction — all of them onto records whose only failing calls are `Bash`, `Edit`,
`Workflow`, `AskUserQuestion`, `Skill`, `CronList` or `TaskOutput` — before the clause can
clear. That is the shape of the finding, not an artefact of any one row.
