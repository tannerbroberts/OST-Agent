#!/usr/bin/env bash
#
# Run one unattended OST maintenance pass over a vault using Claude Code headless.
#
# This is the "absolute autonomy" path: Claude Code is the reasoning brain (using
# your Claude subscription auth — no separate ANTHROPIC_API_KEY needed), driving
# the append-only ost-agent MCP tools. Because that tool surface has no delete,
# edit, or shell tool, running this with wide-open permissions is still safe by
# construction — the worst case is a git commit that doesn't make sense, which is
# revertible. Every write is auto-committed by the MCP server as it goes.
#
# Usage:
#   OST_AGENT_DIR=/path/to/OST-Agent  examples/automation/autonomous-pass.sh  /path/to/vault
#
# Prereqs:
#   - Claude Code CLI installed and logged in (`claude` on PATH; `claude setup-token`
#     for a non-interactive machine).
#   - This OST-Agent checkout at OST_AGENT_DIR, with dist/ost-agent.mjs present (it's
#     committed, so a plain `git clone` is enough — no build, no npm install). The
#     plugin declares its MCP server as `node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs
#     mcp`; --plugin-dir loads it straight out of this checkout.
set -euo pipefail

VAULT_DIR="${1:-.}"
OST_AGENT_DIR="${OST_AGENT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# Kept in sync with .claude/commands/ost-pass.md's `allowed-tools` frontmatter — that
# file is the authority on what /ost-pass needs. If it grants a new tool, add it here too.
OST_TOOLS="mcp__ost-agent__ost_ingest_inbox,mcp__ost-agent__ost_next_work,mcp__ost-agent__ost_read_tree,mcp__ost-agent__ost_create_node,mcp__ost-agent__ost_link_nodes,mcp__ost-agent__ost_append_to_node,mcp__ost-agent__ost_set_status,mcp__ost-agent__ost_set_evidence,mcp__ost-agent__ost_annotate"

cd "$VAULT_DIR"

# --plugin-dir loads the OST-Agent plugin (skill + /ost-pass command + MCP server).
# The plugin's MCP server reads OST_VAULT from ${CLAUDE_PROJECT_DIR}, which is this cwd.
# --permission-mode acceptEdits + --allowedTools pre-approves exactly the append-only
# surface for a non-interactive run.
claude -p "/ost-pass" \
  --plugin-dir "$OST_AGENT_DIR" \
  --permission-mode acceptEdits \
  --allowedTools "$OST_TOOLS" \
  --output-format text

# `claude -p`'s exit code reports Claude Code's health, not the tree's — a pass that
# wedged, skipped a phase, or left the vault red still exits 0. `ost-agent check` runs
# the deterministic invariants and exits 1 on violations, which is the only mechanical
# truth available here, so the push is gated on it and a red tree fails the firing.
if ! node "$OST_AGENT_DIR/dist/ost-agent.mjs" check --vault .; then
  echo "ost-agent check reported violations — not pushing." >&2
  exit 1
fi

# Writes were auto-committed by the MCP server. Push if the vault has a remote.
if git remote get-url origin >/dev/null 2>&1; then
  git push
fi
