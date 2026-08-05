/**
 * Give every node exactly one parent.
 *
 * Three solutions hung under BOTH "Fear the agent could take a destructive,
 * irreversible action" and "Want proof no hijackable capability even exists" —
 * two opportunities that are near-duplicates of each other. The second is
 * `status: deferred` and carries an open Issue flagging it as a merge candidate
 * with the first, which is why three solutions ended up serving both: nobody
 * had decided whether they were one need or two.
 *
 * This does not decide that. It decides, per solution, which of the two stated
 * needs that solution actually answers, and keeps that edge:
 *
 *   - "destructive, irreversible action" is about the WORST CASE staying
 *     revertible even under prompt injection ("a poisoned Jira comment saying
 *     'delete everything' must not be able to make it destroy anything").
 *   - "no hijackable capability even exists" is about ASSURANCE FROM ABSENCE
 *     ("I don't want to rely on the agent choosing to behave… I want assurance
 *     that no general-purpose or destructive capability even exists").
 *
 * The surplus edge is detached, not deleted, and the reason lands in the losing
 * parent's History — so the tree records that the choice was made rather than
 * that the edge was never there.
 *
 * Dry-run by default; pass --apply to write.
 */
import { Vault } from "../src/ost/vault.js";
import type { OstNode } from "../src/ost/node.js";

const DESTRUCTIVE = "Fear the agent could take a destructive, irreversible action";
const ABSENCE = "Want proof no hijackable capability even exists";

/** solution → the parent to KEEP, and why the other one loses it. */
const KEEP: { solution: string; parent: string; why: string }[] = [
  {
    solution: "Allowlist Tool Runner registers only OST tools",
    parent: ABSENCE,
    why:
      "this solution is assurance-from-absence — it registers only the OST tools so no general-purpose or " +
      "destructive capability exists to hijack, which is that opportunity's need almost verbatim, and its litmus " +
      "already names an allowlist-only tool runner as one of the ways to meet it",
  },
  {
    solution: "Prompt-injection red-team harness in CI",
    parent: DESTRUCTIVE,
    why:
      "this solution asserts that poisoned content — an ingested note saying 'delete everything' — fires no tool " +
      "call outside the allowlist, which is the destructive-action need's own stated case rather than a claim " +
      "about which capabilities exist",
  },
  {
    solution: "Published capability manifest with signed build",
    parent: ABSENCE,
    why:
      "this solution publishes the exact tool list as an inspectable, signed manifest — it is proof about which " +
      "capabilities exist, which is the assurance-from-absence need; it constrains no destructive action on its own",
  },
];

function main(): void {
  const dir = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!dir) throw new Error("usage: migrate-meta-vault-single-parent.ts <vault> [--apply]");

  const vault = new Vault(dir, { create: false });
  const tree = vault.readTree();
  const index = new Map<string, OstNode>(tree.map((n) => [n.title, n]));

  let cut = 0;
  for (const k of KEEP) {
    const node = index.get(k.solution);
    if (!node) throw new Error(`no such node: ${k.solution}`);
    const held = tree.filter((n) => n.links.includes(k.solution)).map((n) => n.title);
    if (!held.includes(k.parent)) throw new Error(`"${k.parent}" does not currently hold "${k.solution}"`);
    const losing = held.filter((p) => p !== k.parent);
    console.log(`\n${k.solution}\n  keeps: ${k.parent}`);
    for (const l of losing) console.log(`  drops: ${l}`);
    cut += losing.length;
    if (!apply) continue;
    for (const l of losing) vault.detach(l, k.solution, `${k.why} — one node, one parent`);
  }

  console.log(`\n${cut} surplus edge(s)${apply ? " detached" : " would be detached"}`);
  if (!apply) console.log("dry run — pass --apply to write");
}

main();
