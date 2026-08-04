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
#     server, the pass instructions and the skill are all read straight out of it.
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
OST_TOOLS="mcp__plugin_ost-agent_ost-agent__ost_ingest_inbox,mcp__plugin_ost-agent_ost-agent__ost_next_work,mcp__plugin_ost-agent_ost-agent__ost_read_tree,mcp__plugin_ost-agent_ost-agent__ost_create_node,mcp__plugin_ost-agent_ost-agent__ost_link_nodes,mcp__plugin_ost-agent_ost-agent__ost_append_to_node,mcp__plugin_ost-agent_ost-agent__ost_set_status,mcp__plugin_ost-agent_ost-agent__ost_set_evidence,mcp__plugin_ost-agent_ost-agent__ost_set_instrument,mcp__plugin_ost-agent_ost-agent__ost_annotate,mcp__plugin_ost-agent_ost-agent__ost_detach_nodes,mcp__plugin_ost-agent_ost-agent__ost_edit_node,mcp__plugin_ost-agent_ost-agent__ost_merge_nodes,mcp__plugin_ost-agent_ost-agent__ost_search_web,mcp__plugin_ost-agent_ost-agent__ost_read_web,mcp__plugin_ost-agent_ost-agent__ost_read_repo"

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
# against a per-pass budget and the raw built-ins do not — a reason that only
# holds now that the metered pair is actually granted above. It did not before:
# this list denied the unmetered path while the grant omitted the metered one,
# so the pass had no way to look outward at all and the justification for the
# denial described a route nobody could take. The tree recorded the symptom
# from the operator's side ("Fresh outside findings never reach the tree unless
# I go get them") without anyone noticing it was a missing line here.
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
# The temp file the MCP server is declared in, created before the trap below so that
# ONE trap can own both cleanups. A second `trap … EXIT` does not stack in bash — it
# replaces — so registering the unlink separately would silently discard the seal, and
# the firing would hold its lock until the TTL expired while leaving no verdict behind.
# Spelled as an explicit template rather than `mktemp -t ost-agent-mcp`, which is
# BSD syntax: GNU coreutils reads the argument as a template and rejects one with
# too few trailing X's, so the BSD form worked on the macOS machine this was written
# on and killed the firing at its first line on every Linux runner. `set -e` made
# that an exit 1 before anything was logged, which is the least legible way for a
# cron job to fail.
MCP_CONFIG="$(mktemp "${TMPDIR:-/tmp}/ost-agent-mcp.XXXXXX")"
# Same rule, same reason: created up here so the one trap below owns their cleanup
# too. They hold the computed top-level view and the prompt it is prepended to.
ROLLUP_FILE="$(mktemp "${TMPDIR:-/tmp}/ost-rollup.XXXXXX")"
PROMPT_FILE="$(mktemp "${TMPDIR:-/tmp}/ost-pass-prompt.XXXXXX")"

# Seal on every exit path, including a phase that aborted under `set -e`. The
# verdict is computed from what was recorded, so an aborted firing seals unhealthy
# rather than vanishing, and the lock is released either way.
trap 'rm -f "$MCP_CONFIG" "$ROLLUP_FILE" "$PROMPT_FILE"; node "$CLI" loop seal --vault . || true' EXIT

# The MCP server is declared here rather than loaded as a plugin, and the pass
# instructions are handed over as the prompt rather than invoked as `/ost-pass`.
#
# **Why this is not the tidier-looking `--plugin-dir "$OST_AGENT_DIR"` it replaces.**
# That form ran, exited 0, and did nothing: Claude Code answered `Unknown command:
# /ost-pass` and the firing sealed `no-op` with both phases green. The plugin's
# commands and its MCP server were both absent, so the surface the allowlist below
# describes was never present to be allowed. A pass with no tools cannot fail loudly —
# it has nothing to fail at — which is exactly the shape this repo refuses elsewhere,
# and the meta vault burned five straight scheduled firings on it before the health
# record's `no-op` verdict (F4) named it.
#
# --strict-mcp-config is the second half. Without it the pass inherits whatever MCP
# servers the invoking user happens to have configured — observed live: an unrelated
# deployment server's whole tool surface loaded into an unattended discovery pass. The
# allowlist would still gate the calls, but the ambient grant is not this script's to
# hand out.
#
# No --permission-mode: the default mode has no pre-acceptance, and under `-p` a tool
# outside --allowedTools cannot be interactively approved, so it is denied. This used
# to pass `acceptEdits`, which pre-approved Edit/Write against the vault itself and
# made the tool allowlist decorative (readiness criterion W5).
cat >"$MCP_CONFIG" <<JSON
{"mcpServers":{"ost-agent":{"command":"node","args":["$CLI","mcp","--vault","$PWD"]}}}
JSON

# Read out of the checkout at firing time, not copied here, so the pass this script
# runs is the pass the repo currently defines. `.claude/commands/ost-pass.md` is the
# same file whose frontmatter is the authority for $OST_TOOLS above — everything after
# its frontmatter is the instruction body that `/ost-pass` would have expanded to.
PASS_PROMPT="$(awk 'BEGIN{n=0} /^---$/{n++; next} n>=2' "$OST_AGENT_DIR/.claude/commands/ost-pass.md")"
OST_SKILL="$(cat "$OST_AGENT_DIR/.claude/skills/opportunity-solution-tree/SKILL.md")"

# The top-level view, computed here because the pass cannot compute it itself:
# this surface denies Bash on purpose (discovery may write the tree and may not
# touch the world), so `ost-agent rollup` has to be run by the shell and handed
# over. It costs no model call and replaces the habit it is named after — a pass
# that could not ask the tree how it was doing wrote a prose ledger onto the
# Outcome instead, twenty times, until the root was 86KB nobody could read.
#
# Written to a FILE and interpolated by reading it back, never through
# `$(cat <<PROMPT …)`: the rollup contains node titles, node titles contain
# apostrophes, and inside command substitution bash parses a heredoc body for
# quote pairs. That is the defect that killed build-pass.sh for hours on one
# apostrophe, and this is the same shape.
if ! node "$CLI" rollup --vault . >"$ROLLUP_FILE" 2>/dev/null; then
  # A rollup that will not compute must not take the pass down with it. Say so in
  # the prompt rather than silently handing over an empty view, which would read
  # as a tree with nothing in it.
  printf '(the top-level view could not be computed this firing — read the tree directly)\n' >"$ROLLUP_FILE"
fi
{
  printf 'THE TREE AS IT STANDS (computed by `ost-agent rollup`, not written by anyone):\n\n'
  cat "$ROLLUP_FILE"
  printf '\n\n---\n\n'
  printf '%s\n' "$PASS_PROMPT"
} >"$PROMPT_FILE"

node "$CLI" loop step --phase pass --vault . -- \
  claude -p "$(cat "$PROMPT_FILE")" \
  --append-system-prompt "$OST_SKILL" \
  --mcp-config "$MCP_CONFIG" \
  --strict-mcp-config \
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
