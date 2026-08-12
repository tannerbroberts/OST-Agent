/**
 * The shipped-status audit — when may a work queue believe `status: shipped`?
 *
 * `solutionsMissingInstruments` asks each solution for a command that is red
 * today and green once the solution is built. For behaviour that already ships
 * no such command can exist — a spec asserting it would pass on arrival,
 * measure nothing, and hand a builder no definition of done. Four solutions the
 * 2026-08-05 sweep correctly parked as `shipped` were back in the queue the
 * next pass, and the 2026-08-06 sweep reproduced the loop deliberately: promote
 * a solution, re-call `ost_next_work`, watch it reappear. Every future pass
 * re-reads those bodies and re-derives the same conclusion, or worse, invents a
 * fake instrument to make the number go down.
 *
 * So shipped solutions leave the queue — but not on the field's say-so. The
 * status is agent-settable, and a solution wrongly marked shipped would vanish
 * from the one queue that would have chased it. Trust is therefore conditional,
 * in two layers:
 *
 * 1. **The gate, read from the tree alone** ({@link trustsShippedStatus}): the
 *    promotion must be recorded in `## History` with its reasoning attached —
 *    the line `Vault.setStatus` writes when it is given a note. A `shipped`
 *    that arrived with no explanation is exactly the shape the dodge would
 *    take, and it stays in the queue until somebody records why it is true.
 * 2. **The audit, run against the repository** ({@link auditShippedSolutions}):
 *    every module or spec path a shipped solution names must resolve to a real
 *    file. A node that says "the guard lives in `src/ost/vault.ts`" about a
 *    file that is not there is describing code that does not exist, and the
 *    spec that runs this audit (`test/ost/shipped-status-audit.test.ts`) goes
 *    red — so a promotion that lies about the code cannot stay excluded
 *    silently.
 *
 * What neither layer settles: that the shipped code does what the node claims.
 * Resolving a path proves it exists, not that it is correct — that judgement
 * stays with the assumption tests under the solution, which the exclusion
 * deliberately does not touch.
 */
import fs from "node:fs";
import path from "node:path";
import { isHeadingLine } from "../ost/headings.js";
import type { OstNode } from "../ost/node.js";
import { testsUnderSolution } from "../processes/tree.js";

const HISTORY_HEADING = "## History";

/**
 * A dated History entry recording a transition TO `shipped` with a note after
 * the separator — the exact line `Vault.setStatus(title, "shipped", note)`
 * writes. The note is what makes it evidence rather than a bare field change,
 * so a transition without one does not match. `->`/`--` are accepted alongside
 * `→`/`—` for lines a human typed rather than the writer rendered.
 */
const SHIPPED_PROMOTION = /^[-*]\s+\d{4}-\d{2}-\d{2}\b.*status:.*(?:→|->)\s*shipped\s*(?:—|--)\s*\S/;

/** The `## History` block: its heading to the next heading of any level — the
 * same span `appendUnderHeading` writes into. */
function historyLines(body: string): string[] {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => isHeadingLine(l, HISTORY_HEADING));
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) break;
    out.push(line.trim());
  }
  return out;
}

/** The History line recording this node's promotion to shipped, when one exists. */
export function shippedPromotionLine(node: OstNode): string | undefined {
  return historyLines(node.body).find((l) => SHIPPED_PROMOTION.test(l));
}

/**
 * May a queue treat this node as genuinely shipped? Only when the status says
 * so AND the promotion is recorded in `## History` with reasoning attached.
 */
export function trustsShippedStatus(node: OstNode): boolean {
  return node.layer === "Solution" && node.status === "shipped" && shippedPromotionLine(node) !== undefined;
}

/**
 * Does this AssumptionTest answer for a solution trusted as shipped?
 *
 * The write boundary's version of {@link trustsShippedStatus} — a test asks a
 * command to fail, but a test one hop from a trusted promotion is allowed to
 * ask it to pass instead, because there is no unbuilt behaviour left for a red
 * to stake a claim about. Used by the write boundary in `ost/instrument.ts`
 * to tell a genuine first observation apart from the first-run-green it
 * refuses for everything else.
 */
export function testAnswersForShippedSolution(tree: readonly OstNode[], testTitle: string): boolean {
  const index = new Map(tree.map((n) => [n.title, n]));
  for (const n of tree) {
    if (n.layer !== "Solution" || !trustsShippedStatus(n)) continue;
    if (testsUnderSolution(n, index).some((t) => t.title === testTitle)) return true;
  }
  return false;
}

/**
 * Repo paths a node's prose names — `src/…` and `test/…` file references
 * outside fenced code blocks.
 *
 * Fenced blocks are excluded on evidence, not tidiness: in this product's own
 * vault, every unresolvable path a shipped solution carried sat inside a
 * "Definition of done" fence — an instrument command naming a spec that a
 * FUTURE build will write. Those are definitions of work, not claims about
 * code that exists, and auditing them would fail every node that honestly
 * declares its follow-on test.
 */
export function namedRepoPaths(body: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of body.split("\n")) {
    if (/^```/.test(line.trim())) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const m of line.matchAll(/\b(?:src|test)\/[\w./-]+\.[A-Za-z]+/g)) {
      if (!out.includes(m[0])) out.push(m[0]);
    }
  }
  return out;
}

/**
 * Does a named path resolve to a real file under `repoDir`?
 *
 * A `.js` reference falls back to its `.ts` source, because prose written by
 * something reading this codebase inherits its import specifiers — under
 * NodeNext resolution `src/ost/vault.js` is how the code itself names
 * `src/ost/vault.ts`, and both spellings appear in the vault today.
 */
function resolvesInRepo(repoDir: string, named: string): boolean {
  if (fs.existsSync(path.join(repoDir, named))) return true;
  return named.endsWith(".js") && fs.existsSync(path.join(repoDir, named.replace(/\.js$/, ".ts")));
}

export interface ShippedAuditProblem {
  solution: string;
  problem: string;
}

/**
 * Audit every shipped solution in the tree against the repository: the
 * promotion must be evidenced in History, and every module or spec the node
 * names must exist. Empty means every `shipped` in this tree can be trusted;
 * each problem names the solution and what fails, so a red run reads as a
 * work list rather than a verdict.
 */
export function auditShippedSolutions(tree: readonly OstNode[], repoDir: string): ShippedAuditProblem[] {
  const problems: ShippedAuditProblem[] = [];
  for (const n of tree) {
    if (n.layer !== "Solution" || n.status !== "shipped") continue;
    if (!shippedPromotionLine(n)) {
      problems.push({
        solution: n.title,
        problem: "no `## History` line records the promotion to shipped with its reasoning",
      });
    }
    for (const named of namedRepoPaths(n.body)) {
      if (!resolvesInRepo(repoDir, named)) {
        problems.push({ solution: n.title, problem: `names ${named}, which does not exist in the repository` });
      }
    }
  }
  return problems;
}
