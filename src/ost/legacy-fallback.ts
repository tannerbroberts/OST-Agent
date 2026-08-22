/**
 * The bound on this product's one legacy compatibility read.
 *
 * **What the fallback is.** Before the Assumption layer landed (2026-08-05,
 * "a solution's beliefs are nodes, not prose inside its tests"), a Solution
 * linked its AssumptionTests directly. `testsUnderSolution` still resolves that
 * direct edge, so a vault written before the layer existed keeps a green `check`
 * and a working build gate rather than having a schema addition turn into an
 * outage for everyone who never asked for one. That read is a second accounting
 * of "is this solution tested", and it was added — correctly — to stop finished
 * work silently reopening.
 *
 * **Why it needed a bound.** It had none. It applied to every direct edge in
 * every vault regardless of age, it had no expiry, and a solution counted tested
 * through it was indistinguishable from one counted through an Assumption. That
 * is the shape a compatibility layer has right before it becomes the thing
 * nobody can remove: two accountings both live forever, the union quietly
 * becomes the real definition of done, and nothing anywhere can say how much the
 * old half is still carrying — so nobody can ever show it is safe to drop.
 *
 * Three things make it a bound rather than an intention, and each is a clause:
 *
 * 1. **Consulted only before the boundary.** A direct edge counts only when the
 *    test it points at was created before {@link LEGACY_TEST_EDGE.boundary}. A
 *    test created after the layer existed cannot have been written under the old
 *    shape; a direct edge onto one is a hand edit, and honouring it would make
 *    the fallback the definition of done rather than a migration aid.
 * 2. **Inert past a release named in code.** {@link LEGACY_TEST_EDGE.droppedIn}
 *    is read by {@link legacyTestEdgeStatus} against the running `VERSION`, so
 *    the deadline expires whether anyone remembers it or not. A release named in
 *    a comment expires when someone happens to look.
 * 3. **What it carries is countable.** {@link legacyFallbackCensus} lists every
 *    solution the fallback is holding up and, separately, the ones it is holding
 *    up *alone* — the population that would reopen the day it goes inert. A
 *    layer whose load nobody can measure is one nobody can retire.
 *
 * **What this does NOT settle.** Whether the union is *correct* — whether the
 * work a legacy edge keeps counted was genuinely finished under the newer
 * standard. A perfectly bounded fallback around a wrong rule is a wrong rule
 * with an expiry date, and that judgement is a person's.
 *
 * **The one place the bound is weaker than it reads.** `created` is stamped by
 * `ost_create_node` and is absent on nodes written before that stamp or by hand:
 * 297 of this repository's own 1,445 vault files carry no `created` line. An
 * undated node is treated as predating the boundary — an absent date is evidence
 * of age, not of newness, and reading it the other way would reopen exactly the
 * work this fallback exists to keep counted. That reading is a *decision*, so
 * the census counts the undated edges separately instead of folding them in:
 * they are the population clause 1 cannot bound, and clause 2 is the only thing
 * that ever ends them.
 */
import { VERSION } from "../index.js";
import { compareVersions, parseVersion } from "../release/next-version.js";
import type { OstNode } from "./node.js";

/**
 * The legacy signal, its boundary and its expiry — in code, which is the whole
 * point of clause 2.
 */
export const LEGACY_TEST_EDGE = {
  /** The shape being read as a fallback. */
  signal: "a direct Solution→AssumptionTest edge",
  /** The release that introduced the Assumption layer and made this shape legacy. */
  introducedIn: "0.23.0",
  /**
   * The version boundary, as a date, because a node stamps `created` and not a
   * version. This is the day the Assumption layer landed on `main`; a test
   * created before it could not have been attached under an Assumption.
   */
  boundary: "2026-08-05",
  /**
   * The release this fallback goes inert at. Three minor releases past the
   * boundary — roughly two weeks at this repository's release cadence, which is
   * long enough for a vault to be migrated by ordinary use and short enough that
   * the second accounting does not outlive anyone's memory of why it exists.
   */
  droppedIn: "0.26.0",
} as const;

/** Whether the fallback is live in this build, and the sentence saying why. */
export interface FallbackStatus {
  active: boolean;
  /** The version the answer was computed against. */
  running: string;
  /** {@link LEGACY_TEST_EDGE.droppedIn}, repeated so a caller printing this needs nothing else. */
  droppedIn: string;
  reason: string;
}

/**
 * Is the legacy read still permitted at this version?
 *
 * A prerelease suffix is stripped before comparing: `0.26.0-rc.1` is past the
 * drop and must behave like it, and a release candidate that quietly kept a
 * compatibility layer alive would be testing a build nobody ships.
 */
export function legacyTestEdgeStatus(version: string = VERSION): FallbackStatus {
  const core = version.trim().replace(/[-+].*$/, "");
  const running = parseVersion(core);
  const dropped = parseVersion(LEGACY_TEST_EDGE.droppedIn)!;

  if (!running) {
    // An unreadable version is not evidence the deadline has passed, and going
    // inert on it would reopen finished work on a build that cannot say what it
    // is. Stay active and say so — loudly enough that it is not mistaken for
    // the normal case.
    return {
      active: true,
      running: version,
      droppedIn: LEGACY_TEST_EDGE.droppedIn,
      reason: `"${version}" is not a version this rule can read, so the fallback stays active — an unreadable version says nothing about a deadline`,
    };
  }

  const active = compareVersions(running, dropped) < 0;
  return {
    active,
    running: core,
    droppedIn: LEGACY_TEST_EDGE.droppedIn,
    reason: active
      ? `${core} is before ${LEGACY_TEST_EDGE.droppedIn}: ${LEGACY_TEST_EDGE.signal} is still read for tests created before ${LEGACY_TEST_EDGE.boundary}`
      : `${core} is at or past ${LEGACY_TEST_EDGE.droppedIn}: ${LEGACY_TEST_EDGE.signal} is no longer read at all`,
  };
}

/** Where a node sits relative to the version boundary. */
export type BoundaryStanding = "before" | "after" | "undated";

/**
 * Which side of {@link LEGACY_TEST_EDGE.boundary} a node was created on.
 *
 * `undated` is kept as its own answer rather than collapsed into `before`,
 * because the two are honoured identically and counted separately: one is bound
 * by clause 1 and the other is not.
 */
export function boundaryStanding(node: OstNode): BoundaryStanding {
  if (!node.created) return "undated";
  return node.created < LEGACY_TEST_EDGE.boundary ? "before" : "after";
}

/** How a solution reached one of its assumption tests. */
export type TestVia = "assumption" | "legacy-edge";

export interface ResolvedTest {
  readonly test: OstNode;
  /** `legacy-edge` iff the ONLY route to this test is the pre-Assumption direct edge. */
  readonly via: TestVia;
}

/**
 * The Solution→Assumption→AssumptionTest walk, with the legacy direct edge
 * bounded and attributed.
 *
 * De-duplicated by title, and a test reachable BOTH ways resolves as
 * `assumption`: the stronger route is the true one, and calling such a test
 * legacy would overstate what the fallback is carrying — the number this whole
 * module exists to keep honest.
 */
export function resolveTestsUnderSolution(
  solution: OstNode,
  index: Map<string, OstNode>,
  version: string = VERSION,
): ResolvedTest[] {
  const fallbackActive = legacyTestEdgeStatus(version).active;
  const out = new Map<string, ResolvedTest>();
  const legacy: OstNode[] = [];

  for (const link of solution.links) {
    const child = index.get(link);
    if (!child) continue;
    if (child.layer === "AssumptionTest") {
      if (fallbackActive && boundaryStanding(child) !== "after") legacy.push(child);
      continue;
    }
    if (child.layer !== "Assumption") continue;
    for (const grand of child.links) {
      const test = index.get(grand);
      if (test?.layer === "AssumptionTest") out.set(test.title, { test, via: "assumption" });
    }
  }

  // Legacy edges are folded in AFTER the two-hop walk so a test reachable both
  // ways keeps the `assumption` attribution.
  for (const test of legacy) if (!out.has(test.title)) out.set(test.title, { test, via: "legacy-edge" });
  return [...out.values()];
}

/** One solution the fallback is holding up. */
export interface LegacyReliance {
  solution: string;
  /** Tests this solution reaches ONLY through a legacy direct edge. */
  tests: string[];
  /**
   * True when the solution has no test reachable through an Assumption — it is
   * counted tested by the legacy signal ALONE, and reopens the day the fallback
   * goes inert. This is the number that decides whether dropping it is safe.
   */
  soleSource: boolean;
  /** `undated` when any of `tests` carries no `created` line; see this module's header. */
  standing: "dated" | "undated";
}

export interface LegacyFallbackCensus {
  status: FallbackStatus;
  boundary: string;
  /** Every solution with at least one honoured legacy edge, sorted by title. */
  reliant: LegacyReliance[];
  /** Honoured legacy edges — what the fallback is actually carrying. */
  carrying: number;
  /** Of `carrying`, the edges kept only because the test has no `created` date. */
  undated: number;
  /** Solutions counted tested by the legacy signal alone. */
  soleSource: number;
  /**
   * Direct edges the boundary REFUSED — a test created after the layer existed.
   * Non-zero means something is writing the old shape today, which no migration
   * will ever finish.
   */
  refusedAfterBoundary: number;
}

/** What the legacy fallback is carrying in this vault, and what it would cost to drop it. */
export function legacyFallbackCensus(tree: readonly OstNode[], version: string = VERSION): LegacyFallbackCensus {
  const status = legacyTestEdgeStatus(version);
  const index = new Map<string, OstNode>();
  for (const n of tree) index.set(n.title, n);

  const reliant: LegacyReliance[] = [];
  let carrying = 0;
  let undated = 0;
  let refusedAfterBoundary = 0;

  for (const solution of tree) {
    if (solution.layer !== "Solution") continue;

    // Counted off the raw edges rather than off `resolveTestsUnderSolution`,
    // which by construction never returns what the boundary refused. A refusal
    // nothing counts is a silent one.
    for (const link of solution.links) {
      const child = index.get(link);
      if (child?.layer === "AssumptionTest" && boundaryStanding(child) === "after") refusedAfterBoundary++;
    }

    const resolved = resolveTestsUnderSolution(solution, index, version);
    const legacy = resolved.filter((r) => r.via === "legacy-edge");
    if (legacy.length === 0) continue;

    carrying += legacy.length;
    const undatedHere = legacy.filter((r) => boundaryStanding(r.test) === "undated").length;
    undated += undatedHere;
    reliant.push({
      solution: solution.title,
      tests: legacy.map((r) => r.test.title).sort(),
      soleSource: legacy.length === resolved.length,
      standing: undatedHere > 0 ? "undated" : "dated",
    });
  }

  reliant.sort((a, b) => a.solution.localeCompare(b.solution));
  return {
    status,
    boundary: LEGACY_TEST_EDGE.boundary,
    reliant,
    carrying,
    undated,
    soleSource: reliant.filter((r) => r.soleSource).length,
    refusedAfterBoundary,
  };
}

/** The census as a page, written so the drop decision is the thing a reader can make. */
export function renderLegacyFallbackCensus(census: LegacyFallbackCensus): string {
  const lines: string[] = [];
  lines.push(`Legacy signal: ${LEGACY_TEST_EDGE.signal}, read as a fallback so pre-${LEGACY_TEST_EDGE.boundary} work still counts.`);
  lines.push(`  ${census.status.active ? "ACTIVE" : "INERT"} — ${census.status.reason}`);
  lines.push(`  boundary ${census.boundary} (the release that made this shape legacy: ${LEGACY_TEST_EDGE.introducedIn})`);
  lines.push("");

  if (!census.status.active) {
    lines.push("The fallback is inert, so it carries nothing here by construction.");
    return lines.join("\n");
  }

  lines.push(`Carrying ${census.carrying} edge(s) across ${census.reliant.length} solution(s).`);
  lines.push(
    census.soleSource === 0
      ? "  0 solution(s) are counted tested by the legacy signal ALONE — nothing reopens when it goes inert, so it is droppable today."
      : `  ${census.soleSource} solution(s) are counted tested by the legacy signal ALONE — they reopen the day it goes inert.`,
  );
  if (census.undated > 0) {
    lines.push(
      `  ${census.undated} of those edge(s) are kept only because the test carries no \`created\` date, which the boundary cannot bound. ` +
        `Only ${LEGACY_TEST_EDGE.droppedIn} ends them.`,
    );
  }
  if (census.refusedAfterBoundary > 0) {
    lines.push(
      `  ${census.refusedAfterBoundary} direct edge(s) were REFUSED — the test was created on or after the boundary, so the ` +
        `old shape is being written today and no migration will finish.`,
    );
  }

  if (census.reliant.length > 0) {
    lines.push("");
    for (const r of census.reliant) {
      const marks = [r.soleSource ? "sole source" : "also has an assumption route", r.standing].join(", ");
      lines.push(`  ${r.solution} (${marks})`);
      for (const t of r.tests) lines.push(`    ← ${t}`);
    }
  }

  return lines.join("\n");
}
