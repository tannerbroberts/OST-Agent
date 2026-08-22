---
id: >-
  INBOX:2026-08-16-build-loop-stuck-ask-the-open-question-first-and-offer-options-only-once-the-.md
source: >-
  INBOX:2026-08-16-build-loop-stuck-ask-the-open-question-first-and-offer-options-only-once-the-.md
title: >-
  2026-08-16-build-loop-stuck-ask-the-open-question-first-and-offer-options-only-once-the-
timestamp: '2026-08-16T03:56:39.219Z'
actor: inbox
---
# Build note — "Ask the open question first, and offer options only once the frame is agreed" has not shipped after 2 attempt(s) in a row

Source: build loop, automated, 2026-08-16T03:56:39Z. Evidence class: observed — an exit code the loop watched, not what the model reported.

This solution cleared a build permit but has now failed to ship 2 firing(s) in a row with its own node file unchanged in between, so each firing was reasoning about the same unresolved definition. The build loop cannot write the tree and is leaving this as evidence, not a verdict.

Most recent build report:

Built the assumption instrument (src/loop/questions.ts: STOP_COUNT_RULE/stopCount/sessionStopCount) that replays 11 harvested sessions to cost one-stage vs two-stage questions in operator turns. Confirmed, did not rebuild: this was already complete on branch two-stage-question-stop-count with open PR #130 (a prior pass had been interrupted before reporting). Finding: the solution is falsified by real data — two-stage costs 92 operator turns against one-stage's actual 72 across 46 recorded questions (only 28% reframed, well below the ~50% breakeven the arithmetic needs). Only 1 of 11 sessions favors two-stage. tsc clean, full suite green except this one assertion, which fails by design and should not be loosened. PR not expected to merge; recommend the tree record the solution as disproven. [Loop check: the instrument for this solution is still red after the build, so the definition of done was not met regardless of what the report above says.] [Loop ship: NOT MERGED — a gate went red when the loop re-ran it: not shipped — the "vitest" gate went red (exit 1). the suite is the definition of done for everything already shipped.]

For discovery or a human to decide: whether this is a diagnosed negative worth deferring, a solution worth reframing, or a gate worth revisiting. The build loop will keep passing over this target in favor of other buildable candidates until this node changes.
