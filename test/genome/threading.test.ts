/**
 * The genome is loaded ONCE per pass, at the assembly point, and threaded down.
 *
 * This file exists because the shortcut is already in the codebase to copy:
 * `ost_ingest_inbox` calls `loadConfig(dir)` inside its `run`, and `fileFriction`
 * does the same. A `loadGenome(dir)` written that way would let the policy a pass
 * is measured under change while the pass is running — which does not produce a
 * wrong number, it produces a fitness record that describes no genome at all.
 *
 * So these tests pin the load POINT, not only the loaded value: they mutate
 * genome.yaml after the context is built and insist that nothing notices. They
 * also pin the absence contract — `init` never scaffolds a genome, and a vault
 * without one runs on defaults that are today's behaviour written down.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY } from "../../src/config/schema.js";
import { defaultGenome, genomePath } from "../../src/genome/load.js";
import { buildPassContext } from "../../src/runner/context.js";
import { initVault } from "../../src/runner/init.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";

const OUTCOME = "Reach 10,000 daily active users";
const ROOT = "Retention";

interface Runnable {
  name: string;
  run: (input: unknown) => Promise<string>;
}

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-genome-thread-"));
  await initVault(dir, OUTCOME, ROOT);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function writeGenome(yaml: string): void {
  fs.writeFileSync(genomePath(dir), yaml, "utf8");
}

function toolsFrom(ctx: ToolContext): Runnable[] {
  return buildOstTools(ctx) as unknown as Runnable[];
}

/** Build a fresh context, find the tool, run it — the ordinary one-call path. */
async function call(name: string, input: unknown): Promise<string> {
  const tool = toolsFrom(buildPassContext(dir)).find((t) => t.name === name);
  if (!tool) throw new Error(`no such tool: ${name}`);
  return tool.run(input);
}

describe("the genome a pass runs on", () => {
  test("a vault with no genome.yaml runs on the default genome — absence IS the default", () => {
    expect(fs.existsSync(genomePath(dir))).toBe(false); // init NEVER scaffolds one
    const ctx = buildPassContext(dir);
    expect(ctx.genome).toEqual(defaultGenome());
    // The budget fork: a null shared pool means "use the operator's configured
    // number", so a vault never carries two lookup limits that can disagree.
    expect(ctx.genome.budgets.sharedPool).toBeNull();
  });

  test("a genome.yaml beside ost.config.yaml is what the pass runs on", () => {
    writeGenome("tokenWeights:\n  output: 9\nbudgets:\n  sharedPool: 4\n");
    const ctx = buildPassContext(dir);
    expect(ctx.genome.tokenWeights.output).toBe(9);
    expect(ctx.genome.budgets.sharedPool).toBe(4);
    // An untouched leaf keeps its default, and an untouched section materialises
    // whole — a partial genome is a genome, not a hole.
    expect(ctx.genome.tokenWeights.input).toBe(1);
    expect(ctx.genome.pivot.ranking).toBe("tree-order");
  });

  test("a misspelled allele throws from buildPassContext — a typo may NOT read as behaviour unchanged", () => {
    writeGenome("tokenWieghts:\n  output: 9\n");
    expect(() => buildPassContext(dir)).toThrow(/genome\.yaml/);
    expect(() => buildPassContext(dir)).toThrow(/tokenWieghts/);
  });

  test("a listing-only context takes the defaults without reading the file — a broken genome cannot take down the tool listing", () => {
    writeGenome("tokenWieghts: {}\n");
    const ctx = buildPassContext(dir, { listingOnly: true });
    expect(ctx.genome).toEqual(defaultGenome());
  });
});

describe("the genome reaches the tools, and never changes under them", () => {
  test("the object handed to buildOstTools carries the pass's genome", () => {
    writeGenome("budgets:\n  sharedPool: 4\n");
    const toolCtx: ToolContext = buildPassContext(dir);
    expect(toolCtx.genome?.budgets.sharedPool).toBe(4);
    expect(toolsFrom(toolCtx).map((t) => t.name)).toContain("ost_next_work");
  });

  test("a tool set built with NO genome still builds — an absent genome is the default one", () => {
    const ctx: ToolContext = { vault: buildPassContext(dir).vault, dir, remote: { enabled: false } };
    expect(ctx.genome).toBeUndefined();
    expect(toolsFrom(ctx).map((t) => t.name)).toContain("ost_read_tree");
  });

  test("the genome does NOT change mid-pass — the tools hold the one the pass began with", async () => {
    writeGenome("budgets:\n  sharedPool: 4\n");
    const ctx = buildPassContext(dir);
    const readTree = toolsFrom(ctx).find((t) => t.name === "ost_read_tree")!;

    // Replace the file with one that would THROW if anything re-read it.
    writeGenome("tokenWieghts:\n  output: 9\n");

    const out = await readTree.run({});
    expect(out).toContain(ROOT);
    expect(ctx.genome.budgets.sharedPool).toBe(4);
  });
});

describe("minSolutionsPerOpportunity has exactly one literal", () => {
  test("the schema default, the scaffolded config, and the tool-side fallback are the SAME constant", async () => {
    // 1. the schema default, reached through the config `init` scaffolded
    expect(buildPassContext(dir).config.processes["P3_ideate"].minSolutionsPerOpportunity).toBe(
      DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY,
    );

    // 2. the tool-side fallback. A PassContext carries no `minSolutionsPerOpportunity`
    // field at all, so building tools from one exercises the `??` branch directly.
    await call("ost_create_node", {
      title: "Exports are slow",
      layer: "Opportunity",
      parent: ROOT,
      body: "customers say the export takes minutes",
      evidence: "assertion",
    });
    const work = JSON.parse(await call("ost_next_work", {}));
    expect(work.underservedOpportunities[0].title).toBe("Exports are slow");
    expect(work.underservedOpportunities[0].needed).toBe(DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY);
  });
});
