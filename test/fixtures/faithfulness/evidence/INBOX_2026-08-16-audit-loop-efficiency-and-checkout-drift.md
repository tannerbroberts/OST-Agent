---
id: 'INBOX:2026-08-16-audit-loop-efficiency-and-checkout-drift.md'
source: 'INBOX:2026-08-16-audit-loop-efficiency-and-checkout-drift.md'
title: 2026-08-16-audit-loop-efficiency-and-checkout-drift
timestamp: '2026-08-16T02:24:18.337Z'
actor: inbox
---
# Audit note — discovery/build feedback efficiency (2026-08-16)

Source: an attended audit session, invoked to check whether discovery was writing genuine
work to this tree and build was building genuine features from it. Evidence class:
**observed**, from live logs, vault state and a real test run, unless marked otherwise.

## Two defects found and fixed this session

**1. `discovery.target` was scoping every firing onto an exhausted branch.** The
compression branch ("More reaches my senses than fits in the window where I think") had
returned `done: true` with zero writes on every firing since at least 2026-08-16T00:37Z —
confirmed across consecutive passes in `ost-meta-loop.log`. Its remaining in-scope work is
3 needsHumans tests, which no unattended pass can advance regardless of scope. Every hourly
firing was real weighted-token spend to reconfirm nothing had changed, while 198 unmapped
evidence items, 1 underserved opportunity, 12 hygiene issues, 372 assumption-work items and
70 uninstrumented solutions sat completely untouched. Both of the last two discovery reports
themselves recommended clearing it. **Fixed:** `discovery.target` commented out in
`ost.config.yaml` (commit `b03cae4`). Resume scoped focus by uncommenting it once the
needsHumans tests are run.

**2. The build loop was starving on one stuck target.** `examples/automation/build-pass.sh`
picks the FIRST buildable candidate in a deterministic tree-order list and only skips it if
its instrument turns green (`SPENT`). A solution whose instrument is a genuine, PERMANENT
negative — `two-stage-question-stop-count`, open PR #130 since 2026-08-12 — never becomes
SPENT, so it stayed first every firing, forever. It absorbed the model call on every hourly
firing for days while ~196 other buildable candidates in this vault sat completely
untouched. The instrument itself is correct and should stay red: the report already found
"two-stage framing would cost 92 operator turns against one-stage's actual 72" — forcing it
green would misreport a real finding. This is exactly the shape flagged in the founder's own
2026-08-11 note in this inbox: a diagnosed negative with no path back to a person. **Fixed:**
`examples/automation/build-pass.sh` now tracks per-target failed-ship attempts against the
node's own file fingerprint (an edit resets the count) — two failures on an unchanged node
and the next firing moves to the next candidate — and deposits a plain-text inbox note here,
once, when a target crosses that threshold, so this ingestion actually sees stuck targets
instead of them living only in an hourly report file. Merged as OST-Agent PR #131
(`c71da41`), 76/76 relevant tests plus 2926/2927 full suite (the one failure is the
diagnosed-negative instrument itself, unrelated to and unchanged by this fix).

## What this means for "two-stage-question-stop-count" specifically

This solution will stop being retried automatically as of the fix above (it already has 0+
recorded failed-ship attempts under the new tracker as of this note — the next 1-2 build
firings will still try it before the breaker engages, per the new threshold). The underlying
question is real and answered: two-stage framing is more expensive than one-stage on the
harvested corpus. **This is evidence for a human decision, not a finding for this pass to
act on** — whether to `ost-agent result` a negative outcome on the assumption test, defer
the solution, or reframe it. PR #130 itself should likely be closed without merging, since
its own instrument disagrees with its premise.

## A risk noticed, not yet acted on: shared-checkout branch drift

Both loops execute their automation scripts directly from whatever branch is checked out in
the single shared working directory (`~/dev/OST-Agent`, no worktree isolation). A build
session's own `git checkout -b <branch>` (its first build step, per its prompt) leaves that
branch checked out afterward — observed: this repo sat on `two-stage-question-stop-count`
for the length of that solution's whole stuck period, meaning every later firing of BOTH
loops ran automation code from that branch rather than from reviewed `main`, until this
audit session manually reset it. In this instance the drift was harmless (the stuck branch
never touched `examples/automation/*.sh`), but the build agent's grant includes unrestricted
`Write` against the whole repository, including its own policy scripts — nothing currently
stops a future build session from editing `examples/automation/build-pass.sh` itself,
leaving that branch checked out, and having that edited script become the executable policy
for every subsequent firing of both loops with no review in between. Evidence class for the
risk itself: **inferred**, not observed — no session has done this. Worth a human decision:
whether the shared checkout should be reset to `main` at the START of each firing (before
reading which script to run), independent of what the last firing left behind.
