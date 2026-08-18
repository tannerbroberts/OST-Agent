import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { simpleGit, type SimpleGit } from "simple-git";
import { checkInvariants } from "../../src/eval/invariants.js";
import { findRenameShapedBreaks } from "../../src/git/rename-topology.js";
import { liveRenameRepairs } from "../../src/ost/rename-repair.js";
import { serialize, type OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";

/**
 * "Audit both vault histories for rename-shaped link breaks" — the instrument
 * for "Detect renames from link topology and repair the edge".
 *
 * Two synthetic vault git histories, each standing in for one of the "both
 * vault histories" the assumption test names — real git repos, built the way
 * the incident that motivated this happened: a file edited outside the
 * product's own tools, not through `Vault`. History A reproduces the shape of
 * the actual 2026-07-24 incident (a node's file emptied, a differently-titled
 * node appeared in the same commit carrying its exact links, and the old
 * title stayed linked from its parent — the tree's own read already treats
 * the emptied file as absent, per `readTreeCensus`'s "no frontmatter type"
 * skip). History B is the case the node's own "Definition of done" flags as
 * the real risk: a node genuinely deleted, where repairing the edge would be
 * the quieter failure of the two.
 */

function node(n: Partial<OstNode> & Pick<OstNode, "title" | "layer">): OstNode {
  return { tags: [], links: [], body: "", evidence: "stated", ...n } as OstNode;
}

async function initRepo(dir: string): Promise<SimpleGit> {
  fs.mkdirSync(dir, { recursive: true });
  const g = simpleGit(dir);
  await g.init();
  await g.addConfig("user.email", "fixture@localhost");
  await g.addConfig("user.name", "fixture");
  return g;
}

function writeNode(dir: string, n: OstNode): void {
  fs.writeFileSync(path.join(dir, `${n.title}.md`), serialize(n));
}

let dirA: string;
let dirB: string;

beforeEach(() => {
  dirA = fs.mkdtempSync(path.join(os.tmpdir(), "ost-rename-history-a-"));
  dirB = fs.mkdtempSync(path.join(os.tmpdir(), "ost-rename-history-b-"));
});
afterEach(() => {
  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });
});

describe("history A — a rename-shaped break", () => {
  test("is detected from link topology and the dangling edge is repaired", async () => {
    const g = await initRepo(dirA);

    const outcome = node({ title: "Outcome", layer: "Outcome", links: ["Trust an unmonitored agent enough to walk away"] });
    const target = node({
      title: "Trust an unmonitored agent enough to walk away",
      layer: "Opportunity",
      links: ["Quarantine unknown node types instead of dropping them", "Detect renames from link topology and repair the edge"],
    });
    const childA = node({ title: "Quarantine unknown node types instead of dropping them", layer: "Solution" });
    const childB = node({ title: "Detect renames from link topology and repair the edge", layer: "Solution" });
    for (const n of [outcome, target, childA, childB]) writeNode(dirA, n);
    await g.add(["-A"]);
    await g.commit("seed");

    // The hand-edit: the old file goes empty (not deleted), and a differently
    // titled file appears in the same commit carrying the old node's exact
    // outgoing links. `Outcome` is untouched, so it still links to the old
    // title — the dangling edge the incident produced.
    fs.writeFileSync(path.join(dirA, `${target.title}.md`), "");
    const renamed = node({
      title:
        "Any steakholder can start the ost-agent npm package, pour compute and a goal into it, and trust it to efficiently map out the path to accomplishing the goal",
      layer: "Opportunity",
      links: target.links,
    });
    writeNode(dirA, renamed);
    await g.add(["-A"]);
    await g.commit("hand-edit: rename + retype, no link rewrite");

    const breaks = await findRenameShapedBreaks(dirA);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].oldTitle).toBe(target.title);
    expect(breaks[0].newTitle).toBe(renamed.title);
    expect(breaks[0].sharedLinks.sort()).toEqual([...target.links].sort());

    // Read the live tree the way every other gate does. The vacated file has
    // no frontmatter left to parse, so `readTree` already treats it as absent
    // — the exact "invisible node" the incident's own account describes.
    const vault = new Vault(dirA, { create: false });
    const before = vault.readTree();
    expect(before.some((n) => n.title === target.title)).toBe(false);
    expect(before.some((n) => n.title === renamed.title)).toBe(true);

    const beforeViolations = checkInvariants(before);
    expect(beforeViolations.some((v) => v.rule === "dangling-link" && v.detail.includes(target.title))).toBe(true);

    const repairs = liveRenameRepairs(before, breaks);
    expect(repairs).toHaveLength(1);
    expect(repairs[0].parent).toBe(outcome.title);

    for (const r of repairs) {
      vault.repointEdge(r.parent, r.break.oldTitle, r.break.newTitle, `rename-shaped break in commit ${r.break.commit}`);
    }

    const afterOutcome = vault.read(outcome.title);
    expect(afterOutcome.links).toContain(renamed.title);
    expect(afterOutcome.links).not.toContain(target.title);

    const after = vault.readTree();
    const afterViolations = checkInvariants(after);
    expect(afterViolations.some((v) => v.rule === "dangling-link" && v.detail.includes(target.title))).toBe(false);
  });
});

describe("history B — a genuine deletion beside an unrelated new node", () => {
  test("is not mistaken for a rename — different link sets, no match", async () => {
    const g = await initRepo(dirB);

    const outcome = node({ title: "Outcome B", layer: "Outcome", links: ["A node someone deleted on purpose"] });
    const deleted = node({
      title: "A node someone deleted on purpose",
      layer: "Opportunity",
      links: ["Some child only the deleted node pointed at"],
    });
    const child = node({ title: "Some child only the deleted node pointed at", layer: "Solution" });
    for (const n of [outcome, deleted, child]) writeNode(dirB, n);
    await g.add(["-A"]);
    await g.commit("seed");

    // A real deletion: the file is removed from disk entirely (not emptied).
    // In the SAME commit an unrelated new node is added with its own,
    // different links — the coincidence a naive "delete + add in one commit"
    // heuristic would wrongly pair.
    fs.unlinkSync(path.join(dirB, `${deleted.title}.md`));
    const unrelated = node({
      title: "An unrelated idea filed the same day",
      layer: "Opportunity",
      links: ["A completely different child"],
    });
    writeNode(dirB, unrelated);
    await g.add(["-A"]);
    await g.commit("real deletion + coincidental unrelated addition");

    const breaks = await findRenameShapedBreaks(dirB);
    expect(breaks).toHaveLength(0);

    // The outcome's edge to the deleted node is still dangling, and stays that
    // way — nothing here may repair it, because nothing found a rename.
    const vault = new Vault(dirB, { create: false });
    const tree = vault.readTree();
    const violations = checkInvariants(tree);
    expect(violations.some((v) => v.rule === "dangling-link" && v.detail.includes(deleted.title))).toBe(true);
    expect(liveRenameRepairs(tree, breaks)).toHaveLength(0);
  });
});
