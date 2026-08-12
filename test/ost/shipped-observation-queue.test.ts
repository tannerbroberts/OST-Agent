/**
 * A shipped solution asks for an observation, never for a red command — the
 * feasibility question behind "A shipped solution's claim is settleable by
 * running one named spec".
 *
 * `solutionsMissingInstruments` already drops a trusted-shipped solution from
 * its queue (`trustsShippedStatus`), and dropping it there is right: no
 * command can be red-today about behaviour that already exists. But the same
 * exclusion left the shipped solution with nothing further asked of it — the
 * mechanism it claims is exactly the kind of question the repository can
 * settle mechanically, and until now nothing did.
 *
 * The four assertions this pins, all pre-committed on the AssumptionTest: a
 * shipped solution with no recorded run (1) surfaces in a queue that asks for
 * an observation and (2) never in `solutionsMissingInstruments`; the write
 * boundary (3) accepts a green command for it, and — the one that matters —
 * (4) still refuses a green first run for a solution that is not trusted as
 * shipped. Breaking (4) would mean the red-now rule bent for everyone, not
 * just for shipped work, and the whole thing should be abandoned rather than
 * repaired.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { verifyInstrument, instrumentLog } from "../../src/ost/instrument.js";

const OUTCOME = "Retention";
const SHIPPED = "Onboarding checklist";
const UNSHIPPED = "Referral prompt";
let dir: string;
let repo: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-shipped-obs-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-shipped-obs-repo-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

/** A repo whose named spec exits with `code` — a real process, really watched. */
function repoWithSpec(target: string, code: number) {
  fs.mkdirSync(path.join(repo, "node_modules", ".bin"), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(repo, target)), { recursive: true });
  fs.writeFileSync(path.join(repo, target), "// a spec that exists\n", "utf8");
  const bin = path.join(repo, "node_modules", ".bin", "vitest");
  fs.writeFileSync(bin, `#!/bin/sh\necho "FAIL ${target}"\nexit ${code}\n`, "utf8");
  fs.chmodSync(bin, 0o755);
}

/**
 * A trusted-shipped solution whose one test carries an instrument nobody has
 * run yet — "no recorded run" is the fixture's whole point, so the History
 * promotion is the only thing written about it.
 */
function shippedSolution() {
  const v = buildPassContext(dir).vault;
  v.createNode({ title: "Users churn after week one", layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({ title: SHIPPED, layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({
    title: "Checklist audit",
    layer: "AssumptionTest",
    evidence: "assertion",
    body: "x",
    tags: [],
    links: [],
    instrument: "npx vitest run test/a.test.ts",
  });
  v.linkNodes(OUTCOME, "Users churn after week one");
  v.linkNodes("Users churn after week one", SHIPPED);
  v.linkNodes(SHIPPED, "Checklist audit");
  v.setStatus(SHIPPED, "shipped", "shipped in v0.1.0; the guard lives at the write funnel");
  return v;
}

/** An unbuilt solution whose one test is prose only — the shape the red-now queue asks about. */
function unshippedSolution(v = buildPassContext(dir).vault) {
  v.createNode({ title: "Referrals never get sent", layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({ title: UNSHIPPED, layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({ title: "Referral prompt copy test", layer: "AssumptionTest", evidence: "assertion", body: "prose only", tags: [], links: [] });
  v.linkNodes(OUTCOME, "Referrals never get sent");
  v.linkNodes("Referrals never get sent", UNSHIPPED);
  v.linkNodes(UNSHIPPED, "Referral prompt copy test");
  return v;
}

describe("the two queues", () => {
  test("a shipped solution with no recorded run asks for an observation, not a red command", () => {
    const v = shippedSolution();
    unshippedSolution(v);

    const work = computeNextWork(v, dir, 1);
    expect(work.solutionsAwaitingObservation).toContain(SHIPPED);
    expect(work.solutionsMissingInstruments).not.toContain(SHIPPED);

    expect(work.solutionsMissingInstruments).toContain(UNSHIPPED);
    expect(work.solutionsAwaitingObservation).not.toContain(UNSHIPPED);
  });

  test("recording the observation drains the queue", () => {
    const v = shippedSolution();
    repoWithSpec("test/a.test.ts", 0);
    verifyInstrument(dir, { test: "Checklist audit", repo });
    expect(computeNextWork(v, dir, 1).solutionsAwaitingObservation).not.toContain(SHIPPED);
  });
});

describe("the write boundary", () => {
  test("accepts a green command for a solution trusted as shipped", () => {
    const v = shippedSolution();
    repoWithSpec("test/a.test.ts", 0);

    const outcome = verifyInstrument(dir, { test: "Checklist audit", repo });
    expect(outcome.run.observation).toBe("green");
    expect(outcome.transitioned).toBe(false); // an observation, not a red→green build completion
    expect(instrumentLog(v.read("Checklist audit"))).toEqual([
      expect.stringContaining("**green**"),
    ]);
  });

  test("still refuses a green first run for a solution that is not trusted as shipped", () => {
    const v = unshippedSolution();
    v.setInstrument("Referral prompt copy test", "npx vitest run test/b.test.ts", "measures the copy variant");
    repoWithSpec("test/b.test.ts", 0);

    expect(() => verifyInstrument(dir, { test: "Referral prompt copy test", repo })).toThrow(
      /green before anything was built/i,
    );
    expect(instrumentLog(v.read("Referral prompt copy test"))).toEqual([]);
  });

  test("a shipped status with no reasoned promotion does not buy the exemption either", () => {
    shippedSolution();
    // Strip the History line the promotion note wrote — the status field still
    // says shipped, but nothing says why, which is the shape
    // `trustsShippedStatus` already refuses to trust.
    const file = path.join(dir, `${SHIPPED}.md`);
    const raw = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, raw.replace(/^- \d{4}-\d{2}-\d{2}.*status:.*shipped.*$/m, ""), "utf8");

    repoWithSpec("test/a.test.ts", 0);
    expect(() => verifyInstrument(dir, { test: "Checklist audit", repo })).toThrow(
      /green before anything was built/i,
    );
  });
});
