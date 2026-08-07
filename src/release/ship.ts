/**
 * Merge a branch on evidence this machine earned, rather than on a check it can
 * only ask about.
 *
 * **The failure this exists to end, measured rather than imagined.** The build
 * loop's shipping step was `gh pr checks --watch` bounded by a timeout. That
 * makes merging conditional on an event the loop cannot subscribe to, and the
 * tree has twenty sessions saying what it costs: fourteen distinct pull requests
 * polled with the identical sleep-then-check construct, a session whose entire
 * friction record is a two-minute timeout after five `still pending` reads, and
 * `gh pr checks 17` exiting 8 for *not finished yet* — a non-zero exit
 * indistinguishable at the call site from a failure. On 2026-08-06 GitHub
 * acquired no runner for four hours; four finished branches (#70, #71, #72, #74)
 * sat open behind checks that were never dispatched, and one pass spent its
 * whole shipping budget in a fifteen-minute watch on a run that did not exist.
 *
 * The gates were never the problem. `npx tsc --noEmit` and `npx vitest run` are
 * the same commands CI runs, and this machine can run them. What CI added was an
 * *independent observer* — something with no stake in the answer watching the
 * exit code. That property is worth keeping, and it is the reason none of this
 * lives in the builder's prompt: a model that is told "run the gates, then
 * merge" is a model asserting its own health, which is the exact shape
 * {@link ../loop/exitLaundering.ts} exists to refuse. So the builder pushes and
 * opens a pull request, and *this* runs the gates and decides. The observer
 * moved from GitHub's runner to the loop's own shell; it did not disappear.
 *
 * **Every gate is argv, never a shell string.** There is no interpreter here for
 * a metacharacter to reach, and — the load-bearing half — no pipeline for an
 * exit code to be laundered through. A gate that cannot report red is not a
 * gate, and the way that failure actually arrived once was `bash -c "npx vitest
 * run 2>&1 | tail -25"`, which recorded exit 0 while vitest was not installed.
 *
 * **What is deliberately NOT reproduced from CI.** CI runs `npm ci` into a clean
 * checkout; this runs against the working tree's installed `node_modules`. So a
 * dependency that is present here and missing from `package.json` would pass
 * here and fail there. That is a real narrowing and it is stated rather than
 * papered over: the committed workflow still runs on `main` and on pull
 * requests, so the clean-install check survives as an after-the-fact signal. It
 * is simply no longer something a merge waits on.
 */
import { spawnSync } from "node:child_process";

/** A command whose exit code decides whether the branch may merge. */
export interface Gate {
  /** Short name, used in the report line. */
  readonly name: string;
  /** The command as argv. Never a shell string — see the module note. */
  readonly argv: readonly string[];
  /** Why this gate exists, for the refusal message when it goes red. */
  readonly why: string;
}

/** What a gate did when it was run. */
export interface GateRun {
  readonly gate: Gate;
  readonly exitCode: number | null;
  readonly passed: boolean;
  /** Tail of the combined output — failures land at the end, not the start. */
  readonly excerpt: string;
}

/** The state a branch is in, as read off the repository. */
export interface BranchState {
  readonly branch: string;
  readonly defaultBranch: string;
  /** Uncommitted changes present in the working tree. */
  readonly dirty: boolean;
  /** Commits this branch has that the default branch does not. */
  readonly ahead: number;
}

/**
 * The always-run gates, in the order a human would want them to fail.
 *
 * `tsc` first because a type error makes every test failure downstream of it
 * noise, and a builder reading one line of report should see the cause rather
 * than its consequences.
 */
export const CORE_GATES: readonly Gate[] = [
  {
    name: "tsc",
    argv: ["npx", "tsc", "--noEmit"],
    why: "the tree must type-check before anything else is worth reading",
  },
  {
    name: "vitest",
    argv: ["npx", "vitest", "run"],
    why: "the suite is the definition of done for everything already shipped",
  },
];

/**
 * The conditional gates, which exist because their subject is a COMMITTED
 * ARTIFACT that can drift from the source it is generated out of.
 *
 * Neither is covered by the suite in the way it needs to be: `dist/ost-agent.mjs`
 * is what the plugin actually launches, so if it may drift, what users run is
 * whatever was last remembered to be rebuilt.
 */
export const CONDITIONAL_GATES: readonly (Gate & { readonly when: (changed: readonly string[]) => boolean })[] = [
  {
    name: "bundle-drift",
    argv: ["npm", "run", "bundle"],
    why: "the plugin launches the committed bundle, so a stale one ships code nobody reviewed",
    when: (changed) => changed.some((p) => p.startsWith("src/")),
  },
  {
    name: "skill-drift",
    argv: ["npm", "run", "gen:skill"],
    why: "SKILL.md is generated from the ruleset and is what an agent actually reads",
    when: (changed) => changed.includes("src/knowledge/ruleset.ts"),
  },
];

/** The artifact each conditional gate regenerates, checked for drift afterwards. */
export const GENERATED_ARTIFACT: Readonly<Record<string, string>> = {
  "bundle-drift": "dist/ost-agent.mjs",
  "skill-drift": "SKILL.md",
};

/**
 * Which gates apply to a branch that touched these paths.
 *
 * Pure on purpose: which gates run is the part of this that most wants pinning
 * by a test, and it should not need a repository to answer.
 */
export function gatesFor(changed: readonly string[]): Gate[] {
  const conditional = CONDITIONAL_GATES.filter((g) => g.when(changed)).map(
    ({ name, argv, why }) => ({ name, argv, why }),
  );
  return [...CORE_GATES, ...conditional];
}

/**
 * Why this branch may not be shipped at all, before any gate is run.
 *
 * Returns every reason rather than the first, because an unattended caller gets
 * one report and fixing one precondition only to be refused for the next is the
 * loop this is meant to remove.
 */
export function shipRefusals(state: BranchState): string[] {
  const reasons: string[] = [];
  if (state.branch === state.defaultBranch) {
    reasons.push(
      `refusing to ship "${state.branch}": it IS the default branch. Work is merged INTO ${state.defaultBranch}, never from it.`,
    );
  }
  if (state.branch === "HEAD") {
    reasons.push("refusing to ship a detached HEAD: there is no branch here to merge or delete.");
  }
  if (state.dirty) {
    reasons.push(
      "refusing to ship with uncommitted changes: the gates would measure a working tree that is not what merges. Commit or stash first.",
    );
  }
  if (state.ahead === 0 && state.branch !== state.defaultBranch) {
    reasons.push(
      `refusing to ship "${state.branch}": it has no commits that ${state.defaultBranch} does not already have. There is nothing to merge.`,
    );
  }
  return reasons;
}

/** Keep the last few lines of output — a failing suite reports at the end. */
export function tail(output: string, lines = 20): string {
  const kept = output.trimEnd().split("\n").slice(-lines);
  return kept.join("\n");
}

/** How a command is actually run. Injectable so tests never spawn anything. */
export type Runner = (argv: readonly string[], cwd: string) => { status: number | null; output: string };

const spawnRunner: Runner = (argv, cwd) => {
  const [command, ...args] = argv;
  // shell:false is the default and is the point — see the module note on laundering.
  const run = spawnSync(command!, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  // A spawn that never started (ENOENT) has a null status. That is a red gate,
  // not a passed one: the command that was supposed to prove something did not run.
  return { status: run.error ? null : run.status, output: run.error ? `${output}${run.error.message}` : output };
};

/**
 * Run gates in order, stopping at the first red.
 *
 * Stopping early is deliberate. The report exists to name ONE thing to fix, and
 * a builder handed four failures caused by one type error has been given noise.
 */
export function runGates(gates: readonly Gate[], repo: string, run: Runner = spawnRunner): GateRun[] {
  const runs: GateRun[] = [];
  for (const gate of gates) {
    const { status, output } = run(gate.argv, repo);
    const passed = status === 0;
    runs.push({ gate, exitCode: status, passed, excerpt: tail(output) });
    if (!passed) break;
  }
  return runs;
}

/** Everything `ship` decided and observed, for the caller to report. */
export interface ShipOutcome {
  readonly shipped: boolean;
  /** Preconditions that refused before any gate ran. */
  readonly refusals: readonly string[];
  readonly gateRuns: readonly GateRun[];
  /** One line naming what happened, suitable for a loop report. */
  readonly summary: string;
}

/** The gate that went red, if any did. */
export function redGate(runs: readonly GateRun[]): GateRun | undefined {
  return runs.find((r) => !r.passed);
}

/**
 * Compose the one-line summary a loop report carries.
 *
 * Written here rather than at the call site so the shell, the CLI and the tests
 * all say the same thing about the same outcome.
 */
export function summarize(branch: string, refusals: readonly string[], runs: readonly GateRun[]): string {
  if (refusals.length > 0) return `not shipped — ${refusals[0]}`;
  const red = redGate(runs);
  if (red) {
    const code = red.exitCode === null ? "did not run" : `exit ${red.exitCode}`;
    return `not shipped — the "${red.gate.name}" gate went red (${code}). ${red.gate.why}.`;
  }
  const names = runs.map((r) => r.gate.name).join(", ");
  return `shipped "${branch}" — ${runs.length} gate(s) green locally (${names}), merged without waiting on any external check.`;
}
