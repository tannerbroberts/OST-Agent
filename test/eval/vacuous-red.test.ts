/**
 * A red only counts when it is red about something.
 *
 * The build permit rests on one claim: an instrument observed failing against the
 * real repository is a falsifiable prediction, so the agent that wrote it staked
 * something and the repository refuted it. `knowledge/instruments.ts` states the
 * reason the closed form is safe — "an agent cannot author the outcome, only name
 * the file" — and that argument holds only while the file exists. Name a file
 * nobody has written and the outcome is authored completely: the command fails,
 * every time, for every question anyone could write on that path.
 *
 * That failure mode is not theoretical and was not rare. On 2026-08-09 the meta
 * vault held 266 recorded reds, of which 260 read "No test files found" and 241
 * pointed at spec files that had never existed. The tree's entire stock of
 * evidence that its tests were capable of failing was evidence that its specs
 * were unwritten — and each one had minted a build permit whose stated definition
 * of done ("this command fails today and passes when the solution is built") an
 * empty file would have satisfied.
 *
 * What this file pins:
 *
 * - a missing spec is observed `no-spec`, never `red`, and mints no permit;
 * - a spec that exists and fails on an assertion is still a real red;
 * - the vacuous run is FILED rather than refused, because "this spec was never
 *   written" is the actionable fact and the node should keep it;
 * - a permit recorded red before the distinction existed is caught at spend time,
 *   since the log is append-only and cannot be corrected in place;
 * - the refusal tells the builder to write the failing spec, which is the work.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { instrumentLog, observedNoSpec, observedRed, verifyInstrument } from "../../src/ost/instrument.js";
import { buildPermit, confirmPermit } from "../../src/eval/buildable.js";

const OUTCOME = "Retention";
const SOLUTION = "Onboarding checklist";
const TEST = "Checklist audit";
const INSTRUMENT = "npx vitest run test/a.test.ts";

let dir: string;
let repo: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-vacuous-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-vacuous-repo-"));
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

/** A runner that reports the way vitest does when it collects nothing. */
function runnerCollectingNothing() {
  fs.mkdirSync(path.join(repo, "node_modules", ".bin"), { recursive: true });
  const bin = path.join(repo, "node_modules", ".bin", "vitest");
  fs.writeFileSync(bin, `#!/bin/sh\necho "No test files found, exiting with code 1"\nexit 1\n`, "utf8");
  fs.chmodSync(bin, 0o755);
}

/** A repo where the spec exists and exits with `code` — a red about behaviour. */
function repoWithRealSpec(code: number) {
  fs.mkdirSync(path.join(repo, "node_modules", ".bin"), { recursive: true });
  fs.mkdirSync(path.join(repo, "test"), { recursive: true });
  fs.writeFileSync(path.join(repo, "test", "a.test.ts"), "// a spec that exists\n", "utf8");
  const bin = path.join(repo, "node_modules", ".bin", "vitest");
  fs.writeFileSync(bin, `#!/bin/sh\necho "FAIL test/a.test.ts > expected 3 got 0"\nexit ${code}\n`, "utf8");
  fs.chmodSync(bin, 0o755);
}

describe("a command red because its spec is missing is not a red", () => {
  test("a spec file that does not exist is observed no-spec, and mints no permit", () => {
    // No test/a.test.ts anywhere in the repo — the shape 241 nodes were in.
    runnerCollectingNothing();

    const outcome = verifyInstrument(dir, { test: TEST, repo });

    expect(outcome.run.observation).toBe("no-spec");
    const node = buildPassContext(dir).vault.read(TEST);
    expect(observedNoSpec(node)).toBe(true);
    expect(observedRed(node)).toBe(false);
    expect(buildPermit(buildPassContext(dir).vault.readTree(), SOLUTION).cleared).toBe(false);
  });

  test("the observation is filed, not refused — the node should carry the fact", () => {
    runnerCollectingNothing();
    verifyInstrument(dir, { test: TEST, repo });

    const log = instrumentLog(buildPassContext(dir).vault.read(TEST));
    // One line, under its own marker, naming the command it ran. Refusing
    // outright would leave the node looking un-run, which is a different and less
    // actionable state than "its spec was never written".
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/\*\*no-spec\*\*/);
    expect(log[0]).toContain(INSTRUMENT);
    expect(log[0]).toMatch(/a\.test\.ts/);
  });

  test("the missing file is answered without starting a runner at all", () => {
    // No vitest binary in this repo whatsoever. If the filesystem question were
    // not asked first, this would fail to spawn rather than report no-spec — and
    // the queue of unwritten specs is meant to be re-checked every pass, so it
    // has to be free.
    const outcome = verifyInstrument(dir, { test: TEST, repo });

    expect(outcome.run.observation).toBe("no-spec");
    expect(outcome.run.exitCode).toBeNull();
    expect(outcome.run.excerpt).toMatch(/does not exist/);
  });

  test("a spec that exists but collects no cases is also no-spec", () => {
    // The file is there and the runner still found nothing in it: an empty spec,
    // or one whose cases are all skipped. Non-zero, and still not a measurement.
    fs.mkdirSync(path.join(repo, "test"), { recursive: true });
    fs.writeFileSync(path.join(repo, "test", "a.test.ts"), "// no cases\n", "utf8");
    runnerCollectingNothing();

    expect(verifyInstrument(dir, { test: TEST, repo }).run.observation).toBe("no-spec");
    expect(observedRed(buildPassContext(dir).vault.read(TEST))).toBe(false);
  });

  test("a spec that exists and fails on an assertion is still a real red", () => {
    // The distinction must not swallow the case it exists to protect.
    repoWithRealSpec(1);

    expect(verifyInstrument(dir, { test: TEST, repo }).run.observation).toBe("red");
    expect(observedRed(buildPassContext(dir).vault.read(TEST))).toBe(true);
    expect(buildPermit(buildPassContext(dir).vault.readTree(), SOLUTION).cleared).toBe(true);
  });

  test("writing the spec turns a no-spec node into a buildable red, with its history intact", () => {
    runnerCollectingNothing();
    verifyInstrument(dir, { test: TEST, repo });
    expect(buildPermit(buildPassContext(dir).vault.readTree(), SOLUTION).cleared).toBe(false);

    // The builder does the work the refusal named: writes the failing spec.
    repoWithRealSpec(1);
    verifyInstrument(dir, { test: TEST, repo });

    const node = buildPassContext(dir).vault.read(TEST);
    expect(observedRed(node)).toBe(true);
    expect(buildPermit(buildPassContext(dir).vault.readTree(), SOLUTION).cleared).toBe(true);
    // Append-only: the no-spec line is still there. A run that happened, happened.
    expect(instrumentLog(node)).toHaveLength(2);
    expect(instrumentLog(node)[0]).toMatch(/\*\*no-spec\*\*/);
  });
});

describe("a red recorded before the distinction existed is caught at spend time", () => {
  /**
   * The legacy shape, reproduced exactly: a `**red**` line filed by an older
   * build against a repository with no spec file. The log is append-only and must
   * not be rewritten, so the recorded line stays wrong forever — which is why the
   * catch has to be a re-run rather than a migration.
   */
  function legacyRedWithNoSpec() {
    const v = buildPassContext(dir).vault;
    v.appendUnderSection(TEST, "## Instrument log", `- 2026-08-05 **red** (exit 1) \`${INSTRUMENT}\` — No test files found, exiting with code 1`);
    const permit = buildPermit(buildPassContext(dir).vault.readTree(), SOLUTION);
    // The tree still offers it, because the tree only has the line.
    expect(permit.cleared).toBe(true);
    return permit;
  }

  test("the permit is refused when the command turns out to measure nothing", () => {
    const permit = legacyRedWithNoSpec();
    runnerCollectingNothing();

    const confirmed = confirmPermit(permit, repo);

    expect(confirmed.cleared).toBe(false);
    // Not "spent" — nothing was built and nothing was completed. Marking it spent
    // would tell the builder to go and file a green, which is the opposite move.
    expect(confirmed.spent).toBeUndefined();
    expect(confirmed.test).toBe(TEST);
    expect(confirmed.instrument).toBe(INSTRUMENT);
  });

  test("the refusal names the work: write the failing spec first", () => {
    const permit = legacyRedWithNoSpec();
    runnerCollectingNothing();

    const { reason } = confirmPermit(permit, repo);

    // The builder has only this string, so it has to carry the next move rather
    // than just the diagnosis.
    expect(reason).toContain(TEST);
    expect(reason).toContain(INSTRUMENT);
    expect(reason).toMatch(/failing spec/i);
    // And it has to say why the red was worthless, or the next pass writes the
    // same filename again.
    expect(reason).toMatch(/equally red|every question/i);
  });

  test("confirming a vacuous permit records nothing", () => {
    const permit = legacyRedWithNoSpec();
    runnerCollectingNothing();
    const before = instrumentLog(buildPassContext(dir).vault.read(TEST));

    confirmPermit(permit, repo);

    // `ost-agent verify` is still the only door into the log.
    expect(instrumentLog(buildPassContext(dir).vault.read(TEST))).toEqual(before);
  });

  test("a legacy red whose spec does exist still clears — this narrows nothing it should not", () => {
    const permit = legacyRedWithNoSpec();
    repoWithRealSpec(1);

    expect(confirmPermit(permit, repo).cleared).toBe(true);
  });
});
