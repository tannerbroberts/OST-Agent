# Usage-refusal corpus — how it was cut

The census in `test/mcp/refusal-precondition-coverage.test.ts` counts what share of the
refusals this tool's own calls actually hit a caller could have decided in advance, from
the preconditions `src/security/call-preconditions.ts` publishes. It has to run offline and
give the same answer next year, so the corpus lives here rather than being read off the
machine that produced it. This file records exactly what was taken, so anyone can disagree
with the cut instead of with the number.

Everything here was produced by `scripts/harvest-usage-refusal-corpus.ts`, which is
committed so the cut is a rule anyone can re-run:

```bash
npx tsx scripts/harvest-usage-refusal-corpus.ts ~/ost-agent-meta test/fixtures/usage-refusals
```

## What is here

| File | What it is |
| --- | --- |
| `refusals.jsonl` | **Every** event with `ok: false` in the meta vault's usage trace — 118 of them, out of 7,707 calls, in the order they were appended. Timestamp, tool, surface, error text, session. |
| `corpus.json` | How many events were read, how many were refusals, the bounds of the window, and the per-tool breakdown. |

## The cut is one line, and it is not the census's line

**Every `ok: false` event, nothing dropped.** No filtering by tool, by message shape, or by
whether the classifier can read it. That matters more here than it usually does: the whole
claim behind weighting by usage is that the events were recorded by a process that had no
idea this census would be taken over them. `src/telemetry/usage.ts` appends them as calls
happen, fail-open, and it records size rather than content — so nothing in a row was chosen
by anyone with an interest in the answer.

The 7,589 successful calls are counted in `corpus.json` and not committed as rows. The
census's denominator is refusals; the successes would be 1.3 MB of fixture no assertion
reads.

## Two properties of this corpus that the number depends on

**It is not 118 independent events.** Sixty-one of the 118 — 52% — are one tool
(`ost_annotate`), one class (`no such node`), one day (2026-07-26), one surface
(`cli-tool`), no session id, and every argument a single English word. That is what an
unquoted title looks like after a shell has split it: one caller mistake recorded 61 times.
The census reports the bar twice for that reason, and the test asserts both numbers by
name — see the module note in `src/telemetry/refusal-precondition-coverage.ts`.

**The error text is truncated at 300 characters.** `MAX_ERR_CHARS` in
`src/telemetry/usage.ts` clips `err`, and this surface writes refusals longer than that.
Three rows in the corpus are cut mid-reason; two are still legible enough to classify and
one is not. The unreadable one stays in the denominator — a refusal nobody can classify is
a refusal no precondition demonstrably covers, and moving it out would be the census
grading its own homework.

## The window

`2026-07-25T01:53:33.667Z` to `2026-08-31T00:00:02.517Z`. Nothing was clipped at either
end; those are simply the first and last events the trace held when it was cut.
