#!/usr/bin/env bash
#
# Run one unattended BUILD pass against a vault: read the tree, find the solutions the
# tree's own gate permits, build one, and report.
#
# This is the counterpart to autonomous-pass.sh and the inverse of it in every way that
# matters. The discovery pass may write the tree and may not touch the world; this pass
# may write the world and may not touch the tree. Neither inversion is decoration:
#
#   - autonomous-pass.sh grants the nine append-only `ost_*` write tools and denies
#     Bash/Edit/Write, so a discovery pass cannot build.
#   - this script grants Bash/Edit/Write against the CODE repo and denies every `ost_*`
#     tool that writes, so a build pass cannot quietly re-frame the opportunity it failed
#     to build. A builder that can edit its own spec is not being held to it.
#
# **The permits are the whole point, and there are two of them.**
#
#   - `ost-agent gate <solution>` exits non-zero unless a solution has an assumption test
#     with a recorded result, and recording a result is human-only by construction
#     (`ost-agent result`) — the agent has no argument that expresses it. This is the
#     "worth building" permit and nothing here weakens it.
#   - `ost-agent buildable <solution>` clears when a test beneath it names an INSTRUMENT —
#     one spec-file command — that has been observed FAILING against this repository. This
#     is the "defined well enough to build" permit. It is not a judgement and does not
#     pretend to be one: an exit code was watched, and that is all it claims.
#
# So this script still cannot talk itself into building something nobody defined. What it
# can now do is build something a discovery pass defined precisely enough to be wrong
# about — which is the state the product's own vault was stuck outside of, at 243
# solutions, 243 prose tests, and zero build candidates for the loop's whole life.
#
# The red-before-green rule is what keeps the second permit honest: an instrument that
# passes on its first run is refused rather than recorded, so a test that could never fail
# cannot become a permit. The agent stakes a falsifiable prediction; the repository answers
# it. A solution that clears only this permit has been *specified*, not *validated*, and
# the prompt below is required to say so in its report.
#
# A consequence worth stating because it is the reason this is affordable to run hourly:
# **the buildability decision is mechanical and costs no model call.** The preflight below
# is grep plus the CLI's own gate. Claude is invoked only when the gate has already let
# something through, so a tree with nothing tested is scanned for pennies rather than
# reasoned about for dollars.
#
# Usage:
#   OST_AGENT_DIR=/path/to/OST-Agent  examples/automation/build-pass.sh  /path/to/vault
#
# The vault is READ. The repo at $OST_AGENT_DIR is what gets built and committed.
#
# Environment:
#   OST_BUILD_CADENCE_SECONDS  minimum gap between firings (default 3600)
#   OST_BUILD_STATE            where the cadence stamp and lock live (default
#                              ~/.local/state/ost-build-loop). MUST be outside the vault:
#                              the discovery loop's `loop start` refuses a dirty tree, so
#                              build-loop state written inside the vault would wedge
#                              discovery after the first firing.
#   OST_BUILD_REPORT           file this pass writes its one-paragraph report to
#   OST_BUILD_LOCK_TTL_MINUTES a lock older than this is treated as a dead firing (60)
set -uo pipefail

VAULT_DIR="${1:-.}"
OST_AGENT_DIR="${OST_AGENT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CLI="$OST_AGENT_DIR/dist/ost-agent.mjs"

STATE="${OST_BUILD_STATE:-$HOME/.local/state/ost-build-loop}"
CADENCE="${OST_BUILD_CADENCE_SECONDS:-3600}"
LOCK_TTL_MINUTES="${OST_BUILD_LOCK_TTL_MINUTES:-60}"
REPORT="${OST_BUILD_REPORT:-$STATE/last-report.txt}"

mkdir -p "$STATE"
VAULT_DIR="$(cd "$VAULT_DIR" && pwd)"

# The report file is the pass's only channel to the operator. Write it on every exit path
# — a firing that decided not to fire is still something the operator asked to hear about,
# and a silent no-op is indistinguishable from a loop that has died.
report() { printf '%s\n' "$1" >"$REPORT"; }

# ---------------------------------------------------------------------------
# Cadence gate.
#
# Deliberately NOT `ost-agent loop due`. That machinery is per-vault and single-tenant:
# one lock, one cadence stamp, one spend window, all keyed to the vault directory. Two
# loops sharing it would each see the other's firing as their own and each would consume
# the other's window. This loop keeps its own stamp, outside the vault, and leaves the
# vault's loop state entirely to the discovery pass that owns it.
# ---------------------------------------------------------------------------
NOW="$(date +%s)"
STAMP="$STATE/last-fired"
if [ -f "$STAMP" ]; then
  LAST="$(cat "$STAMP" 2>/dev/null || echo 0)"
  case "$LAST" in ''|*[!0-9]*) LAST=0 ;; esac
  ELAPSED=$(( NOW - LAST ))
  if [ "$ELAPSED" -lt "$CADENCE" ]; then
    # Not due. Exit 0 and write no report: this is a tick, not a firing, and notifying
    # here would put a banner on screen every time the timer merely ticked.
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# Overlap lock. `mkdir` is the atomic primitive available in POSIX sh — test-then-create
# on a file is a race this loop would lose roughly once a day.
# ---------------------------------------------------------------------------
LOCK="$STATE/lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +"$LOCK_TTL_MINUTES" 2>/dev/null)" ]; then
    echo "build-pass: breaking a lock older than ${LOCK_TTL_MINUTES}m — prior firing assumed dead" >&2
    rm -rf "$LOCK" && mkdir "$LOCK" 2>/dev/null || { echo "build-pass: could not take lock" >&2; exit 15; }
  else
    # A live firing is still running. Normal for a timer that ticks faster than a build
    # takes; not an error and not worth a notification.
    exit 0
  fi
fi
echo "$$" >"$LOCK/pid" 2>/dev/null || true
trap 'rm -rf "$LOCK"' EXIT

cd "$VAULT_DIR" || { report "Build loop could not enter the vault at $VAULT_DIR. Nothing ran."; exit 1; }

# ---------------------------------------------------------------------------
# Preflight: which solutions does the tree's own gate permit? No model call.
#
# `## Results` on an AssumptionTest is the marker `hasRecordedResult` reads to clear
# `gateSolution` (src/ost/headings.ts). It is refused at the MCP boundary, so no agent
# can author one — which is exactly why it is trustworthy as a build permit. The grep
# below only narrows the candidate set; `ost-agent gate` is what actually decides, so
# this script never re-implements the rule it is enforcing.
# ---------------------------------------------------------------------------
CANDIDATES="$STATE/candidates.txt"
: >"$CANDIDATES"

while IFS= read -r test_file; do
  [ -n "$test_file" ] || continue
  grep -q '^type: AssumptionTest' "$test_file" 2>/dev/null || continue
  test_title="$(basename "$test_file" .md)"
  # Which Solution links to this test? The parent links to the child by wikilink.
  while IFS= read -r sol_file; do
    [ -n "$sol_file" ] || continue
    grep -q '^type: Solution' "$sol_file" 2>/dev/null || continue
    basename "$sol_file" .md >>"$CANDIDATES"
  done < <(grep -Fl "[[$test_title]]" -- *.md 2>/dev/null)
done < <(grep -l '^## Results' -- *.md 2>/dev/null)

BUILDABLE="$STATE/buildable.txt"
: >"$BUILDABLE"
if [ -s "$CANDIDATES" ]; then
  while IFS= read -r sol; do
    [ -n "$sol" ] || continue
    if node "$CLI" gate "$sol" --vault . >/dev/null 2>&1; then
      printf '%s\n' "$sol" >>"$BUILDABLE"
    fi
  done < <(sort -u "$CANDIDATES")
fi

# ---------------------------------------------------------------------------
# The second permit, and the reason this loop stopped starving.
#
# `gate` above asks whether a solution is WORTH building — a human's recorded
# result, and still human-only. `buildable` asks whether it is DEFINED: does some
# test beneath it name a command that has been observed failing against this very
# repository? A red instrument is a build permit and a definition of done in one
# object, which is what makes it safe to act on without a person in the loop —
# nobody's judgement is being simulated, only an exit code that was watched.
#
# Both permits are honoured and neither is weakened. A solution cleared by either
# is a solution somebody can start on; the prompt below is told which permit it
# arrived under, because they mean different things and license different work.
#
# `verify` is run HERE, in the deterministic preflight, and never by the model.
# The model in this pass cannot write the tree — that inversion is load-bearing
# (see the header) — and an observation the model could author would be a build
# it authorized itself.
# ---------------------------------------------------------------------------
INSTRUMENTED="$STATE/instrumented.txt"
: >"$INSTRUMENTED"
node "$CLI" buildable --vault . 2>/dev/null | grep -v '^  ' >"$INSTRUMENTED" || true

if [ -s "$INSTRUMENTED" ]; then
  while IFS= read -r sol; do
    [ -n "$sol" ] || continue
    grep -Fxq "$sol" "$BUILDABLE" 2>/dev/null || printf '%s\n' "$sol" >>"$BUILDABLE"
  done <"$INSTRUMENTED"
fi

NODE_COUNT="$(node "$CLI" check --vault . 2>&1 | grep -oE '[0-9]+ node' | grep -oE '[0-9]+' | head -1)"
NODE_COUNT="${NODE_COUNT:-unknown}"
BUILD_COUNT="$(wc -l <"$BUILDABLE" | tr -d ' ')"

# Record the firing now, not at the end. A pass that crashes has still consumed its
# window; retrying a crashing build every tick is how a loop turns a bug into a bill.
echo "$NOW" >"$STAMP"

if [ "$BUILD_COUNT" -eq 0 ]; then
  # The expected steady state on an untested tree. Say what would change it, in the
  # operator's terms, rather than reporting an empty result and leaving them to infer why.
  UNTESTED="$(node "$CLI" debt --vault . 2>&1 | grep -oE 'Solutions: [0-9]+' | grep -oE '[0-9]+' | head -1)"
  UNTESTED="${UNTESTED:-0}"
  report "Build loop ran and built nothing. The tree holds ${UNTESTED} solutions across ${NODE_COUNT} nodes, and none cleared either permit: no assumption test carries a human-recorded result (ost-agent gate), and none names an instrument that has been observed failing against this repository (ost-agent buildable). The second one is the one a discovery pass can clear on its own — a test whose 'instrument:' names a spec that fails today becomes a build permit the moment 'ost-agent verify' watches it fail. Run 'ost-agent buildable' to see what is defined, and 'ost-agent lanes' to see which human-run tests are cheapest in minutes."
  exit 0
fi

# ---------------------------------------------------------------------------
# Something is buildable. Only now is a model call worth making.
# ---------------------------------------------------------------------------
TARGET="$(head -1 "$BUILDABLE")"

MCP_CONFIG="$(mktemp "${TMPDIR:-/tmp}/ost-build-mcp.XXXXXX")"
trap 'rm -f "$MCP_CONFIG"; rm -rf "$LOCK"' EXIT

cat >"$MCP_CONFIG" <<JSON
{"mcpServers":{"ost-agent":{"command":"node","args":["$CLI","mcp","--vault","$VAULT_DIR"]}}}
JSON

# Read-only OST tools only. Every tool that writes the tree is absent from this grant AND
# named in the denial below, because deny beats allow in Claude Code and the two lists
# disagreeing is how a surface silently widens. A builder that can call ost_append_to_node
# can rewrite the requirement it is being measured against.
OST_READ_TOOLS="mcp__ost-agent__ost_read_tree,mcp__ost-agent__ost_next_work,mcp__ost-agent__ost_status,mcp__ost-agent__ost_debt,mcp__ost-agent__ost_check,mcp__ost-agent__ost_gate"
BUILD_TOOLS="Bash,Read,Edit,Write,Glob,Grep"
ALLOWED="$OST_READ_TOOLS,$BUILD_TOOLS"

# Task is denied on purpose and not as boilerplate. A delegated agent arrives with its own
# tool surface, which this allowlist does not constrain — and the observed failure was a
# review subagent merging the pull request containing the hole it had been asked to review.
DENIED="mcp__ost-agent__ost_annotate,mcp__ost-agent__ost_append_to_node,mcp__ost-agent__ost_create_node,mcp__ost-agent__ost_flag_humans_required,mcp__ost-agent__ost_ingest_inbox,mcp__ost-agent__ost_link_nodes,mcp__ost-agent__ost_rank_source,mcp__ost-agent__ost_set_evidence,mcp__ost-agent__ost_set_status,NotebookEdit,SlashCommand,Task"

BUILD_PROMPT="$(cat <<PROMPT
You are the build half of an OST loop. The discovery half maintains the tree; you do not
touch it. Your job is to build ONE solution the tree has already cleared for building, in
the code repository, and to report what you found doing it.

Vault (READ ONLY, for reference): $VAULT_DIR
Code repository (where you work): $OST_AGENT_DIR
Solution cleared by the gate: "$TARGET"

Work in the code repository. cwd is the vault, so cd to the repo first.

1. Read the solution node "$TARGET" in the vault and the assumption test beneath it. It
   cleared one of two permits and you must find out which, because they license different
   work. Run 'node $CLI buildable "$TARGET" --vault $VAULT_DIR' and read what it says.
   - If a test carries a RECORDED RESULT, that is a human's finding about the world and is
     the reason this is worth building. Read what it actually says — it may narrow the
     build considerably or contradict the solution's original framing.
   - If a test carries a RED INSTRUMENT, that command is your definition of done. It fails
     against this repository today and must pass when you are finished. Do not edit the
     test to make it pass; make the behaviour it names real. If the instrument turns out to
     be testing the wrong thing, STOP and say so in your report — a spec bent to fit the
     code it was supposed to judge is the one outcome this loop cannot survive.
   A red instrument says the work is defined, never that it was worth doing. If that is the
   only permit this target holds, say so in your report.
2. Build it, following the repository's CLAUDE.md and CONTRIBUTING.md. Branch off main;
   never commit to main directly.
3. Run the gates before pushing: 'npx tsc --noEmit' must exit 0 and 'npx vitest run' must
   be green. If you changed anything under src/, run 'npm run bundle' and commit
   dist/ost-agent.mjs. If you changed src/knowledge/ruleset.ts, run 'npm run gen:skill'
   and commit the regenerated SKILL.md.
4. Push, open a PR describing the problem, what changed, and what you verified. Then wait
   for CI with 'gh pr checks --watch' bounded by a timeout — do NOT sit in a sleep-poll
   loop. If CI goes green, merge to main and delete the branch. If CI is not green within
   the timeout, or is red, LEAVE THE PR OPEN and say so in your report.
5. If a gate fails and you cannot fix it honestly, stop and report the failure with its
   output. Do not work around a red gate.

You may NOT write to the vault. You have no tool that can, and you should not try — if
the build teaches you something the tree should know, put it in your report and the
operator will decide whether it becomes a node.

FINALLY, and this is required: write a report of at most 90 words to $REPORT, as one
plain-text paragraph with no markdown. Say what you built, whether it merged, and any
finding that came out of the build process — especially anything that contradicts what
the node claimed, anything the recorded result did not cover, or anything that made the
build harder than the node implied. Findings are the point of this loop; a report that
only says "built it" has wasted the pass. Use the Write tool for that file.
PROMPT
)"

report "Build loop started on \"$TARGET\" but did not finish — the pass was interrupted before it could report. Check the log."

claude -p "$BUILD_PROMPT" \
  --mcp-config "$MCP_CONFIG" \
  --strict-mcp-config \
  --allowedTools "$ALLOWED" \
  --disallowedTools "$DENIED" \
  --output-format text
CLAUDE_EXIT=$?

if [ "$CLAUDE_EXIT" -ne 0 ]; then
  report "Build loop failed while building \"$TARGET\": claude exited $CLAUDE_EXIT. Nothing was merged. The tree was not modified. Check the log for what it got through before it died."
  exit "$CLAUDE_EXIT"
fi

# The vault must be clean when this exits. A build pass that dirties the vault wedges the
# discovery loop, whose `loop start` refuses a dirty tree — one loop silently killing the
# other is the failure this whole split was designed to avoid.
if [ -n "$(git -C "$VAULT_DIR" status --porcelain 2>/dev/null | grep -v '^.. \.ost-agent/usage/')" ]; then
  echo "build-pass: WARNING — the vault is dirty after a build pass. Discovery will refuse to fire until this is resolved." >&2
fi

exit 0
