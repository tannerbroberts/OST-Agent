# One week of raw usage events — how it was cut

`test/telemetry/raw-event-question-coverage.test.ts` asks five questions of a week of raw
tool-invocation events and of the daily rollup derived from the same week. It has to run
offline and give the same answer next year, so the week lives here rather than being read
off the machine that produced it. This file records exactly what was taken, so anyone can
disagree with the cut instead of with the number.

Everything here was produced by `scripts/harvest-raw-event-week.ts`, which is committed so
the cut is a rule anyone can re-run:

```bash
npx tsx scripts/harvest-raw-event-week.ts ~/ost-agent-meta test/fixtures/raw-event-week 2026-08-31
```

## What is here

| File | What it is |
| --- | --- |
| `events.jsonl` | **Every** event the meta vault's trace held in the seven finished UTC days before the cut — 1,439 of them, in the order they were appended, with every field intact. |
| `week.json` | The window, the per-day counts, how many events the whole trace held, and how many lines did not parse. |

## The cut is one line, and it is not the instrument's line

**The last seven finished UTC days, and everything inside them.** No filtering by tool, by
surface, by outcome, or — and this is the one that matters — by whether the five questions
can be answered from what a day contains. The claim the fixture is evidence for is that raw
retention answers questions a summary cannot; a week chosen because it answers them would be
the choosing doing the work, not the retention.

Nothing is projected away either, unlike `test/fixtures/usage-refusals/`. A raw-first store
demonstrated on a fixture that had already been summarised would be a contradiction in terms,
so `events.jsonl` is the trace's own lines, re-serialised by `JSON.stringify` and otherwise
untouched.

## The window

`2026-08-24` to `2026-08-30`, cut on `2026-08-31` — 1,439 events out of the 7,938 the trace
held, 0 unparseable lines. The partial cut day is excluded because a partial day is not a day,
which is the same rule `UsageSource` applies when it decides a day is finished.

## Four properties of this week the instrument depends on, and one that surprised the cut

**2026-08-25 has zero events.** A real week has a dead day in it. It is in `week.json` as a
zero rather than being absent, because "no events" and "no such day" are different facts and a
window that quietly closed over the gap would make the week look busier than it was.

**Every event carries a session.** All 1,439. That is what makes the session-span and
per-file-contention questions askable at all; a week from mid-July, when the CLI surface still
dispatched untagged calls, would not have supported them.

**Eighteen calls failed and none was a denial.** So the rollup's denial section is empty for
this week and its failure section carries three sampled lines out of eighteen. The instrument's
third question is about what happened to the other fifteen.

**No event carries `lost` or `dropped`.** The silent-frontmatter-loss section of the rollup —
the one part of the summary that was added *because* counts and timings could not show a real
defect — is empty across the whole week. It is retained in the derived view all the same, so
the questions are asked against the rollup at full strength rather than against a version of it
with a section removed.

**The surface field is a constant.** Every one of the 1,439 events reads `surface: "mcp"`; not
one `cli-tool` call appears, though the same trace holds plenty of them in July. And no event
in the week carries an `unknown` — the field that exists so "unattributed share" can be a
measurement rather than a heuristic is empty 1,439 times out of 1,439. Neither fact was known
before the cut and neither changes what the instrument asserts, but both are things about this
week that its own daily rollup states without anyone noticing: a per-surface table with one row
in it, seven days running.
