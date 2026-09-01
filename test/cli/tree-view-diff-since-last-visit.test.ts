/**
 * The instrument for "A per-visit diff of the tree can be computed from the
 * vault alone" — the feasibility half of the solution "Rendered tree view with
 * diff since last visit".
 *
 * The threshold, quoted from the assumption test it answers:
 *
 *   > Against a fixture vault: render, record the visit, then make three changes
 *   > of different kinds — a new node, a status transition, and a merged
 *   > duplicate — and re-render. The second render must name all three and
 *   > nothing else. Zero false positives is the bar, because a diff that flags
 *   > unchanged nodes is one a reader stops reading.
 *
 * The three kinds are not three examples of one thing; they fail differently,
 * which is why the bar names all three:
 *
 *   - **created** is the easy case — any scan of file mtimes finds it.
 *   - **a status transition** touches frontmatter only, so a view that reads
 *     bodies misses it entirely.
 *   - **a merge** deletes one file, rewrites another, and rewrites every node
 *     that linked to the deleted one. A filesystem diff reports that as one
 *     deletion plus N unrelated edits; a diff computed from the vault's own
 *     semantics reports one event. That last case is what decides which of the
 *     two this is, and it is also where the false positives live — the N
 *     rewritten parents are the nodes a naive reader flags.
 *
 * **Where "and nothing else" is asserted, and why not over the whole render.**
 * The view has two parts: the change list, and a drawing of the tree's shape.
 * The shape necessarily names every node it draws, so "nothing else" can only
 * mean the change list, and that is where it is checked here — both on the
 * rendered block and on the structured diff behind it, so a rendering bug and a
 * diffing bug cannot cover for each other.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { Vault } from "../../src/ost/vault.js";
import { diffSinceVisit } from "../../src/eval/tree-view.js";
import { lastVisit } from "../../src/ost/visit.js";

// The local tsx binary, invoked directly rather than through `npx` — see
// test/cli/lanes.test.ts for why (npx takes npm's cacache lock).
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const run = promisify(execFile);
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

const READER = "stakeholder";

let dir: string;
let vault: Vault;
let root: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-tree-view-"));
  await initVault(dir, "Reach 10,000 daily active users");
  vault = new Vault(dir);
  root = vault.readTree().find((n) => n.layer === "Outcome")!.title;

  // Two buckets, so the merge's consequence and the creation's consequence land
  // on different parents. One parent absorbing both would let a diff that folds
  // consequences by accident look identical to one that folds them by rule.
  for (const opp of ["Onboarding drops people", "Nobody can tell what changed"]) {
    vault.createNode({ title: opp, layer: "Opportunity", status: "unvalidated", tags: [], links: [], body: "b", evidence: "stated" });
    vault.linkNodes(root, opp);
  }

  // The merge pair, and a test beneath the loser so the merge also moves an edge.
  for (const sol of ["A guided first run", "A guided first-run walkthrough"]) {
    vault.createNode({ title: sol, layer: "Solution", status: "unvalidated", tags: [], links: [], body: "b", evidence: "assertion" });
    vault.linkNodes("Onboarding drops people", sol);
  }
  vault.createNode({
    title: "Watch five first runs end to end",
    layer: "AssumptionTest",
    status: "unvalidated",
    tags: [],
    links: [],
    body: "b",
    evidence: "assertion",
  });
  vault.linkNodes("A guided first-run walkthrough", "Watch five first runs end to end");

  // The node whose status will move.
  vault.createNode({
    title: "A digest in the inbox",
    layer: "Solution",
    status: "unvalidated",
    tags: [],
    links: [],
    body: "b",
    evidence: "assertion",
  });
  vault.linkNodes("Nobody can tell what changed", "A digest in the inbox");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function cli(args: string[]) {
  return run(TSX, [CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
}

/** Make the three changes the threshold names, each of a different kind. */
function makeTheThreeChanges(): void {
  // 1. created — a new node under an existing parent.
  vault.createNode({
    title: "A rendered tree view",
    layer: "Solution",
    status: "unvalidated",
    tags: [],
    links: [],
    body: "b",
    evidence: "assertion",
  });
  vault.linkNodes("Nobody can tell what changed", "A rendered tree view");

  // 2. a status transition — frontmatter only.
  vault.setStatus("A digest in the inbox", "deferred", "the rendered view covers it");

  // 3. a merged duplicate — one file deleted, one rewritten, one parent repointed.
  vault.mergeNodesByPatch("A guided first-run walkthrough", "A guided first run", {
    contribution: "The walkthrough framing said the same thing.",
    why: "two spellings of one candidate",
  });
}

/**
 * The titles named as changes in a rendered view — parsed off the change list
 * only, never off the shape drawing beneath it.
 */
function changedTitlesIn(stdout: string): string[] {
  const lines = stdout.split("\n");
  const start = lines.findIndex((l) => l.startsWith("Since your last visit"));
  expect(start, "the render should carry a 'Since your last visit' block").toBeGreaterThanOrEqual(0);
  const titles: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("  Nothing else moved")) break;
    const match = /^ {2}\S+ \w+\s+"(.+)"$/.exec(line);
    if (match) titles.push(match[1]);
  }
  return titles;
}

describe("ost-agent tree-view — the diff since a recorded visit", () => {
  test("a first visit says so rather than reporting a tree's worth of changes", async () => {
    const { stdout } = await cli(["tree-view", "--vault", dir, "--as", READER]);

    expect(stdout).toContain("First visit");
    expect(stdout).not.toContain("Since your last visit");
    // The whole tree is still drawn — a first visit is a view, not an error.
    expect(stdout).toContain(root);
  }, 30_000);

  test("the second render names all three changes and nothing else", async () => {
    await cli(["tree-view", "--vault", dir, "--as", READER]);
    makeTheThreeChanges();

    const { stdout } = await cli(["tree-view", "--vault", dir, "--as", READER]);

    expect(stdout).toContain("Since your last visit");
    expect(changedTitlesIn(stdout).sort()).toEqual(
      ["A digest in the inbox", "A guided first run", "A rendered tree view"].sort(),
    );
  }, 30_000);

  test("each of the three is named as the kind of event it actually was", async () => {
    await cli(["tree-view", "--vault", dir, "--as", READER]);
    makeTheThreeChanges();

    const { stdout } = await cli(["tree-view", "--vault", dir, "--as", READER]);

    expect(stdout).toMatch(/created\s+"A rendered tree view"/);
    expect(stdout).toMatch(/status\s+"A digest in the inbox"/);
    expect(stdout).toContain("status: unvalidated → deferred");
    expect(stdout).toMatch(/merged\s+"A guided first run"/);
    // One event, naming the node that went away — not a deletion and an edit.
    expect(stdout).toContain('absorbed "A guided first-run walkthrough" — the two are now one node');
  }, 30_000);

  test("the parents whose files the merge and the creation rewrote are consequences, not changes", async () => {
    await cli(["tree-view", "--vault", dir, "--as", READER]);
    makeTheThreeChanges();

    const { stdout } = await cli(["tree-view", "--vault", dir, "--as", READER]);

    // Both parents were genuinely rewritten on disk — one lost its link to the
    // merged-away duplicate, the other gained a link to the new node. Neither is
    // a change a reader asked about, and this is the false-positive the bar names.
    expect(changedTitlesIn(stdout)).not.toContain("Onboarding drops people");
    expect(changedTitlesIn(stdout)).not.toContain("Nobody can tell what changed");
    // Not silently dropped either: each is named under the event that caused it.
    expect(stdout).toContain('and as a consequence, 1 node(s) had a link rewritten: "Onboarding drops people"');
    expect(stdout).toContain('and as a consequence, 1 node(s) had a link rewritten: "Nobody can tell what changed"');
  }, 30_000);

  test("the structured diff carries exactly three changes, so the render is not covering for it", async () => {
    await cli(["tree-view", "--vault", dir, "--as", READER]);
    const visit = lastVisit(dir, READER);
    expect(visit, "the first render must have recorded the visit").toBeDefined();

    makeTheThreeChanges();
    const diff = diffSinceVisit(vault.readTree(), visit, READER);

    expect(diff.changes.map((c) => `${c.kind} ${c.title}`).sort()).toEqual([
      "created A rendered tree view",
      "merged A guided first run",
      "status A digest in the inbox",
    ]);
    expect(diff.since).toBe(visit!.at);
    // Every node was compared, so "nothing else moved" is a statement about the
    // whole tree rather than about the part that was looked at.
    expect(diff.compared).toBe(vault.readTree().length);
  }, 30_000);

  test("a third render reports nothing, because the second one moved the marker", async () => {
    await cli(["tree-view", "--vault", dir, "--as", READER]);
    makeTheThreeChanges();
    await cli(["tree-view", "--vault", dir, "--as", READER]);

    const { stdout } = await cli(["tree-view", "--vault", dir, "--as", READER]);

    expect(stdout).toContain("nothing moved");
    expect(changedTitlesIn(stdout)).toEqual([]);
  }, 30_000);

  test("a first visit under --no-record does not promise a diff it will not be able to give", async () => {
    const first = await cli(["tree-view", "--vault", dir, "--as", "peeker", "--no-record"]);
    expect(first.stdout).toContain("NOT being recorded");

    // And the promise it declined to make is the one it keeps: still a first visit.
    const second = await cli(["tree-view", "--vault", dir, "--as", "peeker", "--no-record"]);
    expect(second.stdout).toContain("First visit");
  }, 30_000);

  test("--no-record looks without moving the marker", async () => {
    await cli(["tree-view", "--vault", dir, "--as", READER]);
    makeTheThreeChanges();
    await cli(["tree-view", "--vault", dir, "--as", READER, "--no-record"]);

    const { stdout } = await cli(["tree-view", "--vault", dir, "--as", READER]);

    expect(changedTitlesIn(stdout).sort()).toEqual(
      ["A digest in the inbox", "A guided first run", "A rendered tree view"].sort(),
    );
  }, 30_000);

  test("two readers keep separate positions", async () => {
    await cli(["tree-view", "--vault", dir, "--as", READER]);
    makeTheThreeChanges();
    await cli(["tree-view", "--vault", dir, "--as", READER]);

    // The second reader has never looked, so the changes are not "since" anything
    // for them — and the first reader's marker did not answer on their behalf.
    const { stdout } = await cli(["tree-view", "--vault", dir, "--as", "someone-else"]);

    expect(stdout).toContain("First visit");
  }, 30_000);

  test("the shape is drawn outcome-first, with each bucket's size and evidence rung", async () => {
    const { stdout } = await cli(["tree-view", "--vault", dir, "--as", READER]);

    expect(stdout).toContain("The shape, outcome first");
    expect(stdout).toMatch(/Onboarding drops people — Opportunity, Stated intent or report, 2 solution, 1 test/);
  }, 30_000);

  test("a reader name that would escape the sidecar directory is refused, not sanitised", async () => {
    await expect(cli(["tree-view", "--vault", dir, "--as", "../../etc/passwd"])).rejects.toThrow(
      /refusing ".*" as a reader name/,
    );
  }, 30_000);
});
