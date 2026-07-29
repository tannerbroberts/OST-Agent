/**
 * The renderers are the single source of the analysis wording. The CLI prints
 * what they return and the MCP tools return it verbatim, so the text cannot
 * fork between surfaces.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { renderCheck, renderDebt, renderGate, renderStatus } from "../../src/eval/render.js";
import { recordAttention } from "../../src/telemetry/attention.js";
import { usageLogPath } from "../../src/telemetry/usage.js";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-render-"));
  await initVault(dir, "Reach ten returning operators.", "Reach ten returning operators");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test("renderCheck reports a passing tree with zero violations", () => {
  const ctx = buildPassContext(dir);
  const out = renderCheck(ctx.vault.readTreeCensus());
  expect(out.violations).toBe(0);
  // The denominator is load-bearing: "0 violations" over an unstated set is the
  // shape of a check that passed because it looked at nothing.
  expect(out.text).toMatch(/invariants: PASS \(0 violations over \d+ node\(s\)\)/);
});

test("renderDebt keeps the sentence that says it never judges", () => {
  const ctx = buildPassContext(dir);
  const text = renderDebt(ctx.vault.readTree());
  expect(text).toMatch(/Solutions: /);
  // Load-bearing: debt flags, it never refuses. Losing this line changes what
  // the tool claims about itself.
  expect(text).toMatch(/Mechanical only/);
  expect(text).toMatch(/is a human call/);
});

test("renderStatus names the vault and the outcome", () => {
  const ctx = buildPassContext(dir);
  const text = renderStatus(ctx, ctx.vault.readTreeCensus());
  expect(text).toMatch(/Vault: /);
  expect(text).toMatch(/Outcome: Reach ten returning operators\./);
  expect(text).toMatch(/Nodes: /);
  expect(text).toMatch(/the tree as a whole rests on its weakest rung/);
});

test("renderGate blocks an unknown solution and says so", () => {
  const ctx = buildPassContext(dir);
  const out = renderGate(ctx.vault.readTree(), "A solution that does not exist");
  expect(out.cleared).toBe(false);
  expect(out.text).toMatch(/^gate: BLOCKED — /);
});

test("renderers return text, never print", () => {
  const ctx = buildPassContext(dir);
  const logged: unknown[] = [];
  const real = console.log;
  console.log = (...a: unknown[]) => void logged.push(a);
  try {
    renderCheck(ctx.vault.readTreeCensus());
    renderDebt(ctx.vault.readTree());
    renderStatus(ctx, ctx.vault.readTreeCensus());
    renderGate(ctx.vault.readTree(), "x");
  } finally {
    console.log = real;
  }
  expect(logged).toEqual([]);
});

test("renderStatus's per-layer breakdown names every layer, including Unknown, and sums to the total", () => {
  const ctx = buildPassContext(dir);
  ctx.vault.createNode({
    title: "How many users hit the export path",
    layer: "Unknown",
    tags: [],
    links: [],
    body: "## Format\na count per day",
    evidence: "assertion",
  });

  const line = renderStatus(buildPassContext(dir), buildPassContext(dir).vault.readTreeCensus()).split("\n").find((l) => l.startsWith("Nodes:"));
  expect(line, 'expected a "Nodes:" line in status output').toBeDefined();

  const total = Number(line!.match(/^Nodes: (\d+)/)?.[1]);
  expect(Number.isFinite(total)).toBe(true);

  // Hand-listing the layers here is what let Unknown silently drop out of the
  // breakdown while the total still counted it; pin every layer by name.
  for (const layer of ["Outcome", "Opportunity", "Solution", "AssumptionTest", "Unknown"]) {
    expect(line).toContain(layer);
  }
  const perLayerSum = [...line!.matchAll(/(?:Outcome|Opportunity|Solution|AssumptionTest|Unknown) (\d+)/g)]
    .reduce((sum, m) => sum + Number(m[1]), 0);
  expect(perLayerSum).toBe(total);
});

describe("renderStatus — the attention section", () => {
  const FULL = "## Format\na count per day\n\n## Methodology\nquery the log\n\n## Rationale\nserves [[Reach ten returning operators]]";

  /** Attach an unknown to the vault. Darkness needs no parent to be counted. */
  function dark(title: string, body = FULL, status?: "validated" | "deferred"): void {
    buildPassContext(dir).vault.createNode({
      title,
      layer: "Unknown",
      tags: [],
      links: [],
      body,
      evidence: "assertion",
      ...(status ? { status } : {}),
    });
  }

  /** Status text read from a context built AFTER the writes above. */
  function status(): string {
    const ctx = buildPassContext(dir);
    return renderStatus(ctx, ctx.vault.readTreeCensus());
  }

  const lineFor = (text: string, prefix: string): string | undefined =>
    text.split("\n").find((l) => l.trim().startsWith(prefix));

  test("a vault with no unknowns renders exactly the status it rendered before attention existed", () => {
    const ctx = buildPassContext(dir);
    // Pinned verbatim, not by prefix: the regression contract for the whole of
    // The point is that nothing correlates tokens, and a vault with
    // nothing dark in it is where that claim is cheapest to check.
    expect(renderStatus(ctx, ctx.vault.readTreeCensus())).toBe(
      [
        `Vault: ${ctx.dir}`,
        "Outcome: Reach ten returning operators.",
        "Nodes: 1  (Outcome 1, Opportunity 0, Solution 0, AssumptionTest 0, Unknown 0)",
        "Unvalidated (agent-ideated, awaiting review): 0",
        "Believability: money 0, observed 0, stated 0, expert 0, assertion 1",
        "  the tree as a whole rests on its weakest rung: assertion",
      ].join("\n"),
    );
  });

  test("every class that carries an unknown reports its counts and what it cost", () => {
    dark("Cabinet");
    dark("Answered", FULL, "validated");
    dark("Given up", FULL, "deferred");
    dark("No method", "## Format\na count\n\n## Rationale\nserves [[Reach ten returning operators]]");
    dark("Dark", "nothing declared at all");
    recordAttention(dir, {
      ts: "2026-07-28T00:00:00Z",
      unknown: "Cabinet",
      kind: "spend",
      calls: 1,
      ms: 10,
      tokens: { input: 100, output: 10, cacheCreate: 0, cacheRead: 0 },
    });

    const text = status();
    expect(text).toContain("Attention: 5 unknown(s) — satisfied 1, abandoned 1, open 3");
    expect(lineFor(text, "bounded:")).toBe(
      "  bounded: 3 unknown(s) (satisfied 1, abandoned 1, open 1) — weighted cost 150",
    );
    expect(lineFor(text, "unreached:")).toBe(
      "  unreached: 1 unknown(s) (satisfied 0, abandoned 0, open 1) — weighted cost 0",
    );
    expect(lineFor(text, "unbounded:")).toBe(
      "  unbounded: 1 unknown(s) (satisfied 0, abandoned 0, open 1) — weighted cost 0",
    );
  });

  test("the share of spend that named no unknown is reported — a variant that cannot say what it spent attention on is measurably worse", () => {
    dark("Cabinet");
    fs.mkdirSync(path.dirname(usageLogPath(dir)), { recursive: true });
    fs.writeFileSync(
      usageLogPath(dir),
      [
        JSON.stringify({ ts: "a", tool: "ost_read_tree", ok: true, ms: 5, surface: "mcp", argBytes: 0 }),
        JSON.stringify({ ts: "b", tool: "ost_read_tree", ok: true, ms: 5, surface: "mcp", argBytes: 0 }),
        JSON.stringify({ ts: "c", tool: "ost_read_tree", ok: true, ms: 7, surface: "mcp", argBytes: 0, unknown: "Cabinet" }),
      ].join("\n"),
      "utf8",
    );

    const text = status();
    expect(lineFor(text, "unattributed:")).toBe("  unattributed: 2/3 recorded call(s) (67%) named no unknown");
    expect(text).toContain("a variant that cannot say what it spent attention on is measurably worse.");
  });

  test("status reports calls-and-ms because nothing correlated tokens — a rollup priced in calls can NEVER be read as one priced in tokens", () => {
    dark("Cabinet");
    // `renderStatus` never runs the correlator, so it never supplies
    // `correlated`, and Task 11's `resolveCostBasis` downgrades any declared
    // token basis to calls-and-ms when nothing correlated. That is the honest
    // state of the world until something correlates tokens.
    expect(lineFor(status(), "cost basis:")).toBe(
      "  cost basis: calls-and-ms — no token data; a comparison against a token-based rollup is refused, never normalized",
    );
  });

  test("a class the vocabulary declares but no unknown carries stays quiet", () => {
    dark("Cabinet");
    const text = status();
    expect(text).toContain("Attention: 1 unknown(s) — satisfied 0, abandoned 0, open 1");
    expect(lineFor(text, "bounded:")).toBeDefined();
    expect(lineFor(text, "unreached:")).toBeUndefined();
    expect(lineFor(text, "unbounded:")).toBeUndefined();
  });

  test("status prices the ledger without writing to it — reading what darkness cost must NOT change it", () => {
    dark("Cabinet");
    const first = status();
    const second = status();
    expect(second).toBe(first);
    expect(fs.existsSync(path.join(dir, ".ost-agent", "attention"))).toBe(false);
  });
});
