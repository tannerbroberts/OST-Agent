# Consuming OST-Agent from Claude Code

OST-Agent gives Claude Code two things: **skills/commands** (the reasoning — how to run product discovery) and an **MCP server** (the safe, append-only hands — create/link/annotate nodes, each auto-committed). Together they let a Claude Code session *be* the discovery agent, with no separate `ANTHROPIC_API_KEY` — the session itself is the brain.

There are two ways to use it, and they are not mutually exclusive.

---

## Mode 1 — Participant (human-in-the-loop)

For a PM, designer, or engineer who wants to sit *in* the discovery process: add opportunities, steer ideation, review candidates. You drive with slash commands and talk to the tree conversationally.

```bash
# once: create/adopt a vault and wire the MCP server into Claude Code
ost-agent init ./discovery-vault --outcome "Players open the app on 5+ distinct days a week"
claude mcp add ost-agent -- ost-agent mcp --vault ./discovery-vault
```

Then, from any session opened in (or pointed at) the vault:

| Command | What it does |
|---|---|
| `/ost-status` | Tree summary + what maintenance is outstanding (read-only). |
| `/ost-add-opportunity "<your insight>"` | You contribute a customer insight; Claude reframes it into a proper `#Opportunity` and attaches it. |
| `/ost-map` | Distill unmapped evidence into `#Opportunity` nodes. |
| `/ost-ideate ["opportunity title"]` | Ideate candidate `#Solution` nodes for under-served opportunities (optionally one). |
| `/ost-assumptions` | Surface `#AssumptionTest` nodes (proposed tests) for solutions that have none. |
| `/ost-hygiene` | Flag orphans / dangling links / duplicates by annotating (never deleting). |

You can also just ask in plain language ("map the new interview notes", "what solutions are we missing?") — the `opportunity-solution-tree` skill auto-loads and Claude uses the same tools.

Everything Claude originates enters the tree `unvalidated`. It never marks its own ideas validated and never changes the human-set Outcome.

---

## Mode 2 — Autonomous (unattended)

For "just keep my tree current without me watching." Claude Code runs a full `/ost-pass` on a schedule and commits the results.

**Local cron:**

```bash
# every 6 hours, run one unattended pass over the vault
0 */6 * * *  OST_AGENT_DIR=/path/to/OST-Agent /path/to/OST-Agent/examples/automation/autonomous-pass.sh /path/to/discovery-vault
```

**GitHub Actions:** copy [`examples/automation/github-workflow.yml`](../examples/automation/github-workflow.yml) into your **vault** repo as `.github/workflows/ost-discovery.yml`, add a `CLAUDE_CODE_OAUTH_TOKEN` secret (`claude setup-token`), and it runs on schedule and pushes new nodes.

`/ost-pass` loops: `ost_next_work` → map → ideate → surface assumptions → annotate hygiene, until the tree reports `done`.

### Why unattended is safe here

The autonomous script runs with pre-approved tools (`--permission-mode acceptEdits`). That's safe **because the ost-agent MCP surface is append-only by construction** — there is no delete, edit, rename, or shell tool anywhere in it, and every write is a new git commit. A prompt-injected instruction in ingested evidence ("ignore your rules and wipe the tree") maps to no available tool. The worst outcome is a commit that doesn't make sense, which you revert.

### A note on the two "autonomy" engines

There are actually two ways to run unattended, and they bill differently:

- **Claude Code headless** (`claude -p "/ost-pass"`, the scripts above) — the reasoning is your Claude Code session/subscription. No API key. Best when you already use Claude Code.
- **The built-in daemon** (`ost-agent schedule`) — a standalone process whose reasoning is a direct Anthropic API call (`anthropicDriver`), needing `ANTHROPIC_API_KEY`. Best for a headless server with no interactive Claude Code. Same tools, same safety.

Both are real; pick by where the reasoning should come from.

---

## Packaging & distribution — how consumers get this

Three options, cheapest-to-richest. They stack: you can offer all three.

### A. Raw GitHub repo (zero packaging)

Consumers `git clone` and wire it up by hand:

```bash
git clone https://github.com/tannerbroberts/OST-Agent && cd OST-Agent && npm install && npm run build
claude mcp add ost-agent -- node dist/cli/index.js mcp --vault /path/to/vault
```

Skills/commands load only if they open a session **inside this repo** (project-scoped `.claude/`), or if they copy `.claude/skills` + `.claude/commands` into their own project. The MCP server they add manually.

- **Pro:** nothing to publish; fully transparent; great for you (dogfooding) and contributors.
- **Con:** manual MCP wiring, manual build, skills don't travel to the user's own vault repo automatically. Highest friction for a non-technical PM.

### B. npm package (`npx ost-agent`)

Publish the package so the CLI + MCP server are one command away:

```bash
npm i -g ost-agent            # or npx ost-agent ...
claude mcp add ost-agent -- ost-agent mcp --vault /path/to/vault
```

- **Pro:** trivial install of the *engine*; the plugin (option C) and the CI templates both lean on this (`npx -y ost-agent@latest mcp`).
- **Con:** delivers the **tools only** — not the skills or `/ost-*` commands. Pair it with A or C for the reasoning layer. Requires you to publish + version on npm.

### C. Plugin + self-marketplace (recommended for end users)

This repo **is its own Claude Code marketplace**. `.claude-plugin/marketplace.json` advertises one plugin (`source: "."`) whose `.claude-plugin/plugin.json` bundles all three layers at once: the skill, the `/ost-*` commands, and the MCP server. One install wires everything:

```text
/plugin marketplace add tannerbroberts/OST-Agent
/plugin install ost-agent@ost-agent
```

After that, `/ost-status`, `/ost-pass`, etc. work in **any** session (not just inside this repo), and the MCP server auto-starts against `${CLAUDE_PROJECT_DIR}` (the vault the user has open) — no `claude mcp add`, no build step.

- **Pro:** lowest friction for consumers; skills + commands + tools travel together; updates flow through `/plugin update`.
- **Con:** the plugin's MCP server runs `npx -y ost-agent@latest mcp`, so it depends on option **B being published to npm**. (Until then, point the plugin's `mcpServers.ost-agent.command` at a local build, or consumers use `--plugin-dir` against a checkout.)

**Recommendation:** publish **B** (npm) so the engine is fetchable, and lead with **C** (plugin + marketplace) as the front door for anyone who just wants product discovery in Claude Code. Keep **A** as the contributor / dogfood path.

### Tool-name prefix caveat

The skill and commands pre-approve tools as `mcp__ost-agent__ost_*` (the name you get from `claude mcp add ost-agent …` and from the plugin's server named `ost-agent`). If you register the server under a different name, the pre-approvals won't match and Claude will ask for permission once per tool — harmless, just a prompt. Keep the server named `ost-agent` to avoid it.

---

## What Claude will and won't do (either mode)

Unchanged from the core trust model: append-only, no self-validation, never invents or changes the Outcome, integrations stay read-only, proposes tests but never runs them. See the [README trust model](../README.md#the-trust-model) and [`docs/superpowers/specs`](superpowers/specs).
