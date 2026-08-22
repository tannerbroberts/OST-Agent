---
id: >-
  INBOX:2026-08-20-build-loop-stuck-every-run-records-the-tool-surface-it-actually-had.md
source: >-
  INBOX:2026-08-20-build-loop-stuck-every-run-records-the-tool-surface-it-actually-had.md
title: 2026-08-20-build-loop-stuck-every-run-records-the-tool-surface-it-actually-had
timestamp: '2026-08-20T11:13:30.775Z'
actor: inbox
---
# Build note — "Every run records the tool surface it actually had" has not shipped after 2 attempt(s) in a row

Source: build loop, automated, 2026-08-20T11:13:30Z. Evidence class: observed — an exit code the loop watched, not what the model reported.

This solution cleared a build permit but has now failed to ship 2 firing(s) in a row with its own node file unchanged in between, so each firing was reasoning about the same unresolved definition. The build loop cannot write the tree and is leaving this as evidence, not a verdict.

Most recent build report:

Built nothing new: an earlier pass today already built this node on branch run-tool-surface (PR #181), with the exact instrument test/loop/run-record-tool-surface.test.ts. tsc clean, vitest green, CI green, mergeable, still unmerged; I re-verified rather than duplicate it. Finding: that PR names a real architectural cost the node's "very small" estimate missed - recording tool surface data forced health.ts and tool-surface-record.ts into a shared structural type instead of an import, to satisfy Gate F6's decider/reporter scan. Also: this loop can re-fire a cleared node before its prior build has merged. [Loop check: the instrument for this solution is still red after the build, so the definition of done was not met regardless of what the report above says.] [Loop ship: NOT MERGED — the branch was not eligible to ship: not shipped — refusing to ship with uncommitted changes: the gates would measure a working tree that is not what merges. Commit or stash first.]

For discovery or a human to decide: whether this is a diagnosed negative worth deferring, a solution worth reframing, or a gate worth revisiting. The build loop will keep passing over this target in favor of other buildable candidates until this node changes.
