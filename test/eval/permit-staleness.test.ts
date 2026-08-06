/**
 * A permit is a claim about now; a recorded observation is a claim about a day.
 *
 * `buildPermit` reads the node and runs nothing, which is right for the sweep it
 * sits on — but it means a cleared permit stays cleared for exactly as long as
 * nobody re-observes the instrument, and the build loop deliberately never
 * re-observes one it has already seen red (`testsAwaitingVerification` skips
 * anything already observed, in either direction). So every path that turns an
 * instrument green from outside the loop leaves a permit that still reads live.
 *
 * That is not a hypothetical failure mode. On 2026-08-06 this loop dispatched a
 * full model pass at "A model reads the raw transcript and files what the pattern
 * scan cannot see", whose test had been recorded red on 2026-08-05 with "No test
 * files found" and whose spec file had merged 17 minutes earlier. The builder
 * arrived at a definition of done that was already met.
 *
 * `confirmPermit` is the check that would have caught it: run the command, and
 * refuse the permit as SPENT when it passes. What this file pins is the shape of
 * that refusal — fail-closed on green, unchanged on red, and recording NOTHING,
 * because the instrument log has exactly one door (`ost-agent verify`) and a
 * second one would be a build permit a caller could mint for itself.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { verifyInstrument, instrumentLog } from "../../src/ost/instrument.js";
import { buildPermit, confirmPermit } from "../../src/eval/buildable.js";

const OUTCOME = "Retention";
const SOLUTION = "Onboarding checklist";
const TEST = "Checklist audit";
const INSTRUMENT = "npx vitest run test/a.test.ts";

let dir: string;
let repo: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-permit-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-permit-repo-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
  const v = buildPassContext(dir).vault;
  v.createNode({ title: "Users churn", layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({ title: SOLUTION, layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({
    title: TEST,
    layer: "AssumptionTest",
    evidence: "assertion",
    body: "x",
    tags: [],
    links: [],
    instrument: INSTRUMENT,
  });
  v.linkNodes(OUTCOME, "Users churn");
  v.linkNodes("Users churn", SOLUTION);
  v.linkNodes(SOLUTION, TEST);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

/**
 * A repository whose named spec exits with `code`. A real process with a real
 * exit status, as in `test/ost/instrument.test.ts` — the whole claim here is that
 * something was watched, so stubbing the runner would pin the wrong thing.
 */
function repoWithSpec(code: number) {
  fs.mkdirSync(path.join(repo, "node_modules", ".bin"), { recursive: true });
  const bin = path.join(repo, "node_modules", ".bin", "vitest");
  fs.writeFileSync(bin, `#!/bin/sh\necho "FAIL test/a.test.ts"\nexit ${code}\n`, "utf8");
  fs.chmodSync(bin, 0o755);
}

/** The state the loop dispatches from: an observation of red, filed some day. */
function recordedRed() {
  repoWithSpec(1);
  verifyInstrument(dir, { test: TEST, repo });
  const v = buildPassContext(dir).vault;
  const permit = buildPermit(v.readTree(), SOLUTION);
  expect(permit.cleared).toBe(true);
  return permit;
}

describe("a recorded red is confirmed against the repository before it is spent on", () => {
  test("a red that is still red clears, unchanged", () => {
    const permit = recordedRed();
    const confirmed = confirmPermit(permit, repo);

    expect(confirmed.cleared).toBe(true);
    expect(confirmed.instrument).toBe(INSTRUMENT);
    expect(confirmed.test).toBe(TEST);
    expect(confirmed.spent).toBeUndefined();
  });

  test("a red that has since gone green is refused as spent, not cleared", () => {
    const permit = recordedRed();
    // The build lands from somewhere this loop never looked: another branch,
    // another PR, a dependency. The node still says red.
    repoWithSpec(0);

    const confirmed = confirmPermit(permit, repo);

    expect(confirmed.cleared).toBe(false);
    expect(confirmed.spent).toBe(true);
    // The refusal has to name the test, because the useful next move is to go
    // and file the green on it — and the caller has only this string.
    expect(confirmed.test).toBe(TEST);
    expect(confirmed.reason).toContain(TEST);
    expect(confirmed.reason).toContain(INSTRUMENT);
    expect(confirmed.reason).toMatch(/spent/i);
    expect(confirmed.reason).toMatch(/verify/);
  });

  test("confirming records nothing — the instrument log has one door and this is not it", () => {
    const permit = recordedRed();
    repoWithSpec(0);
    const before = instrumentLog(buildPassContext(dir).vault.read(TEST));

    confirmPermit(permit, repo);

    // A green filed here would be an observation authored by whoever asked
    // whether they might build, which is the permit-minting shape `verify` is
    // CLI-only to prevent.
    expect(instrumentLog(buildPassContext(dir).vault.read(TEST))).toEqual(before);
    expect(before.filter((l) => /\*\*green\*\*/i.test(l))).toEqual([]);
  });

  test("the tree's own answer is unchanged — this narrows a permit, it never widens one", () => {
    const v = buildPassContext(dir).vault;
    // A blocked permit is returned untouched and costs no run: there is nothing
    // to confirm, and confirming must never be able to clear something.
    const blocked = buildPermit(v.readTree(), SOLUTION);
    expect(blocked.cleared).toBe(false);
    repoWithSpec(1);

    let ran = 0;
    const confirmed = confirmPermit(blocked, repo, (i, d) => {
      ran += 1;
      return { observation: "red", exitCode: 1, excerpt: `${i.command} in ${d}` };
    });

    expect(ran).toBe(0);
    expect(confirmed).toEqual(blocked);
  });

  test("a permit is confirmed against the repository it names, not the cwd", () => {
    const permit = recordedRed();
    let sawDir = "";
    confirmPermit(permit, repo, (_i, d) => {
      sawDir = d;
      return { observation: "red", exitCode: 1, excerpt: "" };
    });

    expect(sawDir).toBe(repo);
  });

  test("a spent permit is spent for the loop too: the same call refuses on the next firing", () => {
    const permit = recordedRed();
    repoWithSpec(0);

    // Nothing was recorded, so the tree still offers it — which is exactly why
    // the confirmation has to be at the point of spend rather than a one-off
    // migration. It refuses every time until somebody files the green.
    expect(confirmPermit(buildPermit(buildPassContext(dir).vault.readTree(), SOLUTION), repo).spent).toBe(true);
    expect(confirmPermit(buildPermit(buildPassContext(dir).vault.readTree(), SOLUTION), repo).spent).toBe(true);

    // And once it IS filed, the tree stops offering it at all.
    verifyInstrument(dir, { test: TEST, repo });
    expect(buildPermit(buildPassContext(dir).vault.readTree(), SOLUTION).cleared).toBe(false);
    expect(permit.cleared).toBe(true); // the stale object it started from
  });
});
