---
description: Run a full autonomous OST maintenance pass — map, ideate, surface assumptions, and flag hygiene until the tree is current
allowed-tools: mcp__ost-agent__ost_next_work, mcp__ost-agent__ost_read_tree, mcp__ost-agent__ost_create_node, mcp__ost-agent__ost_link_nodes, mcp__ost-agent__ost_append_to_node, mcp__ost-agent__ost_set_status, mcp__ost-agent__ost_annotate
---

Run one complete, autonomous maintenance pass over the OST vault. Follow the `opportunity-solution-tree` skill's rules exactly. This is the unattended sweep — do not ask the user questions; act on what the tools report and note anything ambiguous for later human review.

Loop until the tree is current:

1. Call `ost_next_work`.
2. If `done: true`, stop and report the final summary.
3. Otherwise handle every bucket it returned, in this order:
   1. **`unmappedEvidence`** → distill each into a customer `#Opportunity` (reuse, don't duplicate; reframe solution/business-shaped inputs into needs; skip items with no genuine need).
   2. **`underservedOpportunities`** → ideate distinct candidate `#Solution` nodes (`unvalidated`) up to the required minimum, one opportunity at a time.
   3. **`solutionsMissingAssumptions`** → surface `#AssumptionTest` nodes (`unvalidated`) that *propose* small, fast tests across desirability / viability / feasibility / usability.
   4. **`hygieneIssues`** → `ost_annotate` each (never delete).
4. Re-call `ost_next_work` to confirm progress. Repeat until `done: true` or nothing changed on the last iteration (to avoid looping on something you can't resolve — annotate those for a human and stop).

Hard rules: append-only, never mark your own ideas `validated`, never invent or change the Outcome, never run tests. Writes auto-commit as you go. End with a concise report: what you created per layer, and what a human should review.
