/**
 * The reconciler's verdict on every dirty state a fixed workspace path can be
 * found in — the assumption test beneath "Setup reconciles the workspace it
 * finds instead of assuming there isn't one".
 *
 * **The bar, pre-committed by the node and restated here before anything is
 * built:** every one of the eight enumerated worktree states receives a verdict,
 * and no state holding uncommitted or in-progress work is classed replaceable.
 * A single misclassification of that second kind refutes the assumption and
 * reconciliation loses to the sibling leasing candidate.
 *
 * ## The partition is written here, not read off the implementation
 *
 * {@link EXPECTED} is this file's own copy of the answer, typed out from the
 * assumption's prose rather than imported from `src/`. `RECONCILE_RULE` is then
 * checked *against* it. That is the difference between a test and a mirror: if
 * someone edits the module's table so the code agrees with itself, this file
 * disagrees with both, which is the only arrangement in which the exit code
 * means anything. Every state is then built for real — a real repository, real
 * `git worktree add`, a real interrupted rebase — and the verdict is read off
 * the reconciler looking at the actual directory.
 *
 * ## Two states in the record that the node's eight do not name
 *
 * The eight are: absent, valid on the expected branch, valid on another branch,
 * uncommitted changes, detached HEAD, interrupted rebase or merge, a plain
 * directory that is not a worktree, and a stale registration git lists but which
 * is gone from disk. Building them turned up two more that this repository's own
 * record holds:
 *
 *  - **`orphaned-checkout`** — a checkout still on disk whose administrative
 *    directory under `.git/worktrees/` is gone. This is the *mirror* of the
 *    stale registration, and per `test/runner/unconditional-scaffold-init.test.ts`
 *    it is what `/tmp/ost-main` actually was when the observed firing died on it.
 *    The state the failure came from is not in the list the failure produced.
 *  - **`primary-checkout-on-other-branch`** — the path resolving to the
 *    operator's own working directory. Clean, valid, on the wrong branch, and
 *    the one such worktree that must not be silently moved.
 *
 *  and one split that the safety line runs straight through: "a plain directory"
 *  is two states, because an empty one is a name and an occupied one is bytes no
 *  history can return.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { simpleGit } from "simple-git";
import {
  classifyWorkspace,
  formatReconcileOutcome,
  inspectWorkspace,
  parseWorktreeList,
  partitionIsSafe,
  reconcileWorkspace,
  ruleFor,
  RECONCILE_RULE,
  type ReconcileVerdict,
  type WorkspaceStateId,
} from "../../src/runner/workspace-reconcile.js";
import { prepareWorkspace } from "../../src/runner/workspace.js";

// ── the partition, typed out before any fixture is built ─────────────────────

/**
 * The answer this test holds independently of the module: for each state, the
 * verdict setup is allowed to reach, whether the state holds work inspection
 * cannot account for, and whether setup may destroy what is there.
 */
const EXPECTED: Record<WorkspaceStateId, { verdict: ReconcileVerdict; holdsWork: boolean; replaceable: boolean }> = {
  absent: { verdict: "create", holdsWork: false, replaceable: false },
  "worktree-on-expected-branch": { verdict: "reuse", holdsWork: false, replaceable: false },
  "worktree-on-other-branch": { verdict: "repair", holdsWork: false, replaceable: false },
  "uncommitted-changes": { verdict: "refuse", holdsWork: true, replaceable: false },
  "detached-head": { verdict: "refuse", holdsWork: true, replaceable: false },
  "operation-in-progress": { verdict: "refuse", holdsWork: true, replaceable: false },
  "plain-directory-empty": { verdict: "clear-then-create", holdsWork: false, replaceable: true },
  "plain-directory-occupied": { verdict: "refuse", holdsWork: true, replaceable: false },
  "stale-registration": { verdict: "prune-then-create", holdsWork: false, replaceable: true },
  "orphaned-checkout": { verdict: "refuse", holdsWork: true, replaceable: false },
  "foreign-worktree": { verdict: "refuse", holdsWork: true, replaceable: false },
  "primary-checkout-on-other-branch": { verdict: "refuse", holdsWork: true, replaceable: false },
};

/** The node's eight, in its own words, mapped onto the state names used here. */
const THE_EIGHT: Array<[enumeratedByTheNode: string, state: WorkspaceStateId]> = [
  ["absent", "absent"],
  ["valid worktree on the expected branch", "worktree-on-expected-branch"],
  ["valid worktree on a different branch", "worktree-on-other-branch"],
  ["worktree with uncommitted changes", "uncommitted-changes"],
  ["detached HEAD", "detached-head"],
  ["interrupted rebase or merge", "operation-in-progress"],
  ["a plain directory that is not a worktree at all", "plain-directory-occupied"],
  ["a stale registration git still lists but which is gone from disk", "stale-registration"],
];

describe("the decision table, before a single directory is built", () => {
  test("THE SAFETY HALF OF THE BAR: nothing holding work is replaceable", () => {
    // The clause the assumption says decides whether this candidate is safe to
    // build at all. Asserted twice on purpose — over the module's own table, and
    // over this file's independent copy of it.
    expect(partitionIsSafe()).toBe(true);
    for (const [state, e] of Object.entries(EXPECTED)) {
      expect(e.holdsWork && e.replaceable, `${state} would be destroyed despite holding work`).toBe(false);
    }
  });

  test("the module's table is the partition this file states, entry for entry", () => {
    const fromModule = Object.fromEntries(
      RECONCILE_RULE.states.map((r) => [r.state, { verdict: r.verdict, holdsWork: r.holdsWork, replaceable: r.replaceable }]),
    );
    expect(fromModule).toEqual(EXPECTED);
  });

  test("THE COVERAGE HALF OF THE BAR: each of the node's eight states has a verdict", () => {
    for (const [enumerated, state] of THE_EIGHT) {
      expect(ruleFor(state).verdict, `no verdict for "${enumerated}"`).toBeTruthy();
    }
    expect(THE_EIGHT).toHaveLength(8);
  });

  test("only three states authorise destroying anything, and none of them can lose a byte", () => {
    // Stated as a number because "repair or replace it" reads as though replacing
    // is the common case. It is not: two of these three have nothing at the path
    // at all, and the third is an empty directory.
    const replaceable = RECONCILE_RULE.states.filter((r) => r.replaceable).map((r) => r.state);
    expect(replaceable).toEqual(["plain-directory-empty", "stale-registration"]);
    expect(ruleFor("absent").verdict).toBe("create");
  });

  test("every verdict names a state that exists, and the table is total over the ids", () => {
    expect(RECONCILE_RULE.states.map((r) => r.state).sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(new Set(RECONCILE_RULE.states.map((r) => r.state)).size).toBe(RECONCILE_RULE.states.length);
  });
});

// ── real repositories, real worktrees ────────────────────────────────────────

const roots: string[] = [];

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

/** A repository on `main` with one commit and a spare `wanted` branch nothing has checked out. */
async function newRepo(): Promise<{ root: string; repo: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ost-reconcile-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "ost-agent@localhost");
  await g.addConfig("user.name", "OST-Agent");
  // `git init`'s default branch depends on the machine's config; every assertion
  // below names a branch, so it is pinned rather than read.
  await g.raw(["symbolic-ref", "HEAD", "refs/heads/main"]);
  fs.writeFileSync(path.join(repo, "f.txt"), "base\n");
  await g.add(["-A"]);
  await g.commit("base");
  await g.raw(["branch", "wanted"]);
  return { root, repo };
}

/** `<root>/wt`, which does not exist yet — `git worktree add` refuses a path that does. */
function wtPath(root: string): string {
  return path.join(root, "wt");
}

/** Every file under `dir` and its bytes, so "nothing was touched" can be asserted rather than assumed. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, prefix: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        out[`${rel}/`] = "";
        walk(full, rel);
      } else if (e.isSymbolicLink()) out[rel] = `-> ${fs.readlinkSync(full)}`;
      else out[rel] = fs.readFileSync(full, "utf8");
    }
  };
  if (fs.existsSync(dir)) walk(dir, "");
  return out;
}

async function branchAt(dir: string): Promise<string> {
  return (await simpleGit(dir).raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
}

describe("each state, built for real, gets the verdict the table fixed", () => {
  test("absent — nothing at the path, nothing registered: create it", async () => {
    const { root, repo } = await newRepo();
    const dir = wtPath(root);

    const seen = await reconcileWorkspace({ repoDir: repo, dir, branch: "wanted" });
    expect(seen.state).toBe("absent");
    expect(seen.verdict).toBe("create");
    expect(seen.ready).toBe(false);

    const done = await reconcileWorkspace({ repoDir: repo, dir, branch: "wanted" }, { apply: true });
    expect(done.applied).toBe(true);
    expect(done.ready).toBe(true);
    expect(await branchAt(dir)).toBe("wanted");
  });

  test("valid worktree on the expected branch — reuse, and the second run is a no-op", async () => {
    const { root, repo } = await newRepo();
    const dir = wtPath(root);
    await simpleGit(repo).raw(["worktree", "add", dir, "wanted"]);
    const before = snapshot(dir);

    const outcome = await reconcileWorkspace({ repoDir: repo, dir, branch: "wanted" }, { apply: true });
    expect(outcome.state).toBe("worktree-on-expected-branch");
    expect(outcome.verdict).toBe("reuse");
    expect(outcome.ready).toBe(true);
    // Idempotency is the whole approach the node named: this is what "the
    // operation's second run is a no-op instead of an error" has to mean.
    expect(outcome.applied).toBe(false);
    expect(snapshot(dir)).toEqual(before);
  });

  test("valid worktree on a different branch — repair by checkout, destroying nothing", async () => {
    const { root, repo } = await newRepo();
    const dir = wtPath(root);
    await simpleGit(repo).raw(["worktree", "add", "-b", "elsewhere", dir]);
    fs.writeFileSync(path.join(dir, "g.txt"), "committed on elsewhere\n");
    await simpleGit(dir).add(["-A"]);
    await simpleGit(dir).commit("work on elsewhere");
    const elsewhereHead = (await simpleGit(dir).revparse(["HEAD"])).trim();

    const outcome = await reconcileWorkspace({ repoDir: repo, dir, branch: "wanted" }, { apply: true });
    expect(outcome.state).toBe("worktree-on-other-branch");
    expect(outcome.verdict).toBe("repair");
    expect(outcome.applied).toBe(true);
    expect(await branchAt(dir)).toBe("wanted");

    // The claim behind calling `repair` non-destructive: the commits that were
    // here are still reachable from the branch they were on.
    expect((await simpleGit(repo).revparse(["elsewhere"])).trim()).toBe(elsewhereHead);
  });

  test("uncommitted changes — refuse, whether the file is modified or merely untracked", async () => {
    for (const kind of ["modified", "untracked"] as const) {
      const { root, repo } = await newRepo();
      const dir = wtPath(root);
      await simpleGit(repo).raw(["worktree", "add", dir, "wanted"]);
      if (kind === "modified") fs.writeFileSync(path.join(dir, "f.txt"), "half-finished edit\n");
      else fs.writeFileSync(path.join(dir, "scratch.md"), "notes nobody committed\n");
      const before = snapshot(dir);

      const outcome = await reconcileWorkspace({ repoDir: repo, dir, branch: "wanted" }, { apply: true });
      expect(outcome.state, kind).toBe("uncommitted-changes");
      expect(outcome.verdict, kind).toBe("refuse");
      expect(outcome.replaceable, kind).toBe(false);
      expect(outcome.applied, kind).toBe(false);
      expect(snapshot(dir), kind).toEqual(before);
    }
  });

  test("detached HEAD — refuse, because a commit here may be reachable from no branch", async () => {
    const { root, repo } = await newRepo();
    const dir = wtPath(root);
    await simpleGit(repo).raw(["worktree", "add", dir, "wanted"]);
    await simpleGit(dir).raw(["checkout", "--detach", "HEAD"]);
    fs.writeFileSync(path.join(dir, "h.txt"), "committed onto nothing\n");
    await simpleGit(dir).add(["-A"]);
    await simpleGit(dir).commit("detached work");
    const stranded = (await simpleGit(dir).revparse(["HEAD"])).trim();
    const before = snapshot(dir);

    const outcome = await reconcileWorkspace({ repoDir: repo, dir, branch: "wanted" }, { apply: true });
    expect(outcome.state).toBe("detached-head");
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.applied).toBe(false);
    expect(snapshot(dir)).toEqual(before);
    // Still where it was: nothing here moved HEAD off the commit no ref names.
    expect((await simpleGit(dir).revparse(["HEAD"])).trim()).toBe(stranded);
  });

  test("interrupted rebase — refuse, and the operation is read before the dirtiness it causes", async () => {
    const { root, repo } = await newRepo();
    const dir = wtPath(root);
    await simpleGit(repo).raw(["worktree", "add", "-b", "topic", dir]);
    fs.writeFileSync(path.join(dir, "f.txt"), "topic side\n");
    await simpleGit(dir).add(["-A"]);
    await simpleGit(dir).commit("topic edit");
    fs.writeFileSync(path.join(repo, "f.txt"), "main side\n");
    await simpleGit(repo).add(["-A"]);
    await simpleGit(repo).commit("main edit");

    // A genuine stopped rebase, not a marker file written by hand.
    await expect(simpleGit(dir).raw(["rebase", "main"])).rejects.toThrow();
    const before = snapshot(dir);

    const facts = await inspectWorkspace(repo, dir);
    expect(facts.operationInProgress).toBe("rebase");
    expect(facts.dirty).toBe(true);
    // Both are true; the more specific one is the state, which is what the
    // ordering in `classifyWorkspace` exists to guarantee.
    expect(classifyWorkspace(facts, "wanted")).toBe("operation-in-progress");

    const outcome = await reconcileWorkspace({ repoDir: repo, dir, branch: "wanted" }, { apply: true });
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.applied).toBe(false);
    expect(snapshot(dir)).toEqual(before);
  });

  test("a plain empty directory — the one occupied path that may be cleared", async () => {
    const { root, repo } = await newRepo();
    const dir = wtPath(root);
    fs.mkdirSync(dir);

    const outcome = await reconcileWorkspace({ repoDir: repo, dir, branch: "wanted" }, { apply: true });
    expect(outcome.state).toBe("plain-directory-empty");
    expect(outcome.verdict).toBe("clear-then-create");
    expect(outcome.replaceable).toBe(true);
    expect(outcome.ready).toBe(true);
    expect(await branchAt(dir)).toBe("wanted");
  });

  test("a plain directory with something in it — refuse; no history can give those bytes back", async () => {
    const { root, repo } = await newRepo();
    const dir = wtPath(root);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "someone-elses.txt"), "not in any repository\n");
    const before = snapshot(dir);

    const outcome = await reconcileWorkspace({ repoDir: repo, dir, branch: "wanted" }, { apply: true });
    expect(outcome.state).toBe("plain-directory-occupied");
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.replaceable).toBe(false);
    expect(snapshot(dir)).toEqual(before);
  });

  test("a stale registration — prune the entry that points at nothing, then create", async () => {
    const { root, repo } = await newRepo();
    const dir = wtPath(root);
    await simpleGit(repo).raw(["worktree", "add", dir, "wanted"]);
    fs.rmSync(dir, { recursive: true, force: true });

    const seen = await reconcileWorkspace({ repoDir: repo, dir, branch: "wanted" });
    expect(seen.state).toBe("stale-registration");
    expect(seen.verdict).toBe("prune-then-create");

    const done = await reconcileWorkspace({ repoDir: repo, dir, branch: "wanted" }, { apply: true });
    expect(done.applied).toBe(true);
    expect(done.ready).toBe(true);
    expect(await branchAt(dir)).toBe("wanted");
  });

  test("an orphaned checkout — the state the observed failure was actually in — is refused", async () => {
    const { root, repo } = await newRepo();
    const dir = wtPath(root);
    await simpleGit(repo).raw(["worktree", "add", dir, "wanted"]);
    // The carcass: the checkout stays, its administrative directory goes. This is
    // what `/tmp/ost-main` was, and it is the mirror of the stale registration
    // the node's eight do name.
    fs.rmSync(path.join(repo, ".git", "worktrees", "wt"), { recursive: true, force: true });
    fs.writeFileSync(path.join(dir, "maybe-precious.txt"), "was this committed? nothing here can say\n");
    const before = snapshot(dir);

    const facts = await inspectWorkspace(repo, dir);
    expect(facts.hasDotGit).toBe(true);
    expect(facts.gitdirResolves).toBe(false);

    const outcome = await reconcileWorkspace({ repoDir: repo, dir, branch: "wanted" }, { apply: true });
    expect(outcome.state).toBe("orphaned-checkout");
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.applied).toBe(false);
    expect(snapshot(dir)).toEqual(before);
    // And it says so in words, with somewhere for the caller to go. A refusal
    // that only sets an exit code repeats the failure this candidate answers.
    expect(formatReconcileOutcome(outcome)).toContain("nothing was touched");
    expect(formatReconcileOutcome(outcome)).toContain("workspace of its own");
  });

  test("another repository's checkout at the path — refuse; this history says nothing about it", async () => {
    const { root, repo } = await newRepo();
    const dir = wtPath(root);
    fs.mkdirSync(dir);
    const other = simpleGit(dir);
    await other.init();
    await other.addConfig("user.email", "someone@else");
    await other.addConfig("user.name", "Someone Else");
    fs.writeFileSync(path.join(dir, "theirs.txt"), "another project entirely\n");
    await other.add(["-A"]);
    await other.commit("theirs");
    const before = snapshot(dir);

    const outcome = await reconcileWorkspace({ repoDir: repo, dir, branch: "wanted" }, { apply: true });
    expect(outcome.state).toBe("foreign-worktree");
    expect(outcome.verdict).toBe("refuse");
    expect(snapshot(dir)).toEqual(before);
  });

  test("the operator's own checkout, on the wrong branch — clean, valid, and still not ours to move", async () => {
    const { repo } = await newRepo();
    const before = await branchAt(repo);

    const outcome = await reconcileWorkspace({ repoDir: repo, dir: repo, branch: "wanted" }, { apply: true });
    expect(outcome.state).toBe("primary-checkout-on-other-branch");
    expect(outcome.verdict).toBe("refuse");
    expect(outcome.applied).toBe(false);
    // The branch-drift mechanism this repository has already been bitten by: a
    // setup that "repaired" the shared checkout would leave every later firing
    // running from whatever branch it chose.
    expect(await branchAt(repo)).toBe(before);
    expect(before).toBe("main");
  });

  test("the primary checkout already on the expected branch is reuse, not refusal", async () => {
    // The other half of the state above — the reconciler must not refuse the
    // ordinary case just because the path is the main working tree.
    const { repo } = await newRepo();
    const outcome = await reconcileWorkspace({ repoDir: repo, dir: repo, branch: "main" });
    expect(outcome.state).toBe("worktree-on-expected-branch");
    expect(outcome.ready).toBe(true);
  });
});

describe("the failure the candidate exists to answer, end to end", () => {
  test("the exact observed sequence — add over an occupied path — no longer ends in `fatal:`", async () => {
    const { root, repo } = await newRepo();
    const dir = wtPath(root);
    await simpleGit(repo).raw(["worktree", "add", dir, "wanted"]);

    // What setup did before: assert absence, and die when the last run left this behind.
    await expect(simpleGit(repo).raw(["worktree", "add", dir, "wanted"])).rejects.toThrow(/already exists/);

    // What it does now.
    const outcome = await reconcileWorkspace({ repoDir: repo, dir, branch: "wanted" }, { apply: true });
    expect(outcome.verdict).toBe("reuse");
    expect(outcome.ready).toBe(true);
  });

  test("reconcile is idempotent across a firing that ends without tearing down", async () => {
    const { root, repo } = await newRepo();
    const dir = wtPath(root);
    const first = await reconcileWorkspace({ repoDir: repo, dir, branch: "wanted" }, { apply: true });
    const second = await reconcileWorkspace({ repoDir: repo, dir, branch: "wanted" }, { apply: true });
    const third = await reconcileWorkspace({ repoDir: repo, dir, branch: "wanted" }, { apply: true });
    expect([first.ready, second.ready, third.ready]).toEqual([true, true, true]);
    expect([first.state, second.state, third.state]).toEqual([
      "absent",
      "worktree-on-expected-branch",
      "worktree-on-expected-branch",
    ]);
  });
});

// ── the porcelain parser, against the shapes git emits ───────────────────────

describe("reading `git worktree list --porcelain`", () => {
  test("branch, detached, bare and prunable entries are each read for what they are", () => {
    const entries = parseWorktreeList(
      [
        "worktree /h/repo",
        "HEAD 1111111111111111111111111111111111111111",
        "branch refs/heads/main",
        "",
        "worktree /tmp/ost-main",
        "HEAD 2222222222222222222222222222222222222222",
        "detached",
        "",
        "worktree /tmp/gone",
        "HEAD 3333333333333333333333333333333333333333",
        "branch refs/heads/wanted",
        "prunable gitdir file points to non-existent location",
        "",
      ].join("\n"),
    );
    expect(entries.map((e) => e.path)).toEqual(["/h/repo", "/tmp/ost-main", "/tmp/gone"]);
    expect(entries[0]).toMatchObject({ branch: "main", primary: true, detached: false });
    expect(entries[1]).toMatchObject({ branch: null, detached: true, primary: false });
    expect(entries[2].prunable).toContain("non-existent location");
  });

  test("a bare main worktree is recognised rather than read as a branchless checkout", () => {
    const entries = parseWorktreeList(["worktree /h/bare", "bare", ""].join("\n"));
    expect(entries[0]).toMatchObject({ bare: true, branch: null, primary: true });
  });
});

// ── the other half of the observed failure: the node_modules link ────────────

describe("`ln: node_modules: File exists`, which is the same assumption about absence", () => {
  test("a link already pointing at the right place is success, not an error", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ost-reconcile-link-"));
    roots.push(root);
    const shared = path.join(root, "shared");
    fs.mkdirSync(path.join(shared, "node_modules"), { recursive: true });

    const first = prepareWorkspace("run-a", shared, root);
    const second = prepareWorkspace("run-a", shared, root);
    expect(first.linked).toBe(true);
    expect(second.linked).toBe(false);
    expect(second.relinked).toBe(false);
    expect(fs.readlinkSync(path.join(second.dir, "node_modules"))).toBe(path.join(shared, "node_modules"));
  });

  test("a link left dangling by a shared tree that went away is repointed, not `EEXIST`", () => {
    // The defect this found, and the reason it is not hypothetical:
    // `fs.existsSync` follows the link, so a dangling `node_modules` reads as
    // *absent* and the `symlinkSync` that follows throws `EEXIST` — the observed
    // `ln: /tmp/ost-main/node_modules: File exists`, still reachable after
    // per-run workspaces landed. The throw is asserted below rather than
    // described, so this test fails if the shape ever stops being real.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ost-reconcile-link-"));
    roots.push(root);
    const shared = path.join(root, "shared");
    const gone = path.join(root, "gone");
    fs.mkdirSync(path.join(shared, "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(gone, "node_modules"), { recursive: true });

    const dir = prepareWorkspace("run-b", gone, root).dir;
    fs.rmSync(gone, { recursive: true, force: true });
    const link = path.join(dir, "node_modules");
    expect(fs.existsSync(link)).toBe(false); // and yet:
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(() => fs.symlinkSync(path.join(shared, "node_modules"), link, "dir")).toThrow(/EEXIST/);

    const after = prepareWorkspace("run-b", shared, root);
    expect(after.relinked).toBe(true);
    expect(fs.existsSync(link)).toBe(true);
    expect(fs.readlinkSync(link)).toBe(path.join(shared, "node_modules"));
  });

  test("a dangling link with no shared tree to point at says so rather than throwing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ost-reconcile-link-"));
    roots.push(root);
    const shared = path.join(root, "shared");
    fs.mkdirSync(path.join(shared, "node_modules"), { recursive: true });

    prepareWorkspace("run-e", shared, root);
    fs.rmSync(path.join(shared, "node_modules"), { recursive: true, force: true });
    const result = prepareWorkspace("run-e", shared, root);
    expect(result.missingShared).toBe(true);
    expect(result.relinked).toBe(false);
  });

  test("a link pointing at the wrong shared tree is repointed at the right one", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ost-reconcile-link-"));
    roots.push(root);
    const shared = path.join(root, "shared");
    const other = path.join(root, "other");
    fs.mkdirSync(path.join(shared, "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(other, "node_modules"), { recursive: true });

    const dir = prepareWorkspace("run-c", other, root).dir;
    const after = prepareWorkspace("run-c", shared, root);
    expect(after.relinked).toBe(true);
    expect(fs.readlinkSync(path.join(dir, "node_modules"))).toBe(path.join(shared, "node_modules"));
  });

  test("a real installed `node_modules` directory is left exactly where it is", () => {
    // Repointing is safe only because it is only ever done to a symlink. A real
    // install at the same path holds bytes, and this function does not delete
    // bytes.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ost-reconcile-link-"));
    roots.push(root);
    const shared = path.join(root, "shared");
    fs.mkdirSync(path.join(shared, "node_modules"), { recursive: true });
    const dir = path.join(root, "ost-run-d");
    fs.mkdirSync(path.join(dir, "node_modules", "left-pad"), { recursive: true });

    const result = prepareWorkspace("run-d", shared, root);
    expect(result.linked).toBe(false);
    expect(result.relinked).toBe(false);
    expect(fs.existsSync(path.join(dir, "node_modules", "left-pad"))).toBe(true);
    expect(fs.lstatSync(path.join(dir, "node_modules")).isSymbolicLink()).toBe(false);
  });
});
