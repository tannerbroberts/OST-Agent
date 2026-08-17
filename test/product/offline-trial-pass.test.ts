/**
 * "Bundled local model for zero-credential trial" — the definition of done this
 * candidate's assumption test pinned: a full maintenance pass completes with the
 * network disabled and no credential in the environment.
 *
 * Red before this file existed because the split landed the other way: the
 * deterministic CLI (`init`, `status`, `check`, `debt`, `lanes`, `result`)
 * already needed no model and no key, while every reasoning step — mapping
 * evidence, ideating solutions, surfacing assumption tests — was supplied by the
 * connected session's model. `runOfflinePass` is the offline stand-in for that
 * reasoning; this file is the proof it runs without either dependency.
 *
 * What this does NOT settle, on purpose, and it is the node's own question:
 * whether the pass it produces is any good. Every node the driver writes says so
 * in its own body. Judging that stays a person's job.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { writeEvidence } from "../../src/processes/tree.js";
import { buildPassContext } from "../../src/runner/context.js";
import { runOfflinePass } from "../../src/runner/offline-pass.js";

const OUTCOME = "Help freelance designers get paid on time";
const NEED_NOTE = "Clients ghost the invoice for weeks and there is no polite way to chase them.";

/** Every credential this repo's adapters would otherwise read from the environment. */
const CREDENTIAL_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "SLACK_BOT_TOKEN",
  "ATLASSIAN_API_TOKEN",
  "BRAVE_SEARCH_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
];

let dir: string;
let savedEnv: Record<string, string | undefined>;
let fetchCalls: number;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-offline-trial-"));
  await initVault(dir, OUTCOME);

  writeEvidence(
    dir,
    { id: "INBOX:ghosted-invoice.md", source: "INBOX:ghosted-invoice.md", title: "Ghosted invoice", timestamp: "2026-08-01T00:00:00.000Z", body: NEED_NOTE },
    "inbox",
  );

  savedEnv = {};
  for (const key of CREDENTIAL_ENV_VARS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }

  // The network itself: any call proves the pass reached outside this process.
  fetchCalls = 0;
  vi.stubGlobal(
    "fetch",
    (() => {
      fetchCalls++;
      throw new Error("network disabled for this test — the offline pass must never call fetch");
    }) as typeof fetch,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of CREDENTIAL_ENV_VARS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a full maintenance pass completes with the network disabled and no credential in the environment", async () => {
  const summary = await runOfflinePass(dir);

  expect(fetchCalls).toBe(0);

  // It actually did the four kinds of maintenance work the node's own
  // definition of done names — map, ideate, surface an assumption test — not
  // just returned a done-nothing summary.
  expect(summary.mapped).toBeGreaterThan(0);
  expect(summary.ideated).toBeGreaterThan(0);
  expect(summary.assumptionsSurfaced).toBeGreaterThan(0);
  expect(summary.iterations).toBeGreaterThan(0);
  expect(summary.iterations).toBeLessThan(10);

  // The writes are real and on disk, not just counted in memory.
  const tree = buildPassContext(dir).vault.readTree();
  const opportunities = tree.filter((n) => n.layer === "Opportunity" && n.title !== OUTCOME);
  const solutions = tree.filter((n) => n.layer === "Solution");
  const tests = tree.filter((n) => n.layer === "AssumptionTest");
  expect(opportunities.length).toBeGreaterThan(0);
  expect(solutions.length).toBeGreaterThan(0);
  expect(tests.length).toBeGreaterThan(0);

  // The evidence that seeded this pass is now mapped — cited by whatever
  // Opportunity the driver minted from it.
  const citedSources = new Set(tree.map((n) => n.source));
  expect(citedSources.has("INBOX:ghosted-invoice.md")).toBe(true);

  // Every AssumptionTest this driver can produce is honestly humans-required —
  // it never fabricates a spec command it cannot back.
  for (const t of tests) {
    expect(t.instrument).toBeUndefined();
    expect(t.lane).toBe("humans-required");
  }
});

test("running twice on the same vault does not spin — the second pass is bounded by what is left to do", async () => {
  await runOfflinePass(dir);
  const second = await runOfflinePass(dir);
  // Everything the first pass could map/ideate/surface is either done or left
  // for a person (solutionsMissingInstruments, which this driver cannot clear);
  // the second pass should find little or nothing new to do.
  expect(second.iterations).toBeLessThan(10);
  expect(fetchCalls).toBe(0);
});
