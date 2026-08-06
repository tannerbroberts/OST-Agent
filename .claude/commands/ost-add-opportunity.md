---
description: Contribute a customer insight to the tree — reframes it into a proper #Opportunity and attaches it
argument-hint: <the customer insight, need, or pain in your own words>
allowed-tools: mcp__plugin_ost-agent_ost-agent__ost_read_tree, mcp__plugin_ost-agent_ost-agent__ost_create_node, mcp__plugin_ost-agent_ost-agent__ost_link_nodes
---

A human is participating in discovery. Their insight:

> $ARGUMENTS

1. Call `ost_read_tree` to see the Outcome and existing opportunities.
2. Decide what this insight really is:
   - If it's already a **customer need / pain / desire**, phrase it cleanly from the customer's perspective.
   - If it's **solution-shaped or business-shaped** ("add a leaderboard", "increase revenue"), reframe it into the underlying customer need (apply the "more than one way to address it?" litmus test). Tell the user how you reframed it and why.
   - If it maps to an **existing** opportunity, don't duplicate — say so and, if useful, append supporting context to that node instead.
3. Create the `#Opportunity` with `ost_create_node` (parent = the Outcome or the best-fit parent opportunity, `source` = `human:conversation`). Do not mark it validated.
4. Confirm what you added and suggest running `/ost-ideate "<title>"` to generate candidate solutions for it.
