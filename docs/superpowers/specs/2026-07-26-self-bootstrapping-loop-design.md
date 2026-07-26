# Self-Bootstrapping Loop — Design

**Date:** 2026-07-26
**Status:** Approved by Tanner (brainstorming session, 2026-07-26)

## Problem

OST-Agent's autonomous loops (ideation via OST passes + building the surfaced work) each carry their own hand-written prompt. Improvements to the loop structure don't reach loops that are already running — the exact version-skew disease named by the standing continuous-update priority. The loop structure should be a shipped, versioned artifact of the product itself, so that updates to the best-known loop structure automatically take over every running loop.

## Model

One **engineer** robot (the loop on `~/ost-agent-meta`, the OST-Agent-for-OST-Agent vault) is the only thing that evolves the loop structure. Every other loop is a same-model **consumer** that optimizes its own product's metric and doesn't care about OST-Agent internals. The engineer collects telemetry on the whole fleet — including itself — trusting **only deterministic health signals** (exit codes, test counts, check results), never LLM self-report.

## Architecture

Five parts, one distribution spine:

1. **Outer bootstrap prompt** — lives in each scheduled loop (cloud routine, cron, any harness). Three lines, never edited again:

   > Run `npx -y ost-agent@latest loop --vault <vault-repo-or-path>`. Follow the instructions it prints exactly, then stop. If the command itself fails, report the error and stop.

2. **`ost-agent loop` CLI command** — prints the loop prompt, parameterized per vault: it resolves the vault, reads `ost.config.yaml`, and emits instructions for that vault (product repo path, role, last run's health verdict). Consumer vaults get consumer phases; the vault flagged `role: engineer` (only `ost-agent-meta`) also gets the evolution phase.

3. **`LOOP_RULESET.md`** — the loop prompt document, sibling to `OST_RULESET.md`, versioned in the repo, shipped in the npm package. Package version = loop-structure version; every health record stamps which version ran.

4. **Deterministic health system** — CLI-stamped records in the vault at `.ost-agent/health/runs.jsonl`. Written by the CLI from exit codes; the LLM never writes health records.

5. **Auto-adopt with opt-out** — the bootstrap's `@latest` is the takeover mechanism. Pinning lives in `ost.config.yaml` (`loop: {pin: "0.5.2"}`), which swaps `@latest` for the pinned version.

**Data flow:** routine fires → bootstrap fetches current loop prompt → LLM executes phases, invoking CLI commands that stamp health as side effects → vault and product repo pushed → the engineer's firing additionally reads fleet health, amends `LOOP_RULESET.md` as a normal feature, and publishes → every robot's next firing runs the new structure.

## Loop phase structure (`LOOP_RULESET.md` v1)

Design principles: **one work item per firing**; **the tree is the only source of what to build** (ideation happens in the OST pass, selection via `ost_next_work`, no freelancing); **every phase ends with a CLI command whose exit code is the truth**.

- **Phase 0 — Preflight.** `git pull` vault and product repo. Verify CLI version matches the prompt's stamped version. Read last run's health record. Gates: if the last run ended unhealthy, this firing's only job is restoring health. If the backlog is dry (`ost_next_work` done, no new evidence), seal a `no-op` record and exit cleanly — churn prevention is structural.
- **Phase 1 — Sense.** Harvest evidence accumulated since last firing (transcript harvester, friction records, inbox) and map it into the tree.
- **Phase 2 — Decide.** Ask `ost_next_work`. Whatever the tree surfaces is this firing's work item. The loop never picks; the tree picks.
- **Phase 3 — Build.** Implement the one item, test-driven, tests green, commit and push. Record the outcome with `ost-agent result` (test counts and exit codes, not prose).
- **Phase 4 — OST pass.** Full maintenance pass (map, ideate, assumptions, hygiene) so the next firing has a current backlog. Ideation happens here — after building, feeding the next cycle.
- **Phase 5 — Seal.** `ost-agent loop seal` stamps the run's health record from tracked exit codes and pushes the vault. Runs even when earlier phases failed.
- **Phase 6 — Fleet review (engineer only).** Read health records across reachable vaults. Deterministic evidence enters the meta tree; the engineer only amends `LOOP_RULESET.md` when its own Phase 2 surfaces that as the work item. Publishing is that firing's Phase 3. The engineer obeys the same loop it ships.

## Deterministic health system

**Storage.** Append-only `.ost-agent/health/runs.jsonl` per vault, one line per firing.

**Record.** `run_id`, timestamps, loop version (= npm version), CLI version, product-repo commit before/after, per-phase entries (command, exit code, duration), test counts, `ost-agent check` result, work item node id, computed verdict: `healthy | unhealthy | no-op | crashed`.

**Self-report designed out:**

1. **Bracketed runs.** `ost-agent loop start` writes a run-in-progress marker; CLI commands during the run append their own exit records; `ost-agent loop seal` computes the verdict from recorded exit codes. There is no `--verdict` flag.
2. **Crash visibility.** If the process dies mid-run, the marker outlives it; the next Preflight records that run as `crashed`.
3. **Omission is visible.** Skipped phases show as missing entries and seal computes `unhealthy`. Not running the health system is itself a health signal.

**Prerequisite fix.** The known "failed pass exits 0" bug is fixed first, as its own tree-surfaced work item — every gate here trusts exit codes.

**Fleet aggregation.** The engineer pulls every reachable vault (today: `ost-agent-meta`, `tetrix-ost`) and folds `runs.jsonl` files into per-loop-version stats: healthy rate, crash rate, no-op rate, median duration. "Did version N+1 beat version N" is computable. When strangers later opt in to reporting, their records use the same format and aggregation doesn't change.

## Evolution rails (engineer)

- **Changes enter as evidence, ship as features.** Fleet health and friction map into the meta tree; a loop-structure change happens only when the meta tree's `ost_next_work` surfaces it.
- **Prompt tests.** A ruleset linter (required phase sections, version stamp, no placeholders) and snapshot tests that `ost-agent loop` renders correctly for both roles and pinned configs.
- **Canary = the engineer.** Two npm dist-tags. Consumers resolve `@latest`; the engineer's vault sets `loop.channel: next` and resolves `@next`. Loop changes publish under `next` only. Promotion to `latest` (`npm dist-tag add`) is gated on K consecutive healthy engineer runs on that version in `runs.jsonl` (K=2 to start). Trusting its own records is fine — they're CLI-stamped exit codes, not self-report.
- **One change in flight.** While an unpromoted version sits on `next`, no new loop-structure work item may be picked.
- **Rollback.** Move `latest` back to the prior version; consumers revert on their next firing. Vaults can additionally pin as a manual brake.

A bad loop prompt can waste at most the engineer's own firings; consumers only run structures that survived the canary gate.

## Error handling

- **Bootstrap failure:** npx errors → report and stop (outer prompt handles it).
- **Mid-run death:** crash marker → next Preflight records `crashed` and restores health.
- **Git push races:** every push is pull-rebase-push; an unresolvable conflict records the phase as failed and leaves work on a branch rather than forcing main.
- **Publish blocked** (cloud npm-auth gap): the publish phase records `unhealthy`, the release commit stays behind, the promotion gate simply can't fire until a publish succeeds. Nothing wedges.

## Testing

- **Unit:** seal's verdict computation (phase records → verdict), crash-marker detection, ruleset linter, render snapshots for both roles.
- **Integration:** scripted run against a temp vault asserting `runs.jsonl` output, including a deliberately failed phase and a simulated crash.
- **End-to-end:** drive the *published* package through a full loop firing on a fresh vault and check the health record (the pattern that proved the consumption thesis).

## Rollout

Three manual edits, then self-carrying:

1. Replace the existing cloud routine with two routines using the 3-line bootstrap: the engineer (meta vault, channel `next`) and Tetrix (consumer, `@latest`) fire on separate schedules.
2. Add the `loop:` config block to both vaults.
3. Set `role: engineer` on `~/ost-agent-meta`.

The first shipped `LOOP_RULESET.md` is the phase structure above. Its first tree-surfaced work items are already known: fix failed-pass-exits-0, then the health system itself.

## Out of scope (YAGNI)

- No opt-in phone-home endpoint yet — telemetry is local-first; your vaults reach the engineer via their git remotes.
- No per-vault loop customization (`LOOP_RULESET` forks) — single-engineer authority is the point.
- No monetization-related anything, per the free-distribution strategy.
