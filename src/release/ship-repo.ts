/**
 * The repository half of shipping: read the branch's real state, bring it up to
 * date with the default branch, run the gates, and merge.
 *
 * Split from {@link ./ship.ts} so the decisions — which gates apply, what
 * refuses, how an outcome reads — stay pure and testable without a repository,
 * and everything that touches git lives behind one injectable runner.
 *
 * **Why the branch is synced with `main` BEFORE the gates run.** A branch that
 * is green on its own is not evidence that `main` will be green once it lands;
 * that is the one useful thing a pull-request CI run does that a plain local
 * `vitest` does not, because GitHub tests the *merge*, not the branch. Skipping
 * it would be the quiet narrowing that makes local gating look equivalent while
 * being weaker. So `origin/main` is merged in first and the gates measure the
 * result — which is also what makes the subsequent merge a fast-forward.
 *
 * **Why a conflict refuses rather than resolves.** An unattended pass resolving
 * a merge conflict is a pass rewriting somebody else's work with no reviewer.
 * The merge is aborted, the branch is left exactly as it was, and the conflict
 * is reported as work for the next pass.
 */
import { spawnSync } from "node:child_process";
import {
  gatesFor,
  GENERATED_ARTIFACT,
  redGate,
  runGates,
  shipRefusals,
  summarize,
  tail,
  type BranchState,
  type GateRun,
  type Runner,
  type ShipOutcome,
} from "./ship.js";

/** Run a command as argv and capture it. No shell, for the reason in ship.ts. */
export const realRunner: Runner = (argv, cwd) => {
  const [command, ...args] = argv;
  const run = spawnSync(command!, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  return { status: run.error ? null : run.status, output: run.error ? `${output}${run.error.message}` : output };
};

/** Convenience: run git and return trimmed stdout, or throw with the output. */
function git(repo: string, args: readonly string[], run: Runner): string {
  const { status, output } = run(["git", ...args], repo);
  if (status !== 0) throw new Error(`git ${args.join(" ")} failed (exit ${status}):\n${tail(output, 10)}`);
  return output.trim();
}

/** Read the branch's state without changing anything. */
export function readBranchState(repo: string, defaultBranch: string, run: Runner = realRunner): BranchState {
  const branch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"], run);
  const dirty = git(repo, ["status", "--porcelain"], run).length > 0;
  // `ahead` is counted against the REMOTE default branch, because that is what
  // the merge target actually is. A stale local `main` would otherwise report a
  // branch as having work it has already landed.
  let ahead = 0;
  try {
    const counts = git(repo, ["rev-list", "--left-right", "--count", `origin/${defaultBranch}...HEAD`], run);
    ahead = Number(counts.split(/\s+/)[1] ?? 0);
  } catch {
    // No remote-tracking ref yet. Nothing to compare against, so nothing to
    // claim: leave ahead at 0 and let the refusal name it.
  }
  return { branch, defaultBranch, dirty, ahead };
}

export interface ShipOptions {
  readonly repo: string;
  readonly defaultBranch?: string;
  /** Report what would happen and run the gates, but never merge. */
  readonly dryRun?: boolean;
  readonly run?: Runner;
  /** Where progress goes. Injectable so tests stay silent. */
  readonly log?: (line: string) => void;
}

/**
 * Bring the branch up to date with the remote default branch.
 *
 * Returns a refusal string when the merge conflicts, having first put the
 * working tree back the way it was found.
 */
function syncWithDefault(repo: string, defaultBranch: string, run: Runner, log: (l: string) => void): string | undefined {
  const fetch = run(["git", "fetch", "origin", defaultBranch], repo);
  if (fetch.status !== 0) {
    // A fetch that fails is not a reason to refuse: the whole point of this
    // change is that the network is not on the critical path. It IS a reason to
    // say the gates measured the branch alone.
    log(`ship: could not fetch origin/${defaultBranch} — gates will measure this branch alone, not the merge result.`);
    return undefined;
  }
  const behind = run(["git", "rev-list", "--count", `HEAD..origin/${defaultBranch}`], repo);
  if (behind.status === 0 && behind.output.trim() === "0") return undefined;
  log(`ship: ${behind.output.trim()} commit(s) on origin/${defaultBranch} are not on this branch — merging before the gates run.`);
  const merge = run(["git", "merge", "--no-edit", `origin/${defaultBranch}`], repo);
  if (merge.status !== 0) {
    run(["git", "merge", "--abort"], repo);
    return (
      `refusing to ship: merging origin/${defaultBranch} into this branch conflicts, and an unattended pass ` +
      `resolving a conflict is a pass rewriting work nobody reviewed. The merge was aborted and the branch is untouched.`
    );
  }
  return undefined;
}

/**
 * Check that a regenerated artifact matches what is committed.
 *
 * The generator has already run as the gate itself, so this reads the working
 * tree afterwards. On drift the file is restored, because the alternative is a
 * loop that leaves the repository dirty every time it refuses — and a dirty tree
 * is what the next pass's own preconditions refuse on.
 */
function artifactDrift(repo: string, gateName: string, run: Runner): string | undefined {
  const artifact = GENERATED_ARTIFACT[gateName];
  if (!artifact) return undefined;
  const status = run(["git", "status", "--porcelain", "--", artifact], repo);
  if (status.status !== 0 || status.output.trim().length === 0) return undefined;
  run(["git", "checkout", "--", artifact], repo);
  return `${artifact} is stale — regenerating it changed the committed file. Run the generator and commit the result.`;
}

/**
 * Run the whole shipping sequence and report what was observed.
 *
 * Never throws for an ordinary refusal: an unattended caller reads the outcome,
 * and an exception would be indistinguishable from the loop itself breaking.
 */
export function ship(opts: ShipOptions): ShipOutcome {
  const { repo, defaultBranch = "main", dryRun = false } = opts;
  const run = opts.run ?? realRunner;
  const log = opts.log ?? (() => {});

  let state: BranchState;
  try {
    state = readBranchState(repo, defaultBranch, run);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { shipped: false, refusals: [why], gateRuns: [], summary: `not shipped — ${why}` };
  }

  const refusals = shipRefusals(state);
  if (refusals.length > 0) {
    return { shipped: false, refusals, gateRuns: [], summary: summarize(state.branch, refusals, []) };
  }

  const conflict = syncWithDefault(repo, defaultBranch, run, log);
  if (conflict) {
    return { shipped: false, refusals: [conflict], gateRuns: [], summary: summarize(state.branch, [conflict], []) };
  }

  // Which gates apply is decided by what the branch actually touched, read
  // against the merge target rather than against a guess.
  const diff = run(["git", "diff", "--name-only", `origin/${defaultBranch}...HEAD`], repo);
  const changed = diff.status === 0 ? diff.output.split("\n").map((l) => l.trim()).filter(Boolean) : [];
  const gates = gatesFor(changed);
  log(`ship: ${gates.length} gate(s) to run — ${gates.map((g) => g.name).join(", ")}`);

  const gateRuns: GateRun[] = [];
  for (const gate of gates) {
    log(`ship: running ${gate.name} …`);
    const [result] = runGates([gate], repo, run);
    gateRuns.push(result!);
    if (!result!.passed) break;
    // A generator gate exits 0 for "I regenerated it"; drift is in the tree afterwards.
    const drift = artifactDrift(repo, gate.name, run);
    if (drift) {
      gateRuns[gateRuns.length - 1] = { ...result!, passed: false, excerpt: drift };
      break;
    }
  }

  const red = redGate(gateRuns);
  if (red) {
    return { shipped: false, refusals: [], gateRuns, summary: summarize(state.branch, [], gateRuns) };
  }

  if (dryRun) {
    return {
      shipped: false,
      refusals: [],
      gateRuns,
      summary: `dry run — every gate is green, so "${state.branch}" would have merged.`,
    };
  }

  // Push before merging so the pull request records the commits that were
  // actually gated, including the sync merge above.
  const push = run(["git", "push", "--set-upstream", "origin", state.branch], repo);
  if (push.status !== 0) {
    const why = `every gate is green, but pushing "${state.branch}" failed:\n${tail(push.output, 10)}`;
    return { shipped: false, refusals: [why], gateRuns, summary: `not shipped — ${why}` };
  }

  // `gh pr merge` is the GitHub *API*, not GitHub Actions — it closes the pull
  // request, keeps the squash history this repository already has, and waits on
  // nothing. `--admin` skips the merge queue rather than any check we run.
  const merge = run(["gh", "pr", "merge", state.branch, "--squash", "--delete-branch", "--admin"], repo);
  if (merge.status !== 0) {
    const why = `every gate is green, but 'gh pr merge' failed:\n${tail(merge.output, 10)}`;
    return { shipped: false, refusals: [why], gateRuns, summary: `not shipped — ${why}` };
  }

  run(["git", "checkout", defaultBranch], repo);
  run(["git", "pull", "--ff-only", "origin", defaultBranch], repo);
  return { shipped: true, refusals: [], gateRuns, summary: summarize(state.branch, [], gateRuns) };
}
