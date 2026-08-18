import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { simpleGit, type SimpleGit } from "simple-git";
import { scanDeadEnds } from "../../src/git/dead-end-scan.js";

/**
 * "Replay two hundred commits and count what a dead-end scan flags" — the
 * instrument for "Detect the dead ends from the artifact trail rather than
 * from the session".
 *
 * A synthetic repository standing in for the 200-commit window the
 * assumption test describes, built with two dead-end shapes mixed among
 * routine commits: a commit reverted the ordinary way (`git revert`), and a
 * file created then deleted a few commits later. Both leave every command
 * that touched them exiting 0 — nothing here is a tool error — which is the
 * whole premise this candidate stakes its build on.
 */

async function initRepo(dir: string): Promise<SimpleGit> {
  fs.mkdirSync(dir, { recursive: true });
  const g = simpleGit(dir);
  await g.init();
  await g.addConfig("user.email", "fixture@localhost");
  await g.addConfig("user.name", "fixture");
  return g;
}

function write(dir: string, name: string, content: string): void {
  fs.writeFileSync(path.join(dir, name), content);
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-dead-end-scan-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("scanDeadEnds", () => {
  test("flags a reverted commit and a created-then-deleted file, and nothing else", async () => {
    const g = await initRepo(dir);

    write(dir, "steady.md", "v1");
    await g.add(["-A"]);
    await g.commit("routine: seed steady.md");

    write(dir, "steady.md", "v2");
    await g.add(["-A"]);
    await g.commit("routine: edit steady.md");

    write(dir, "scratch.md", "throwaway notes");
    await g.add(["-A"]);
    await g.commit("routine: add scratch.md");

    write(dir, "steady.md", "v3");
    await g.add(["-A"]);
    await g.commit("routine: edit steady.md again");

    fs.rmSync(path.join(dir, "scratch.md"));
    await g.add(["-A"]);
    await g.commit("routine: remove scratch.md");

    write(dir, "steady.md", "wrong turn");
    await g.add(["-A"]);
    const wrongTurn = await g.commit("feat: wrong turn on steady.md");
    const wrongTurnSha = wrongTurn.commit;

    await g.revert(wrongTurnSha, ["--no-edit"]);

    const events = await scanDeadEnds(dir, { maxCommits: 200 });

    const reverts = events.filter((e) => e.kind === "revert");
    expect(reverts).toHaveLength(1);
    expect(reverts[0]?.revertedSha).toBe(wrongTurnSha);

    const churn = events.filter((e) => e.kind === "created-then-deleted");
    expect(churn).toHaveLength(1);
    expect(churn[0]?.file).toBe("scratch.md");

    // Precision: the routine commits (two edits to steady.md, the add of
    // scratch.md) must not themselves be flagged — only the two reversal
    // shapes should appear across the whole window.
    expect(events).toHaveLength(2);
  });

  test("a file added before the window and only deleted inside it is not flagged", async () => {
    const g = await initRepo(dir);

    write(dir, "old.md", "predates the window");
    await g.add(["-A"]);
    await g.commit("routine: seed old.md");

    write(dir, "steady.md", "v1");
    await g.add(["-A"]);
    await g.commit("routine: seed steady.md");

    fs.rmSync(path.join(dir, "old.md"));
    await g.add(["-A"]);
    await g.commit("routine: retire old.md");

    // Window of 1 excludes the commit that added old.md, so its deletion
    // has no visible creation inside the window and must not be flagged.
    const events = await scanDeadEnds(dir, { maxCommits: 1 });
    expect(events.filter((e) => e.kind === "created-then-deleted")).toHaveLength(0);
  });
});
