---
description: Run a full autonomous OST maintenance pass — map, ideate, surface assumptions, and flag hygiene until the tree is current
allowed-tools: mcp__ost-agent__ost_ingest_inbox, mcp__ost-agent__ost_next_work, mcp__ost-agent__ost_read_tree, mcp__ost-agent__ost_create_node, mcp__ost-agent__ost_link_nodes, mcp__ost-agent__ost_append_to_node, mcp__ost-agent__ost_set_status, mcp__ost-agent__ost_annotate
---

Run one complete, autonomous maintenance pass over the OST vault. Follow the `opportunity-solution-tree` skill's rules exactly. This is the unattended sweep — do not ask the user questions; act on what the tools report and note anything ambiguous for later human review.

Loop until the tree is current:

1. Call `ost_ingest_inbox`, then `ost_next_work`.
2. If `done: true`, stop and report the final summary. `openUnknowns` may still be non-empty when `done` is true — that is a complete pass, not an incomplete one.
3. Otherwise handle every bucket it returned, in this order:
   1. **`unmappedEvidence`** → distill each into a customer `#Opportunity` (reuse, don't duplicate; reframe solution/business-shaped inputs into needs; skip items with no genuine need).
   2. **`underservedOpportunities`** → ideate distinct candidate `#Solution` nodes (`unvalidated`) up to the required minimum, one opportunity at a time.
   3. **`solutionsMissingAssumptions`** → surface `#AssumptionTest` nodes (`unvalidated`) that *propose* small, fast tests across desirability / viability / feasibility / usability.
   4. **`hygieneIssues`** → `ost_annotate` each (never delete).
   5. **`openUnknowns`** → optional, last, and only once 1–4 are empty. Work within the tools this sweep already holds: close the reported `gaps` with `ost_append_to_node` (`## Format` first — it is the stopping condition, the shape a valid answer takes); append `## Answer` in that declared Format only when this pass has genuine grounds for one; `ost_set_status` `deferred` for what you will not pursue, because recorded abandonment is information. Read each unknown's class off the tool output rather than restating it. Pass `unknown: "<the unknown's exact title>"` on every call you make on its behalf, so the attention self-attributes. **This bucket never blocks `done`** — advance what you can in one visit and move on; do not loop on it.
4. Re-call `ost_ingest_inbox`, then `ost_next_work`, to confirm progress — re-ingesting each iteration so notes dropped mid-sweep are not missed. Repeat until `done: true` or nothing changed on the last iteration (to avoid looping on something you can't resolve — annotate those for a human and stop).

Hard rules: append-only, never mark your own ideas `validated`, never invent or change the Outcome, never run tests. This unattended sweep holds no outward-sensing grant on purpose — looking things up costs money, so `ost_search_web` / `ost_read_web` / `ost_read_repo` stay on the attended path (the `opportunity-solution-tree` skill), and an unknown this sweep cannot resolve from the tree is left open or deferred, never chased. Writes auto-commit as you go. End with a concise report: what you created per layer, which unknowns you advanced or deferred, and what a human should review.
