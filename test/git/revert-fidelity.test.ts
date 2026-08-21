/**
 * Revert fidelity — "Test does git auto-init and one-command revert work everywhere".
 *
 * The product's recoverability story is that every write is a new commit in a
 * repository the agent creates if it has to, so a pass the operator does not
 * want is one `git revert` away. The vault auto-commits and `test/git/` covers
 * conflict markers and lock behaviour, but nothing snapshotted a tree, ran a
 * pass against it, reverted, and compared — so a write that escaped a commit,
 * or a revert that left a file behind, would go unreported. This file is that
 * comparison, in both environments the suite can stand in for:
 *
 *   - a **fresh empty directory**, where `init` has to create the repository
 *     before anything else can be revertible at all;
 *   - an **existing repository** with its own history, which `init` adopts.
 *
 * "One command" is taken literally: the revert below is a single `git revert
 * --no-edit <before>..HEAD` — one invocation for however many commits the pass
 * made — and on a fresh vault the root commit itself reverts with `git revert
 * --no-edit HEAD`. "Byte-identical" is taken literally too: every regular file
 * under the vault (`.git` aside) is hashed before and after, and git's own tree
 * id is compared beside it, so a file git restored but the hash shows differs,
 * or a file git never tracked, both fail the comparison.
 *
 * Two things this file names rather than hides, because a green that quietly
 * excluded them would be the vacuity W4 is about:
 *
 *   - `init` writes ONE thing outside version control on purpose: the drop
 *     folder, a sibling of the vault (W1 — the inbox is outside the working tree
 *     so "may write notes" and "may write the tree" are different grants). No
 *     revert reaches it, and the fresh-directory test asserts it is there so the
 *     exclusion is measured, not assumed.
 *   - git does not track directories, so the empty scaffold folders `init`
 *     creates (`.ost-agent/state/` and friends) survive a revert. They hold no
 *     bytes; the comparison is over files and says so.
 *
 * The third environment the assumption node names — a machine with no git
 * preinstalled — is about somebody's laptop, and no exit code here stands in
 * for it. The node says the same; it stays a person's check.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { simpleGit, type SimpleGit } from "simple-git";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { createOstMcpServer } from "../../src/mcp/server.js";

/** git's id for the empty tree — what a fully reverted fresh repository points at. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * The vault sits one level below the temp root so that `init`'s sibling drop
 * folder (`../<vault>.inbox`) lands inside the fixture and is torn down with it,
 * rather than accumulating in the system temp directory.
 */
let root: string;
let dir: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ost-revert-"));
  dir = path.join(root, "vault");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

/** Every regular file under `d` (minus `.git`), keyed by relative path, valued by content hash. */
function fileHashes(d: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (cur: string): void => {
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const p = path.join(cur, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        out[path.relative(d, p).split(path.sep).join("/")] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      }
    }
  };
  if (fs.existsSync(d)) walk(d);
  return out;
}

/** Directories under `d` (minus `.git`) that contain no files at any depth. */
function emptyDirs(d: string): string[] {
  const out: string[] = [];
  const walk = (cur: string): boolean => {
    let anyFile = false;
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const p = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (walk(p)) anyFile = true;
      } else anyFile = true;
    }
    if (!anyFile && cur !== d) out.push(path.relative(d, cur).split(path.sep).join("/"));
    return anyFile;
  };
  walk(d);
  return out.sort();
}

async function treeId(g: SimpleGit): Promise<string> {
  return (await g.revparse(["HEAD^{tree}"])).trim();
}
async function head(g: SimpleGit): Promise<string> {
  return (await g.revparse(["HEAD"])).trim();
}
async function commitCount(g: SimpleGit, range = "HEAD"): Promise<number> {
  return Number((await g.raw(["rev-list", "--count", range])).trim());
}
/** `git status --porcelain --ignored` — empty means nothing untracked, modified OR ignored. */
async function leftovers(g: SimpleGit): Promise<string> {
  return (await g.raw(["status", "--porcelain", "--ignored"])).trim();
}

/**
 * The one command. A single `git revert` invocation over the range the pass
 * produced; `--no-edit` only so that no editor opens. Nothing else runs.
 */
async function revertInOneCommand(g: SimpleGit, before: string): Promise<void> {
  await g.raw(["revert", "--no-edit", `${before}..HEAD`]);
}

/**
 * A pass, stood in for by the MCP surface a real pass writes through: a node
 * created and then appended to, each auto-committed by the server exactly as
 * they would be under Claude Code. Two calls so the pass spans more than one
 * commit, which is what makes the range form of the revert load-bearing.
 */
async function runPass(vaultDir: string): Promise<void> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createOstMcpServer(buildPassContext(vaultDir));
  await server.connect(serverT);
  const client = new Client({ name: "revert-fidelity", version: "0.0.0" });
  await client.connect(clientT);
  try {
    const created = await client.callTool({
      name: "ost_create_node",
      arguments: {
        title: "Players want a daily reason to return",
        layer: "Opportunity",
        parent: "Retention",
        body: "Players want a daily reason to return.",
        evidence: "stated",
      },
    });
    expect(created.isError, JSON.stringify(created.content)).toBeFalsy();
    const appended = await client.callTool({
      name: "ost_append_to_node",
      arguments: { title: "Players want a daily reason to return", section: "## Notes\nwritten by the pass" },
    });
    expect(appended.isError, JSON.stringify(appended.content)).toBeFalsy();
  } finally {
    await client.close();
    await server.close();
  }
}

/**
 * Turn off git's background housekeeping in fixture repos that commit several
 * times and are then deleted — `gc --auto` can still be writing inside `.git`
 * when the teardown lands (see `test/mcp/commit.test.ts` for the CI sighting).
 */
async function quietGc(g: SimpleGit): Promise<void> {
  await g.addConfig("gc.auto", "0");
}

describe("a fresh empty directory", () => {
  test("auto-init produces a repository, and everything init wrote inside it is in its first commit", async () => {
    fs.mkdirSync(dir);
    expect(fs.readdirSync(dir)).toEqual([]);

    const r = await initVault(dir, "Reach 10,000 daily active users", "Retention");
    const g = simpleGit(dir);

    expect(r.gitInitialized).toBe(true);
    expect(fs.existsSync(path.join(dir, ".git"))).toBe(true);
    // Exactly one commit, and nothing escaped it: no untracked, modified OR
    // ignored file anywhere under the vault. A file init wrote outside a commit
    // is a file no revert can take back.
    expect(await commitCount(g)).toBe(1);
    expect(await leftovers(g)).toBe("");
    // Non-vacuity: the commit holds the things init is for.
    const tracked = (await g.raw(["ls-files"])).trim().split("\n");
    expect(tracked).toContain("Retention.md");
    expect(tracked).toContain("ost.config.yaml");

    // The one deliberate write outside version control, measured rather than
    // assumed: the drop folder is a sibling of the vault (W1). Nothing in the
    // repository can revert it, and this assertion is what keeps that fact from
    // being read as "init wrote nothing outside git".
    expect(path.relative(dir, r.inboxDir).startsWith("..")).toBe(true);
    expect(fs.existsSync(r.inboxDir)).toBe(true);
    expect(fs.readdirSync(root).sort()).toEqual(["vault", "vault.inbox"]);
  });

  test("a pass's writes revert to the post-init tree, byte-identical, in one command", async () => {
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    const g = simpleGit(dir);
    await quietGc(g);

    const before = await head(g);
    const beforeTree = await treeId(g);
    const beforeFiles = fileHashes(dir);

    await runPass(dir);

    // The pass really changed things and really committed them — otherwise the
    // comparison below would be equal for the wrong reason.
    expect(await commitCount(g, `${before}..HEAD`)).toBeGreaterThanOrEqual(2);
    expect(await leftovers(g)).toBe("");
    expect(fileHashes(dir)).not.toEqual(beforeFiles);
    expect(fs.existsSync(path.join(dir, "Players want a daily reason to return.md"))).toBe(true);

    await revertInOneCommand(g, before);

    expect(await treeId(g)).toBe(beforeTree);
    expect(fileHashes(dir)).toEqual(beforeFiles);
    expect(await leftovers(g)).toBe("");
    // and history only grew: the pass's commits are still there, under the reverts
    expect(await g.raw(["merge-base", "--is-ancestor", before, "HEAD"]).then(() => true, () => false)).toBe(true);
  });

  test("even init's own root commit reverts in one command, back to an empty tree", async () => {
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    const g = simpleGit(dir);
    await quietGc(g);
    expect(Object.keys(fileHashes(dir)).length).toBeGreaterThan(0);

    await g.raw(["revert", "--no-edit", "HEAD"]);

    expect(await treeId(g)).toBe(EMPTY_TREE);
    expect(fileHashes(dir)).toEqual({});
    expect(await leftovers(g)).toBe("");
    // What remains is directories only — git does not track them, so a revert
    // cannot remove them. Named here so the "empty tree" above is read
    // correctly: no bytes, not no entries.
    const remaining = emptyDirs(dir);
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining).toContain(".ost-agent/state");
    for (const d of remaining) expect(fs.readdirSync(path.join(dir, d)).filter((n) => fs.statSync(path.join(dir, d, n)).isFile())).toEqual([]);
  });
});

describe("an existing repository", () => {
  /** A repository with its own files and two commits of history, as an operator would bring one. */
  async function existingRepo(): Promise<SimpleGit> {
    fs.mkdirSync(dir);
    const g = simpleGit(dir);
    await g.init();
    await g.addConfig("user.email", "operator@example.com");
    await g.addConfig("user.name", "Operator");
    await quietGc(g);
    fs.writeFileSync(path.join(dir, "Notes.md"), "# Notes\n\nthe operator's own file\n");
    fs.mkdirSync(path.join(dir, "archive"));
    fs.writeFileSync(path.join(dir, "archive", "2025.md"), "older material\n");
    await g.add(["-A"]);
    await g.commit("operator: notes");
    fs.appendFileSync(path.join(dir, "Notes.md"), "\nsecond thoughts\n");
    await g.add(["-A"]);
    await g.commit("operator: second thoughts");
    return g;
  }

  test("init adopts the repository rather than re-creating it, and a pass reverts to the prior tree, byte-identical, in one command", async () => {
    const g = await existingRepo();
    const before = await head(g);
    const beforeTree = await treeId(g);
    const beforeFiles = fileHashes(dir);
    const beforeCount = await commitCount(g);

    const r = await initVault(dir, "Reach 10,000 daily active users", "Retention");
    expect(r.gitInitialized).toBe(false);
    // the operator's history is untouched underneath init's commit
    expect(await commitCount(g)).toBe(beforeCount + 1);
    expect(await g.raw(["merge-base", "--is-ancestor", before, "HEAD"]).then(() => true, () => false)).toBe(true);
    expect(await leftovers(g)).toBe("");

    await runPass(dir);
    expect(await leftovers(g)).toBe("");
    expect(fileHashes(dir)).not.toEqual(beforeFiles);
    // the operator's files were not rewritten by the pass
    expect(fileHashes(dir)["Notes.md"]).toBe(beforeFiles["Notes.md"]);
    expect(fileHashes(dir)["archive/2025.md"]).toBe(beforeFiles["archive/2025.md"]);

    await revertInOneCommand(g, before);

    expect(await treeId(g)).toBe(beforeTree);
    expect(fileHashes(dir)).toEqual(beforeFiles);
    expect(await leftovers(g)).toBe("");
    // nothing of the pass is left on disk, and the operator's files are exactly as they were
    expect(fs.existsSync(path.join(dir, "Retention.md"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "ost.config.yaml"))).toBe(false);
    expect(fs.readFileSync(path.join(dir, "Notes.md"), "utf8")).toBe("# Notes\n\nthe operator's own file\n\nsecond thoughts\n");
  });

  /**
   * KNOWN LIMIT, pinned with its expectation set to the hole — the shape this
   * repo uses so that closing it fails the build and tells the fixer to move it
   * (see the Gate P table's `ost_link_nodes` row in `docs/reference/v1-readiness.md`).
   *
   * Every commit the product makes goes through `gitCommit`, which stages with
   * `git add -A`. An edit the operator had on disk but had not committed when
   * the pass ran is therefore folded into the pass's commit — still committed,
   * still in history — and the one-command revert takes the tree back to the
   * operator's LAST COMMIT, not to the bytes that were on disk. "Byte-identical
   * prior tree" holds against a clean working tree and does not hold against a
   * dirty one; the edit is recoverable (`git show <pass-sha>:<file>`), but that
   * is a second command and a diagnosis, not the one-command promise.
   *
   * Fixing it means the commit funnel staging only what the agent wrote, which
   * changes the meaning of every auto-commit (D5 currently relies on `add -A`
   * sweeping stray files INTO history). That is a tree decision, not a test
   * decision, so this row records the behaviour as it is.
   */
  test("KNOWN LIMIT: a pass on a dirty operator tree folds the uncommitted edit into its commit, and the revert undoes that edit too", async () => {
    const g = await existingRepo();
    const before = await head(g);
    const committedNotes = fs.readFileSync(path.join(dir, "Notes.md"), "utf8");
    const uncommittedNotes = `${committedNotes}\nan edit the operator had not committed yet\n`;
    fs.writeFileSync(path.join(dir, "Notes.md"), uncommittedNotes);

    await initVault(dir, "Reach 10,000 daily active users", "Retention");

    // the operator's edit is now inside init's commit...
    const initTouched = await g.raw(["show", "--stat", "--format=", "HEAD"]);
    expect(initTouched).toContain("Notes.md");

    await revertInOneCommand(g, before);

    // ...so the one-command revert reverts it as well. When the funnel stops
    // staging the operator's files, this flips: move the expectation to
    // `uncommittedNotes` and this row becomes the guarantee rather than the limit.
    expect(fs.readFileSync(path.join(dir, "Notes.md"), "utf8")).toBe(committedNotes);
    expect(fs.readFileSync(path.join(dir, "Notes.md"), "utf8")).not.toBe(uncommittedNotes);
  });
});
