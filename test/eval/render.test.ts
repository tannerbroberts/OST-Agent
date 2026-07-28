/**
 * The renderers are the single source of the analysis wording. The CLI prints
 * what they return and the MCP tools return it verbatim, so the text cannot
 * fork between surfaces.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { renderCheck, renderDebt, renderGate, renderStatus } from "../../src/eval/render.js";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-render-"));
  await initVault(dir, "Reach ten returning operators.", "Reach ten returning operators");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test("renderCheck reports a passing tree with zero violations", () => {
  const ctx = buildPassContext(dir);
  const out = renderCheck(ctx.vault.readTree());
  expect(out.violations).toBe(0);
  expect(out.text).toMatch(/invariants: PASS \(0 violations\)/);
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
  const text = renderStatus(ctx);
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
    renderCheck(ctx.vault.readTree());
    renderDebt(ctx.vault.readTree());
    renderStatus(ctx);
    renderGate(ctx.vault.readTree(), "x");
  } finally {
    console.log = real;
  }
  expect(logged).toEqual([]);
});
