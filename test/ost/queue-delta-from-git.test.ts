/**
 * The instrument for "A pass's queue contents can be recovered from what the
 * vault already keeps" — the feasibility half of "Each queue reports its delta".
 *
 * A delta needs a previous state. This asks whether that previous state has to
 * be stored, or whether it can be recomputed: every mutation auto-commits, so
 * the vault at any past commit is fully determined, and `next_work`'s output at
 * that commit should be recoverable by checking it out and running the same
 * computation git already ran forward.
 *
 * **The test.** Run one simulated pass over a fresh vault — some solutions
 * present before it that a queue (`solutionsMissingAssumptions`) already
 * flagged, one of them fixed during the pass (an assumption test attached),
 * one new bare solution created during the pass, one left untouched. Commit
 * before and after. Recompute the queue at both commits from git alone — a
 * disposable worktree, never the vault this test wrote to directly — diff them,
 * and assert the recomputed entered/left sets match exactly what the pass did.
 *
 * **Non-vacuity.** The "unchanged" solution is asserted present on both
 * recomputed queues, not just absent from entered/left — a diff that always
 * reported everything as entered (never actually reading the "before" commit)
 * would still pass an entered/left-only assertion.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { Vault } from "../../src/ost/vault.js";

const MIN = 3; // minSolutionsPerOpportunity — irrelevant to solutionsMissingAssumptions, held fixed

/**
 * Materialize `repoDir` as it stood at `sha` into a throwaway `git worktree`,
 * hand a `Vault` over it to `fn`, and remove the worktree afterward whether
 * `fn` throws or not. Never touches `repoDir`'s own checkout or `HEAD` — this
 * IS the feasibility this instrument exists to pin, so it lives beside the one
 * thing that calls it rather than in `src/`: nothing in the product reaches
 * into a past commit yet, and a module only this test calls would fail
 * `test/release/module-reachability.test.ts` the moment it shipped there.
 */
async function vaultAtCommit<T>(repoDir: string, sha: string, fn: (vault: Vault, dir: string) => T): Promise<T> {
  const abs = path.resolve(repoDir);
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-at-commit-"));
  fs.rmdirSync(worktreeDir); // `git worktree add` refuses a target that already exists
  await simpleGit(abs).raw(["worktree", "add", "--detach", worktreeDir, sha]);
  try {
    return fn(new Vault(worktreeDir), worktreeDir);
  } finally {
    fs.rmSync(worktreeDir, { recursive: true, force: true });
  }
}

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-queue-delta-"));
  await initVault(dir, "Reach 10,000 daily active users", "Retention");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function opportunity(vault: Vault, title: string, parent: string): void {
  vault.createNode({ title, layer: "Opportunity", evidence: "observed", source: "INBOX:n.md", body: "b", tags: [], links: [] });
  vault.linkNodes(parent, title);
}

function solution(vault: Vault, title: string, parent: string): void {
  vault.createNode({ title, layer: "Solution", evidence: "assertion", body: "b", tags: [], links: [] });
  vault.linkNodes(parent, title);
}

function assumptionTest(vault: Vault, title: string, parent: string): void {
  vault.createNode({ title, layer: "AssumptionTest", evidence: "assertion", body: "b", tags: [], links: [] });
  vault.linkNodes(parent, title);
}

async function commitAll(message: string): Promise<string> {
  const g = simpleGit(dir);
  await g.add(["-A"]);
  await g.commit(message);
  return (await g.revparse(["HEAD"])).trim();
}

/** The queue this test recomputes: solutions with no AssumptionTest beneath them. */
function missingAssumptions(vault: Vault, atDir: string): string[] {
  return computeNextWork(vault, atDir, MIN).solutionsMissingAssumptions.map((s) => s.title).sort();
}

describe("a past pass's queue, recomputed from git rather than stored", () => {
  test("recomputed entered/left/unchanged match what the pass actually did", async () => {
    const vault = new Vault(dir);
    opportunity(vault, "Onboarding is confusing", "Retention");
    solution(vault, "Untouched bare solution", "Onboarding is confusing");
    solution(vault, "Solution the pass will fix", "Onboarding is confusing");
    const beforeSha = await commitAll("before: two bare solutions");

    // The pass: attach a test to one (leaves the queue), create a new bare
    // solution (enters the queue), and touch nothing else.
    assumptionTest(vault, "Onboarding steps are actually the drop-off point", "Solution the pass will fix");
    solution(vault, "New bare solution from this pass", "Onboarding is confusing");
    const afterSha = await commitAll("pass: fixed one, added one");

    const before = new Set(await vaultAtCommit(dir, beforeSha, (v, d) => missingAssumptions(v, d)));
    const after = new Set(await vaultAtCommit(dir, afterSha, (v, d) => missingAssumptions(v, d)));

    const entered = [...after].filter((t) => !before.has(t)).sort();
    const left = [...before].filter((t) => !after.has(t)).sort();

    expect(entered).toEqual(["New bare solution from this pass"]);
    expect(left).toEqual(["Solution the pass will fix"]);
    // Non-vacuity: the unchanged item is really on both recomputed queues, not
    // just missing from the entered/left diff by coincidence.
    expect(before.has("Untouched bare solution")).toBe(true);
    expect(after.has("Untouched bare solution")).toBe(true);
  });

  test("recomputing does not move the caller's own HEAD or working tree", async () => {
    const vault = new Vault(dir);
    opportunity(vault, "Onboarding is confusing", "Retention");
    solution(vault, "A bare solution", "Onboarding is confusing");
    const sha = await commitAll("one bare solution");

    const g = simpleGit(dir);
    const headBefore = (await g.revparse(["HEAD"])).trim();
    const statusBefore = await g.status();

    await vaultAtCommit(dir, sha, (v, d) => missingAssumptions(v, d));

    const headAfter = (await g.revparse(["HEAD"])).trim();
    const statusAfter = await g.status();
    expect(headAfter).toBe(headBefore);
    expect(statusAfter.isClean()).toBe(statusBefore.isClean());
    expect(statusAfter.isClean()).toBe(true);
  });
});
