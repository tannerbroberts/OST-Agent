/**
 * Reconciling a fixed-path workspace: what is at the path, and what setup is
 * allowed to do about it.
 *
 * The candidate this implements is "Setup reconciles the workspace it finds
 * instead of assuming there isn't one" — converge on the state you want rather
 * than assert the state you expect. The failure it answers is this product's
 * own: an unattended firing died at time zero because
 * `git worktree add /tmp/ost-main main` met a directory that was already there
 * (`fatal: '/tmp/ost-main' already exists`), and every command after it ran
 * somewhere that was not a repository at all.
 *
 * ## The whole difficulty is in the word "replace"
 *
 * The node's own statement of where it fails is the design constraint here: *"a
 * worktree can be dirty in ways that are not mechanically distinguishable from
 * work in progress, and a setup that cheerfully replaces those is a setup that
 * can destroy a run that was still going."* So this module is written the other
 * way round from a repair routine. {@link RECONCILE_RULE} is a table of states,
 * each carrying two independent flags — `holdsWork` (inspection cannot prove
 * nothing would be lost) and `replaceable` (setup may destroy what is there) —
 * and the invariant {@link partitionIsSafe} asserts the two never coincide. A
 * state whose work cannot be *proved* absent is refused, not replaced, even
 * when refusing means the run stops. A loud stop costs one firing; a wrong
 * replace costs somebody's uncommitted work and says nothing.
 *
 * That makes the reconciler less powerful than the node's prose implies, and
 * deliberately so. Of the states a fixed path can be found in, exactly three
 * are safe to converge by destroying something (an absent path, an *empty*
 * directory, and a registration whose directory is already gone), one is safe
 * to converge without destroying anything (a clean worktree on the wrong
 * branch, where `checkout` moves nothing that is not still on a ref), one is
 * already right, and the rest are refusals.
 *
 * ## The state that actually broke the run is a refusal
 *
 * `/tmp/ost-main` in the observed trace was, per the scaffold-init census
 * (`test/runner/unconditional-scaffold-init.test.ts`), *the carcass of a pruned
 * worktree*: a checkout still on disk whose administrative directory under
 * `.git/worktrees/` is gone. That is not one of the eight states the assumption
 * beneath this candidate enumerates — it is the mirror image of the one it does
 * name ("a stale registration git still lists but which is gone from disk"), and
 * it is the one the record actually holds. It gets its own state
 * (`orphaned-checkout`) and it is refused, because with the admin directory gone
 * `git status` cannot run there and nothing can say whether the files hold
 * uncommitted work. `git worktree repair` does not resurrect it either: against
 * git 2.50.1 it answers `error: unable to locate repository; .git file does not
 * reference a repository` and leaves the checkout exactly as dead as it found
 * it.
 *
 * ## What this does not settle
 *
 * Nothing here separates a live run from a dead one. A run that is mid-build
 * and a run that died mid-build leave byte-identical directories, so every
 * "safe to reuse" verdict below is safe only under the assumption the candidate
 * makes and does not enforce: that no second run is live at the same time.
 * Distinguishing those needs a liveness signal, which is the sibling leasing
 * candidate's premise. The refusals are unconditionally safe; the reuses and
 * repairs are not, and this comment is where that is written down.
 */
import fs from "node:fs";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";

/**
 * The states a fixed workspace path can be found in.
 *
 * The first eight names cover the eight the assumption enumerates, with one
 * split: "a plain directory that is not a worktree at all" becomes
 * `plain-directory-empty` and `plain-directory-occupied`, because that split is
 * exactly where the safety line falls — an empty directory is a name and
 * nothing else, an occupied one holds bytes no history can give back. The last
 * three are states the record holds that the assumption's list does not.
 */
export type WorkspaceStateId =
  /** Nothing at the path and no registration naming it. */
  | "absent"
  /** A worktree of this repository, clean, already on the branch the run wants. */
  | "worktree-on-expected-branch"
  /** A worktree of this repository, clean, on some other branch. */
  | "worktree-on-other-branch"
  /** A worktree of this repository with modified or untracked files. */
  | "uncommitted-changes"
  /** A worktree of this repository whose HEAD names no branch. */
  | "detached-head"
  /** A worktree of this repository stopped mid-rebase, mid-merge, mid-cherry-pick or mid-bisect. */
  | "operation-in-progress"
  /** A directory that is not a worktree and holds nothing. */
  | "plain-directory-empty"
  /** A directory that is not a worktree and holds something. */
  | "plain-directory-occupied"
  /** `git worktree list` names the path; the path is not on disk. */
  | "stale-registration"
  /** A checkout on disk whose administrative directory under `.git/worktrees/` is gone. */
  | "orphaned-checkout"
  /** A repository or a worktree of some *other* repository sitting at the path. */
  | "foreign-worktree"
  /** The repository's own primary checkout, on a branch other than the expected one. */
  | "primary-checkout-on-other-branch";

/** What setup is allowed to do about a state. */
export type ReconcileVerdict =
  /** Create the worktree; there is nothing at the path. */
  | "create"
  /** Use what is there unchanged. */
  | "reuse"
  /** Move it to the expected branch. Destroys nothing: every commit stays on a ref. */
  | "repair"
  /** Drop the dangling registration, then create. Nothing on disk is touched. */
  | "prune-then-create"
  /** Remove the empty directory so `git worktree add` will take the path, then create. */
  | "clear-then-create"
  /** Do nothing. What is at the path may hold work that inspection cannot account for. */
  | "refuse";

/** One state, its verdict, and the two flags whose disagreement is the safety property. */
export interface WorkspaceStateRule {
  state: WorkspaceStateId;
  verdict: ReconcileVerdict;
  /**
   * True when inspection cannot prove that destroying what is at the path would
   * lose nothing — uncommitted edits, untracked files, an interrupted
   * operation's saved state, commits reachable from no ref, or bytes belonging
   * to something that is not this repository at all.
   */
  holdsWork: boolean;
  /** True when setup may destroy what is at the path. Must never be true where `holdsWork` is. */
  replaceable: boolean;
  /** Why, in the terms of the state rather than of the implementation. */
  why: string;
}

/**
 * The decision table, fixed here rather than derived from what the code
 * happens to do, so that a later edit to the behaviour shows up as a
 * disagreement with this list instead of as a quietly different policy.
 */
export const RECONCILE_RULE = {
  /** The bar the assumption beneath this candidate pre-committed. */
  bar: "every state receives a verdict, and no state holding uncommitted or in-progress work is replaceable",
  states: [
    {
      state: "absent",
      verdict: "create",
      holdsWork: false,
      replaceable: false,
      why: "nothing is at the path, so there is nothing to lose and nothing to reuse",
    },
    {
      state: "worktree-on-expected-branch",
      verdict: "reuse",
      holdsWork: false,
      replaceable: false,
      why: "already the state setup wanted — the second run of the operation is a no-op, which is the whole point of the candidate",
    },
    {
      state: "worktree-on-other-branch",
      verdict: "repair",
      holdsWork: false,
      replaceable: false,
      why: "the tree is clean, so every commit here is still reachable from its branch after the checkout; nothing is destroyed by moving",
    },
    {
      state: "uncommitted-changes",
      verdict: "refuse",
      holdsWork: true,
      replaceable: false,
      why: "modified or untracked files exist nowhere else; this is indistinguishable from a run that is still working",
    },
    {
      state: "detached-head",
      verdict: "refuse",
      holdsWork: true,
      replaceable: false,
      why: "commits here may be reachable from no branch, so a checkout strands them where only the reflog could find them",
    },
    {
      state: "operation-in-progress",
      verdict: "refuse",
      holdsWork: true,
      replaceable: false,
      why: "a stopped rebase, merge, cherry-pick or bisect holds state git itself will not discard without being told to",
    },
    {
      state: "plain-directory-empty",
      verdict: "clear-then-create",
      holdsWork: false,
      replaceable: true,
      why: "an empty directory is a name and nothing else; removing it loses no byte that ever existed",
    },
    {
      state: "plain-directory-occupied",
      verdict: "refuse",
      holdsWork: true,
      replaceable: false,
      why: "files under no version control at all — no history can give them back, and nothing here can say whose they are",
    },
    {
      state: "stale-registration",
      verdict: "prune-then-create",
      holdsWork: false,
      replaceable: true,
      why: "the directory is already gone; pruning drops an administrative entry that points at nothing",
    },
    {
      state: "orphaned-checkout",
      verdict: "refuse",
      holdsWork: true,
      replaceable: false,
      why: "the checkout's administrative directory is gone, so `git status` cannot run here and nothing can prove the files are unmodified",
    },
    {
      state: "foreign-worktree",
      verdict: "refuse",
      holdsWork: true,
      replaceable: false,
      why: "it belongs to another repository; this one's history says nothing about what would be lost",
    },
    {
      state: "primary-checkout-on-other-branch",
      verdict: "refuse",
      holdsWork: true,
      replaceable: false,
      why: "moving the operator's own checkout is a decision this reconciler does not get to make, however clean the tree is",
    },
  ] as const satisfies readonly WorkspaceStateRule[],
} as const;

/** The rule for one state. Total over {@link WorkspaceStateId} by construction. */
export function ruleFor(state: WorkspaceStateId): WorkspaceStateRule {
  const rule = RECONCILE_RULE.states.find((r) => r.state === state);
  if (!rule) throw new Error(`no verdict for workspace state "${state}" — the table is not total`);
  return rule;
}

/** The safety invariant, computed rather than asserted in prose: nothing holding work is replaceable. */
export function partitionIsSafe(): boolean {
  return RECONCILE_RULE.states.every((r) => !(r.holdsWork && r.replaceable));
}

// ── reading the repository's own account of its worktrees ────────────────────

/** One entry of `git worktree list --porcelain`. */
export interface WorktreeRegistration {
  /** The path git reports, verbatim. */
  path: string;
  /** Short branch name, or null when detached or bare. */
  branch: string | null;
  detached: boolean;
  bare: boolean;
  /** git's own reason when it considers the entry prunable, or null. */
  prunable: string | null;
  /** True for the repository's main working tree, which git always lists first. */
  primary: boolean;
}

/**
 * Parse `git worktree list --porcelain`. Pure, because every classification
 * below turns on it and a parser that has to be exercised through a subprocess
 * is a parser nobody tests against the shapes git actually emits.
 */
export function parseWorktreeList(porcelain: string): WorktreeRegistration[] {
  const out: WorktreeRegistration[] = [];
  let current: WorktreeRegistration | null = null;
  for (const raw of porcelain.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("worktree ")) {
      current = {
        path: line.slice("worktree ".length),
        branch: null,
        detached: false,
        bare: false,
        prunable: null,
        primary: out.length === 0,
      };
      out.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("branch ")) current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    else if (line === "detached") current.detached = true;
    else if (line === "bare") current.bare = true;
    else if (line === "prunable") current.prunable = "";
    else if (line.startsWith("prunable ")) current.prunable = line.slice("prunable ".length);
  }
  return out;
}

/** The names git leaves in a worktree's git directory while an operation is stopped. */
const IN_PROGRESS_MARKERS: ReadonlyArray<[file: string, operation: string]> = [
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"],
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
  ["BISECT_LOG", "bisect"],
];

/** Everything about the path that a verdict turns on, gathered once. */
export interface WorkspaceFacts {
  /** The path, resolved as far as it exists. */
  dir: string;
  exists: boolean;
  isDirectory: boolean;
  isEmptyDirectory: boolean;
  /** `git worktree list` in the expected repository names this path. */
  registered: boolean;
  /** This path is that repository's own main working tree. */
  primary: boolean;
  /** A `.git` file or directory sits inside. */
  hasDotGit: boolean;
  /** The `.git` pointer names a directory that is actually there. */
  gitdirResolves: boolean;
  /** The operation git is stopped in the middle of, or null. */
  operationInProgress: string | null;
  /** `git status --porcelain` reported at least one line — modified, staged or untracked. */
  dirty: boolean;
  detached: boolean;
  /** Short branch name of the checkout at the path, or null. */
  branch: string | null;
}

function git(dir: string): SimpleGit {
  return simpleGit(path.resolve(dir));
}

/**
 * `/tmp` and `/private/tmp` are the same directory on macOS, and a string
 * compare says otherwise.
 *
 * Resolving the *deepest existing ancestor* rather than the path itself is what
 * makes the stale-registration case work at all: git records the resolved path
 * it was given, the path is by definition gone by the time the entry is stale,
 * and `realpathSync` on a missing path throws — so a plain try/catch compares
 * git's `/private/var/…` against this process's `/var/…` and concludes the
 * registration names some other directory.
 */
function realish(p: string): string {
  const abs = path.resolve(p);
  const tail: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...tail);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      tail.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

function samePath(a: string, b: string): boolean {
  return realish(a) === realish(b);
}

/** The directory a worktree's `.git` file points at, or null when there is no pointer to follow. */
function gitdirPointer(dir: string): string | null {
  const dotGit = path.join(dir, ".git");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dotGit);
  } catch {
    return null;
  }
  if (stat.isDirectory()) return dotGit;
  const text = fs.readFileSync(dotGit, "utf8").trim();
  const m = /^gitdir:\s*(.+)$/m.exec(text);
  if (!m) return null;
  return path.resolve(dir, m[1].trim());
}

/**
 * Gather the facts a verdict turns on. Every git question is asked of the
 * repository or of the path itself, never of the process's own cwd, so this
 * answers about the workspace under inspection and not about wherever the run
 * happens to be standing — which is the second half of the observed failure.
 */
export async function inspectWorkspace(repoDir: string, dir: string): Promise<WorkspaceFacts> {
  const resolved = path.resolve(dir);

  let registrations: WorktreeRegistration[] = [];
  try {
    registrations = parseWorktreeList(await git(repoDir).raw(["worktree", "list", "--porcelain"]));
  } catch {
    // Not a repository, or git refused. Every registration-dependent fact below
    // then reads false, which is the truthful answer: this repository lists
    // nothing about the path because it cannot list anything at all.
    registrations = [];
  }
  const entry = registrations.find((r) => samePath(r.path, resolved)) ?? null;

  let stat: fs.Stats | null = null;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    stat = null;
  }
  const exists = stat !== null;
  const isDirectory = stat?.isDirectory() ?? false;
  const isEmptyDirectory = isDirectory && fs.readdirSync(resolved).length === 0;

  const facts: WorkspaceFacts = {
    dir: resolved,
    exists,
    isDirectory,
    isEmptyDirectory,
    registered: entry !== null,
    primary: entry?.primary ?? false,
    hasDotGit: isDirectory && fs.existsSync(path.join(resolved, ".git")),
    gitdirResolves: false,
    operationInProgress: null,
    dirty: false,
    detached: entry?.detached ?? false,
    branch: entry?.branch ?? null,
  };
  if (!facts.hasDotGit) return facts;

  const gitdir = gitdirPointer(resolved);
  facts.gitdirResolves = gitdir !== null && fs.existsSync(gitdir);
  if (!facts.gitdirResolves) return facts;

  for (const [file, operation] of IN_PROGRESS_MARKERS) {
    if (fs.existsSync(path.join(gitdir!, file))) {
      facts.operationInProgress = operation;
      break;
    }
  }

  try {
    facts.dirty = (await git(resolved).raw(["status", "--porcelain"])).trim().length > 0;
  } catch {
    // A checkout git will not answer about is one nothing can call clean.
    facts.dirty = true;
  }
  if (!facts.registered) return facts;

  try {
    const head = (await git(resolved).raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    facts.detached = head === "HEAD";
    facts.branch = facts.detached ? null : head;
  } catch {
    /* keep what the registration said */
  }
  return facts;
}

/**
 * The state the facts name, most specific first.
 *
 * Order is the policy. An in-progress operation is read before dirtiness
 * because a stopped rebase always leaves a dirty tree and the operation is the
 * more specific fact; dirtiness is read before detachment for the same reason,
 * and both are refusals, so nothing turns on which name a state that is both
 * gets. A registration is read before anything on disk only when the disk is
 * empty — the two disagreeing in the other direction is the orphan case.
 */
export function classifyWorkspace(facts: WorkspaceFacts, expectedBranch: string): WorkspaceStateId {
  if (!facts.exists) return facts.registered ? "stale-registration" : "absent";
  if (!facts.isDirectory) return "plain-directory-occupied";
  if (!facts.hasDotGit) return facts.isEmptyDirectory ? "plain-directory-empty" : "plain-directory-occupied";
  if (!facts.gitdirResolves) return "orphaned-checkout";
  if (!facts.registered) return "foreign-worktree";
  if (facts.operationInProgress) return "operation-in-progress";
  if (facts.dirty) return "uncommitted-changes";
  if (facts.detached) return "detached-head";
  if (facts.branch === expectedBranch) return "worktree-on-expected-branch";
  return facts.primary ? "primary-checkout-on-other-branch" : "worktree-on-other-branch";
}

// ── converging on the state setup wanted ─────────────────────────────────────

export interface ReconcileRequest {
  /** The repository whose worktree list is authoritative and whose history the branch comes from. */
  repoDir: string;
  /** The fixed path setup wants a workspace at. */
  dir: string;
  /** The branch the run wants checked out there. */
  branch: string;
}

export interface ReconcileOutcome {
  dir: string;
  state: WorkspaceStateId;
  verdict: ReconcileVerdict;
  /** Whether setup was permitted to destroy what was at the path. */
  replaceable: boolean;
  why: string;
  /** True when this call changed something. False for `reuse`, every refusal, and every report-only call. */
  applied: boolean;
  /** True when the path now holds a usable worktree of `repoDir` on `branch`. */
  ready: boolean;
  /** What git said when an applied action failed, or undefined. */
  error?: string;
}

async function addWorktree(repoDir: string, dir: string, branch: string): Promise<void> {
  const g = git(repoDir);
  const branches = await g.branchLocal();
  const args = branches.all.includes(branch)
    ? ["worktree", "add", dir, branch]
    : ["worktree", "add", "-b", branch, dir];
  await g.raw(args);
}

/**
 * Look at what is at `dir`, decide, and — when `apply` is set and the verdict
 * permits it — converge.
 *
 * Report-only by default. The one destructive action any verdict authorises is
 * `fs.rmdirSync` on a directory classified empty, and `rmdirSync` is chosen over
 * a recursive remove precisely because it fails rather than proceeds if the
 * classification was wrong — the check and the act see the same directory a
 * moment apart, and the second one is the one that must not be talked into
 * anything.
 */
export async function reconcileWorkspace(req: ReconcileRequest, opts: { apply?: boolean } = {}): Promise<ReconcileOutcome> {
  const facts = await inspectWorkspace(req.repoDir, req.dir);
  const state = classifyWorkspace(facts, req.branch);
  const rule = ruleFor(state);
  const base: ReconcileOutcome = {
    dir: facts.dir,
    state,
    verdict: rule.verdict,
    replaceable: rule.replaceable,
    why: rule.why,
    applied: false,
    ready: state === "worktree-on-expected-branch",
  };
  if (opts.apply !== true || rule.verdict === "refuse" || rule.verdict === "reuse") return base;

  try {
    switch (rule.verdict) {
      case "create":
        await addWorktree(req.repoDir, facts.dir, req.branch);
        break;
      case "prune-then-create":
        await git(req.repoDir).raw(["worktree", "prune"]);
        await addWorktree(req.repoDir, facts.dir, req.branch);
        break;
      case "clear-then-create":
        fs.rmdirSync(facts.dir);
        await addWorktree(req.repoDir, facts.dir, req.branch);
        break;
      case "repair":
        await git(facts.dir).raw(["checkout", req.branch]);
        break;
    }
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
  return { ...base, applied: true, ready: true };
}

/** One line per fact a caller needs to act, with the verdict said in words rather than inferred from an exit code. */
export function formatReconcileOutcome(outcome: ReconcileOutcome): string {
  const lines = [
    `workspace: ${outcome.dir}`,
    `state: ${outcome.state}`,
    `verdict: ${outcome.verdict}${outcome.applied ? " (applied)" : ""} — ${outcome.why}`,
    `ready: ${outcome.ready ? "yes" : "no"}`,
  ];
  if (outcome.error) lines.push(`git refused: ${outcome.error.split("\n")[0]}`);
  if (outcome.verdict === "refuse") {
    lines.push(
      "nothing was touched. This state cannot be cleared without risking work no history holds — " +
        "move it aside by hand, or give this run a workspace of its own (`ost-agent workspace --run-id …`).",
    );
  }
  return lines.join("\n");
}
