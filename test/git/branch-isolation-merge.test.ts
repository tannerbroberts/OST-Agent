import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { simpleGit } from "simple-git";
import { createAgentBranch, mergeAgentBranch } from "../../src/git/branch-isolation.js";
import { findConflictMarkers } from "../../src/git/conflict-guard.js";

let main: string;
let worktrees: string[];

beforeEach(() => {
  main = fs.mkdtempSync(path.join(os.tmpdir(), "ost-branch-main-"));
  worktrees = [];
});

afterEach(() => {
  fs.rmSync(main, { recursive: true, force: true });
  for (const w of worktrees) fs.rmSync(w, { recursive: true, force: true });
});

async function initRepo(dir: string): Promise<void> {
  const g = simpleGit(dir);
  await g.init();
  await g.addConfig("user.email", "ost-agent@localhost");
  await g.addConfig("user.name", "OST-Agent");
}

function newWorktreeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-branch-wt-"));
  fs.rmdirSync(dir); // `git worktree add` refuses a target that already exists
  worktrees.push(dir);
  return dir;
}

async function commitAll(dir: string, message: string): Promise<void> {
  const g = simpleGit(dir);
  await g.add(["-A"]);
  await g.commit(message);
}

describe("branch isolation — two passes never share a working tree", () => {
  test("each agent branch gets its own checkout; writes in one are invisible in the other", async () => {
    await initRepo(main);
    fs.writeFileSync(path.join(main, "Root.md"), "root\n");
    await commitAll(main, "root");

    const a = await createAgentBranch(main, "agent-a", newWorktreeDir());
    const b = await createAgentBranch(main, "agent-b", newWorktreeDir());

    expect(a.dir).not.toBe(b.dir);
    expect(a.dir).not.toBe(path.resolve(main));

    fs.writeFileSync(path.join(a.dir, "Only In A.md"), "a\n");
    fs.writeFileSync(path.join(b.dir, "Only In B.md"), "b\n");

    expect(fs.existsSync(path.join(b.dir, "Only In A.md"))).toBe(false);
    expect(fs.existsSync(path.join(a.dir, "Only In B.md"))).toBe(false);
    expect(fs.existsSync(path.join(main, "Only In A.md"))).toBe(false);
    expect(fs.existsSync(path.join(main, "Only In B.md"))).toBe(false);

    // mainDir's own checkout never moved off the branch it started on
    const mainBranch = (await simpleGit(main).raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    expect(["main", "master"]).toContain(mainBranch);

    const branchOf = async (dir: string) => (await simpleGit(dir).raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    expect(await branchOf(a.dir)).toBe("agent-a");
    expect(await branchOf(b.dir)).toBe("agent-b");
  });
});

describe("merging different nodes — append-only Markdown merges without conflict", () => {
  test("two agents each appending a new node file merge cleanly, in either order", async () => {
    await initRepo(main);
    fs.writeFileSync(path.join(main, "Root.md"), "root\n");
    await commitAll(main, "root");

    const a = await createAgentBranch(main, "agent-append-a", newWorktreeDir());
    fs.writeFileSync(path.join(a.dir, "Node A.md"), "content from agent a\n");
    await commitAll(a.dir, "agent a: new node");

    const b = await createAgentBranch(main, "agent-append-b", newWorktreeDir());
    fs.writeFileSync(path.join(b.dir, "Node B.md"), "content from agent b\n");
    await commitAll(b.dir, "agent b: new node");

    const r1 = await mergeAgentBranch(main, "agent-append-a", "merge agent-append-a");
    expect(r1.merged).toBe(true);
    expect(r1.conflicts).toEqual([]);

    const r2 = await mergeAgentBranch(main, "agent-append-b", "merge agent-append-b");
    expect(r2.merged).toBe(true);
    expect(r2.conflicts).toEqual([]);

    expect(fs.readFileSync(path.join(main, "Node A.md"), "utf8")).toBe("content from agent a\n");
    expect(fs.readFileSync(path.join(main, "Node B.md"), "utf8")).toBe("content from agent b\n");
  });
});

/**
 * The genuine collisions the node names: two nodes created with the same
 * title, two edits to one parent's link list, and a status changed on both
 * sides. Ten seeded conflicts, three shapes, each merged into `main` after a
 * first branch has already landed there — so the second branch's merge is a
 * real three-way merge against a base that has moved.
 *
 * What this suite checks is the mechanical half only: every seeded collision
 * surfaces as a conflict — markers in the working tree, nothing committed —
 * and never resolves silently by picking a side. Whether a *resolution* of one
 * of these is any good is graded by a person against what both sides meant;
 * that is not a property a spec can assert and is out of scope here.
 */
describe("genuine collisions surface as conflicts, never resolved silently", () => {
  async function seedConflict(seed: (dir: string) => void, mutateA: (dir: string) => void, mutateB: (dir: string) => void) {
    await initRepo(main);
    seed(main);
    await commitAll(main, "seed");

    const a = await createAgentBranch(main, `agent-conflict-a-${worktrees.length}`, newWorktreeDir());
    mutateA(a.dir);
    await commitAll(a.dir, "agent a: edit");

    const b = await createAgentBranch(main, `agent-conflict-b-${worktrees.length}`, newWorktreeDir());
    mutateB(b.dir);
    await commitAll(b.dir, "agent b: edit");

    const clean = await mergeAgentBranch(main, a.branch, `merge ${a.branch}`);
    expect(clean.merged).toBe(true);

    return mergeAgentBranch(main, b.branch, `merge ${b.branch}`);
  }

  test.each([0, 1, 2])("same-titled node, created independently on both branches (%i)", async (i) => {
    const result = await seedConflict(
      (dir) => fs.writeFileSync(path.join(dir, "Root.md"), "root\n"),
      (dir) => fs.writeFileSync(path.join(dir, "New Node.md"), `body from a #${i}\n`),
      (dir) => fs.writeFileSync(path.join(dir, "New Node.md"), `body from b #${i}\n`),
    );
    expect(result.merged).toBe(false);
    expect(result.conflicts).toEqual([{ file: "New Node.md" }]);
    const staged = fs.readFileSync(path.join(main, "New Node.md"), "utf8");
    expect(findConflictMarkers(staged).length).toBeGreaterThan(0);
  });

  test.each([0, 1, 2, 3])("competing appends to one parent's link list (%i)", async (i) => {
    const result = await seedConflict(
      (dir) => fs.writeFileSync(path.join(dir, "Parent.md"), "# Parent\n## Children\n- [[Existing Child]]\n"),
      (dir) =>
        fs.writeFileSync(path.join(dir, "Parent.md"), `# Parent\n## Children\n- [[Existing Child]]\n- [[Child A${i}]]\n`),
      (dir) =>
        fs.writeFileSync(path.join(dir, "Parent.md"), `# Parent\n## Children\n- [[Existing Child]]\n- [[Child B${i}]]\n`),
    );
    expect(result.merged).toBe(false);
    expect(result.conflicts).toEqual([{ file: "Parent.md" }]);
    const staged = fs.readFileSync(path.join(main, "Parent.md"), "utf8");
    expect(findConflictMarkers(staged).length).toBeGreaterThan(0);
  });

  test.each([0, 1, 2])("status changed on both sides (%i)", async (i) => {
    const result = await seedConflict(
      (dir) => fs.writeFileSync(path.join(dir, "Node.md"), "---\nstatus: unvalidated\n---\nbody\n"),
      (dir) => fs.writeFileSync(path.join(dir, "Node.md"), `---\nstatus: validated-${i}\n---\nbody\n`),
      (dir) => fs.writeFileSync(path.join(dir, "Node.md"), `---\nstatus: rejected-${i}\n---\nbody\n`),
    );
    expect(result.merged).toBe(false);
    expect(result.conflicts).toEqual([{ file: "Node.md" }]);
    const staged = fs.readFileSync(path.join(main, "Node.md"), "utf8");
    expect(findConflictMarkers(staged).length).toBeGreaterThan(0);
  });

  test("a conflicted merge never commits — the working tree still has unresolved markers, HEAD unchanged", async () => {
    const result = await seedConflict(
      (dir) => fs.writeFileSync(path.join(dir, "Root.md"), "root\n"),
      (dir) => fs.writeFileSync(path.join(dir, "Same.md"), "a\n"),
      (dir) => fs.writeFileSync(path.join(dir, "Same.md"), "b\n"),
    );
    expect(result.merged).toBe(false);
    const headAfter = await simpleGit(main).revparse(["HEAD"]);
    expect(result.sha).toBe(headAfter);
    // "seed" + agent a's own commit + the merge commit that brought it in — the
    // conflicted merge of agent b never became a fourth commit
    const count = (await simpleGit(main).raw(["rev-list", "--count", "HEAD"])).trim();
    expect(count).toBe("3");
    // "AA" here — Same.md is a new path on both branches, so this is an
    // add/add conflict rather than the "UU" both-modified shape.
    const status = (await simpleGit(main).raw(["status", "--porcelain"])).trim();
    expect(status.split("\n").some((l) => l.startsWith("AA "))).toBe(true);
  });
});
