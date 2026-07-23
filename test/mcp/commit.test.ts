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
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("enqueueCommit", () => {
  test("serializes concurrent commits into ordered, separate commits", async () => {
    const before = (await simpleGit(dir).log()).total;
    // two writes + two commits fired without awaiting between them
    fs.writeFileSync(path.join(dir, "a.md"), "---\ntype: Opportunity\n---\nA\n");
    const p1 = enqueueCommit(dir, "mcp: first");
    fs.writeFileSync(path.join(dir, "b.md"), "---\ntype: Opportunity\n---\nB\n");
    const p2 = enqueueCommit(dir, "mcp: second");
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.committed).toBe(true);
    expect(r2.committed).toBe(true);
    // exactly two new commits, no index race
    expect((await simpleGit(dir).log()).total).toBe(before + 2);
  });

  test("a clean-tree commit reports committed:false without wedging later commits", async () => {
    const r1 = await enqueueCommit(dir, "mcp: nothing to commit"); // clean tree
    expect(r1.committed).toBe(false);
    fs.writeFileSync(path.join(dir, "c.md"), "---\ntype: Opportunity\n---\nC\n");
    const r2 = await enqueueCommit(dir, "mcp: after clean");
    expect(r2.committed).toBe(true);
  });
});
