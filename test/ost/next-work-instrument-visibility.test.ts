/**
 * "Carrying the instrument field pushes no visible entry out of the sweep."
 *
 * The failure this descends from was a read that did not answer the question the
 * write turns on. `ost_set_instrument` does two jobs behind one call — attach a
 * command to a test that has none, replace the command on one that has — and the
 * second deliberately un-clears any build permit the old command earned. On
 * 2026-08-07 an unattended pass working the instrument backlog picked a test off
 * `ost_next_work` BY TITLE, believing it prose-only, and replaced a
 * repository-grounded command with a path invented by a pass that had never seen
 * the repository. It reverted the swap, could not revert the permit, and stopped
 * its instrument work as unsafe to perform blind. The sweep reported which
 * *solutions* lacked an instrument; it never reported which *tests* had one.
 *
 * What is pinned here is the candidate's own pre-committed threshold, and it has
 * two halves that pull against each other on purpose:
 *
 *   1. **Every test named in the response carries an `instrument` field or an
 *      explicit null.** The explicit-null clause is load-bearing rather than
 *      tidy: every list here is capped, so a field present only when set is
 *      indistinguishable to a reader from a field dropped for room — which is the
 *      same ambiguity, one level up.
 *   2. **Nothing was pushed out to pay for it.** The field is added to a response
 *      that was already being truncated, so the risk the candidate names is that
 *      the pass gains a field and loses entries. Every capped list still returns
 *      its full 25.
 *
 * The fixture is deliberately built at the scale the threshold names — 337
 * assumption tests, 62 solutions missing instruments — rather than at a
 * convenient one, because the whole objection is about a response that is already
 * being cut.
 *
 * Every expected value below is re-derived from the tree, never read back out of
 * the response: a field that agreed with itself would pass this file while
 * naming one test's title beside another's command.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork, MAX_ITEMS_PER_LIST, type NextWork } from "../../src/mcp/next-work.js";
import { solutionsMissingInstruments } from "../../src/eval/buildable.js";
import type { OstNode } from "../../src/ost/node.js";
import type { Vault } from "../../src/ost/vault.js";

const OUTCOME = "Retention";

/** The scale the threshold names. */
const TESTS = 337;
const SOLUTIONS_MISSING_INSTRUMENTS = 62;

/** The response budget the Z2 criterion sets, in bytes — the other half of "affordable". */
const BUDGET = 200 * 1024;

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-instrument-visibility-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
}, 120_000);
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Opportunities, solutions and tests, wired the way a real vault is. */
const OPPORTUNITIES = 70;
const SOLUTIONS = 100;
/** Solutions `0..61` carry prose-only tests; the rest carry instrumented ones. */
const BARE_SOLUTIONS = SOLUTIONS_MISSING_INSTRUMENTS;
/** How many compute-only tests are given a prerequisite, to fill that bucket past the cap. */
const BLOCKED = 30;

const opportunity = (i: number): string => `Customers cannot finish step ${i}`;
const solution = (i: number): string => `Ship the step-${i} rework`;
const assumptionTest = (i: number): string => `Test whether the step-${i} rework holds`;

/**
 * Build a tree at the threshold's scale.
 *
 * The lane assignment is not decoration — it is what puts more than 25 tests in
 * each bucket, which is the only way "all four capped lists still return 25"
 * asserts anything. Instrumented tests take the three compute-reachable lanes;
 * the prose-only ones take `humans-required` and unlabelled, so no test ever
 * carries a command AND a lane saying a person is the measurement (which is a
 * lane conflict, and a different test's subject).
 */
function buildFixture(vault: Vault): void {
  for (let i = 0; i < OPPORTUNITIES; i++) {
    vault.createNode({ title: opportunity(i), layer: "Opportunity", evidence: "observed", source: "INBOX:n.md", body: "b", tags: [], links: [] });
    vault.linkNodes(OUTCOME, opportunity(i));
  }
  for (let i = 0; i < SOLUTIONS; i++) {
    vault.createNode({ title: solution(i), layer: "Solution", evidence: "observed", body: "b", tags: [], links: [] });
    vault.linkNodes(opportunity(i % OPPORTUNITIES), solution(i));
  }

  // One prose-only test per bare solution: that, and only that, is what puts a
  // solution on `solutionsMissingInstruments`.
  for (let i = 0; i < BARE_SOLUTIONS; i++) {
    vault.createNode({
      title: assumptionTest(i),
      layer: "AssumptionTest",
      evidence: "observed",
      body: "b",
      tags: [],
      links: [],
      // Half labelled, half not. Both land in `needsHumans` — the second by the
      // lanes' fail-closed rule — and the field has to be reported for each.
      ...(i % 2 === 0 ? { lane: "humans-required" as const } : {}),
    });
    vault.linkNodes(solution(i), assumptionTest(i));
  }

  // The rest carry a command, spread over the solutions that are NOT on the
  // bare list, and over the three lanes compute can reach.
  const LANES = ["compute-only", "one-command", "pending-permission"] as const;
  for (let i = BARE_SOLUTIONS; i < TESTS; i++) {
    const host = BARE_SOLUTIONS + ((i - BARE_SOLUTIONS) % (SOLUTIONS - BARE_SOLUTIONS));
    vault.createNode({
      title: assumptionTest(i),
      layer: "AssumptionTest",
      evidence: "observed",
      body: "b",
      tags: [],
      links: [],
      lane: LANES[i % LANES.length],
      instrument: `npx vitest run test/generated/step-${i}.test.ts`,
    });
    vault.linkNodes(solution(host), assumptionTest(i));
  }

  // A prerequisite edge moves a test out of its lane bucket and into
  // `blockedOnPrerequisite`, which is the fifth list that names a test. All of
  // them wait on the same unresulted test, so no cycle is possible.
  const anchor = assumptionTest(TESTS - 1);
  let blocked = 0;
  for (let i = BARE_SOLUTIONS; i < TESTS - 1 && blocked < BLOCKED; i++) {
    if (LANES[i % LANES.length] !== "compute-only") continue;
    vault.setPrerequisite(assumptionTest(i), anchor, "by fixture — ordering");
    blocked++;
  }
}

/** Every row on the response that names a test, with the list it came from. */
function testRows(work: NextWork): Array<{ list: string; row: { test: string; instrument: string | null } }> {
  const aw = work.assumptionWork;
  return [
    ...aw.runnable.map((row) => ({ list: "assumptionWork.runnable", row })),
    ...aw.awaitingOneCommand.map((row) => ({ list: "assumptionWork.awaitingOneCommand", row })),
    ...aw.blockedOnPermission.map((row) => ({ list: "assumptionWork.blockedOnPermission", row })),
    ...aw.needsHumans.map((row) => ({ list: "assumptionWork.needsHumans", row })),
    ...aw.blockedOnPrerequisite.map((row) => ({ list: "assumptionWork.blockedOnPrerequisite", row })),
    ...work.outstandingAsks.map((row) => ({ list: "outstandingAsks", row })),
  ];
}

/**
 * What a node DECLARES, re-derived here from the frontmatter rather than through
 * the helper the implementation uses. Comparing the response against its own
 * reader would be the response agreeing with itself.
 */
function declaredOn(node: OstNode): string | null {
  const declared = (node.instrument ?? "").trim();
  return declared === "" ? null : declared;
}

test(
  "the fixture is at the scale the threshold names — 337 tests, 62 solutions missing instruments",
  async () => {
    // A control, not a formality. Every assertion below is about a response
    // computed over a tree that is already being cut; measured at some smaller
    // scale they would all pass while pinning nothing the candidate was doubted for.
    const ctx = buildPassContext(dir);
    buildFixture(ctx.vault);
    const tree = ctx.vault.readTree();

    expect(tree.filter((n) => n.layer === "AssumptionTest").length).toBe(TESTS);
    expect(solutionsMissingInstruments(tree).length).toBe(SOLUTIONS_MISSING_INSTRUMENTS);
  },
  120_000,
);

test(
  "every test named in the sweep carries an instrument field — a command or an explicit null",
  async () => {
    const ctx = buildPassContext(dir);
    buildFixture(ctx.vault);
    const declared = new Map(ctx.vault.readTree().map((n) => [n.title, declaredOn(n)]));

    const work = computeNextWork(ctx.vault, dir, 3);
    // Asserted against the SERIALIZED response, because that is what a consumer
    // reads and it is where the explicit-null clause is actually testable:
    // `instrument: undefined` disappears in `JSON.stringify` and would read
    // exactly like a field cut for room.
    const wire = JSON.parse(JSON.stringify(work)) as NextWork;

    const rows = testRows(wire);
    expect(rows.length).toBeGreaterThan(0);
    for (const { list, row } of rows) {
      expect(
        Object.prototype.hasOwnProperty.call(row, "instrument"),
        `${list} named "${row.test}" without an instrument field`,
      ).toBe(true);
      // Present and typed: a command, or null. Never absent, never undefined.
      expect(row.instrument === null || typeof row.instrument === "string").toBe(true);
      expect(row.instrument, `${list} row "${row.test}"`).toEqual(declared.get(row.test) ?? null);
    }

    // Non-vacuity, both directions. A field hard-coded to null would satisfy
    // every assertion above; so would one that only ever reported a command.
    expect(rows.some(({ row }) => typeof row.instrument === "string")).toBe(true);
    expect(rows.some(({ row }) => row.instrument === null)).toBe(true);
  },
  120_000,
);

test(
  "the field is the one the write path refuses on — an unparseable declaration is reported, not hidden",
  async () => {
    // `nodeInstrument` returns nothing for a declaration that does not parse,
    // and that is the wrong reading here: `ost_set_instrument` refuses an
    // overwrite on any non-empty `instrument:` field, so a row reporting an
    // unparseable declaration as absent would send a pass to attach and have the
    // write refuse — the same blind guess with an extra round trip.
    const ctx = buildPassContext(dir);
    buildFixture(ctx.vault);
    const hand = "run the checklist by hand, then npx vitest";
    ctx.vault.createNode({
      title: "Test whether a hand-written declaration survives the read",
      layer: "AssumptionTest",
      evidence: "observed",
      body: "b",
      tags: [],
      links: [],
      lane: "compute-only",
      instrument: hand,
    });
    ctx.vault.linkNodes(solution(0), "Test whether a hand-written declaration survives the read");

    const work = computeNextWork(ctx.vault, dir, 3, undefined, undefined, undefined, Infinity);
    const row = testRows(work).find(({ row }) => row.test === "Test whether a hand-written declaration survives the read");
    expect(row?.row.instrument).toBe(hand);
  },
  120_000,
);

test(
  "carrying the field pushes no visible entry out — every capped list still returns 25",
  async () => {
    const ctx = buildPassContext(dir);
    buildFixture(ctx.vault);

    const work = computeNextWork(ctx.vault, dir, 3);

    // The four lane buckets plus the prerequisite bucket: each holds more than
    // the cap in this fixture, so each must show exactly the cap. Read off the
    // arrays, so a list quietly shortened to make room fails here.
    const aw = work.assumptionWork;
    for (const [name, list] of [
      ["assumptionWork.runnable", aw.runnable],
      ["assumptionWork.awaitingOneCommand", aw.awaitingOneCommand],
      ["assumptionWork.blockedOnPermission", aw.blockedOnPermission],
      ["assumptionWork.needsHumans", aw.needsHumans],
      ["assumptionWork.blockedOnPrerequisite", aw.blockedOnPrerequisite],
      ["outstandingAsks", work.outstandingAsks],
    ] as const) {
      expect(list.length, name).toBe(MAX_ITEMS_PER_LIST);
      const reported = work.truncated.find((t) => t.list === name);
      expect(reported?.shown, name).toBe(MAX_ITEMS_PER_LIST);
      expect(reported?.total, name).toBeGreaterThan(MAX_ITEMS_PER_LIST);
    }

    // And no OTHER list gave up entries either — the general form of the same
    // claim, over whatever else this fixture happens to cap.
    expect(work.truncated.length).toBeGreaterThan(0);
    for (const t of work.truncated) {
      expect(t.shown, t.list).toBe(MAX_ITEMS_PER_LIST);
      expect(t.hidden, t.list).toBe(t.total - t.shown);
    }

    // The other half of "affordable": the response the field was added to is
    // still inside the budget the size criterion sets, at the scale the
    // threshold names.
    expect(JSON.stringify(work, null, 2).length).toBeLessThan(BUDGET);
  },
  120_000,
);
