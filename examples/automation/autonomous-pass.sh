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
#
# What this helper needs from the machine it runs on. `ost-agent helper-preflight`
# checks these before you install it, so a machine that cannot run this says so
# up front rather than at the line that first reaches for something absent.
# ost-requires: interpreter bash — arrays, process substitution and ${BASH_SOURCE}
# ost-requires: command node — runs dist/ost-agent.mjs, which is the whole CLI
# ost-requires: command claude — the Claude Code CLI is the reasoning half of the pass
# ost-requires: command git — pushes the vault's auto-committed writes
# ost-requires: command mktemp — the MCP config, rollup, corrections and prompt files
# ost-requires: command awk — strips the frontmatter off .claude/commands/ost-pass.md
# ost-requires: command sed — extracts allowed-tools and reshapes the tool lists
# ost-requires: command sort — -u on both tool lists, so comm can diff them
# ost-requires: command tr — splits the comma-separated tool lists into lines
# ost-requires: command comm — the withheld-tool derivation is a set difference
# ost-requires: command cat — reads the skill and the assembled prompt back
# ost-requires: command head — takes the first allowed-tools line
# ost-requires: command dirname — resolves OST_AGENT_DIR from ${BASH_SOURCE[0]}
# ost-requires: command rm — the EXIT trap clears the four temp files
set -euo pipefail

VAULT_DIR="${1:-.}"
OST_AGENT_DIR="${OST_AGENT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CLI="$OST_AGENT_DIR/dist/ost-agent.mjs"
# Read here rather than at the point of use, because two things now read it: the
# required-tool refusal below, and the system prompt this pass fires with.
SKILL_FILE="$OST_AGENT_DIR/.claude/skills/opportunity-solution-tree/SKILL.md"

# Kept in sync with .claude/commands/ost-pass.md's `allowed-tools` frontmatter — that
# file is the authority on what /ost-pass needs. If it grants a new tool, add it here too.
OST_TOOLS="mcp__ost-agent__ost_ingest_inbox,mcp__ost-agent__ost_next_work,mcp__ost-agent__ost_read_tree,mcp__ost-agent__ost_create_node,mcp__ost-agent__ost_link_nodes,mcp__ost-agent__ost_append_to_node,mcp__ost-agent__ost_set_status,mcp__ost-agent__ost_set_evidence,mcp__ost-agent__ost_set_instrument,mcp__ost-agent__ost_annotate,mcp__ost-agent__ost_detach_nodes,mcp__ost-agent__ost_edit_node,mcp__ost-agent__ost_merge_nodes,mcp__ost-agent__ost_search_web,mcp__ost-agent__ost_read_web,mcp__ost-agent__ost_read_repo"

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
#
# `Skill` rather than `SlashCommand`, and that rename is not cosmetic. Claude Code
# retired `SlashCommand` in favour of `Skill`; a deny rule naming a tool that no
# longer exists is inert, and Claude Code says so on every firing ("Permission deny
# rule "SlashCommand" matches no known tool"). Both loops printed that line on every
# run for four days. The warning was read as noise about a stale name — it was in
# fact the deny list reporting a HOLE: the delegation capability this entry exists to
# refuse had moved to a name nothing denied, so an unattended pass could invoke a
# skill and hand the turn to instructions carrying their own tool set. Silencing the
# warning by deleting the line would have closed the report and left the hole.
#
# `MultiEdit` is gone for the opposite reason: it was retired without a successor —
# its capability folded into `Edit`, which is denied on the line above — so it is
# genuinely dead weight rather than a hole wearing a stale name. The two cases look
# identical in the log and are opposites, which is why each is named here.
DENIED_TOOLS="Bash,BashOutput,KillShell,Edit,Write,NotebookEdit,Task,Skill,WebFetch,WebSearch"

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

# Does this surface carry the tools the pass cannot work without?
#
# The skill declares two lines: `allowed-tools`, everything the pass may reach
# for, and `required-tools`, the three it produces NOTHING without. $OST_TOOLS
# above grants 16 of the skill's 22 — the other six are withheld on purpose, and
# a check that refused over those would stop every firing over a containment
# somebody chose. So only the required half can stop this, and the withheld half
# comes out as the narrowing note the pass is already handed further down.
#
# Placed HERE, ahead of `loop start`, and that ordering is the whole guarantee: no
# lock is taken, no health record is opened, nothing is written into the vault.
# The alternative — discovering a missing tool at the call that needed it — is
# what five scheduled firings of this repo's meta vault actually did. Under
# `claude -p` that call is denied rather than prompted, so the pass carried on
# without it and produced a smaller result that reads from the outside exactly
# like a complete one. Refusing at second zero costs a cron mail; the other costs
# a night and leaves a record nobody can tell from a good one.
#
# Not wrapped in `set +e`: exits 30 (a required tool is absent) and 31 (the
# declaration could not be read) are both "do not begin", and there is no third
# case for this script to sort out. `set -e` stops here with the report on stderr.
node "$CLI" required-tools --pass "$SKILL_FILE" --available "$OST_TOOLS"

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
#
# `--pass`/`--available` repeat exactly what the `required-tools` call above was
# already given — nothing here lists or calls a tool a second time. It lets the
# run record say which tools this firing had and which required ones it did not
# get, so a human reading a week of runs at once does not have to re-derive the
# surface from the shape of a failure.
set +e
node "$CLI" loop start --vault . --holder-pid "$$" --pass "$SKILL_FILE" --available "$OST_TOOLS"
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
CORRECTIONS_FILE="$(mktemp "${TMPDIR:-/tmp}/ost-corrections.XXXXXX")"
PROMPT_FILE="$(mktemp "${TMPDIR:-/tmp}/ost-pass-prompt.XXXXXX")"

# Seal on every exit path, including a phase that aborted under `set -e`. The
# verdict is computed from what was recorded, so an aborted firing seals unhealthy
# rather than vanishing, and the lock is released either way.
trap 'rm -f "$MCP_CONFIG" "$ROLLUP_FILE" "$CORRECTIONS_FILE" "$PROMPT_FILE"; node "$CLI" loop seal --vault . || true' EXIT

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
OST_SKILL="$(cat "$SKILL_FILE")"

# The skill is handed over as the system prompt below, and its `allowed-tools` line
# declares every tool the SKILL grants — 22 of them. This surface grants fewer, and
# that is deliberate: R7's containment argument reads `.claude/commands/ost-pass.md`,
# and `src/knowledge/ruleset.ts` says in terms that granting a tool to the skill "does
# not move a single cell of that table" and must not "drift into the unattended sweep
# by association". The narrower grant is a decision. It is not the bug.
#
# Nobody telling the PASS about it is. The pass read its own rulebook, reached for
# `ost_check`, `ost_debt` and `ost_flag_humans_required`, and under `-p` a tool outside
# --allowedTools is denied rather than prompted — no message, no way to report a tool it
# was never offered. So it rediscovered the same fixed list one call at a time on every
# firing, then filed ~30 writes as "unverified" as though the tool had failed rather
# than never having been offered. Two consecutive firings reported an identical denied
# set and correctly concluded it was fixed rather than drifting; neither could see WHY,
# because the reason lives in a file the pass cannot read.
#
# Derived from the two lists themselves rather than typed out here, so it cannot drift
# from either — and it renders nothing at all when they agree, so the day a containment
# is retired this section disappears on its own instead of becoming a third stale copy.
# >>> withheld-derivation (executed verbatim by test/release/examples-allowlist.test.ts —
# it is extracted between these markers and run, so the test cannot pass against a copy
# of this logic that has drifted from the copy that ships)
SKILL_DECLARED="$(sed -n 's/^allowed-tools:[[:space:]]*//p' "$SKILL_FILE" | head -1 |
  tr ',' '\n' | sed 's/.*__//; s/[[:space:]]//g; /^$/d' | sort -u)"
SURFACE_GRANTED="$(printf '%s' "$OST_TOOLS" |
  tr ',' '\n' | sed 's/.*__//; s/[[:space:]]//g; /^$/d' | sort -u)"
WITHHELD="$(comm -23 <(printf '%s\n' "$SKILL_DECLARED") <(printf '%s\n' "$SURFACE_GRANTED") | sed '/^$/d')"
# <<< withheld-derivation

SURFACE_NOTE=""
if [ -n "$WITHHELD" ]; then
  SURFACE_NOTE="

# What this surface withholds

The skill above declares tools that THIS run does not grant:

$(printf '%s\n' "$WITHHELD" | sed 's/^/- /')

They are withheld on purpose — the argument for each is in
\`test/release/examples-allowlist.test.ts\` (CONTAINED_ON_PURPOSE) and
\`src/knowledge/ruleset.ts\` — not missing by accident, and not a fault you can clear.
Calling one is denied silently rather than refused with a message, so a call spent
finding that out buys nothing and the next firing would spend it again.

Do the pass without them. Where a step you would otherwise take needs one, say so in
your closing report and carry on — in particular, this run cannot verify its own writes
with \`ost_check\`, so report your writes as unverified-by-design rather than as a
tool that failed."
fi

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
# The corrections this workspace has already been given, harvested out of finished
# session transcripts and deduplicated by the permitted form each guard named.
#
# It goes at the HEAD of the prompt, ahead of the tree, and that placement is the
# whole mechanism. A refusal delivered as a tool-error message has no carrier out of
# the session it was delivered in — seven sessions across four days hit the identical
# `Blocked: sleep …` guard because nothing wrote it down, so the guard ended up being
# the only memory in the system. Read here, the correction reaches the session before
# it composes anything rather than after it has already reached for the wrong shape.
#
# Same failure discipline as the rollup: a ledger that cannot be read must not take
# the firing down, and its absence must be visible in the prompt rather than being an
# empty region the reader cannot distinguish from a clean workspace.
if ! node "$CLI" corrections --vault . >"$CORRECTIONS_FILE"; then
  printf '(the corrections ledger could not be read this firing)\n' >"$CORRECTIONS_FILE"
fi
{
  cat "$CORRECTIONS_FILE"
  printf '\n\n---\n\n'
  printf 'THE TREE AS IT STANDS (computed by `ost-agent rollup`, not written by anyone):\n\n'
  cat "$ROLLUP_FILE"
  printf '\n\n---\n\n'
  printf '%s\n' "$PASS_PROMPT"
} >"$PROMPT_FILE"

node "$CLI" loop step --phase pass --vault . -- \
  claude -p "$(cat "$PROMPT_FILE")" \
  --append-system-prompt "$OST_SKILL$SURFACE_NOTE" \
  --mcp-config "$MCP_CONFIG" \
  --strict-mcp-config \
  --allowedTools "$OST_TOOLS" \
  --disallowedTools "$DENIED_TOOLS" \
  --output-format text

# If the pass reached no tool at all, the MCP surface was absent — the shape of the
# twenty-two meta-vault firings that sealed `no-op` with nothing behind them. Rather
# than end the night with nothing, route the half of the pass that needs no model
# (ingest, check, status, debt) through the command line. The decision is the
# loop's, read off the vault's own trace; the pass is not asked and cannot opt in.
# Nothing is authored, every write verb is refused, and the run is stamped so the
# seal below reports `degraded` — never `no-op` — however much this step prints.
# Not under `set -e`: a verb that fails exits 1 here, and the check phase below is
# still the gate.
set +e
node "$CLI" loop fallback --vault .
set -e

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
