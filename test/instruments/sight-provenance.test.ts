/**
 * The sight flag is set from the grant table and cannot be set by the caller.
 *
 * An instrument records whether the pass that wrote it could see the
 * repository. Before this flag, a grounded instrument and a guessed one were
 * the same string in the same field — of 266 recorded reds in the meta vault
 * on 2026-08-09, 260 were written by passes that named files they could not
 * check — and a reader deciding whether a backlog of red instruments is
 * progress or laundering had nothing to count.
 *
 * The one property that makes the flag worth recording, pinned here from both
 * sides: the party being graded cannot set its own grade.
 *
 * - With `product.repos` unconfigured, an instrument written through the tool
 *   is recorded `blind` even when the call passes a parameter claiming
 *   otherwise. The claim has nowhere to land: the schema closes over its
 *   declared properties, and the handler never reads one.
 * - With a readable repo configured, the same call records `grounded` — which
 *   is what stops the implementation from being a hard-coded `blind`.
 * - A repo that is configured but unreadable is `blind` too: the flag comes
 *   from the grant table's answer at the moment of the write, not from the
 *   config's optimism.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { buildOstTools } from "../../src/security/tools.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import type { PassContext } from "../../src/runner/context.js";
import type { OstNode } from "../../src/ost/node.js";
import { deserialize, serialize } from "../../src/ost/node.js";
import { repoSight } from "../../src/product/repo.js";
import { sightCensus } from "../../src/ost/instrument.js";
import { renderDebt, renderStatus } from "../../src/eval/render.js";
import { KILL_CRITERIA } from "../ost/kill-criteria-fixture.js";

const OUTCOME = "Retention";
const OPPORTUNITY = "A sweep that cannot read its subject reports a clean result";
const SOLUTION = "Record whether the pass could see the repository";
const BELIEF = "Sight is derivable from the surface";
const LEGACY = "Whether the flag tells grounded from blind";

let dir: string;
let repo: string;
let ctx: PassContext;

/** Call a tool against the vault with `repos` as the configured product repos. */
const call = (name: string, input: Record<string, unknown>, repos: readonly string[] = [repo]): Promise<string> => {
  const tools = buildOstTools({ ...ctx, productRepos: repos }, MCP_TOOL_NAMES);
  const tool = tools.find((t) => t.name === name)!;
  return (tool as unknown as { run: (i: unknown) => Promise<string> }).run(input);
};

/** A pre-instrument-era test, written straight through the vault. */
function legacyTest(threshold?: string): void {
  ctx.vault.createNode({
    title: LEGACY,
    layer: "AssumptionTest",
    evidence: "assertion",
    body: "someone should check this",
    threshold,
    tags: [],
    links: [],
  } as unknown as OstNode);
  ctx.vault.linkNodes(BELIEF, LEGACY);
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-sight-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-sight-repo-"));
  fs.mkdirSync(path.join(repo, "test"), { recursive: true });
  fs.writeFileSync(path.join(repo, "test", "exists.test.ts"), "// a spec that exists\n", "utf8");
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
  ctx = buildPassContext(dir);
  await call("ost_create_node", { title: OPPORTUNITY, layer: "Opportunity", parent: OUTCOME, body: "b", evidence: "assertion" });
  await call("ost_create_node", { title: SOLUTION, layer: "Solution", parent: OPPORTUNITY, body: "b", evidence: "assertion", ...KILL_CRITERIA });
  await call("ost_create_node", { title: BELIEF, layer: "Assumption", parent: SOLUTION, body: "b", evidence: "assertion" });
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("the flag is derived from the grant table, never from the caller", () => {
  test("with no product repo configured, the write is recorded blind — even when the call claims otherwise", async () => {
    legacyTest();
    // The caller asserts sight it does not have. The property is not in the
    // schema, and the handler never reads it, so the claim lands nowhere.
    await call(
      "ost_set_instrument",
      { test: LEGACY, instrument: "npx vitest run test/invented.test.ts", why: "written blind on purpose", sight: "grounded" },
      [],
    );
    expect(ctx.vault.read(LEGACY).sight).toBe("blind");
  });

  test("with a readable repo configured, the same call records grounded — even when the call claims blind", async () => {
    legacyTest();
    await call("ost_set_instrument", {
      test: LEGACY,
      instrument: "npx vitest run test/exists.test.ts",
      why: "an assertion in this spec fails today",
      sight: "blind",
    });
    expect(ctx.vault.read(LEGACY).sight).toBe("grounded");
  });

  test("a repo that is configured but unreadable is blind — the grant table answers, not the config", async () => {
    // A bound threshold carries the unresolvable spec path through the
    // resolution guard, so what is being measured here is only the sight.
    legacyTest("at least 5 of the 20 replayed sessions are refused before any work");
    const gone = path.join(os.tmpdir(), "ost-sight-nonexistent-repo");
    await call(
      "ost_set_instrument",
      { test: LEGACY, instrument: "npx vitest run test/not-written-yet.test.ts", why: "bar pre-committed" },
      [gone],
    );
    expect(ctx.vault.read(LEGACY).sight).toBe("blind");
  });

  test("the caller has no parameter to claim sight through: the schema closes over its properties and names no sight", () => {
    const tools = buildOstTools(ctx, MCP_TOOL_NAMES);
    const schema = tools.find((t) => t.name === "ost_set_instrument")!.input_schema as {
      additionalProperties?: boolean;
      properties: Record<string, unknown>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).not.toContain("sight");
  });

  test("the History line carries the sight beside the command it graded, so a later swap cannot re-plead an old write", async () => {
    legacyTest();
    await call(
      "ost_set_instrument",
      { test: LEGACY, instrument: "npx vitest run test/invented.test.ts", why: "written blind" },
      [],
    );
    expect(ctx.vault.read(LEGACY).body).toMatch(/\[sight: blind\]/);
  });
});

describe("ost_create_node stamps the same flag at the other write boundary", () => {
  test("an instrument born with a readable repo is grounded", async () => {
    await call("ost_create_node", {
      title: "Born with sight",
      layer: "AssumptionTest",
      parent: BELIEF,
      body: "b",
      evidence: "assertion",
      instrument: "npx vitest run test/exists.test.ts",
    });
    expect(ctx.vault.read("Born with sight").sight).toBe("grounded");
  });

  test("an instrument born with no repo configured is blind, whatever the call claims", async () => {
    await call(
      "ost_create_node",
      {
        title: "Born blind",
        layer: "AssumptionTest",
        parent: BELIEF,
        body: "b",
        evidence: "assertion",
        instrument: "npx vitest run test/invented.test.ts",
        sight: "grounded",
      },
      [],
    );
    expect(ctx.vault.read("Born blind").sight).toBe("blind");
  });

  test("a test born without an instrument carries no sight — there is nothing for the flag to describe", async () => {
    await call("ost_create_node", {
      title: "Human-measured",
      layer: "AssumptionTest",
      parent: BELIEF,
      body: "b",
      evidence: "assertion",
      humansRequired: "an interview is the measurement",
    });
    expect(ctx.vault.read("Human-measured").sight).toBeUndefined();
  });
});

describe("the grant-table probe itself", () => {
  test("no repos is blind, a readable directory is grounded, an absent path or a plain file is blind", () => {
    expect(repoSight([])).toBe("blind");
    expect(repoSight([repo])).toBe("grounded");
    expect(repoSight([path.join(os.tmpdir(), "ost-sight-nonexistent-repo")])).toBe("blind");
    expect(repoSight([path.join(repo, "test", "exists.test.ts")])).toBe("blind");
    // One readable root among the dead ones is sight.
    expect(repoSight([path.join(os.tmpdir(), "ost-sight-nonexistent-repo"), repo])).toBe("grounded");
  });
});

describe("the flag survives the disk and reaches both reports", () => {
  test("serialize/deserialize round-trips the flag; a value nobody defined is dropped, not carried", () => {
    legacyTest();
    const node = ctx.vault.read(LEGACY);
    node.instrument = "npx vitest run test/exists.test.ts";
    node.sight = "grounded";
    expect(deserialize(LEGACY, serialize(node)).sight).toBe("grounded");
    const forged = serialize(node).replace("sight: grounded", "sight: omniscient");
    expect(deserialize(LEGACY, forged).sight).toBeUndefined();
  });

  test("debt and status report grounded and blind as separate figures", async () => {
    legacyTest();
    await call(
      "ost_set_instrument",
      { test: LEGACY, instrument: "npx vitest run test/invented.test.ts", why: "written blind" },
      [],
    );
    await call("ost_create_node", {
      title: "Grounded sibling",
      layer: "AssumptionTest",
      parent: BELIEF,
      body: "b",
      evidence: "assertion",
      instrument: "npx vitest run test/exists.test.ts",
    });
    const tree = ctx.vault.readTree();
    expect(sightCensus(tree)).toEqual({ total: 2, grounded: 1, blind: 1, unlabelled: 0 });
    expect(renderDebt(tree)).toContain("Instruments: 2  (grounded 1, blind 1, unlabelled 0");
    expect(renderStatus(ctx, ctx.vault.readTreeCensus())).toContain(
      "Sight: 1/2 instrument(s) written with repo sight (blind 1, unlabelled 0)",
    );
  });

  test("an instrument written before the flag existed counts as unlabelled, never as either verdict", () => {
    legacyTest();
    ctx.vault.setInstrument(LEGACY, "npx vitest run test/exists.test.ts", "planted by hand, pre-flag");
    const tree = ctx.vault.readTree();
    expect(sightCensus(tree)).toEqual({ total: 1, grounded: 0, blind: 0, unlabelled: 1 });
  });
});
