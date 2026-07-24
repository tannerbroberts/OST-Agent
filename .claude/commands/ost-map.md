---
description: Map unmapped evidence into customer #Opportunity nodes (OST discovery process P2)
allowed-tools: mcp__ost-agent__ost_next_work, mcp__ost-agent__ost_read_tree, mcp__ost-agent__ost_create_node, mcp__ost-agent__ost_link_nodes
---

Run opportunity mapping. Follow the `opportunity-solution-tree` skill's rules.

1. Call `ost_next_work`; take its `unmappedEvidence` list. If empty, say so and stop.
2. Call `ost_read_tree` to see existing opportunities (so you reuse instead of duplicating).
3. For each evidence item, distill the **customer need / pain / desire** it reveals, phrased from the customer's perspective — never a solution or a business metric. Apply the litmus test: "is there more than one way to address this?" If not, it's a solution in disguise — reframe upward into the underlying need, or skip and note it for human review.
4. Create each genuine opportunity with `ost_create_node` (layer `Opportunity`, parent = the Outcome or the best-fit parent opportunity, `source` = the evidence id). Reuse an existing opportunity via `ost_link_nodes` rather than duplicating. If an item reveals no real need, skip it — do not invent needs.
5. Report what you created and what you skipped/held for review. Writes auto-commit.
