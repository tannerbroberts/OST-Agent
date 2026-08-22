# Friction (missing-affordance): Fourth straight scheduled pass (15th-18th) with no ost_* MCP tools — root cause found: ost-agent-meta carries no .claude/settings.json enabling the ost-agent plugin, unlike OST-Agent/examples/vault/.claude/settings.json which sets enabledPlugins ost-agent@ost-agent

- **kind:** missing-affordance
- **filed:** 2026-08-01T14:35:25.539Z
- **filed by:** session

**Context:** Scheduled OST-Agent maintenance task; plugin.json declares mcpServers.ost-agent as node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs mcp with OST_VAULT=${CLAUDE_PROJECT_DIR}, but nothing in this session's project or the vault repo enables the plugin so that server never launches

Filed by the agent at the moment of friction. Evidence class: **observed behavior** — self-reported by
the product's own agent, so it grounds usability, not demand, and is subject to whatever this agent
failed to notice or chose not to file.
