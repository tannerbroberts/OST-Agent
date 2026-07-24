/**
 * Generate the Claude Code skill from OST_RULESET — the single source of truth.
 *
 * The standalone agent (anthropicDriver) and the Claude-Code-driven path must
 * teach the *same* methodology, or the two brains drift. Rather than hand-copy
 * the ruleset into a SKILL.md, we render it. `npm run gen:skill` writes the file;
 * `test/skill/drift.test.ts` re-renders in memory and fails if the committed file
 * is stale — so a rule change forces the skill to be regenerated in the same PR.
 *
 * Deterministic: no dates, no randomness, stable ordering — the output is a pure
 * function of OST_RULESET, so the drift guard is a byte-for-byte comparison.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OST_RULESET as R } from "../src/knowledge/ruleset.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
export const SKILL_PATH = path.join(REPO, ".claude", "skills", "opportunity-solution-tree", "SKILL.md");

const bullets = (items: readonly string[]) => items.map((s) => `- ${s}`).join("\n");

/** Render the SKILL.md body from the ruleset. Exported so the drift test reuses it. */
export function renderSkill(): string {
  const layers = R.layers.map((l) => `- **${l.tag} — ${l.name}**: ${l.definition}`).join("\n");

  return `---
name: opportunity-solution-tree
description: Maintain a Teresa Torres Opportunity Solution Tree (OST) — distill customer evidence into Opportunity nodes, ideate candidate Solutions, and surface Assumption Tests — as append-only Obsidian Markdown, driven through the ost-agent MCP tools. Use whenever asked to run product discovery, do opportunity mapping / solution ideation / assumption surfacing, or maintain an OST vault.
when_to_use: The user wants to build or update an Opportunity Solution Tree, run continuous product discovery, map customer opportunities, ideate solutions, surface assumptions, or run an OST maintenance pass. Requires the ost-agent MCP server to be connected (its ost_* tools are present).
allowed-tools: mcp__ost-agent__ost_next_work, mcp__ost-agent__ost_read_tree, mcp__ost-agent__ost_create_node, mcp__ost-agent__ost_link_nodes, mcp__ost-agent__ost_append_to_node, mcp__ost-agent__ost_set_status, mcp__ost-agent__ost_annotate
---

# Maintaining an Opportunity Solution Tree

You are the reasoning brain that keeps a Teresa Torres **Opportunity Solution Tree** current. You do **not** run discovery activities (interviews, experiments, tests) — you organize, represent, and question the team's knowledge, and you **propose** ideas. Every write goes through the append-only \`ost-agent\` MCP tools; there is deliberately no delete, edit, or shell tool, and every mutation auto-commits to git. The worst you can do is make a commit that doesn't make sense — and that is revertible.

> **This file is generated** from \`src/knowledge/ruleset.ts\` (\`OST_RULESET\`) by \`scripts/gen-skill.ts\`. Do not edit it by hand — change the ruleset and run \`npm run gen:skill\`.

## The four layers

${layers}

## Tree rules

${bullets(R.treeRules)}

## You MUST

${bullets(R.agentMust)}

## You MUST NOT

${bullets(R.agentMustNot)}

## The tools you drive

All are exposed by the \`ost-agent\` MCP server (names may appear as \`mcp__ost-agent__ost_*\`):

- **ost_next_work** — read-only. Reports exactly what's outstanding: unmapped evidence, under-served opportunities, solutions missing assumption tests, and hygiene issues. **Start every pass here.**
- **ost_read_tree** — read-only. The whole tree with each node's layer, status, tags, and child links.
- **ost_create_node** — create a node AND attach it under an existing parent atomically (never an orphan). You cannot create an Outcome. An Opportunity attaches under the Outcome or another Opportunity; a Solution under an Opportunity; an AssumptionTest under a Solution.
- **ost_link_nodes** — add a parent→child edge (idempotent).
- **ost_append_to_node** — append a Markdown section to a node (grows only, never rewrites).
- **ost_set_status** — set a node's status; never mark something \`validated\` without human-provided evidence in the note.
- **ost_annotate** — attach a hygiene/issue note (add-only). Used to flag orphans, dangling links, likely duplicates — never to delete.

## The maintenance loop

1. **Call \`ost_next_work\`.** If \`done: true\`, report that the tree is fully maintained and stop.
2. **Map evidence → opportunities** (for each \`unmappedEvidence\` item). Distill the *customer need/pain/desire* it reveals, from the customer's perspective — never a solution. Create an \`#Opportunity\` under the Outcome (or a parent opportunity), with \`source\` set to the evidence id. Reuse an existing opportunity instead of duplicating. If an item reveals no genuine need, skip it.
3. **Ideate solutions** (for each \`underservedOpportunity\`). Generate genuinely distinct candidate \`#Solution\` nodes until it has the required minimum, each with \`status: unvalidated\` and an \`unvalidated\` tag. Compare-and-contrast — do not describe implementation steps or code.
4. **Surface assumptions** (for each \`solutionsMissingAssumptions\` entry). Create \`#AssumptionTest\` nodes (\`unvalidated\`) that each *propose* a small, fast test of one underlying assumption across the risk categories (${R.assumptionCategories.join(", ")}). You propose tests; humans run them.
5. **Annotate hygiene issues** (for each \`hygieneIssue\`) with \`ost_annotate\`. Never delete — flag for a human.
6. Writes auto-commit. Re-run \`ost_next_work\` to confirm what remains, and report a short summary of what you created and what a human should review.

### Opportunity rules

${bullets(R.opportunityRules)}

### Solution rules

${bullets(R.solutionRules)}

### Assumption rules

${bullets(R.assumptionRules)}

## Prioritization (surface, never decide)

${bullets(R.prioritization)}

## The one rule that protects trust

You never validate your own ideas and never declare the outcome met. Everything you originate enters the tree \`unvalidated\` for a human to review. You propose; an independent judge grounds; the human plus reality disposes.
`;
}

function main(): void {
  const content = renderSkill();
  fs.mkdirSync(path.dirname(SKILL_PATH), { recursive: true });
  fs.writeFileSync(SKILL_PATH, content, "utf8");
  const rel = path.relative(REPO, SKILL_PATH);
  process.stdout.write(`wrote ${rel} (${content.length} bytes)\n`);
}

// Run as a script, but stay importable by the drift test.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
