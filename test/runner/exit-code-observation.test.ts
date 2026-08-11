/**
 * A recorded exit code cannot clear a gate or masquerade as a result.
 *
 * The safety property that decides whether an instrument runner is buildable at
 * all. Running a command and reading its exit code is an observation, not a
 * judgement — and the moment a recorded observation can pass for one, compute
 * has granted itself the permit that promotion was reserved for. So this pins
 * the four containments the tree's discipline rests on: a recorded exit code
 * writes only to the instrument log, never to `## Results`, never changes the
 * node's status, and leaves the solution's evidence gate BLOCKED — including,
 * especially, when the exit code is 0.
 *
 * What is deliberately NOT asserted: whether the exit codes mean anything. A
 * perfectly-contained runner filling the vault with uninterpretable 1s passes
 * everything here; whether the observations are worth having is a human's read
 * of the first batch.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { instrumentLog, verifyInstrument } from "../../src/ost/instrument.js";
import { gateSolution, hasRecordedResult } from "../../src/eval/evidence-debt.js";
import { INSTRUMENT_LOG_HEADING, RESULTS_HEADING } from "../../src/ost/headings.js";

const OUTCOME = "Retention";
const SOLUTION = "Onboarding checklist";
const TEST = "Checklist audit";

let dir: string;
let repo: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-obs-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-obs-repo-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

/** Outcome → Opportunity → Solution → one AssumptionTest carrying the instrument. */
function vaultWithInstrument() {
  const v = buildPassContext(dir).vault;
  v.createNode({ title: "Users churn after week one", layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({ title: SOLUTION, layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({
    title: TEST,
    layer: "AssumptionTest",
    evidence: "assertion",
    body: "x",
    tags: [],
    links: [],
    instrument: "npx vitest run test/a.test.ts",
  });
  v.linkNodes(OUTCOME, "Users churn after week one");
  v.linkNodes("Users churn after week one", SOLUTION);
  v.linkNodes(SOLUTION, TEST);
  return v;
}

/**
 * A repo whose named spec exits with `code`. Real process, real exit status —
 * the property under test is what a WATCHED exit code may touch, so the exit
 * code has to come from something that actually ran.
 */
function repoWithSpec(code: number) {
  fs.mkdirSync(path.join(repo, "node_modules", ".bin"), { recursive: true });
  fs.mkdirSync(path.join(repo, "test"), { recursive: true });
  fs.writeFileSync(path.join(repo, "test", "a.test.ts"), "// a spec that exists\n", "utf8");
  const bin = path.join(repo, "node_modules", ".bin", "vitest");
  fs.writeFileSync(bin, `#!/bin/sh\necho "FAIL test/a.test.ts"\nexit ${code}\n`, "utf8");
  fs.chmodSync(bin, 0o755);
}

/** The raw bytes of a node's file — what the runner actually left on disk. */
function raw(title: string): string {
  return fs.readFileSync(path.join(dir, `${title}.md`), "utf8");
}

/**
 * The four containments, asserted against the state a run left behind. Named
 * once because every recorded observation — red or green — owes all four.
 */
function expectContained(v: ReturnType<typeof vaultWithInstrument>, bodyBefore: string) {
  const node = v.read(TEST);

  // 1. It appends to the instrument log only: strip the log section and the
  //    body is byte-for-byte what it was before the run.
  const logStart = node.body.indexOf(INSTRUMENT_LOG_HEADING);
  expect(logStart).toBeGreaterThanOrEqual(0);
  expect(node.body.slice(0, logStart).trimEnd()).toBe(bodyBefore.trimEnd());

  // 2. It never writes `## Results` — not the heading, not a result the
  //    evidence engine would count.
  expect(raw(TEST)).not.toContain(RESULTS_HEADING);
  expect(hasRecordedResult(node)).toBe(false);

  // 3. It never changes the node's status. The fixture's node carries none —
  //    and after the run it still carries none, rather than any the runner
  //    might have minted ("validated" being the tempting one).
  expect(node.status).toBeUndefined();
  expect(raw(TEST)).not.toContain("status:");

  // 4. The solution's evidence gate still reports BLOCKED: no assumption test
  //    beneath it has a recorded result, whatever the instrument log says.
  const gate = gateSolution(v.readTree(), SOLUTION);
  expect(gate.cleared).toBe(false);
  expect(gate.reason).toMatch(/none run/);
}

describe("a recorded exit code cannot clear a gate or masquerade as a result", () => {
  test("a red observation writes one log line and touches nothing a gate reads", () => {
    const v = vaultWithInstrument();
    const bodyBefore = v.read(TEST).body;
    repoWithSpec(1);

    verifyInstrument(dir, { test: TEST, repo });

    expect(instrumentLog(v.read(TEST))).toHaveLength(1);
    expectContained(v, bodyBefore);
  });

  test("exit code 0 — the tempting case — is contained exactly the same way", () => {
    const v = vaultWithInstrument();
    const bodyBefore = v.read(TEST).body;
    repoWithSpec(1);
    verifyInstrument(dir, { test: TEST, repo });
    repoWithSpec(0);

    const outcome = verifyInstrument(dir, { test: TEST, repo });

    // The green was recorded — this is the build completing, a real event...
    expect(outcome.run.exitCode).toBe(0);
    expect(instrumentLog(v.read(TEST))).toHaveLength(2);
    // ...and it still cleared nothing: same four containments as the red.
    expectContained(v, bodyBefore);
  });

  test("a refused observation leaves the node byte-for-byte untouched", () => {
    const v = vaultWithInstrument();
    const before = raw(TEST);
    repoWithSpec(0);

    // First-run green is refused upstream (red-before-green); what this pins is
    // that the refusal wrote NOTHING — a refused run must not leave a residue
    // a later reader could mistake for an observation.
    expect(() => verifyInstrument(dir, { test: TEST, repo })).toThrow();
    expect(raw(TEST)).toBe(before);
    expect(gateSolution(v.readTree(), SOLUTION).cleared).toBe(false);
  });

  test("the green observation is not readable as a result by the evidence engine", () => {
    const v = vaultWithInstrument();
    repoWithSpec(1);
    verifyInstrument(dir, { test: TEST, repo });
    repoWithSpec(0);
    verifyInstrument(dir, { test: TEST, repo });

    // The gate's own accounting: the test is still "proposed, none run" — the
    // observation moved the build ledger and left the evidence ledger alone.
    const gate = gateSolution(v.readTree(), SOLUTION);
    expect(gate.debt?.state).toBe("proposed");
    expect(gate.debt?.outstanding).toContain(TEST);
  });
});
