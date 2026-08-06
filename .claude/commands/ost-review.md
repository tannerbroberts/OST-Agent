---
description: Triage the agent-ideated (unvalidated) nodes — help a human promote, defer, or annotate them
argument-hint: [layer to focus: Solution | Opportunity | AssumptionTest — optional]
allowed-tools: mcp__plugin_ost-agent_ost-agent__ost_read_tree, mcp__plugin_ost-agent_ost-agent__ost_set_status, mcp__plugin_ost-agent_ost-agent__ost_annotate, mcp__plugin_ost-agent_ost-agent__ost_append_to_node
---

Help the human review what the agent proposed. This is the human-decision step the autonomous pass deliberately leaves open — everything the agent originates is `unvalidated`.

Focus layer (optional): **$ARGUMENTS**

1. `ost_read_tree`; list the `unvalidated` nodes (filtered to `$ARGUMENTS` if given), grouped by their parent, with a one-line summary of each.
2. For each, present the decision compactly and let the human choose:
   - **promote** → you cannot do this, by construction: `validated` is not a value `ost_set_status` accepts. Tell the human the exact command to run — `ost-agent promote "<title>" --by "<who>" --why "<the evidence>"` — and never suggest it without evidence the human has stated.
   - **defer** → `ost_set_status` to `deferred` with the reason.
   - **in-discovery** → `ost_set_status` to `in-discovery` when a test is being run.
   - **annotate** → `ost_annotate` to attach a question or a merge/duplicate flag.
   - **skip** → leave as-is.
3. Apply only the transitions the human confirms. Do not delete anything; corrections are new commits. Writes auto-commit.
4. End with a summary of what changed and how many `unvalidated` nodes remain.

Never mark a node `validated` without evidence the human supplied — that is the one line the system does not cross.
