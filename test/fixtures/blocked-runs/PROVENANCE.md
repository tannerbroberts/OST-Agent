# Blocked-run corpus — how it was cut

`test/loop/blocked-run-independent-work.test.ts` asks whether a run that files
`ost_flag_humans_required` has other work available, or whether everything it still
intended sits downstream of the block. The assumption test it implements ("Take ten past
blocked runs and measure how much work sat independent of the block", in the meta vault)
pre-committed its bar before this fixture existed: **in at least 6 of 10 runs, half or more
of the remaining work must be independent of the block.**

## The cut

`scripts/harvest-blocked-runs.ts` re-derives this fixture from raw Claude Code transcripts
so it can be checked against the source instead of trusted:

```
npx tsx scripts/harvest-blocked-runs.ts ~/.claude/projects/-Users-tanner-ost-agent-meta
```

1. **Candidates.** Every transcript the meta vault held a `TRANSCRIPT:` evidence record for,
   as of 2026-08-16, whose friction summary mentions a block filing — 19 sessions. All are
   unattended firings of this vault's own build/discovery loop, not a synthetic corpus.
2. **Filed, not just mentioned.** A session is dropped unless it actually calls
   `mcp__ost-agent__ost_flag_humans_required` — the vault's friction summary can say
   "BLOCKED" from a refused-permission line without the call landing. Drops 1
   (`f9f63ce3`, permission refused before the call fired).
3. **Something after it.** A session is dropped if the first block it files has no
   node-mutating tool call after it — a run that stopped dead has nothing to partition.
   None of the remaining 18 were dropped by this step; every one kept working.
4. **Ten by size.** Of the 18 that remain, the ten with the most transcript entries are
   kept, so the corpus favours runs with enough afterward to be worth walking rather than a
   coin flip on one or two items, then sorted by the block's own timestamp.

18 candidates minus the smallest 8 by entry count leaves the **ten runs** the assumption
test's design names.

## What is mechanical and what is read verbatim

Every field is read directly off the transcript, not paraphrased:

- **The block** (`test`, `why`) is the exact input of the first
  `ost_flag_humans_required` call.
- **Outstanding work** is the ordered, deduplicated list of node titles named by every
  node-mutating MCP call (`ost_set_instrument`, `ost_append_to_node`, `ost_create_node`,
  `ost_annotate`, `ost_set_status`) issued anywhere after that first block, first
  occurrence kept. Read-only calls (`Read`, `Grep`, `ost_check`/`status`/`debt`/
  `next_work`/`ingest_inbox`) are excluded — they are how the run decided what to do, not
  a thing it did.

Nothing here is a hand-written paraphrase of intent the way the question-stop corpus's
outstanding-work lists are (see `test/fixtures/question-stops/PROVENANCE.md`) — a work item
is a call the run actually made, named by the node it actually named. The tradeoff is the
opposite one: this corpus cannot see work the run *intended* but never got around to
calling a tool for, so it undercounts, never overcounts, what came after the block.

## How independence is judged

The test reuses `partitionOutstanding` and `classifyWork` from `src/loop/question-bank.ts`
— the same conservative dependence rule the question-bank replay holds itself to, authored
against an unrelated corpus (seventeen `AskUserQuestion` stops), not against this one. The
block's `test` and `why` stand in for the fork's question text; a blocked run has no
options, so the footing-fork criterion never fires. Reusing an already-committed,
independently-authored rule — rather than writing a bespoke one against this exact
corpus — is deliberate: a rule tuned to this data would make the bar it clears
unfalsifiable.

## What a green run does not settle

Same limits the assumption test itself states: this is retrospective (a run in the moment
lacks the view a completed transcript gives), it counts items, not value, and a
node-mutating call proves the run *judged* an item independent enough to act on — not that
the judgement was correct. A run that acted on a wrong independence call would still show
up here as work done. Nothing in this fixture or test checks that.
