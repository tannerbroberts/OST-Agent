# Changelog

## Unreleased

## 0.7.0

- **The agent can now put a test out of its own reach — and that is the only lane call it
  can make.** v0.6.0 shipped lanes with no agent tool at all, because the permissive call
  (`compute-only`) is what decides that an unattended pass may go run something on its own
  authority. The consequence was a backlog that stayed entirely unclassified, which by the
  fail-closed rule means *nothing* is runnable: correct, and useless. `ost_flag_humans_required`
  resolves it in the safe direction only. It takes `test` and `why` and **no lane argument**,
  so "which lane" is not a decision the tool is able to express — `suggestCaution`'s advice,
  promoted to a capability. The permissive call stays on the human's CLI.
- **The absence of the argument is the safety argument.** Not a rule the agent is trusted to
  follow, but a capability that can only point one way — the same move as the tool allowlist
  itself. A test asserts the schema has exactly two properties and `additionalProperties: false`,
  another that a `why` demanding `compute-only` still writes `humans-required`, and another that
  flagging can only ever *shrink* what an unattended pass may run.
- **`ost-agent lanes --flag-cautious <who>` does the backlog in bulk**, in the one direction
  where bulk is safe. It applies `humans-required` to every *unclassified* test whose own text
  names an outside person, quoting the phrase for each, and skips anything already carrying a
  lane — a human's `compute-only` call is never quietly reversed. It then reports how many
  remain unclassified, so a bulk pass can't be misread as "triage done".
- **Attribution comes from the surface, not the model.** The tool does not ask the agent to
  name itself; the filing is recorded as `agent:<surface>`. A self-reported `by` is worth
  little in exactly the audit this field exists for.
- 265 tests across 44 files (up from 243 / 42).

## 0.6.0

- **Assumption tests now declare what they cost a person — and a pass can run the lane
  that costs nobody anything.** A backlog of tests is not one queue: replays and audits
  over artifacts already on disk sit in the same list as interviews, so everything waits
  on the operator and the free tests never get run. Every `AssumptionTest` may now carry
  a `lane` in frontmatter — `compute-only`, `one-command`, `pending-permission`, or
  `humans-required` — with `ost-agent lanes` to see the tree grouped by cost and
  `ost-agent lane "<test>" --set <lane> --by <who> --why <text>` to classify one.
  Classification is attributed and recorded in the node's History, so any lane can be
  traced back to who made the call.
- **The lane vocabulary fails closed, and that is the whole safety argument.** Exactly
  one lane (`compute-only`) is runnable by an unattended pass; an unclassified test, or a
  lane string a future version invents, is *not* runnable — the same floor rule the
  believability ladder uses. Unclassified never means "safe to automate". A test
  mislabelled `compute-only` and then run by an agent would write fabricated evidence
  into the tree, which is the one failure this product cannot survive.
- **The triage aid can only ever raise a hand.** `suggestCaution` scans a test for
  phrases naming people outside the building and quotes the one that matched
  (`names an outside person: "interview"`); it never returns a lane compute is allowed to
  run, and its silence means "no marker found", never "safe". The permissive call stays a
  human's by construction, enforced by test.
- **`pending-permission` is deliberately distinct from `one-command`.** Folded in from an
  observed stall in the unattended loop: `npm publish` is not a yes/no with evidence
  behind it, so filing it as a decision makes a decision docket feel like chores. What
  blocks it is a credential, not a judgement, and the two want different treatment.

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
