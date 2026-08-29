/**
 * The workspace-state question census: does a **small fixed** set of state questions
 * cover the environment failures this product's own passes actually hit?
 *
 * The solution under test is "One workspace-state probe the run makes before it plans,
 * not one failing command at a time" — one call, before the run commits to a plan,
 * returning the state facts a plan depends on: is this a git repository, does it have
 * a remote, which of the binaries this plan will invoke are on PATH, is there a
 * lockfile, has a build ever run here. The node fixed the bar before anything was
 * counted, and the bar is a **count of questions**: at most six must cover every
 * captured environment failure, and none may require a seventh.
 *
 * ## This command being green does not mean the assumption held
 *
 * It came out **refuted**: covering the 33 state-shaped environment failures in this
 * project's own record takes **nine** questions against a budget of six. The command is
 * green because the count has been taken and pinned — the same convention
 * `test/runner/workspace-map-coverage.test.ts` and
 * `test/friction/path-failure-attribution.test.ts` run under, both of which pin a
 * refuted census. Whoever reads this exit code must read {@link census.headline}
 * `.meetsBar` with it, which is why it is asserted `false` by name below rather than
 * left to be inferred.
 *
 * The shortfall is not noise and not a harsh classifier. The node's five questions
 * predict 22 of 33; the remaining 11 need four questions from outside the set, and the
 * refutation survives every counter-reading run against it — trimming the node question
 * that predicted nothing (8), withdrawing the one generous attribution (10), and
 * widening to the missing-path failures the assumption test also named (10). The single
 * reading that clears is the one that lets a question cover a whole *subsystem*, and
 * that is asserted here too, because the disagreement is the finding: **the bar as the
 * node stated it is not decidable until question granularity is pinned, and the node
 * did not pin it.**
 *
 * The rule is `WORKSPACE_STATE_RULE` and `NODE_QUESTIONS`, committed in
 * `src/runner/workspace-state-probe.ts` before the corpus was counted, and the corpus
 * is frozen in `test/fixtures/workspace-state-probe/` (see its `PROVENANCE.md` for the
 * cut and every exclusion). This test asserts the shape of the rule as well as its
 * output, so a later edit shows up here as a changed expectation rather than as a
 * quietly different finding.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  classifyEnvironmentFailure,
  findGitRoot,
  formatWorkspaceStateCensus,
  looksUpProgram,
  namesMissingProgram,
  probeWorkspaceState,
  renderWorkspaceState,
  shellNotFoundNames,
  workspaceStateCoverage,
  GENEROUS_ATTRIBUTION,
  NODE_QUESTIONS,
  RESIDUAL_QUESTIONS,
  WORKSPACE_STATE_RULE,
  type ClassifiedEnvironmentFailure,
  type ProbeFs,
} from "../../src/runner/workspace-state-probe.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "workspace-state-probe");

// ── the rule, before any number is read off it ───────────────────────────────

describe("the rule was committed before the corpus was counted", () => {
  test("the bar is the one the node fixed: at most six questions, none needing a seventh", () => {
    expect(WORKSPACE_STATE_RULE.maxQuestions).toBe(6);
  });

  test("the question set is the five the node named, and nothing was added to it", () => {
    // Five, not six. The node's budget leaves one slot open and it is left open on
    // purpose: filling it with something read off the corpus is the tuning that would
    // make the count meaningless.
    expect(NODE_QUESTIONS.map((q) => q.id)).toEqual([
      "is-git-repo",
      "has-remote",
      "binaries-on-path",
      "has-lockfile",
      "build-has-run",
    ]);
    expect(NODE_QUESTIONS.every((q) => q.fromNode)).toBe(true);
    expect(RESIDUAL_QUESTIONS.every((q) => !q.fromNode)).toBe(true);
  });

  test("granularity is pinned in the rule, because the bar cannot be decided without it", () => {
    // The one thing the node left open and this census had to close. Asserted so an
    // edit to the granularity call surfaces here rather than as a moved number.
    expect(WORKSPACE_STATE_RULE.granularity).toContain("one fact with a single, plan-independent answer");
    expect(WORKSPACE_STATE_RULE.granularity).toContain("the granularity the node's own five use");
  });

  test("every signature names a question that exists, and no question is invented at classify time", () => {
    const known = new Set([...NODE_QUESTIONS, ...RESIDUAL_QUESTIONS].map((q) => q.id));
    for (const sig of WORKSPACE_STATE_RULE.signatures) expect(known.has(sig.question)).toBe(true);
    expect(known.has("binaries-on-path")).toBe(true);
    expect(known.has("shell-version-floor")).toBe(true);
  });
});

// ── recognising a missing program, which needs the command as well as the error ──

describe("a shell saying a name was not found", () => {
  test("zsh's and bash's `command not found` are conclusive on their own", () => {
    expect(shellNotFoundNames("(eval):4: command not found: timeout").conclusive).toContain("timeout");
    expect(shellNotFoundNames("/h/bin/x: line 21: mapfile: command not found").conclusive).toContain("mapfile");
  });

  test("the word `command` is never read as a program name", () => {
    // It is the tail of the conclusive forms above, and a classifier that took it
    // would report a missing program on every single one of them.
    const names = shellNotFoundNames("/h/bin/x: line 21: mapfile: command not found");
    expect(names.ambiguous).not.toContain("command");
  });

  test("a bare `X not found` is ambiguous and is not conclusive by itself", () => {
    expect(shellNotFoundNames("Exit code 1 psql not found").conclusive).toEqual([]);
    expect(shellNotFoundNames("Exit code 1 psql not found").ambiguous).toEqual(["psql"]);
  });

  test("an ambiguous name counts only when the command looked it up", () => {
    // The failure this guard exists for: `gh release view npm-archive` answers
    // `release not found` in exactly the shape `which psql` does, and `release` is
    // not a program anyone tried to run.
    expect(namesMissingProgram({ session: "s", tool: "Bash", command: "which psql", error: "psql not found" }).programs).toEqual(["psql"]);
    expect(
      namesMissingProgram({ session: "s", tool: "Bash", command: "gh release view npm-archive", error: "release not found" }).programs,
    ).toEqual([]);
  });

  test("looksUpProgram finds a name anywhere in a multi-name lookup, not just first", () => {
    expect(looksUpProgram("which gtimeout timeout", "timeout")).toBe(true);
    expect(looksUpProgram("which tmux script", "tmux")).toBe(true);
    expect(looksUpProgram("command -v pnpm", "pnpm")).toBe(true);
    expect(looksUpProgram("gh release view npm-archive", "release")).toBe(false);
  });

  test("a bash builtin is not a PATH question, and is separated from one", () => {
    // `which mapfile` answers nothing whether or not the running bash has it. Folding
    // this into the PATH question would credit that question with a failure it cannot
    // predict — which is why `shell-version-floor` is a residual and not a fold.
    const call = { session: "s", tool: "Bash", command: "bash ost-reports", error: "x: line 21: mapfile: command not found" };
    expect(namesMissingProgram(call)).toEqual({ programs: [], builtins: ["mapfile"] });
    const c = classifyEnvironmentFailure(call) as ClassifiedEnvironmentFailure;
    expect(c.signature).toBe("shell-builtin-missing");
    expect(c.question).toBe("shell-version-floor");
  });

  test("zsh's line number is not read as a program name", () => {
    const call = { session: "s", tool: "Bash", command: "timeout 90 bash x", error: "(eval):1: command not found: pnpm" };
    expect(namesMissingProgram(call).programs).toEqual(["pnpm"]);
  });
});

// ── classification: exclusions run first, most specific shape wins ───────────

describe("classification", () => {
  test("a failure another mechanism owns is excluded by name, not silently dropped", () => {
    const grant = classifyEnvironmentFailure({
      session: "s",
      tool: "Bash",
      command: "",
      error: "Claude requested permissions to use mcp__ost-agent__ost_check, but you haven't granted it yet",
    });
    expect(grant).toEqual({ excluded: "tool-not-granted" });
  });

  test("`command not found` beats a `No such file or directory` sitting beside it", () => {
    // A compound command's output carries both. The shell's report that it could not
    // run a program is the more specific fact about the environment, and reading the
    // generic path shape first would lose it.
    const c = classifyEnvironmentFailure({
      session: "s",
      tool: "Bash",
      command: "timeout 90 bash x; cat report2.txt",
      error: "(eval):4: command not found: timeout === REPORT: cat: report2.txt: No such file or directory",
    }) as ClassifiedEnvironmentFailure;
    expect(c.signature).toBe("program-not-on-path");
    expect(c.question).toBe("binaries-on-path");
  });

  test("a failure about neither the workspace nor a path is not an environment failure", () => {
    expect(
      classifyEnvironmentFailure({ session: "s", tool: "Bash", command: "npx tsc", error: "error TS2339: Property 'x' does not exist on type 'Y'." }),
    ).toBeNull();
  });

  test("a `which` run for its own sake is marked as the probe being done by hand", () => {
    const c = classifyEnvironmentFailure({ session: "s", tool: "Bash", command: "which tmux script", error: "Exit code 127 tmux not found /usr/bin/script" }) as ClassifiedEnvironmentFailure;
    expect(c.probedItself).toBe(true);
    // A program that failed while being *run* is not the probe; it is the failure.
    const ran = classifyEnvironmentFailure({ session: "s", tool: "Bash", command: "pnpm install", error: "(eval):1: command not found: pnpm" }) as ClassifiedEnvironmentFailure;
    expect(ran.probedItself).toBe(false);
  });
});

// ── the census over the committed corpus ─────────────────────────────────────

function committed(): { classified: ClassifiedEnvironmentFailure[]; meta: Record<string, unknown> } {
  const classified = JSON.parse(fs.readFileSync(path.join(fixtureDir, "failures.json"), "utf8")) as ClassifiedEnvironmentFailure[];
  const meta = JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8")) as Record<string, unknown>;
  return { classified, meta };
}

describe("the census over the committed corpus", () => {
  const { classified, meta } = committed();
  const excluded = Object.entries(meta.excluded as Record<string, number>).map(([id, n]) => ({ id, n }));
  const census = workspaceStateCoverage(classified, { callsRead: meta.upstreamFailures as number, excluded });

  test("the corpus is the size PROVENANCE.md says it is, and the piles partition exactly", () => {
    // The upstream cut is the whole path-failure-attribution fixture: every failing
    // tool call from 646 sessions, not just the path-shaped ones.
    expect(meta.upstreamFailures).toBe(719);
    expect(classified).toHaveLength(78);
    expect(meta.environmentFailures).toBe(78);
    expect(meta.stateShaped).toBe(33);
    expect(meta.pathShaped).toBe(45);
    expect(meta.excluded).toEqual({ "literal-match": 13, "tool-not-granted": 132, "timed-out": 20, "worktree-refusal": 1 });
    expect(meta.notEnvironment).toBe(475);

    const droppedTotal = Object.values(meta.excluded as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(droppedTotal + (meta.environmentFailures as number) + (meta.notEnvironment as number)).toBe(719);
  });

  test("the frozen rows are what the committed classifier produces today", () => {
    // The fixture is an output, not a hand-list. Re-deriving it from the upstream file
    // here means a change to the rule cannot leave a stale corpus behind agreeing with
    // a number nobody computes any more.
    const upstream = fs
      .readFileSync(path.join(repoRoot, "test/fixtures/path-failure-attribution/failures.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { session: string; tool: string; command: string; error: string });
    const rederived = upstream
      .map(classifyEnvironmentFailure)
      .filter((r): r is ClassifiedEnvironmentFailure => r !== null && !("excluded" in r));
    expect(rederived).toEqual(classified);
  });

  test("THE ASSUMPTION IS REFUTED — nine questions against a pre-committed budget of six", () => {
    // Read this with the exit code. The command is green because the count has been
    // taken; the count says a fixed set of at most six state questions does NOT cover
    // the environment failures this product's passes suffered.
    expect(census.headline.failures).toBe(33);
    expect(census.headline.covered).toBe(22);
    expect(census.headline.questionsNeeded).toBe(9);
    expect(census.headline.meetsBar).toBe(false);
    expect(formatWorkspaceStateCensus(census)).toContain("REFUTED");
  });

  test("the shortfall is four named questions, not a long tail", () => {
    // Eleven uncovered failures, and they are not eleven different problems: four
    // questions account for all of them. That is the shape the node wanted to know
    // about — it is not twenty questions, it is four more than the budget allows.
    expect(census.headline.residualsUsed).toEqual([
      "ref-name-free",
      "tree-clean-and-in-sync",
      "path-tracked",
      "shell-version-floor",
    ]);
    const outside = census.byQuestion.filter((q) => !q.fromNode && q.question !== "what-is-at-this-path");
    expect(outside.map((q) => q.n)).toEqual([5, 3, 2, 1]);
    expect(outside.reduce((a, q) => a + q.n, 0)).toBe(33 - 22);
  });

  test("one of the node's five questions predicted nothing at all", () => {
    // A budget of six with a dead slot in it. Not one failure in 719 was a missing
    // build output — the node named a question this history never asked.
    expect(census.nodeQuestionsUnused).toEqual(["build-has-run"]);
  });

  test("four of the failing calls WERE the probe, done by hand one binary at a time", () => {
    // `which gtimeout timeout`, `which tmux script`, `which psql` twice. The node's
    // argument is entirely about failures that arrive AFTER the plan is made and does
    // not use these; they are the behaviour the solution's own title names, already
    // being paid for in separate tool calls.
    expect(census.handRolledProbes).toBe(4);
    const byHand = census.classified.filter((c) => c.probedItself);
    expect(byHand.every((c) => c.question === "binaries-on-path")).toBe(true);
  });

  test("the refutation survives every counter-reading that runs in the solution's favour", () => {
    // Widening to the missing-path failures the assumption test also named adds 45
    // failures but only one question, and does not change the verdict.
    expect(census.readings[1].failures).toBe(78);
    expect(census.readings[1].questionsNeeded).toBe(10);
    expect(census.readingDecides).toBe(false);

    // Dropping the dead slot: still over.
    expect(census.counterReadings.trimmed.dropped).toEqual(["build-has-run"]);
    expect(census.counterReadings.trimmed.questionsNeeded).toBe(8);
    expect(census.counterReadings.trimmed.meetsBar).toBe(false);

    // Withdrawing the one generous attribution runs the other way, and is reported so
    // the generosity can be priced rather than trusted.
    expect(census.counterReadings.strict.withdrawn).toBe(GENEROUS_ATTRIBUTION.signature);
    expect(census.counterReadings.strict.failures).toBe(9);
    expect(census.counterReadings.strict.questionsNeeded).toBe(10);
    expect(census.counterReadings.strict.meetsBar).toBe(false);
  });

  test("THE ONE READING THAT CLEARS IS THE ONE THAT COARSENS THE QUESTION", () => {
    // Let a question cover a whole subsystem and three questions cover everything.
    // This is asserted, not hidden, because it is the finding: the node's bar is a
    // count of questions and the node never said what one question is. Whoever reads
    // the refutation above is entitled to this number in the same breath.
    expect(census.aggregateReading.subsystems).toEqual(["dependencies", "git", "tooling"]);
    expect(census.aggregateReading.questionsNeeded).toBe(3);
    expect(census.aggregateReading.meetsBar).toBe(true);
  });

  test("the report says the verdict in words and publishes what could overturn it", () => {
    const report = formatWorkspaceStateCensus(census);
    expect(report).toContain("REFUTED");
    expect(report).toContain("9 question(s), against a pre-committed budget of 6");
    expect(report).toContain("Named by the node and predicted nothing: build-has-run");
    expect(report).toContain("WERE the probe");
    expect(report).toContain("which clears the budget");
    expect(report).toContain("Both readings agree");
  });
});

// ── the probe itself: five answers, one call, no subprocess ──────────────────

/** A hand-built tree: a repo with a remote at `/h/repo`, a bare directory at `/h/plain`. */
function toyFs(): ProbeFs {
  const present = new Set([
    "/h/repo/.git",
    "/h/repo/.git/config",
    "/h/repo/package-lock.json",
    "/h/repo/dist",
    "/usr/bin/git",
    "/opt/homebrew/bin/pnpm",
  ]);
  const files: Record<string, string> = {
    "/h/repo/.git/config": '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = git@github.com:x/y.git\n[remote "fork"]\n\turl = git@github.com:z/y.git\n',
  };
  return {
    exists: (p) => present.has(p),
    read: (p) => files[p] ?? null,
  };
}

const PATH_DIRS = ["/usr/bin", "/opt/homebrew/bin"];

describe("the probe answers all five questions in one call", () => {
  const fsLike = toyFs();

  test("a directory inside a repository resolves to the repository root", () => {
    expect(findGitRoot("/h/repo/src/runner", fsLike)).toBe("/h/repo");
    expect(findGitRoot("/h/repo/", fsLike)).toBe("/h/repo");
  });

  test("a directory outside any repository answers null rather than guessing", () => {
    // The six `not a git repository` failures in the corpus are exactly this case.
    expect(findGitRoot("/h/plain", fsLike)).toBeNull();
  });

  test("the five answers come back together, with remotes read off .git/config", () => {
    const state = probeWorkspaceState({ cwd: "/h/repo/src", binaries: ["git", "pnpm", "tmux"], pathDirs: PATH_DIRS }, fsLike);
    expect(state.gitRoot).toBe("/h/repo");
    expect(state.remotes).toEqual(["origin", "fork"]);
    expect(state.binaries).toEqual([
      { name: "git", foundIn: "/usr/bin" },
      { name: "pnpm", foundIn: "/opt/homebrew/bin" },
      { name: "tmux", foundIn: null },
    ]);
    expect(state.lockfile).toBe("package-lock.json");
    expect(state.buildOutputs).toEqual(["dist"]);
  });

  test("outside a repository the lockfile and build questions fall back to cwd, not to nothing", () => {
    const state = probeWorkspaceState({ cwd: "/h/plain", binaries: [], pathDirs: PATH_DIRS }, fsLike);
    expect(state.gitRoot).toBeNull();
    expect(state.remotes).toEqual([]);
    expect(state.lockfile).toBeNull();
    expect(state.buildOutputs).toEqual([]);
  });

  test("a `no` says what it looked at, because a bare no collapses two different answers", () => {
    // "not a repository" and "a repository with no remote" send a plan in different
    // directions, and the whole point of the probe is to not need a second call.
    const outside = renderWorkspaceState(probeWorkspaceState({ cwd: "/h/plain", binaries: ["tmux"], pathDirs: PATH_DIRS }, fsLike), {
      cwd: "/h/plain",
      binaries: ["tmux"],
      pathDirs: PATH_DIRS,
    });
    expect(outside).toContain("git repository: no — nothing above /h/plain holds a .git");
    expect(outside).toContain("remotes: n/a — not a repository");
    expect(outside).toContain("MISSING tmux");
    expect(outside).toContain("build outputs: none — no build has run here");
  });

  test("the rendered state is one line per question and nothing else", () => {
    const req = { cwd: "/h/repo", binaries: ["git"], pathDirs: PATH_DIRS };
    const lines = renderWorkspaceState(probeWorkspaceState(req, fsLike), req).split("\n");
    // A header plus exactly one line per question the node named.
    expect(lines).toHaveLength(NODE_QUESTIONS.length + 1);
  });
});
