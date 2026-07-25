# Changelog

## Unreleased

## 0.5.0

- **A failed pass is now visible to a machine.** `ost-agent run` exits **1** and prints
  `<process> FAILED: <error>` to stderr when a pass errors — previously a pass that died
  on a driver error (observed 2026-07-25: an SDK auth failure in `P2_map`) still exited 0,
  committed, and printed a tidy summary, so a cron schedule would no-op forever while
  looking healthy. A partial pass — work committed, then an error — also exits 1: one
  code meaning "do not trust this run" is the contract cron, launchd, and CI already
  speak, and whatever landed before the error is still in the commit and the journal.
  `ost-agent schedule` logs the same `FAILED` line to stderr and stays up.
- **`ost-agent status` leads with the last failed run** — process, timestamp, the error
  verbatim, and the journal path — above the node counts, and labels each process's last
  run `ok`/`FAILED`. New `src/runner/journal.ts` reads the run journals that already
  existed and were already honest; the failure rule (a non-empty `error` field means the
  run failed) is the crudest one that survived a replay of all 14 existing journals —
  1/1 known failures caught, 0/13 healthy runs misclassified. A corrupt journal is
  skipped, never thrown on: one bad file must not hide a failure elsewhere.
- **Slack config accepts `#channel-name`s, not just IDs.** `HttpSlackClient` resolves
  names to ids via `conversations.list` (cached, GET-only) before reading history, and
  evidence keys on the stable channel id. Ids still pass straight through.

> Versions 0.2.0–0.4.0 were cut from a parallel feature line and left no changelog
> entries; their contents are in the git history between `f085862` and `3475ded`.

## 0.1.3

- **Fix:** a newly-created vault gets a repo-local git identity when none is
  configured globally, so `ost-agent init` (and every commit) works on a bare
  machine or a fresh CI runner instead of failing with "Please tell me who you are."
  Never overrides an existing identity. Regression test in `test/git/safe-git.test.ts`.
  (This was caught when the 0.1.2 publish workflow failed its own test gate in CI.)
- **Slack adapter (read-only):** channel history → evidence, via a least-privilege
  bot token (`channels:history`, `channels:read`); GET-only Web API. The last
  pending source is now built.
- **`/ost-review` command:** human triage of the `unvalidated` nodes the autonomous
  pass produces (promote with evidence, defer, mark in-discovery, or annotate).
- **Richer hygiene:** `ost_next_work` and `P5_hygiene` now flag same-layer
  near-duplicate titles (`findNearDuplicateIssues`, reusing the token-Jaccard
  `similarity`) — annotated for a human, never merged automatically.

## 0.1.1

- **Fix:** `ost_next_work` now treats evidence as mapped when any node cites it as
  its `source`, not only when the batch `P2_map` runner recorded it in
  `mapped.json`. The MCP-driven path (a Claude Code session running `/ost-pass`)
  attaches the evidence id via `ost_create_node` but never writes `mapped.json`, so
  previously a session-driven pass could map all evidence yet never see
  `ost_next_work` report `done: true`. Found by dogfooding the autonomous pass on the
  project's own eval corpus. Regression test: `test/mcp/next-work.test.ts`.

## 0.1.0

- Initial release: `ost-agent` CLI + append-only MCP server that maintains a Teresa
  Torres Opportunity Solution Tree as Obsidian-graph Markdown.
- Consumable from Claude Code as a skill + `/ost-*` slash commands + plugin (with a
  self-marketplace); `ost_next_work` orchestration tool; participant and autonomous
  (headless / scheduled) usage.
