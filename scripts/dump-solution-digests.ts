/**
 * A compact digest of every Solution and the tests beneath it — enough to state
 * the belief each test is risking, without carrying whole bodies.
 *
 * The full bodies are ~800KB across the meta vault, which is more than any one
 * pass can hold. What actually determines the belief is much smaller: the
 * solution's opening claim, the sentence where it names its own risk ("What
 * would make this the wrong pick"), and the test's threshold. That is what this
 * emits.
 */
import { Vault } from "../src/ost/vault.js";
import type { OstNode } from "../src/ost/node.js";

const dir = process.argv[2];
if (!dir) throw new Error("usage: dump-solution-digests.ts <vault>");
const only = process.argv[3] ? Number(process.argv[3]) : undefined;
const skip = process.argv[4] ? Number(process.argv[4]) : 0;

const tree = new Vault(dir, { create: false }).readTree();
const index = new Map<string, OstNode>(tree.map((n) => [n.title, n]));

/** The first real paragraph — the claim the solution is making. */
function claim(body: string): string {
  const p = body
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith("#") && !s.startsWith("[[") && !s.startsWith("`"));
  return (p ?? "").replace(/\s+/g, " ").slice(0, 320);
}

/** The node's own statement of when it is the wrong choice, if it made one. */
function risk(body: string): string {
  const m = body.match(/\*\*What would make this the wrong pick\.?\*\*\s*([\s\S]*?)(?=\n\s*\n|\n##|$)/i);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 320) : "";
}

const solutions = tree.filter((n) => n.layer === "Solution").sort((a, b) => a.title.localeCompare(b.title));
const slice = solutions.slice(skip, only ? skip + only : undefined);

for (const s of slice) {
  const tests = s.links.map((l) => index.get(l)).filter((n): n is OstNode => n?.layer === "AssumptionTest");
  console.log(`\n### ${s.title}`);
  const c = claim(s.body);
  if (c) console.log(`CLAIM: ${c}`);
  const r = risk(s.body);
  if (r) console.log(`RISK: ${r}`);
  for (const t of tests) {
    console.log(`TEST: ${t.title}`);
    if (t.threshold) console.log(`  THRESHOLD: ${t.threshold.replace(/\s+/g, " ").slice(0, 200)}`);
  }
}
console.error(`${slice.length} solution(s) of ${solutions.length}`);
