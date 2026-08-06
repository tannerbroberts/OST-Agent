import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { simpleGit } from "simple-git";
import { initVault } from "../../src/runner/init.js";
import { enqueueCommit } from "../../src/mcp/commit.js";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-commitq-"));
  await initVault(dir, "Reach 10,000 daily active users", "Retention");
  /*
   * Turn off git's background housekeeping in the fixture repo.
   *
   * `git commit` may spawn `gc --auto`, which detaches and keeps writing inside
   * `.git` after the commit has returned. This file commits several times in a
   * few hundred milliseconds and then deletes the repository, so the teardown
   * below can land while that process is still going — `ENOTEMPTY: directory not
   * empty, rmdir` on the fixture's `.git`, observed on CI on 2026-08-06 and never
   * locally, because it needs a machine slow enough for the two to overlap.
   *
   * Disabled here rather than tolerated in the teardown because the race is the
   * bug: a retry loop would make the failure rarer and leave a test that deletes
   * a repository out from under a live git process. Nothing is weakened — no
   * assertion in this file concerns packing or repacking.
   *
   * NOT set in `gitInitIfAbsent`: real vaults commit on every tool call and want
   * their housekeeping. This is a property of tests that create, commit to and
   * destroy a repository inside one tick, and any other test doing that has the
   * same exposure.
   */
  await simpleGit(dir).addConfig("gc.auto", "0");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

function writeNode(dir: string, name: string): void {
  fs.writeFileSync(path.join(dir, name), `---\ntype: Opportunity\n---\n${name}\n`);
}

describe("enqueueCommit", () => {
  test("sequential writes each produce their own commit", async () => {
    const before = (await simpleGit(dir).log()).total;
    writeNode(dir, "s1.md");
    const r1 = await enqueueCommit(dir, "mcp: s1");
    writeNode(dir, "s2.md");
    const r2 = await enqueueCommit(dir, "mcp: s2");
    expect(r1.committed).toBe(true);
    expect(r2.committed).toBe(true);
    expect((await simpleGit(dir).log()).total).toBe(before + 2);
  });

  test("a concurrent burst is serialized: no index-lock race, and all changes land committed", async () => {
    const before = (await simpleGit(dir).log()).total;
    const ps: Promise<{ committed: boolean }>[] = [];
    for (let i = 0; i < 5; i++) {
      writeNode(dir, `n${i}.md`);
      ps.push(enqueueCommit(dir, `mcp: n${i}`));
    }
    // Promise.all resolving (not rejecting) IS the serialization proof: concurrent
    // `git commit`s would otherwise race on .git/index.lock and throw. Writes already
    // on disk when a commit fires are folded into it — still committed, still revertible.
    const results = await Promise.all(ps);
    expect(results.some((r) => r.committed)).toBe(true);
    expect((await simpleGit(dir).status()).isClean()).toBe(true);
    expect((await simpleGit(dir).log()).total).toBeGreaterThan(before);
    for (let i = 0; i < 5; i++) expect(fs.existsSync(path.join(dir, `n${i}.md`))).toBe(true);
  });

  test("a clean-tree commit reports committed:false without wedging later commits", async () => {
    const r1 = await enqueueCommit(dir, "mcp: nothing to commit"); // clean tree
    expect(r1.committed).toBe(false);
    writeNode(dir, "c.md");
    const r2 = await enqueueCommit(dir, "mcp: after clean");
    expect(r2.committed).toBe(true);
  });

  test("a rejecting commit does not wedge the chain — a later commit still resolves", async () => {
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-nonrepo-"));
    try {
      // committing against a non-git directory rejects...
      await expect(enqueueCommit(nonRepo, "mcp: boom")).rejects.toThrow();
      // ...but the chain recovers: the next real commit still resolves and commits
      writeNode(dir, "after-reject.md");
      const r = await enqueueCommit(dir, "mcp: after reject");
      expect(r.committed).toBe(true);
    } finally {
      fs.rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});
