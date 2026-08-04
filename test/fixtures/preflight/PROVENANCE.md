# Preflight-uncertainty corpus — how it was cut

The census in `test/telemetry/preflight-uncertainty-census.test.ts` counts how often a
failing call came from a caller already showing doubt. It has to run offline and give the
same answer next year, so the corpus lives here rather than being read off the machine
that produced it. This file records exactly what was taken, so anyone can disagree with
the cut instead of with the number.

## What is here

| File | What it is |
| --- | --- |
| `usage-events.jsonl` | The **whole** usage trace from the `ost-agent-meta` vault as of 2026-08-04 — 1125 events, 68 of them failures. Copied verbatim, nothing selected. |
| `b1ff6306-….jsonl` | Windows cut from one Claude Code session transcript (`~/.claude/projects/-Users-tanner-ost-agent-meta/`), 365 entries in the original. |
| `afce034c-….jsonl` | The same, from a second session, 628 entries in the original. |

The usage trace is committed whole on purpose. It records tool name, outcome, timing,
surface and input *size* — never input content — so there was no reason to sample it, and
committing all of it removes "which failures were chosen" as a question about the finding.

## How the transcripts were cut

The two sessions are the only ones anywhere under `~/.claude/projects` that contain a
`tool_use` matching a failed event within the join window. For each failing call at parsed
entry index `e`, the cut keeps entries `[e - 26, e + 2]`, merged across calls and kept in
original order. Nothing inside a kept entry was altered except by `redactSecrets`, which
found nothing to mask.

**26 is the number that matters.** The classifier's lookback is 6 entries and the widest
rung of its sensitivity ladder is 24, so every window any rung reads is present in full and
contiguous. A cut narrower than the widest rung would make two entries adjacent that were
not, and the census would report a read "immediately before" a call that in fact sat a
dozen turns away. The test asserts `max(sensitivityLadder) <= 26` so a future widening of
the ladder fails here instead of quietly reading across the seam.

## Fidelity

Before committing, the census was run over this fixture and over the live corpus
(1125 events, all 158 session transcripts on the machine) at every rung of the ladder. The
two agree exactly — failed, readable, unread, uncertain, proseless, signals by kind, and
the whole sensitivity ladder — at lookbacks 2, 6, 12 and 24. The fixture is the corpus, not
a sample of it.

## What the corpus cannot support

- **62 of the 68 failures have no session record at all.** They are CLI invocations from
  2026-07-26, and no transcript on the machine covers that window. They are reported as
  unread and counted neither way. Any share here is over a denominator of six.
- **Five of the six readable windows carry no caller prose.** Claude Code stores an
  assistant `thinking` block with its text removed and only the signature kept, so the
  place a caller would have written "I'm not sure this rung is allowed" is not in the
  record. In those windows only `read` and `question` — which are recorded in full — are
  evidence either way.
