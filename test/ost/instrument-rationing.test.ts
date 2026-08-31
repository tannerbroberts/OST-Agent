/**
 * The instrument allowance holds at the floor while no result has ever been
 * recorded — and opens in proportion once one is.
 *
 * The tree this product tends has a measured imbalance: 88 of one day's 356
 * tool calls were `ost_set_instrument`, and every bucket in the same day's
 * rollup read `tested 0`. Attaching a command is on the agent's surface;
 * recording a result is a human's `ost-agent result` and is on nobody's. So
 * readiness is the only quantity that can move, and it moves forever.
 *
 * The assumption under the solution this file settles is narrow and is the
 * thing being pinned here: **backpressure can be applied at the write boundary
 * without wedging the tree.** A ration that refuses everything leaves a pass
 * unable to do any useful work; one that never binds is decoration. The claim
 * is that a fixed floor plus a proportional allowance sits between those, and
 * the four bars below are what "between those" has to mean:
 *
 *  1. the floor is non-zero, so a fresh vault can still be worked;
 *  2. with zero results the allowance stops AT the floor — the next attach is
 *     refused, and refused with a reason that names the shortage rather than a
 *     generic error, because a refusal a pass reads as a bug is one it routes
 *     around;
 *  3. each recorded result raises the allowance in proportion;
 *  4. it binds at every door into the field. `ost_create_node` takes an
 *     instrument at birth and `ost_set_instrument` attaches one later; a ration
 *     on one of them is not a ration.
 *
 * What this file deliberately does NOT settle, restating the assumption's own
 * limit: whether withholding the work helps at all. If execution is blocked on
 * something structural rather than on anyone's willingness, a valve makes the
 * shortage legible and gives the operator no hours back. A spec can prove the
 * valve opens and closes correctly; it cannot tell whether a valve was the
 * right thing to install.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import type { OstNode } from "../../src/ost/node.js";
import {
  countRecordedResults,
  createInstrumentRation,
  instrumentShortage,
  INSTRUMENT_FLOOR,
  INSTRUMENTS_PER_RESULT,
  rationRefusal,
} from "../../src/ost/rationing.js";
import { recordResult } from "../../src/ost/results.js";
import { Vault } from "../../src/ost/vault.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";

const OUTCOME = "Players keep playing";
const OPPORTUNITY = "Players cannot tell what changed";
const SOLUTION = "Ship a changelog";
const BELIEF = "Players would read a changelog";

let dir: string;
let vault: Vault;
let ctx: ToolContext;

function put(title: string, layer: OstNode["layer"], extra: Partial<OstNode> = {}): void {
  vault.createNode({
    title,
    layer,
    tags: [],
    links: [],
    evidence: "assertion",
    body: `prose for ${title}`,
    ...extra,
  } as OstNode);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-instrument-ration-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  vault = new Vault(dir);
  ctx = { vault, dir, remote: { enabled: false }, surface: "test:instrument-ration" };
  put(OUTCOME, "Outcome");
  put(OPPORTUNITY, "Opportunity");
  vault.linkNodes(OUTCOME, OPPORTUNITY);
  put(SOLUTION, "Solution", { killIf: "nobody opens it twice", killBy: "2026-12-01" });
  vault.linkNodes(OPPORTUNITY, SOLUTION);
  put(BELIEF, "Assumption");
  vault.linkNodes(SOLUTION, BELIEF);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const runTool = (name: string, input: Record<string, unknown>): Promise<string> => {
  const tool = buildOstTools(ctx, MCP_TOOL_NAMES).find((t) => t.name === name)!;
  return (tool as unknown as { run: (i: unknown) => Promise<string> }).run(input);
};

/**
 * One tool surface, reused across calls — which is the scope the ration is
 * charged at. Building the tools afresh per call would hand every call its own
 * allowance and make every assertion below pass vacuously.
 */
const surface = (): ((name: string, input: Record<string, unknown>) => Promise<string>) => {
  const tools = buildOstTools(ctx, MCP_TOOL_NAMES);
  return (name, input) => (tools.find((t) => t.name === name) as unknown as { run: (i: unknown) => Promise<string> }).run(input);
};

/** An AssumptionTest with no command on it, ready to be instrumented. */
function unInstrumentedTest(title: string): void {
  put(title, "AssumptionTest", {
    body: `${title}\n\n**Pre-committed threshold:** at least 5 of 20 open it.`,
    humansRequired: undefined,
  });
  vault.linkNodes(BELIEF, title);
}

/** A human's recorded result, written the one way a result can be written. */
function humanRecordsResult(test: string, on: string): void {
  recordResult(dir, {
    test,
    verdict: "supported",
    note: "ran it with 20 players; 7 opened the changelog twice",
    by: "Tanner",
    uncovered: "nothing about players who never log in",
    on,
  });
}

describe("the allowance holds at a non-zero floor while nothing has been executed", () => {
  test("the floor is not zero — a fresh vault with no results at all can still be worked", () => {
    // The wedge this ration must not be. A vault with no tests has nothing to
    // execute, so an allowance keyed purely on results would be zero on the
    // first call anyone ever made and the tree could never start.
    expect(INSTRUMENT_FLOOR).toBeGreaterThan(0);
    const ration = createInstrumentRation(() => []);
    expect(ration.allowance()).toBe(INSTRUMENT_FLOOR);
    expect(ration.remaining()).toBe(INSTRUMENT_FLOOR);
    expect(ration.take()).toBe(true);
  });

  test("with zero results the allowance stops AT the floor and does not creep past it", () => {
    const ration = createInstrumentRation(() => vault.readTree());
    expect(countRecordedResults(vault.readTree())).toBe(0);

    for (let i = 0; i < INSTRUMENT_FLOOR; i++) {
      expect(ration.take(), `attach ${i + 1} of the floor should be permitted`).toBe(true);
    }
    expect(ration.spent()).toBe(INSTRUMENT_FLOOR);
    expect(ration.remaining()).toBe(0);
    expect(ration.take()).toBe(false);
    // A refused take costs nothing, so a pass that keeps trying does not report
    // a deeper shortage than it caused.
    expect(ration.take()).toBe(false);
    expect(ration.spent()).toBe(INSTRUMENT_FLOOR);
  });

  test("each recorded result raises the allowance in proportion", () => {
    unInstrumentedTest("Whether players open it twice");
    const ration = createInstrumentRation(() => vault.readTree());
    expect(ration.allowance()).toBe(INSTRUMENT_FLOOR);

    humanRecordsResult("Whether players open it twice", "2026-08-31");
    expect(countRecordedResults(vault.readTree())).toBe(1);
    expect(ration.allowance()).toBe(INSTRUMENT_FLOOR + INSTRUMENTS_PER_RESULT);

    // Two runs of the same test are two results: the allowance rides on
    // executions, not on how many distinct tests have been touched.
    humanRecordsResult("Whether players open it twice", "2026-09-01");
    expect(countRecordedResults(vault.readTree())).toBe(2);
    expect(ration.allowance()).toBe(INSTRUMENT_FLOOR + 2 * INSTRUMENTS_PER_RESULT);
  });

  test("a result recorded mid-pass opens the allowance for that pass, not the next one", () => {
    unInstrumentedTest("Whether players open it twice");
    const ration = createInstrumentRation(() => vault.readTree());
    for (let i = 0; i < INSTRUMENT_FLOOR; i++) ration.take();
    expect(ration.take()).toBe(false);

    humanRecordsResult("Whether players open it twice", "2026-08-31");

    expect(ration.remaining()).toBe(INSTRUMENTS_PER_RESULT);
    expect(ration.take()).toBe(true);
  });
});

describe("the refusal names the shortage, so it does not read as a bug", () => {
  test("it quotes the imbalance and the one command that opens the valve", () => {
    unInstrumentedTest("Whether players open it twice");
    vault.setInstrument("Whether players open it twice", "npx vitest run test/changelog.test.ts", "unbuilt");

    const ration = createInstrumentRation(() => vault.readTree());
    for (let i = 0; i < INSTRUMENT_FLOOR; i++) ration.take();
    const refusal = rationRefusal("Some other test", ration);

    // The shortage in the tree's own numbers, not an adjective about it.
    expect(refusal).toContain("Some other test");
    expect(refusal).toMatch(/no result has ever been recorded/i);
    expect(refusal).toMatch(/1 command\(s\)/);
    expect(refusal).toMatch(/1 of which no result answers/);
    // What would open it, and whose call that is.
    expect(refusal).toMatch(/ost-agent result/);
    // And what to do instead, so the refusal is not a dead end.
    expect(refusal).toMatch(/map evidence|ideate|annotate/i);
  });

  test("the shortage counts commands the tree carries and how many no result answers", () => {
    unInstrumentedTest("Whether players open it twice");
    unInstrumentedTest("Whether players find the entry point");
    vault.setInstrument("Whether players open it twice", "npx vitest run test/a.test.ts", "unbuilt");
    vault.setInstrument("Whether players find the entry point", "npx vitest run test/b.test.ts", "unbuilt");

    expect(instrumentShortage(vault.readTree())).toEqual({ results: 0, instrumented: 2, unanswered: 2 });

    humanRecordsResult("Whether players open it twice", "2026-08-31");
    expect(instrumentShortage(vault.readTree())).toEqual({ results: 1, instrumented: 2, unanswered: 1 });
  });

  test("a promotion to validated is not an execution, and does not open the allowance", () => {
    // `hasRecordedResult` says yes to a promotion, on purpose, because it
    // answers "has this been settled". The allowance rides on runs instead: a
    // human's judgement about a claim is not a test that was executed, and
    // reading one as the other would let the tree open its own valve with a
    // status change.
    unInstrumentedTest("Whether players open it twice");
    vault.setStatus("Whether players open it twice", "validated");
    expect(countRecordedResults(vault.readTree())).toBe(0);
    expect(createInstrumentRation(() => vault.readTree()).allowance()).toBe(INSTRUMENT_FLOOR);
  });
});

describe("the ration binds at every door into the instrument field", () => {
  test("ost_set_instrument is refused once the pass has spent the floor", async () => {
    const call = surface();
    for (let i = 0; i < INSTRUMENT_FLOOR + 1; i++) unInstrumentedTest(`Whether players notice thing ${i}`);

    for (let i = 0; i < INSTRUMENT_FLOOR; i++) {
      await call("ost_set_instrument", {
        test: `Whether players notice thing ${i}`,
        instrument: `npx vitest run test/notice-${i}.test.ts`,
        why: "the changelog does not exist yet, so it fails today",
      });
    }

    await expect(
      call("ost_set_instrument", {
        test: `Whether players notice thing ${INSTRUMENT_FLOOR}`,
        instrument: "npx vitest run test/notice-last.test.ts",
        why: "the changelog does not exist yet, so it fails today",
      }),
    ).rejects.toThrow(/no result has ever been recorded/i);

    // Refused BEFORE the write: the node it named still carries no command.
    expect(new Vault(dir).read(`Whether players notice thing ${INSTRUMENT_FLOOR}`).instrument).toBeUndefined();
  });

  test("ost_create_node is the other door, and the same allowance covers it", async () => {
    // Without this, the ration is a sieve: a pass told it may not attach a
    // command can write a node that is born carrying one, and learn to do that
    // exclusively within a single session.
    const call = surface();
    for (let i = 0; i < INSTRUMENT_FLOOR; i++) {
      await call("ost_create_node", {
        title: `Whether the entry point is found ${i}`,
        layer: "AssumptionTest",
        parent: BELIEF,
        body: "a spec over the vault settles this",
        evidence: "assertion",
        threshold: "at least 5 of 20 open it",
        instrument: `npx vitest run test/entry-${i}.test.ts`,
      });
    }

    await expect(
      call("ost_create_node", {
        title: "Whether the entry point is found last",
        layer: "AssumptionTest",
        parent: BELIEF,
        body: "a spec over the vault settles this",
        evidence: "assertion",
        threshold: "at least 5 of 20 open it",
        instrument: "npx vitest run test/entry-last.test.ts",
      }),
    ).rejects.toThrow(/no result has ever been recorded/i);

    // Refused before the first byte, like every other create-node guard.
    expect(() => new Vault(dir).read("Whether the entry point is found last")).toThrow();
  });

  test("the two doors share one allowance rather than one each", async () => {
    const call = surface();
    unInstrumentedTest("Whether players open it twice");

    // Spend all but one at the birth door...
    for (let i = 0; i < INSTRUMENT_FLOOR - 1; i++) {
      await call("ost_create_node", {
        title: `Whether the entry point is found ${i}`,
        layer: "AssumptionTest",
        parent: BELIEF,
        body: "a spec over the vault settles this",
        evidence: "assertion",
        threshold: "at least 5 of 20 open it",
        instrument: `npx vitest run test/entry-${i}.test.ts`,
      });
    }
    // ...spend the last at the attach door...
    await call("ost_set_instrument", {
      test: "Whether players open it twice",
      instrument: "npx vitest run test/twice.test.ts",
      why: "the changelog does not exist yet, so it fails today",
    });

    // ...and the birth door is now closed too.
    await expect(
      call("ost_create_node", {
        title: "Whether the entry point is found last",
        layer: "AssumptionTest",
        parent: BELIEF,
        body: "a spec over the vault settles this",
        evidence: "assertion",
        threshold: "at least 5 of 20 open it",
        instrument: "npx vitest run test/entry-last.test.ts",
      }),
    ).rejects.toThrow(/allowance is at its floor/i);
  });

  test("the birth refusal forbids the escape it would otherwise open", async () => {
    // `ost_create_node` requires an AssumptionTest to declare an instrument OR a
    // person. A pass refused the first has an obvious way to get its node
    // written, and it is the one that costs an operator time: relabel the test
    // humans-required. The refusal has to close that itself, because nothing
    // downstream can tell a mislabelled test from an honest one.
    const call = surface();
    for (let i = 0; i < INSTRUMENT_FLOOR; i++) {
      await call("ost_create_node", {
        title: `Whether the entry point is found ${i}`,
        layer: "AssumptionTest",
        parent: BELIEF,
        body: "a spec over the vault settles this",
        evidence: "assertion",
        threshold: "at least 5 of 20 open it",
        instrument: `npx vitest run test/entry-${i}.test.ts`,
      });
    }

    await expect(
      call("ost_create_node", {
        title: "Whether the entry point is found last",
        layer: "AssumptionTest",
        parent: BELIEF,
        body: "a spec over the vault settles this",
        evidence: "assertion",
        threshold: "at least 5 of 20 open it",
        instrument: "npx vitest run test/entry-last.test.ts",
      }),
    ).rejects.toThrow(/humansRequired/);
  });

  test("correcting a command already on a node is not charged — it adds no readiness", async () => {
    // The stock of unrun instruments is what this pushes back on. A replacement
    // leaves that stock exactly where it was, and rationing it would make a pass
    // choose between fixing a wrong command and writing a right one.
    const call = surface();
    unInstrumentedTest("Whether players open it twice");
    await call("ost_set_instrument", {
      test: "Whether players open it twice",
      instrument: "npx vitest run test/twice.test.ts",
      why: "the changelog does not exist yet, so it fails today",
    });

    for (let i = 0; i < 20; i++) {
      await call("ost_set_instrument", {
        test: "Whether players open it twice",
        instrument: `npx vitest run test/twice-v${i}.test.ts`,
        why: "correcting the command to the spec that actually names the behaviour",
        replace: true,
      });
    }

    expect(new Vault(dir).read("Whether players open it twice").instrument).toBe("npx vitest run test/twice-v19.test.ts");
  });

  test("a pass that has NOT spent its floor is not obstructed — this binds, it does not wedge", async () => {
    // The other half of the assumption. A ration that refuses everything is as
    // useless as one that never binds, and the floor is what keeps ordinary work
    // ordinary: nothing above ever asked a question of the first attach.
    unInstrumentedTest("Whether players open it twice");
    const line = await runTool("ost_set_instrument", {
      test: "Whether players open it twice",
      instrument: "npx vitest run test/twice.test.ts",
      why: "the changelog does not exist yet, so it fails today",
    });
    expect(line).toContain("Whether players open it twice");
    expect(new Vault(dir).read("Whether players open it twice").instrument).toBe("npx vitest run test/twice.test.ts");
  });
});
