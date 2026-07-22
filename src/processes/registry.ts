/**
 * The six discovery processes (P0–P5) and the registry that names them.
 *
 * Deterministic processes (bootstrap, ingest, hygiene) act directly through the
 * append-only Vault. Knowledge processes (mapping, ideation, assumptions) build a
 * ruleset-grounded prompt and delegate to the PassDriver, which holds only that
 * process's allowlisted OST tools. Commit-on-exit is the runner's job, so no
 * process needs the git tools.
 */
import { OST_RULESET } from "../knowledge/ruleset.js";
import type { PassDriver, ToolSet } from "../runner/driver.js";
import { loadCursor, saveCursor } from "../adapters/source.js";
import {
  byTitle,
  childrenOfLayer,
  getMapped,
  readEvidence,
  setMapped,
  writeEvidence,
} from "./tree.js";
import { emptyResult, type PassContext, type ProcessDef, type ProcessResult } from "./types.js";

function countTool(calls: { name: string }[], name: string): number {
  return calls.filter((c) => c.name === name).length;
}

/** Shared system-prompt preamble, grounded in the verified ruleset. */
function baseSystem(): string {
  const r = OST_RULESET;
  return [
    "You maintain a Teresa Torres Opportunity Solution Tree. You do not run discovery activities — you only keep the knowledge tree current using the tools provided.",
    "",
    "Layers:",
    ...r.layers.map((l) => `- ${l.tag} (${l.name}): ${l.definition}`),
    "",
    "You MUST:",
    ...r.agentMust.map((s) => `- ${s}`),
    "",
    "You MUST NOT:",
    ...r.agentMustNot.map((s) => `- ${s}`),
    "",
    "All writes are append-only and go through the provided tools. There is no delete or edit tool — that is intentional. Ideated solutions and assumptions are always created with status 'unvalidated' and an 'unvalidated' tag.",
  ].join("\n");
}

function minSolutions(ctx: PassContext): number {
  return ctx.config.processes["P3_ideate"]?.minSolutionsPerOpportunity ?? 3;
}

// ─── P0: Bootstrap ────────────────────────────────────────────────────────────
export const p0Bootstrap: ProcessDef = {
  id: "P0_bootstrap",
  title: "Bootstrap",
  allowedTools: [],
  async isDone(ctx) {
    return ctx.vault.has(ctx.config.outcome);
  },
  async run(ctx): Promise<ProcessResult> {
    const res = emptyResult();
    if (!ctx.vault.has(ctx.config.outcome)) {
      ctx.vault.createNode({
        title: ctx.config.outcome,
        layer: "Outcome",
        status: "validated",
        source: "config:outcome",
        created: new Date().toISOString().slice(0, 10),
        tags: [],
        links: [],
        body: "The single desired product outcome that scopes this discovery effort. Human-set; the agent never changes it.",
      });
      res.created++;
      res.notes.push(`created Outcome "${ctx.config.outcome}"`);
    }
    return res;
  },
};

// ─── P1: Ingest ─────────────────────────────────────────────────────────────
export const p1Ingest: ProcessDef = {
  id: "P1_ingest",
  title: "Ingest",
  allowedTools: [],
  async isDone(ctx) {
    for (const source of ctx.sources) {
      const { items } = await source.fetchSince(loadCursor(ctx.dir, source.name));
      if (items.length > 0) return false;
    }
    return true;
  },
  async run(ctx): Promise<ProcessResult> {
    const res = emptyResult();
    for (const source of ctx.sources) {
      const cursor = loadCursor(ctx.dir, source.name);
      const { items, cursor: next } = await source.fetchSince(cursor);
      for (const item of items) {
        if (writeEvidence(ctx.dir, item)) res.evidence++;
      }
      saveCursor(ctx.dir, source.name, next);
      if (items.length) res.notes.push(`${source.name}: +${items.length} evidence`);
    }
    return res;
  },
};

// ─── P2: Opportunity mapping ───────────────────────────────────────────────────
export const p2Map: ProcessDef = {
  id: "P2_map",
  title: "Opportunity mapping",
  allowedTools: ["ost_read_tree", "ost_create_node", "ost_link_nodes"],
  async isDone(ctx) {
    const mapped = getMapped(ctx.dir);
    return readEvidence(ctx.dir).every((e) => mapped.has(e.id));
  },
  async run(ctx, driver, tools): Promise<ProcessResult> {
    const res = emptyResult();
    const mapped = getMapped(ctx.dir);
    const fresh = readEvidence(ctx.dir).filter((e) => !mapped.has(e.id));
    if (fresh.length === 0) return res;

    const opps = ctx.vault.readTree().filter((n) => n.layer === "Opportunity").map((n) => n.title);
    const prompt = [
      `Target outcome: "${ctx.config.outcome}".`,
      OST_RULESET.opportunityRules.length ? `Opportunity rules:\n- ${OST_RULESET.opportunityRules.join("\n- ")}` : "",
      "",
      `Existing opportunities (link to one of these instead of duplicating when a new item matches):\n${opps.length ? opps.map((t) => `- ${t}`).join("\n") : "(none yet)"}`,
      "",
      "New evidence to distill into customer opportunities (needs/pains/desires — never solutions):",
      ...fresh.map((e) => `\n### ${e.source}\n${e.body}`),
      "",
      `For each distinct customer need in the evidence, create an #Opportunity node (if not already present) with parent set to the outcome "${ctx.config.outcome}" and source set to the evidence id — creation attaches it to the tree automatically. If an item reveals no genuine opportunity, skip it. Do not invent needs the evidence does not support.`,
    ].join("\n");

    const out = await driver.run({
      label: this.id,
      system: baseSystem(),
      prompt,
      tools,
      maxIterations: ctx.config.processes[this.id]?.limits.maxIterations ?? 30,
      timeoutSec: ctx.config.processes[this.id]?.limits.timeoutSec ?? 300,
      model: ctx.config.model,
    });

    // Every fresh item has now been considered — record it as mapped.
    for (const e of fresh) mapped.add(e.id);
    setMapped(ctx.dir, mapped);

    res.toolCalls = out.toolCalls;
    res.created = countTool(out.toolCalls, "ost_create_node");
    res.linked = countTool(out.toolCalls, "ost_link_nodes");
    res.notes.push(`mapped ${fresh.length} evidence item(s)`);
    return res;
  },
};

// ─── P3: Solution ideation ─────────────────────────────────────────────────────
export const p3Ideate: ProcessDef = {
  id: "P3_ideate",
  title: "Solution ideation",
  allowedTools: ["ost_read_tree", "ost_create_node", "ost_link_nodes"],
  async isDone(ctx) {
    const tree = ctx.vault.readTree();
    const index = byTitle(tree);
    const min = minSolutions(ctx);
    return tree
      .filter((n) => n.layer === "Opportunity")
      .every((o) => childrenOfLayer(o, index, "Solution").length >= min);
  },
  async run(ctx, driver, tools): Promise<ProcessResult> {
    const res = emptyResult();
    const tree = ctx.vault.readTree();
    const index = byTitle(tree);
    const min = minSolutions(ctx);
    const underserved = tree
      .filter((n) => n.layer === "Opportunity")
      .filter((o) => childrenOfLayer(o, index, "Solution").length < min);
    if (underserved.length === 0) return res;

    const prompt = [
      OST_RULESET.solutionRules.length ? `Solution rules:\n- ${OST_RULESET.solutionRules.join("\n- ")}` : "",
      "",
      `These opportunities have fewer than ${min} candidate solutions. For each, ideate NEW solutions (compare-and-contrast — generate genuinely distinct approaches) until it has at least ${min}. Create each as a #Solution node with parent set to its opportunity, status 'unvalidated', and an 'unvalidated' tag — creation attaches it under the opportunity automatically. Never mark a solution validated and never describe implementation steps or code.`,
      "",
      ...underserved.map(
        (o) => `\n### Opportunity: ${o.title}\nExisting solutions: ${childrenOfLayer(o, index, "Solution").join(", ") || "(none)"}`,
      ),
    ].join("\n");

    const out = await driver.run({
      label: this.id,
      system: baseSystem(),
      prompt,
      tools,
      maxIterations: ctx.config.processes[this.id]?.limits.maxIterations ?? 30,
      timeoutSec: ctx.config.processes[this.id]?.limits.timeoutSec ?? 300,
      model: ctx.config.model,
    });

    res.toolCalls = out.toolCalls;
    res.created = countTool(out.toolCalls, "ost_create_node");
    res.linked = countTool(out.toolCalls, "ost_link_nodes");
    res.notes.push(`ideated for ${underserved.length} opportunity(ies)`);
    return res;
  },
};

// ─── P4: Assumption surfacing ──────────────────────────────────────────────────
export const p4Assumptions: ProcessDef = {
  id: "P4_assumptions",
  title: "Assumption surfacing",
  allowedTools: ["ost_read_tree", "ost_create_node", "ost_link_nodes"],
  async isDone(ctx) {
    const tree = ctx.vault.readTree();
    const index = byTitle(tree);
    return tree
      .filter((n) => n.layer === "Solution")
      .every((s) => childrenOfLayer(s, index, "AssumptionTest").length >= 1);
  },
  async run(ctx, driver, tools): Promise<ProcessResult> {
    const res = emptyResult();
    const tree = ctx.vault.readTree();
    const index = byTitle(tree);
    const bare = tree
      .filter((n) => n.layer === "Solution")
      .filter((s) => childrenOfLayer(s, index, "AssumptionTest").length === 0);
    if (bare.length === 0) return res;

    const cats = OST_RULESET.assumptionCategories.join(", ");
    const prompt = [
      `Assumption risk categories: ${cats}.`,
      OST_RULESET.assumptionRules.length ? `Assumption rules:\n- ${OST_RULESET.assumptionRules.join("\n- ")}` : "",
      "",
      `For each solution below, surface the key assumptions that must hold for it to work (across the risk categories) and create #AssumptionTest nodes with parent set to their solution (status 'unvalidated', 'unvalidated' tag) that each PROPOSE a small test — creation attaches each under its solution automatically. You propose tests — you never run them.`,
      "",
      ...bare.map((s) => `\n### Solution: ${s.title}`),
    ].join("\n");

    const out = await driver.run({
      label: this.id,
      system: baseSystem(),
      prompt,
      tools,
      maxIterations: ctx.config.processes[this.id]?.limits.maxIterations ?? 30,
      timeoutSec: ctx.config.processes[this.id]?.limits.timeoutSec ?? 300,
      model: ctx.config.model,
    });

    res.toolCalls = out.toolCalls;
    res.created = countTool(out.toolCalls, "ost_create_node");
    res.linked = countTool(out.toolCalls, "ost_link_nodes");
    res.notes.push(`surfaced assumptions for ${bare.length} solution(s)`);
    return res;
  },
};

// ─── P5: Tree hygiene ──────────────────────────────────────────────────────────
interface Issue {
  title: string;
  issue: string;
}
function detectIssues(ctx: PassContext): Issue[] {
  const tree = ctx.vault.readTree();
  const index = byTitle(tree);
  const issues: Issue[] = [];
  // locate the outcome by layer, not by config title, so punctuation can't misclassify orphans
  const outcomeLinks = new Set(tree.find((n) => n.layer === "Outcome")?.links ?? []);

  for (const n of tree) {
    // dangling links
    for (const link of n.links) {
      if (!index.has(link)) issues.push({ title: n.title, issue: `dangling link: [[${link}]] has no node` });
    }
    if (n.layer === "Opportunity" && !outcomeLinks.has(n.title)) {
      issues.push({ title: n.title, issue: "orphan opportunity: not linked under the outcome" });
    }
    if (n.layer === "Solution") {
      const parents = tree.filter((p) => p.layer === "Opportunity" && p.links.includes(n.title));
      if (parents.length === 0) issues.push({ title: n.title, issue: "orphan solution: not linked under any opportunity" });
    }
  }
  return issues;
}

export const p5Hygiene: ProcessDef = {
  id: "P5_hygiene",
  title: "Tree hygiene",
  allowedTools: [],
  async isDone(ctx) {
    return detectIssues(ctx).every(({ title, issue }) => {
      const node = ctx.vault.has(title) ? ctx.vault.read(title) : null;
      return node ? node.body.includes(issue) : true;
    });
  },
  async run(ctx): Promise<ProcessResult> {
    const res = emptyResult();
    for (const { title, issue } of detectIssues(ctx)) {
      if (!ctx.vault.has(title)) continue;
      if (ctx.vault.read(title).body.includes(issue)) continue; // idempotent
      ctx.vault.annotate(title, issue);
      res.annotated++;
      res.notes.push(`annotated "${title}": ${issue}`);
    }
    return res;
  },
};

export const PROCESSES: ProcessDef[] = [p0Bootstrap, p1Ingest, p2Map, p3Ideate, p4Assumptions, p5Hygiene];

export function getProcess(id: string): ProcessDef | undefined {
  return PROCESSES.find((p) => p.id === id);
}
