/**
 * Interpose an Assumption between every Solution and its AssumptionTests.
 *
 * The belief each test is risking was written by reading the solution's own
 * claim, the sentence where it names its own risk, and the test's threshold —
 * see `dump-solution-digests.ts` for the digest that pass worked from. The
 * mapping lives in JSON beside this script rather than inline, because it is
 * 264 hand-written entries and a diff of it should read as data.
 *
 * For each mapped solution: create the Assumption, link it under the solution,
 * move every test onto it, and unlink the solution's direct test edges. The
 * detach is recorded in the solution's History, so the tree says where its
 * tests went.
 *
 * Dry-run by default; pass --apply to write.
 */
import fs from "node:fs";
import path from "node:path";
import { Vault } from "../src/ost/vault.js";
import type { OstNode } from "../src/ost/node.js";

interface Belief {
  solution: string;
  title: string;
  body: string;
  /** Optional: which tests go on this belief. Default = all of the solution's. */
  tests?: string[];
}

const SOURCE = "tree-restructure:2026-08-05 — the belief this solution's test was already measuring";

function loadBeliefs(dir: string): Belief[] {
  const files = fs.readdirSync(dir).filter((f) => /^beliefs-\d+\.json$/.test(f)).sort();
  if (!files.length) throw new Error(`no beliefs-NN.json in ${dir}`);
  return files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Belief[]);
}

function main(): void {
  const vaultDir = process.argv[2];
  const beliefDir = process.argv[3];
  const apply = process.argv.includes("--apply");
  if (!vaultDir || !beliefDir) throw new Error("usage: <vault> <belief-dir> [--apply]");

  const vault = new Vault(vaultDir, { create: false });
  const tree = vault.readTree();
  const index = new Map<string, OstNode>(tree.map((n) => [n.title, n]));
  const beliefs = loadBeliefs(beliefDir);

  // Every problem is reported before anything is written — a half-applied
  // interpose leaves some solutions with tests and some without, and telling
  // which is which afterwards means re-deriving the mapping.
  const problems: string[] = [];
  const seenTitle = new Set<string>();
  const claimedTests = new Set<string>();
  for (const b of beliefs) {
    const sol = index.get(b.solution);
    if (!sol) { problems.push(`no such Solution: "${b.solution}"`); continue; }
    if (sol.layer !== "Solution") { problems.push(`"${b.solution}" is a ${sol.layer}`); continue; }
    if (index.has(b.title)) problems.push(`Assumption title collides with an existing node: "${b.title}"`);
    if (seenTitle.has(b.title)) problems.push(`duplicate Assumption title in the mapping: "${b.title}"`);
    seenTitle.add(b.title);
    const own = sol.links.filter((l) => index.get(l)?.layer === "AssumptionTest");
    for (const t of b.tests ?? own) {
      if (!own.includes(t)) problems.push(`"${t}" is not a test under "${b.solution}"`);
      if (claimedTests.has(`${b.solution}::${t}`)) problems.push(`test claimed twice: "${t}"`);
      claimedTests.add(`${b.solution}::${t}`);
    }
  }

  // Coverage, both ways: a solution with tests and no belief would silently keep
  // its legacy edges, and that is the failure this migration exists to end.
  const solutions = tree.filter((n) => n.layer === "Solution");
  const mapped = new Set(beliefs.map((b) => b.solution));
  const missing = solutions.filter((s) => !mapped.has(s.title) && s.links.some((l) => index.get(l)?.layer === "AssumptionTest"));
  const unclaimed: string[] = [];
  for (const s of solutions) {
    if (!mapped.has(s.title)) continue;
    for (const t of s.links.filter((l) => index.get(l)?.layer === "AssumptionTest")) {
      if (!claimedTests.has(`${s.title}::${t}`)) unclaimed.push(`${s.title} → ${t}`);
    }
  }

  console.log(`beliefs: ${beliefs.length}   solutions with tests: ${solutions.filter((s) => s.links.some((l) => index.get(l)?.layer === "AssumptionTest")).length}`);
  if (missing.length) {
    console.log(`\nUNMAPPED — ${missing.length} solution(s) still linking a test directly:`);
    for (const m of missing.slice(0, 40)) console.log(`  ${m.title}`);
    if (missing.length > 40) console.log(`  … and ${missing.length - 40} more`);
  }
  if (unclaimed.length) {
    console.log(`\nUNCLAIMED TESTS — ${unclaimed.length} test(s) under a mapped solution with no belief:`);
    for (const u of unclaimed) console.log(`  ${u}`);
  }
  if (problems.length) {
    console.log(`\nPROBLEMS (${problems.length}):`);
    for (const p of problems) console.log(`  ${p}`);
  }

  if (!apply) { console.log("\ndry run — pass --apply to write"); return; }
  if (problems.length || missing.length || unclaimed.length) {
    throw new Error("refusing to apply: fix the problems above first (a half-applied interpose is worse than none)");
  }

  let created = 0;
  let movedTests = 0;
  for (const b of beliefs) {
    const sol = index.get(b.solution)!;
    const tests = b.tests ?? sol.links.filter((l) => index.get(l)?.layer === "AssumptionTest");
    vault.createNode({
      title: b.title,
      layer: "Assumption",
      status: "unvalidated",
      tags: ["unvalidated"],
      links: [],
      // The floor rung. This node's own provenance is the restructure that
      // wrote it; the test beneath it keeps whatever rung it already earned.
      evidence: "assertion",
      source: SOURCE,
      body: b.body,
    } as OstNode);
    vault.linkNodes(b.solution, b.title);
    created++;
    for (const t of tests) {
      vault.linkNodes(b.title, t);
      vault.detach(b.solution, t, `moved under [[${b.title}]] — the belief this test measures now has a node of its own`);
      movedTests++;
    }
  }
  console.log(`\napplied: ${created} Assumption(s) created, ${movedTests} test(s) re-parented`);
}

main();
