/**
 * The analysis renderers: one source of wording for four surfaces' worth of
 * output. The CLI prints what these return; the MCP tools return it verbatim.
 *
 * These print nothing and exit nothing. `check` and `gate` hand back the fact
 * the CLI turns into an exit code, because an MCP tool has no exit code and
 * the text has to carry the verdict either way.
 */
import { checkInvariants } from "./invariants.js";
import { computeAttention, weightedTokenCost } from "./attention.js";
import { computeEvidenceDebt, gateSolution } from "./evidence-debt.js";
import { computeCoverageDebt, computeCoveragePairs, computeUnfixedThresholds } from "./coverage.js";
import { BELIEVABILITY_LADDER, believabilityRollup } from "../knowledge/believability.js";
import type { PassContext } from "../processes/types.js";
import { LAYERS, type OstNode } from "../ost/node.js";
import { formatCensus, type TreeCensus } from "../ost/census.js";

/**
 * Append the census whenever the walk declined anything, so a count that shrank
 * silently cannot read as health. Nothing is printed when nothing was dropped —
 * the denominator only needs saying when it differs from what a reader assumes.
 */
function appendCensus(lines: string[], census: TreeCensus, coda?: string): void {
  const dropped = census.skipped.length + census.unreadable.length;
  const unseen = census.independent?.unseenByWalk.length ?? 0;
  if (dropped === 0 && unseen === 0) return;
  lines.push(formatCensus(census, census.nodes.length));
  if (coda) lines.push(coda);
}

export function renderCheck(census: TreeCensus): { text: string; violations: number } {
  const lines: string[] = [];
  const violations = checkInvariants(census.nodes);
  if (violations.length === 0) {
    // "0 violations" over an unstated denominator is the shape of a check that
    // passed because it looked at nothing. State what was checked.
    lines.push(`invariants: PASS (0 violations over ${census.nodes.length} node(s))`);
  } else {
    lines.push(`invariants: FAIL (${violations.length} violation(s) over ${census.nodes.length} node(s))`);
    for (const v of violations) lines.push(`  ✗ [${v.rule}] ${v.node ? `"${v.node}": ` : ""}${v.detail}`);
  }
  appendCensus(
    lines,
    census,
    "  A node the reader never returned cannot violate an invariant. The verdict\n" +
      "  above covers the nodes in this denominator and no others.",
  );
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

/**
 * Weighted cost is a ratio, not currency, and prints like one: whole when it is
 * whole, one decimal otherwise. A float tail like 62.550000000000004 in a status
 * line reads as precision the number does not have.
 */
function formatCost(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * What darkness cost, and what it bought — the one place the attention ledger
 * reaches a human. The layer breakdown above already counts unknowns; this says
 * what was spent on them, which is the number that decides where to look next.
 *
 * Three things beyond the per-class counts are load-bearing. **Weighted cost**
 * is priced with the genome's weightedTokenSpend gene, at read time, so the cost model
 * stays an allele rather than a constant. **Unattributed share** is reported
 * because a variant that cannot say what it spent attention on is measurably
 * worse (design, "Error handling") — the denominator is every recorded call,
 * attributed or not; a call naming a title no longer on the tree falls out of
 * both halves under `attribution.staleAttribution: drop`, because crediting it
 * to a node that does not exist would be a fabrication. **Cost basis** is
 * printed because a rollup priced in calls-and-ms and one priced in tokens are
 * not comparable, and a comparison that mixes them must be refusable rather
 * than silently normalized.
 *
 * Nothing is printed when there is no darkness. The guard reads the tree rather
 * than the rollup so an unknown-free vault does not even open the usage log:
 * silence here is the regression contract, and the cheapest way to keep a
 * contract is to do no work that could break it.
 */
function appendAttention(lines: string[], ctx: PassContext, tree: readonly OstNode[]): void {
  if (!tree.some((n) => n.layer === "Unknown")) return;

  const rollup = computeAttention(tree, ctx.dir, {
    weightedTokenSpend: ctx.genome.weightedTokenSpend,
    classifier: ctx.genome.classifier,
    resolution: ctx.genome.resolution,
    attribution: ctx.genome.attribution,
    costBasis: ctx.genome.tokenSplit.costBasis,
  });

  let satisfied = 0;
  let abandoned = 0;
  let open = 0;
  for (const bucket of Object.values(rollup.byClass)) {
    satisfied += bucket.satisfied;
    abandoned += bucket.abandoned;
    open += bucket.open;
  }
  lines.push(
    `Attention: ${rollup.unknowns.length} unknown(s) — satisfied ${satisfied}, abandoned ${abandoned}, open ${open}`,
  );

  // Class order comes from the genome's vocabulary, not from insertion; a class
  // nothing carries has nothing to say, so it gets no line.
  for (const [klass, bucket] of Object.entries(rollup.byClass)) {
    if (bucket.count === 0) continue;
    lines.push(
      `  ${klass}: ${bucket.count} unknown(s) (satisfied ${bucket.satisfied}, abandoned ${bucket.abandoned}, ` +
        `open ${bucket.open}) — weighted cost ${formatCost(bucket.weightedCost)}`,
    );
  }

  const attributed = rollup.unknowns.reduce((n, u) => n + u.calls, 0);
  const recorded = attributed + rollup.unattributed.calls;
  if (recorded > 0) {
    const share = Math.round((rollup.unattributed.calls / recorded) * 100);
    const stray = weightedTokenCost(rollup.unattributed.tokens, ctx.genome.weightedTokenSpend);
    lines.push(
      `  unattributed: ${rollup.unattributed.calls}/${recorded} recorded call(s) (${share}%) named no unknown` +
        (stray > 0 ? `, weighted cost ${formatCost(stray)}` : ""),
    );
    lines.push("  a variant that cannot say what it spent attention on is measurably worse.");
  }

  lines.push(
    `  cost basis: ${rollup.costBasis}` +
      (rollup.costBasis === "tokens"
        ? ""
        : " — no token data; a comparison against a token-based rollup is refused, never normalized"),
  );
}

export function renderStatus(ctx: PassContext, census: TreeCensus): string {
  const lines: string[] = [];
  const tree = census.nodes;
  const byLayer = (l: string) => tree.filter((n) => n.layer === l).length;
  const unvalidated = tree.filter((n) => n.status === "unvalidated").length;
  lines.push(`Vault: ${ctx.dir}`);
  lines.push(`Outcome: ${ctx.config.outcome}`);
  // Derived from LAYERS rather than hand-listed, so a layer added to the model
  // shows up here automatically instead of silently dropping out of a total the
  // parenthesized counts are supposed to sum to.
  const breakdown = LAYERS.map((l) => `${l} ${byLayer(l)}`).join(", ");
  lines.push(`Nodes: ${tree.length}  (${breakdown})`);
  // Every number above this line is taken over the set the walk returned. This
  // says what that set was, so a count that shrank silently cannot read as health.
  appendCensus(lines, census);
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
  // Last, and appended rather than interleaved: every line above keeps the
  // position it had before darkness was priced, so "a vault with no unknowns
  // renders what it always did" is checkable by reading rather than diffing.
  appendAttention(lines, ctx, tree);
  return lines.join("\n");
}
