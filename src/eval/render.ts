/**
 * The analysis renderers: one source of wording for four surfaces' worth of
 * output. The CLI prints what these return; the MCP tools return it verbatim.
 *
 * These print nothing and exit nothing. `check` and `gate` hand back the fact
 * the CLI turns into an exit code, because an MCP tool has no exit code and
 * the text has to carry the verdict either way.
 */
import { checkInvariants } from "./invariants.js";
import { computeEvidenceDebt, gateSolution } from "./evidence-debt.js";
import { computeCoverageDebt, computeCoveragePairs, computeUnfixedThresholds } from "./coverage.js";
import { BELIEVABILITY_LADDER, believabilityRollup } from "../knowledge/believability.js";
import type { PassContext } from "../processes/types.js";
import type { OstNode } from "../ost/node.js";

export function renderCheck(tree: OstNode[]): { text: string; violations: number } {
  const lines: string[] = [];
  const violations = checkInvariants(tree);
  if (violations.length === 0) {
    lines.push("invariants: PASS (0 violations)");
  } else {
    lines.push(`invariants: FAIL (${violations.length} violation(s))`);
    for (const v of violations) lines.push(`  ✗ [${v.rule}] ${v.node ? `"${v.node}": ` : ""}${v.detail}`);
  }
  return { text: lines.join("\n"), violations: violations.length };
}

export function renderDebt(tree: OstNode[]): string {
  const lines: string[] = [];
  const debt = computeEvidenceDebt(tree);
  const t = debt.totals;
  lines.push(`Solutions: ${t.solutions}  (untested ${t.untested}, proposed-only ${t.proposed}, tested ${t.tested})`);
  for (const s of debt.solutions) {
    const detail =
      s.state === "tested"
        ? `${s.testsRun}/${s.testsProposed} test(s) with results`
        : s.state === "proposed"
          ? `${s.testsProposed} proposed, none run`
          : "no assumption test";
    lines.push(`  [${s.state}] ${s.title} — ${detail}`);
  }
  const coverage = computeCoverageDebt(tree);
  const c = coverage.totals;
  lines.push(
    `\nCoverage: ${c.withResults} test(s) with results  (bounded ${c.bounded}, unbounded ${c.unbounded})`,
  );
  for (const g of coverage.gaps) {
    const detail =
      g.stated === 0
        ? `${g.claimed} result(s), none saying what they fail to cover`
        : `${g.claimed} result(s) against ${g.stated} uncovered statement(s)`;
    lines.push(`  [unbounded] ${g.title} — ${detail}`);
  }
  if (coverage.gaps.length > 0) {
    lines.push("  a result with no stated limit gets read as answering the whole question.");
  }

  // The bounded tests, read side by side. Counting the pair proves a sentence
  // exists; only reading it against the threshold the node wrote down before
  // the run can show whether the run answered the question that was asked.
  // Printed, never compared — the comparison is the human's.
  const pairs = computeCoveragePairs(tree);
  if (pairs.length > 0) {
    lines.push(`\nBounded — what each test asked for, and what its runs left out:`);
    for (const p of pairs) {
      lines.push(`  ${p.title}`);
      lines.push(`      asked:     ${p.asked ?? "(no pre-committed threshold written in this node)"}`);
      const [first, ...rest] = p.uncovered;
      lines.push(`      uncovered: ${first ?? "(nothing stated)"}`);
      for (const more of rest) lines.push(`                 ${more}`);
    }
    const unasked = pairs.filter((p) => p.asked === null).length;
    if (unasked > 0) {
      lines.push(
        `  ${unasked} of these stated a limit against no written threshold — there is nothing to read it against.`,
      );
    }
  }

  // Every test's threshold, whether or not it has ever been run. The
  // side-by-side above only reaches tests with results; this reaches the
  // backlog, where a threshold that was never fixed is still cheap to fix.
  const census = computeUnfixedThresholds(tree);
  const u = census.totals;
  if (u.tests > 0) {
    lines.push(
      `\nThresholds: ${u.tests} assumption test(s)  (fixed ${u.bound}, ` +
        `stated in words ${u.prose}, still an instruction ${u.instruction}, none written ${u.absent})`,
    );
    for (const r of census.unfixed) {
      lines.push(`  [${r.kind === "absent" ? "no threshold" : "not fixed"}] ${r.title}`);
      if (r.asked !== null) lines.push(`      reads: ${r.asked}`);
    }
    if (census.unfixed.length > 0) {
      lines.push("  a test whose threshold was never fixed cannot come out a failure.");
    }
  }

  lines.push(
    "\nMechanical only: this counts whether ANY assumption beneath a solution recorded a result,\n" +
      "and whether each result was paired with a written statement of what it left untested.\n" +
      "The side-by-side above is printed, not judged: whether the RIGHT (riskiest) assumption was\n" +
      "tested, and whether the run actually answered the threshold next to it, is a human call.\n" +
      "The threshold reading is shallower still — it asks whether a bar was written, never whether\n" +
      "the bar is the right one, and it will be wrong at the edges. It flags; it never refuses.",
  );
  return lines.join("\n");
}

export function renderGate(tree: OstNode[], solution: string): { text: string; cleared: boolean } {
  const verdict = gateSolution(tree, solution);
  if (verdict.cleared) {
    return { text: `gate: CLEARED — ${verdict.reason}`, cleared: true };
  }
  return { text: `gate: BLOCKED — ${verdict.reason}`, cleared: false };
}

export function renderStatus(ctx: PassContext): string {
  const lines: string[] = [];
  const tree = ctx.vault.readTree();
  const byLayer = (l: string) => tree.filter((n) => n.layer === l).length;
  const unvalidated = tree.filter((n) => n.status === "unvalidated").length;
  lines.push(`Vault: ${ctx.dir}`);
  lines.push(`Outcome: ${ctx.config.outcome}`);
  lines.push(`Nodes: ${tree.length}  (Outcome ${byLayer("Outcome")}, Opportunity ${byLayer("Opportunity")}, Solution ${byLayer("Solution")}, AssumptionTest ${byLayer("AssumptionTest")})`);
  lines.push(`Unvalidated (agent-ideated, awaiting review): ${unvalidated}`);
  const rollup = believabilityRollup(tree);
  const perRung = BELIEVABILITY_LADDER.map((r) => `${r.id} ${rollup.counts[r.id]}`).join(", ");
  lines.push(`Believability: ${perRung}${rollup.unlabelled ? `, unlabelled ${rollup.unlabelled}` : ""}`);
  lines.push(`  the tree as a whole rests on its weakest rung: ${rollup.weakest}`);
  const coverage = computeCoverageDebt(tree);
  if (coverage.totals.withResults > 0) {
    lines.push(
      `Coverage: ${coverage.totals.bounded}/${coverage.totals.withResults} recorded result(s) say what they do not cover`,
    );
    for (const g of coverage.gaps) {
      lines.push(`  unbounded: ${g.title} (${g.claimed} result(s), ${g.stated} stated limit(s)) — see \`debt\``);
    }
  }
  // One line, and only when there is something to say. A test whose threshold
  // is still an instruction to pick one cannot come out a failure, and that is
  // worth seeing next to the tree's shape rather than only on demand.
  const thresholds = computeUnfixedThresholds(tree);
  if (thresholds.unfixed.length > 0) {
    const { instruction, absent, tests } = thresholds.totals;
    lines.push(
      `Thresholds: ${instruction + absent}/${tests} assumption test(s) have no fixed bar ` +
        `(${instruction} still an instruction, ${absent} unwritten) — see \`debt\``,
    );
  }
  return lines.join("\n");
}
