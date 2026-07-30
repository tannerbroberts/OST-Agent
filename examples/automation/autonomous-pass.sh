#!/usr/bin/env bash
#
# Run one unattended OST maintenance pass over a vault using Claude Code headless.
#
# This is the "absolute autonomy" path: Claude Code is the reasoning brain (using
# your Claude subscription auth — no separate ANTHROPIC_API_KEY needed), driving
# the append-only ost-agent MCP tools. That surface has no delete, edit, rename or
# shell tool, and every write it makes is a new append-only git commit — so every
# write this script can produce is revertible.
#
# Revertible is not the same as inconsequential. The two writes the tree's gates read
# are now refused at the boundary rather than left to the agent's discipline: the
# `## Results` and `## Uncovered` headings cannot be authored through any tool
# argument, and `validated` is not a status any tool accepts (criteria B1, B2, B10).
# What is still open is the general claim rather than those two doors — nothing yet
# enumerates the whole surface to show no single call flips a gate, which is criterion
# P10. See docs/reference/v1-readiness.md before pointing this at a tree that anyone
# decides from.
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
#   - A `loop:` block in the vault's ost.config.yaml. Neither key has a default and
#     the firing refuses without them — a cadence nobody declared is a spend rate
#     this tool chose for you:
#
#       loop:
#         cadence: "6h"          # 30m / 6h / 1d. Absent ⇒ this vault never fires.
#         lockTtlMinutes: 60     # a firing still holding the lock after this is dead
#         spend:
#           ceilingWeightedTokens: 4000000   # weighted tokens; ratios, not currency
#           windowHours: 24                  # rolling, so exhaustion clears itself
#           sessionsDir: "~/.claude/projects/<slug>"   # where Claude Code writes this
#                                                      # vault's session transcripts
#
#     Run this script as often as you like — every 5 minutes from cron is fine. The
#     cadence gate is what decides whether a firing actually happens.
set -euo pipefail

VAULT_DIR="${1:-.}"
OST_AGENT_DIR="${OST_AGENT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CLI="$OST_AGENT_DIR/dist/ost-agent.mjs"

# Kept in sync with .claude/commands/ost-pass.md's `allowed-tools` frontmatter — that
# file is the authority on what /ost-pass needs. If it grants a new tool, add it here too.
OST_TOOLS="mcp__ost-agent__ost_ingest_inbox,mcp__ost-agent__ost_next_work,mcp__ost-agent__ost_read_tree,mcp__ost-agent__ost_create_node,mcp__ost-agent__ost_link_nodes,mcp__ost-agent__ost_append_to_node,mcp__ost-agent__ost_set_status,mcp__ost-agent__ost_set_evidence,mcp__ost-agent__ost_annotate"

# Every Claude Code built-in that can write a file, run a command, delegate to an
# agent with its own tool set, or reach the network. cwd IS the vault, so an
# ordinary Write here edits a node in place and nothing above is consulted — the
# append-only guarantee this script's header makes is a property of the MCP surface
# only, and holds for the pass only if the rest of the surface is off.
#
# Deny beats allow in Claude Code, so this list is the ceiling and $OST_TOOLS is the
# grant; the two must stay disjoint or a denied MCP tool silently drops a phase.
# `test/release/examples-allowlist.test.ts` pins both the membership and that
# disjointness. Web is here because ost_read_web/ost_search_web meter lookups
# against a per-pass budget and the raw built-ins do not.
DENIED_TOOLS="Bash,BashOutput,KillShell,Edit,MultiEdit,Write,NotebookEdit,Task,SlashCommand,WebFetch,WebSearch"

cd "$VAULT_DIR"

# May this vault fire? Exit 10 is the routine "not yet" and is the ONLY refusal
# that exits 0 here. Every other code means the vault is not going to fire until
# somebody changes something — an undeclared cadence, an undeclared or exhausted
# spend ceiling — and collapsing those into a quiet exit 0 would make a vault that
# has never fired once look exactly like a healthy one. `loop due` prints the last
# record on every invocation for the same reason.
set +e
node "$CLI" loop due --vault .
DUE=$?
set -e
if [ "$DUE" -eq 10 ]; then exit 0; fi
if [ "$DUE" -ne 0 ]; then
  echo "not firing (loop due exit $DUE) — see above." >&2
  exit "$DUE"
fi

# Take the overlap lock and open the health record. If this fails — another firing
# is live, or the record cannot be written — nothing runs. A firing nobody can read
# afterwards leaves the cadence window unconsumed and the vault firing forever.
#
# `--holder-pid $$` is this script: the lock is released the instant this process
# dies, however it dies. Without it the lock still clears, but only on its TTL.
#
# Exit 15 is "another firing is already running against this vault", which is a
# normal state for a cron that ticks faster than a pass takes — it is not silence,
# there IS a firing — so it exits 0 like the not-elapsed case. Everything else is
# a refusal and keeps its code.
set +e
node "$CLI" loop start --vault . --holder-pid "$$"
STARTED=$?
set -e
if [ "$STARTED" -eq 15 ]; then exit 0; fi
if [ "$STARTED" -ne 0 ]; then exit "$STARTED"; fi
# Seal on every exit path, including a phase that aborted under `set -e`. The
# verdict is computed from what was recorded, so an aborted firing seals unhealthy
# rather than vanishing, and the lock is released either way.
trap 'node "$CLI" loop seal --vault . || true' EXIT

# --plugin-dir loads the OST-Agent plugin (skill + /ost-pass command + MCP server).
# The plugin's MCP server reads OST_VAULT from ${CLAUDE_PROJECT_DIR}, which is this cwd.
# No --permission-mode: the default mode has no pre-acceptance, and under `-p` a tool
# outside --allowedTools cannot be interactively approved, so it is denied. This used
# to pass `acceptEdits`, which pre-approved Edit/Write against the vault itself and
# made the tool allowlist decorative (readiness criterion W5).
node "$CLI" loop step --phase pass --vault . -- \
  claude -p "/ost-pass" \
  --plugin-dir "$OST_AGENT_DIR" \
  --allowedTools "$OST_TOOLS" \
  --disallowedTools "$DENIED_TOOLS" \
  --output-format text

# `claude -p`'s exit code reports Claude Code's health, not the tree's — a pass that
# wedged, skipped a phase, or left the vault red still exits 0. `ost-agent check` runs
# the deterministic invariants and exits 1 on violations, which is the only mechanical
# truth available here, so the push is gated on it and a red tree fails the firing.
# Wrapped in `loop step` so the check's real exit code lands in the health record:
# `pass` and `check` are both required phases, and a firing missing either seals
# unhealthy no matter what it says about itself.
if ! node "$CLI" loop step --phase check --vault . -- node "$CLI" check --vault .; then
  echo "ost-agent check reported violations — not pushing." >&2
  exit 1
fi

# Writes were auto-committed by the MCP server. Push if the vault has a remote.
if git remote get-url origin >/dev/null 2>&1; then
  git push
fi
