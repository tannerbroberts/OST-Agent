Source: implementation decision, 2026-07-22

We deliberately chose the Anthropic API SDK Tool Runner over the separate Claude Agent SDK,
because the Agent SDK ships built-in Bash/Write/Edit tools that we would then have to
disable (a blocklist). The Tool Runner registers only the tools we define, so no
general-purpose or destructive tool exists to hijack — an allowlist. Trust comes from the
absence of capability, not from restraining a capable agent.
