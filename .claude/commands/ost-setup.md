---
description: Set up an Opportunity Solution Tree in this folder — the first-run front door
allowed-tools: mcp__ost-agent__ost_next_work, Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs init:*), Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs set-outcome:*)
---

Set this directory up as an OST vault, or report that it already is one.

> **This file is generated** from `src/knowledge/ruleset.ts` (`OST_RULESET.firstRun`) by `scripts/gen-skill.ts`. Do not edit it by hand — change the ruleset and run `npm run gen:skill`. The `opportunity-solution-tree` skill renders the same rules, so the menu entry and the skill branch cannot teach different things.

## 1. Find out where you are

Call `ost_next_work` first. It answers one of three ways:

- **`bootstrap: true`, `reason: "no-vault"`** — nothing here yet. Go to step 2.
- **`bootstrap: true`, `reason: "no-outcome"`** — a vault with no root. Go to step 3.
- **no `bootstrap` field** — this folder is **already** a working vault. Say so, report the outcome it serves and the node counts, and point the human at `/ost-status` for what is outstanding and `/ost-pass` for a maintenance sweep. **Do not re-initialise, and do not touch the existing Outcome.** Stop here.

## 2. No vault — ask one question, then create it

Ask the human, and wait for their answer:

> **What outcome do you want this tree to serve?** One sentence, in your own words.

Read their sentence back to them for confirmation, verbatim. Then run:

```
node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs init <folder> --outcome "<their words>"
```

## 3. A vault with no root Outcome

Ask the same question, confirm the same way, then run:

```
node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs set-outcome "<their words>" --vault <dir>
```

## 4. Confirm

Call `ost_next_work` again and report what it says. A fresh tree holding only an Outcome is legitimately `done` — the next thing it needs is evidence, not ideation. Tell the human where to drop notes (the inbox path in `ost.config.yaml`) — `/ost-map` and `/ost-pass` both capture the inbox themselves before mapping, so nothing else needs to be run to get a dropped note onto the tree.

## The rules this command is bound by

- A session can be connected to these tools before any vault exists — that is the normal first minute, not a malfunction. `ost_next_work` reports it as `bootstrap: true` with a `reason` and a `nextStep`; treat that as the state of the world and follow the branch below instead of reporting a broken tool.
- When `reason` is `no-vault`: ask the human what outcome they want this tree to serve, in one sentence, and wait for their answer. Then run their words back to them for confirmation and set up the vault with `node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs init <folder> --outcome "<their words>"`.
- When `reason` is `no-outcome`: the vault exists but its root is missing; ask the human for the outcome and use `node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs set-outcome "<their words>" --vault <dir>`.
- Never invent, paraphrase into something sharper, or guess the outcome — it is the single human-set mandate the whole tree hangs from, and inventing it would make every node below it ladder up to a goal nobody chose.
- If the human is not available to answer, stop and say what you are waiting for. Do not scaffold a vault around a placeholder outcome to make progress.
- Setting up a vault needs no model and no API key, and neither does anything else here — `status`, `check`, `debt`, `lanes`, `result`, and every tool on this surface are deterministic. This project calls no model at all: the server holds none, and the connected session supplies every bit of the reasoning.
- Once the vault is set up, call `ost_next_work` again and continue into the normal maintenance loop; a fresh tree with only an Outcome is legitimately `done`, and the next thing it needs is evidence, not ideation.
- `/ost-setup` is the front door onto this same branch, named in the slash-command menu so that someone who has just installed the plugin can find it without already knowing to ask for discovery work. Reporting first run is not the same as being findable: if a human seems to be starting from nothing, say `/ost-setup` out loud rather than waiting to be asked.
