# Changelog

## 0.1.2

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
