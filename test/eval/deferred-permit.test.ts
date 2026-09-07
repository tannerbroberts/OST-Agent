/**
 * A retired solution holds no build permit, however red its instrument is.
 *
 * The three refusals `buildPermit` already made are all about the instrument
 * going stale — never run, vacuously red, or green since. This one is about the
 * question being closed, and it is the one the tree paid for.
 *
 * "Ask the open question first, and offer options only once the frame is agreed"
 * (`ost-agent-meta`) carries a pre-committed threshold its own instrument
 * measures against the recorded corpus, and the corpus refuted it: two-stage
 * framing would have cost 92 operator turns against one-stage's actual 72 across
 * 46 recorded questions. It was deferred on 2026-08-16 with that entry in its
 * `## History`. Its instrument stayed red — it stays red *because* the solution
 * is refuted, since the assertion is the refutation — and `ost-agent buildable`
 * kept answering CLEARED, so the build loop selected it again on 2026-08-19
 * (PR #130), again later that day (PR #171), and again on 2026-09-07, each pass
 * re-deriving the same falsification and shipping nothing. The node's own
 * `## Issues` filed it: "worth a human checking whether the build loop's
 * target-selection logic actually excludes `deferred` nodes." It did not.
 *
 * The rule pinned here is narrow: `status: deferred` on the SOLUTION withdraws
 * the permit, before the instrument log is consulted at all. It is not a claim
 * about desirability — that is `gateSolution`'s question and it stays there.
 * It is the same definedness argument `solutionsMissingInstruments` already
 * makes for the same status in the same file: a solution the tree has retired
 * has no unbuilt behaviour left for a red command to define.
 *
 * The status is agent-settable, which is exactly why the refusal quotes the
 * `## History` entry that set it: a caller can read the reason and disagree with
 * it, which is not something a bare boolean permits.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { verifyInstrument } from "../../src/ost/instrument.js";
import { buildPermit, buildableSolutions } from "../../src/eval/buildable.js";
import { reflectionBinding } from "../../src/loop/reflection.js";

const OUTCOME = "Retention";
const SOLUTION = "Ask the open question first";
const TEST = "Replay the recorded question sessions";
const INSTRUMENT = "npx vitest run test/a.test.ts";

let dir: string;
let repo: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-deferred-permit-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-deferred-repo-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
  const v = buildPassContext(dir).vault;
  v.createNode({ title: "Answers cost turns", layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
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
  v.linkNodes(OUTCOME, "Answers cost turns");
  v.linkNodes("Answers cost turns", SOLUTION);
  v.linkNodes(SOLUTION, TEST);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

/**
 * A repository whose spec exists and exits 1 — a red about behaviour, not the
 * `no-spec` shape `test/eval/vacuous-red.test.ts` pins. The observation is made
 * by running a real process, as everywhere else on this path: a permit that
 * rested on a stubbed exit code would not be resting on anything.
 */
function repoWithFailingSpec() {
  fs.mkdirSync(path.join(repo, "node_modules", ".bin"), { recursive: true });
  fs.mkdirSync(path.join(repo, "test"), { recursive: true });
  fs.writeFileSync(path.join(repo, "test", "a.test.ts"), "// a spec that exists\n", "utf8");
  const bin = path.join(repo, "node_modules", ".bin", "vitest");
  fs.writeFileSync(bin, `#!/bin/sh\necho "FAIL test/a.test.ts"\nexit 1\n`, "utf8");
  fs.chmodSync(bin, 0o755);
}

/** The state every case below starts from: a genuinely red instrument, observed. */
function observeRed() {
  repoWithFailingSpec();
  verifyInstrument(dir, { test: TEST, repo });
  return buildPassContext(dir).vault;
}

describe("a red instrument under a live solution is still a permit", () => {
  test("non-vacuity: without the deferral, every case below would clear", () => {
    // The control. If this stopped clearing, the assertions further down would
    // pass for a reason that has nothing to do with the status they name.
    const v = observeRed();
    const permit = buildPermit(v.readTree(), SOLUTION);
    expect(permit.cleared).toBe(true);
    expect(permit.instrument).toBe(INSTRUMENT);
    expect(permit.deferred).toBeUndefined();
    expect(buildableSolutions(v.readTree()).map((b) => b.solution)).toEqual([SOLUTION]);
  });
});

describe("deferring the solution withdraws the permit", () => {
  test("the permit is refused, and says the status rather than the instrument did it", () => {
    const v = observeRed();
    v.setStatus(SOLUTION, "deferred", "the replay refuted it: two-stage cost 92 turns against one-stage's 72");

    const permit = buildPermit(v.readTree(), SOLUTION);
    expect(permit.cleared).toBe(false);
    expect(permit.deferred).toBe(true);
    // The distinction a caller acts on: this is not work the discovery loop can
    // fix by writing a better instrument.
    expect(permit.reason).toMatch(/deferred/i);
    expect(permit.reason).toMatch(/no unbuilt behaviour left/i);
  });

  test("the refusal quotes the History entry that retired it, so the reason can be argued with", () => {
    const v = observeRed();
    v.setStatus(SOLUTION, "deferred", "the replay refuted it: two-stage cost 92 turns against one-stage's 72");

    // `deferred` is agent-settable. A refusal that only said "deferred" would be
    // a verdict with its evidence stripped off, which is the shape this vault
    // refuses everywhere else.
    expect(buildPermit(v.readTree(), SOLUTION).reason).toContain("two-stage cost 92 turns");
  });

  test("a deferral with no recorded reason says so instead of implying one", () => {
    const v = observeRed();
    v.setStatus(SOLUTION, "deferred");
    const permit = buildPermit(v.readTree(), SOLUTION);
    expect(permit.cleared).toBe(false);
    expect(permit.reason).toMatch(/Nothing in its `## History` records why/);
  });

  test("it drops out of the buildable queue, which is what the loop selects from", () => {
    // `buildableSolutions` is the candidate set `product/planner.ts` ranks and
    // the build loop picks a target out of. The permit refusing while the queue
    // still offered the node would have fixed nothing.
    const v = observeRed();
    expect(buildableSolutions(v.readTree()).map((b) => b.solution)).toEqual([SOLUTION]);
    v.setStatus(SOLUTION, "deferred", "refuted by the replay");
    expect(buildableSolutions(v.readTree())).toEqual([]);
  });

  test("the reflection binding stops treating it as a pass with a live instrument", () => {
    // The other reader of this permit. It binds the loop's self-reflection
    // questions to whatever cleared the pass; bound to a retired solution, every
    // one of those questions is about work nobody did.
    const v = observeRed();
    expect(reflectionBinding(v.readTree(), SOLUTION)?.permit).toBe("instrument");
    v.setStatus(SOLUTION, "deferred", "refuted by the replay");
    expect(reflectionBinding(v.readTree(), SOLUTION)).toBeNull();
  });
});

describe("what the rule does not reach", () => {
  test("deferring the TEST does not withdraw the permit — the status is read off the solution", () => {
    // Deliberately narrow. A test is not a candidate anybody chose to abandon;
    // the node that carries the decision to stop is the solution, and widening
    // this to any deferred descendant would let a status on a leaf silently
    // retire work nobody retired.
    const v = observeRed();
    v.setStatus(TEST, "deferred", "not the node that decides");
    expect(buildPermit(v.readTree(), SOLUTION).cleared).toBe(true);
  });

  test("restoring the status restores the permit — the refusal is a status, not a tombstone", () => {
    const v = observeRed();
    v.setStatus(SOLUTION, "deferred", "refuted by the replay");
    expect(buildPermit(v.readTree(), SOLUTION).cleared).toBe(false);
    v.setStatus(SOLUTION, "unvalidated", "reopened: the corpus grew");
    expect(buildPermit(v.readTree(), SOLUTION).cleared).toBe(true);
  });
});
