Source: design review conversation, 2026-07-22

The operator has no Anthropic API key — the only intelligence available is the Claude
agent already running in their session. So OST-Agent must let the ambient agent BE the
driver: expose the append-only OST tools (as a CLI, and later an MCP server) that the
running agent operates directly, doing the discovery reasoning itself, with no separate
API token to buy or manage. The safety guarantees (append-only, allowlist, git, never
delete) hold regardless of who drives; only the source of intelligence changes. Operators
are put off by having to provision and pay for a second credential just to try the tool.
