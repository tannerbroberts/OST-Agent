import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { simpleGit } from "simple-git";
import { Vault } from "../../src/ost/vault.js";
import { formatCensus, reconcileWithGit } from "../../src/ost/census.js";
import type { OstNode } from "../../src/ost/node.js";

let dir: string;
let vault: Vault;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-census-"));
  vault = new Vault(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const node = (title: string, layer: OstNode["layer"] = "Solution"): OstNode => ({
  title,
  layer,
  status: "unvalidated",
  tags: ["unvalidated"],
  links: [],
  body: "A body.",
});

describe("readTreeCensus — the counter reports what it was taken over", () => {
  test("a clean vault reports nodes equal to examined, with nothing dropped", () => {
    vault.createNode(node("Alpha"));
    vault.createNode(node("Beta"));

    const census = vault.readTreeCensus();

    expect(census.nodes).toHaveLength(2);
    expect(census.examined).toBe(2);
    expect(census.skipped).toEqual([]);
    expect(census.unreadable).toEqual([]);
  });

  test("the node list it returns is identical to readTree's — the census measures the real counter", () => {
    vault.createNode(node("Alpha"));
    vault.createNode(node("Beta", "Opportunity"));

    const viaCensus = vault.readTreeCensus().nodes.map((n) => n.title).sort();
    const viaReadTree = vault.readTree().map((n) => n.title).sort();

    expect(viaCensus).toEqual(viaReadTree);
  });

  /**
   * The whole point of the idea. Before this, a markdown file whose `type` was
   * misspelled vanished from every count in the product with no trace: it was
   * enumerated, silently filtered, and the operator read a confident integer.
   */
  test("a .md file with an unrecognised type is counted as examined and named as skipped", () => {
    vault.createNode(node("Alpha"));
    fs.writeFileSync(path.join(dir, "Stray.md"), "---\ntype: Opportunties\n---\ntypo in the layer\n");

    const census = vault.readTreeCensus();

    expect(census.nodes).toHaveLength(1);
    expect(census.examined).toBe(2);
    expect(census.skipped.map((s) => s.file)).toEqual(["Stray.md"]);
    expect(census.skipped[0]!.reason).toContain("Opportunties");
  });

  test("a .md file with no frontmatter type at all is skipped and named", () => {
    vault.createNode(node("Alpha"));
    fs.writeFileSync(path.join(dir, "README.md"), "# Just prose\n\nNo frontmatter here.\n");

    const census = vault.readTreeCensus();

    expect(census.nodes).toHaveLength(1);
    expect(census.examined).toBe(2);
    expect(census.skipped.map((s) => s.file)).toEqual(["README.md"]);
    expect(census.skipped[0]!.reason).toMatch(/no .*type/i);
  });

  /**
   * A file that cannot be parsed must not take the whole tree down, and must not
   * disappear either. Before the census, unparseable frontmatter threw out of
   * readTree and every command died with a stack trace naming no file.
   */
  test("a .md file whose frontmatter cannot be parsed is recorded as unreadable, not thrown", () => {
    vault.createNode(node("Alpha"));
    fs.writeFileSync(path.join(dir, "Broken.md"), "---\ntype: [unclosed\n  bad: : yaml\n---\nbody\n");

    const census = vault.readTreeCensus();

    expect(census.nodes).toHaveLength(1);
    expect(census.examined).toBe(2);
    expect(census.unreadable.map((u) => u.file)).toEqual(["Broken.md"]);
    expect(census.unreadable[0]!.reason).not.toBe("");
  });

  test("non-markdown files are not examined at all — they were never candidates", () => {
    vault.createNode(node("Alpha"));
    fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n");
    fs.mkdirSync(path.join(dir, ".ost-agent"));

    const census = vault.readTreeCensus();

    expect(census.examined).toBe(1);
    expect(census.skipped).toEqual([]);
  });
});

describe("reconcileWithGit — the denominator comes from a different source than the counter", () => {
  const initRepo = async (): Promise<void> => {
    const g = simpleGit(dir);
    await g.init();
    await g.addConfig("user.email", "t@example.com");
    await g.addConfig("user.name", "T");
  };

  test("returns undefined when the vault is not a git repo — an absent source is not a discrepancy", async () => {
    vault.createNode(node("Alpha"));
    const census = vault.readTreeCensus();

    const independent = await reconcileWithGit(dir, census);

    expect(independent).toBeUndefined();
  });

  test("agrees with the walk when both see the same files", async () => {
    await initRepo();
    vault.createNode(node("Alpha"));
    vault.createNode(node("Beta"));
    await simpleGit(dir).add(".").commit("in");

    const census = vault.readTreeCensus();
    const independent = await reconcileWithGit(dir, census);

    expect(independent).toBeDefined();
    expect(independent!.source).toBe("git");
    expect(independent!.tracked).toBe(2);
    expect(independent!.unseenByWalk).toEqual([]);
  });

  /**
   * The failure the solution node was written for: a file git knows about that the
   * filesystem walk never enumerated. A denominator taken from the same traversal
   * as the counter reads 100% here and says nothing.
   */
  test("names a tracked file the walk never enumerated", async () => {
    await initRepo();
    vault.createNode(node("Alpha"));
    fs.writeFileSync(path.join(dir, "Ghost.md"), "---\ntype: Solution\n---\nbody\n");
    await simpleGit(dir).add(".").commit("in");

    // The file is tracked by git, then removed from disk — the walk cannot see it.
    fs.unlinkSync(path.join(dir, "Ghost.md"));

    const census = vault.readTreeCensus();
    const independent = await reconcileWithGit(dir, census);

    expect(census.examined).toBe(1);
    expect(independent!.tracked).toBe(2);
    expect(independent!.unseenByWalk).toEqual(["Ghost.md"]);
  });

  test("a file the walk saw but git does not track is not a discrepancy — untracked is normal", async () => {
    await initRepo();
    vault.createNode(node("Alpha"));
    await simpleGit(dir).add(".").commit("in");
    vault.createNode(node("Beta")); // never committed

    const census = vault.readTreeCensus();
    const independent = await reconcileWithGit(dir, census);

    expect(census.examined).toBe(2);
    expect(independent!.tracked).toBe(1);
    expect(independent!.unseenByWalk).toEqual([]);
  });

  /**
   * Filenames with characters a shell would mangle are the origin story of this
   * idea — the em-dash bug that made four files invisible to a count that
   * reported success. Both sources must agree on them.
   */
  test("filenames containing an em-dash and quotes are seen by both sources", async () => {
    await initRepo();
    const awkward = "The loop — it can't see \"production\".md";
    fs.writeFileSync(path.join(dir, awkward), "---\ntype: Opportunity\n---\nbody\n");
    await simpleGit(dir).add(".").commit("in");

    const census = vault.readTreeCensus();
    const independent = await reconcileWithGit(dir, census);

    expect(census.examined).toBe(1);
    expect(census.nodes).toHaveLength(1);
    expect(independent!.tracked).toBe(1);
    expect(independent!.unseenByWalk).toEqual([]);
  });

  test("only markdown counts toward the independent denominator", async () => {
    await initRepo();
    vault.createNode(node("Alpha"));
    fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n");
    await simpleGit(dir).add(".").commit("in");

    const census = vault.readTreeCensus();
    const independent = await reconcileWithGit(dir, census);

    expect(independent!.tracked).toBe(1);
  });
});

describe("formatCensus — the operator reads a ratio, never a bare integer", () => {
  test("states the denominator even when nothing was dropped", () => {
    const line = formatCensus({ nodes: [], examined: 12, skipped: [], unreadable: [], retired: [] } as never, 12);
    expect(line).toContain("12");
    expect(line).toMatch(/of 12 .*examined/i);
  });

  test("names each dropped file rather than only counting them", () => {
    const line = formatCensus(
      {
        nodes: [],
        examined: 3,
        skipped: [{ file: "Stray.md", reason: "unrecognised type \"Opportunties\"" }],
        unreadable: [{ file: "Broken.md", reason: "bad yaml" }],
        retired: [],
      } as never,
      1,
    );
    expect(line).toContain("Stray.md");
    expect(line).toContain("Broken.md");
    expect(line).toContain("Opportunties");
  });

  test("surfaces a git discrepancy as the loudest part of the line", () => {
    const line = formatCensus(
      {
        nodes: [],
        examined: 1,
        skipped: [],
        unreadable: [],
        retired: [],
        independent: { source: "git", tracked: 2, unseenByWalk: ["Ghost.md"] },
      } as never,
      1,
    );
    expect(line).toContain("Ghost.md");
    expect(line).toMatch(/git/i);
  });

  test("says nothing alarming when the two sources agree", () => {
    const line = formatCensus(
      {
        nodes: [],
        examined: 2,
        skipped: [],
        unreadable: [],
        retired: [],
        independent: { source: "git", tracked: 2, unseenByWalk: [] },
      } as never,
      2,
    );
    expect(line).not.toMatch(/discrepan|unseen|✗/i);
  });
});
