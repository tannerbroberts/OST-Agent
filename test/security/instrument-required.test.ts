/**
 * An assumption test must be runnable, or must say who has to run it.
 *
 * The measurement behind this rule is the clearest one this project has: 243
 * solutions, 243 assumption tests, not one of them executable, and a build loop
 * that fired hourly for its whole life with nothing it could act on. Nobody
 * chose that. It is what happens when the cheap path — prose — is the one that
 * answers no question, and the expensive path is the one that does.
 *
 * So the choice is explicit now. `ost_create_node` refuses an AssumptionTest
 * that names neither a command nor a person, and `ost_set_instrument` exists so
 * a pass can go back and pay off the ones written before instruments did.
 *
 * The second branch is not a loophole and these tests are careful to say so.
 * Willingness to pay cannot be settled by a spec file, and a product that
 * pretended otherwise would be worse than one that writes prose. What the branch
 * removes is the SILENT default: a human-required test is born in the
 * restrictive lane, so it is counted and listed rather than sitting in the tree
 * looking runnable.
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
import { buildPermit, testsAwaitingVerification } from "../../src/eval/buildable.js";
import { verifyInstrument, observedRed } from "../../src/ost/instrument.js";

const OUTCOME = "Retention";
const OPPORTUNITY = "Users churn after week one";
const SOLUTION = "Onboarding checklist";
const BELIEF = "A checklist is what new users are missing";

let dir: string;
let repo: string;
let ctx: PassContext;

const call = (name: string, input: Record<string, unknown>): Promise<string> => {
  const tool = buildOstTools(ctx, MCP_TOOL_NAMES).find((t) => t.name === name)!;
  return (tool as unknown as { run: (i: unknown) => Promise<string> }).run(input);
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-instr-req-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-instr-repo-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
  ctx = buildPassContext(dir);
  await call("ost_create_node", { title: OPPORTUNITY, layer: "Opportunity", parent: OUTCOME, body: "b", evidence: "assertion" });
  await call("ost_create_node", { title: SOLUTION, layer: "Solution", parent: OPPORTUNITY, body: "b", evidence: "assertion" });
  await call("ost_create_node", { title: BELIEF, layer: "Assumption", parent: SOLUTION, body: "b", evidence: "assertion" });
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

/** A repo whose named spec exits with `code`. */
function repoWithSpec(code: number) {
  fs.mkdirSync(path.join(repo, "node_modules", ".bin"), { recursive: true });
  const bin = path.join(repo, "node_modules", ".bin", "vitest");
  fs.writeFileSync(bin, `#!/bin/sh\necho "FAIL"\nexit ${code}\n`, "utf8");
  fs.chmodSync(bin, 0o755);
}

describe("minting a test", () => {
  test("an AssumptionTest with neither a command nor a person is refused", async () => {
    await expect(
      call("ost_create_node", { title: "Some hunch", layer: "AssumptionTest", parent: BELIEF, body: "b", evidence: "assertion" }),
    ).rejects.toThrow(/needs an `instrument`/);
    expect(ctx.vault.has("Some hunch")).toBe(false);
  });

  test("the refusal names both ways out, because one of them is always right", async () => {
    const err = await call("ost_create_node", {
      title: "Some hunch",
      layer: "AssumptionTest",
      parent: BELIEF,
      body: "b",
      evidence: "assertion",
    }).catch((e: Error) => e.message);
    expect(err).toMatch(/instrument/);
    expect(err).toMatch(/humansRequired/);
  });

  test("a runnable command is accepted", async () => {
    await call("ost_create_node", {
      title: "The guard refuses a conflict marker",
      layer: "AssumptionTest",
      parent: BELIEF,
      body: "b",
      evidence: "assertion",
      instrument: "npx vitest run test/guard.test.ts",
    });
    expect(ctx.vault.read("The guard refuses a conflict marker").instrument).toBe("npx vitest run test/guard.test.ts");
  });

  test("a named person is accepted, and lands in the lane compute may never run", async () => {
    await call("ost_create_node", {
      title: "Ten buyers price it",
      layer: "AssumptionTest",
      parent: BELIEF,
      body: "b",
      evidence: "assertion",
      humansRequired: "ten buyers say what they would pay; their answer is the measurement",
    });
    const node = ctx.vault.read("Ten buyers price it");
    // Stamped server-side, like the `unvalidated` marker, so a caller cannot
    // describe the classification and then not apply it.
    expect(node.lane).toBe("humans-required");
    // And the reason is IN the node, not just in the call that made it.
    expect(node.body).toMatch(/ten buyers say what they would pay/);
  });

  test("the human branch does not quietly become buildable", async () => {
    await call("ost_create_node", {
      title: "Ten buyers price it",
      layer: "AssumptionTest",
      parent: BELIEF,
      body: "b",
      evidence: "assertion",
      humansRequired: "ten buyers say what they would pay",
    });
    expect(buildPermit(ctx.vault.readTree(), SOLUTION).cleared).toBe(false);
  });
});

describe("re-writing a test that was born prose", () => {
  /**
   * The state the whole tree was in: a test with a threshold, no command, and no
   * lane either.
   *
   * Written straight through the vault rather than through `ost_create_node`,
   * because the tool refuses this shape now — which is the point. A node like
   * this can only be a LEGACY one, and legacy is exactly what the 243 in this
   * product's own vault are: no `instrument`, and no `lane` to say a person owns
   * them. That is what `ost_set_instrument` exists to work through.
   */
  async function proseOnlyTest(): Promise<void> {
    ctx.vault.createNode({
      title: "Whether the resolver finds it",
      layer: "AssumptionTest",
      evidence: "assertion",
      body: "someone should check this",
      tags: [],
      links: [],
    });
    ctx.vault.linkNodes(BELIEF, "Whether the resolver finds it");
  }

  test("a pass can give an existing test a runnable command", async () => {
    await proseOnlyTest();
    const out = await call("ost_set_instrument", {
      test: "Whether the resolver finds it",
      instrument: "npx vitest run test/resolver.test.ts",
      why: "the resolver does not exist yet, so this fails today",
    });
    expect(ctx.vault.read("Whether the resolver finds it").instrument).toBe("npx vitest run test/resolver.test.ts");
    // The change is recorded, like every other field change in this vault.
    expect(ctx.vault.read("Whether the resolver finds it").body).toMatch(/instrument: \(none\) → npx vitest run/);
    // And the tool says plainly that it granted nothing.
    expect(out).toMatch(/not a build permit/i);
  });

  test("setting an instrument clears no gate on its own — only an observation does", async () => {
    await proseOnlyTest();
    await call("ost_set_instrument", {
      test: "Whether the resolver finds it",
      instrument: "npx vitest run test/resolver.test.ts",
      why: "fails today",
    });
    // Named as work for the verifier, and NOT as a build candidate.
    expect(testsAwaitingVerification(ctx.vault.readTree())).toEqual(["Whether the resolver finds it"]);
    expect(buildPermit(ctx.vault.readTree(), SOLUTION).cleared).toBe(false);
  });

  test("a command that could exit 0 without committed code is refused here too", async () => {
    await proseOnlyTest();
    await expect(
      call("ost_set_instrument", { test: "Whether the resolver finds it", instrument: "true", why: "cheap" }),
    ).rejects.toThrow(/committed code/);
    expect(ctx.vault.read("Whether the resolver finds it").instrument).toBeUndefined();
  });

  test("an instrument cannot be attached to anything but an assumption test", async () => {
    await expect(
      call("ost_set_instrument", { test: SOLUTION, instrument: "npx vitest run test/a.test.ts", why: "x" }),
    ).rejects.toThrow(/is a Solution/);
  });
});

describe("a swapped instrument cannot inherit the old one's permit", () => {
  /*
   * The hole this closes. Replacement has to be allowed — that is the entire
   * point of `ost_set_instrument`, and a wrong command is worth correcting. But
   * the log is append-only, so an observation of the OLD command survives the
   * swap. Without matching the log line to the command the node names today, a
   * test could be observed red on one command, quietly re-pointed at another,
   * and hand the builder a permit backed by a run of something else.
   */
  test("re-pointing a red test un-clears it until the new command is run", async () => {
    await call("ost_create_node", {
      title: "Resolver test",
      layer: "AssumptionTest",
      parent: BELIEF,
      body: "b",
      evidence: "assertion",
      instrument: "npx vitest run test/first.test.ts",
    });
    repoWithSpec(1);
    verifyInstrument(dir, { test: "Resolver test", repo });
    expect(buildPermit(ctx.vault.readTree(), SOLUTION).cleared).toBe(true);

    await call("ost_set_instrument", {
      test: "Resolver test",
      instrument: "npx vitest run test/second.test.ts",
      why: "the first named the wrong module",
    });

    // The old run is still on the record — the vault is append-only and a run
    // that happened, happened — but it no longer speaks for the current command.
    expect(ctx.vault.read("Resolver test").body).toMatch(/test\/first\.test\.ts/);
    expect(observedRed(ctx.vault.read("Resolver test"))).toBe(false);
    expect(buildPermit(ctx.vault.readTree(), SOLUTION).cleared).toBe(false);
    expect(testsAwaitingVerification(ctx.vault.readTree())).toEqual(["Resolver test"]);
  });

  test("running the new command earns the permit back", async () => {
    await call("ost_create_node", {
      title: "Resolver test",
      layer: "AssumptionTest",
      parent: BELIEF,
      body: "b",
      evidence: "assertion",
      instrument: "npx vitest run test/first.test.ts",
    });
    repoWithSpec(1);
    verifyInstrument(dir, { test: "Resolver test", repo });
    await call("ost_set_instrument", {
      test: "Resolver test",
      instrument: "npx vitest run test/second.test.ts",
      why: "corrected",
    });
    verifyInstrument(dir, { test: "Resolver test", repo });
    expect(buildPermit(ctx.vault.readTree(), SOLUTION).cleared).toBe(true);
    expect(buildPermit(ctx.vault.readTree(), SOLUTION).instrument).toBe("npx vitest run test/second.test.ts");
  });
});

describe("a human-required test stays a human's", () => {
  /*
   * The permissive/restrictive asymmetry, applied to instruments. Marking a test
   * humans-required is a call the agent may make; taking that mark off is not,
   * and attaching a command is that same reversal wearing a different hat — it
   * would leave the node claiming both that a person is the measurement and that
   * a command answers it, with the verify sweep reading the command.
   *
   * Found by probing the live server, not by reasoning: a willingness-to-pay test
   * accepted `npx vitest run …` and landed in the queue the build loop drains.
   */
  async function humanTest(): Promise<void> {
    await call("ost_create_node", {
      title: "Whether buyers pay",
      layer: "AssumptionTest",
      parent: BELIEF,
      body: "b",
      evidence: "assertion",
      humansRequired: "ten buyers say what they would pay",
    });
  }

  test("an instrument cannot be attached to a humans-required test", async () => {
    await humanTest();
    await expect(
      call("ost_set_instrument", {
        test: "Whether buyers pay",
        instrument: "npx vitest run test/pay.test.ts",
        why: "a proxy",
      }),
    ).rejects.toThrow(/labelled humans-required/);
    expect(ctx.vault.read("Whether buyers pay").instrument).toBeUndefined();
  });

  test("the refusal points at the two moves that are still open", async () => {
    await humanTest();
    const err = await call("ost_set_instrument", {
      test: "Whether buyers pay",
      instrument: "npx vitest run test/pay.test.ts",
      why: "a proxy",
    }).catch((e: Error) => e.message);
    expect(err).toMatch(/ost_annotate/);
    expect(err).toMatch(/ost-agent lane/);
  });

  test("compute never queues a humans-required test, even carrying a command", async () => {
    // Written by hand, the way a node predating the refusal would look — the
    // second lock, on a door the tool no longer opens.
    await humanTest();
    ctx.vault.setInstrument("Whether buyers pay", "npx vitest run test/pay.test.ts", "planted by hand");
    expect(ctx.vault.read("Whether buyers pay").instrument).toBe("npx vitest run test/pay.test.ts");
    expect(testsAwaitingVerification(ctx.vault.readTree())).toEqual([]);
  });
});
