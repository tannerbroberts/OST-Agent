/**
 * Only a human may reduce what a gate covers, and the reduction lands as its own
 * commit.
 *
 * The two halves of the definition of done, in the order they are asserted:
 *
 *   a. **An agent-surface call that would reduce a gate's coverage is refused
 *      rather than recorded.** The refusal is at `ost-agent ship`, not at a tool
 *      schema, and the difference matters enough to be pinned here: the build
 *      pass grants the builder `Bash,Read,Edit,Write` against this repository,
 *      so "the narrowing is inexpressible" is simply false — an agent with
 *      `Edit` can type an exclusion into any file. What it cannot do is merge
 *      one. `ship` is the single funnel, and the check runs there BEFORE the
 *      gates, because a branch that narrowed a gate and then passed it has
 *      proved nothing and the meaningless green must not reach the report first.
 *
 *   b. **A human's coverage change lands as its own commit touching only the
 *      gate definition**, so narrowings are countable from `git log` instead of
 *      reconstructed from diffs.
 *
 * **What is NOT asserted, said here so a green run is not read as more than it
 * is.** Nothing below decides whether any narrowing was *reasonable*. That is
 * the half the assumption test actually names ("count past gate narrowings and
 * judge how many were reasonable"), it is a person's judgement, and no test can
 * make it. And authorship is read off a commit's declared author and trailers —
 * an agent that omits the trailer is indistinguishable from a person here. The
 * isolation rule carries what the authorship check cannot: whoever wrote it, a
 * reduction is one commit touching one file, and a person can then judge them
 * one at a time.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import {
  AGENT_AUTHOR_MARKERS,
  branchCoverageRefusals,
  COVERAGE_REGIME_MARKER,
  coverageChangeRefusals,
  GATE_DEFINITION_PATHS,
  gateCoverage,
  gateCoverageCommits,
  narrowings,
  type GateCoverage,
} from "../../src/release/gate-coverage.js";
import { CONDITIONAL_GATES, CORE_GATES, SUITE_EXCLUSIONS } from "../../src/release/gates.declared.js";
import { ship } from "../../src/release/ship-repo.js";
import { allGates, gatesFor, type Runner } from "../../src/release/ship.js";
import { ALLOWED_TOOL_NAMES } from "../../src/security/policy.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => fs.readFileSync(path.join(repoRoot, p), "utf8");

/** The coverage of the gate set as this repository actually declares it. */
const declared: GateCoverage = gateCoverage(undefined, undefined, {
  include: ["src/**/*"],
  exclude: ["node_modules", "dist", "test"],
});

/** A copy with one field replaced — the shape every narrowing case below takes. */
function withCoverage(patch: Partial<GateCoverage>): GateCoverage {
  return { ...declared, ...patch };
}

describe("what counts as covering less", () => {
  test("a gate that is gone is a reduction", () => {
    const after = withCoverage({ gates: declared.gates.filter((g) => g.name !== "vitest") });
    expect(narrowings(declared, after)).toEqual([
      { subject: "vitest", kind: "gate-removed", lost: ["npx vitest run"] },
    ]);
  });

  test("an exclusion typed into the suite gate's argv is a reduction", () => {
    const after = withCoverage({
      gates: declared.gates.map((g) =>
        g.name === "vitest" ? { ...g, argv: [...g.argv, "--exclude", "test/security/**"] } : g,
      ),
    });
    const found = narrowings(declared, after);
    expect(found.map((n) => n.kind)).toEqual(["argument-restricted"]);
    expect(found[0]!.lost).toContain("--exclude");
  });

  test("naming files on a gate's command line is a reduction", () => {
    // `npx vitest run test/release` is the cheapest narrowing there is, and it
    // does not use a flag at all — it just stops the runner collecting anything
    // else. A rule that only watched flags would miss the common form.
    const after = withCoverage({
      gates: declared.gates.map((g) => (g.name === "vitest" ? { ...g, argv: [...g.argv, "test/release"] } : g)),
    });
    expect(narrowings(declared, after).map((n) => n.kind)).toEqual(["argument-restricted"]);
  });

  test("a conditional gate that stops firing on paths it used to fire on is a reduction", () => {
    const after = withCoverage({
      gates: declared.gates.map((g) =>
        g.name === "bundle-drift" ? { ...g, firesOn: (g.firesOn ?? []).filter((p) => p !== "src/cli/index.ts") } : g,
      ),
    });
    const found = narrowings(declared, after);
    expect(found.map((n) => n.kind)).toEqual(["trigger-narrowed"]);
    expect(found[0]!.lost).toEqual(["src/cli/index.ts"]);
  });

  test("a test file excluded from the suite is a reduction", () => {
    const after = withCoverage({ suiteExclusions: [...declared.suiteExclusions, "test/security/policy.test.ts"] });
    expect(narrowings(declared, after)).toEqual([
      { subject: "vitest", kind: "suite-exclusion-added", lost: ["test/security/policy.test.ts"] },
    ]);
  });

  test("shrinking what tsc compiles is a reduction, either way round", () => {
    const dropped = withCoverage({ typeCheck: { include: [], exclude: declared.typeCheck.exclude } });
    expect(narrowings(declared, dropped).map((n) => n.kind)).toEqual(["type-check-include-shrunk"]);

    const excluded = withCoverage({
      typeCheck: { include: declared.typeCheck.include, exclude: [...declared.typeCheck.exclude, "src/release"] },
    });
    expect(narrowings(declared, excluded).map((n) => n.kind)).toEqual(["type-check-exclude-grown"]);
  });

  test("covering MORE is not a reduction", () => {
    // The guard against a rule that is green because it flags everything. A gate
    // added, an exclusion lifted and a wider trigger are all coverage changes
    // and none of them is a narrowing.
    const wider = withCoverage({
      gates: [...declared.gates, { name: "audit", argv: ["npm", "audit"], firesOn: null }],
      suiteExclusions: [],
      typeCheck: { include: [...declared.typeCheck.include, "scripts/**/*"], exclude: [] },
    });
    expect(narrowings(declared, wider)).toEqual([]);
  });

  test("no change is no reduction", () => {
    expect(narrowings(declared, declared)).toEqual([]);
  });
});

describe("who may reduce coverage", () => {
  const reduced = withCoverage({ suiteExclusions: [...SUITE_EXCLUSIONS, "test/security/policy.test.ts"] });

  test("an agent's reduction is refused", () => {
    const refusals = coverageChangeRefusals({
      writer: "machine",
      before: declared,
      after: reduced,
      touches: [COVERAGE_REGIME_MARKER],
    });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(/only a human may reduce what a gate covers/i);
    // It names the alternative, because a refusal that leaves an agent with
    // nothing to do is a refusal it will route around.
    expect(refusals[0]).toMatch(/propose/i);
  });

  test("the same reduction from a human, on its own, is allowed", () => {
    expect(
      coverageChangeRefusals({
        writer: "human",
        before: declared,
        after: reduced,
        touches: [COVERAGE_REGIME_MARKER],
      }),
    ).toEqual([]);
  });

  test("an agent may still make a gate stricter", () => {
    // The solution's title says a *change* is human-only; its definition of done
    // says a *reduction* is refused. This implements the narrower reading, and
    // the case is pinned so the choice is visible rather than incidental.
    expect(
      coverageChangeRefusals({
        writer: "machine",
        before: declared,
        after: withCoverage({ suiteExclusions: [] }),
        touches: [COVERAGE_REGIME_MARKER],
      }),
    ).toEqual([]);
  });

  test("a coverage change bundled with other work is refused whoever makes it", () => {
    for (const writer of ["human", "machine"] as const) {
      const refusals = coverageChangeRefusals({
        writer,
        before: declared,
        after: reduced,
        touches: [COVERAGE_REGIME_MARKER, "src/cli/index.ts"],
      });
      expect(refusals.some((r) => /own commit/.test(r))).toBe(true);
      expect(refusals.some((r) => r.includes("src/cli/index.ts"))).toBe(true);
    }
  });

  test("the refusal records nothing", () => {
    // Refusing and recording are the two candidate solutions the tree weighed
    // against each other, and this is the one that refuses. A refusal that also
    // wrote a line somewhere would leave a trace of a narrowing that never
    // happened, which is worse than useless to whoever later counts them.
    const source = read("src/release/gate-coverage.ts");
    expect(source).not.toMatch(/from "node:fs"/);
    expect(source).not.toMatch(/writeFileSync|appendFileSync/);
  });
});

/** A fake repository, answering git by exact argv — the ship-repo.test.ts shape. */
type Answer = { status: number | null; output: string };
const NUL = String.fromCharCode(0);
const LOG_ARGV = [
  "git",
  "log",
  "--format=%H%x00%aI%x00%an <%ae>%x00%s",
  "--no-patch",
  "origin/main..HEAD",
  "--",
  ...GATE_DEFINITION_PATHS,
].join(" ");

/** One commit as `git log`, `git show --name-only` and `git log -1 --format=%B` report it. */
function commit(opts: { sha: string; date: string; author: string; subject: string; paths: string[]; body?: string }) {
  return {
    record: [opts.sha, opts.date, opts.author, opts.subject].join(NUL),
    answers: {
      [`git show --pretty=format: --name-only ${opts.sha}`]: { status: 0, output: `${opts.paths.join("\n")}\n` },
      [`git log -1 --format=%B ${opts.sha}`]: { status: 0, output: `${opts.subject}\n\n${opts.body ?? ""}` },
    } as Record<string, Answer>,
  };
}

const HUMAN = "Tanner Roberts <tannerbroberts@gmail.com>";

function repoWith(commits: ReturnType<typeof commit>[], overrides: Record<string, Answer> = {}) {
  const answers: Record<string, Answer> = {
    "git rev-parse --abbrev-ref HEAD": { status: 0, output: "feature\n" },
    "git status --porcelain": { status: 0, output: "" },
    "git rev-list --left-right --count origin/main...HEAD": { status: 0, output: "0\t2\n" },
    "git fetch origin main": { status: 0, output: "" },
    "git rev-list --count HEAD..origin/main": { status: 0, output: "0\n" },
    "git diff --name-only origin/main...HEAD": { status: 0, output: "docs/notes.md\n" },
    [`git cat-file -e origin/main:${COVERAGE_REGIME_MARKER}`]: { status: 0, output: "" },
    [LOG_ARGV]: { status: 0, output: commits.map((c) => c.record).join("\n") },
    ...Object.assign({}, ...commits.map((c) => c.answers)),
    ...overrides,
  };
  const calls: string[] = [];
  const run: Runner = (argv) => {
    const key = argv.join(" ");
    calls.push(key);
    return answers[key] ?? { status: 0, output: "" };
  };
  return { run, calls };
}

describe("a coverage change is countable from git", () => {
  test("every commit that touched a gate definition comes back dated and attributed", () => {
    const commits = [
      commit({
        sha: "aaaaaaaa1111",
        date: "2026-08-20T10:00:00Z",
        author: HUMAN,
        subject: "chore(gates): quarantine the contended perf file",
        paths: [COVERAGE_REGIME_MARKER],
      }),
      commit({
        sha: "bbbbbbbb2222",
        date: "2026-08-22T10:00:00Z",
        author: HUMAN,
        subject: "feat(eval): a thing, plus an exclusion",
        paths: [COVERAGE_REGIME_MARKER, "src/eval/thing.ts"],
      }),
    ];
    const { run } = repoWith(commits);
    const found = gateCoverageCommits("/repo", run, "origin/main..HEAD");

    expect(found.map((c) => c.sha)).toEqual(["aaaaaaaa1111", "bbbbbbbb2222"]);
    // Dated, because "fewer than 2 narrowings per month" is arithmetic on these.
    expect(found.map((c) => c.date)).toEqual(["2026-08-20T10:00:00Z", "2026-08-22T10:00:00Z"]);
    expect(found.map((c) => c.isolated)).toEqual([true, false]);
  });

  test("a commit that declares a model as an author is marked as one", () => {
    const trailered = commit({
      sha: "cccccccc3333",
      date: "2026-08-23T10:00:00Z",
      author: HUMAN,
      subject: "chore(gates): exclude one more",
      paths: [COVERAGE_REGIME_MARKER],
      body: "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>\n",
    });
    const { run } = repoWith([trailered]);
    expect(gateCoverageCommits("/repo", run, "origin/main..HEAD")[0]!.agentAuthored).toBe(true);
    // The marker set is what makes that true; an empty one would pass vacuously.
    expect(AGENT_AUTHOR_MARKERS.length).toBeGreaterThan(0);
  });
});

describe("ship is the funnel", () => {
  test("a branch whose coverage change rides along with other work does not ship", () => {
    const { run, calls } = repoWith([
      commit({
        sha: "dddddddd4444",
        date: "2026-08-24T10:00:00Z",
        author: HUMAN,
        subject: "feat(eval): a thing, plus an exclusion",
        paths: [COVERAGE_REGIME_MARKER, "src/eval/thing.ts"],
      }),
    ]);
    const outcome = ship({ repo: "/repo", run });

    expect(outcome.shipped).toBe(false);
    expect(outcome.refusals.join(" ")).toMatch(/own commit/);
    // Refused BEFORE the gates: a green from a gate this branch narrowed would
    // be the most misleading line in the report.
    expect(calls).not.toContain("npx vitest run");
    expect(calls.some((c) => c.startsWith("gh pr merge"))).toBe(false);
  });

  test("a branch whose coverage change declares a model as an author does not ship", () => {
    const { run, calls } = repoWith([
      commit({
        sha: "eeeeeeee5555",
        date: "2026-08-24T11:00:00Z",
        author: HUMAN,
        subject: "chore(gates): skip the file that keeps failing",
        paths: [COVERAGE_REGIME_MARKER],
        body: "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>\n",
      }),
    ]);
    const outcome = ship({ repo: "/repo", run });

    expect(outcome.shipped).toBe(false);
    expect(outcome.refusals.join(" ")).toMatch(/only a human may change what a gate covers/i);
    expect(calls).not.toContain("npx tsc --noEmit");
  });

  test("a human's isolated coverage change reaches the gates", () => {
    const { run, calls } = repoWith([
      commit({
        sha: "ffffffff6666",
        date: "2026-08-24T12:00:00Z",
        author: HUMAN,
        subject: "chore(gates): quarantine the contended perf file",
        paths: [COVERAGE_REGIME_MARKER],
      }),
    ]);
    const outcome = ship({ repo: "/repo", run, dryRun: true });

    expect(outcome.refusals).toEqual([]);
    expect(calls).toContain("npx tsc --noEmit");
  });

  test("a branch that changes nothing about coverage is not refused", () => {
    const { run } = repoWith([]);
    expect(ship({ repo: "/repo", run, dryRun: true }).refusals).toEqual([]);
  });

  test("before the definition existed there was nothing to narrow", () => {
    // The bootstrap, stated rather than left implicit: every commit in this
    // repository's history that touched a coverage-bearing file also touched
    // something else, so enforcing backwards would refuse every branch for ever.
    const { run } = repoWith(
      [
        commit({
          sha: "99999999aaaa",
          date: "2026-07-22T10:00:00Z",
          author: HUMAN,
          subject: "scaffold",
          paths: ["tsconfig.json", "package.json"],
        }),
      ],
      { [`git cat-file -e origin/main:${COVERAGE_REGIME_MARKER}`]: { status: 1, output: "" } },
    );
    expect(branchCoverageRefusals("/repo", "main", run)).toEqual([]);
  });
});

describe("a run cannot reduce coverage by accident either", () => {
  test("an unreadable diff runs every gate, not the two an empty change set selects", () => {
    // The narrowing this repository was actually performing: `changed` fell back
    // to `[]` when `git diff` failed, `gatesFor([])` returns the core two, and a
    // branch that rewrote `src/` shipped with bundle-drift never run and a green
    // report saying every gate passed.
    expect(gatesFor([]).map((g) => g.name)).toEqual(["tsc", "vitest"]);
    expect(allGates().map((g) => g.name)).toEqual(["tsc", "vitest", "bundle-drift", "skill-drift"]);

    const { run, calls } = repoWith([], {
      "git diff --name-only origin/main...HEAD": { status: 128, output: "fatal: ambiguous argument" },
    });
    ship({ repo: "/repo", run, dryRun: true });
    expect(calls).toContain("npm run bundle");
    expect(calls).toContain("npm run gen:skill");
  });
});

describe("the definition stays where a commit can be counted", () => {
  test("the declaration file holds the gates, and holds nothing that is not a gate", () => {
    const source = read(COVERAGE_REGIME_MARKER);
    expect(source).toContain("export const CORE_GATES");
    expect(source).toContain("export const CONDITIONAL_GATES");
    expect(source).toContain("export const SUITE_EXCLUSIONS");
    // No imports and no functions: a file that grows machinery starts attracting
    // ordinary edits, and the isolation rule turns into an obstacle people route
    // around rather than a boundary they keep.
    expect(source).not.toMatch(/^import /m);
    expect(source).not.toMatch(/^export function /m);
  });

  test("the suite gate's exclusions come from the declaration, not from vitest.config.ts", () => {
    const config = read("vitest.config.ts");
    expect(config).toContain("SUITE_EXCLUSIONS");
    // Read what it RUNS, not what it says: the module note names the excluded
    // file in prose on purpose, and a check that could not tell prose from an
    // array literal would force the reason out of the file to stay green.
    const executable = config.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // A NAMED test file is the narrowing that would be invisible to
    // `git log -- src/release/gates.declared.ts`. Two literals here are not
    // that: the `include` glob is what the gate COLLECTS, and the bare
    // `".test.ts"` is a suffix handed to `path.basename`. A named file has a
    // directory in front of it and no wildcard in it.
    const named = [...executable.matchAll(/"([^"]*\.test\.ts)"/g)]
      .map((m) => m[1]!)
      .filter((s) => s.includes("/") && !s.includes("*"));
    expect(named).toEqual([]);
    expect(SUITE_EXCLUSIONS).toEqual(["test/eval/calibration-ratio-stability.test.ts"]);
  });

  test("every path that says what a gate covers is watched", () => {
    // A new coverage surface — a second config, a per-gate ignore file — is the
    // drift this fails on. The three below are the only files whose contents
    // decide what the two core gates measure.
    expect([...GATE_DEFINITION_PATHS].sort()).toEqual(
      ["src/release/gates.declared.ts", "tsconfig.json", "vitest.config.ts"].sort(),
    );
    for (const p of GATE_DEFINITION_PATHS) expect(fs.existsSync(path.join(repoRoot, p))).toBe(true);
  });

  test("tsconfig's real scope is what the descriptor was built against", () => {
    // Guard against the descriptor above quietly describing a tsconfig that has
    // moved on, which would make every narrowing case here a test of a fixture.
    const tsconfig = JSON.parse(read("tsconfig.json")) as { include: string[]; exclude: string[] };
    expect(declared.typeCheck.include).toEqual(tsconfig.include);
    expect(declared.typeCheck.exclude).toEqual(tsconfig.exclude);
  });
});

describe("no agent surface offers a coverage change as a call", () => {
  test("no allowlisted or MCP tool names a gate, a coverage change or a skip", () => {
    for (const name of [...ALLOWED_TOOL_NAMES, ...MCP_TOOL_NAMES]) {
      expect(name).not.toMatch(/set_gate|gate_scope|coverage|exclude|skip|quarantine|disable/i);
    }
    // `ost_gate` exists and must stay a reporter: it answers whether a solution
    // has a tested assumption, and takes one argument, which is a title.
    expect(MCP_TOOL_NAMES).toContain("ost_gate");
  });

  test("the ship command takes no option that selects or skips gates", () => {
    const cli = read("src/cli/index.ts");
    const block = cli.slice(cli.indexOf('.command("ship")'));
    const shipOptions = block.slice(0, block.indexOf(".action(")).match(/\.option\("([^"]+)"/g) ?? [];
    expect(shipOptions.join(" ")).not.toMatch(/gate|exclude|skip|only|filter/i);
  });

  test("ship consults the coverage rule before it runs a gate", () => {
    // Ordering as source, not as behaviour, because the behavioural test above
    // could be satisfied by a check that happens to refuse first for another
    // reason. The call site is what has to stay put.
    const source = read("src/release/ship-repo.ts");
    const consulted = source.indexOf("const coverage = branchCoverageRefusals");
    const selected = source.indexOf('run(["git", "diff", "--name-only"');
    expect(consulted).toBeGreaterThan(-1);
    expect(selected).toBeGreaterThan(-1);
    expect(consulted).toBeLessThan(selected);
  });
});

describe("the rule is live in this checkout", () => {
  test("this repository's own gate definition is the file the rule watches", () => {
    // Non-vacuity against the real repository rather than a fixture: the gates
    // imported here are the ones `ship` runs, and their coverage is what the
    // descriptor above describes.
    expect(CORE_GATES.map((g) => g.argv.join(" "))).toEqual(["npx tsc --noEmit", "npx vitest run"]);
    expect(CONDITIONAL_GATES.map((g) => g.name)).toEqual(["bundle-drift", "skill-drift"]);
    expect(declared.gates.find((g) => g.name === "bundle-drift")!.firesOn).toContain("src/cli/index.ts");
    expect(declared.gates.find((g) => g.name === "tsc")!.firesOn).toBeNull();
  });

  test("git can already answer 'when did what a gate covers change'", () => {
    // The countability claim, run against this checkout rather than a fake. It
    // asserts the query works and returns commits — not how many, which is the
    // number a person is meant to read and judge.
    const log = execFileSync(
      "git",
      ["log", "--format=%H", "--no-patch", "--", ...GATE_DEFINITION_PATHS],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(log.trim().split("\n").filter(Boolean).length).toBeGreaterThan(0);
  });
});
