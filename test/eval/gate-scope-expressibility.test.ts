/**
 * Try to express the scope of five existing gates and see which ones resist it.
 *
 * The assumption beneath "The gate records the capability it was set against,
 * and refuses to pass a smaller one" is a feasibility claim: a gate's intended
 * coverage can be written down up front. The node's own prediction is that this
 * is *easy for files and hard for behaviours*, and its bar is a count — at least
 * 3 of 5 scopes expressible without a clause that could be satisfied vacuously.
 *
 * So this file is a census with a threshold, not a unit test with a happy path.
 * It runs the exercise over the five gates this repository has and asserts the
 * count, then pins the three things that stop the count being self-awarded:
 *
 *   - **the vacuity half**, which is the load-bearing one. Hollowing is
 *     mechanical and identical for every gate — keep every path, set every
 *     `work` to zero — so no scope's author gets to decide what hollowing means
 *     for their own scope. A scope that stays green through it is not counted.
 *   - **satisfiability**, so a clause set of `() => ["never"]` cannot buy
 *     non-vacuity by refusing everything.
 *   - **the resister is not a flag.** The gate that failed the exercise fails it
 *     mechanically — its second clause is a sentence with no program — and this
 *     file demonstrates the consequence rather than trusting the label: a
 *     subject that kept the boundary and lost a route outside it comes back
 *     with no shortfall at all.
 *
 * The last block leaves the declarations and evaluates two of them against this
 * actual repository, because a scope no run is ever measured against is the
 * "decoration" the solution node warns about. Both generator gates fall short
 * of what they were set against today, and the assertions name which artefacts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  artifactSubject,
  covers,
  expressibility,
  expressibilityCensus,
  hollow,
  scopeRefusals,
  scopeShortfall,
  vitestRunCounts,
  workingTreeSize,
  type DeclaredGateScope,
  type GateSubject,
} from "../../src/release/gate-scope.js";
import {
  BUNDLE_ARTIFACTS,
  DECLARED_GATE_SCOPES,
  SKILL_ARTIFACTS,
  declaredScope,
} from "../../src/release/gate-scope.declared.js";
import { GENERATED_ARTIFACT } from "../../src/release/gates.declared.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The threshold the assumption test pre-committed, quoted rather than restated. */
const THRESHOLD = 3;

describe("the exercise: five gates, and how many scopes could be written down", () => {
  test("five gates were attempted — the number the assumption test named", () => {
    // Not four with a spare, and not eight to make the ratio comfortable. The
    // design says five, and which five is a claim a reader can check against
    // gates.declared.ts plus the coverage gate that guards them.
    expect(DECLARED_GATE_SCOPES).toHaveLength(5);
    expect(DECLARED_GATE_SCOPES.map((s) => s.gate)).toEqual([
      "tsc",
      "vitest",
      "bundle-drift",
      "skill-drift",
      "coverage",
    ]);
  });

  test(`at least ${THRESHOLD} of 5 scopes are expressible, each surviving the vacuity check`, () => {
    const census = expressibilityCensus(DECLARED_GATE_SCOPES);

    expect(census.attempted).toBe(5);
    expect(census.expressible).toBeGreaterThanOrEqual(THRESHOLD);
    // Every one that counts toward the threshold cleared all three bars, so the
    // count cannot be padded by a scope that is merely written down.
    for (const verdict of census.verdicts.filter((v) => v.expressible)) {
      expect(verdict.evaluable).toBe(true);
      expect(verdict.satisfiable).toBe(true);
      expect(verdict.nonVacuous).toBe(true);
    }
  });

  test("every scope that counts goes red when its subject is hollowed", () => {
    for (const scope of DECLARED_GATE_SCOPES) {
      if (!expressibility(scope).expressible) continue;
      // The covering witness passes...
      expect(covers(scope, scope.covering)).toBe(true);
      // ...and the same witness with its insides emptied does not.
      const emptied = hollow(scope.covering);
      expect(scopeShortfall(scope, emptied).length).toBeGreaterThan(0);
    }
  });

  test("hollowing keeps the boundary — it is not just deleting the subject", () => {
    // If `hollow` removed units, every scope would "survive" the vacuity check
    // trivially and the check would prove nothing. The narrowing being modelled
    // is the one that keeps the shape: same files named, nothing done in them.
    for (const scope of DECLARED_GATE_SCOPES) {
      const emptied = hollow(scope.covering);
      expect(emptied.units.map((u) => u.path)).toEqual(scope.covering.units.map((u) => u.path));
      expect(emptied.eligible).toEqual([...scope.covering.eligible]);
      expect(emptied.units.every((u) => u.work === 0)).toBe(true);
    }
  });

  test("each expressible scope names what a unit is and what work counts", () => {
    // A scope a program can evaluate and a person cannot check by hand is worth
    // less than it looks: the artefact this solution promises is one a human can
    // review independently of any run.
    for (const scope of DECLARED_GATE_SCOPES) {
      expect(scope.unit.length).toBeGreaterThan(0);
      expect(scope.work.length).toBeGreaterThan(0);
      expect(scope.why.length).toBeGreaterThan(0);
    }
  });
});

describe("the negative result is a finding, not an omission", () => {
  const resisting = DECLARED_GATE_SCOPES.filter((s) => !expressibility(s).expressible);

  test("the gate that resisted is the behaviour-shaped one, and it says why", () => {
    // The node predicted this split before the exercise ran: easy for files,
    // hard for behaviours. It came out that way, and the one that resisted is
    // the gate whose subject is "every route by which coverage could shrink".
    expect(resisting.map((s) => s.gate)).toEqual(["coverage"]);
    expect(resisting[0]!.resists).toMatch(/behaviour|route/i);
  });

  test("it resists mechanically — a clause with no program — rather than by declaration", () => {
    const verdict = expressibility(resisting[0]!);
    expect(verdict.evaluable).toBe(false);
    expect(verdict.proseClauses).toContain("every-other-route");
    expect(verdict.why).toMatch(/no program reads/);
  });

  test("and the consequence is the vacuity the node named: it catches nothing outside its paths", () => {
    const scope = resisting[0]!;
    // The boundary is kept — all three gate-definition paths examined, work done
    // in each — and the narrowing happened somewhere the scope cannot name: a
    // skipped describe in a test file. A program reading this scope sees a clean
    // subject, because the only clause that would have objected is prose.
    const narrowedElsewhere: GateSubject = {
      ...scope.covering,
      units: [...scope.covering.units],
    };
    expect(scopeShortfall(scope, narrowedElsewhere)).toEqual([]);
    // And because it is not expressible, it is not allowed to refuse either. A
    // scope that cannot be evaluated must not be given teeth out of its prose.
    expect(scopeRefusals(scope, hollow(scope.covering))).toEqual([]);
  });
});

describe("the census cannot be self-awarded", () => {
  /** A scope whose clause refuses everything — non-vacuous, and useless. */
  const refusesEverything: DeclaredGateScope = {
    gate: "always-red",
    why: "nothing",
    unit: "a file",
    work: "anything",
    observedFrom: "repository",
    clauses: [{ id: "never", requires: "the impossible", shortfall: () => ["never satisfiable"] }],
    covering: { gate: "always-red", eligible: ["a"], units: [{ path: "a", work: 1 }] },
  };

  /** A scope that only names its boundary — the shape the solution exists to refuse. */
  const boundaryOnly: DeclaredGateScope = {
    gate: "boundary-only",
    why: "the right files are named",
    unit: "a file",
    work: "anything",
    observedFrom: "repository",
    clauses: [
      {
        id: "paths-present",
        requires: "the named paths are in the subject",
        shortfall: (s) => s.eligible.filter((p) => !s.units.some((u) => u.path === p)),
      },
    ],
    covering: { gate: "boundary-only", eligible: ["a"], units: [{ path: "a", work: 1 }] },
  };

  test("a scope that refuses every subject does not count as expressible", () => {
    const verdict = expressibility(refusesEverything);
    expect(verdict.nonVacuous).toBe(true);
    expect(verdict.satisfiable).toBe(false);
    expect(verdict.expressible).toBe(false);
  });

  test("a scope that only names its boundary does not count either", () => {
    // This is the exact clause the solution node calls decoration: "a scope
    // satisfiable by keeping the boundary and emptying what happens inside it".
    const verdict = expressibility(boundaryOnly);
    expect(verdict.satisfiable).toBe(true);
    expect(verdict.nonVacuous).toBe(false);
    expect(verdict.expressible).toBe(false);
    expect(verdict.why).toMatch(/survives hollowing/);
  });

  test("a scope with no clauses at all counts as a gate whose coverage was never written", () => {
    const empty: DeclaredGateScope = { ...boundaryOnly, clauses: [], gate: "unwritten" };
    expect(expressibility(empty).expressible).toBe(false);
    expect(expressibility(empty).why).toMatch(/could not be written down/);
  });
});

describe("a gate refuses to pass a subject smaller than it was set against", () => {
  const bundle = declaredScope("bundle-drift")!;

  test("a subject covering the scope passes", () => {
    const full: GateSubject = {
      gate: "bundle-drift",
      eligible: BUNDLE_ARTIFACTS,
      units: BUNDLE_ARTIFACTS.map((p) => ({ path: p, work: 4096 })),
    };
    expect(scopeRefusals(bundle, full)).toEqual([]);
  });

  test("a subject missing one artefact is refused, and the refusal names it", () => {
    const partial: GateSubject = {
      gate: "bundle-drift",
      eligible: BUNDLE_ARTIFACTS,
      units: [{ path: "dist/ost-agent.mjs", work: 4096 }],
    };
    const [refusal] = scopeRefusals(bundle, partial);
    expect(refusal).toBeDefined();
    expect(refusal).toContain("dist/capability-manifest.json");
    // The refusal has to say which way out is legitimate, because the reader is
    // an unattended pass whose cheapest move is to shrink the declaration.
    expect(refusal).toMatch(/do not narrow what it was set against/i);
  });

  test("a subject that kept the boundary and emptied it is refused too", () => {
    const emptied: GateSubject = {
      gate: "bundle-drift",
      eligible: BUNDLE_ARTIFACTS,
      units: BUNDLE_ARTIFACTS.map((p) => ({ path: p, work: 0 })),
    };
    expect(scopeRefusals(bundle, emptied)).toHaveLength(1);
    expect(scopeRefusals(bundle, emptied)[0]).toMatch(/nothing happened inside it/);
  });
});

describe("measured against this repository, not against a fixture", () => {
  test("the artefacts each generator gate was set against are really on disk", () => {
    // The scope is a claim about this tree. If a declared artefact does not
    // exist, the declaration is the thing that is wrong.
    for (const artifact of [...BUNDLE_ARTIFACTS, ...SKILL_ARTIFACTS]) {
      expect(fs.existsSync(path.join(repo, artifact)), `${artifact} is missing`).toBe(true);
    }
  });

  test("what gates.declared.ts names for skill-drift is a path this repository does not have", () => {
    // The finding that came out of writing the scope down, pinned so it cannot
    // quietly stop being true in either direction. `git status --porcelain --
    // SKILL.md` exits 0 with empty output here, so the drift check reads "clean"
    // off a file that has never existed and the gate cannot go red.
    expect(GENERATED_ARTIFACT["skill-drift"]).toBe("SKILL.md");
    expect(fs.existsSync(path.join(repo, "SKILL.md"))).toBe(false);
  });

  test("the subject gates.declared.ts alone would give each generator gate is smaller than its scope", () => {
    for (const gate of ["bundle-drift", "skill-drift"]) {
      const scope = declaredScope(gate)!;
      const named = GENERATED_ARTIFACT[gate]!;
      const subject = artifactSubject(gate, scope.covering.eligible, [named], workingTreeSize(repo))!;
      const refusals = scopeRefusals(scope, subject);
      expect(refusals, `${gate} should not have passed on ${named} alone`).toHaveLength(1);
    }
  });

  test("the subject ship actually builds now covers both scopes", () => {
    // The other half of the same finding: the gate was widened to be asked about
    // everything its generator writes, so the refusal above is a live guard on a
    // future narrowing rather than a standing red.
    for (const gate of ["bundle-drift", "skill-drift"]) {
      const scope = declaredScope(gate)!;
      const named = GENERATED_ARTIFACT[gate]!;
      const examined = [...new Set([named, ...scope.covering.eligible])].filter((p) =>
        fs.existsSync(path.join(repo, p)),
      );
      const subject = artifactSubject(gate, scope.covering.eligible, examined, workingTreeSize(repo))!;
      expect(scopeShortfall(scope, subject), `${gate} still falls short`).toEqual([]);
    }
  });

  test("a size that could not be read makes the subject unobservable, never empty", () => {
    // The distinction the whole refusal rests on. A runner that answers nothing
    // must not be read as a gate that compared nothing — that would convict a
    // broken measurement instead of a narrowed one.
    expect(artifactSubject("bundle-drift", BUNDLE_ARTIFACTS, BUNDLE_ARTIFACTS, () => null)).toBeNull();
    const absent = artifactSubject("bundle-drift", BUNDLE_ARTIFACTS, BUNDLE_ARTIFACTS, () => 0)!;
    expect(scopeRefusals(declaredScope("bundle-drift")!, absent)).toHaveLength(1);
  });
});

describe("what a real run makes visible about its own subject", () => {
  test("a vitest run's own output gives counts, which is the first clause and not the second", () => {
    const output = [
      " Test Files  2 passed (2)",
      "      Tests  41 passed (41)",
      "   Start at  01:37:12",
    ].join("\n");
    expect(vitestRunCounts(output)).toEqual({ files: 2, tests: 41 });
  });

  test("a shrunken run is visible in the count", () => {
    const shrunk = vitestRunCounts(" Test Files  1 passed (1)\n      Tests  20 passed (20)");
    expect(shrunk!.files).toBe(1);
  });

  test("output that says nothing about files reads as unobservable, never as zero", () => {
    // A parse failure is not an empty subject. Reporting it as one would refuse
    // every gate whose reporter changed format, which is the reverse of the
    // failure this file is about.
    expect(vitestRunCounts("something else entirely")).toBeNull();
    expect(declaredScope("vitest")!.observedFrom).toBe("run-output");
  });
});
