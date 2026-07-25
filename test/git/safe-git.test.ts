import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { simpleGit } from "simple-git";
import * as safeGit from "../../src/git/safe-git.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-git-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("safe-git exported surface", () => {
  test("exposes exactly the three safe operations — no reset/rm/force", () => {
    expect(Object.keys(safeGit).sort()).toEqual(["gitCommit", "gitInitIfAbsent", "gitPush"]);
    const src = fs.readFileSync(new URL("../../src/git/safe-git.ts", import.meta.url), "utf8");
    // Scan CODE only (strip comments — the doc comment names these on purpose).
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/--force/);
    expect(code).not.toMatch(/\.(reset|clean|rm|deleteLocalBranch)\s*\(/);
    expect(code).not.toMatch(/branch\s*\(\s*\[?\s*["']-D/);
    expect(code).not.toMatch(/filter-branch|rev-list.*--all.*reset/);
  });
});

describe("gitInitIfAbsent + gitCommit", () => {
  test("commits only new history; the parent chain stays intact", async () => {
    expect(await safeGit.gitInitIfAbsent(dir)).toBe(true);
    expect(await safeGit.gitInitIfAbsent(dir)).toBe(false); // idempotent

    fs.writeFileSync(path.join(dir, "a.md"), "one");
    const c1 = await safeGit.gitCommit(dir, "first");
    expect(c1.committed).toBe(true);

    fs.writeFileSync(path.join(dir, "b.md"), "two");
    const c2 = await safeGit.gitCommit(dir, "second");
    expect(c2.committed).toBe(true);
    expect(c2.sha).not.toBe(c1.sha);

    const count = (await simpleGit(dir).raw(["rev-list", "--count", "HEAD"])).trim();
    expect(count).toBe("2");

    // the first commit is still an ancestor — history was never rewritten
    const isAncestor = await simpleGit(dir)
      .raw(["merge-base", "--is-ancestor", c1.sha, c2.sha])
      .then(() => true)
      .catch(() => false);
    expect(isAncestor).toBe(true);
  });

  test("commits succeed with no ambient git identity (fresh CI runner / bare machine)", async () => {
    // Simulate a machine with no usable global/system identity: a global config that
    // sets user.useConfigOnly (so git refuses to guess an identity) and no name/email.
    // Without gitInitIfAbsent seeding a repo-local identity, the commit would fail here.
    const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-gitcfg-"));
    const globalCfg = path.join(cfgDir, "config");
    fs.writeFileSync(globalCfg, "[user]\n\tuseConfigOnly = true\n");
    const prev = { g: process.env.GIT_CONFIG_GLOBAL, s: process.env.GIT_CONFIG_SYSTEM };
    process.env.GIT_CONFIG_GLOBAL = globalCfg;
    process.env.GIT_CONFIG_SYSTEM = os.platform() === "win32" ? "NUL" : "/dev/null";
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "ost-noident-"));
    try {
      await safeGit.gitInitIfAbsent(d);
      fs.writeFileSync(path.join(d, "a.md"), "one");
      const c = await safeGit.gitCommit(d, "first");
      expect(c.committed).toBe(true);
    } finally {
      if (prev.g === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = prev.g;
      if (prev.s === undefined) delete process.env.GIT_CONFIG_SYSTEM;
      else process.env.GIT_CONFIG_SYSTEM = prev.s;
      fs.rmSync(d, { recursive: true, force: true });
      fs.rmSync(cfgDir, { recursive: true, force: true });
    }
  });

  test("commit is a no-op when the tree is clean", async () => {
    await safeGit.gitInitIfAbsent(dir);
    fs.writeFileSync(path.join(dir, "a.md"), "one");
    await safeGit.gitCommit(dir, "first");
    const again = await safeGit.gitCommit(dir, "noop");
    expect(again.committed).toBe(false);
  });
});

describe("gitPush", () => {
  test("fast-forward pushes to a local bare remote", async () => {
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), "ost-remote-"));
    await simpleGit(remote).raw(["init", "--bare"]);
    try {
      await safeGit.gitInitIfAbsent(dir);
      await simpleGit(dir).addRemote("origin", remote);
      fs.writeFileSync(path.join(dir, "a.md"), "one");
      await safeGit.gitCommit(dir, "first");
      // read the branch only after a commit exists
      const branch = (await simpleGit(dir).raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      await expect(safeGit.gitPush(dir, "origin")).resolves.toBeUndefined();
      const remoteCount = (await simpleGit(remote).raw(["rev-list", "--count", branch])).trim();
      expect(remoteCount).toBe("1");
    } finally {
      fs.rmSync(remote, { recursive: true, force: true });
    }
  });
});
