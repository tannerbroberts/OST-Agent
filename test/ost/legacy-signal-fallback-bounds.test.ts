/**
 * The legacy signal is read as a fallback, and the fallback is BOUNDED.
 *
 * The tree's claim: "an item counts as done if the new ledger says so **or** if
 * the legacy signal did… The price is carried complexity: two accounting schemes
 * must both be understood forever, the union rule quietly becomes the real
 * definition of done, and the next upgrade inherits three dialects instead of
 * two. That is how compatibility layers become the thing nobody can remove."
 * The bounded variant caps that "at the price of a deadline someone has to
 * honour" — and a deadline nobody encodes is not a deadline.
 *
 * The legacy signal in this repository is the pre-Assumption direct
 * Solution→AssumptionTest edge. It is a real second accounting of "is this
 * solution tested", it was added for exactly the reason the node gives (a schema
 * addition must not reopen every un-migrated vault's finished work), and until
 * this file it had none of the three bounds:
 *
 *   1. it applied to every direct edge at any age;
 *   2. it had no expiry at all — the failure mode the assumption test predicted
 *      would go red against "the obvious implementation", because an OR added to
 *      fix a live symptom has no expiry, the expiry not being what anyone was
 *      trying to fix that day;
 *   3. a solution counted tested through it was byte-identical, to every caller,
 *      to one counted through an Assumption — so nothing could say what the
 *      layer was carrying, and nobody could show dropping it was safe.
 *
 * One `describe` per clause. Every clause carries a control that must go the
 * other way, because each assertion below can be passed by a fallback that has
 * simply stopped working, which is the opposite of what is being built.
 *
 * **What green here does NOT settle**, and it is the node's own distinguishing
 * assumption: whether the union is *correct* — whether the work a legacy edge
 * keeps counted was genuinely finished by the newer standard. A perfectly
 * bounded fallback around a wrong rule is a wrong rule with a deadline. That is
 * "Judge the eighteen reopened items — were they genuinely finished", and it
 * needs a person to look at eighteen items and say.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { VERSION } from "../../src/index.js";
import { buildPermit } from "../../src/eval/buildable.js";
import { checkInvariants } from "../../src/eval/invariants.js";
import { byTitle, testsUnderSolution } from "../../src/processes/tree.js";
import {
  LEGACY_TEST_EDGE,
  boundaryStanding,
  legacyFallbackCensus,
  legacyTestEdgeStatus,
  renderLegacyFallbackCensus,
  resolveTestsUnderSolution,
} from "../../src/ost/legacy-fallback.js";
import type { OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";
import { parseVersion, compareVersions, bumpVersion, formatVersion } from "../../src/release/next-version.js";

const OUTCOME = "Players keep playing";
const OPPORTUNITY = "Players cannot tell what changed";
const SOLUTION = "Ship a changelog";
const BELIEF = "Players would read a changelog if it existed";

/** A day either side of the boundary. */
const BEFORE = "2026-08-01";
const AFTER = "2026-08-20";

/** A spec that exists, so a permit refuses nothing for the filesystem's reasons. */
const INSTRUMENT = "npx vitest run test/ost/legacy-signal-fallback-bounds.test.ts";

let dir: string;
let vault: Vault;

function put(title: string, layer: OstNode["layer"], extra: Partial<OstNode> = {}): void {
  vault.createNode({
    title,
    layer,
    tags: [],
    links: [],
    evidence: "assertion",
    body: `prose for ${title}`,
    ...extra,
  } as OstNode);
}

/**
 * An assumption test with a red instrument, so a build permit can clear on it.
 *
 * The instrument names a spec that does exist, and the observation line is the
 * shape `ost-agent verify` writes — a permit refuses a red about a missing file
 * unless the threshold is bound, and a fixture failing for THAT reason would
 * make the permit assertions below prove nothing.
 */
function redTest(title: string, created?: string): void {
  put(title, "AssumptionTest", {
    created,
    threshold: "at least 4 of 5 players name the change unprompted",
    instrument: INSTRUMENT,
  } as Partial<OstNode>);
  // `## Instrument Log` is a reserved heading — `createNode` refuses a body
  // carrying one, because a heading the agent can author is a gate it can clear
  // on its own authority. This is the door that exists.
  vault.appendUnderSection(title, "## Instrument Log", `- 2026-08-06 **red** (exit 1) \`${INSTRUMENT}\` — 1 failed`);
}

const index = (): Map<string, OstNode> => byTitle(vault.readTree());
const testsOf = (solution: string): string[] => testsUnderSolution(vault.read(solution), index()).map((t) => t.title);
const resolvedOf = (solution: string, version?: string): ReturnType<typeof resolveTestsUnderSolution> =>
  resolveTestsUnderSolution(vault.read(solution), index(), version);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-legacy-bounds-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  vault = new Vault(dir);
  put(OUTCOME, "Outcome");
  put(OPPORTUNITY, "Opportunity");
  vault.linkNodes(OUTCOME, OPPORTUNITY);
  put(SOLUTION, "Solution");
  vault.linkNodes(OPPORTUNITY, SOLUTION);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * The boundary and the drop release have to be readable by the same rules the
 * rest of the repository uses, or "named in code" means "named in a string
 * nothing can compare".
 */
describe("the bound is stated in code, in a form the code can compare", () => {
  test("the boundary is an ISO date and the drop release is a parseable version after the one that made the shape legacy", () => {
    expect(LEGACY_TEST_EDGE.boundary).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const introduced = parseVersion(LEGACY_TEST_EDGE.introducedIn);
    const dropped = parseVersion(LEGACY_TEST_EDGE.droppedIn);
    expect(introduced, `${LEGACY_TEST_EDGE.introducedIn} must parse`).not.toBeNull();
    expect(dropped, `${LEGACY_TEST_EDGE.droppedIn} must parse`).not.toBeNull();
    expect(compareVersions(dropped!, introduced!)).toBe(1);
  });

  test("the fallback is still live in THIS build — otherwise every clause below is vacuous", () => {
    // The one assertion that must be revisited deliberately: when this build
    // reaches the drop release the fallback is gone, and so is the behaviour
    // clause 1 and clause 3 describe. Failing here is the bound working.
    expect(legacyTestEdgeStatus(VERSION).active, `${VERSION} is at or past ${LEGACY_TEST_EDGE.droppedIn} — the fallback has expired as designed, and this file should be retired with it`).toBe(true);
  });
});

describe("clause 1 — the legacy signal is consulted only before the version boundary", () => {
  test("a test created before the boundary is reached through the legacy edge", () => {
    redTest("An old test", BEFORE);
    vault.linkNodes(SOLUTION, "An old test");

    expect(testsOf(SOLUTION)).toEqual(["An old test"]);
    expect(resolvedOf(SOLUTION)).toEqual([expect.objectContaining({ via: "legacy-edge" })]);
    // And an un-migrated vault keeps a working gate, which is the whole reason
    // the fallback exists — the bound must not cost this.
    expect(buildPermit(vault.readTree(), SOLUTION).cleared).toBe(true);
    expect(checkInvariants(vault.readTree()).map((v) => v.rule)).not.toContain("test-mapped");
  });

  test("a test created AFTER the boundary is ignored — the same edge, one date later", () => {
    // The write surface refuses this shape (`CHILD_HIERARCHY`), so it can only
    // arrive by hand edit. Honouring it would make the fallback the definition
    // of done rather than a migration aid: an unbounded OR is the version the
    // node argues against.
    redTest("A new test", AFTER);
    vault.linkNodes(SOLUTION, "A new test");

    expect(testsOf(SOLUTION)).toEqual([]);
    expect(buildPermit(vault.readTree(), SOLUTION).cleared).toBe(false);
    expect(legacyFallbackCensus(vault.readTree()).refusedAfterBoundary).toBe(1);
  });

  test("the boundary is the only difference between the two — same node, same edge, same everything else", () => {
    // A single fixture flipped one field, so neither case above can be passing
    // for an unrelated reason (a missing instrument, a bad title, a broken link).
    redTest("The very same test", BEFORE);
    vault.linkNodes(SOLUTION, "The very same test");
    expect(testsOf(SOLUTION)).toEqual(["The very same test"]);

    const file = path.join(dir, "The very same test.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(`created: '${BEFORE}'`, `created: '${AFTER}'`), "utf8");
    expect(vault.read("The very same test").created).toBe(AFTER);
    expect(testsOf(SOLUTION)).toEqual([]);
  });

  test("a test with no `created` line is honoured, and counted as the population the boundary cannot bound", () => {
    // 297 of this repository's own 1,445 vault files carry no `created` line —
    // the field is stamped by `ost_create_node` and absent on anything older or
    // hand-written. An absent date is evidence of age, not of newness, and
    // reading it the other way would reopen the work the fallback exists to
    // keep counted. So it is honoured — and counted SEPARATELY, because it is
    // exactly the set clause 1 cannot bound and only clause 2 ever ends.
    redTest("An undated test");
    vault.linkNodes(SOLUTION, "An undated test");
    expect(boundaryStanding(vault.read("An undated test"))).toBe("undated");

    const census = legacyFallbackCensus(vault.readTree());
    expect(testsOf(SOLUTION)).toEqual(["An undated test"]);
    expect(census.carrying).toBe(1);
    expect(census.undated).toBe(1);
    expect(renderLegacyFallbackCensus(census)).toContain("no `created` date");
  });

  test("the two-hop route is untouched by any of this", () => {
    // CONTROL for every assertion above: they are about the legacy branch only.
    // If the bound had broken the current accounting, this would be the failure.
    put(BELIEF, "Assumption", { created: AFTER });
    vault.linkNodes(SOLUTION, BELIEF);
    redTest("A current test", AFTER);
    vault.linkNodes(BELIEF, "A current test");

    expect(testsOf(SOLUTION)).toEqual(["A current test"]);
    expect(resolvedOf(SOLUTION)).toEqual([expect.objectContaining({ via: "assumption" })]);
    expect(legacyFallbackCensus(vault.readTree()).carrying).toBe(0);
  });
});

describe("clause 2 — the fallback goes inert at a release named in code, not in a comment", () => {
  const past = (): string => formatVersion(bumpVersion(parseVersion(LEGACY_TEST_EDGE.droppedIn)!, "patch"));

  test("at the drop release the legacy edge stops resolving, however old the test is", () => {
    redTest("An old test", BEFORE);
    vault.linkNodes(SOLUTION, "An old test");
    expect(testsOf(SOLUTION)).toEqual(["An old test"]); // live in this build

    expect(legacyTestEdgeStatus(LEGACY_TEST_EDGE.droppedIn).active).toBe(false);
    expect(resolvedOf(SOLUTION, LEGACY_TEST_EDGE.droppedIn)).toEqual([]);
    expect(resolvedOf(SOLUTION, past())).toEqual([]);
  });

  test("the expiry is inclusive of the named release, not one release later", () => {
    // The off-by-one that turns "goes inert at 0.26.0" into "goes inert some
    // time after 0.26.0" — which is a different, later, unnamed deadline.
    const before = formatVersion({ ...parseVersion(LEGACY_TEST_EDGE.droppedIn)!, patch: 0, minor: parseVersion(LEGACY_TEST_EDGE.droppedIn)!.minor - 1 });
    expect(legacyTestEdgeStatus(before).active).toBe(true);
    expect(legacyTestEdgeStatus(LEGACY_TEST_EDGE.droppedIn).active).toBe(false);
  });

  test("a prerelease of the drop release is already past it", () => {
    // A release candidate that quietly kept the compatibility layer alive would
    // be testing a build nobody ships.
    expect(legacyTestEdgeStatus(`${LEGACY_TEST_EDGE.droppedIn}-rc.1`).active).toBe(false);
  });

  test("the deadline is read from the running version, not asserted about a constant", () => {
    // The difference between a bound and a hope: nothing has to remember. Two
    // builds of the same code, same vault, different `VERSION` — different answer.
    redTest("An old test", BEFORE);
    vault.linkNodes(SOLUTION, "An old test");

    expect(legacyFallbackCensus(vault.readTree(), VERSION).carrying).toBe(1);
    const expired = legacyFallbackCensus(vault.readTree(), past());
    expect(expired.carrying).toBe(0);
    expect(expired.status.active).toBe(false);
    expect(renderLegacyFallbackCensus(expired)).toContain("INERT");
  });

  test("an unreadable version keeps the fallback alive and says so, rather than expiring by accident", () => {
    // Failing closed here would reopen finished work on a build that cannot say
    // what it is — the original defect, arriving through the fix for it.
    const status = legacyTestEdgeStatus("not-a-version");
    expect(status.active).toBe(true);
    expect(status.reason).toContain("not a version this rule can read");
  });
});

describe("clause 3 — what the legacy signal alone is holding up is reported, not folded in", () => {
  test("a solution counted tested by the legacy signal alone is named as such", () => {
    redTest("An old test", BEFORE);
    vault.linkNodes(SOLUTION, "An old test");

    const census = legacyFallbackCensus(vault.readTree());
    expect(census.soleSource).toBe(1);
    expect(census.reliant).toEqual([
      { solution: SOLUTION, tests: ["An old test"], soleSource: true, standing: "dated" },
    ]);

    const page = renderLegacyFallbackCensus(census);
    expect(page).toContain(SOLUTION);
    expect(page).toContain("An old test");
    expect(page).toContain("legacy signal ALONE");
  });

  test("the build permit says which accounting cleared it", () => {
    // The place the distinction actually costs something: a builder handed a
    // permit that rests on the fallback is holding one that stops clearing at
    // the drop release, and before this it read identically to any other.
    redTest("An old test", BEFORE);
    vault.linkNodes(SOLUTION, "An old test");

    const permit = buildPermit(vault.readTree(), SOLUTION);
    expect(permit.cleared).toBe(true);
    expect(permit.viaLegacyEdge).toBe(true);
    expect(permit.reason).toContain(LEGACY_TEST_EDGE.droppedIn);
  });

  test("CONTROL — a permit from the current accounting is NOT flagged", () => {
    // Without this, `viaLegacyEdge: true` on everything would pass the test above.
    put(BELIEF, "Assumption", { created: AFTER });
    vault.linkNodes(SOLUTION, BELIEF);
    redTest("A current test", AFTER);
    vault.linkNodes(BELIEF, "A current test");

    const permit = buildPermit(vault.readTree(), SOLUTION);
    expect(permit.cleared).toBe(true);
    expect(permit.viaLegacyEdge).toBeUndefined();
    expect(permit.reason).not.toContain(LEGACY_TEST_EDGE.droppedIn);
  });

  test("a half-migrated solution is carried but is NOT sole-source — it does not reopen at the drop", () => {
    // The shape every vault has mid-walk, and the one that decides whether the
    // drop is safe. Counting it as sole-source would overstate the load and
    // keep the layer alive for nothing.
    redTest("An old test", BEFORE);
    vault.linkNodes(SOLUTION, "An old test");
    put(BELIEF, "Assumption", { created: AFTER });
    vault.linkNodes(SOLUTION, BELIEF);
    redTest("A current test", AFTER);
    vault.linkNodes(BELIEF, "A current test");

    expect(testsOf(SOLUTION).sort()).toEqual(["A current test", "An old test"]);
    const census = legacyFallbackCensus(vault.readTree());
    expect(census.carrying).toBe(1);
    expect(census.soleSource).toBe(0);
    expect(census.reliant[0]).toMatchObject({ solution: SOLUTION, soleSource: false });
  });

  test("a test reachable BOTH ways is attributed to the assumption route, not the legacy one", () => {
    // Otherwise the census overstates what the fallback carries, and the number
    // that decides the drop is the one number that must not be flattering.
    redTest("A shared test", BEFORE);
    vault.linkNodes(SOLUTION, "A shared test");
    put(BELIEF, "Assumption", { created: AFTER });
    vault.linkNodes(SOLUTION, BELIEF);
    vault.linkNodes(BELIEF, "A shared test");

    expect(resolvedOf(SOLUTION)).toEqual([expect.objectContaining({ via: "assumption" })]);
    expect(legacyFallbackCensus(vault.readTree()).carrying).toBe(0);
  });

  test("a clean vault reports zero and says the layer is droppable — the measurement, not an adjective", () => {
    // The state this repository's own vault is in, and the whole reason clause 3
    // is a clause: you cannot decide it is safe to drop a compatibility layer
    // without knowing what it is holding up.
    put(BELIEF, "Assumption", { created: AFTER });
    vault.linkNodes(SOLUTION, BELIEF);
    redTest("A current test", AFTER);
    vault.linkNodes(BELIEF, "A current test");

    const census = legacyFallbackCensus(vault.readTree());
    expect(census).toMatchObject({ carrying: 0, soleSource: 0, undated: 0, reliant: [] });
    expect(renderLegacyFallbackCensus(census)).toContain("droppable today");
  });
});
