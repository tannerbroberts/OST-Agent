---
description: Show the Opportunity Solution Tree's state and what maintenance is outstanding
allowed-tools: mcp__ost-agent__ost_read_tree, mcp__ost-agent__ost_next_work
---

Read-only status check on the OST vault.

1. Call `ost_next_work` and `ost_read_tree`.
2. Report:
   - Node counts by layer (Outcome / Opportunity / Solution / AssumptionTest) and how many are `unvalidated` (agent-ideated, awaiting human review).
   - The outstanding-work summary from `ost_next_work`: unmapped evidence, under-served opportunities, solutions missing assumption tests, hygiene issues.
   - A one-line recommendation of which `/ost-*` command to run next (`/ost-map`, `/ost-ideate`, `/ost-assumptions`, `/ost-hygiene`, or "nothing — tree is maintained").

Do not create, link, or modify anything. This is a read-only summary.
