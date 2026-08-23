# Log-only friction corpus — how it was cut

The census in `test/telemetry/log-only-friction-recall.test.ts` asks whether the machine
trace already holds enough friction signal to be worth mining, by scoring a trace-only
derivation against the transcript channel's independent account of the same thirty days.
It has to run offline and give the same answer next year, so the corpus lives here rather
than being read off the vault that produced it. This file records exactly what was taken,
so anyone can disagree with the cut instead of with the number.

Everything here was produced by `scripts/harvest-log-only-friction-corpus.ts`, which is
committed so the cut is a rule anyone can re-run:

```bash
npx tsx scripts/harvest-log-only-friction-corpus.ts ~/ost-agent-meta \
  test/fixtures/log-only-friction --last-day 2026-08-23
```

## What is here

| File | What it is |
| --- | --- |
| `trace.jsonl` | **Every** tool invocation in `.ost-agent/usage/events.jsonl` between 2026-07-25 and 2026-08-23 — 6,234 of them, 100 failing, in the order they were recorded. |
| `known-friction.jsonl` | The 1,747 friction events the transcript channel had already extracted from 431 sessions in the same window, read back out of `.ost-agent/evidence/TRANSCRIPT_*.md`. |
| `corpus.json` | The window, how many trace lines were read, how many were torn, how many evidence items were read, and the declared-vs-shown event counts. |

**All 6,234 calls are committed, not the 100 failing ones.** The census's negative
direction is the half that matters: a derivation that answered "recurring friction" to
everything would satisfy every assertion about a corpus made of failures, and the 6,134
successful calls are the only thing that catches it. They also carry the retry signal —
a repeat call is a pair of *successes* far more often than a pair of errors.

`redactSecrets` was run over every error message and every friction detail committed here.

## The two records, and why they can only be compared as classes

The obvious comparison is per event: this `Edit` failed, is it in the trace? It cannot be
run, and the reason is structural rather than fixable here. A transcript is keyed by the
Claude session uuid. A trace event's `session` is minted by the MCP server per *server
instance* (`mcp-<uuid>`), and one Claude session can open several while several can share
one. Nothing in either record maps one to the other.

So the unit is the **friction class** — a `(kind, tool)` pair counted over the window,
recurring at three occurrences. That is also the unit the assumption test asks about
("distinct recurring failure patterns"), so nothing is given up by taking it, but the
finer question is genuinely unavailable and the census says so rather than approximating.

## Normalisation

The transcript sees `mcp__ost-agent__ost_next_work`; the trace, written inside the tool,
sees `ost_next_work`. Both host prefixes — the direct one and the plugin route's
`mcp__plugin_ost-agent_ost-agent__` — are stripped before the two are compared. Leaving
either on would file every OST tool as a tool this product does not hold, and the census
would answer its own question by construction.

## What the corpus shows

Run the census over it and the numbers are:

- The trace alone yields **14 recurring classes**, comfortably over the assumption test's
  "≥3 recurring patterns" bar. That clause is met.
- Of the **27 recurring classes the transcript channel found, 7 come back** — 26%.
- **16** of the 20 that do not are out of reach by construction: 15 are on tools this
  product does not hold (`Bash`, `Edit`, `Write`, `Glob`, `Grep`, `Read`, `Monitor`,
  `ScheduleWakeup`, `TaskOutput`, `AskUserQuestion`), and the sixteenth is a clarifying
  question, which is not a tool outcome at all. Counting those against the derivation
  would measure the tool allowlist rather than the signal in the trace, so they are
  reported separately.
- **4 are in-scope misses**, on `ost_flag_humans_required`, `ost_check`, `ost_status` and
  `ost_debt` — all four on the allowlist, all four things the trace could have recorded.
  In-scope recall is 7/11, 64%.

## The finding the in-scope misses carry

All four are the same shape, and it is worth stating plainly because the node did not
have it. Every one of those 89 events is a **grant refusal issued by the host** — "Claude
requested permissions to use `mcp__ost-agent__ost_check`, but you haven't granted it yet".
The call never reached the MCP server, so it never reached `withUsageTracing`, so nothing
wrote a line. `UsageEvent.denied` exists for exactly this classification and is set on
**none** of the 6,234 calls in the window.

That is not a gap a better derivation closes. A trace written inside the tool cannot see a
refusal that happens before the tool. Closing it needs a record from the host side, which
is new instrumentation — the cost the solution under test set out to avoid.

## The retry key, and the direction of its error

The transcript's retry rule is "this tool with this exact input, seen before in this
session". The trace records input *size* and never input content, so the closest available
key is `session + tool + argBytes`. That is strictly weaker: two different calls of the
same size collide and are reported as a retry that did not happen. On this corpus the
trace reports 154 `ost_read_tree` retries where the transcript channel recorded 1.

The direction matters more than the magnitude. The error runs toward **over**-detection,
which costs precision and cannot cost recall — so a retry class the trace fails to name is
a real absence rather than an artefact of the key. Closing it would mean adding an input
hash to the trace, which is again new instrumentation.

## What the corpus cannot support

- **One vault, one operator.** Every call here was made by this project's own passes
  against its own meta-vault. It is evidence about how much friction *this* agent's trace
  holds, not about a user whose sessions never touch the MCP surface.
- **The transcript channel is a second account, not ground truth.** Where the two disagree
  the census reports it (`unmatched`) rather than crediting either. A friction class
  neither record contains is invisible to this measurement entirely, which is exactly the
  trade-off the solution node states about itself: machine records measure what fails
  *loudly*.
- **166 traced calls carry no session** and are excluded from retry detection. Pooling
  them under a shared blank key would invent retries across unrelated CLI invocations, so
  the census drops them and reports the count.
- **Nothing here ranks anything.** The assumption test's second clause — that ≥2 of the
  recurring patterns map to a product problem a human agrees is worth fixing — is a
  judgement, and no count in this corpus can supply it. The census refuses that clause out
  loud on every run.
