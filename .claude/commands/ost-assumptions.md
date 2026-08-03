---
description: Surface the key assumptions each solution depends on as #AssumptionTest nodes (OST discovery process P4)
allowed-tools: mcp__ost-agent__ost_next_work, mcp__ost-agent__ost_read_tree, mcp__ost-agent__ost_create_node, mcp__ost-agent__ost_link_nodes
---

Run assumption surfacing. Follow the `opportunity-solution-tree` skill's rules.

1. Call `ost_next_work`; take its `solutionsMissingAssumptions` list. If empty, say so and stop.
2. For each solution, surface the **riskiest underlying assumptions** it depends on across the four risk categories — desirability, viability, feasibility, usability (also consider potential-harm / ethical assumptions).
3. Create `#AssumptionTest` nodes with `ost_create_node` (layer `AssumptionTest`, parent = the solution, `status: unvalidated` — the `unvalidated` tag is stamped for you). Each node must **propose a small, fast test** with a pre-committed success threshold.
4. **Ask of each one whether the repository could answer it, before assuming a person must.** An assumption about code — a guard that should refuse, a path that should resolve, an exit code the node claims — is settled by a spec file in minutes. Where it can, pass `instrument:` naming one spec file in the target repository's own suite (that field's description on `ost_create_node` gives the exact form), pointed at a spec that **fails today** and passes once the solution is built. A command that already passes cannot fail, so it measures nothing; red-now is what makes the test a prediction rather than a description.
5. Append the test to the **end of the solution node** (`ost_append_to_node`): the `[[wikilink]]` on its own line, then the command beneath it. The builder reads the solution, not the layer below it.
6. Where only real people can answer — willingness to pay, usability with strangers, whether anyone wants it — leave the instrument off and say in the body why the repo cannot settle it. Say the same thing about the instruments you do write: a green spec proves the code behaves, never that anyone wanted it.
7. You propose test designs only — you never run tests, and you never record results as evidence. Humans run tests with real customers/data.
8. Report the assumptions/tests you proposed per solution, and which of them a machine can now answer. Writes auto-commit.
