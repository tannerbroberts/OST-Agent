import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { recordResult, VERDICTS } from "../../src/ost/results.js";
import { gateSolution } from "../../src/eval/evidence-debt.js";
import { Vault } from "../../src/ost/vault.js";
import { ALLOWED_TOOL_NAMES } from "../../src/security/policy.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";

let dir: string;
let vault: Vault;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-results-"));
  vault = new Vault(dir);
  vault.createNode({ title: "Outcome", layer: "Outcome", tags: [], links: ["Opp"], body: "o", evidence: "assertion" });
  vault.createNode({ title: "Opp", layer: "Opportunity", tags: [], links: ["Sol"], body: "b", evidence: "stated" });
  vault.createNode({ title: "Sol", layer: "Solution", tags: [], links: ["Asm"], body: "b", evidence: "assertion" });
  vault.createNode({ title: "Asm", layer: "AssumptionTest", tags: [], links: [], body: "the plan", evidence: "assertion" });
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("recordResult", () => {
  test("writes the result where the gate will find it, clearing the solution", () => {
    expect(gateSolution(vault.readTree(), "Sol").cleared).toBe(false);

    recordResult(dir, { test: "Asm", verdict: "supported", note: "4 of 5 teams completed it", by: "Tanner" });

    expect(gateSolution(vault.readTree(), "Sol").cleared).toBe(true);
  });

  test("records who ran it, so a result can never be mistaken for the agent's own", () => {
    recordResult(dir, { test: "Asm", verdict: "refuted", note: "nobody finished", by: "Tanner" });

    const body = vault.read("Asm").body;
    expect(body).toContain("## Results");
    expect(body).toContain("refuted");
    expect(body).toContain("nobody finished");
    expect(body).toContain("Tanner");
  });

  test("refuses a result with no attribution — an unattributed result is a fabricated one", () => {
    expect(() => recordResult(dir, { test: "Asm", verdict: "supported", note: "it worked", by: "  " })).toThrow(
      /who ran it|attribut/i,
    );
    expect(vault.read("Asm").body).not.toContain("## Results");
  });

  test("refuses a verdict outside the fixed set", () => {
    expect(() =>
      recordResult(dir, { test: "Asm", verdict: "great" as never, note: "n", by: "Tanner" }),
    ).toThrow(/supported/);
  });

  test("refuses to record a result on anything but an assumption test", () => {
    expect(() => recordResult(dir, { test: "Sol", verdict: "supported", note: "n", by: "Tanner" })).toThrow(
      /AssumptionTest/i,
    );
  });

  test("keeps every earlier result — a later run never replaces an earlier one", () => {
    recordResult(dir, { test: "Asm", verdict: "inconclusive", note: "first attempt, too few people", by: "Tanner" });
    recordResult(dir, { test: "Asm", verdict: "supported", note: "second attempt with 12 people", by: "Tanner" });

    const body = vault.read("Asm").body;
    expect(body).toContain("first attempt, too few people");
    expect(body).toContain("second attempt with 12 people");
    expect(body.match(/^##\s+Results\b/gm) ?? []).toHaveLength(1); // one section, not one per run
  });

  test("can raise the test's rung to whatever the run actually produced", () => {
    recordResult(dir, {
      test: "Asm",
      verdict: "supported",
      note: "watched 5 teams do it",
      by: "Tanner",
      evidence: "observed",
    });

    expect(vault.read("Asm").evidence).toBe("observed");
  });

  test("offers exactly the verdicts a test can come back with", () => {
    expect([...VERDICTS]).toEqual(["supported", "refuted", "inconclusive"]);
  });
});

describe("the agent cannot reach result recording", () => {
  // Guard, not a behavior test: recording results is the humans' half of the gate.
  // If a future tool ever exposes it, this fails and the boundary gets re-argued.
  test("no allowlisted or MCP tool records a result", () => {
    for (const name of [...ALLOWED_TOOL_NAMES, ...MCP_TOOL_NAMES]) {
      expect(name).not.toMatch(/result|verdict/i);
    }
  });
});
