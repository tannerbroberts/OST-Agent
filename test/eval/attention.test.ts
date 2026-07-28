import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { computeAttention, DEFAULT_TOKEN_WEIGHTS, weightedTokenCost } from "../../src/eval/attention.js";
import { defaultGenome, loadGenome } from "../../src/genome/load.js";
import type { ResolutionGene } from "../../src/genome/schema.js";
import type { OstNode } from "../../src/ost/node.js";
import { recordAttention } from "../../src/telemetry/attention.js";
import { usageLogPath } from "../../src/telemetry/usage.js";

const FULL = "## Format\na count\n\n## Methodology\nquery\n\n## Rationale\nserves [[O]]";

const unknown = (title: string, body = FULL, extra: Partial<OstNode> = {}): OstNode => ({
  title, layer: "Unknown", tags: [], links: [], body, evidence: "assertion", ...extra,
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ost-rollup-"));

describe("weightedTokenCost", () => {
  test("prices a cached read far below fresh input", () => {
    const cached = weightedTokenCost({ input: 0, output: 0, cacheCreate: 0, cacheRead: 1000 });
    const fresh = weightedTokenCost({ input: 1000, output: 0, cacheCreate: 0, cacheRead: 0 });
    expect(cached).toBeLessThan(fresh);
  });

  test("prices output above input", () => {
    const out = weightedTokenCost({ input: 0, output: 100, cacheCreate: 0, cacheRead: 0 });
    const inp = weightedTokenCost({ input: 100, output: 0, cacheCreate: 0, cacheRead: 0 });
    expect(out).toBeGreaterThan(inp);
  });

  test("honours supplied weights over the defaults", () => {
    const tiers = { input: 10, output: 0, cacheCreate: 0, cacheRead: 0 };
    expect(weightedTokenCost(tiers, { ...DEFAULT_TOKEN_WEIGHTS, input: 2 })).toBe(20);
  });
});

describe("computeAttention", () => {
  test("classifies each unknown and totals its ledger", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "U", kind: "spend", calls: 2, ms: 50,
      tokens: { input: 100, output: 10, cacheCreate: 0, cacheRead: 0 } });
    recordAttention(dir, { ts: "b", unknown: "U", kind: "spend", calls: 1, ms: 25,
      tokens: { input: 50, output: 5, cacheCreate: 0, cacheRead: 0 } });

    const rollup = computeAttention([unknown("U")], dir);
    expect(rollup.unknowns).toHaveLength(1);
    expect(rollup.unknowns[0].klass).toBe("bounded");
    expect(rollup.unknowns[0].calls).toBe(3);
    expect(rollup.unknowns[0].ms).toBe(75);
    expect(rollup.unknowns[0].tokens).toEqual({ input: 150, output: 15, cacheCreate: 0, cacheRead: 0 });
    expect(rollup.unknowns[0].weightedCost).toBeGreaterThan(0);
  });

  test("ignores every layer that is not Unknown", () => {
    const rollup = computeAttention(
      [unknown("U"), { title: "S", layer: "Solution", tags: [], links: [], body: "b" }],
      tmp(),
    );
    expect(rollup.unknowns.map((u) => u.title)).toEqual(["U"]);
  });

  test("rolls counts and cost up by class", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "Bounded", kind: "spend", calls: 1, ms: 1,
      tokens: { input: 10, output: 0, cacheCreate: 0, cacheRead: 0 } });
    const rollup = computeAttention([
      unknown("Bounded"),
      unknown("Unreached", "## Format\nx\n\n## Rationale\ny"),
      unknown("Dark", "no sections here"),
      unknown("Done", FULL, { status: "validated" }),
      unknown("Given up", FULL, { status: "deferred" }),
    ], dir);

    expect(rollup.byClass.bounded.count).toBe(3);
    expect(rollup.byClass.bounded.satisfied).toBe(1);
    expect(rollup.byClass.bounded.abandoned).toBe(1);
    expect(rollup.byClass.bounded.open).toBe(1);
    expect(rollup.byClass.unreached.count).toBe(1);
    expect(rollup.byClass.unbounded.count).toBe(1);
    expect(rollup.byClass.bounded.weightedCost).toBeGreaterThan(0);
  });

  test("an unknown with no ledger costs zero rather than being omitted", () => {
    const rollup = computeAttention([unknown("Never worked")], tmp());
    expect(rollup.unknowns[0].calls).toBe(0);
    expect(rollup.unknowns[0].weightedCost).toBe(0);
  });

  test("reports unattributed spend — a variant that cannot say what it spent on is measurably worse", () => {
    const dir = tmp();
    fs.mkdirSync(path.dirname(usageLogPath(dir)), { recursive: true });
    fs.writeFileSync(usageLogPath(dir), [
      JSON.stringify({ ts: "a", tool: "ost_read_tree", ok: true, ms: 5, surface: "mcp", argBytes: 0 }),
      JSON.stringify({ ts: "b", tool: "ost_read_tree", ok: true, ms: 7, surface: "mcp", argBytes: 0, unknown: "U" }),
    ].join("\n"), "utf8");

    const rollup = computeAttention([unknown("U")], dir);
    expect(rollup.unattributed.calls).toBe(1);
    expect(rollup.unattributed.ms).toBe(5);
  });

  test("a vault with no usage log reports no unattributed spend rather than throwing", () => {
    expect(computeAttention([unknown("U")], tmp()).unattributed).toEqual({ calls: 0, ms: 0 });
  });

  test("derives calls/ms for an unknown purely from the usage trace when the ledger is empty", () => {
    const dir = tmp();
    fs.mkdirSync(path.dirname(usageLogPath(dir)), { recursive: true });
    fs.writeFileSync(usageLogPath(dir), [
      JSON.stringify({ ts: "a", tool: "ost_read_tree", ok: true, ms: 5, surface: "mcp", argBytes: 0, unknown: "U" }),
      JSON.stringify({ ts: "b", tool: "ost_read_tree", ok: true, ms: 7, surface: "mcp", argBytes: 0, unknown: "U" }),
    ].join("\n"), "utf8");

    const rollup = computeAttention([unknown("U")], dir);
    expect(rollup.unknowns[0].calls).toBe(2);
    expect(rollup.unknowns[0].ms).toBe(12);
  });

  test("adds usage-trace attribution on top of ledger spend, rather than replacing it", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "U", kind: "spend", calls: 2, ms: 50,
      tokens: { input: 100, output: 10, cacheCreate: 0, cacheRead: 0 } });
    fs.mkdirSync(path.dirname(usageLogPath(dir)), { recursive: true });
    fs.writeFileSync(usageLogPath(dir), [
      JSON.stringify({ ts: "b", tool: "ost_read_tree", ok: true, ms: 9, surface: "mcp", argBytes: 0, unknown: "U" }),
    ].join("\n"), "utf8");

    const rollup = computeAttention([unknown("U")], dir);
    expect(rollup.unknowns[0].calls).toBe(3);
    expect(rollup.unknowns[0].ms).toBe(59);
  });

  test("an event naming an unknown not on the tree is neither attributed nor counted as unattributed", () => {
    const dir = tmp();
    fs.mkdirSync(path.dirname(usageLogPath(dir)), { recursive: true });
    fs.writeFileSync(usageLogPath(dir), [
      JSON.stringify({ ts: "a", tool: "ost_read_tree", ok: true, ms: 5, surface: "mcp", argBytes: 0, unknown: "Ghost" }),
    ].join("\n"), "utf8");

    const rollup = computeAttention([unknown("U")], dir);
    expect(rollup.unknowns[0].calls).toBe(0);
    expect(rollup.unknowns[0].ms).toBe(0);
    expect(rollup.unattributed).toEqual({ calls: 0, ms: 0 });
  });
});

describe("the token-weighting gene", () => {
  test("the exported default IS the genome's default — one literal for the cost model, or none", () => {
    // A drift guard, not a behavior test: it passes today because two hand-kept
    // literals happen to agree, and its job is to fail the moment they stop.
    expect(DEFAULT_TOKEN_WEIGHTS).toEqual(defaultGenome().tokenWeights);
  });

  test("the shipped default preserves published pricing order — cache reads are cheap, output is dear", () => {
    const w = defaultGenome().tokenWeights;
    expect(w.cacheRead).toBeLessThan(w.input);
    expect(w.input).toBeLessThan(w.cacheCreate);
    expect(w.cacheCreate).toBeLessThan(w.output);
  });

  test("a genome that prices output cheaply lowers what the same answer cost", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "U", kind: "spend", calls: 1, ms: 1,
      tokens: { input: 100, output: 10, cacheCreate: 0, cacheRead: 0 } });
    fs.writeFileSync(
      path.join(dir, "genome.yaml"),
      "tokenWeights:\n  input: 1\n  output: 1\n  cacheCreate: 1.25\n  cacheRead: 0.1\n",
      "utf8",
    );

    const shipped = computeAttention([unknown("U")], dir);
    const cheap = computeAttention([unknown("U")], dir, { weights: loadGenome(dir).tokenWeights });

    expect(shipped.unknowns[0].weightedCost).toBe(150); // 100×1 + 10×5
    expect(cheap.unknowns[0].weightedCost).toBe(110); // 100×1 + 10×1
    expect(shipped.unknowns[0].tokens).toEqual(cheap.unknowns[0].tokens); // tiers stay unmixed either way
  });

  test("a class rollup is weighted by the supplied gene too, not only the per-unknown line", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "U", kind: "spend", calls: 1, ms: 1,
      tokens: { input: 0, output: 100, cacheCreate: 0, cacheRead: 0 } });
    const dear = computeAttention([unknown("U")], dir);
    const flat = computeAttention([unknown("U")], dir, {
      weights: { ...DEFAULT_TOKEN_WEIGHTS, output: 1 },
    });
    expect(dear.byClass.bounded.weightedCost).toBeGreaterThan(flat.byClass.bounded.weightedCost);
  });

  test("omitting the options object reproduces the default genome exactly — an absent gene is the shipped one", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "U", kind: "spend", calls: 2, ms: 40,
      tokens: { input: 100, output: 10, cacheCreate: 8, cacheRead: 900 } });
    const bare = computeAttention([unknown("U")], dir);
    expect(computeAttention([unknown("U")], dir, {})).toEqual(bare);
    expect(computeAttention([unknown("U")], dir, { weights: defaultGenome().tokenWeights })).toEqual(bare);
  });

  test("a resolution gene reaches the rollup — reversing rule order flips abandoned to satisfied", () => {
    const ANSWER_FIRST: ResolutionGene = {
      answerSection: "Answer",
      fallback: "open",
      rules: [
        { state: "satisfied", status: ["validated"], section: "Answer" },
        { state: "abandoned", status: ["deferred"] },
      ],
    };
    const node = unknown("U", `${FULL}\n\n## Answer\nx`, { status: "deferred" });

    // The default gene: abandonment outranks a drafted answer.
    expect(computeAttention([node], tmp()).byClass.bounded.abandoned).toBe(1);

    // The same node, same tree, one reordered gene — and `ost_status` now agrees
    // with what `ost_next_work` would say under that genome, which is the point.
    const rollup = computeAttention([node], tmp(), { resolution: ANSWER_FIRST });
    expect(rollup.unknowns[0].state).toBe("satisfied");
    expect(rollup.byClass.bounded.satisfied).toBe(1);
    expect(rollup.byClass.bounded.abandoned).toBe(0);
  });
});

describe("computeAttention — byClass keys off the genome's vocabulary", () => {
  const twoClass = {
    contractSections: ["Format", "Methodology", "Rationale"],
    classes: ["bounded", "unbounded"],
    fallback: "unbounded",
    rules: [{ class: "bounded", present: ["Format"], absent: [] }],
  };

  test("a two-class genome produces two buckets and NO ghost `unreached`", () => {
    const rollup = computeAttention(
      [unknown("Bounded"), unknown("Shape only", "## Format\nx"), unknown("Dark", "nothing declared")],
      tmp(),
      { classifier: twoClass },
    );
    expect(Object.keys(rollup.byClass).sort()).toEqual(["bounded", "unbounded"]);
    expect(rollup.byClass.bounded.count).toBe(2);
    expect(rollup.byClass.unbounded.count).toBe(1);
  });

  test("a class the genome declares but no node earns still gets a zero bucket — absent reads as zero, not missing", () => {
    const rollup = computeAttention([unknown("Bounded")], tmp(), {
      classifier: { ...twoClass, classes: ["bounded", "unbounded", "commissioned"] },
    });
    expect(rollup.byClass.commissioned).toEqual({
      count: 0, satisfied: 0, abandoned: 0, open: 0, weightedCost: 0,
    });
  });
});

describe("computeAttention — the staleAttribution gene", () => {
  const ghostLog = (dir: string): void => {
    fs.mkdirSync(path.dirname(usageLogPath(dir)), { recursive: true });
    fs.writeFileSync(
      usageLogPath(dir),
      [
        JSON.stringify({ ts: "a", tool: "ost_read_web", ok: true, ms: 5, surface: "mcp", argBytes: 0, unknown: "Ghost" }),
        JSON.stringify({ ts: "b", tool: "ost_read_web", ok: true, ms: 7, surface: "mcp", argBytes: 0, unknown: "U" }),
      ].join("\n"),
      "utf8",
    );
  };

  test("the default drops a marker naming a title not on the tree — an explicit `drop` and saying nothing agree", () => {
    const dir = tmp();
    ghostLog(dir);
    const byDefault = computeAttention([unknown("U")], dir);
    const explicit = computeAttention([unknown("U")], dir, { attribution: { staleAttribution: "drop" } });

    expect(byDefault.unattributed.calls).toBe(0);
    expect(explicit.unattributed.calls).toBe(0);
    expect(byDefault.unknowns[0].calls).toBe(1);
    expect(explicit.unknowns[0].calls).toBe(1);
  });

  test("`unattributed` folds a renamed unknown's spend back in — the attention was still spent on something", () => {
    const dir = tmp();
    ghostLog(dir);
    const rollup = computeAttention([unknown("U")], dir, { attribution: { staleAttribution: "unattributed" } });

    expect(rollup.unattributed.calls).toBe(1);
    expect(rollup.unattributed.ms).toBe(5);
    // The live attribution is untouched: only the ghost moves.
    expect(rollup.unknowns[0].calls).toBe(1);
    expect(rollup.unknowns[0].ms).toBe(7);
  });
});
