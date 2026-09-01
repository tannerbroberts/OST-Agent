/**
 * The scaffold-init census: would initialising **only the directories this tool
 * scaffolded** have prevented the exit-128 failures this project actually hit, and is
 * initialising safe everywhere it would have run?
 *
 * The solution under test is "Scaffolding initialises unconditionally, so the state is
 * never in question" — remove the variance rather than detect it. Its own text narrows
 * that before the definition of done, because the broad form writes to the operator's
 * disk unasked: *initialise unconditionally when scaffolding a new directory this tool
 * created, and never touch one it did not*. The assumption test fixes the bar as two
 * clauses, both of which must pass: the narrowed rule covers **all** the captured
 * failures, and **no** scaffold target in the record lies inside an existing repository.
 *
 * ## This command being green does not mean the assumption held
 *
 * It came out **refuted**, on the first clause, by the widest possible margin: the
 * narrowed rule would have prevented **0 of 6** captured failures. Not one of them
 * happened in a directory `ost-agent init` had ever been pointed at. The command is
 * green because the count has been taken and pinned — the convention
 * `test/runner/workspace-state-probe-coverage.test.ts` and
 * `test/runner/workspace-map-coverage.test.ts` both run under. Whoever reads this exit
 * code must read `census.headline.meetsBar` with it, which is why it is asserted `false`
 * by name below rather than left to be inferred.
 *
 * ## Three things the count says that the node does not
 *
 * 1. **The mechanism already ships.** The node's "red today: scaffolding does not
 *    initialise" is wrong about this repository — `initVault` calls `gitInitIfAbsent` on
 *    every scaffold and there is no flag to skip it. What is missing is not the
 *    behaviour but any overlap between it and these failures.
 * 2. **The record holds six failures, not four.** The node counts four sessions; the
 *    record has six, in four directories, and three of the six are the *same directory*
 *    failing three times. Two of the six are uncited entirely.
 * 3. **On one of them, initialising would have been worse than doing nothing.**
 *    `/tmp/ost-main` was the carcass of a pruned worktree. `git init` there builds a
 *    repository disconnected from the history the run believed it was on, and the run
 *    commits against it. The `fatal:` the node calls the problem is the cheaper answer.
 *
 * The rule is `SCAFFOLD_INIT_RULE`, committed in `src/runner/scaffold-init.ts` before
 * the corpus was counted, and the corpus is frozen in `test/fixtures/scaffold-init/`
 * (see its `PROVENANCE.md` for the cut and every exclusion). This test asserts the shape
 * of the rule as well as its output, so a later edit shows up here as a changed
 * expectation rather than as a quietly different finding.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  classifyUninitialisedRepoFailure,
  enclosingWorkingTree,
  formatScaffoldInitCensus,
  nestingClause,
  scaffoldInitCoverage,
  shellSegments,
  workingDirectoryAt,
  workingDirectoryOf,
  CITED_SESSIONS,
  HARMFUL_TARGETS,
  SCAFFOLD_INIT_RULE,
  type CreationEvidence,
  type ScaffoldTarget,
  type UninitialisedRepoFailure,
  type WorkingTreeDir,
} from "../../src/runner/scaffold-init.js";
import type { FailingCall } from "../../src/telemetry/path-failure-attribution.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "scaffold-init");

// ── the rule, before any number is read off it ───────────────────────────────

describe("the rule was committed before the corpus was counted", () => {
  test("the bar is total coverage, because a rule that covers some of them leaves the failure in place", () => {
    expect(SCAFFOLD_INIT_RULE.coverageMustBeTotal).toBe(true);
  });

  test("`tool-created` is pinned in the rule, because clause one cannot be decided without it", () => {
    // The one thing the node left open and this census had to close. The bar is the
    // strict reading; the generous one is run beside it so no argument about definitions
    // can be made after the fact.
    expect(SCAFFOLD_INIT_RULE.bar).toBe("scaffolder");
    expect(Object.keys(SCAFFOLD_INIT_RULE.creatorReadings).sort()).toEqual(["any-agent-tool", "scaffolder"]);
    expect(SCAFFOLD_INIT_RULE.creatorReadings.scaffolder).toContain("OST-Agent has exactly one workspace-creating command");
    expect(SCAFFOLD_INIT_RULE.creatorReadings["any-agent-tool"]).toContain("Generous");
  });

  test("nesting is strict containment, so a target that IS a repository is not counted as one", () => {
    // `gitInitIfAbsent` returns false at a repository root and nothing happens. The harm
    // the node names is a fresh .git appearing *under* an existing one.
    expect(SCAFFOLD_INIT_RULE.nestingIsStrictContainment).toBe(true);
  });

  test("the failure shape is git's own words, not the exit code", () => {
    // `Exit code 128` also covers divergent branches, an existing branch name, a bad
    // pathspec and a missing upstream, and none of those asks whether the directory is a
    // repository at all.
    expect(SCAFFOLD_INIT_RULE.failureSignature.test("fatal: not a git repository (or any of the parent directories): .git")).toBe(true);
    expect(SCAFFOLD_INIT_RULE.failureSignature.test("Exit code 128 fatal: a branch named 'x' already exists")).toBe(false);
    expect(SCAFFOLD_INIT_RULE.failureSignature.test("Exit code 128 fatal: pathspec 'y' did not match any files")).toBe(false);
  });
});

// ── reading the directory a call ran in, off the call ────────────────────────

describe("where a command ran, read off the command", () => {
  test("a tool call restates its own cwd, and the leading cd is it", () => {
    expect(workingDirectoryOf("cd /Users/tanner/dev/apple-epoch-primes && ls -la && git log")).toBe("/Users/tanner/dev/apple-epoch-primes");
    expect(workingDirectoryOf('cd "/tmp/with space" && git status')).toBe("/tmp/with space");
  });

  test("a later cd wins, because the record is full of `cd /tmp && mkdir x && cd x`", () => {
    // Reading only the leading cd would attribute an init in `x` to `/tmp`, and the
    // whole safety clause is about which directory a path is under.
    expect(workingDirectoryOf("cd /tmp && rm -rf ost-probe && mkdir ost-probe && cd ost-probe && node x.mjs init --vault .")).toBe("/tmp/ost-probe");
  });

  test("a command that does not say where it ran answers null rather than guessing", () => {
    expect(workingDirectoryOf("git log --oneline -1")).toBeNull();
    expect(workingDirectoryOf("cd ../sibling && git status")).toBeNull();
  });

  test("a cd nobody can resolve poisons everything after it, rather than being skipped", () => {
    // Skipping `cd $D` would silently attribute the init to whatever directory the
    // *previous* cd named, which is a different directory on a different disk.
    expect(workingDirectoryOf('cd /tmp && cd "$D" && node x.mjs init v')).toBeNull();
  });

  test("segments and the cwd at one of them come apart, so an init mid-command is placed correctly", () => {
    const segments = shellSegments("cd /tmp && mkdir a && cd a && node x.mjs init b");
    expect(segments).toHaveLength(4);
    expect(workingDirectoryAt(segments, 1)).toBe("/tmp");
    expect(workingDirectoryAt(segments, 3)).toBe("/tmp/a");
  });
});

describe("recognising the captured failure", () => {
  const call = (error: string, command = "cd /tmp/x && git log"): FailingCall => ({ session: "s", tool: "Bash", command, error });

  test("a compound command that hit it twice is one call carrying two occurrences", () => {
    const c = classifyUninitialisedRepoFailure(
      call("Exit code 128 --- git --- fatal: not a git repository (or any of the parent directories): .git fatal: not a git repository (or any of the parent directories): .git"),
    ) as UninitialisedRepoFailure;
    expect(c.occurrences).toBe(2);
    expect(c.dir).toBe("/tmp/x");
  });

  test("another exit-128 is not this failure", () => {
    expect(classifyUninitialisedRepoFailure(call("Exit code 128 fatal: a branch named 'sense-census-report' already exists"))).toBeNull();
  });
});

// ── containment ──────────────────────────────────────────────────────────────

describe("whether a target lies inside an existing working tree", () => {
  const trees: WorkingTreeDir[] = [
    { dir: "/Users/tanner/dev/OST-Agent", reads: 2774 },
    { dir: "/Users/tanner/dev/OST-Agent/.worktrees/run-tool-surface", reads: 10 },
    { dir: "/tmp/ost-probe", reads: 1 },
  ];

  test("the nearest enclosing tree wins, not the outermost", () => {
    // A .git created under `.worktrees/run-tool-surface` sits inside the worktree, and
    // the worktree is the repository it would confuse.
    expect(enclosingWorkingTree("/Users/tanner/dev/OST-Agent/.worktrees/run-tool-surface/sub", trees)).toBe(
      "/Users/tanner/dev/OST-Agent/.worktrees/run-tool-surface",
    );
  });

  test("a directory is not inside itself, so scaffolding onto an existing repo is not nesting", () => {
    expect(enclosingWorkingTree("/tmp/ost-probe", trees)).toBeNull();
  });

  test("a sibling whose path merely shares a prefix is not contained", () => {
    // String-prefix containment would call `/tmp/ost-probe2` a child of `/tmp/ost-probe`.
    expect(enclosingWorkingTree("/tmp/ost-probe2", trees)).toBeNull();
  });

  test("a real nesting is reported with the tree it would sit inside", () => {
    const targets: ScaffoldTarget[] = [{ dir: "/Users/tanner/dev/OST-Agent/vault", command: "init vault", session: "s" }];
    const clause = nestingClause(targets, trees);
    expect(clause.passes).toBe(false);
    expect(clause.nested).toEqual([{ target: "/Users/tanner/dev/OST-Agent/vault", inside: "/Users/tanner/dev/OST-Agent" }]);
    // Not vacuous: something outside a temp root was actually checked.
    expect(clause.vacuous).toBe(false);
  });

  test("an unresolvable target is not checked, and is counted rather than dropped", () => {
    // `init "$D/v"` cannot be turned into a path after the fact. Counting it as checked
    // would let the safety clause pass on a row nobody looked at.
    const clause = nestingClause([{ dir: null, command: 'init "$D/v"', session: "s", unresolved: "shell variable" }], trees);
    expect(clause.checked).toBe(0);
    expect(clause.unresolved).toBe(1);
  });
});

// ── the census over the committed corpus ─────────────────────────────────────

interface Corpus {
  upstreamFailures: number;
  transcriptsRead: number;
  toolCalls: number;
  uninitialisedRepoFailures: number;
  failureDirs: string[];
  sessionsMissingFromDisk: string[];
  prose: { session: string; command: string }[];
  targets: ScaffoldTarget[];
  trees: WorkingTreeDir[];
  worktreesAdded: string[];
  evidence: CreationEvidence[];
}

function committed(): { failures: UninitialisedRepoFailure[]; corpus: Corpus } {
  return {
    failures: JSON.parse(fs.readFileSync(path.join(fixtureDir, "failures.json"), "utf8")) as UninitialisedRepoFailure[],
    corpus: JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8")) as Corpus,
  };
}

describe("the census over the committed corpus", () => {
  const { failures, corpus } = committed();
  const census = scaffoldInitCoverage(failures, corpus.targets, corpus.trees, corpus.evidence, {
    citedSessions: CITED_SESSIONS,
    harm: HARMFUL_TARGETS,
    worktreesAdded: corpus.worktreesAdded,
  });

  test("the failure half of the corpus re-derives from the committed upstream", () => {
    // The fixture is an output, not a hand-list, and its upstream is the same
    // `path-failure-attribution` cut the workspace-state census reads — so the two
    // cannot disagree about what failed. Re-deriving here means a change to the
    // classifier cannot leave a stale corpus behind agreeing with a number nobody
    // computes any more.
    const upstream = fs
      .readFileSync(path.join(repoRoot, "test/fixtures/path-failure-attribution/failures.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as FailingCall);
    expect(upstream).toHaveLength(corpus.upstreamFailures);
    expect(upstream.map(classifyUninitialisedRepoFailure).filter(Boolean)).toEqual(failures);
    expect(failures).toHaveLength(6);
  });

  test("THE ASSUMPTION IS REFUTED — the narrowed rule covers 0 of 6 captured failures", () => {
    // Read this with the exit code. The command is green because the count has been
    // taken; the count says the narrowed rule would have prevented none of them.
    expect(census.headline.failures).toBe(6);
    expect(census.headline.covered).toBe(0);
    expect(census.headline.meetsBar).toBe(false);
    expect(census.coverage.scaffolder).toEqual({ covered: 0, failures: 6, passes: false });
    expect(formatScaffoldInitCensus(census)).toContain("REFUTED");
  });

  test("the generous reading does not rescue it either", () => {
    // Credit the rule with every directory *any* tool call created — a Write, a mkdir, a
    // worktree — and it still reaches only 4 of 6. There is no reading of "tool-created"
    // on which this clause passes, so the shortfall is not an argument about definitions.
    expect(census.coverage["any-agent-tool"]).toEqual({ covered: 4, failures: 6, passes: false });
  });

  test("the record holds six failures in four directories, where the node counted four sessions", () => {
    // Three of the six are one directory failing three times, in three sessions, over
    // one afternoon. A count of sessions and a count of *distinct failing workspaces*
    // are different numbers, and the node's argument reads as though they were the same.
    expect(census.headline.directories).toBe(4);
    expect(census.citedVersusFound.cited).toHaveLength(4);
    expect(census.citedVersusFound.found).toHaveLength(6);
    expect(census.citedVersusFound.uncited).toEqual(["0f940e60-26f9-459a-ace4-5af5ce438e2b", "agent-a022e255367d9bdf0"]);
    const primes = census.byDirectory.find((r) => r.dir === "/Users/tanner/dev/apple-epoch-primes");
    expect(primes?.failures).toBe(3);
    expect(primes?.sessions).toHaveLength(3);
  });

  test("every failure's directory is named by its own command — none is unattributed", () => {
    expect(census.directoryUnknown).toBe(0);
    expect(corpus.failureDirs).toEqual([
      "/Users/tanner/dev/apple-epoch-primes",
      "/Users/tanner/dev/ost-benchmarks",
      "/tmp/ost-main",
      "/tmp/ost-npm-archive",
    ]);
  });

  test("not one failing directory was created by this tool's scaffolder", () => {
    // The whole of clause one, in one line. `ost-agent init` was never pointed at any of
    // them: two were made by the coding agent's own Write and mkdir, one by
    // `git worktree add`, and one has no surviving record.
    expect(census.byDirectory.every((r) => !r.coveredByScaffolder)).toBe(true);
    expect(census.byDirectory.filter((r) => r.evidence.creator === null).map((r) => r.dir).sort()).toEqual([
      "/Users/tanner/dev/ost-benchmarks",
      "/tmp/ost-npm-archive",
    ]);
  });

  test("ON ONE OF THEM, INITIALISING WOULD HAVE BEEN WORSE THAN DOING NOTHING", () => {
    // The finding a coverage count on its own cannot produce. `/tmp/ost-main` was the
    // carcass of a pruned worktree — the `git worktree add` that should have made it a
    // repository had just answered `already exists`. A fresh `git init` there yields a
    // repository holding a whole tree of untracked files, disconnected from the history
    // the run believed it was on, and the run's next act is to commit against it.
    expect(census.harmful.map((r) => r.dir)).toEqual(["/tmp/ost-main"]);
    const row = census.harmful[0];
    expect(row.harm).toContain("carcass of a pruned worktree");
    expect(row.evidence.creator?.command).toContain("git worktree add /tmp/ost-main main");
    expect(formatScaffoldInitCensus(census)).toContain("INITIALISING HERE WOULD HAVE BEEN WRONG");
  });

  test("CLAUSE TWO PASSES, AND IT PASSES ON AN EMPTY ROOM", () => {
    // No scaffold target in the record lies inside an existing working tree — but every
    // single checked target is a throwaway under /tmp or a scratchpad. The record says
    // what has been tried, not what is safe, and `vacuous` is what stops the pass being
    // read as evidence of safety.
    expect(census.nesting.passes).toBe(true);
    expect(census.nesting.nested).toEqual([]);
    expect(census.nesting.checked).toBe(13);
    expect(census.nesting.underTempRoot).toBe(13);
    expect(census.nesting.vacuous).toBe(true);
    // Six targets are `$V`, `$D/v`, `"$d/vault"` or documentation placeholders. They are
    // counted as unchecked, not as passes.
    expect(census.nesting.unresolved).toBe(6);
  });

  test("the record does create nested repositories — by another hand than the scaffolder", () => {
    // So the safety clause is not dismissed as theoretical. A floor, not a total: only
    // the worktrees a Bash `git worktree add` created can be attributed here.
    expect(census.nesting.nestedWorkingTreesInRecord).toEqual([
      { dir: "/Users/tanner/dev/OST-Agent/.worktrees/run-tool-surface", inside: "/Users/tanner/dev/OST-Agent" },
    ]);
    expect(corpus.worktreesAdded.length).toBeGreaterThan(census.nesting.nestedWorkingTreesInRecord.length);
  });

  test("the mechanism the node proposes is already shipped, with no flag to skip it", () => {
    // The node's "red today: scaffolding does not initialise" is wrong about this
    // repository, and the census reports that rather than quietly building it twice.
    expect(census.alreadyShipped).toEqual({ where: "src/runner/init.ts", call: "gitInitIfAbsent(abs)", skippable: false });
    const init = fs.readFileSync(path.join(repoRoot, "src/runner/init.ts"), "utf8");
    expect(init).toContain("await gitInitIfAbsent(abs)");
    // Unconditional: no flag, no option, no early return between entering `initVault`
    // and the call. If that ever stops being true this expectation is where it surfaces.
    const body = init.slice(init.indexOf("export async function initVault"), init.indexOf("await gitInitIfAbsent(abs)"));
    expect(body).not.toMatch(/\breturn\b|\bif\s*\(/);
  });

  test("the corpus records what it could not read, rather than counting it as a no", () => {
    // Two of the six sessions no longer exist on disk. Their directories therefore have
    // no creating call, and that is a missing transcript rather than evidence of
    // anything. A census that silently scored them "not tool-created" would be right by
    // accident.
    expect(corpus.sessionsMissingFromDisk).toEqual(["748498c4-31fb-4110-9012-464c441a463f", "agent-a022e255367d9bdf0"]);
    expect(census.byDirectory.filter((r) => r.evidence.absent === "transcript-gone")).toHaveLength(2);
  });

  test("prose quoting `ost-agent init` is separated from a run of it, and counted", () => {
    // A PR body writing ``run `ost-agent init` first`` splits into a segment that looks
    // exactly like an invocation. Letting one in would add a scaffold target nobody ever
    // scaffolded.
    expect(corpus.prose).toHaveLength(1);
    expect(corpus.prose[0].command).toContain("ost-agent init");
    expect(corpus.targets.every((t) => !t.command.includes("`"))).toBe(true);
  });

  test("the report says the verdict in words and publishes what could overturn it", () => {
    const report = formatScaffoldInitCensus(census);
    expect(report).toContain("REFUTED");
    expect(report).toContain("[generous] any-agent-tool: 4/6");
    expect(report).toContain("PASSES VACUOUSLY");
    expect(report).toContain("The node cited 4 session(s); the record holds 6");
    expect(report).toContain("it is not aimed at these failures");
  });
});
