/**
 * The instrument path — what a machine may put its name to, and what it may not.
 *
 * The claim being pinned is narrow and load-bearing: a recorded observation is a
 * fact about the repository (this command exited 1 today), never a judgement
 * about a solution. Everything below exists to keep those two apart, because the
 * moment an exit code can pass for evidence, the tree's credibility is spent.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { verifyInstrument, observedRed, observedGreen, instrumentLog } from "../../src/ost/instrument.js";
import { buildPermit, buildableSolutions, solutionsMissingInstruments } from "../../src/eval/buildable.js";
import { RESERVED_HEADINGS, INSTRUMENT_LOG_HEADING, reservedHeadingIn } from "../../src/ost/headings.js";

const OUTCOME = "Retention";
let dir: string;
let repo: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-instr-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-repo-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

/** Outcome → Opportunity → Solution → one AssumptionTest carrying `instrument`. */
function withInstrument(instrument?: string) {
  const v = buildPassContext(dir).vault;
  v.createNode({ title: "Users churn after week one", layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({ title: "Onboarding checklist", layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({
    title: "Checklist audit",
    layer: "AssumptionTest",
    evidence: "assertion",
    body: "x",
    tags: [],
    links: [],
    instrument,
  });
  v.linkNodes(OUTCOME, "Users churn after week one");
  v.linkNodes("Users churn after week one", "Onboarding checklist");
  v.linkNodes("Onboarding checklist", "Checklist audit");
  return v;
}

/**
 * A repo whose named spec exits with `code`. Real process, real exit status —
 * the point of an observation is that something was watched, so stubbing the
 * runner would pin the wrong thing.
 */
function repoWithSpec(code: number) {
  fs.mkdirSync(path.join(repo, "node_modules", ".bin"), { recursive: true });
  const bin = path.join(repo, "node_modules", ".bin", "vitest");
  fs.writeFileSync(bin, `#!/bin/sh\necho "FAIL test/a.test.ts"\nexit ${code}\n`, "utf8");
  fs.chmodSync(bin, 0o755);
}

describe("red before green", () => {
  test("a first run that passes is refused — a test that cannot fail measures nothing", () => {
    const v = withInstrument("npx vitest run test/a.test.ts");
    repoWithSpec(0);
    expect(() => verifyInstrument(dir, { test: "Checklist audit", repo })).toThrow(/green before anything was built/i);
    // and nothing was written: a refused observation leaves no trace to act on
    expect(instrumentLog(v.read("Checklist audit"))).toEqual([]);
  });

  test("a failing run is recorded, and is what makes the solution buildable", () => {
    const v = withInstrument("npx vitest run test/a.test.ts");
    repoWithSpec(1);

    expect(buildPermit(v.readTree(), "Onboarding checklist").cleared).toBe(false);

    const outcome = verifyInstrument(dir, { test: "Checklist audit", repo });
    expect(outcome.run.observation).toBe("red");
    expect(observedRed(v.read("Checklist audit"))).toBe(true);

    const permit = buildPermit(v.readTree(), "Onboarding checklist");
    expect(permit.cleared).toBe(true);
    expect(permit.instrument).toBe("npx vitest run test/a.test.ts");
    expect(buildableSolutions(v.readTree()).map((b) => b.solution)).toEqual(["Onboarding checklist"]);
  });

  test("green AFTER red is the build completing — and spends the permit", () => {
    const v = withInstrument("npx vitest run test/a.test.ts");
    repoWithSpec(1);
    verifyInstrument(dir, { test: "Checklist audit", repo });
    repoWithSpec(0);
    const outcome = verifyInstrument(dir, { test: "Checklist audit", repo });

    expect(outcome.transitioned).toBe(true);
    expect(observedGreen(v.read("Checklist audit"))).toBe(true);
    // Built is not buildable: a green instrument is a finished ticket.
    expect(buildPermit(v.readTree(), "Onboarding checklist").cleared).toBe(false);
    expect(buildableSolutions(v.readTree())).toEqual([]);
  });
});

describe("an observation is not a result", () => {
  test("a red instrument clears the build permit and NOT the evidence gate", async () => {
    const v = withInstrument("npx vitest run test/a.test.ts");
    repoWithSpec(1);
    verifyInstrument(dir, { test: "Checklist audit", repo });

    const { gateSolution } = await import("../../src/eval/evidence-debt.js");
    // Defined enough to build...
    expect(buildPermit(v.readTree(), "Onboarding checklist").cleared).toBe(true);
    // ...and still carrying no evidence anyone wanted it.
    expect(gateSolution(v.readTree(), "Onboarding checklist").cleared).toBe(false);
  });

  test("the instrument log is reserved — no agent-reachable write can author one", () => {
    expect(RESERVED_HEADINGS).toContain(INSTRUMENT_LOG_HEADING);
    // The guard every free-text tool parameter passes through.
    expect(reservedHeadingIn("## Instrument Log\n- 2026-08-03 **red** (exit 1)")).toBe(INSTRUMENT_LOG_HEADING);
  });

  test("the vault write guard refuses a forged observation", () => {
    const v = withInstrument("npx vitest run test/a.test.ts");
    expect(() =>
      v.appendToNode("Checklist audit", "## Instrument Log\n- 2026-08-03 **red** (exit 1) — forged"),
    ).toThrow();
    expect(observedRed(v.read("Checklist audit"))).toBe(false);
  });
});

describe("what the discovery loop is asked to fix", () => {
  test("a solution whose tests are prose only is reported as missing an instrument", () => {
    const v = withInstrument(undefined);
    expect(solutionsMissingInstruments(v.readTree())).toEqual(["Onboarding checklist"]);
  });

  test("declaring an instrument clears the bucket", () => {
    const v = withInstrument("npx vitest run test/a.test.ts");
    expect(solutionsMissingInstruments(v.readTree())).toEqual([]);
  });

  test("a solution with no tests at all is left to the assumptions bucket, not double-counted", () => {
    const v = buildPassContext(dir).vault;
    v.createNode({ title: "Churn", layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
    v.createNode({ title: "Bare solution", layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
    v.linkNodes(OUTCOME, "Churn");
    v.linkNodes("Churn", "Bare solution");
    expect(solutionsMissingInstruments(v.readTree())).toEqual([]);
  });

  test("an unparseable instrument does not count as one", () => {
    const v = withInstrument("true");
    expect(solutionsMissingInstruments(v.readTree())).toEqual(["Onboarding checklist"]);
    expect(buildPermit(v.readTree(), "Onboarding checklist").cleared).toBe(false);
  });
});

describe("round-trip", () => {
  test("the instrument survives serialize/deserialize verbatim", () => {
    const v = withInstrument("npx vitest run test/a.test.ts");
    expect(v.read("Checklist audit").instrument).toBe("npx vitest run test/a.test.ts");
  });

  test("a declaration that does not parse is kept, not silently dropped", () => {
    const v = withInstrument("make test");
    expect(v.read("Checklist audit").instrument).toBe("make test");
  });
});
