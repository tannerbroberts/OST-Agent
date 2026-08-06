---
description: Flag tree-hygiene issues (orphans, dangling links, duplicates) by annotating — never deleting (OST process P5)
allowed-tools: mcp__plugin_ost-agent_ost-agent__ost_next_work, mcp__plugin_ost-agent_ost-agent__ost_read_tree, mcp__plugin_ost-agent_ost-agent__ost_annotate
---

Run tree hygiene. Follow the `opportunity-solution-tree` skill's rules.

1. Call `ost_next_work`; take its `hygieneIssues` list. Also call `ost_read_tree` and look for likely duplicates or mislabeled nodes the structural check can't catch.
2. For each issue, attach a note with `ost_annotate` (title + a clear description of the problem). This is add-only.
3. **Never delete, rename, or re-link** to "fix" an issue — flag it for a human. Corrections are a human decision.
4. Report every annotation you added. Writes auto-commit.
