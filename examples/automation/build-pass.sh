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
#
# The lineage prefix: the Outcome→…→solution path, arrow-separated, at the very
# head of the report. Empty until a target is chosen, and that is the design
# rather than an initialisation detail — most firings build nothing, and a
# root-only prefix on twenty reports out of twenty-one teaches the operator to
# skip the first line. An arrow prefix therefore MEANS "this pass touched a
# specific node", which is a fact worth a line only because it is not always
# there. Naming the next candidate instead was the other option and is the same
# defect this loop has already shipped once: a node in the report that the pass
# never touched.
LINEAGE=""

report() {
  if [ -n "$LINEAGE" ]; then
    printf '%s\n\n%s\n' "$LINEAGE" "$1" >"$REPORT"
  else
    printf '%s\n' "$1" >"$REPORT"
  fi
}

# Put the lineage back on a report the MODEL wrote. `report()` cannot do it: the
# prompt tells the model to Write the file itself, which replaces whatever was
# there. Idempotent by inspection — a second call finds the prefix already
# present and leaves it — because the postflight below rewrites the report on one
# branch and would otherwise double it.
prefix_lineage() {
  [ -n "$LINEAGE" ] || return 0
  [ -s "$REPORT" ] || return 0
  case "$(head -1 "$REPORT")" in "$LINEAGE") return 0 ;; esac
  printf '%s\n\n%s\n' "$LINEAGE" "$(cat "$REPORT")" >"$REPORT"
}

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
# **This loop runs the instruments itself, and that is the step that makes the
# whole thing autonomous.** Discovery writes a test naming a command; somebody has
# to run it before anyone knows whether it fails. That somebody is this block: it
# is mechanical, it needs no judgement, and it costs no model call. Leaving it to
# a person would have put a human back in the middle of the one path that was
# supposed to no longer need one — the loop would report "nothing is verified"
# forever and ask the operator to go do it, which is exactly the notification
# this rewrite exists to stop sending.
#
# Two containment rules, both deliberate:
#
#   1. **Never the model.** `verify` runs here in the preflight and again in the
#      postflight, both outside the `claude` invocation. The model is told not to
#      run it. An observation the model could author at will is a build it
#      authorized itself, and the reserved-heading guard that stops the MCP
#      surface writing one is worth nothing if the shell hands it over anyway.
#   2. **Capped per firing, and the cap is announced.** Each verify spawns the
#      repo's test runner, so an uncapped sweep over a few hundred instrumented
#      tests would turn an hourly loop into a permanent one. What was skipped is
#      named in the report rather than silently dropped.
# ---------------------------------------------------------------------------
VERIFY_CAP="${OST_BUILD_VERIFY_CAP:-8}"
PENDING="$STATE/pending-verification.txt"
node "$CLI" buildable --pending --vault . 2>/dev/null >"$PENDING" || : >"$PENDING"
PENDING_COUNT="$(wc -l <"$PENDING" | tr -d ' ')"
VERIFIED=0
NEWLY_RED=0

if [ "$PENDING_COUNT" -gt 0 ]; then
  while IFS= read -r test_title; do
    [ -n "$test_title" ] || continue
    [ "$VERIFIED" -lt "$VERIFY_CAP" ] || break
    VERIFIED=$(( VERIFIED + 1 ))
    # A verify that refuses (green on its first run — a test that could never
    # fail) is information, not an error: it means discovery wrote a test that
    # measures nothing, and the tree keeps no observation for it. Logged and
    # stepped over, because one bad test must not stop the firing.
    if VERIFY_OUT="$(node "$CLI" verify "$test_title" --repo "$OST_AGENT_DIR" --vault . 2>&1)"; then
      case "$VERIFY_OUT" in
        *"**red**"*) NEWLY_RED=$(( NEWLY_RED + 1 )) ;;
      esac
      # Staged one file at a time, by the exact name this loop just wrote. The
      # discovery loop may be mid-firing in the same vault — the two hold
      # separate locks and neither waits on the other — so a blanket `add -A`,
      # or even `add -- '*.md'`, would commit a stranger's in-flight work under
      # this loop's message. Naming the file keeps the commit to what this pass
      # actually did.
      git -C "$VAULT_DIR" add -- "${test_title}.md" >/dev/null 2>&1 || true
    else
      echo "build-pass: verify declined \"$test_title\": $VERIFY_OUT" >&2
    fi
  done <"$PENDING"

  # The observations are tree writes, and the vault must be clean when this exits
  # or the discovery loop's `loop start` refuses its next firing.
  if [ -n "$(git -C "$VAULT_DIR" diff --cached --name-only 2>/dev/null)" ]; then
    git -C "$VAULT_DIR" -c user.name="ost-build-loop" -c user.email="build@localhost" \
      commit -q -m "chore(instruments): record ${VERIFIED} observation(s) from the build loop" >/dev/null 2>&1 || true
  fi
fi

INSTRUMENTED="$STATE/instrumented.txt"
: >"$INSTRUMENTED"
# stdout only, and stdout is titles only (`src/cli/index.ts`). Every line is then
# put back through `buildable <title>` before it is believed. That second check
# is not redundant: a list this script mis-parses becomes the TARGET string the
# model is told it may build, and the observed failure was exactly that — the
# advisory sentence "nothing is buildable…" was read as a solution title and
# handed to a build pass, which is a permit invented by a `grep`. A title that
# does not survive its own permit check is a parse error, not a build candidate.
node "$CLI" buildable --vault . 2>/dev/null >"$INSTRUMENTED" || true

if [ -s "$INSTRUMENTED" ]; then
  while IFS= read -r sol; do
    [ -n "$sol" ] || continue
    node "$CLI" buildable "$sol" --vault . >/dev/null 2>&1 || {
      echo "build-pass: ignoring unparseable candidate: $sol" >&2
      continue
    }
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
  # ------------------------------------------------------------------------
  # Nothing to build. What this says — and what it deliberately does NOT say.
  #
  # This report used to end by telling the operator to go run an assumption test
  # and file a result. That was wrong in two ways and it went out hourly. It
  # asked a person to do tree work from a loop that is not allowed to touch the
  # tree, and it named the one unblock that needs a human while the loop was
  # sitting on a path that needs nobody — a test with an instrument becomes a
  # build permit the moment something runs it, and the block above now does.
  #
  # So the rule for this branch: report the BUILD loop's state, name whichever
  # machine is going to change it, and ask the operator for nothing. A human's
  # recorded result is still the stronger permit and still worth having, but it
  # is discovery's business to surface that, not a build loop's, and an hourly
  # banner asking for it is how an operator learns to ignore this channel.
  # ------------------------------------------------------------------------
  # `unknown` rather than 0 when the read fails, and the branches below test for
  # it. Defaulting a failed measurement to zero is how a loop ends up reporting
  # "everything currently defined has been built" on the strength of a grep that
  # matched nothing — a confident sentence with no observation behind it, which
  # is the failure this whole codebase is about.
  UNINSTRUMENTED="$(node "$CLI" debt --vault . 2>/dev/null | grep -oE '[0-9]+ with tests that are prose only' | grep -oE '^[0-9]+' | head -1)"
  UNINSTRUMENTED="${UNINSTRUMENTED:-unknown}"

  if [ "$VERIFIED" -gt 0 ]; then
    SKIPPED=$(( PENDING_COUNT - VERIFIED ))
    CAP_NOTE=""
    [ "$SKIPPED" -gt 0 ] && CAP_NOTE=" ${SKIPPED} more are queued for the next firing (cap ${VERIFY_CAP} per pass)."
    report "Build loop ran ${VERIFIED} instrument(s) and built nothing this pass. None of them came back red against a solution that still needs building, so there was no definition of done to work to.${CAP_NOTE} Nothing is required of you: discovery keeps writing tests and this loop keeps running them, and the first one that fails becomes a build on the next firing."
  elif [ "$UNINSTRUMENTED" = "unknown" ]; then
    report "Build loop ran and built nothing, and could not read how much of the tree is still prose only — 'ost-agent debt' did not report a count. Nothing was verified and nothing was built. This is a loop problem rather than a tree problem, so it is worth a look at the log; no tree work is being asked of you."
  elif [ "$UNINSTRUMENTED" -gt 0 ]; then
    # ----------------------------------------------------------------------
    # This branch used to end "The discovery loop is working through exactly
    # that queue ... No action needed", hourly, and it was never checked against
    # anything. It went out for 21 hours while discovery had not fired once,
    # parked over its spend ceiling. A reassurance nobody measured is worse than
    # no reassurance: it spends the operator's trust in this channel to hide the
    # one fact they needed.
    #
    # So the claim is now made only when it is true, and `ost-agent loop health`
    # is what makes it checkable. That is a READ-ONLY reporter, deliberately not
    # `loop due` — `due` answers "may I fire?", which is the discovery loop's
    # question, single-tenant, and not this loop's to ask.
    # ----------------------------------------------------------------------
    HEALTH="$(node "$CLI" loop health --vault . 2>/dev/null)"
    BLOCKED="$(printf '%s\n' "$HEALTH" | grep '^blocked:' | sed 's/^blocked: //')"
    LAST_MIN="$(printf '%s\n' "$HEALTH" | grep -oE '\(([0-9]+) minute' | grep -oE '[0-9]+' | head -1)"
    STALLED="$(printf '%s\n' "$HEALTH" | grep '^stalled:' | sed 's/^stalled: //')"
    # Three missed firings at discovery's hourly cadence. Long enough not to fire
    # on an ordinary gap, short enough that a dead loop is named the same day.
    QUIET_AFTER_MIN=180

    QUEUE="${UNINSTRUMENTED} solution(s) across ${NODE_COUNT} nodes still have tests that are prose only — no command to run, so nothing that can fail."

    if [ -n "$BLOCKED" ]; then
      report "Build loop ran and built nothing, because nothing is defined yet. ${QUEUE} The discovery loop that would fix that is NOT running: ${BLOCKED}. Nothing will reach this loop until discovery fires again, so the queue will not move on its own."
    elif [ -n "$LAST_MIN" ] && [ "$LAST_MIN" -gt "$QUIET_AFTER_MIN" ]; then
      report "Build loop ran and built nothing, because nothing is defined yet. ${QUEUE} The discovery loop that would fix that has not fired in ${LAST_MIN} minutes, which is longer than its cadence — it is not currently working the queue, whatever is stopping it.${STALLED:+ Stall signal: ${STALLED}.} Worth a look at the discovery log."
    else
      report "Build loop ran and built nothing, because nothing is defined yet. ${QUEUE} The discovery loop is firing on schedule and working that queue, and this loop will pick each one up automatically once it has a runnable test. No action needed."
    fi
  else
    report "Build loop ran and built nothing. Nothing is pending verification and no solution is waiting on a definition of done, which on a tree of ${NODE_COUNT} nodes means everything currently defined has been built. New work reaches this loop when discovery writes the next test. No action needed."
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
# Something is buildable. Only now is a model call worth making.
# ---------------------------------------------------------------------------
TARGET="$(head -1 "$BUILDABLE")"

# Computed once, here, because every report from this point on is about this one
# solution — including the two the script writes itself (the interrupted-firing
# placeholder and the claude-failed one), which are exactly the reports an
# operator reads without any other context about what the pass was doing.
#
# `|| true` and an empty result are a working state, not an error: an unreachable
# node has no lineage, `lineage` exits 1 saying so, and the report goes out
# unprefixed rather than headed by a bare arrow.
LINEAGE="$(node "$CLI" lineage "$TARGET" --vault . 2>/dev/null || true)"

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
DENIED="mcp__ost-agent__ost_annotate,mcp__ost-agent__ost_append_to_node,mcp__ost-agent__ost_create_node,mcp__ost-agent__ost_detach_nodes,mcp__ost-agent__ost_edit_node,mcp__ost-agent__ost_flag_humans_required,mcp__ost-agent__ost_ingest_inbox,mcp__ost-agent__ost_link_nodes,mcp__ost-agent__ost_merge_nodes,mcp__ost-agent__ost_rank_source,mcp__ost-agent__ost_set_evidence,mcp__ost-agent__ost_set_instrument,mcp__ost-agent__ost_set_status,NotebookEdit,SlashCommand,Task"

# The prompt is written to a FILE and never through `BUILD_PROMPT="$(cat <<PROMPT …)"`,
# and the difference is not style. Inside command substitution, bash parses the heredoc
# body looking for quote pairs, so a single apostrophe in ordinary English — "a human's
# finding" — is an unterminated string that kills the whole script at parse time. That is
# not hypothetical: it happened here, and because a parse error takes the file before line
# one runs, the loop could not even write a report saying it had died. Every due firing
# exited 2 in silence while the last successful report sat on screen looking current.
#
# A plain redirect is not parsed that way, so prose can be prose.
PROMPT_FILE="$(mktemp "${TMPDIR:-/tmp}/ost-build-prompt.XXXXXX")"
cat >"$PROMPT_FILE" <<PROMPT
You are the build half of an OST loop. The discovery half maintains the tree; you do not
touch it. Your job is to build ONE solution the tree has already cleared for building, in
the code repository, and to report what you found doing it.

Vault (READ ONLY, for reference): $VAULT_DIR
Code repository (where you work): $OST_AGENT_DIR
Solution cleared by the gate: "$TARGET"

THE TREE AS IT STANDS (computed by \`ost-agent rollup\`, not written by anyone):

$(node "$CLI" rollup --vault . 2>/dev/null || printf '(the top-level view could not be computed this firing)')

That is the whole tree, one line per category, so you can see where the thing you are
about to build sits and how much of its neighbourhood is already standing. Every figure
is read off the nodes — an exit code something watched, a result a human recorded — so
none of it is anybody's opinion of the work, including yours.

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

Do NOT run 'ost-agent verify' yourself. The loop runs the instruments before and after
you, on purpose: an observation you can write at will is a build permit you granted
yourself. Your job is to make the red command pass by building the thing, not to record
what it did.

FINALLY, and this is required: write a report of at most 90 words to $REPORT, as one
plain-text paragraph with no markdown. Say what you built, whether it merged, and any
finding that came out of the build process — especially anything that contradicts what
the node claimed, anything the recorded result did not cover, or anything that made the
build harder than the node implied. Findings are the point of this loop; a report that
only says "built it" has wasted the pass. Use the Write tool for that file.
PROMPT

trap 'rm -f "$MCP_CONFIG" "$PROMPT_FILE"; rm -rf "$LOCK"' EXIT

report "Build loop started on \"$TARGET\" but did not finish — the pass was interrupted before it could report. Check the log."

claude -p "$(cat "$PROMPT_FILE")" \
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

# ---------------------------------------------------------------------------
# Postflight: did the instrument actually go green?
#
# The model reports what it believes it did. This records what the command
# actually does now, which is the only half of the claim that is checkable — and
# it closes the loop the red observation opened: red, build, green, all three
# observed by something with no stake in the answer.
#
# A build the model called finished whose instrument is still red is the most
# useful thing this loop can find, so it is reported rather than smoothed over.
# ---------------------------------------------------------------------------
TARGET_TEST="$(node "$CLI" buildable "$TARGET" --vault . 2>/dev/null | grep -oE '"[^"]+" is red' | head -1 | sed 's/" is red//; s/^"//')"
if [ -n "$TARGET_TEST" ]; then
  if VERIFY_OUT="$(node "$CLI" verify "$TARGET_TEST" --repo "$OST_AGENT_DIR" --vault . 2>&1)"; then
    case "$VERIFY_OUT" in
      *"**green**"*) BUILD_OBSERVED="green" ;;
      *) BUILD_OBSERVED="still red" ;;
    esac
  else
    BUILD_OBSERVED="unverifiable"
  fi
  # Same discipline as the preflight: name the one file, never sweep the vault.
  git -C "$VAULT_DIR" add -- "${TARGET_TEST}.md" >/dev/null 2>&1 || true
  if [ -n "$(git -C "$VAULT_DIR" diff --cached --name-only 2>/dev/null)" ]; then
    git -C "$VAULT_DIR" -c user.name="ost-build-loop" -c user.email="build@localhost" \
      commit -q -m "chore(instruments): record the post-build observation for ${TARGET_TEST}" >/dev/null 2>&1 || true
  fi
  if [ "$BUILD_OBSERVED" != "green" ]; then
    echo "build-pass: WARNING — after the build, \"$TARGET_TEST\" is ${BUILD_OBSERVED}." >&2
    # Appended rather than replacing: the model's own report is evidence too, and
    # a disagreement between what it said and what the command does is the finding.
    printf '%s\n' "$(cat "$REPORT" 2>/dev/null) [Loop check: the instrument for this solution is ${BUILD_OBSERVED} after the build, so the definition of done was not met regardless of what the report above says.]" >"$REPORT"
  fi
fi

# Last, after every branch that could have rewritten the report — the model's own
# Write, and the postflight's disagreement note above.
prefix_lineage

# The vault must be clean when this exits. A build pass that dirties the vault wedges the
# discovery loop, whose `loop start` refuses a dirty tree — one loop silently killing the
# other is the failure this whole split was designed to avoid.
if [ -n "$(git -C "$VAULT_DIR" status --porcelain 2>/dev/null | grep -v '^.. \.ost-agent/usage/')" ]; then
  echo "build-pass: WARNING — the vault is dirty after a build pass. Discovery will refuse to fire until this is resolved." >&2
fi

exit 0
