/**
 * The clearability table, as a build failure instead of an audit finding.
 *
 * Every rule `checkInvariants` can emit is a claim the tree makes about itself.
 * Under DEC-1 (one writer) the agent is the only actor that touches the vault, so a
 * violation the agent can *create* but cannot *clear* is not a warning — it is a
 * permanent red that only a human on a shell can retire, and a mandatory human
 * interrupt is exactly the resource an unattended system is trying to spend
 * sparingly. `docs/reference/v1-readiness.md` (R3, R9) carried that table as
 * prose, verified by hand, once. This is the table, executed.
 *
 * Three things make it a pin rather than a snapshot:
 *
 * 1. **The rows are grepped out of `src/eval/invariants.ts`**, never listed here.
 *    Adding a rule with no row fails the build until someone states, in this
 *    file, how the agent creates it and how the agent gets out of it.
 * 2. **Two surfaces, because "the agent can clear it" has two answers.** The MCP
 *    server exposes eighteen tools; `/ost-pass` — the unattended sweep — grants
 *    a subset, and under `-p --permission-mode acceptEdits` a call outside that
 *    grant is *denied, not prompted*. `evidence-class` was clearable on one
 *    surface and not the other until R4 made it a `done`-blocker and R7's grant
 *    landed in the same change; a difference like that is invisible to any check
 *    that only looks at the server.
 * 3. **The attempts run against `buildOstTools(ctx, MCP_TOOL_NAMES)`**, not bare
 *    `buildOstTools`, which also builds the `git_commit`/`git_push` pair the
 *    server never exposes — and each call goes through `validateToolInput` first,
 *    so a schema-refused call is refused here for the same reason it would be on
 *    the wire.
 *
 * **What a `false` cell means, stated precisely:** the declared attempt — the
 * move an agent would actually make — did not produce (or did not clear) the
 * violation. It is not a proof that no sequence of the eighteen tools could. A
 * negative of that strength is not available from a test, and pretending
 * otherwise would be the same self-certification this file exists to catch.
 * Where the `false` rests on a specific guard rather than on absence, the row
 * pins the refusal text, so the cell fails if the guard is removed and the call
 * starts quietly succeeding.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkInvariants } from "../../src/eval/invariants.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { Vault } from "../../src/ost/vault.js";
import type { OstNode } from "../../src/ost/node.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { validateToolInput, type ToolSchema } from "../../src/security/validateToolInput.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Every rule literal `checkInvariants` can emit, read out of the source.
 *
 * This is the R9 requirement and the reason the file cannot rot: a hand-written
 * list would let a new rule ship with no clear path and no failing test, which
 * is precisely how the nine below accumulated.
 */
const RULES: string[] = (() => {
  const src = fs.readFileSync(path.join(repoRoot, "src/eval/invariants.ts"), "utf8");
  const found = [...src.matchAll(/rule: "([a-z-]+)"/g)].map((m) => m[1]);
  return [...new Set(found)].sort();
})();

/**
 * The tools `/ost-pass` grants, parsed from the shipped command file — the
 * authority on what the unattended sweep can reach (`test/release/examples-allowlist.test.ts`
 * pins that the automation examples copy it faithfully).
 */
const PASS_TOOL_NAMES: string[] = (() => {
  const md = fs.readFileSync(path.join(repoRoot, ".claude/commands/ost-pass.md"), "utf8");
  const line = md.match(/^allowed-tools:\s*(.+)$/m);
  if (!line) throw new Error("ost-pass.md has no `allowed-tools` frontmatter line");
  return line[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((n) => n.replace(/^mcp__ost-agent__/, ""));
})();

const SURFACES = [
  { name: "mcp", granted: [...MCP_TOOL_NAMES] as string[] },
  { name: "ost-pass", granted: PASS_TOOL_NAMES },
] as const;
type SurfaceName = (typeof SURFACES)[number]["name"];

/** One tool call, exactly as the model would issue it. */
interface Attempt {
  tool: string;
  input: Record<string, unknown>;
}

/** What a surface can do to a rule: author it, and get out of it. */
interface Cell {
  create: boolean;
  clear: boolean;
}

interface Scenario {
  /** A legal tree, built without the tool surface — the state before anything goes wrong. */
  setup: (v: Vault) => void;
  /** How the agent would author the violation. Named in the test title. */
  createPath: string;
  create: Attempt[];
  /** The same violation, put there out of band: a human in Obsidian, an import, a legacy node. */
  plant: (v: Vault, dir: string) => void;
  /** How the agent would get out of it. */
  clearPath: string;
  clear: Attempt[];
  expected: Record<SurfaceName, Cell>;
  /** Pins *why* a create is refused, where a guard rather than absence is the reason. */
  createRefusal?: RegExp;
}

const OUTCOME = "Players keep playing";
const OPPORTUNITY = "Players cannot tell what changed";
const SOLUTION = "Ship a changelog";
const BELIEF = "Players would read a changelog if it existed";
const ASSUMPTION = "Diff two builds and count the deltas";

/** Direct vault writes — the fixture's way in, deliberately not the agent's. */
function put(v: Vault, node: Partial<OstNode> & { title: string; layer: OstNode["layer"] }): void {
  v.createNode({
    body: `prose for ${node.title}`,
    tags: [],
    links: [],
    evidence: "assertion",
    ...node,
  } as OstNode);
}

function outcomeOnly(v: Vault): void {
  put(v, { title: OUTCOME, layer: "Outcome" });
}

function withOpportunity(v: Vault): void {
  outcomeOnly(v);
  put(v, { title: OPPORTUNITY, layer: "Opportunity" });
  v.linkNodes(OUTCOME, OPPORTUNITY);
}

function withSolution(v: Vault): void {
  withOpportunity(v);
  put(v, { title: SOLUTION, layer: "Solution" });
  v.linkNodes(OPPORTUNITY, SOLUTION);
}

/** …and the belief beneath it, which is what an AssumptionTest attaches under. */
function withBelief(v: Vault): void {
  withSolution(v);
  put(v, { title: BELIEF, layer: "Assumption" });
  v.linkNodes(SOLUTION, BELIEF);
}

/**
 * A tree whose assumption test declares `compute-only` in its own prose and
 * carries no lane in frontmatter — legal, and one restrictive call away from a
 * contradiction.
 */
function withProseLane(v: Vault): void {
  withBelief(v);
  put(v, {
    title: ASSUMPTION,
    layer: "AssumptionTest",
    body: "Compare two build manifests offline. Lane: compute-only.",
  });
  v.linkNodes(BELIEF, ASSUMPTION);
}

const SCENARIOS: Record<string, Scenario> = {
  "single-outcome": {
    setup: outcomeOnly,
    createPath: "ost_create_node asking for a second Outcome",
    create: [
      {
        tool: "ost_create_node",
        input: { title: "A rival mandate", layer: "Outcome", parent: OUTCOME, body: "a second root", evidence: "assertion" },
      },
    ],
    // The mandate is human-set at init; a second one arrives by hand or by import.
    plant: (v) => put(v, { title: "A rival mandate", layer: "Outcome" }),
    clearPath: "deferring and annotating the duplicate — there is no delete, and no Outcome creation",
    clear: [
      { tool: "ost_set_status", input: { title: "A rival mandate", status: "deferred", note: "duplicate root" } },
      { tool: "ost_annotate", input: { title: "A rival mandate", issue: "duplicate Outcome — the tree must have exactly one" } },
    ],
    expected: { mcp: { create: false, clear: false }, "ost-pass": { create: false, clear: false } },
    createRefusal: /Outcome/,
  },

  "dangling-link": {
    setup: withOpportunity,
    createPath: "ost_link_nodes naming a child that does not exist — refused at the boundary since R6 (2026-07-30)",
    create: [{ tool: "ost_link_nodes", input: { parent: OPPORTUNITY, child: "Ghost opportunity" } }],
    // The rule stays worth computing: a human's `[[wikilink]]` typed in Obsidian,
    // an import, or a node predating the guard still writes one — which is why
    // the plant goes through the vault rather than the surface.
    plant: (v) => v.linkNodes(OPPORTUNITY, "Ghost opportunity"),
    clearPath: "ost_create_node giving the named child a file",
    clear: [
      {
        tool: "ost_create_node",
        input: {
          title: "Ghost opportunity",
          layer: "Opportunity",
          parent: OPPORTUNITY,
          body: "the node the link was pointing at",
          evidence: "assertion",
        },
      },
    ],
    expected: { mcp: { create: false, clear: true }, "ost-pass": { create: false, clear: true } },
    createRefusal: /does not exist/,
  },

  "wrapped-wikilink": {
    setup: withSolution,
    createPath: "ost_append_to_node writing a link broken across a line break",
    create: [{ tool: "ost_append_to_node", input: { title: OPPORTUNITY, section: `Related: [[Ship a\nchangelog]]` } }],
    // R1 closed the tool surface to this; a hand-wrapped paragraph in Obsidian
    // still writes one, which is why the rule stays worth computing.
    plant: (_v, dir) =>
      fs.writeFileSync(
        path.join(dir, "Hand written note.md"),
        [
          "---",
          "type: Opportunity",
          "evidence: assertion",
          "---",
          "#Opportunity #evidence/assertion",
          "",
          "Typed in Obsidian and hard-wrapped by the editor: see [[Ship a",
          "changelog]] for the shape of it.",
          "",
        ].join("\n"),
        "utf8",
      ),
    clearPath: "annotating the node and appending a correction — an append-only vault cannot shrink a body",
    clear: [
      { tool: "ost_annotate", input: { title: "Hand written note", issue: "wrapped wikilink: put [[Ship a changelog]] on one line" } },
      { tool: "ost_append_to_node", input: { title: "Hand written note", section: "Correction: the link above meant [[Ship a changelog]]." } },
    ],
    expected: { mcp: { create: false, clear: false }, "ost-pass": { create: false, clear: false } },
    createRefusal: /split across a line/,
  },

  "opportunity-connected": {
    setup: outcomeOnly,
    // The attempt that would orphan one is the ordinary create — it attaches in
    // the same call, which is the whole reason the cell is false.
    createPath: "ost_create_node, which attaches under its parent in the same call",
    create: [
      {
        tool: "ost_create_node",
        input: { title: "A fresh gap", layer: "Opportunity", parent: OUTCOME, body: "a gap", evidence: "assertion" },
      },
    ],
    plant: (v) => put(v, { title: "Adrift", layer: "Opportunity" }),
    clearPath: "ost_link_nodes attaching it under the Outcome",
    clear: [{ tool: "ost_link_nodes", input: { parent: OUTCOME, child: "Adrift" } }],
    expected: { mcp: { create: false, clear: true }, "ost-pass": { create: false, clear: true } },
  },

  "outcome-files-categories": {
    // `withSolution`, not `withOpportunity`: the violation is an edge to a
    // Solution, so the Solution has to exist or the fixture plants a dangling
    // link and trips a different rule instead.
    setup: withSolution,
    // NOT creatable, and the reason is older than this rule: `assertLinkAllowed`
    // reads CHILD_HIERARCHY, which has always said a Solution attaches under an
    // Opportunity. So the tool surface already refused the edge this rule
    // objects to — the invariant catches the ones that arrive another way (a
    // hand edit in Obsidian, a vault written before the rule), which is exactly
    // what a structural check is for and why it is worth having anyway.
    createPath: "ost_link_nodes, which refuses it — a Solution attaches under an Opportunity",
    create: [{ tool: "ost_link_nodes", input: { parent: OUTCOME, child: SOLUTION } }],
    plant: (v) => v.linkNodes(OUTCOME, SOLUTION),
    clearPath: "ost_detach_nodes removing the edge, then linking it under the opportunity it serves",
    clear: [{ tool: "ost_detach_nodes", input: { parent: OUTCOME, child: SOLUTION, why: "belongs under its opportunity" } }],
    expected: { mcp: { create: false, clear: true }, "ost-pass": { create: false, clear: true } },
  },

  "solution-mapped": {
    setup: withOpportunity,
    createPath: "ost_create_node, which attaches under its parent in the same call",
    create: [
      {
        tool: "ost_create_node",
        input: { title: "A fresh idea", layer: "Solution", parent: OPPORTUNITY, body: "an idea", evidence: "assertion" },
      },
    ],
    plant: (v) => put(v, { title: "Unmapped idea", layer: "Solution" }),
    clearPath: "ost_link_nodes attaching it under an Opportunity",
    clear: [{ tool: "ost_link_nodes", input: { parent: OPPORTUNITY, child: "Unmapped idea" } }],
    expected: { mcp: { create: false, clear: true }, "ost-pass": { create: false, clear: true } },
  },

  "assumption-mapped": {
    setup: withSolution,
    createPath: "ost_create_node, which attaches under its parent in the same call",
    create: [
      {
        tool: "ost_create_node",
        input: { title: "A fresh belief", layer: "Assumption", parent: SOLUTION, body: "a belief", evidence: "assertion" },
      },
    ],
    plant: (v) => put(v, { title: "Unmapped belief", layer: "Assumption" }),
    clearPath: "ost_link_nodes attaching it under a Solution",
    clear: [{ tool: "ost_link_nodes", input: { parent: SOLUTION, child: "Unmapped belief" } }],
    expected: { mcp: { create: false, clear: true }, "ost-pass": { create: false, clear: true } },
  },

  "test-mapped": {
    setup: withBelief,
    createPath: "ost_create_node, which attaches under its parent in the same call",
    create: [
      {
        tool: "ost_create_node",
        input: {
          title: "A fresh test",
          layer: "AssumptionTest",
          parent: BELIEF,
          body: "a test",
          evidence: "assertion",
          instrument: "npx vitest run test/fresh.test.ts",
        },
      },
    ],
    plant: (v) => put(v, { title: "Unmapped test", layer: "AssumptionTest" }),
    clearPath: "ost_link_nodes attaching it under an Assumption",
    clear: [{ tool: "ost_link_nodes", input: { parent: BELIEF, child: "Unmapped test" } }],
    expected: { mcp: { create: false, clear: true }, "ost-pass": { create: false, clear: true } },
  },

  "evidence-class": {
    setup: withOpportunity,
    createPath: "ost_create_node with no evidence class",
    create: [
      {
        tool: "ost_create_node",
        input: { title: "An unlabelled idea", layer: "Solution", parent: OPPORTUNITY, body: "an idea" },
      },
    ],
    // Every node that predates the ladder is one of these.
    plant: (v) => put(v, { title: "A legacy idea", layer: "Solution", evidence: undefined }),
    clearPath: "ost_set_evidence declaring the rung — granted on both surfaces since R4/R7",
    clear: [{ tool: "ost_set_evidence", input: { title: "A legacy idea", evidence: "assertion", note: "rests on founder theory" } }],
    expected: { mcp: { create: false, clear: true }, "ost-pass": { create: false, clear: true } },
    createRefusal: /evidence/,
  },

  // B2: the create path is closed at the schema. `validated` is no longer in
  // either status enum, and the marker this rule keys on is stamped server-side
  // rather than passed by the caller — so the `tags` argument is deliberately
  // absent below. Leaving it in would have proved nothing about the stamp.
  "no-self-validation": {
    setup: withOpportunity,
    createPath: "ost_create_node, then ost_set_status validated — which the schema no longer accepts",
    create: [
      {
        tool: "ost_create_node",
        input: {
          title: "A self-declared win",
          layer: "Solution",
          parent: OPPORTUNITY,
          body: "an idea",
          evidence: "assertion",
        },
      },
      { tool: "ost_set_status", input: { title: "A self-declared win", status: "validated", note: "it went well" } },
    ],
    plant: (v) => put(v, { title: "A planted win", layer: "Solution", tags: ["unvalidated"], status: "validated" }),
    clearPath: "ost_set_status moving it off validated",
    clear: [{ tool: "ost_set_status", input: { title: "A planted win", status: "in-discovery", note: "no result backs this" } }],
    expected: { mcp: { create: false, clear: true }, "ost-pass": { create: false, clear: true } },
    // The cell rests on a guard, so it is pinned to the guard's own words: if
    // someone re-adds the enum value, this row fails instead of quietly passing.
    createRefusal: /ost-agent promote|not one of/,
  },

  // R2, 2026-07-30: this was the table's last open cell — the one rule the agent
  // could author and nothing could clear, which under DEC-1 is a permanent red
  // only a human on a shell can retire. It did NOT close by giving the agent a
  // permissive lane setter; that would hand it the call that decides what compute
  // may run on its own authority. It closed by refusing the flag when the node's
  // own prose already names a different lane, which is R1's shape: the wedge is
  // refused at the boundary instead of written and regretted. The clear column
  // stays `false` and that is now harmless — a violation the agent cannot author
  // is not a violation it can be wedged by. What remains unclearable is the
  // planted one, which arrives from a human's CLI or a hand-edited note.
  "lane-conflict": {
    setup: withProseLane,
    createPath: "ost_flag_humans_required on a test whose own prose says compute-only — refused since R2",
    create: [
      {
        tool: "ost_flag_humans_required",
        input: { test: ASSUMPTION, why: 'the manifest has to be read by someone: "compare"' },
      },
    ],
    plant: (v) => v.setLane(ASSUMPTION, "humans-required", "by human — a person reads the manifests"),
    clearPath: "annotating and appending a correction — the agent's only lane tool is the restrictive one",
    clear: [
      { tool: "ost_annotate", input: { title: ASSUMPTION, issue: "lane conflict: the prose says compute-only, the label says humans-required" } },
      { tool: "ost_append_to_node", input: { title: ASSUMPTION, section: "## Correction\nThe lane declaration above is stale; the label is right." } },
      { tool: "ost_flag_humans_required", input: { test: ASSUMPTION, why: "re-stating the restrictive call changes nothing" } },
    ],
    expected: { mcp: { create: false, clear: false }, "ost-pass": { create: false, clear: false } },
    // Two surfaces, two reasons for the same `false`, and the alternation says
    // so rather than hiding it: on MCP the guard refuses the call, on `/ost-pass`
    // the tool is not granted at all (R7's containment, which was the whole of
    // the answer before R2 and is now the belt to its braces). Pinning both means
    // removing the guard fails the MCP row instead of passing on the grant.
    createRefusal: /already declares a lane|is not granted on this surface/,
  },

  "rung-unearned": {
    setup: withSolution,
    createPath: "ost_create_node declaring 'money' with no result anywhere beneath it",
    create: [
      {
        tool: "ost_create_node",
        input: {
          title: "Charge for the changelog",
          layer: "Solution",
          parent: OPPORTUNITY,
          body: "people will pay for this",
          evidence: "money",
        },
      },
    ],
    // Every node that predates B3's guard is one of these, which is the reason
    // this stays a detector and not only a write-time refusal.
    plant: (v) => {
      put(v, { title: "A legacy money claim", layer: "Solution", evidence: "money" });
      v.linkNodes(OPPORTUNITY, "A legacy money claim");
    },
    // Demotion is the clear, and it needs no result at all. The other route —
    // append a `## Results` section and the claim is backed — used to be B1's
    // forgeable path and is now closed at the write boundary too, so a fresh
    // violation cannot be cleared by manufacturing what backs it.
    clearPath: "ost_set_evidence declaring the rung the sources actually earned — demotion is never gated",
    clear: [
      {
        tool: "ost_set_evidence",
        input: { title: "A legacy money claim", evidence: "assertion", note: "no result backs this; it is founder theory" },
      },
    ],
    // B3: the create path is closed at both write boundaries. The rule stays a
    // detector because every node predating the guard is still one of these, and
    // a human editing markdown can still write the label by hand.
    expected: { mcp: { create: false, clear: true }, "ost-pass": { create: false, clear: true } },
    createRefusal: /cannot declare 'money'/,
  },
};

class Denied extends Error {}

type Run = (attempt: Attempt) => Promise<string>;

interface RawTool {
  name: string;
  input_schema: ToolSchema;
  run: (input: unknown) => Promise<string>;
}

/**
 * A caller confined to one surface: not-granted is a refusal, not a prompt —
 * the same thing `-p --permission-mode acceptEdits` does with a tool outside
 * `--allowedTools`.
 */
function runnerFor(ctx: ToolContext, granted: readonly string[]): Run {
  const tools = buildOstTools(ctx, MCP_TOOL_NAMES) as unknown as RawTool[];
  return async ({ tool, input }) => {
    if (!granted.includes(tool)) throw new Denied(`${tool} is not granted on this surface`);
    const built = tools.find((t) => t.name === tool);
    if (!built) throw new Denied(`${tool} is not built on the MCP surface`);
    const problems = validateToolInput(built.input_schema, input);
    if (problems.length > 0) throw new Denied(`${tool} refused the call: ${problems.join("; ")}`);
    return built.run(input);
  };
}

/** Run every step, keeping going past a refusal, and report what was refused. */
async function attemptAll(run: Run, steps: readonly Attempt[]): Promise<string[]> {
  const refusals: string[] = [];
  for (const step of steps) {
    try {
      await run(step);
    } catch (err) {
      refusals.push(`${step.tool}: ${(err as Error).message}`);
    }
  }
  return refusals;
}

let dir: string;
let ctx: ToolContext;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-clearability-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  ctx = { vault: new Vault(dir), dir, remote: { enabled: false }, surface: "mcp" };
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const violates = (rule: string): boolean => checkInvariants(ctx.vault.readTree()).some((v) => v.rule === rule);

describe("the table covers exactly what checkInvariants can emit", () => {
  test("the rule list is grepped from the source and is not empty", () => {
    // A regex that stopped matching would make every assertion below vacuous.
    expect(RULES.length).toBeGreaterThanOrEqual(9);
    expect(RULES).toContain("no-self-validation");
  });

  test("every rule has a row — a new rule ships with its clear path or not at all", () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual(RULES);
  });

  test("/ost-pass grants a subset of the MCP surface, so the second column is a narrowing", () => {
    expect(PASS_TOOL_NAMES.length).toBeGreaterThan(0);
    for (const name of PASS_TOOL_NAMES) expect(MCP_TOOL_NAMES as readonly string[]).toContain(name);
    expect(PASS_TOOL_NAMES.length).toBeLessThan(MCP_TOOL_NAMES.length);
  });

  test("R3's property, stated over the table: what a surface can create, that surface can clear", () => {
    // The criterion itself, in one place. Every cell below is an executed call,
    // so this reads the verified table rather than a declaration — and a future
    // rule that ships creatable-and-unclearable fails here, with the criterion's
    // own words, in addition to failing its own row.
    //
    // As of 2026-07-30 it holds by the strongest available route: R2 refused the
    // last `create: true` cell (`lane-conflict`) and R6 refused the other
    // (`dangling-link`), so no rule on either surface is authorable in a single
    // call at all. That is more than R3 asks for, and it is why this reads as a
    // conditional rather than as a count — a new rule may legitimately be
    // creatable, provided it ships with the tool that gets the agent back out.
    for (const rule of RULES) {
      const scenario = SCENARIOS[rule];
      if (!scenario) continue;
      for (const { name } of SURFACES) {
        const cell = scenario.expected[name];
        if (cell.create) {
          expect(cell.clear, `${rule} on ${name}: the agent can author it and cannot clear it — a permanent wedge`).toBe(true);
        }
      }
    }
  });

  test("no tool on either surface offers removal — the half of single-outcome no attempt can show", () => {
    // `single-outcome` is unclearable because nothing deletes a node, and an
    // absence is not demonstrable by calling something. This is the guard that
    // would have to be edited first.
    for (const name of [...MCP_TOOL_NAMES, ...PASS_TOOL_NAMES]) {
      expect(name).not.toMatch(/delete|remove|destroy|archive|prune/i);
    }
  });
});

for (const rule of RULES) {
  const scenario = SCENARIOS[rule];
  // The coverage test above is the one that reports a missing row; skip here so
  // it fails alone rather than behind nine TypeErrors.
  if (!scenario) continue;

  describe(rule, () => {
    for (const { name, granted } of SURFACES) {
      const cell = scenario.expected[name];

      test(`${name}: the agent ${cell.create ? "can" : "cannot"} create it — ${scenario.createPath}`, async () => {
        scenario.setup(ctx.vault);
        expect(violates(rule), `fixture already violates ${rule} before the attempt`).toBe(false);

        const refusals = await attemptAll(runnerFor(ctx, granted), scenario.create);

        expect(violates(rule)).toBe(cell.create);
        if (!cell.create && scenario.createRefusal) {
          expect(refusals.join("\n")).toMatch(scenario.createRefusal);
        }
      });

      test(`${name}: the agent ${cell.clear ? "can" : "cannot"} clear it — ${scenario.clearPath}`, async () => {
        scenario.setup(ctx.vault);
        scenario.plant(ctx.vault, dir);
        expect(violates(rule), `the planted fixture does not violate ${rule}`).toBe(true);

        await attemptAll(runnerFor(ctx, granted), scenario.clear);

        expect(violates(rule)).toBe(!cell.clear);
      });
    }
  });
}
