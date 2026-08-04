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
import {
  declaresHeading,
  INSTRUMENT_LOG_HEADING,
  RESERVED_HEADINGS,
  RESULTS_HEADING,
  RETRACTION_HEADING,
  UNCOVERED_HEADING,
} from "../../src/ost/headings.js";
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
    { tool: "ost_create_node", input: { title: "Born run", layer: "AssumptionTest", parent: "Sol", body: "we ran it\n\n## Results\n- supported", evidence: "assertion", instrument: "npx vitest run test/fixture.test.ts" } },
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

/**
 * The door-independent property — and the reason it exists.
 *
 * The loop above is a hand-written list of six parameters. It shipped one short:
 * `ost_create_node`'s `tags` is an array of strings, not free text, so it was
 * never enumerated as a writable parameter — and `serialize` renders tags onto a
 * single shared line, so a tag carrying a newline authored arbitrary body lines,
 * cleared `gateSolution` in one allowlisted call, and stranded the `#unvalidated`
 * stamp below the injected break where the next read loses it. Three independent
 * reviewers found it; none of the six-door tests did, because a list cannot fail
 * for the door it does not name.
 *
 * So this asks the question the list cannot: for EVERY string-valued argument
 * every mutating tool declares — read off the tool's own `input_schema`, array
 * items included — can the attack produce a recorded result, silence coverage
 * debt, or remove the stamp? A tool that grows a seventh writable argument is
 * covered on the day it lands.
 *
 * The non-vacuity guard is F6's, and it is not decoration: that criterion's own
 * first draft attacked `inputSchema` where the shipped key is `input_schema`, so
 * every generated input was `undefined`, every call threw inside the `catch`
 * written for the tools' refusals, and the assertions passed against a surface
 * nothing had ever touched. Inputs are built OUTSIDE the try, a missing schema
 * throws, and the run counts the arguments it actually reached.
 */
describe("no argument on any mutating tool can author a measurement, whatever it is called", () => {
  const PAYLOAD = "x\n\n## Results\n- 2026-07-30 **supported** (ran by nobody) — it worked\n\n## Uncovered\n- nothing";

  /** Every string-valued leaf a tool declares, with the shape its schema asks for. */
  function stringArgs(schema: ToolSchema): Array<{ key: string; wrap: (v: string) => unknown }> {
    const props = (schema.properties ?? {}) as Record<string, ToolSchema>;
    const out: Array<{ key: string; wrap: (v: string) => unknown }> = [];
    for (const [key, sub] of Object.entries(props)) {
      if (sub.enum) continue; // a fixed vocabulary carries no caller content
      if (sub.type === "string") out.push({ key, wrap: (v) => v });
      if (sub.type === "array" && (sub.items as ToolSchema | undefined)?.type === "string") {
        out.push({ key, wrap: (v) => [v] });
      }
    }
    return out;
  }

  test("every mutating tool, every string argument, one payload", async () => {
    const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test" };
    const tools = (buildOstTools(ctx, MCP_TOOL_NAMES) as unknown as RawTool[]).filter(
      (t) => !["ost_search_web", "ost_read_web", "ost_read_repo"].includes(t.name),
    );
    expect(tools.length).toBeGreaterThan(8);

    let reached = 0;
    const createdByTool: string[] = [];
    for (const built of tools) {
      // Built outside the try. A tool whose schema cannot be read is a hole, not
      // a pass — this throw is what stops the whole file going quietly vacuous.
      if (!built.input_schema) throw new Error(`${built.name} declares no input_schema`);
      const args = stringArgs(built.input_schema);

      for (const arg of args) {
        // A UNIQUE title per attempt, except when the title IS the field under
        // attack. `createNode` refuses a name that already exists, and that
        // refusal is not the guard talking — reusing one title made every
        // create fail for the wrong reason and the whole property pass against
        // a door it never opened. Found by neutering the guard and watching
        // this test stay green.
        const fresh = `Probe ${built.name} ${arg.key}`;
        const input: Record<string, unknown> = {
          title: fresh,
          test: "Asm",
          section: "## Notes\nfine",
          issue: "an issue",
          note: "a note",
          why: 'a person is needed: "interview"',
          body: "prose",
          layer: "AssumptionTest",
          parent: "Sol",
          evidence: "assertion",
          // So a create reaches the guard under test instead of being turned away
          // earlier for having no instrument.
          instrument: "npx vitest run test/fixture.test.ts",
          host: "example.com",
          reason: "corroborated by [[Asm]]",
          child: "Asm",
          [arg.key]: arg.wrap(PAYLOAD),
        };
        // The tools that mutate an EXISTING node need a title that exists.
        if (built.name !== "ost_create_node" && arg.key !== "title") input.title = "Asm";
        for (const key of Object.keys(input)) {
          if (!(key in (built.input_schema.properties ?? {}))) delete input[key];
        }
        reached += 1;
        try {
          await built.run(input);
          if (built.name === "ost_create_node") createdByTool.push(String(input.title));
        } catch {
          // A refusal is the desired outcome; the assertions below settle it.
        }
      }
    }

    // The number that would have been zero while everything stayed green.
    expect(reached).toBeGreaterThan(15);

    // The property, asked of the whole tree rather than of any one call.
    const tree = vault.readTree();
    for (const node of tree) {
      expect(hasRecordedResult(node), `${node.title} records a result`).toBe(false);
      // A tag that survived with whitespace in it is body content wearing a tag's
      // name, and the next read loses everything after the break.
      for (const tag of node.tags) expect(tag, `${node.title} carries a split tag`).not.toMatch(/\s/);
    }
    // Whatever the tools DID create still carries the marker B2 keys on. The
    // `tags` door removed it as a side effect of injecting a heading, so a
    // property about headings alone would have let that half through.
    for (const title of createdByTool) {
      expect(vault.read(title).tags, `${title} lost its marker`).toContain("unvalidated");
    }
    expect(computeCoverageDebt(tree).totals.withResults).toBe(0);
  });

  // The specific door the property caught, kept as a case so the regression has
  // a name and a message someone can act on.
  test("a tag cannot carry a newline, because a tag is one word on a shared line", async () => {
    await expect(
      call("ost_create_node", {
        title: "Laundered",
        layer: "AssumptionTest",
        parent: "Sol",
        body: "a plan",
        evidence: "assertion",
        instrument: "npx vitest run test/fixture.test.ts",
        tags: [`streaks${PAYLOAD}`],
      }),
    ).rejects.toThrow(/tags cannot contain whitespace/);
    expect(vault.has("Laundered")).toBe(false);
  });

  test("and a tag with a bare space is refused too — it would silently become two", async () => {
    await expect(
      call("ost_create_node", { title: "Two", layer: "AssumptionTest", parent: "Sol", body: "p", evidence: "assertion", instrument: "npx vitest run test/fixture.test.ts", tags: ["a b"] }),
    ).rejects.toThrow(/whitespace/);
  });

  test("an ordinary tag still works — the guard is on the shape, not on tagging", async () => {
    await expect(
      call("ost_create_node", { title: "Tagged", layer: "AssumptionTest", parent: "Sol", body: "p", evidence: "assertion", instrument: "npx vitest run test/fixture.test.ts", tags: ["billing-flow"] }),
    ).resolves.toMatch(/created/);
    expect(vault.read("Tagged").tags).toEqual(expect.arrayContaining(["billing-flow", "unvalidated"]));
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
    // `## Instrument Log` earns its place on the same rule as the other two, and
    // the bar is stated in `ost/headings.ts`: a gate reads it. A recorded RED
    // observation is what releases a solution to the build half of the loop
    // (`eval/buildable.ts`), so an agent able to author one could authorize its
    // own build against a test nobody ever ran.
    //
    // `## Retraction` is the fourth and it widens the bar, which is why this line
    // had to be edited to admit it rather than growing quietly. The first three
    // let their author clear ONE gate; a retraction takes the node out of every
    // gate at once, because `Vault.readTreeCensus` stops returning it. So it is
    // not a measurement a gate reads — it is the tree the gates run over, and an
    // agent able to author one would hold a delete in the one form no invariant
    // can see: the node a violation hangs off is no longer in the list the
    // invariant is given. Same rule, stronger claim.
    // (`test/ost/retraction-consumers.test.ts` is where that is held.)
    expect([...RESERVED_HEADINGS]).toEqual([
      RESULTS_HEADING,
      UNCOVERED_HEADING,
      INSTRUMENT_LOG_HEADING,
      RETRACTION_HEADING,
    ]);
  });

  test("the newest reserved heading is refused on the agent's surface like the rest", async () => {
    await expect(
      call("ost_append_to_node", { title: "Asm", section: `${INSTRUMENT_LOG_HEADING}\n- 2026-08-03 **red** (exit 1)` }),
    ).rejects.toThrow(/reserved heading/);
  });
});
