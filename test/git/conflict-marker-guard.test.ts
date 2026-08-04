/**
 * A conflict marker cannot reach a commit.
 *
 * The evidence: a merge conflict got committed into a source file and the next
 * run inherited a repository that could not build. The claim under test is not
 * "a guard exists" — it is the assumption underneath a *local hook*, which is
 * that the hook actually runs on the routes commits actually take. Hooks live on
 * one machine, are skipped with a flag, and do not exist on a fresh clone.
 *
 * So this file enumerates the routes rather than testing the scanner twice. For
 * each one it stages content containing a real conflict block and asserts the
 * commit is refused — and, for the routes that get through, says so out loud
 * with the reason, because the list of unprotected routes is the finding.
 *
 * Threshold: every commit route a *run* uses is refused; at most one human-only
 * route gets through.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { simpleGit } from "simple-git";
import * as safeGit from "../../src/git/safe-git.js";
import {
  ensurePreCommitHook,
  findConflictMarkers,
  HOOK_SIGNATURE,
  stagedConflictMarkers,
} from "../../src/git/conflict-guard.js";
import { enqueueCommit } from "../../src/mcp/commit.js";
import { Vault } from "../../src/ost/vault.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";

/** What git writes into a file when a merge stops. */
const CONFLICTED = [
  "# A node",
  "<<<<<<< HEAD",
  "ours",
  "=======",
  "theirs",
  ">>>>>>> feature",
  "",
].join("\n");

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-conflict-"));
  await safeGit.gitInitIfAbsent(dir);
  fs.writeFileSync(path.join(dir, "seed.md"), "seed\n");
  await safeGit.gitCommit(dir, "seed");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Count commits on HEAD — the only thing that finally matters. */
async function commitCount(d: string): Promise<number> {
  return Number((await simpleGit(d).raw(["rev-list", "--count", "HEAD"])).trim());
}

/**
 * Run git and report its real exit status.
 *
 * Deliberately `spawnSync` rather than `simple-git`: `simpleGit().raw(["merge", …])`
 * **resolves** on a conflicted merge, even though git exited 1. A helper built on
 * it reports "the merge succeeded" for the exact case this file is about, which
 * is how the first draft of the conflicted-merge route passed for the wrong
 * reason. Whether a commit was refused is a question about git's exit code, so
 * ask git.
 */
function runGit(cwd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("the scanner", () => {
  test("a conflict block is a `<<<<<<<` that something later closes", () => {
    expect(findConflictMarkers(CONFLICTED)).toEqual([{ line: 2, text: "<<<<<<< HEAD" }]);
  });

  test("a bare `=======` is NOT a marker — it is a setext heading, and this vault is Markdown", () => {
    // The reason the rule is a block rather than any of the three lines. A
    // scanner that flags a row of equals signs refuses to commit ordinary prose,
    // which in a vault of Markdown notes is a false positive on every other file.
    expect(findConflictMarkers("Release Notes\n=======\n\nbody\n")).toEqual([]);
    expect(findConflictMarkers("Title\n=====\n")).toEqual([]);
    // ...and an unclosed opener alone is not a block either.
    expect(findConflictMarkers("<<<<<<< HEAD\nours\n")).toEqual([]);
  });

  test("finds every block in a file, not just the first", () => {
    expect(findConflictMarkers(`${CONFLICTED}\nmiddle\n${CONFLICTED}`)).toHaveLength(2);
  });

  test("scans the STAGED blob, not the working-tree file", async () => {
    // The commit captures the index. A file staged dirty and then fixed on disk
    // still commits the marker, so the index is what has to be clean.
    const f = path.join(dir, "note.md");
    fs.writeFileSync(f, CONFLICTED);
    await simpleGit(dir).add(["-A"]);
    fs.writeFileSync(f, "resolved\n"); // working tree now clean, index is not
    expect(await stagedConflictMarkers(dir)).toMatchObject([{ file: "note.md", line: 2 }]);
  });
});

/**
 * ROUTE GROUP 1 — the routes a run takes.
 *
 * Every commit this product creates funnels through `gitCommit`. These are the
 * ones the threshold says must all be refused.
 */
describe("routes a run takes — all refused", () => {
  test("route: gitCommit — a run's own git call", async () => {
    fs.writeFileSync(path.join(dir, "note.md"), CONFLICTED);
    const before = await commitCount(dir);
    await expect(safeGit.gitCommit(dir, "should not happen")).rejects.toThrow(
      /conflict marker/i,
    );
    expect(await commitCount(dir)).toBe(before);
    // and the refusal says where, so it is actionable without a second look
    await expect(safeGit.gitCommit(dir, "x")).rejects.toThrow(/note\.md:2/);
  });

  test("route: the MCP auto-commit, which fires per write", async () => {
    // src/mcp/commit.ts — the queue every non-read-only tool call drains into.
    fs.writeFileSync(path.join(dir, "note.md"), CONFLICTED);
    const before = await commitCount(dir);
    await expect(enqueueCommit(dir, "ost_annotate — ...")).rejects.toThrow(/conflict marker/i);
    expect(await commitCount(dir)).toBe(before);
    // A rejected commit must not wedge the queue: the next clean write commits.
    fs.rmSync(path.join(dir, "note.md"));
    fs.writeFileSync(path.join(dir, "ok.md"), "fine\n");
    await expect(enqueueCommit(dir, "ost_annotate — ok")).resolves.toMatchObject({
      committed: true,
    });
  });

  test("route: the `git_commit` tool an agent can call directly", async () => {
    fs.writeFileSync(path.join(dir, "note.md"), CONFLICTED);
    const ctx: ToolContext = { vault: new Vault(dir), dir, remote: { enabled: false } };
    const tool = buildOstTools(ctx).find((t) => t.name === "git_commit")!;
    const run = (tool as unknown as { run: (i: unknown) => Promise<string> }).run;
    const before = await commitCount(dir);
    await expect(run({ message: "pass complete" })).rejects.toThrow(/conflict marker/i);
    expect(await commitCount(dir)).toBe(before);
  });

  test("no commit route in src/ bypasses the funnel", async () => {
    // The behavioural tests above cover the funnel. This covers the claim that
    // it IS the funnel: `gitCommit` is the only thing in src/ that commits, so
    // a new caller inherits the guard and a new direct `git commit` would fail
    // here rather than quietly reopening the hole.
    const srcRoot = new URL("../../src", import.meta.url).pathname;
    const offenders: string[] = [];
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          walk(p);
          continue;
        }
        if (!e.name.endsWith(".ts")) continue;
        if (p.endsWith(path.join("git", "safe-git.ts"))) continue; // where it is defined
        const code = fs
          .readFileSync(p, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");
        if (/\.commit\s*\(/.test(code) || /raw\(\s*\[\s*["']commit["']/.test(code)) {
          offenders.push(path.relative(srcRoot, p));
        }
      }
    };
    walk(srcRoot);
    expect(offenders, "a commit path outside gitCommit skips the conflict guard").toEqual([]);
  });
});

/**
 * ROUTE GROUP 2 — the routes a human takes in the same working tree.
 *
 * These do not go through `gitCommit`; they go through the `pre-commit` hook, so
 * they are also the test of whether installing a hook was worth doing.
 */
describe("routes a human takes — covered by the installed hook", () => {
  test("the hook is installed by init and re-asserted on every commit", async () => {
    const hook = path.join(dir, ".git", "hooks", "pre-commit");
    expect(fs.readFileSync(hook, "utf8")).toContain(HOOK_SIGNATURE);
    expect(fs.statSync(hook).mode & 0o111).toBeGreaterThan(0); // executable

    // A vault that predates this, or a fresh clone: no hook until something commits.
    fs.rmSync(hook);
    fs.writeFileSync(path.join(dir, "later.md"), "later\n");
    await safeGit.gitCommit(dir, "later");
    expect(fs.readFileSync(hook, "utf8")).toContain(HOOK_SIGNATURE);
  });

  test("route: `git commit` by hand", async () => {
    const g = simpleGit(dir);
    fs.writeFileSync(path.join(dir, "note.md"), CONFLICTED);
    await g.add(["-A"]);
    const before = await commitCount(dir);
    const r = runGit(dir, ["commit", "-m", "by hand"]);
    expect(r.ok, "the hook let a hand commit through").toBe(false);
    expect(r.out).toMatch(/conflict marker/i);
    expect(await commitCount(dir)).toBe(before);
  });

  test("route: `git commit --amend`", async () => {
    const g = simpleGit(dir);
    fs.writeFileSync(path.join(dir, "note.md"), CONFLICTED);
    await g.add(["-A"]);
    const before = await commitCount(dir);
    const r = runGit(dir, ["commit", "--amend", "--no-edit"]);
    expect(r.ok, "the hook let an amend through").toBe(false);
    expect(await commitCount(dir)).toBe(before);
  });

  test("route: the `git commit` that concludes a CONFLICTED merge", async () => {
    // The route the evidence actually came from: a merge stopped, someone staged
    // the file with the markers still in it, and committed the result.
    const g = simpleGit(dir);
    const base = (await g.raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    // Two branches editing the same line, off the same seed commit.
    await g.raw(["checkout", "-b", "theirs"]);
    fs.writeFileSync(path.join(dir, "note.md"), "theirs\n");
    await safeGit.gitCommit(dir, "theirs");
    await g.raw(["checkout", base]);
    fs.writeFileSync(path.join(dir, "note.md"), "ours\n");
    await safeGit.gitCommit(dir, "ours");

    const merge = runGit(dir, ["merge", "theirs"]);
    expect(merge.ok, "expected this merge to conflict").toBe(false);
    // git has now written the markers into note.md itself.
    expect(fs.readFileSync(path.join(dir, "note.md"), "utf8")).toContain("<<<<<<<");

    await g.add(["note.md"]); // the mistake: stage the conflict as-is
    const before = await commitCount(dir);
    const r = runGit(dir, ["commit", "--no-edit"]);
    expect(r.ok, "a conflicted merge was committed with its markers intact").toBe(false);
    expect(await commitCount(dir)).toBe(before);
  });

  test("route: `git rebase --continue` after a conflict, via its commit", async () => {
    // A rebase resolves through the same `git commit`, so it is the hook again;
    // driving the underlying commit is what this asserts, without depending on
    // rebase's interactive sequencing.
    const g = simpleGit(dir);
    fs.writeFileSync(path.join(dir, "note.md"), CONFLICTED);
    await g.add(["-A"]);
    const before = await commitCount(dir);
    const r = runGit(dir, ["commit", "-m", "rebase: resolved"]);
    expect(r.ok).toBe(false);
    expect(await commitCount(dir)).toBe(before);
  });

  test("a `pre-commit` hook this project did not write is never overwritten", async () => {
    // Installing a guard by clobbering a contributor's own hook would silently
    // disable whatever that hook did — an edit-in-place of someone else's file,
    // which this project does not do. The run-side guard still holds.
    const hook = path.join(dir, ".git", "hooks", "pre-commit");
    fs.writeFileSync(hook, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    expect(ensurePreCommitHook(dir)).toMatch(/^left-alone/);
    expect(fs.readFileSync(hook, "utf8")).not.toContain(HOOK_SIGNATURE);

    fs.writeFileSync(path.join(dir, "note.md"), CONFLICTED);
    await expect(safeGit.gitCommit(dir, "still refused")).rejects.toThrow(/conflict marker/i);
  });
});

/**
 * ROUTE GROUP 3 — what gets through, recorded rather than hidden.
 *
 * The threshold allows at most one human-only escape. These assert the escapes
 * that exist, so the count is a fact the suite holds rather than a claim in a
 * doc, and so any future one has to be added here deliberately.
 */
describe("routes that get through — the finding", () => {
  test("ESCAPE 1 (human-only, deliberate): `git commit --no-verify` bypasses the hook", async () => {
    const g = simpleGit(dir);
    fs.writeFileSync(path.join(dir, "note.md"), CONFLICTED);
    await g.add(["-A"]);
    const before = await commitCount(dir);
    const r = runGit(dir, ["commit", "--no-verify", "-m", "bypassed"]);
    expect(r.ok, "documented: --no-verify is the one human escape").toBe(true);
    expect(await commitCount(dir)).toBe(before + 1);
    // It is human-only: nothing in src/ can reach it. The product has no shell
    // and `gitCommit` never passes the flag, so no run can take this route.
    const srcRoot = new URL("../../src", import.meta.url).pathname;
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) return walk(p);
        if (!e.name.endsWith(".ts")) return [];
        const code = fs.readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
        return /--no-verify|noVerify/.test(code) ? [p] : [];
      });
    expect(walk(srcRoot), "a run can skip the hook").toEqual([]);
  });

  test("NOT an escape: a clean auto-merge makes a commit without running `pre-commit`", async () => {
    // Verified against git 2.50: `git merge` that merges cleanly creates its
    // commit itself and never invokes pre-commit. That is a real gap in hook
    // COVERAGE and not a route markers can travel — git only writes markers when
    // a merge STOPS, and a merge that stops is concluded by `git commit`, which
    // the hook does cover (asserted above). What it can still carry in is a
    // commit made on another branch that never passed this hook, which is the
    // case a local guard structurally cannot close.
    const g = simpleGit(dir);
    const base = (await g.raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    await g.raw(["checkout", "-b", "clean-side"]);
    fs.writeFileSync(path.join(dir, "side.md"), "side\n");
    await safeGit.gitCommit(dir, "side");
    await g.raw(["checkout", base]);
    fs.writeFileSync(path.join(dir, "mine.md"), "mine\n");
    await safeGit.gitCommit(dir, "mine");

    // A hook that always fails proves whether it is consulted at all: if git ran
    // it, the merge commit could not exist.
    const hook = path.join(dir, ".git", "hooks", "pre-commit");
    fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const merge = runGit(dir, ["merge", "--no-ff", "-m", "auto", "clean-side"]);
    expect(merge.ok, "if this ever fails, git started running pre-commit on auto-merges").toBe(
      true,
    );
    // ...and it really is a merge commit, made without the hook's consent.
    const parents = (await g.raw(["rev-list", "--parents", "-n", "1", "HEAD"])).trim().split(/\s+/);
    expect(parents).toHaveLength(3); // sha + two parents
  });

  test("a fresh clone has no hook until something installs it — the structural limit", async () => {
    // "A local hook is advisory": hooks are not cloned. `gitCommit` re-asserts
    // the hook, so a clone the product touches is covered from its first commit
    // — but a clone a human commits into first is not, and no local mechanism
    // can change that. This is the case for a server-side check.
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), "ost-clone-"));
    try {
      await simpleGit().clone(dir, clone);
      expect(fs.existsSync(path.join(clone, ".git", "hooks", "pre-commit"))).toBe(false);

      const g = simpleGit(clone);
      await g.addConfig("user.email", "ost-agent@localhost");
      await g.addConfig("user.name", "OST-Agent");
      fs.writeFileSync(path.join(clone, "note.md"), CONFLICTED);
      await g.add(["-A"]);
      const before = await commitCount(clone);
      const r = runGit(clone, ["commit", "-m", "fresh clone, no hook"]);
      expect(r.ok, "documented: an un-hooked clone accepts a marker by hand").toBe(true);
      expect(await commitCount(clone)).toBe(before + 1);

      // ...and the first time the product commits there, the hook appears and
      // the route closes.
      fs.writeFileSync(path.join(clone, "next.md"), "next\n");
      await safeGit.gitCommit(clone, "next");
      expect(fs.readFileSync(path.join(clone, ".git", "hooks", "pre-commit"), "utf8")).toContain(
        HOOK_SIGNATURE,
      );
      fs.writeFileSync(path.join(clone, "note2.md"), CONFLICTED);
      await g.add(["-A"]);
      expect(runGit(clone, ["commit", "-m", "now refused"]).ok).toBe(false);
    } finally {
      fs.rmSync(clone, { recursive: true, force: true });
    }
  });
});

describe("the guard does not get in the way", () => {
  test("ordinary vault content commits, including Markdown full of equals signs", async () => {
    fs.writeFileSync(
      path.join(dir, "Opportunity.md"),
      "Some Heading\n=======\n\nA node about `<<<` and `>>>` operators.\n",
    );
    await expect(safeGit.gitCommit(dir, "ordinary")).resolves.toMatchObject({ committed: true });
  });

  test("a binary blob is skipped, not decoded and scanned", async () => {
    fs.writeFileSync(path.join(dir, "blob.bin"), Buffer.from([0, 1, 2, 0, 255, 0]));
    await expect(safeGit.gitCommit(dir, "binary")).resolves.toMatchObject({ committed: true });
  });
});
