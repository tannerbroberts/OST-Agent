/**
 * The regression contract, executable.
 *
 * Phase 2 moved every policy governing unknowns out of TypeScript and into
 * `genome.yaml`. The whole move is only legitimate if it changed nothing: with
 * the shipped default genome — and with no `genome.yaml` on disk at all, which
 * is every vault that exists today — the kernel must behave byte-for-byte as it
 * did before. This file is where that claim is checked, once, over the whole
 * surface rather than a gene at a time.
 *
 * The expectation table below is written as a LITERAL rather than derived from
 * the schema. A test that computes its expectation from the thing it is testing
 * agrees with itself under any drift; this one fails loudly the moment a default
 * moves, which is the entire point of pinning it.
 *
 * The classifier and resolution assertions restate the exact body strings from
 * `test/knowledge/unknowns.test.ts` as literals, deliberately: the Phase 1
 * functions may one day be deleted, and this file must keep meaning something
 * after they are. It asserts against strings and expected labels, never against
 * the old implementation.
 *
 * The negative controls are not decoration. Every assertion above them passes
 * against an interpreter that accepts a `genome` argument and ignores it — the
 * genome as data nothing reads, which would be a worse outcome than not
 * extracting it at all, because the harness would then measure a variable that
 * does not vary. Each control mutates one allele and requires the output to
 * move. Precedent: `test/release/examples-allowlist.test.ts:45`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import { computeAttention } from "../../src/eval/attention.js";
import { GenomeSchema, type Genome } from "../../src/genome/schema.js";
import { defaultGenome, genomePath, loadGenome } from "../../src/genome/load.js";
import { classifyUnknown, contractGaps, resolutionState } from "../../src/knowledge/unknowns.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import type { OstNode } from "../../src/ost/node.js";
import { buildPassContext } from "../../src/runner/context.js";
import { initVault } from "../../src/runner/init.js";
import { recordAttention } from "../../src/telemetry/attention.js";
import { usageLogPath } from "../../src/telemetry/usage.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/**
 * The shipped genome, written out by hand. If a schema default moves, this is
 * the first thing that fails — and it is supposed to be edited only when the
 * move is intended.
 */
const SHIPPED: Genome = {
  version: 1,
  weightedTokenSpend: { input: 1, output: 5, cacheCreate: 1.25, cacheRead: 0.1 },
  classifier: {
    contractSections: ["Format", "Methodology", "Rationale"],
    classes: ["bounded", "unreached", "unbounded"],
    fallback: "unbounded",
    rules: [
      { class: "unbounded", present: [], absent: ["Format"] },
      { class: "bounded", present: ["Format", "Methodology"], absent: [] },
      { class: "unreached", present: ["Format"], absent: [] },
    ],
  },
  resolution: {
    answerSection: "Answer",
    fallback: "open",
    rules: [
      { state: "abandoned", status: ["deferred"] },
      { state: "satisfied", status: ["validated"], section: "Answer" },
    ],
  },
  budgets: { sharedPool: null, perClass: {}, onExhaustion: "instruct" },
  pivot: {
    unknownsBlockDone: false,
    maxOpenUnknownsSurfaced: 0,
    ranking: "tree-order",
    classPriority: [],
  },
  attribution: { staleAttribution: "drop" },
  tokenSplit: {
    enabled: false,
    source: "transcript",
    transcriptDir: "",
    method: "proportional-by-calls",
    residual: "unattributed",
    costBasis: "tokens",
  },
};

// The exact fixtures from test/knowledge/unknowns.test.ts and
// test/eval/attention.test.ts, restated as literals.
const FULL = "## Format\na count\n\n## Methodology\nquery the log\n\n## Rationale\nserves [[Outcome]]";
const ROLLUP_FULL = "## Format\na count\n\n## Methodology\nquery\n\n## Rationale\nserves [[O]]";

const unknown = (body: string, extra: Partial<OstNode> = {}): OstNode => ({
  title: "U", layer: "Unknown", tags: [], links: [], body, evidence: "assertion", ...extra,
});

const node = (title: string, body = ROLLUP_FULL, extra: Partial<OstNode> = {}): OstNode => ({
  title, layer: "Unknown", tags: [], links: [], body, evidence: "assertion", ...extra,
});

/** The annotated default genome published in the reference doc. */
function documentedGenomeYaml(): string {
  const md = fs.readFileSync(path.join(REPO, "docs", "reference", "genome.md"), "utf8");
  const match = md.match(/<!-- default-genome -->\s*```yaml\n([\s\S]*?)```/);
  if (!match) throw new Error("docs/reference/genome.md has no `<!-- default-genome -->` yaml block");
  return match[1];
}

describe("the default genome is today's behavior, written down", () => {
  test("the shipped defaults are exactly this table — a drifted schema default fails here first", () => {
    expect(defaultGenome()).toEqual(SHIPPED);
  });

  test("the annotated genome in docs/reference/genome.md parses back to the shipped default", () => {
    // Documentation that drifts from the schema is worse than none: it is the
    // file an operator edits, and a wrong default there is a wrong genome.
    expect(GenomeSchema.parse(parseYaml(documentedGenomeYaml()))).toEqual(SHIPPED);
  });

  test("an absent genome.yaml IS the shipped default — every vault already carries it", () => {
    const dir = tmp("ost-genome-absent-");
    expect(fs.existsSync(genomePath(dir))).toBe(false);
    expect(loadGenome(dir)).toEqual(SHIPPED);
  });

  test("a vault initialised today has no genome.yaml and a pass context carrying the default", async () => {
    const dir = tmp("ost-genome-init-");
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    expect(fs.existsSync(genomePath(dir))).toBe(false);
    expect(buildPassContext(dir).genome).toEqual(SHIPPED);
  });

  test("the interpreter classes every Phase 1 body exactly as the hand-written classifier did", () => {
    const c = defaultGenome().classifier;
    expect(classifyUnknown(unknown(FULL), c)).toBe("bounded");
    expect(classifyUnknown(unknown("## Format\na count\n\n## Rationale\nserves [[Outcome]]"), c)).toBe("unreached");
    expect(classifyUnknown(unknown("## Methodology\nsail west\n\n## Rationale\nserves [[Outcome]]"), c)).toBe("unbounded");
    expect(classifyUnknown(unknown(""), c)).toBe("unbounded");
    expect(classifyUnknown(unknown("## format\nx\n\n## METHODOLOGY\ny"), c)).toBe("bounded");
    expect(classifyUnknown(unknown("we discussed the Format and the Methodology at length"), c)).toBe("unbounded");
  });

  test("the interpreter resolves every Phase 1 state identically, abandonment still first", () => {
    const r = defaultGenome().resolution;
    expect(resolutionState(unknown(FULL), r)).toBe("open");
    expect(resolutionState(unknown(`${FULL}\n\n## Answer\n412 per day`), r)).toBe("satisfied");
    expect(resolutionState(unknown(FULL, { status: "validated" }), r)).toBe("satisfied");
    expect(resolutionState(unknown(FULL, { status: "deferred" }), r)).toBe("abandoned");
    expect(resolutionState(unknown(`${FULL}\n\n## Answer\nx`, { status: "deferred" }), r)).toBe("abandoned");
  });

  test("contract gaps come back in the genome's declared order, not sorted", () => {
    const sections = defaultGenome().classifier.contractSections;
    expect(contractGaps(unknown(""), sections)).toEqual(["Format", "Methodology", "Rationale"]);
    expect(contractGaps(unknown(FULL), sections)).toEqual([]);
  });

  test("the golden rollup by class is unchanged — same five nodes, same ledger, same buckets", async () => {
    const dir = tmp("ost-genome-golden-");
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    recordAttention(dir, {
      ts: "2026-07-27T00:00:00Z", unknown: "Bounded", kind: "spend", calls: 1, ms: 1,
      tokens: { input: 10, output: 0, cacheCreate: 0, cacheRead: 0 },
    });

    const tree = [
      node("Bounded"),
      node("Unreached", "## Format\nx\n\n## Rationale\ny"),
      node("Dark", "no sections here"),
      node("Done", ROLLUP_FULL, { status: "validated" }),
      node("Given up", ROLLUP_FULL, { status: "deferred" }),
    ];

    expect(computeAttention(tree, dir).byClass).toEqual({
      bounded: { count: 3, satisfied: 1, abandoned: 1, open: 1, weightedCost: 10 },
      unreached: { count: 1, satisfied: 0, abandoned: 0, open: 1, weightedCost: 0 },
      unbounded: { count: 1, satisfied: 0, abandoned: 0, open: 1, weightedCost: 0 },
    });
    // Passing the default genome explicitly must be indistinguishable from not passing it.
    const g = defaultGenome();
    expect(computeAttention(tree, dir, { weightedTokenSpend: g.weightedTokenSpend, classifier: g.classifier, resolution: g.resolution }).byClass)
      .toEqual(computeAttention(tree, dir).byClass);
  });

  test("unattributed spend is unchanged, a stale marker is still DROPPED, and the basis is calls-and-ms", async () => {
    const dir = tmp("ost-genome-unattributed-");
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    fs.mkdirSync(path.dirname(usageLogPath(dir)), { recursive: true });
    fs.writeFileSync(usageLogPath(dir), [
      JSON.stringify({ ts: "a", tool: "ost_read_tree", ok: true, ms: 5, surface: "mcp", argBytes: 0 }),
      JSON.stringify({ ts: "b", tool: "ost_read_tree", ok: true, ms: 7, surface: "mcp", argBytes: 0, unknown: "Bounded" }),
      JSON.stringify({ ts: "c", tool: "ost_read_tree", ok: true, ms: 11, surface: "mcp", argBytes: 0, unknown: "Ghost" }),
    ].join("\n"), "utf8");

    const rollup = computeAttention([node("Bounded")], dir);
    expect(rollup.unattributed).toEqual({
      calls: 1, ms: 5, tokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
    });
    expect(rollup.unknowns[0].calls).toBe(1);
    expect(rollup.unknowns[0].ms).toBe(7);
    // tokenSplit is off, so nothing correlates: cost is still the ledger's zero.
    expect(rollup.unknowns[0].tokens).toEqual({ input: 0, output: 0, cacheCreate: 0, cacheRead: 0 });
    // `costBasis` reports what the rollup actually RECEIVED, not what the genome
    // would prefer. No `correlated` map reached it — under the default genome the
    // correlator never runs — so the record says calls and wall-clock, which is
    // exactly the design's stated fallback: "If transcript correlation is
    // unavailable, cost falls back to calls and wall-clock, and the record says so."
    expect(rollup.costBasis).toBe("calls-and-ms");
  });

  test("ost_next_work offers the same darkness, with or without a genome argument", async () => {
    const dir = tmp("ost-genome-nextwork-");
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    const ctx = buildPassContext(dir);
    ctx.vault.createNode({
      title: "How many users hit the export path",
      layer: "Unknown",
      body: "## Format\na count per day\n\n## Rationale\nserves [[Retention]]",
      tags: [], links: [], evidence: "assertion",
    });
    ctx.vault.linkNodes("Retention", "How many users hit the export path");

    const fresh = buildPassContext(dir);
    const implicit = computeNextWork(fresh.vault, dir, 1);
    const explicit = computeNextWork(fresh.vault, dir, 1, defaultGenome());

    expect(implicit.openUnknowns).toEqual([{
      title: "How many users hit the export path",
      klass: "unreached",
      darkens: "Retention",
      gaps: ["Methodology"],
    }]);
    expect(explicit.openUnknowns).toEqual(implicit.openUnknowns);
    expect(explicit.summary).toBe(implicit.summary);
  });

  test("an open unknown still does NOT block done — the default genome never pivots", async () => {
    const dir = tmp("ost-genome-done-");
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    const ctx = buildPassContext(dir);
    ctx.vault.createNode({
      title: "What is out there", layer: "Unknown", body: "nothing declared at all",
      tags: [], links: [], evidence: "assertion",
    });
    ctx.vault.linkNodes("Retention", "What is out there");

    const work = computeNextWork(buildPassContext(dir).vault, dir, 1, defaultGenome());
    expect(work.openUnknowns).toHaveLength(1);
    expect(work.openUnknowns[0].klass).toBe("unbounded");
    expect(work.done).toBe(true);
  });

  describe("negative controls — a mutated allele has to SHOW, or the genome is data nothing reads", () => {
    test("doubling the input weight doubles the weighted cost", async () => {
      const dir = tmp("ost-genome-nc-weightedTokenSpend-");
      await initVault(dir, "Reach 10,000 daily active users", "Retention");
      recordAttention(dir, {
        ts: "a", unknown: "Bounded", kind: "spend", calls: 1, ms: 1,
        tokens: { input: 10, output: 0, cacheCreate: 0, cacheRead: 0 },
      });
      const tree = [node("Bounded")];
      expect(computeAttention(tree, dir).unknowns[0].weightedCost).toBe(10);
      expect(
        computeAttention(tree, dir, { weightedTokenSpend: { input: 2, output: 5, cacheCreate: 1.25, cacheRead: 0.1 } })
          .unknowns[0].weightedCost,
      ).toBe(20);
    });

    test("dropping the unreached rule collapses three classes into two, buckets and all", async () => {
      // The design's own least-settled item: "`unreached` may not earn its own
      // class… the v1 classifier has two classes, not three." A genome that
      // cannot express that allele has not been extracted.
      const dir = tmp("ost-genome-nc-classifier-");
      await initVault(dir, "Reach 10,000 daily active users", "Retention");
      const twoClass = {
        contractSections: ["Format", "Methodology", "Rationale"],
        classes: ["bounded", "unbounded"],
        fallback: "unbounded",
        rules: [
          { class: "unbounded", present: [], absent: ["Format"] },
          { class: "bounded", present: ["Format", "Methodology"], absent: [] },
        ],
      };
      const tree = [
        node("Bounded"),
        node("Unreached", "## Format\nx\n\n## Rationale\ny"),
        node("Dark", "no sections here"),
      ];
      expect(classifyUnknown(tree[1], twoClass)).toBe("unbounded");
      const byClass = computeAttention(tree, dir, { classifier: twoClass }).byClass;
      expect(Object.keys(byClass).sort()).toEqual(["bounded", "unbounded"]);
      expect(byClass.unbounded.count).toBe(2);
      expect(byClass.bounded.count).toBe(1);
    });

    test("reversing resolution precedence moves a node from abandoned to satisfied", async () => {
      // The resolution gene is threaded into computeAttention by Task 5, and a
      // rollup that ignored it would still satisfy every assertion above: the
      // default order and the default fixtures agree by construction. So mutate
      // the one thing the default asserts loudest — that a human's `deferred`
      // outranks a drafted answer — and require the bucket to MOVE.
      const dir = tmp("ost-genome-nc-resolution-");
      await initVault(dir, "Reach 10,000 daily active users", "Retention");
      const tree = [node("Given up", `${ROLLUP_FULL}\n\n## Answer\n412 per day`, { status: "deferred" })];

      const before = computeAttention(tree, dir).byClass;
      expect(before.bounded.abandoned).toBe(1);
      expect(before.bounded.satisfied).toBe(0);

      // Answer-first: a drafted answer now outranks the deferral.
      const answerFirst = {
        answerSection: "Answer",
        fallback: "open",
        rules: [
          { state: "satisfied", status: [], section: "Answer" },
          { state: "abandoned", status: ["deferred"] },
        ],
      };
      expect(resolutionState(tree[0], answerFirst)).toBe("satisfied");
      const after = computeAttention(tree, dir, { resolution: answerFirst }).byClass;
      expect(after.bounded.satisfied).toBe(1);
      expect(after.bounded.abandoned).toBe(0);
    });

    test("flipping staleAttribution surfaces the ghost spend the default drops", async () => {
      const dir = tmp("ost-genome-nc-stale-");
      await initVault(dir, "Reach 10,000 daily active users", "Retention");
      fs.mkdirSync(path.dirname(usageLogPath(dir)), { recursive: true });
      fs.writeFileSync(usageLogPath(dir), [
        JSON.stringify({ ts: "a", tool: "ost_read_tree", ok: true, ms: 5, surface: "mcp", argBytes: 0 }),
        JSON.stringify({ ts: "c", tool: "ost_read_tree", ok: true, ms: 11, surface: "mcp", argBytes: 0, unknown: "Ghost" }),
      ].join("\n"), "utf8");

      const tree = [node("Bounded")];
      expect(computeAttention(tree, dir).unattributed.ms).toBe(5);
      expect(
        computeAttention(tree, dir, { attribution: { staleAttribution: "unattributed" } }).unattributed,
      ).toEqual({ calls: 2, ms: 16, tokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } });
    });

    test("flipping unknownsBlockDone makes darkness block done", async () => {
      const dir = tmp("ost-genome-nc-pivot-");
      await initVault(dir, "Reach 10,000 daily active users", "Retention");
      const ctx = buildPassContext(dir);
      ctx.vault.createNode({
        title: "What is out there", layer: "Unknown", body: "nothing declared at all",
        tags: [], links: [], evidence: "assertion",
      });
      ctx.vault.linkNodes("Retention", "What is out there");

      const vault = buildPassContext(dir).vault;
      const g = defaultGenome();
      expect(computeNextWork(vault, dir, 1, g).done).toBe(true);
      expect(
        computeNextWork(vault, dir, 1, { ...g, pivot: { ...g.pivot, unknownsBlockDone: true } }).done,
      ).toBe(false);
    });

    test("a misspelled allele THROWS while the correct spelling takes effect", () => {
      // The strict-schema contract, both directions. Without the second half a
      // loader that ignored the file entirely would pass the first half.
      const bad = tmp("ost-genome-nc-typo-");
      fs.writeFileSync(genomePath(bad), "tokenWeigths:\n  input: 2\n", "utf8");
      expect(() => loadGenome(bad)).toThrow(/genome\.yaml/);

      const good = tmp("ost-genome-nc-typo-ok-");
      fs.writeFileSync(genomePath(good), "weightedTokenSpend:\n  input: 2\n", "utf8");
      expect(loadGenome(good).weightedTokenSpend.input).toBe(2);
      expect(loadGenome(good).weightedTokenSpend.output).toBe(5);
    });
  });
});
