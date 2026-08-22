# Friction (missing-affordance): Fifth straight scheduled pass with no ost_* MCP tools — refined root cause: this Claude Code Remote session has CLAUDE_CODE_REMOTE_SKIP_SETTINGS_SYNC=1 set, so the repo-committed .claude/settings.json (enabledPlugins.ost-agent, landed in #4) is never applied here; that fix works for local/interactive Claude Code but this scheduled-routine surface skips settings sync by design

- **kind:** missing-affordance
- **filed:** 2026-08-01T17:28:38.011Z
- **filed by:** session

**Context:** Scheduled OST-Agent maintenance task on tannerbroberts/ost-agent-meta. Confirmed via ToolSearch (no ost_* tools found) and ListPlugins (ost-agent not listed) that the MCP server never launched, then found CLAUDE_CODE_REMOTE_SKIP_SETTINGS_SYNC=1 in env — a deliberate guard against unattended remote sessions auto-executing an MCP server declared by a committed plugin manifest. Ran the deterministic, non-MCP surface instead: check (PASS, 0 violations / 241 nodes), status, debt, channels — all consistent with prior passes, no drift. The remaining work (map/ideate/assumptions passes over 212 unvalidated nodes) needs the ost_* MCP tools and cannot proceed until a human enables the ost-agent MCP server/plugin at the environment level (Claude Code web UI environment settings), not via another repo commit — that path is what's now been tried four times running.

Filed by the agent at the moment of friction. Evidence class: **observed behavior** — self-reported by
the product's own agent, so it grounds usability, not demand, and is subject to whatever this agent
failed to notice or chose not to file.
