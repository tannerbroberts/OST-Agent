# Teresa Torres — Opportunity Solution Tree (reference for OST-Agent)

## Overview

The Opportunity Solution Tree (OST) is, in Teresa Torres's words, "a simple way of visually representing the paths you might take to reach a desired outcome." Introduced by Torres around 2016 and formalized in *Continuous Discovery Habits* (2021), it is a visual thinking-and-alignment aid that keeps a cross-functional product team outcome-focused while navigating the messy, iterative cycles of continuous discovery.

The tree makes a team's implicit assumptions explicit and draws a line from day-to-day work up to a broader business goal, so any solution being built can be traced back to a customer need and, ultimately, to the desired outcome. It is a thinking aid, not an enforcement mechanism: it *helps* keep work connected to outcomes and lets a team localize and revisit a decision when evidence invalidates a branch, but it does not by itself guarantee alignment or prevent disconnected work.

A team works one outcome (one tree) at a time.

## The four layers (with definitions)

The tree is rooted in a single desired outcome and branches downward through four layers, each mapping to its parent:

1. **Outcome** (`#Outcome`, root) — The desired outcome that scopes the entire discovery effort. Torres distinguishes three metric types: **business outcomes** (financial/lagging metrics such as revenue, market share, churn, only indirectly influenced by a team), **product outcomes** (a customer behavior in the product or a customer's sentiment about the product, directly within the team's control), and **traction metrics** (adoption of a single feature). Torres recommends a **product outcome** as the right scope for discovery, because it is a leading indicator of business value; the outcome is framed around business value while the opportunity space beneath it ensures that value is pursued in a customer-centric way. One outcome per tree.

2. **Opportunity space** (`#Opportunity`) — Opportunities are unmet customer needs, pain points, and desires that, if addressed, will drive the outcome. They are phrased from the customer's perspective as problems/wants, never as things to build. Opportunities form their own multi-level sub-tree: a broad opportunity decomposes into smaller, more specific child opportunities, so an opportunity node can be the parent of other opportunity nodes. The OST is therefore **not** four flat levels.

3. **Solution space** (`#Solution`) — A solution is "a product, a feature, a service, a workflow, a process, documentation, or anything else that we offer to customers to help address a known opportunity." Each solution attaches to the single target opportunity it addresses. Teams generate multiple candidate solutions per target opportunity for compare-and-contrast. Not every opportunity has a solution attached at a given time.

4. **Assumption tests** (`#AssumptionTest`) — The bottom layer: "how we'll evaluate which solutions will help us best create customer value in a way that drives business value." Each test attaches beneath the specific solution whose underlying assumption it probes.

## Structural rules

- Exactly one desired outcome sits at the root; multiple outcomes mean multiple trees.
- The tree flows strictly downward: Outcome → Opportunities (nested) → Solutions → Assumption Tests. Each element maps to its parent.
- **Parent–child** opportunity relationships represent **subsets** (a child is a smaller, more specific slice of its parent). **Sibling** relationships represent **distinct alternatives** at the same level.
- Place each node under its single best-fit parent. Torres treats the OST as an evolving, deliberately incomplete visualization and acknowledges an opportunity can plausibly relate to more than one parent; when that happens, prefer the single best parent (flag ambiguity for a human) rather than double-linking.
- Every solution must address at least one opportunity in the tree — no orphan solutions.
- Every assumption test must map to a specific solution.
- Sibling opportunities should be **distinct** from one another. (Torres emphasizes distinctness; she does *not* require siblings to be collectively exhaustive — the tree is expected to be incomplete and to evolve.)

## Opportunity rules

- An opportunity is "an unmet customer need, pain point, or desire," stated from the customer's perspective (often first-person, e.g. "I don't have time to cook") — never a solution or a feature.
- **Litmus test (verbatim Torres):** "Is there more than one way to address this opportunity?" If yes, it is a genuine opportunity; if only one implementation fits, it is a solution in disguise and belongs one layer down (or should be reframed upward into the underlying need). Torres's own example: "I don't have time to cook" is an opportunity (takeout, meal prep, faster recipes, restaurants); "order takeout" is one solution.
- Opportunities should be **sourced from story-based, past-behavior customer interviews**, not brainstormed internally. Torres: "When we generate opportunities off the top of our heads, we bring our own biases and half-truths into the picture."
- Torres derives top-level opportunities from an experience map of the customer journey's key moments, then nests sub-opportunities beneath the relevant parent.
- Common failure mode to flag: phrasing an opportunity as a solution ("add a filter") or as a business ask ("increase revenue").

## Solution rules (incl. compare-and-contrast)

- A solution is anything offered to the customer to address a known opportunity (product, feature, service, workflow, process, documentation, …). It branches off the one target opportunity it addresses.
- **Generate many, then narrow.** Once a single target opportunity is chosen, generate multiple competing solutions and whittle to a consideration set (Torres suggests comparing at least three). Rationale: "when we generate more ideas, we generate better ideas." Consider more than one especially when there is risk, when the opportunity is a differentiator, or when innovation is needed.
- **Compare and contrast, don't validate in isolation.** Evaluating a single idea forces a poor "whether or not" decision — "good" is hard to judge as an absolute (Torres's Usain Bolt analogy: speed is obvious only next to competitors). Comparing options makes "good" relative and judgeable; decision research shows compare-and-contrast yields better decisions.
- Target one opportunity at a time (a work-in-progress limit, kanban-like), going deep before moving on.

## Assumption testing (desirability / viability / feasibility / usability)

- Rather than testing a whole solution ("does this work?"), the team surfaces the underlying assumptions that must be true for a solution to succeed, and tests the riskiest ones with small, fast tests. Torres: "stop testing whole ideas and instead shift focus to testing the assumptions that need to be true for our ideas to work." Becoming cognizant of the implicit assumptions is the hard part.
- The four risk categories of assumptions are **desirability, viability, feasibility, and usability**. (Torres also urges teams to consider potential harm / ethical and unintended-consequence assumptions; this reference treats the four named categories as canonical and ethical/harm as an additional consideration rather than asserting a fixed count.)
- Assumption tests supply the comparative evidence used to choose among solutions ("experiment to help you choose amongst a set of good ideas"), not a yes/no verdict on one idea.
- Tests can range from lightweight experiments and simulations to prototypes; not every test requires direct customer contact, though generative and evaluative research ultimately depend on evidence from real people/data.

## Prioritization & opportunity sizing

- **Prioritize opportunities, not solutions.** The strategic decision is which customer need to target; choosing opportunities shapes competitive position more than the features shipped. Prioritizing a feature backlog directly (e.g. RICE-on-features) is a failure mode Torres argues against.
- **Prioritize row by row** down the tree: assess the top-level opportunities, pick the top branch, then ignore the other branches and drill into that branch's children.
- Torres assesses each opportunity across several qualitative dimensions:
  - **Opportunity sizing** — how many customers are impacted by it, and how often. (This is a qualitative pairing, not a multiplicative reach×frequency formula.)
  - **Customer factors** — how important it is to customers.
  - **Market factors** — how addressing it affects your position in the market.
  - **Company factors** — fit with company vision, mission, and strategic objectives.
- The unifying question is how much impact addressing each opportunity would have on the desired outcome.
- Torres **rejects quantified scoring formulas**: "these are messy, subjective decisions and that's okay." She frames them as reversible **two-way-door decisions** where speed beats false precision.

## The continuous-discovery cadence & tasks

Torres defines continuous discovery as, "at a minimum weekly touchpoints with customers by the team building the product, where they conduct small research activities" in pursuit of a desired outcome. The tree is a living artifact updated as those touchpoints and tests land.

The recurring cadence:

- Work **one outcome at a time**; keep the tree scoped to it.
- Conduct **weekly, story-based customer interviews** to source and refine opportunities from real unmet needs.
- Map and structure the opportunity space; **prioritize opportunities row by row** and select a **single target opportunity** at a time (a WIP limit).
- **Generate multiple solutions** for the target opportunity, then run **small, fast assumption tests** continuously instead of one big up-front validation.
- **Revisit and re-chart** the branch when evidence invalidates it — evolve the solution, pick a different opportunity, or reconsider the outcome — without discarding the rest of the mapped thinking.

(Note: dimension-specific research on rituals and meeting mechanics was unavailable/unverified for this reference; the cadence above is limited to claims confirmed across the structure, rules, and automation research.)

## What an automated maintainer may and must not do (with the "why")

**Framing:** Torres never wrote about autonomous agents maintaining an OST. The boundaries below are *derived* from her discovery principles — chiefly the **generative vs. evaluative** research distinction (interviewing generates opportunities; assumption testing evaluates solutions) and the requirement that evidence come from **real customer contact/data**. They are design principles for OST-Agent, not Torres's own prescriptions. The governing metaphor: the agent is a **cartographer/librarian** of the team's knowledge, never a **discoverer** of it. Only humans in real customer contact may **generate** or **validate** knowledge.

**A maintainer MAY:**
- Distill *candidate* opportunities from ingested artifacts, each carrying a provenance link and marked unvalidated. *Why:* opportunities must trace to real needs; the agent can organize evidence but cannot assert validity. (Tension to name explicitly: Torres privileges opportunities sourced from **story-based customer interviews**; distilling from support tickets, Slack, or Jira softens her interview-centric stance, so such nodes must stay candidate/unvalidated pending human confirmation.)
- Reframe solution-shaped or business-shaped inputs into need-shaped opportunities, or hold them for human review.
- Attach opportunities under the outcome and propose (not silently impose) opportunity-space structure. *Why:* tree hygiene is a maintainer's remit; re-architecting is a team sensemaking activity.
- Append multiple **unvalidated** candidate solutions under an opportunity. *Why:* Torres encourages volume of ideas for compare-and-contrast; listing ideas is not discovery.
- Surface a solution's underlying assumptions and **propose** (never run) assumption tests. *Why:* making the implicit explicit is a legitimate aid; executing tests is evaluative research.
- Flag tree-hygiene issues (staleness, orphan solutions, duplicates, mislabeled nodes, unbacked validity claims) for humans to resolve.

**A maintainer MUST NOT:**
- Run interviews, experiments, or assumption tests. *Why:* discovery requires real customer contact; synthetic results would corrupt the tree's credibility and reintroduce opinion-as-evidence.
- Write implementation code or build solutions. *Why:* solutions are candidates to be de-risked, not work orders; building before testing collapses the evaluative step. (Marked a derived design boundary, not an explicit Torres rule.)
- Invent or change the desired outcome. *Why:* the outcome is a strategic bet assigned by leadership and is an input to discovery, not an output; the agent may at most flag a mis-formed outcome as a question for humans.
- Delete or overwrite existing knowledge. *Why:* the tree is accumulating shared knowledge with an audit trail; deprioritized nodes may resurface. Append, annotate, mark-stale, or propose-for-archive instead. (Sound system design derived from the tree-as-living-knowledge idea, not a stated Torres rule.)
- Assert unvalidated ideas as validated/confirmed. *Why:* validation is a claim about evidence from real customers; the agent produces none, so everything it originates enters as a hypothesis awaiting human, evidence-based validation.
- Auto-select a target opportunity or a "winning" solution. *Why:* prioritization is a human team judgment in Torres's method.

When in doubt, the agent raises a flag or proposal for a human rather than acting.

## Obsidian graph-view representation

**On-disk model.** One `.md` file per node; the filename (minus `.md`) is the node's title. A parent→child relationship is a `[[Child Title]]` wikilink written in the **parent** note (outgoing link); the child sees the parent in its Backlinks pane. Filenames must be filesystem-safe (no `/ \ : * ?`) and unique across the vault.

**Layer coloring & tags.** The first body line carries the layer tag (`#Outcome`, `#Opportunity`, `#Solution`, `#AssumptionTest`). In Graph view → settings → Groups, bind one color per layer via a `tag:#…` query. Agent-ideated, not-yet-validated nodes carry a companion `#unvalidated` tag on the same line (`#Solution #unvalidated`); a separate group query in a warning color surfaces them. When a node matches multiple groups the first matching group wins the color, so order the `#unvalidated` group to taste.

**Direction.** Obsidian's built-in Graph view has a Display setting **"Arrows"** toggle that shows link direction natively — parent→child direction can be rendered without any community plugin.

**Frontmatter (machine-readable).** YAML holds `type`, `status`, `source`/provenance, `created`, and `confidence`. Frontmatter is the source of truth for state; inline tags drive coloring. The status vocabulary (`unvalidated → in-discovery → validated → shipped → deferred`) is a **vault/tooling convention, not Torres canon**.

**Append-only history.** Each note ends with a `## History` section of dated, append-only entries; existing lines are never edited or deleted. Corrections append a new entry and update frontmatter, leaving original provenance intact. Abandoned nodes are set `status: deferred` (or superseded via a wikilink), never deleted. Renames are done inside Obsidian so inbound wikilinks auto-update.

### Example note — OUTCOME
```
Filename: Increase weekly active playlist creators.md
---
type: outcome
status: in-discovery
source: Q3 product strategy — leadership OKR
created: 2026-07-22
confidence: high
---
#Outcome

Product outcome (a customer behavior in the product), not a business/output
metric. Baseline: 12% of WAU create a playlist; target 18% by Q4.

## Children (opportunities)
- [[Users struggle to find songs to add to a playlist]]
- [[Users are unsure when to start a new playlist vs. add to an existing one]]

## History
- 2026-07-22 — Created from Q3 OKR. One outcome per tree keeps discovery focused.
```

### Example note — OPPORTUNITY
```
Filename: Users struggle to find songs to add to a playlist.md
---
type: opportunity
status: validated
source: Customer interviews 2026-06 (8 of 12 participants)
created: 2026-06-30
confidence: high
---
#Opportunity

An unmet customer need / pain point from the customer's perspective — not a
solution. Passes Torres's test: there is more than one way to address it.
Representative quote: "I run out of songs to add and just give up."

Parent: [[Increase weekly active playlist creators]]

## Children (solutions)
- [[Auto-suggest songs based on playlist vibe]]
- [[Import songs from listening history]]

## History
- 2026-06-30 — Surfaced in interviews (8/12). Promoted from unvalidated to
  validated after the 4th corroborating interview.
```

### Example note — SOLUTION (agent-ideated, unvalidated)
```
Filename: Auto-suggest songs based on playlist vibe.md
---
type: solution
status: unvalidated
source: Agent-ideated — brainstorm 2026-07-22
created: 2026-07-22
confidence: low
---
#Solution #unvalidated

One of several solutions explored for its parent opportunity
(compare-and-contrast; not yet chosen).

Parent: [[Users struggle to find songs to add to a playlist]]

## Children (assumption tests)
- [[Test - users add at least one auto-suggested song per session]]

## History
- 2026-07-22 — Ideated by agent; not discussed with team or tested. Tagged #unvalidated.
```

### Example note — ASSUMPTION TEST
```
Filename: Test - users add at least one auto-suggested song per session.md
(no colon in filename — reserved character)
---
type: assumption_test
status: unvalidated
source: Agent-ideated — 2026-07-22
created: 2026-07-22
confidence: low
---
#AssumptionTest #unvalidated

Tests the single riskiest underlying assumption with the smallest possible test
— not a validation of the whole solution.
Assumption under test: users will add >=1 auto-suggested song per playlist session.
Assumption category: Desirability (of the four: desirability, viability,
feasibility, usability).
Proposed method: unmoderated prototype with a suggestion row; success threshold
pre-committed before running. (Proposed by agent; a human runs the test.)

Parent: [[Auto-suggest songs based on playlist vibe]]

## History
- 2026-07-22 — Drafted, not yet run.
```

## Sources

- Teresa Torres, *Continuous Discovery Habits: Discover Products that Create Customer Value and Business Value* (2021).
- Product Talk (producttalk.org), including:
  - https://www.producttalk.org/opportunity-solution-trees/
  - https://www.producttalk.org/glossary-discovery-opportunity-solution-tree/
  - https://www.producttalk.org/sourcing-opportunities/
  - https://www.producttalk.org/prioritize-opportunities/
  - https://www.producttalk.org/discovering-solutions/
  - https://www.producttalk.org/2022/03/discovering-solutions/
  - https://www.producttalk.org/compare-and-contrast-decisions/
  - https://www.producttalk.org/benefits-of-opportunity-solution-trees/
  - https://www.producttalk.org/customer-segments-teresas-take/
  - https://www.producttalk.org/continuous-discovery-habits/
  - https://learn.producttalk.org/assumption-testing

Obsidian rendering mechanics (file-per-node graph, tag-based group coloring, the Display "Arrows" toggle, backlinks) reflect established Obsidian product behavior and are not part of Torres's framework.
