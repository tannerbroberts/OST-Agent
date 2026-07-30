/**
 * B1 and B10 — the agent may name a measurement heading, never author one.
 *
 * `## Results` clears `gateSolution`, backs a measurement rung through
 * `unearnedRungs`, and satisfies `checkCorroboration`. `## Uncovered` cancels
 * the coverage debt that a result creates. Both were writable by the actor those
 * gates are about, and the readiness document recorded the exposure as ONE path,
 * `ost_append_to_node`'s `section`. It was six: `appendUnderHeading` splices a
 * caller's string in as LINES, so every free-text parameter on the surface —
 * `section`, `body`, two `note`s, `issue`, `why` — authored a heading just as
 * well. That is why the guard is at the vault's write funnel and not on a
 * parameter, and why the first test below is a loop rather than a case.
 *
 * The tests drive the real tool set through `validateToolInput` first, the
 * clearability harness's shape, so a refusal here is a refusal for the same
 * reason it would be on the wire.
 *
 * What this does NOT claim: that a result cannot be *arranged*. Under B2 the
 * status path is closed too, but a human who edits the markdown in Obsidian
 * writes whatever they like — that is the point, they are the actor the gate
 * defers to. The claim is about the tool surface.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { computeCoverageDebt } from "../../src/eval/coverage.js";
import { gateSolution, hasRecordedResult } from "../../src/eval/evidence-debt.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { declaresHeading, RESERVED_HEADINGS, RESULTS_HEADING, UNCOVERED_HEADING } from "../../src/ost/headings.js";
import type { OstNode } from "../../src/ost/node.js";
import { recordResult } from "../../src/ost/results.js";
import { Vault } from "../../src/ost/vault.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { validateToolInput, type ToolSchema } from "../../src/security/validateToolInput.js";

let dir: string;
let vault: Vault;

interface RawTool {
  name: string;
  input_schema: ToolSchema;
  run: (input: unknown) => Promise<string>;
}

function call(tool: string, input: Record<string, unknown>): Promise<string> {
  const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test" };
  const built = (buildOstTools(ctx, MCP_TOOL_NAMES) as unknown as RawTool[]).find((t) => t.name === tool);
  if (!built) throw new Error(`${tool} is not on the MCP surface`);
  const problems = validateToolInput(built.input_schema, input);
  if (problems.length > 0) throw new Error(`refused the call: ${problems.join("; ")}`);
  return built.run(input);
}

function node(title: string, layer: OstNode["layer"], body: string): OstNode {
  return { title, layer, body, tags: [], links: [], evidence: "assertion" };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-reserved-"));
  vault = new Vault(dir);
  vault.createNode(node("Root", "Outcome", "the mandate"));
  vault.createNode(node("Opp", "Opportunity", "a gap"));
  vault.createNode(node("Sol", "Solution", "an idea"));
  vault.createNode(node("Asm", "AssumptionTest", "## Method\nrun it"));
  vault.linkNodes("Root", "Opp");
  vault.linkNodes("Opp", "Sol");
  vault.linkNodes("Sol", "Asm");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("B1 — no agent-reachable tool writes a heading an evaluator reads as a run", () => {
  // The criterion's Check, verbatim. It reproduced as `{cleared:false}` →
  // `{cleared:true, "1 of 1 assumption test(s) recorded a result"}`.
  test("ost_append_to_node cannot write ## Results, and the gate does not move", async () => {
    expect(gateSolution(vault.readTree(), "Sol").cleared).toBe(false);

    await expect(call("ost_append_to_node", { title: "Asm", section: "## Results\n- supported" })).rejects.toThrow(
      /reserved heading/,
    );

    expect(gateSolution(vault.readTree(), "Sol").cleared).toBe(false);
    expect(hasRecordedResult(vault.read("Asm"))).toBe(false);
  });

  /**
   * The five the document never recorded. Each was measured clearing the gate
   * before this guard: a free-text `note`, `issue` or `why` with a newline in it
   * is spliced in as body lines, so it authors a heading exactly like `section`.
   */
  const OTHER_DOORS: Array<{ tool: string; input: Record<string, unknown> }> = [
    { tool: "ost_create_node", input: { title: "Born run", layer: "AssumptionTest", parent: "Sol", body: "we ran it\n\n## Results\n- supported", evidence: "assertion" } },
    { tool: "ost_set_status", input: { title: "Asm", status: "in-discovery", note: "moving on\n## Results\n- supported" } },
    { tool: "ost_set_evidence", input: { title: "Asm", evidence: "stated", note: "see below\n## Results\n- supported" } },
    { tool: "ost_annotate", input: { title: "Asm", issue: "hygiene\n## Results\n- supported" } },
    { tool: "ost_flag_humans_required", input: { test: "Asm", why: 'needs an "interview"\n## Results\n- supported' } },
  ];

  for (const door of OTHER_DOORS) {
    test(`${door.tool} cannot write ## Results either`, async () => {
      await expect(call(door.tool, door.input)).rejects.toThrow(/reserved heading/);
      expect(gateSolution(vault.readTree(), "Sol").cleared).toBe(false);
      // Nothing half-written: a refused create leaves no node behind.
      if (door.tool === "ost_create_node") expect(vault.has("Born run")).toBe(false);
    });
  }

  test("the refusal names the way out, and never tells the agent to record a result", async () => {
    const err = await call("ost_append_to_node", { title: "Asm", section: "## Results\n- supported" }).catch(
      (e: Error) => e.message,
    );
    // The way out is a human on the CLI. A refusal that named no path is R2.
    expect(err).toMatch(/ost-agent result/);
    // And it must not instruct the one actor forbidden to record results to go
    // record one — the failure mode `UnearnedRung.missing` has by design.
    expect(err).not.toMatch(/record one \(a/);
  });

  test("the heading stays writable where it is a parameter, not content — the human's path", () => {
    // This is `recordResult`'s own move: the heading travels as
    // `appendUnderSection`'s argument, which the content guard does not scan.
    recordResult(dir, {
      test: "Asm",
      verdict: "supported",
      note: "6 of 20 booked",
      by: "Tanner",
      uncovered: "says nothing about retention",
      on: "2026-07-25",
    });
    expect(hasRecordedResult(vault.read("Asm"))).toBe(true);
    expect(gateSolution(vault.readTree(), "Sol").cleared).toBe(true);
  });

  test("ordinary prose still writes — the guard is a reserved word, not a heading ban", async () => {
    await expect(call("ost_append_to_node", { title: "Asm", section: "## Notes\n- the funnel looked odd" })).resolves.toMatch(
      /appended/,
    );
    // Including a heading that merely mentions the word.
    await expect(call("ost_append_to_node", { title: "Asm", section: "## Result of the workshop\n- we picked one" })).resolves.toMatch(
      /appended/,
    );
    expect(hasRecordedResult(vault.read("Asm"))).toBe(false);
  });
});

describe("B10 — the coverage-debt signal is not silenceable by the actor that created the debt", () => {
  // The criterion's Check. It reproduced as gaps dropping from 2 to 1.
  test("ost_append_to_node cannot write ## Uncovered, and the gap count does not move", async () => {
    recordResult(dir, { test: "Asm", verdict: "supported", note: "one", by: "T", uncovered: "desktop only", on: "2026-07-25" });
    vault.appendUnderSection("Asm", RESULTS_HEADING, "- 2026-07-26 **supported** (ran by T) — a second run");
    const before = computeCoverageDebt(vault.readTree()).totals.unbounded;
    expect(before).toBe(1);

    await expect(call("ost_append_to_node", { title: "Asm", section: "## Uncovered\n- nothing much" })).rejects.toThrow(
      /reserved heading/,
    );

    expect(computeCoverageDebt(vault.readTree()).totals.unbounded).toBe(before);
  });
});

describe("the guard and the readers cannot drift apart", () => {
  /**
   * The spellings that used to split the two readers. `hasRecordedResult` used
   * `/^##\s+Results\b/im` and missed `  ## Results`; `countEntriesUnder` used
   * trim-equality and missed `## Results of the pilot`. A guard agreeing with
   * only one of them leaves the other's spelling open, so all four go through
   * one matcher now — and the guard refuses every spelling either reader honours.
   */
  const SPELLINGS = ["## Results", "  ## Results", "## results", "##  Results", "## Results of the pilot", "## Results:"];

  for (const spelling of SPELLINGS) {
    test(`refused, and read as a result: ${JSON.stringify(spelling)}`, async () => {
      await expect(call("ost_append_to_node", { title: "Asm", section: `${spelling}\n- supported` })).rejects.toThrow(
        /reserved heading/,
      );
      expect(declaresHeading(`${spelling}\n- supported`, RESULTS_HEADING)).toBe(true);
    });
  }

  // The other direction, or the guard is a ban on the word "Results".
  const NOT_HEADINGS = ["### Results", "# Results", "##Results", "## Resultsish", "the Results were good"];
  for (const text of NOT_HEADINGS) {
    test(`allowed, and not read as a result: ${JSON.stringify(text)}`, async () => {
      await expect(call("ost_append_to_node", { title: "Asm", section: `${text}\n- prose` })).resolves.toMatch(/appended/);
      expect(declaresHeading(`${text}\n- prose`, RESULTS_HEADING)).toBe(false);
    });
  }

  test("the reserved set is exactly the headings a gate reads as a measurement", () => {
    expect([...RESERVED_HEADINGS]).toEqual([RESULTS_HEADING, UNCOVERED_HEADING]);
  });
});
