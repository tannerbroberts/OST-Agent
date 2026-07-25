# Vault template — drop-in Claude Code setup

Copy the `.claude/` folder from here into your OST vault repository. It does two things
the moment you open the vault in Claude Code:

- **registers this repo as a plugin marketplace** (`extraKnownMarketplaces`), and
- **enables the `ost-agent` plugin** (`enabledPlugins`),

so the `opportunity-solution-tree` skill, the `/ost-*` commands, and the append-only
`ost-agent` MCP server are all available with no manual `claude mcp add` or
`/plugin install`. (Claude Code installs an enabled-but-not-yet-present plugin from its
declared marketplace on the next session start.)

```bash
# from your vault repo root
mkdir -p .claude
cp /path/to/OST-Agent/examples/vault/.claude/settings.json .claude/settings.json
```

Prefer to do it interactively instead? Run these once and skip the file:

```text
/plugin marketplace add tannerbroberts/OST-Agent
/plugin install ost-agent@ost-agent
```

Either way, the plugin's MCP server runs `npx -y ost-agent@latest mcp` against the vault
you have open (`${CLAUDE_PROJECT_DIR}`), so make sure the vault was created with
`ost-agent init` (it needs a human-set Outcome — the server refuses to bootstrap one).

For unattended/scheduled operation, see [`../automation/`](../automation/).
