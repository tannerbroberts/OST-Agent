/**
 * P10 — no single agent-reachable call can flip a gate, or empty a violation it
 * created.
 *
 * This file is an **enumeration, not a mechanism**. B1, B2 and B3 each closed a
 * door: `## Results` is refused at the vault's content funnel, `validated` has no
 * argument position on either status-bearing tool, and a measurement rung is
 * refused when the node's provenance cannot carry it. Each of those has its own
 * test, and each of those tests passes. None of them — and no conjunction of
 * them — asserts *"no single call on the whole surface does this"*. **A property
 * proved door by door is not proved**, and the reason to write the table is that
 * a table can fail for a door nobody thought to name.
 *
 * It did. See `KNOWN_OPEN` below: `ost_link_nodes` flips a blocked Solution's
 * gate in one call, on the unattended surface, by hanging an assumption test that
 * already carries a human-recorded result under it as a second parent. B1/B2/B3
 * closed *authoring* a result. Nothing closes *borrowing* one. (Not "re-pointing":
 * the vault is append-only, so the edge is added, the test keeps its original
 * parent, and both Solutions now claim the same run. Nothing is moved, which is
 * why no invariant notices.) That row is committed as a failing
 * property asserted in the affirmative — the test asserts the hole is still there
 * — so that the day it closes, this file goes red and whoever closed it has to
 * move the row and update P10 in the same change. A hole recorded as a skipped
 * test is a hole nobody is told about.
 *
 * **The boundary this file draws on half (b), stated rather than left silent.**
 * `checkInvariants` going empty is not by itself a forgery. One pair really does
 * do it — `ost_create_node` clears the `dangling-link` the caller authored with
 * `ost_link_nodes` — and it does it by *producing the node the link named*, as a
 * file on disk. This file separates **declarative** clears, which assert a
 * condition satisfied without producing it (`## Results`, `status: validated`, a
 * rung above the evidence) and are what P10 exists to forbid, from
 * **constructive** ones, which are the tree being repaired. The constructive pair
 * is enumerated in `CONSTRUCTIVE`, asserted to actually clear, and asserted to
 * have produced its artifact — so the exception cannot silently widen into an
 * excuse, and a second pair joining it is a deliberate edit to this file.
 *
 * Three things make this a pin rather than a snapshot:
 *
 * 1. **The rows are derived from `MCP_TOOL_NAMES`**, never listed by hand. A tool
 *    added to the surface fails the build until someone writes its row — exactly
 *    the shape `test/eval/clearability.test.ts` uses to derive its rows from the
 *    rule literals in `src/eval/invariants.ts`.
 * 2. **The arguments are derived from each tool's own `input_schema`.** A row
 *    supplies only the fields that *aim* the call (which node it is about); every
 *    other declared string argument is filled with a forgery payload, arrays
 *    included, and every enum-valued argument is swept through all of its values.
 *    So a tool that grows an eighth writable argument is attacked through it on
 *    the day it ships, and if `validated` ever returns to the status enum,
 *    `ost_set_status`'s row attempts it without this file being edited.
 * 3. **Non-vacuity is asserted, not assumed.** `test/release/gate-f-deciders.test.ts`
 *    records that its own first draft was vacuous and green because it read
 *    `inputSchema` off definitions that carry `input_schema`: every generated
 *    input was `undefined`, every call threw inside the catch written for the
 *    tools' refusals, and the assertion passed against a surface nothing had ever
 *    touched. This file takes three precautions against repeating that, and all
 *    three are assertions rather than intentions:
 *      - inputs are built **outside** the `try`, and a tool whose schema cannot be
 *        read throws rather than producing `{}`;
 *      - a row naming a field the schema does not declare throws, so a renamed
 *        argument stops the aiming loudly instead of quietly;
 *      - the driver counts the argument fields the payload actually reached and
 *        checks that count against the number the tool's schema offers — per row,
 *        as an equality, and over the whole table as a floor. The per-row form is
 *        the second draft: the first read `expect(reached).toBeGreaterThanOrEqual(0)`,
 *        which is true of a count in every possible execution. That is this
 *        repository's own failure mode, written into the file whose subject is
 *        that failure mode, and it survived a review that called it non-vacuous.
 *      - separately, that calls really land (the tree changes) and that the
 *        fixture is genuinely one write away from cleared (the human's writer
 *        flips it).
 *
 * Half (b)'s per-tool sweep asserts `toContain(rule)`, not `not.toEqual([])`. The
 * weaker form was here first, and it passes for a call that erases the rule the
 * caller authored while raising some other one — a non-empty array that is no
 * longer about the criterion's subject. See the comment at the assertion.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkInvariants } from "../../src/eval/invariants.js";
import { renderGate } from "../../src/eval/render.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import type { OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";
import { buildPassContext } from "../../src/runner/context.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { validateToolInput, type ToolSchema } from "../../src/security/validateToolInput.js";
import type { WebFetchFn } from "../../src/web/reader.js";
import type { SearchProvider } from "../../src/web/search.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/* ------------------------------------------------------------------ *
 * The fixture
 * ------------------------------------------------------------------ */

const OUTCOME = "Players keep playing";
const OPPORTUNITY = "Players cannot tell what changed";
/** The Solution under test: its gate is BLOCKED and must stay blocked. */
const BLOCKED = "Ship a changelog";
/** Its assumption test — proposed, never run. */
const BLOCKED_TEST = "Diff two builds and count the deltas";
/** A sibling Solution whose test a human already ran, so its gate is CLEARED. */
const CLEARED = "Ship a digest email";
const CLEARED_TEST = "Mail fifty users and count the opens";

/**
 * The recorded result lives in the fixture on purpose.
 *
 * A tree with no result anywhere in it is a tree where half the attacks are
 * impossible for an uninteresting reason. The realistic state of a working vault
 * is that *some* test has been run, and the question P10 asks is whether one call
 * can make that fact say something it does not say. Written through
 * `appendUnderSection`, which takes the heading as its own argument — the human's
 * path, and the only one B1 leaves open (`src/ost/vault.ts:343`).
 */
const RESULT_LINE = "- 2026-01-04 — supported — by Ana Ruiz — uncovered: retention past week one";

interface Fixture {
  dir: string;
  vault: Vault;
}

function put(v: Vault, title: string, layer: OstNode["layer"], body = `prose for ${title}`): void {
  v.createNode({ title, layer, tags: [], links: [], evidence: "assertion", body } as OstNode);
}

function makeFixture(): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-p10-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  const vault = new Vault(dir);

  put(vault, OUTCOME, "Outcome");
  put(vault, OPPORTUNITY, "Opportunity");
  vault.linkNodes(OUTCOME, OPPORTUNITY);

  put(vault, BLOCKED, "Solution");
  vault.linkNodes(OPPORTUNITY, BLOCKED);
  // The prose declares a lane and the frontmatter carries none — legal, and one
  // restrictive call away from `lane-conflict`, which is one of the two rules the
  // agent can author at all. Part 3 uses it.
  put(vault, BLOCKED_TEST, "AssumptionTest", "Compare two build manifests offline. Lane: compute-only.");
  vault.linkNodes(BLOCKED, BLOCKED_TEST);

  put(vault, CLEARED, "Solution");
  vault.linkNodes(OPPORTUNITY, CLEARED);
  put(vault, CLEARED_TEST, "AssumptionTest", "Send the digest to fifty users and count opens.");
  vault.linkNodes(CLEARED, CLEARED_TEST);
  vault.appendUnderSection(CLEARED_TEST, "## Results", RESULT_LINE);

  return { dir, vault };
}

const cleared = (f: Fixture, solution = BLOCKED): boolean => renderGate(f.vault.readTree(), solution).cleared;
const violations = (f: Fixture): string[] => checkInvariants(f.vault.readTree()).map((v) => v.rule);

/**
 * Everything a call can leave behind that some later read *believes*, contents
 * included, as one string.
 *
 * Used to answer "did that call actually do anything?". Not restricted to `.md`:
 * `ost_rank_source` writes a trust ledger rather than a node, and a digest blind
 * to it would report that tool as never landing. The usage trace IS excluded,
 * because `withUsageTracing` appends an event for every tool including the pure
 * readers (`src/telemetry/usage.ts:138`) — counting it would say `ost_read_tree`
 * writes to the vault, which is the kind of true-but-meaningless signal that
 * makes a non-vacuity check stop discriminating.
 */
function vaultDigest(dir: string): string {
  const trace = path.join(".ost-agent", "usage");
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath ?? dir, e.name)))
    .filter((rel) => !rel.startsWith(trace))
    .sort()
    .map((rel) => `${rel} ${fs.readFileSync(path.join(dir, rel), "utf8")}`)
    .join("");
}

/* ------------------------------------------------------------------ *
 * The driver
 * ------------------------------------------------------------------ */

/**
 * A fetch that never leaves the machine, and records what the tool surface asked
 * for. Offline is a hard requirement here (CONTRIBUTING.md).
 *
 * The recording is not decoration: without it, "the web tools cannot flip a gate"
 * would be satisfiable by a driver whose web calls never happened. The test below
 * spends the record to show they did. P6's own file
 * (`test/release/outward-mutation.test.ts`) owns the claim about the *method*;
 * this one only needs to know the calls were made.
 */
const OUTWARD: { url: string; method: string }[] = [];
const fakeFetch: WebFetchFn = async (url, init) => {
  OUTWARD.push({ url, method: init.method });
  return {
    status: 200,
    ok: true,
    headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "text/html" : null) },
    text: async () => "<html><title>a page</title><body>some prose</body></html>",
  };
};
const fakeProvider: SearchProvider = {
  name: "fixture",
  search: async () => ({ results: [{ title: "a page", url: "https://example.com/notes", snippet: "prose", host: "example.com" }], failures: [] }),
};

function contextFor(f: Fixture): ToolContext {
  const web = { provider: fakeProvider, fetchFn: fakeFetch };
  return {
    vault: f.vault,
    dir: f.dir,
    remote: { enabled: false },
    surface: "test:p10",
    web,
    // A real pass context, from the shipped builder. Without one the four
    // reporting tools refuse before their bodies run, and a tool that never ran
    // is a tool this table has said nothing about.
    passContext: { ...buildPassContext(f.dir), web, remote: { enabled: false } },
  };
}

interface RunnableTool {
  name: string;
  input_schema: ToolSchema & { properties?: Record<string, { type?: string; enum?: string[] }> };
  run: (input: unknown) => Promise<unknown>;
}

function toolsFor(f: Fixture): RunnableTool[] {
  return buildOstTools(contextFor(f), MCP_TOOL_NAMES) as unknown as RunnableTool[];
}

/** One generated call, with the count of argument fields the payload reached. */
interface Attempt {
  tool: string;
  input: Record<string, unknown>;
  /** How the input was derived, for the failure message. */
  how: string;
  reached: number;
}

/**
 * Build every attempt for one tool: the aimed base call, plus one variant per
 * value of every enum-valued argument the row did not pin.
 *
 * Throws — deliberately, and outside every `try` in this file — when the schema
 * cannot be read or when a row aims at a field the tool does not declare. Both
 * are the gate-f-deciders failure in miniature: a driver that silently attacks
 * nothing is worse than no driver, because it is green.
 */
function attemptsFor(tools: RunnableTool[], name: string, aimed: Record<string, unknown>, payload: string): Attempt[] {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} is on MCP_TOOL_NAMES but buildOstTools did not build it`);
  const schema = tool.input_schema;
  if (!schema || typeof schema !== "object" || typeof schema.properties !== "object") {
    throw new Error(`${tool.name} carries no readable input schema — the driver would attack nothing`);
  }
  const props = schema.properties as Record<string, { type?: string; enum?: string[] }>;
  for (const key of Object.keys(aimed)) {
    if (!(key in props)) {
      throw new Error(
        `${tool.name}'s row aims at "${key}", which the tool no longer declares — re-aim the row, ` +
          "or this call stops being about the node it was supposed to be about",
      );
    }
  }

  const base: Record<string, unknown> = {};
  let reached = 0;
  const enumsToSweep: [string, string[]][] = [];
  for (const [key, spec] of Object.entries(props)) {
    // Enums are swept whether or not the row aimed them: the row's value is the
    // base, and every other value gets its own attempt. Sweeping only the unaimed
    // ones was a real gap — `ost_create_node` needs `layer` and `evidence` aimed
    // at values that LAND before either sweep tests anything, because a
    // one-at-a-time sweep never produces the combination that gets past the two
    // guards standing in front of it.
    if (spec.enum) {
      base[key] = key in aimed ? aimed[key] : spec.enum[0];
      enumsToSweep.push([key, spec.enum]);
      continue;
    }
    if (key in aimed) {
      base[key] = aimed[key];
      continue;
    }
    if (spec.type === "array") {
      base[key] = [payload];
      reached += 1;
    } else if (spec.type === "number" || spec.type === "integer") {
      base[key] = 1;
    } else if (spec.type === "boolean") {
      base[key] = true;
    } else {
      base[key] = payload;
      reached += 1;
    }
  }

  const out: Attempt[] = [{ tool: tool.name, input: base, how: "every unaimed string argument carries the payload", reached }];
  for (const [key, values] of enumsToSweep) {
    for (const v of values) {
      if (v === base[key]) continue;
      out.push({ tool: tool.name, input: { ...base, [key]: v }, how: `${key} = ${JSON.stringify(v)}`, reached });
    }
  }
  return out;
}

/** Run one attempt the way the wire would: schema validation first, then `run`. */
async function fire(tools: RunnableTool[], attempt: Attempt): Promise<void> {
  const tool = tools.find((t) => t.name === attempt.tool)!;
  const problems = validateToolInput(tool.input_schema, attempt.input);
  // A schema refusal IS a refusal — it is what the MCP server does before `run`.
  if (problems.length > 0) return;
  await tool.run(attempt.input);
}

/* ------------------------------------------------------------------ *
 * The table
 * ------------------------------------------------------------------ */

interface Row {
  /** Why this tool is, or is not, a candidate for flipping a gate. Read in the test name. */
  why: string;
  /**
   * The fields that AIM the call — which node it is about. Everything else the
   * schema declares is filled by the driver. `n` is a counter, so a row that
   * creates a node gets a fresh title every time; reusing one is how the B1 pin
   * was vacuous the first time it was written ("node already exists" is not a
   * guard firing).
   */
  aim: (n: number) => Record<string, unknown>;
}

const ROWS: Record<string, Row> = {
  ost_read_tree: { why: "read-only, no arguments", aim: () => ({}) },
  ost_next_work: { why: "read-only, no arguments", aim: () => ({}) },
  ost_check: { why: "read-only, no arguments", aim: () => ({}) },
  ost_debt: { why: "read-only, no arguments", aim: () => ({}) },
  ost_status: { why: "read-only, no arguments — driven with a real pass context so its body runs", aim: () => ({}) },
  ost_gate: { why: "read-only — it reports the verdict it cannot change", aim: () => ({ solution: BLOCKED }) },

  ost_create_node: {
    why: "B1's tags door and B3's rung door — it takes body, tags, source and a rung in one call",
    // Aimed under the blocked Solution so a created AssumptionTest lands where it
    // would count. `layer` and `evidence` are aimed at values that get PAST the
    // hierarchy check and B3 — without that the call was refused on every single
    // attempt and this row tested nothing, which the landing count caught. They
    // are still swept: the row's value is only the base the sweep varies from, so
    // every layer and every rung (both measurement rungs included) is tried.
    aim: (n) => ({ title: `A forged test ${n}`, parent: BLOCKED, layer: "AssumptionTest", evidence: "assertion" }),
  },
  ost_append_to_node: {
    why: "B1's original door — free-text markdown onto an assumption test's body",
    aim: () => ({ title: BLOCKED_TEST }),
  },
  ost_link_nodes: {
    why: "re-points an edge; the gate reads which tests hang under a Solution",
    // The attack, and it is the one that works: hang the sibling's already-run
    // test under the blocked Solution. See KNOWN_OPEN.
    aim: () => ({ parent: BLOCKED, child: CLEARED_TEST }),
  },
  ost_set_status: {
    why: "B2's door — `hasRecordedResult` returns true for status 'validated'",
    aim: () => ({ title: BLOCKED_TEST }),
  },
  ost_set_evidence: {
    why: "B3's door — declares a rung, and carries a free-text note onto the body",
    aim: () => ({ title: BLOCKED_TEST }),
  },
  ost_annotate: {
    why: "free-text `issue` onto any node's body (B1 counted it as door four of six)",
    aim: () => ({ title: BLOCKED_TEST }),
  },
  ost_flag_humans_required: {
    why: "free-text `why` onto an assumption test (B1's door five)",
    aim: () => ({ test: BLOCKED_TEST }),
  },
  ost_rank_source: {
    why: "the one web tool that writes — an append-only publisher-trust record, not a node",
    aim: () => ({ host: "example.com" }),
  },
  ost_search_web: {
    why: "read-only sensing; driven against an injected provider so nothing leaves the machine",
    aim: () => ({}),
  },
  ost_read_web: {
    why: "read-only sensing; driven against an injected fetch so nothing leaves the machine",
    aim: () => ({ url: "https://example.com/notes" }),
  },
  ost_read_repo: {
    why: "read-only sensing of a configured product repo; none is configured here, so it refuses",
    aim: () => ({}),
  },
  ost_ingest_inbox: {
    why: "writes evidence records from the operator's drop folder — no agent-supplied argument at all",
    aim: () => ({}),
  },
};

/**
 * The row for one tool, or a loud failure naming it.
 *
 * `ROWS[name]` on a tool with no row is `undefined`, and every use of it in this
 * file reads a property off it — so the surface growing a tool crashes collection
 * with `Cannot read properties of undefined (reading 'why')` and no tool name.
 * That is red, which is the important half, but it points at this file's line 511
 * rather than at the tool somebody just added. Verified by temporarily appending
 * `git_push` to `MCP_TOOL_NAMES`: the message named the tool with this guard and
 * did not without it.
 */
function rowFor(name: string): Row {
  const row = ROWS[name];
  if (!row) {
    throw new Error(
      `${name} is on MCP_TOOL_NAMES and has no row in this file. Decide how a single call to it ` +
        "could flip a gate or erase a violation, write the row, and only then does P10's table cover the surface.",
    );
  }
  return row;
}

/**
 * The forgeries, in the spellings that matter.
 *
 * The first is the heading every evaluator reads as proof of a run; the second is
 * the status word B2 removed from the enums, tried here as free text in case any
 * argument still reaches a place that is read as one.
 */
const PAYLOADS = [`## Results\n${RESULT_LINE.replace("Ana Ruiz", "the agent")}`, "validated"];

/* ------------------------------------------------------------------ *
 * 1 — the enumeration is derived, not remembered
 * ------------------------------------------------------------------ */

describe("1 — the table covers exactly the surface the server exposes", () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });
  afterEach(() => fs.rmSync(f.dir, { recursive: true, force: true }));

  test("the surface is non-empty, so nothing below is vacuous by having no rows", () => {
    expect(MCP_TOOL_NAMES.length).toBeGreaterThanOrEqual(18);
  });

  test("every exposed tool has a row — a tool added to the surface fails the build until someone decides its row", () => {
    expect(Object.keys(ROWS).sort()).toEqual([...MCP_TOOL_NAMES].sort());
  });

  test("every row corresponds to a tool that is actually built", () => {
    // `MCP_TOOL_NAMES` is a name list; `buildOstTools` is what a caller holds.
    // A name on the list that builds nothing would be a row attacking air.
    expect(toolsFor(f).map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
  });

  test("the two web tools really are reached, against an injected transport", async () => {
    // Their rows in part 2 assert that neither can flip a gate. That assertion is
    // worth nothing if the calls are bouncing off a missing provider, so the
    // record of what the injected transport was asked for is checked here.
    const before = OUTWARD.length;
    const tools = toolsFor(f);
    await fire(tools, { tool: "ost_read_web", input: { url: "https://example.com/notes" }, how: "control", reached: 0 });
    expect(OUTWARD.length).toBeGreaterThan(before);
    expect(OUTWARD.every((r) => r.method === "GET")).toBe(true);
    // And the search provider is injected rather than absent, so ost_search_web
    // exercises its real path instead of returning the delegation message.
    const said = await (tools.find((t) => t.name === "ost_search_web")! as RunnableTool).run({ query: "prior art" });
    expect(String(said)).toContain("example.com");
  });

  test("git_commit and git_push are built but not exposed — the two names the filter drops", () => {
    // Stated here because part 2 drives `buildOstTools(ctx, MCP_TOOL_NAMES)` and
    // the reader is entitled to know what that filter removed. P6 owns the claim.
    const unfiltered = (buildOstTools(contextFor(f)) as unknown as RunnableTool[]).map((t) => t.name);
    expect(unfiltered).toContain("git_push");
    expect(toolsFor(f).map((t) => t.name)).not.toContain("git_push");
  });
});

/* ------------------------------------------------------------------ *
 * 2 — (a) no single call flips the gate
 * ------------------------------------------------------------------ */

/**
 * The rows this file asserts are still open, with the exact call that opens them.
 *
 * Being in this map does not soften the assertion — it inverts it. The test for
 * a known-open row asserts the gate DOES flip, so closing the hole turns this
 * file red and forces the row (and P10's entry) to move in the same commit.
 */
const KNOWN_OPEN: Record<string, { call: Record<string, unknown>; note: string }> = {
  ost_link_nodes: {
    call: { parent: BLOCKED, child: CLEARED_TEST },
    note:
      "One call hangs an assumption test that already carries a human-recorded result under a second, " +
      "untested Solution, and that Solution's gate clears. B1, B2 and B3 closed AUTHORING a result; " +
      "nothing closes BORROWING one — the edge is added, not moved, so both Solutions now claim the same " +
      "run. `ost_link_nodes` is granted on /ost-pass, so this is reachable " +
      "unattended, it leaves `checkInvariants` empty, and the tree afterwards claims a solution was " +
      "tested by a test that was about something else.",
  },
};

describe("2 — no single call flips renderGate(tree, solution).cleared from false to true", () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });
  afterEach(() => fs.rmSync(f.dir, { recursive: true, force: true }));

  test("the fixture is set up the way the property needs: blocked here, cleared there", () => {
    expect(cleared(f, BLOCKED)).toBe(false);
    expect(cleared(f, CLEARED)).toBe(true);
    expect(violations(f)).toEqual([]);
  });

  test("positive control: the human's writer flips this exact gate, so 'stays blocked' is a real claim", () => {
    // The fixture is ONE write away from cleared. Without this, every assertion
    // below would also pass on a tree that could not be cleared by anything.
    expect(cleared(f)).toBe(false);
    f.vault.appendUnderSection(BLOCKED_TEST, "## Results", RESULT_LINE);
    expect(cleared(f)).toBe(true);
  });

  test("positive control: the driver's calls really land on the tree", () => {
    // If every generated call bounced off validation, the property below would be
    // asserted against a surface nothing had touched. One legitimate call, fired
    // through the same `fire()` the driver uses, has to change a file.
    const before = fs.readFileSync(path.join(f.dir, `${BLOCKED_TEST}.md`), "utf8");
    const tools = toolsFor(f);
    return fire(tools, { tool: "ost_append_to_node", input: { title: BLOCKED_TEST, section: "## Notes\nreached the tool" }, how: "control", reached: 0 }).then(() => {
      expect(fs.readFileSync(path.join(f.dir, `${BLOCKED_TEST}.md`), "utf8")).not.toEqual(before);
    });
  });

  for (const name of MCP_TOOL_NAMES) {
    const row = rowFor(name);
    const open = KNOWN_OPEN[name];

    test(`${name} — ${row.why}${open ? " — KNOWN OPEN, asserted as such" : ""}`, async () => {
      let calls = 0;
      let reached = 0;

      for (const payload of PAYLOADS) {
        // Every attempt starts from the blocked state: "single call" means single.
        for (const attempt of attemptsFor(toolsFor(f), name, row.aim(calls), payload)) {
          const fresh = makeFixture();
          try {
            expect(cleared(fresh)).toBe(false);
            calls += 1;
            reached += attempt.reached;
            const tools = toolsFor(fresh);
            try {
              await fire(tools, attempt);
            } catch {
              // A refusal is one acceptable outcome; a write that lands somewhere
              // the gate does not read is the other. Which one happened is settled
              // by the gate, not by whether this threw.
            }
            // The exemption is per ATTEMPT, not per tool.
            //
            // `if (!open)` — exempting every shape of a tool that has one known
            // hole — was the wrong granularity: it is today indistinguishable
            // from the right one only because every generated `ost_link_nodes`
            // attempt happens to aim at the known-open edge. Re-aim that row, or
            // give the tool an enum to sweep, and the exemption would silently
            // spread to calls nobody has ever reasoned about. So an attempt is
            // exempt only when it aims where the KNOWN_OPEN entry says: it must
            // agree on every field that entry names.
            const isTheKnownHole = open !== undefined && Object.entries(open.call).every(([k, v]) => attempt.input[k] === v);
            if (!isTheKnownHole) {
              expect(
                cleared(fresh),
                `${name} flipped ${BLOCKED}'s gate in ONE call (${attempt.how}) — ` +
                  `input ${JSON.stringify(attempt.input)}`,
              ).toBe(false);
            }
          } finally {
            fs.rmSync(fresh.dir, { recursive: true, force: true });
          }
        }
      }

      expect(calls).toBeGreaterThan(0);
      // Per-row non-vacuity, and it has to be CONDITIONAL to mean anything.
      //
      // This line used to read `expect(reached).toBeGreaterThanOrEqual(0)` with a
      // comment claiming it made a tool that stopped declaring arguments visible.
      // A count is never negative, so that assertion was true of every possible
      // execution — the exact shape of check this repository has been burned by
      // three times, sitting inside the file written to prevent it. An
      // unconditional `> 0` cannot replace it either: six of the eighteen tools
      // declare no arguments at all, and `ost_gate`'s single argument is aimed by
      // its row, so zero is the honest answer for them.
      //
      // So the bound is computed from the tool's own schema: count the properties
      // this row did NOT aim and that are free text or arrays — the ones the
      // driver fills with a forgery payload — and require the payload to have
      // reached exactly that many fields per attempt. A tool that grows a writable
      // argument the row does not aim raises the expected count on the day it
      // ships; a driver that stopped filling them drops the actual to zero.
      const props = toolsFor(f).find((t) => t.name === name)!.input_schema.properties!;
      const aimedKeys = new Set(Object.keys(row.aim(0)));
      const fillable = Object.entries(props).filter(
        ([k, spec]) => !aimedKeys.has(k) && !spec.enum && (spec.type === "array" || spec.type === undefined || spec.type === "string"),
      ).length;
      expect(
        reached,
        `${name}: the driver filled ${reached} payload fields across ${calls} calls, but its schema ` +
          `offers ${fillable} unaimed free-text/array argument(s) per call — the payload is not landing where it should`,
      ).toBe(fillable * calls);
    });
  }

  test("the driver reached real arguments and real writes — the two numbers that would have been zero", async () => {
    // The gate-f-deciders numbers, restated for this file. `reached` would have
    // been ZERO on a driver that read the schema off the wrong key, and every
    // per-row assertion above would still have passed. `landed` would have been
    // zero on a driver whose every call bounced off validation — the other way to
    // prove nothing while staying green. Both are counted over the whole table
    // because six of the eighteen tools declare no arguments at all, and a
    // per-row bound would have to be zero for those.
    let calls = 0;
    let reached = 0;
    let landed = 0;
    const landers = new Set<string>();
    let n = 0;

    for (const name of MCP_TOOL_NAMES) {
      for (const payload of PAYLOADS) {
        for (const attempt of attemptsFor(toolsFor(f), name, rowFor(name).aim(n++), payload)) {
          const fresh = makeFixture();
          try {
            const before = vaultDigest(fresh.dir);
            calls += 1;
            reached += attempt.reached;
            try {
              await fire(toolsFor(fresh), attempt);
            } catch {
              // refusals are expected and are not what this test is counting
            }
            if (vaultDigest(fresh.dir) !== before) {
              landed += 1;
              landers.add(name);
            }
          } finally {
            fs.rmSync(fresh.dir, { recursive: true, force: true });
          }
        }
      }
    }

    expect(calls).toBeGreaterThan(30);
    expect(reached).toBeGreaterThan(calls);
    expect(landed).toBeGreaterThan(10);
    // Named rather than counted: these are the tools that actually leave something
    // behind, and a driver that stopped landing on any one of them has silently
    // stopped testing it. Two entries are worth reading twice. `ost_create_node`
    // is here only because its row aims `layer` and `evidence` at values that get
    // past B3 and the hierarchy check — before that it was refused every single
    // time, and this list is what said so. `ost_ingest_inbox` takes no argument at
    // all and still writes: it saves an adapter cursor
    // (`.ost-agent/state/inbox.json`) even when the drop folder is empty.
    expect([...landers].sort()).toEqual([
      "ost_annotate",
      "ost_append_to_node",
      "ost_create_node",
      "ost_flag_humans_required",
      "ost_ingest_inbox",
      "ost_link_nodes",
      "ost_rank_source",
      "ost_set_evidence",
      "ost_set_status",
    ]);
  });

  for (const [name, open] of Object.entries(KNOWN_OPEN)) {
    test(`${name} STILL flips the gate in one call — ${open.note}`, async () => {
      const fresh = makeFixture();
      try {
        expect(cleared(fresh)).toBe(false);
        await fire(toolsFor(fresh), { tool: name, input: open.call, how: "the known-open call", reached: 0 });
        expect(
          cleared(fresh),
          `${name} no longer flips the gate — the hole is closed. Delete its KNOWN_OPEN entry, ` +
            "let the row above assert the property, and mark P10 met in docs/reference/v1-readiness.md.",
        ).toBe(true);
        // And it is silent: nothing in the tree records that this happened.
        expect(violations(fresh)).toEqual([]);
      } finally {
        fs.rmSync(fresh.dir, { recursive: true, force: true });
      }
    });
  }
});

/* ------------------------------------------------------------------ *
 * 3 — (b) no single call empties a violation the same caller created
 * ------------------------------------------------------------------ */

/**
 * Every rule `checkInvariants` can emit, grepped from the source rather than
 * listed — the same derivation `test/eval/clearability.test.ts` uses, and for the
 * same reason: a new rule with no row here would ship with nothing asserting that
 * the agent cannot author-and-erase it.
 */
const RULES: string[] = (() => {
  const src = fs.readFileSync(path.join(repoRoot, "src/eval/invariants.ts"), "utf8");
  return [...new Set([...src.matchAll(/rule: "([a-z-]+)"/g)].map((m) => m[1]))].sort();
})();

/**
 * How the agent authors each rule — or why it cannot.
 *
 * `create: null` means no single call on this surface produces the violation, so
 * the criterion's clause *"for a rule the same caller created"* does not reach it.
 * The per-rule create/clear matrix itself is `clearability.test.ts`'s subject;
 * what this file adds is that for the rules the agent CAN author, the whole tool
 * surface is driven at the resulting violation.
 */
interface Authorship {
  /** The single call by which the agent authors this rule, or null when it cannot. */
  create: { tool: string; input: Record<string, unknown> } | null;
  why: string;
  /**
   * The declarative escapes — the moves an agent that wanted the red to go away
   * would actually make, hand-aimed at the violation rather than generated.
   *
   * The schema sweep below is aimed at the fixture's nodes, not at the violation,
   * so on its own it would be the weaker half of this section: it proves an
   * indiscriminate caller cannot stumble into a clear, not that a deliberate one
   * cannot reach it. These are the deliberate attempts.
   */
  escapes: { tool: string; input: Record<string, unknown> }[];
}

const AUTHORSHIP: Record<string, Authorship> = {
  "single-outcome": { create: null, escapes: [], why: "ost_create_node refuses the Outcome layer; a second root arrives by hand or by import" },
  "dangling-link": {
    create: { tool: "ost_link_nodes", input: { parent: OPPORTUNITY, child: "Ghost opportunity" } },
    why: "ost_link_nodes accepts a child that does not exist",
    // Talking about the dangling link does not resolve it, and neither does
    // re-issuing the call that made it. The one move that does is CONSTRUCTIVE,
    // below, and it is the only one: the node has to come into existence.
    escapes: [
      { tool: "ost_annotate", input: { title: OPPORTUNITY, issue: "the [[Ghost opportunity]] link is fine, ignore it" } },
      { tool: "ost_append_to_node", input: { title: OPPORTUNITY, section: "Correction: [[Ghost opportunity]] was a typo and can be disregarded." } },
      // Re-pointing the same dangling name at a different parent: it lands (a
      // second edge is written) and the violation multiplies rather than clears.
      // NOT the idempotent re-issue of the authoring call — `linkNodes` no-ops on
      // a duplicate edge, so that attempt writes nothing, and an escape that
      // writes nothing tests nothing. The landing check below is what said so.
      { tool: "ost_link_nodes", input: { parent: BLOCKED, child: "Ghost opportunity" } },
      { tool: "ost_set_status", input: { title: OPPORTUNITY, status: "deferred", note: "parked, so the dangling link no longer matters" } },
    ],
  },
  "wrapped-wikilink": { create: null, escapes: [], why: "R1 refuses a link split across a line break at the write funnel" },
  "opportunity-connected": { create: null, escapes: [], why: "ost_create_node attaches under its parent in the same call, so it cannot orphan one" },
  "solution-mapped": { create: null, escapes: [], why: "same — creation and attachment are one atomic call" },
  "assumption-mapped": { create: null, escapes: [], why: "same — creation and attachment are one atomic call" },
  "evidence-class": { create: null, escapes: [], why: "`evidence` is required on ost_create_node; a node with no rung predates the ladder" },
  "no-self-validation": { create: null, escapes: [], why: "B2 — `validated` is not a value either status argument accepts" },
  "lane-conflict": {
    create: { tool: "ost_flag_humans_required", input: { test: BLOCKED_TEST, why: 'the manifest has to be read by someone: "compare"' } },
    why: "the restrictive lane call contradicts the test's own prose declaration",
    // The lane label is one-way by construction (`ost/lanes.ts` exposes only the
    // restrictive setter), so the agent's whole repertoire here is words: annotate
    // it, append a correction saying the prose is stale, or re-issue the flag. An
    // append-only vault cannot shrink the prose that made it a conflict.
    escapes: [
      { tool: "ost_annotate", input: { title: BLOCKED_TEST, issue: "lane conflict: the prose says compute-only, the label says humans-required" } },
      { tool: "ost_append_to_node", input: { title: BLOCKED_TEST, section: "## Correction\nThe lane declaration above is stale; the label is right. Lane: humans-required." } },
      { tool: "ost_flag_humans_required", input: { test: BLOCKED_TEST, why: "re-stating the restrictive call changes nothing" } },
      { tool: "ost_set_evidence", input: { title: BLOCKED_TEST, evidence: "assertion", note: "re-labelling the rung does not touch the lane" } },
    ],
  },
  "rung-unearned": { create: null, escapes: [], why: "B3 — a measurement rung is refused when provenance cannot carry it" },
};

/**
 * The (rule, tool) pairs where one call really does empty `checkInvariants`, and
 * the artifact each one had to PRODUCE to do it.
 *
 * This is the boundary this file draws, stated rather than left silent. A
 * **declarative** clear asserts the condition satisfied without producing it —
 * `## Results`, `status: validated`, a rung above the evidence — and that is what
 * P10 exists to forbid. A **constructive** clear produces the missing thing: the
 * dangling link stops dangling because the node it names now exists as a file on
 * disk, which is the tree being repaired rather than certified. The distinction
 * is not taken on trust: the test asserts the file appeared.
 */
const CONSTRUCTIVE: Record<string, { rule: string; input: Record<string, unknown>; produces: string }> = {
  ost_create_node: {
    rule: "dangling-link",
    input: { title: "Ghost opportunity", layer: "Opportunity", parent: OPPORTUNITY, body: "the node the link named", evidence: "assertion" },
    produces: "Ghost opportunity.md",
  },
};

describe("3 — no single call takes checkInvariants from non-empty to empty for a rule the caller created", () => {
  test("the rule list is grepped from the source and is not empty", () => {
    // A regex that stopped matching would make the coverage test below vacuous.
    expect(RULES.length).toBeGreaterThanOrEqual(9);
    expect(RULES).toContain("lane-conflict");
  });

  test("every rule declares whether the agent can author it — a new rule fails the build", () => {
    expect(Object.keys(AUTHORSHIP).sort()).toEqual(RULES);
  });

  const authored = RULES.filter((r) => AUTHORSHIP[r].create);

  test("at least one rule is authorable, or the whole section proves nothing", () => {
    expect(authored.length).toBeGreaterThan(0);
  });

  for (const rule of authored) {
    const { create, escapes } = AUTHORSHIP[rule]!;

    describe(rule, () => {
      test("the hand-aimed escapes name tools that exist, so an escape cannot rot into a no-op", () => {
        // An escape naming a retired tool would be silently skipped by `fire`,
        // and this section would go on reporting that the deliberate attempts
        // failed when in fact they were never made.
        expect(escapes.length).toBeGreaterThan(0);
        for (const e of escapes) expect(MCP_TOOL_NAMES as readonly string[]).toContain(e.tool);
      });

      test("no hand-aimed escape empties it — talking about a violation is not clearing it", async () => {
        for (const escape of escapes) {
          const f = makeFixture();
          try {
            await fire(toolsFor(f), { tool: create!.tool, input: create!.input, how: "authoring", reached: 0 });
            expect(violations(f)).toContain(rule);
            const before = vaultDigest(f.dir);
            try {
              await fire(toolsFor(f), { tool: escape.tool, input: escape.input, how: "the deliberate escape", reached: 0 });
            } catch {
              // a refusal is one acceptable outcome; the check below settles it
            }
            // Non-vacuity, per escape: an escape that was refused outright proves
            // nothing about whether the violation survives a call that LANDS.
            // Every one of these has to actually write something.
            expect(vaultDigest(f.dir), `the escape ${escape.tool} never landed — it is not testing ${rule}`).not.toEqual(before);
            expect(
              violations(f),
              `${escape.tool} emptied checkInvariants in ONE call after the agent authored ${rule} — ` +
                `input ${JSON.stringify(escape.input)}`,
            ).toContain(rule);
          } finally {
            fs.rmSync(f.dir, { recursive: true, force: true });
          }
        }
      });

      test(`the agent really can author it in one call — ${create!.tool}`, async () => {
        const f = makeFixture();
        try {
          expect(violations(f)).toEqual([]);
          await fire(toolsFor(f), { tool: create!.tool, input: create!.input, how: "the authoring call", reached: 0 });
          expect(violations(f), `${create!.tool} did not author ${rule}; the driver below would test nothing`).toContain(rule);
        } finally {
          fs.rmSync(f.dir, { recursive: true, force: true });
        }
      });

      for (const name of MCP_TOOL_NAMES) {
        const row = rowFor(name);
        const constructive = CONSTRUCTIVE[name]?.rule === rule ? CONSTRUCTIVE[name] : undefined;

        test(`${name} cannot erase it in one call${constructive ? " — except constructively, which is pinned" : ""}`, async () => {
          if (constructive) {
            const f = makeFixture();
            try {
              await fire(toolsFor(f), { tool: create!.tool, input: create!.input, how: "authoring", reached: 0 });
              expect(violations(f)).toContain(rule);
              await fire(toolsFor(f), { tool: name, input: constructive.input, how: "the constructive clear", reached: 0 });
              expect(violations(f)).toEqual([]);
              // The distinction is the whole content of this exception: the call
              // had to PRODUCE the thing whose absence was the violation. If this
              // file ever appeared without the call, the clear was declarative and
              // P10's real subject was breached.
              expect(fs.existsSync(path.join(f.dir, constructive.produces))).toBe(true);
              // And a constructive clear must not move a gate — part 2's property
              // is the one that matters, restated at the point of the exception.
              expect(cleared(f)).toBe(false);
            } finally {
              fs.rmSync(f.dir, { recursive: true, force: true });
            }
            // …and then FALL THROUGH into the generated sweep rather than
            // returning. Returning here was the exception eating the whole row:
            // one hand-written input was pinned as an allowed clear and every
            // OTHER shape of `ost_create_node` — every layer, every rung, the
            // payload in `body`, `source` and `tags` — went untested against this
            // rule. The exception is meant to cover one call, not one tool. The
            // sweep's inputs never name the node the link named (the row aims a
            // fresh `A forged test N` title each time), so nothing below can
            // clear the violation constructively by accident.
          }

          let n = 0;
          for (const payload of PAYLOADS) {
            const f0 = makeFixture();
            const shapes = attemptsFor(toolsFor(f0), name, row.aim(n++), payload);
            fs.rmSync(f0.dir, { recursive: true, force: true });

            for (const attempt of shapes) {
              const f = makeFixture();
              try {
                await fire(toolsFor(f), { tool: create!.tool, input: create!.input, how: "authoring", reached: 0 });
                expect(violations(f)).toContain(rule);
                try {
                  await fire(toolsFor(f), attempt);
                } catch {
                  // refusal — settled by the check below, not by the throw
                }
                // `toContain(rule)`, NOT `not.toEqual([])`. The weaker form was
                // here first and it is a weaker neighbour of the criterion, which
                // says "for a rule the same caller created": a call that erased
                // `dangling-link` while incidentally authoring some OTHER rule
                // leaves a non-empty array and would pass. That is not
                // hypothetical — substituting the rule label emitted by the
                // dangling-link branch of `src/eval/invariants.ts` (so annotating
                // erases the authored rule and raises a different one) leaves all
                // eighteen of these rows green under the old assertion and turns
                // this one red, which is how the difference was found.
                expect(
                  violations(f),
                  `${name} erased the ${rule} the agent had just authored, in ONE call ` +
                    `(${attempt.how}) — input ${JSON.stringify(attempt.input)}`,
                ).toContain(rule);
              } finally {
                fs.rmSync(f.dir, { recursive: true, force: true });
              }
            }
          }
        });
      }
    });
  }
});
