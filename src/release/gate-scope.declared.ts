/**
 * What each gate was set against — the exercise, and its result.
 *
 * The assumption test beneath "The gate records the capability it was set
 * against, and refuses to pass a smaller one" is not a design: it is a piece of
 * writing with a countable outcome. *Take five gates this project already has.
 * For each, attempt to write its intended coverage in a form a program could
 * check. Record which succeed cleanly, which need a vague clause, and which
 * cannot be written at all.* This file is that attempt, kept in the shape the
 * failures are visible in — a clause that could only be written as a sentence
 * is here, carrying `shortfall: null`, rather than quietly left out.
 *
 * **The result, so a reader does not have to run it.** Four of the five wrote
 * cleanly and one resisted, and the split is exactly the one the solution node
 * predicted: *easy for files and hard for behaviours*. Every gate whose subject
 * is a set of files reduced to the same two questions — was the gate asked about
 * everything there was, and did anything happen inside each thing it was asked
 * about. The gate whose subject is a behaviour ("every route by which a branch
 * could reduce what a gate measures") could not be finished without the clause
 * *and any other route*, which no program reads. It is declared here with that
 * clause in it, because a scope with a hole named is worth more than four
 * scopes and a silence.
 *
 * **Why this file and not `gates.declared.ts`.** That file is under the
 * human-only coverage rule: a commit touching it that declares a model as an
 * author is refused at `ship` (`gate-coverage.ts`). These declarations are
 * strictly *additive* — they say what a gate was set against, they widen what
 * `ship` looks at, and they can only refuse a gate, never excuse one. They are
 * separate so that the human-only file stays a file no agent has ever touched.
 * The corollary is a gap, and it is stated rather than left to be discovered:
 * nothing yet stops an agent *narrowing a scope declared here*, and the fix is
 * to add this path to `GATE_DEFINITION_PATHS`, which is a human's edit for the
 * same reason.
 *
 * **The scope is not the gate.** Nothing here changes an argv, a trigger or an
 * exclusion. A scope declaration is a second, independent statement of what a
 * gate is for, and its only power is to refuse a green whose subject came out
 * smaller than the statement. That asymmetry is deliberate: the failure mode is
 * an agent quietly shrinking what is measured, so a mechanism that can only
 * demand more is one it cannot turn against the gate.
 */
import { hollowMembers, unaskedMembers, type DeclaredGateScope } from "./gate-scope.js";

/** What `npm run bundle` writes, and therefore what bundle-drift is set against. */
export const BUNDLE_ARTIFACTS: readonly string[] = ["dist/ost-agent.mjs", "dist/capability-manifest.json"];

/**
 * What `npm run gen:skill` writes, and therefore what skill-drift is set against.
 *
 * All three, because `scripts/gen-skill.ts` writes all three: `SKILL_PATH`,
 * `WORKFLOW_SKELETON_PATH` and `WORKFLOW_GRAMMAR_PATH`. `GENERATED_ARTIFACT` in
 * `gates.declared.ts` names none of them — it names `SKILL.md`, a path that does
 * not exist in this repository.
 */
export const SKILL_ARTIFACTS: readonly string[] = [
  ".claude/skills/opportunity-solution-tree/SKILL.md",
  ".claude/workflows/skeleton.js",
  "docs/reference/workflow-grammar.md",
];

/** Artefacts a generator gate was set against, by gate name. */
export const DECLARED_ARTIFACTS: Readonly<Record<string, readonly string[]>> = {
  "bundle-drift": BUNDLE_ARTIFACTS,
  "skill-drift": SKILL_ARTIFACTS,
};

/**
 * The type-check gate.
 *
 * Wrote cleanly. The population is every module under `src/`, and the hollowing
 * that keeps the boundary is `@ts-nocheck`: the file is still compiled, still
 * appears in `tsc --listFiles`, and contributes no diagnostic. So `work` has to
 * be the lines the checker was allowed to judge rather than the file's presence,
 * and with that the clause pair refuses the hollowed subject.
 *
 * The limit is observability, not expressibility: `npx tsc --noEmit` prints
 * nothing on success, so a run's subject cannot be read off the run. It has to
 * be reconstructed from the tree, which means this scope catches a suppression
 * that is committed and not one that a run introduced and reverted.
 */
const TSC: DeclaredGateScope = {
  gate: "tsc",
  why: "every module this package ships is type-checked, with diagnostics actually produced for each",
  unit: "a TypeScript module under src/",
  work: "lines the checker was allowed to judge — zero when the file is suppressed",
  observedFrom: "repository",
  clauses: [
    {
      id: "every-module-compiled",
      requires: "every src/**/*.ts the tree holds is in what tsc compiled",
      shortfall: unaskedMembers,
    },
    {
      id: "no-suppressed-module",
      requires: "no compiled module suppresses the checker over its whole body",
      shortfall: hollowMembers,
    },
  ],
  covering: {
    gate: "tsc",
    eligible: ["src/index.ts", "src/release/ship.ts", "src/release/gate-scope.ts"],
    units: [
      { path: "src/index.ts", work: 12 },
      { path: "src/release/ship.ts", work: 212 },
      { path: "src/release/gate-scope.ts", work: 240 },
    ],
  },
};

/**
 * The suite gate.
 *
 * Wrote cleanly, and is the one whose scope the current gate cannot fully
 * evaluate at run time. The default reporter prints `Test Files 271 passed
 * (271)` and no per-file line, so a run's own output answers the first clause
 * (a shrunken file set shows up as a smaller count) and not the second. Reading
 * per-file case counts needs `--reporter=json`, and the argv is in
 * `gates.declared.ts` where only a human may change it. That is a real ceiling
 * on enforcement and it belongs on the declaration rather than in a workaround.
 */
const VITEST: DeclaredGateScope = {
  gate: "vitest",
  why: "every test file in the tree, minus the ones configuration deliberately excludes, actually runs cases",
  unit: "a test/**/*.test.ts file",
  work: "test cases executed in that file — zero for a file collected and entirely skipped",
  observedFrom: "run-output",
  clauses: [
    {
      id: "every-eligible-file-collected",
      requires: "every test file not named in SUITE_EXCLUSIONS is in the run",
      shortfall: unaskedMembers,
    },
    {
      id: "no-empty-file",
      requires: "every collected file executes at least one case",
      shortfall: hollowMembers,
    },
  ],
  covering: {
    gate: "vitest",
    eligible: ["test/release/ship.test.ts", "test/eval/gate-scope-expressibility.test.ts"],
    units: [
      { path: "test/release/ship.test.ts", work: 20 },
      { path: "test/eval/gate-scope-expressibility.test.ts", work: 1 },
    ],
  },
};

/**
 * The bundle-drift gate.
 *
 * Wrote cleanly, and writing it down was what surfaced the shortfall: `npm run
 * bundle` regenerates two committed files and `GENERATED_ARTIFACT` names one, so
 * `ship` has been comparing `dist/ost-agent.mjs` and not
 * `dist/capability-manifest.json`. CI checks both; the local gate that replaced
 * waiting on CI checks one. Nothing was edited to make that happen — the gate
 * was simply asked about less than it was set against, which is the narrowing
 * `gate-coverage.ts` cannot see.
 */
const BUNDLE_DRIFT: DeclaredGateScope = {
  gate: "bundle-drift",
  why: "every committed artefact the bundler regenerates is compared against what it just produced",
  unit: "a committed artefact of `npm run bundle`",
  work: "bytes of the artefact that were there to compare",
  observedFrom: "repository",
  clauses: [
    {
      id: "every-artifact-compared",
      requires: "both dist/ost-agent.mjs and dist/capability-manifest.json are compared",
      shortfall: unaskedMembers,
    },
    {
      id: "no-empty-artifact",
      requires: "each compared path is a file with something in it",
      shortfall: hollowMembers,
    },
  ],
  covering: {
    gate: "bundle-drift",
    eligible: BUNDLE_ARTIFACTS,
    units: BUNDLE_ARTIFACTS.map((p) => ({ path: p, work: 1 })),
  },
};

/**
 * The skill-drift gate.
 *
 * Wrote cleanly, and the shortfall it surfaced is worse than the bundle one.
 * `GENERATED_ARTIFACT["skill-drift"]` is `SKILL.md`; the generator writes
 * `.claude/skills/opportunity-solution-tree/SKILL.md` and
 * `.claude/workflows/skeleton.js`. `git status --porcelain -- SKILL.md` exits 0
 * with empty output for a path that does not exist, so `artifactDrift` has been
 * reading "no drift" off a file that has never been there. The gate ran, exited
 * green, and could not have gone red for any change to the ruleset. That is a
 * check with an empty subject reporting a clean result — the failure mode this
 * repository already refuses for instruments, arriving through the one door
 * nothing was watching.
 */
const SKILL_DRIFT: DeclaredGateScope = {
  gate: "skill-drift",
  why: "every committed artefact the skill generator regenerates is compared against what it just produced",
  unit: "a committed artefact of `npm run gen:skill`",
  work: "bytes of the artefact that were there to compare",
  observedFrom: "repository",
  clauses: [
    {
      id: "every-artifact-compared",
      requires: "both the generated SKILL.md and the generated workflow skeleton are compared",
      shortfall: unaskedMembers,
    },
    {
      id: "no-empty-artifact",
      requires: "each compared path is a file with something in it",
      shortfall: hollowMembers,
    },
  ],
  covering: {
    gate: "skill-drift",
    eligible: SKILL_ARTIFACTS,
    units: SKILL_ARTIFACTS.map((p) => ({ path: p, work: 1 })),
  },
};

/**
 * The coverage gate — the one that resisted.
 *
 * `branchCoverageRefusals` guards what the other gates cover. Its intended scope
 * is a behaviour rather than a set of files: *every route by which a branch
 * could reduce what a gate measures*. The file half writes down fine — three
 * paths, and a commit touching them is countable from git. The rest does not.
 * A suite is narrowed just as effectively by a `describe.skip` in a test file,
 * by a `@ts-nocheck` at the top of a source file, by an assertion deleted from a
 * spec, or by the `test` script in `package.json` — none of which is a
 * gate-definition path, and no list of paths closes the set.
 *
 * So the second clause here is a sentence, and `shortfall: null` says a program
 * does not read it. That is not a placeholder for work: it is the exercise's
 * answer for this gate, and the consequence is visible in the census — a subject
 * that kept all three files and lost a route outside them shows **no** shortfall
 * at all, because the only clause that would have caught it is prose. Keeping
 * the boundary and hollowing the inside is precisely what such a scope cannot
 * see, which is the definition of satisfying a clause vacuously.
 */
const COVERAGE: DeclaredGateScope = {
  gate: "coverage",
  why: "every route by which a branch could reduce what a gate measures is examined before the gates run",
  unit: "a route by which coverage can shrink",
  work: "reductions along that route the check would detect",
  observedFrom: "unobservable",
  resists:
    "the population is a behaviour, not a set of files: a suite is narrowed by a skipped describe, a " +
    "@ts-nocheck, a deleted assertion or the npm test script, and no list of paths closes that set",
  clauses: [
    {
      id: "declaration-paths-examined",
      requires: "every commit touching a gate-definition path is read",
      shortfall: unaskedMembers,
    },
    {
      id: "every-other-route",
      requires:
        "and any other route by which what a gate measures could shrink — a skipped test, a suppressed " +
        "module, a deleted assertion, a rewritten npm script",
      shortfall: null,
    },
  ],
  covering: {
    gate: "coverage",
    eligible: ["src/release/gates.declared.ts", "vitest.config.ts", "tsconfig.json"],
    units: [
      { path: "src/release/gates.declared.ts", work: 1 },
      { path: "vitest.config.ts", work: 1 },
      { path: "tsconfig.json", work: 1 },
    ],
  },
};

/**
 * The five gates the exercise was run against, in the order they run.
 *
 * Five because the assumption test says five, and these are the five this
 * project has: the two core gates, the two conditional ones, and the gate that
 * guards what all four cover.
 */
export const DECLARED_GATE_SCOPES: readonly DeclaredGateScope[] = [TSC, VITEST, BUNDLE_DRIFT, SKILL_DRIFT, COVERAGE];

/** The scope a gate was set against, or undefined for a gate nobody wrote one for. */
export function declaredScope(gate: string): DeclaredGateScope | undefined {
  return DECLARED_GATE_SCOPES.find((s) => s.gate === gate);
}
