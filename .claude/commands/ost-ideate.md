---
description: Ideate candidate #Solution nodes for under-served opportunities (OST discovery process P3)
argument-hint: [opportunity title to focus on — optional]
allowed-tools: mcp__ost-agent__ost_next_work, mcp__ost-agent__ost_read_tree, mcp__ost-agent__ost_create_node, mcp__ost-agent__ost_link_nodes
---

Run solution ideation. Follow the `opportunity-solution-tree` skill's rules.

Target opportunity (optional): **$ARGUMENTS**

1. Call `ost_next_work`; take its `underservedOpportunities` list (each shows how many solutions it has and how many are needed).
2. If `$ARGUMENTS` is non-empty, focus only on the opportunity whose title matches it; otherwise work through the under-served list, going deep on one opportunity at a time (work-in-progress limit).
3. For each target, ideate **genuinely distinct** candidate solutions (compare-and-contrast, not variations of one idea) until it reaches the required minimum. Create each with `ost_create_node` (layer `Solution`, parent = the opportunity, `status: unvalidated`, and an `unvalidated` tag).
4. Never describe implementation steps or write code. Never mark a solution `validated`. These are candidates for a human to weigh.
5. Report the solutions you added per opportunity. Writes auto-commit.
