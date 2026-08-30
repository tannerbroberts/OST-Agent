/**
 * An instrument naming a spec path that does not exist is refused.
 *
 * The measurement behind the rule: of 266 recorded reds in this product's own
 * meta vault on 2026-08-09, 260 read "No test files found" — 241 instruments
 * named spec files nobody had written, and seventeen named seven `test/`
 * directories that do not exist in the suite at all. A red like that is about
 * the filesystem rather than the behaviour: every question written on the
 * filename is equally red, and an empty file turns it green. The parse-level
 * allowlist ("a spec file in the repository's own suite") stops one character
 * short of catching it, because its argument holds only while the file exists.
 *
 * So both write boundaries — `ost_set_instrument` and `ost_create_node` —
 * now resolve the path against the configured `product.repos` instead of
 * merely parsing it, with two deliberate limits this spec pins alongside the
 * refusal itself:
 *
 * - **The escape is a bound threshold, not a flag.** Genuinely new behaviour
 *   needs a new spec path, and the one weak-red lifecycle this tree has
 *   watched succeed was carried by a pre-committed bar, not by the file
 *   ("Declare a required tool set…", red 2026-08-06, green 2026-08-07). The
 *   same line `confirmPermit` draws for a vacuous red at spend time is drawn
 *   here at write time, so the two boundaries cannot disagree about what
 *   rescues a missing spec. An escape that was just another input field would
 *   become the default the moment the backlog is large — a bar the author must
 *   actually fix is work, not boilerplate.
 * - **No configured repo, no refusal.** With nothing to resolve against the
 *   guard would fire on every instrument, and a quality rule would become a
 *   total block — the stated dependency of the solution this spec defines.
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
import { specResolves } from "../../src/ost/instrument.js";
import { KILL_CRITERIA } from "../ost/kill-criteria-fixture.js";

const OUTCOME = "Retention";
const OPPORTUNITY = "Instruments go red about missing files";
const SOLUTION = "Resolve the spec path at the boundary";
const BELIEF = "A path that resolves is a red about behaviour";
const LEGACY = "Whether the resolver finds it";

let dir: string;
let repo: string;
let ctx: PassContext;

/** Call a tool against the vault with `repos` as the configured product repos. */
const call = (name: string, input: Record<string, unknown>, repos: readonly string[] = [repo]): Promise<string> => {
  const tools = buildOstTools({ ...ctx, productRepos: repos }, MCP_TOOL_NAMES);
  const tool = tools.find((t) => t.name === name)!;
  return (tool as unknown as { run: (i: unknown) => Promise<string> }).run(input);
};

/**
 * A test written before instruments existed: prose, no command, no lane —
 * the shape `ost_set_instrument` exists to pay off. Written straight through
 * the vault because the tool refuses to create it now.
 */
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-spec-res-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-spec-res-repo-"));
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

describe("ost_set_instrument resolves the path against the configured repo", () => {
  test("a spec that exists is accepted", async () => {
    legacyTest();
    await call("ost_set_instrument", {
      test: LEGACY,
      instrument: "npx vitest run test/exists.test.ts",
      why: "the guard does not exist yet, so an assertion in this spec fails today",
    });
    expect(ctx.vault.read(LEGACY).instrument).toBe("npx vitest run test/exists.test.ts");
  });

  test("a spec that does not exist is refused, and nothing is written", async () => {
    legacyTest();
    await expect(
      call("ost_set_instrument", {
        test: LEGACY,
        instrument: "npx vitest run test/invented.test.ts",
        why: "sounds plausible",
      }),
    ).rejects.toThrow(/does not exist in the configured product repo/);
    expect(ctx.vault.read(LEGACY).instrument).toBeUndefined();
  });

  test("the refusal names both ways out — an existing spec, or a pre-committed bar", async () => {
    legacyTest();
    const err = await call("ost_set_instrument", {
      test: LEGACY,
      instrument: "npx vitest run test/invented.test.ts",
      why: "sounds plausible",
    }).catch((e: Error) => e.message);
    expect(err).toMatch(/name a spec that exists/);
    expect(err).toMatch(/pre-commit a fixed bar/);
    // And it says why the write was worthless, not just that it was refused.
    expect(err).toMatch(/every question written on that filename is equally red/);
  });

  test("a bound threshold carries a new spec path through — the vacuous-red escape, applied at write time", async () => {
    legacyTest("at least 5 of the 20 replayed sessions are refused before any work");
    await call("ost_set_instrument", {
      test: LEGACY,
      instrument: "npx vitest run test/not-written-yet.test.ts",
      why: "new behaviour with no existing home; the bar is pre-committed",
    });
    expect(ctx.vault.read(LEGACY).instrument).toBe("npx vitest run test/not-written-yet.test.ts");
  });

  test("prose that fixes no bar is not the escape", async () => {
    // A threshold in words with nothing bound in it: `thresholdKindOf` reads
    // this as `prose`, and prose rescued a missing spec for nobody.
    legacyTest("the resolver feels correct to whoever reads it");
    await expect(
      call("ost_set_instrument", {
        test: LEGACY,
        instrument: "npx vitest run test/not-written-yet.test.ts",
        why: "sounds plausible",
      }),
    ).rejects.toThrow(/does not exist in the configured product repo/);
    expect(ctx.vault.read(LEGACY).instrument).toBeUndefined();
  });

  test("a spec found in ANY configured repo resolves", async () => {
    const second = fs.mkdtempSync(path.join(os.tmpdir(), "ost-spec-res-second-"));
    try {
      fs.mkdirSync(path.join(second, "test"), { recursive: true });
      fs.writeFileSync(path.join(second, "test", "elsewhere.test.ts"), "// lives in the second repo\n", "utf8");
      legacyTest();
      await call(
        "ost_set_instrument",
        { test: LEGACY, instrument: "npx vitest run test/elsewhere.test.ts", why: "an assertion in it fails today" },
        [repo, second],
      );
      expect(ctx.vault.read(LEGACY).instrument).toBe("npx vitest run test/elsewhere.test.ts");
    } finally {
      fs.rmSync(second, { recursive: true, force: true });
    }
  });
});

describe("with no product repo configured, the guard stands down", () => {
  // The solution's stated dependency: resolution needs a repo to resolve
  // against, and with none configured the refusal would fire on EVERY
  // instrument — a quality rule become a total block. The weak form staying
  // expressible here is the price of the tool remaining usable at all; the
  // run-time `no-spec` filing still catches what this could not.
  test("an unresolvable path is accepted when there is nothing to resolve against", async () => {
    legacyTest();
    await call(
      "ost_set_instrument",
      { test: LEGACY, instrument: "npx vitest run test/invented.test.ts", why: "written blind, filed no-spec at verify time" },
      [],
    );
    expect(ctx.vault.read(LEGACY).instrument).toBe("npx vitest run test/invented.test.ts");
  });
});

describe("ost_create_node applies the same rule at the other write boundary", () => {
  test("a new test naming an absent spec with no bound bar is refused before anything is written", async () => {
    await expect(
      call("ost_create_node", {
        title: "A guessed command",
        layer: "AssumptionTest",
        parent: BELIEF,
        body: "b",
        evidence: "assertion",
        instrument: "npx vitest run test/invented.test.ts",
      }),
    ).rejects.toThrow(/does not exist in the configured product repo/);
    expect(ctx.vault.has("A guessed command")).toBe(false);
  });

  test("a bound threshold at creation is the same escape", async () => {
    await call("ost_create_node", {
      title: "New behaviour, bar fixed in advance",
      layer: "AssumptionTest",
      parent: BELIEF,
      body: "b",
      evidence: "assertion",
      threshold: "zero of the replayed writes reach disk",
      instrument: "npx vitest run test/not-written-yet.test.ts",
    });
    expect(ctx.vault.read("New behaviour, bar fixed in advance").instrument).toBe("npx vitest run test/not-written-yet.test.ts");
  });

  test("an existing spec is accepted exactly as before", async () => {
    await call("ost_create_node", {
      title: "The guard refuses an invented path",
      layer: "AssumptionTest",
      parent: BELIEF,
      body: "b",
      evidence: "assertion",
      instrument: "npx vitest run test/exists.test.ts",
    });
    expect(ctx.vault.read("The guard refuses an invented path").instrument).toBe("npx vitest run test/exists.test.ts");
  });
});

describe("the resolver itself", () => {
  test("shares runInstrument's resolution: repo-relative, against each root in turn", () => {
    expect(specResolves([repo], "test/exists.test.ts")).toBe(true);
    expect(specResolves([repo], "test/invented.test.ts")).toBe(false);
    expect(specResolves([], "test/exists.test.ts")).toBe(false);
  });
});
