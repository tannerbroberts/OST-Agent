import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { computeAttention, DEFAULT_TOKEN_WEIGHTS, weightedTokenCost } from "../../src/eval/attention.js";
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
