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
import { branchCoverageRefusals } from "./gate-coverage.js";
import { artifactSubject, committedSize, scopeRefusals } from "./gate-scope.js";
import { DECLARED_ARTIFACTS, declaredScope } from "./gate-scope.declared.js";
import { classifySync, parseDivergence, type Divergence } from "./push-first.js";
import {
  allGates,
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

/** How many times the merge is attempted while GitHub's mergeability field settles. */
export const MERGE_ATTEMPTS = 5;
/** Gap between those attempts. Short, because the field settles in about a second. */
export const MERGE_RETRY_MS = 2000;

/**
 * Does this `gh pr merge` failure read as a not-yet-recomputed mergeability
 * field, rather than as a real refusal?
 *
 * Deliberately narrow. A genuine conflict, a closed pull request, a missing one
 * and a permissions error must all fall through to the report on the first
 * attempt — retrying those just spends four more seconds arriving at the same
 * answer, and makes a real conflict look like a flake.
 */
export function isStaleMergeability(output: string): boolean {
  return /has merge conflicts|not mergeable|Base branch was modified|mergeable state|try again/i.test(output);
}

/**
 * Block this thread for `ms`.
 *
 * `Atomics.wait` on a throwaway buffer rather than a spawned `sleep`: the whole
 * module's claim is that no gate reaches an interpreter, and shelling out for a
 * delay would be the one call that does.
 */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

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
  //
  // The counts go through `push-first.ts` rather than through `Number(...)` so
  // that a read which did not complete stays distinguishable from one that
  // reported zero. Both used to land here as `ahead: 0`, and the refusal that
  // followed said "nothing to merge" about a comparison that never ran.
  let counts: Divergence | null = null;
  try {
    counts = parseDivergence(git(repo, ["rev-list", "--left-right", "--count", `origin/${defaultBranch}...HEAD`], run));
  } catch {
    // No remote-tracking ref, no `origin`, or a git that would not run. Left
    // null on purpose — `classifySync` turns that into `"unknown"`.
  }
  const syncState = classifySync(counts);
  return { branch, defaultBranch, dirty, ahead: counts?.ahead ?? 0, syncState };
}

export interface ShipOptions {
  readonly repo: string;
  readonly defaultBranch?: string;
  /** Report what would happen and run the gates, but never merge. */
  readonly dryRun?: boolean;
  readonly run?: Runner;
  /** Where progress goes. Injectable so tests stay silent. */
  readonly log?: (line: string) => void;
  /** Injectable so the retry path is testable without spending real seconds. */
  readonly sleep?: (ms: number) => void;
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
 * Every artefact a generator gate is asked about.
 *
 * The union of what `gates.declared.ts` names and what the gate's declared scope
 * was set against, because a gate may only ever be asked about MORE than either
 * source says. The union is also why widening this is safe for an agent to do:
 * it can add a comparison, never remove one, and removing one is what
 * `gate-coverage.ts` refuses.
 *
 * Only the generator gates have artefacts. `tsc` and `vitest` declare scopes
 * too, and theirs are not sets of committed files — asking this about them would
 * be reading a type-check's coverage off `git status`.
 */
function artifactsFor(gateName: string): string[] {
  const named = GENERATED_ARTIFACT[gateName];
  const declared = DECLARED_ARTIFACTS[gateName];
  if (!named && !declared) return [];
  return [...new Set([...(named ? [named] : []), ...(declared ?? [])])];
}

/**
 * Check that every artifact a generator gate regenerates matches what is
 * committed, and that the gate was asked about all of them.
 *
 * The generator has already run as the gate itself, so this reads the working
 * tree afterwards. On drift the file is restored, because the alternative is a
 * loop that leaves the repository dirty every time it refuses — and a dirty tree
 * is what the next pass's own preconditions refuse on.
 *
 * **Why the scope check comes after the drift check.** A stale artefact is the
 * concrete, actionable answer and it makes the gate red on its own; a subject
 * smaller than the scope only matters for a gate that would otherwise have
 * *passed*, which is what "refuses to pass a smaller one" says. So drift is
 * reported first and the scope refusal catches the green.
 */
function artifactDrift(repo: string, gateName: string, run: Runner): string | undefined {
  const artifacts = artifactsFor(gateName);
  if (artifacts.length === 0) return undefined;

  const stale: string[] = [];
  for (const artifact of artifacts) {
    const status = run(["git", "status", "--porcelain", "--", artifact], repo);
    if (status.status !== 0 || status.output.trim().length === 0) continue;
    run(["git", "checkout", "--", artifact], repo);
    stale.push(artifact);
  }
  if (stale.length > 0) {
    return `${stale.join(", ")} stale — regenerating changed the committed file. Run the generator and commit the result.`;
  }

  const scope = declaredScope(gateName);
  if (!scope) return undefined;
  const subject = artifactSubject(gateName, DECLARED_ARTIFACTS[gateName] ?? [], artifacts, committedSize(repo, run));
  // A subject that could not be read is not a small one. Nothing is refused on
  // a measurement that did not happen — see `artifactSubject`.
  return subject ? scopeRefusals(scope, subject)[0] : undefined;
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
  const sleep = opts.sleep ?? sleepSync;

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

  // Before any gate runs, check that this branch has not changed what the gates
  // COVER. A branch that narrowed a gate and then passed it has proved nothing,
  // and running the narrowed gate first would put that meaningless green in the
  // report ahead of the refusal.
  const coverage = branchCoverageRefusals(repo, defaultBranch, run);
  if (coverage.length > 0) {
    return { shipped: false, refusals: coverage, gateRuns: [], summary: summarize(state.branch, coverage, []) };
  }

  // Which gates apply is decided by what the branch actually touched, read
  // against the merge target rather than against a guess. A diff that will not
  // read is NOT an empty change set — see `allGates`.
  const diff = run(["git", "diff", "--name-only", `origin/${defaultBranch}...HEAD`], repo);
  let gates: ReturnType<typeof gatesFor>;
  if (diff.status === 0) {
    gates = gatesFor(diff.output.split("\n").map((l) => l.trim()).filter(Boolean));
  } else {
    log(
      `ship: could not read what this branch changed (git diff exited ${diff.status ?? "without running"}) — ` +
        "running every gate rather than the ones an empty change set would select.",
    );
    gates = allGates();
  }
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
  // nothing anyone has to run. `--admin` skips the merge queue rather than any
  // check we run.
  //
  // The retry is NOT a check poll, and the distinction is the whole point of
  // this module. GitHub recomputes a pull request's mergeability asynchronously
  // after a push, so for a second or two after the push above it will answer
  // "Pull Request has merge conflicts" about a branch that merges cleanly — seen
  // on #70, which reported conflicts and then read MERGEABLE moments later with
  // nothing changed in between. That is a stale field settling, with every input
  // already in hand; it is bounded and it finishes. A CI run is work that has
  // not started and may never be scheduled. Retrying the first is not the thing
  // this change removed.
  let merge = run(["gh", "pr", "merge", state.branch, "--squash", "--delete-branch", "--admin"], repo);
  for (let attempt = 1; merge.status !== 0 && attempt < MERGE_ATTEMPTS && isStaleMergeability(merge.output); attempt++) {
    log(`ship: GitHub has not finished recomputing mergeability — retrying the merge (${attempt}/${MERGE_ATTEMPTS - 1}).`);
    sleep(MERGE_RETRY_MS);
    merge = run(["gh", "pr", "merge", state.branch, "--squash", "--delete-branch", "--admin"], repo);
  }
  if (merge.status !== 0) {
    const why = `every gate is green, but 'gh pr merge' failed:\n${tail(merge.output, 10)}`;
    return { shipped: false, refusals: [why], gateRuns, summary: `not shipped — ${why}` };
  }

  run(["git", "checkout", defaultBranch], repo);
  run(["git", "pull", "--ff-only", "origin", defaultBranch], repo);
  return { shipped: true, refusals: [], gateRuns, summary: summarize(state.branch, [], gateRuns) };
}
