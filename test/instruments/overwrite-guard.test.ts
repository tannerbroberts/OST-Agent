/**
 * `ost_set_instrument` refuses to overwrite a test that already carries a
 * command, unless the call declares on purpose that a replacement is intended.
 *
 * The hole this closes: `ost_set_instrument` does two different jobs behind one
 * call — attaching a command to a test that has none (pure repair) and
 * replacing the command on a test that already has one (destructive, because a
 * swap deliberately un-clears any build permit the old command earned, per
 * `Vault.setInstrument`). Nothing distinguished the two before the call. An
 * unattended pass working a title list cannot tell which it is about to do, and
 * on 2026-08-07 one downgraded a repo-grounded command to an invented one this
 * way, caught it only from the tool's own diff, and stopped its remaining
 * instrument work because it had no way to avoid repeating the mistake.
 *
 * Two things this file pins beyond the refusal itself:
 * - the refusal names the command AT RISK, because that is the fact worth
 *   knowing at the moment it matters, not a receipt after the fact;
 * - the refusal does not spell out the exact call that clears it. That lives
 *   in the tool's own schema, not in a message a pass can learn from a first
 *   refusal and repeat forever after without ever reading the schema — which
 *   would make the guard a speed bump on first contact and nothing after.
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

const OUTCOME = "Retention";
const OPPORTUNITY = "A pass overwrites an instrument nobody told it was there";
const SOLUTION = "Refuse the overwrite unless replacement is declared";
const BELIEF = "The refusal is what would have prevented the incident";
const TEST = "Attach thirty self-observations to one node";

let dir: string;
let repo: string;
let ctx: PassContext;

const call = (name: string, input: Record<string, unknown>): Promise<string> => {
  const tools = buildOstTools({ ...ctx, productRepos: [repo] }, MCP_TOOL_NAMES);
  const tool = tools.find((t) => t.name === name)!;
  return (tool as unknown as { run: (i: unknown) => Promise<string> }).run(input);
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-overwrite-guard-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-overwrite-guard-repo-"));
  fs.mkdirSync(path.join(repo, "test"), { recursive: true });
  fs.writeFileSync(path.join(repo, "test", "original.test.ts"), "// the grounded command\n", "utf8");
  fs.writeFileSync(path.join(repo, "test", "guessed.test.ts"), "// a pass invented this one\n", "utf8");
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
  ctx = buildPassContext(dir);
  await call("ost_create_node", { title: OPPORTUNITY, layer: "Opportunity", parent: OUTCOME, body: "b", evidence: "assertion" });
  await call("ost_create_node", { title: SOLUTION, layer: "Solution", parent: OPPORTUNITY, body: "b", evidence: "assertion" });
  await call("ost_create_node", { title: BELIEF, layer: "Assumption", parent: SOLUTION, body: "b", evidence: "assertion" });
  await call("ost_create_node", {
    title: TEST,
    layer: "AssumptionTest",
    parent: BELIEF,
    body: "b",
    evidence: "assertion",
    instrument: "npx vitest run test/original.test.ts",
  });
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("attaching to a test that has none is untouched by the guard", () => {
  test("a fresh test with no instrument accepts one without any declaration", async () => {
    // A pre-instrument-era test, written straight through the vault — `ost_create_node`
    // now refuses to mint this shape, which is the point (`test/security/instrument-required.test.ts`).
    ctx.vault.createNode({
      title: "Bare test",
      layer: "AssumptionTest",
      evidence: "assertion",
      body: "someone should check this",
      tags: [],
      links: [],
    } as unknown as Parameters<typeof ctx.vault.createNode>[0]);
    ctx.vault.linkNodes(BELIEF, "Bare test");
    await call("ost_set_instrument", {
      test: "Bare test",
      instrument: "npx vitest run test/guessed.test.ts",
      why: "the first command this test has ever had",
    });
    expect(ctx.vault.read("Bare test").instrument).toBe("npx vitest run test/guessed.test.ts");
  });
});

describe("overwriting a test that already carries a command is refused by default", () => {
  test("the call is refused and nothing is written", async () => {
    await expect(
      call("ost_set_instrument", {
        test: TEST,
        instrument: "npx vitest run test/guessed.test.ts",
        why: "believed this test was prose-only",
      }),
    ).rejects.toThrow();
    expect(ctx.vault.read(TEST).instrument).toBe("npx vitest run test/original.test.ts");
  });

  test("the refusal names the command at risk", async () => {
    const message = await call("ost_set_instrument", {
      test: TEST,
      instrument: "npx vitest run test/guessed.test.ts",
      why: "believed this test was prose-only",
    }).catch((e: Error) => e.message);
    expect(message).toMatch(/npx vitest run test\/original\.test\.ts/);
  });

  test("the refusal does not spell out the flag that clears it", async () => {
    const message = await call("ost_set_instrument", {
      test: TEST,
      instrument: "npx vitest run test/guessed.test.ts",
      why: "believed this test was prose-only",
    }).catch((e: Error) => e.message);
    // The schema is where `replace` lives; the refusal message must not teach
    // it, or the guard is defeated by the first pass that reads its own error.
    expect(message).not.toMatch(/replace/i);
  });
});

describe("a declared replacement still goes through — the correction path stays open", () => {
  test("passing replace: true overwrites the command", async () => {
    await call("ost_set_instrument", {
      test: TEST,
      instrument: "npx vitest run test/guessed.test.ts",
      why: "the original named the wrong module",
      replace: true,
    });
    expect(ctx.vault.read(TEST).instrument).toBe("npx vitest run test/guessed.test.ts");
  });

  test("the swap is recorded in History like every other field change", async () => {
    await call("ost_set_instrument", {
      test: TEST,
      instrument: "npx vitest run test/guessed.test.ts",
      why: "the original named the wrong module",
      replace: true,
    });
    expect(ctx.vault.read(TEST).body).toMatch(
      /instrument: npx vitest run test\/original\.test\.ts → npx vitest run test\/guessed\.test\.ts/,
    );
  });
});

describe("the schema names the escape, even though the refusal will not", () => {
  test("ost_set_instrument declares a `replace` property", () => {
    const tools = buildOstTools(ctx, MCP_TOOL_NAMES);
    const schema = tools.find((t) => t.name === "ost_set_instrument")!.input_schema as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties)).toContain("replace");
  });
});
