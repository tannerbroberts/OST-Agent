---
description: Surface the key assumptions each solution depends on as #AssumptionTest nodes (OST discovery process P4)
allowed-tools: mcp__ost-agent__ost_next_work, mcp__ost-agent__ost_read_tree, mcp__ost-agent__ost_create_node, mcp__ost-agent__ost_link_nodes
---

Run assumption surfacing. Follow the `opportunity-solution-tree` skill's rules.

1. Call `ost_next_work`; take its `solutionsMissingAssumptions` list. If empty, say so and stop.
2. For each solution, surface the **riskiest underlying assumptions** it depends on across the four risk categories — desirability, viability, feasibility, usability (also consider potential-harm / ethical assumptions).
3. Create `#AssumptionTest` nodes with `ost_create_node` (layer `AssumptionTest`, parent = the solution, `status: unvalidated`, `unvalidated` tag). Each node must **propose a small, fast test** with a pre-committed success threshold.
4. You propose test designs only — you never run tests, and you never record results as evidence. Humans run tests with real customers/data.
5. Report the assumptions/tests you proposed per solution. Writes auto-commit.
