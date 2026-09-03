/**
 * The analysis renderers: one source of wording for four surfaces' worth of
 * output. The CLI prints what these return; the MCP tools return it verbatim.
 *
 * These print nothing and exit nothing. `check` and `gate` hand back the fact
 * the CLI turns into an exit code, because an MCP tool has no exit code and
 * the text has to carry the verdict either way.
 *
 * Every list here is capped (Z2). The rule is the one `openUnknowns` already
 * used and this file repeats four times: **cap what is displayed, compute every
 * verdict and every count over the full set, and name the hidden count.** A cap
 * that moved a verdict, or that shortened a list without saying so, would read
 * as amnesty — "that is all there is" — and `ost_check` is a hard gate and a
 * mandatory human interrupt, so that reading is the expensive one.
 */
import { checkInvariants, type Violation } from "./invariants.js";
import { computeAttention, weightedTokenCost } from "./attention.js";
import { computeEvidenceDebt, gateSolution } from "./evidence-debt.js";
import { solutionsMissingInstruments } from "./buildable.js";
import { computeCoverageDebt, computeCoveragePairs, computeUnfixedThresholds } from "./coverage.js";
import { BELIEVABILITY_LADDER, believabilityRollup } from "../knowledge/believability.js";
import { COMPRESSION_SURFACES } from "../compression/registry.js";
import type { PassContext } from "../processes/types.js";
import { LAYERS, type OstNode } from "../ost/node.js";
import { sightCensus } from "../ost/instrument.js";
import { formatCensus, SUSPECT_SOURCE_RULE, type TreeCensus } from "../ost/census.js";
import { formatDeclaredRuleset, type RulesetResolution } from "../ost/declared-ruleset.js";

/**
 * How many items any one list in a rendered analysis may show.
 *
 * Deliberately the same 25 `ost_next_work` uses (`MAX_ITEMS_PER_LIST` in
 * `src/mcp/next-work.ts`), and deliberately not imported from there: `eval/`
 * does not depend on `mcp/`, and inverting that to share a small integer would
 * buy consistency at the price of the layering. The number matching matters
 * because a reader moving between `ost_next_work` and `ost_check` should not
 * have to learn two window sizes.
 */
export const MAX_ITEMS_PER_LIST = 25;

/**
 * The stated budget: no analysis render exceeds this, on any vault.
 *
 * Measured against the criterion's 200 KB with room to spare, because these
 * strings do not travel alone — an MCP tool result is JSON, where every newline
 * and quote in the text costs two bytes rather than one, and `/ost-pass` puts
 * `ost_status`, `ost_check` and `ost_next_work` into the same context in the
 * same turn. A third of the ceiling each is the headroom that makes that safe.
 */
export const RENDER_BUDGET_BYTES = 48 * 1024;

/**
 * Of the budget above, how much the *detail* lines may spend.
 *
 * A per-list item cap alone does not bound a render, which is why this exists as
 * well and not instead. Titles run to 200 characters (`ost/sanitize.ts`) and an
 * invariant's detail several hundred more, so ten rule classes at 25 items each
 * is already six figures of bytes on a vault built to be awkward. The item cap
 * keeps any one class from crowding out the others; this keeps their sum honest.
 *
 * That is not a hypothetical, and it needed saying with a measurement rather
 * than with this paragraph: on the 10,000-node fixture the item cap does ALL the
 * bounding — raising this to Infinity changes not one byte of any of the four
 * renders — so for a while the whole allowance could have been deleted with the
 * suite green. `test/eval/render-caps.test.ts` now measures two vaults where it
 * is the only thing keeping the render under budget: 30 bounded tests with 30
 * uncovered statements each (25 pairs × 25 statements × a 200-character
 * sentence is 190 KB), and a walk blind to 10,000 files, whose names
 * `formatCensus` joins into a single line.
 *
 * Headers, totals and the fixed prose are never charged against it. A count is
 * the thing that makes a short list readable as a window rather than as the
 * whole, so dropping one to save bytes would be the exact failure this budget
 * was introduced to prevent. Everything not charged here is O(1) or O(rule
 * vocabulary) — never O(tree) — which is what makes the remainder headroom.
 */
const DETAIL_BUDGET_BYTES = 32 * 1024;

/** A byte allowance shared by every detail list within one render. */
interface Budget {
  /** Charge these lines. `false` means the allowance is spent and they must be elided. */
  take(lines: readonly string[]): boolean;
}

function newBudget(cap = DETAIL_BUDGET_BYTES): Budget {
  let spent = 0;
  return {
    take(lines) {
      // Bytes, not `.length`: `✗` and `…` are three UTF-8 bytes each and a title
      // may be any script at all, so code units would under-count exactly the
      // vaults this bound exists for. The +1 is the newline `join` will add.
      let cost = 0;
      for (const l of lines) cost += Buffer.byteLength(l) + 1;
      if (spent + cost > cap) return false;
      spent += cost;
      return true;
    },
  };
}

/**
 * Append a bounded sample of `items`, then — only when something was left out —
 * one line naming exactly how many.
 *
 * Returns the number hidden, so a caller can decide whether the render owes the
 * reader the coda that explains how to reach the rest.
 */
function appendSample<T>(
  out: string[],
  items: readonly T[],
  toLines: (item: T) => readonly string[],
  opts: { budget: Budget; what: string; indent?: string; limit?: number },
): number {
  const limit = opts.limit ?? MAX_ITEMS_PER_LIST;
  let shown = 0;
  for (const item of items) {
    if (shown >= limit) break;
    const rendered = toLines(item);
    // A line the allowance cannot afford stops the list rather than being
    // skipped over: showing items 1, 2 and 47 would misrepresent the sample as
    // a selection when it is a prefix.
    if (!opts.budget.take(rendered)) break;
    out.push(...rendered);
    shown++;
  }
  const hidden = items.length - shown;
  if (hidden > 0) {
    out.push(`${opts.indent ?? "  "}… ${hidden} more ${opts.what} not listed (showing ${shown} of ${items.length}).`);
  }
  return hidden;
}

/**
 * The sentence a render owes the reader once it has shortened anything.
 *
 * Two jobs, and the second is the one Z2 names. It repeats that the numbers
 * above are over the full set — a per-list "N more not listed" says what was
 * hidden but not that the verdict already counted it. And it says how to see the
 * rest, or says plainly that there is no way to, because an elision note that
 * leaves the reader guessing is only marginally better than no note.
 */
function appendElisionCoda(lines: string[], hidden: number, howToSeeTheRest: string): void {
  if (hidden === 0) return;
  lines.push(
    `  Nothing was cleared by being hidden: every verdict and every count above is\n` +
      `  computed over the full set, and only the listing was shortened. ${howToSeeTheRest}`,
  );
}

/**
 * Append the census whenever the walk declined anything, so a count that shrank
 * silently cannot read as health. Nothing is printed when nothing was dropped —
 * the denominator only needs saying when it differs from what a reader assumes.
 *
 * The census block is rendered by `ost/census.ts` and then shortened here, which
 * is the only place it can be shortened without lying: `formatCensus` derives
 * "N dropped" from the array lengths, so handing it pre-capped arrays would
 * corrupt the very number the block exists to carry. Instead its first line —
 * the one holding the denominator and the dropped count — is emitted
 * unconditionally, the per-file lines beneath it are sampled, and the counts
 * those lines would have carried (retired, and files an independent index saw
 * that the walk did not) are restated on the elision line.
 *
 * The block's lines are not equally important and `formatCensus` emits the
 * severe ones LAST, so they get their own window ahead of the routine ones. A
 * "dropped stray-note-13.md: not an OST node" line is a file nobody turned into
 * a node; the independent-denominator lines are the walk reporting that it is
 * blind — "every count in this vault is short by at least that much", a finding
 * no invariant can reach. Sampling the block as one list let sixty of the former
 * push the latter out of the render entirely, which is Z2's amnesty failure
 * wearing the census's clothes: the reader is shown sixty harmless files and not
 * the one that says the denominator is wrong.
 */
function appendCensus(lines: string[], census: TreeCensus, budget: Budget, coda?: string): number {
  const dropped = census.skipped.length + census.unreadable.length;
  const unseen = census.independent?.unseenByWalk.length ?? 0;
  // `retired` counts toward "is there anything to say", and leaving it out was a
  // silence with the census's own name on it: a node that left the live tree is
  // exactly a count that shrank on purpose, and `formatCensus` emits the line
  // naming it — this function just never asked for it unless some OTHER kind of
  // drop happened to be present too. So an archived node, and now a retracted
  // one, was withheld from every number above and named on no surface a human
  // reads. Withheld AND named is the whole rule (see `ARCHIVE_DIRNAME`).
  // Quarantine counts toward "is there anything to say" for a stronger version
  // of the reason `retired` does: a retired node left the denominator because
  // somebody meant it to, and a quarantined one left because this reader could
  // not classify it. Withholding that from `ost_check` is the original silence —
  // a whole branch dark, and a PASS line over a denominator that never mentions
  // it.
  if (dropped === 0 && unseen === 0 && census.retired.length === 0 && census.quarantined.length === 0) return 0;
  const [header, ...detail] = formatCensus(census, census.nodes.length).split("\n");
  lines.push(header);

  // Located by content, not by counting lines off the end: how many lines that
  // block occupies is `formatCensus`'s business and changes the moment it grows
  // a sentence. A miss here degrades to the old behaviour rather than to a
  // wrong number, and the test below measures the alarm's presence on a census
  // with more drops than the cap, which turns that drift into a red build.
  const source = census.independent?.source;
  const alarmAt = unseen > 0 && source ? detail.findIndex((l) => l.includes(`${source} tracks `)) : -1;
  const alarm = alarmAt >= 0 ? detail.slice(alarmAt) : [];
  const drops = alarmAt >= 0 ? detail.slice(0, alarmAt) : detail;

  let hidden = 0;
  if (alarm.length > 0) {
    // Charged as one block, because half of this sentence is worse than none —
    // and charged at all because `unseenByWalk` is joined into a single line, so
    // this is the only thing standing between a walk blind to ten thousand files
    // and a render that spends its whole allowance naming them. When it will not
    // fit, the *fact* still ships and only the names are dropped: an alarm that
    // can be elided by being too alarming is not an alarm.
    if (budget.take(alarm)) {
      lines.push(...alarm);
    } else {
      hidden += 1;
      lines.push(
        `  ✗ ${source} tracks ${unseen} markdown file(s) this walk never enumerated — too many to name here.\n` +
          `    Every count above is short by at least that much. This is not a tree problem —\n` +
          `    it is the reader failing to read, and no invariant will catch it.`,
      );
    }
  }

  hidden += appendSample(lines, drops, (l) => [l], {
    budget,
    limit: MAX_ITEMS_PER_LIST,
    what:
      `census line(s) — the full counts are ${dropped} file(s) dropped, ` +
      `${census.retired.length} retired, ${unseen} tracked by an independent index but never walked`,
  });
  if (coda) lines.push(coda);
  return hidden;
}

/**
 * The trace's finding, rendered in the same shape as an invariant's and counted with
 * them — a red `ost_check` and a non-zero CLI exit.
 *
 * It is deliberately NOT a rule in `src/eval/invariants.ts`, and that placement is the
 * whole design rather than an accident of where the data lives. `checkInvariants` is
 * model-independent structure over a node list; this is a claim about the world outside
 * the list, computed from a file. Putting it there would also make it a `done`-blocker
 * through `detectHygiene`'s derivation (R4), and no tool on the surface can delete a
 * node file — so the unattended sweep would wedge forever on a defect it cannot touch.
 * A node file nobody asked for is exactly the mandatory human interrupt `single-outcome`
 * already is, and for the same reason.
 */
function appendUnexplained(lines: string[], census: TreeCensus, budget: Budget): { count: number; hidden: number } {
  const found = census.unexplained;
  if (!found || found.unexplained.length === 0) return { count: 0, hidden: 0 };
  // The count comes off the full array and is printed before anything is
  // sampled, so the FAIL line is the same line whether or not the list below it
  // was shortened.
  lines.push(`provenance: FAIL (${found.unexplained.length} node file(s) no tool invocation explains)`);
  const hidden = appendSample(
    lines,
    found.unexplained,
    (file) => [`  ✗ [unexplained-node] "${file}": on disk, created by nothing the trace recorded`],
    { budget, what: "unexplained node file(s)" },
  );
  lines.push(
    `  Basis: ${found.basis} — the record written before each file existed, by the code\n` +
      "  path that asked for it. Every mutating call runs `git add -A`, so the commit\n" +
      "  trail cannot tell you this: an out-of-band write acquires a commit message\n" +
      "  naming an allowlisted tool. Open the file, confirm it belongs, and re-create it\n" +
      "  through the tool surface — or delete it. No tool here can do either for you.",
  );
  return { count: found.unexplained.length, hidden };
}

/**
 * Every node resting on a source whose standing was withdrawn — named, and
 * deliberately **not counted as a violation** (B11).
 *
 * The criterion asks that `ost_check` *name* every node whose `source` is the
 * demoted source. Naming and failing are different things, and the difference is
 * the whole safety argument here.
 *
 * **Why this does not turn the check red.** A node citing a demoted source is not
 * malformed; it is well-formed and now less believable, which is a fact for a
 * human to weigh rather than a defect anything can repair. And nothing on the
 * tool surface *can* repair it: a vault is append-only, so a node's `source`
 * cannot be rewritten, `ost_rank_source` is not granted to the unattended sweep at
 * all, and a strike is not undone by any tool — the ledger clears one only through
 * `ost-agent trust reset`, a human-only CLI path. A red `ost_check` here would
 * therefore be a permanent red
 * with no way out but a human on a shell — R2's stopping state — and it would be
 * *caused by the agent doing the right thing*, which is the incentive DEC-2 least
 * wants to invert: a demotion that makes the tree red is a demotion the agent
 * learns not to record. Silence is the failure mode everyone plans for; a channel
 * that keeps delivering plausible, wrong content on cadence is the one that costs
 * money, and it is only ever caught by a cheap demotion.
 *
 * The consequence lives on the other gate instead, where it has a way out:
 * `ost_next_work` reports the same finding as a hygiene issue, so it blocks `done`
 * until the sweep annotates each affected node — one call per node, the same
 * escape every other hygiene issue has. That is stricter-than-`check`, which is
 * the safe direction R4 allows: a stricter `done` never reports complete over a
 * red tree.
 *
 * Both the source list and each source's node list are capped, and the headers are
 * charged to the byte allowance rather than exempted, because the number of
 * withdrawn sources is bounded by the ledger — a file the agent appends to — and
 * not by the tree. An uncharged per-source header would let ten thousand
 * withdrawals spend the whole render.
 */
function appendStanding(lines: string[], census: TreeCensus, budget: Budget): number {
  const standing = census.standing;
  if (!standing) return 0;
  // A line that could not be parsed is reported even when nothing is withdrawn,
  // and this is the one place the order matters: skipping a corrupt `strike` fails
  // OPEN — the source keeps standing somebody took away, and this whole section
  // goes quiet about it. "0 withdrawn" read off a partly unreadable file is the
  // silence B11 exists to break, so the caveat prints above the verdict.
  if (standing.damaged > 0) {
    lines.push(
      `sources: ${standing.damaged} unreadable line(s) in ${standing.basis} — a lost strike reads here as` +
        ` a source that was never doubted. The list below is a lower bound.`,
    );
  }
  if (standing.withdrawn.length === 0) return 0;
  // Counts off the full arrays and printed before anything is sampled, so this
  // line reads the same whether or not the lists below it were shortened.
  lines.push(
    `sources: WITHDRAWN (${standing.nodes} node(s) rest on ${standing.withdrawn.length} source(s) whose standing was withdrawn)`,
  );

  let hidden = 0;
  let shownSources = 0;
  for (const w of standing.withdrawn) {
    if (shownSources >= MAX_ITEMS_PER_LIST) break;
    // `was 'x', now 'y'` rather than `x → y`, because the two are often the same
    // rung and an arrow between equal words reads as a bug. A source struck before
    // it ever earned anything is still a source somebody withdrew trust from —
    // that is the transition, and the rungs are the detail.
    const header = [
      `  [${SUSPECT_SOURCE_RULE}] ${w.key}: standing withdrawn ${w.at} (${w.why}) — ${w.reason}` +
        ` [was '${w.from}', now '${w.to}'; ${w.nodes.length} node(s) cite it]`,
    ];
    if (!budget.take(header)) break;
    lines.push(...header);
    shownSources++;
    hidden += appendSample(lines, w.nodes, (title) => [`    ✗ "${title}": cites ${w.key}, whose standing was withdrawn`], {
      budget,
      what: `node(s) citing ${w.key}`,
      indent: "    ",
    });
  }
  const hiddenSources = standing.withdrawn.length - shownSources;
  if (hiddenSources > 0) {
    hidden += hiddenSources;
    lines.push(
      `  … ${hiddenSources} more withdrawn source(s) not listed (showing ${shownSources} of ${standing.withdrawn.length}).`,
    );
  }

  lines.push(
    `  Basis: ${standing.basis} — the append-only trust ledger. This section names; it does not\n` +
      "  fail. The nodes above are well-formed and the count in the verdict line does not include\n" +
      "  them: nothing on this surface can rewrite a node's source, so failing here would be a red\n" +
      "  only a human could retire — earned by demoting a bad source, which must stay cheap.\n" +
      "  Re-read what each node claims. No tool call clears this: a strike stands until a human runs\n" +
      "  `ost-agent trust reset`, and a later corroboration does NOT undo one. `ost_next_work` reports\n" +
      "  the same nodes as work, where annotating each one records the doubt on the node — that is the\n" +
      "  only clear reachable from this surface, and it clears the report, not the strike.\n" +
      "  Scope: nodes whose OWN `source` names the withdrawn source. Nodes merely linked beneath\n" +
      "  one are NOT listed — that is a larger claim than this computes.",
  );
  return hidden;
}

/**
 * Violations, grouped by rule and capped **within** each rule.
 *
 * A flat cap over the whole list is the amnesty failure in a subtler form, and
 * the measured data shape is what makes that concrete rather than theoretical:
 * on the 10,000-node fixture in `test/eval/render-caps.test.ts` the 11,939
 * violations are 8,438 `rung-unearned`, 3,500 `assumption-mapped` and one
 * `solution-mapped` — and `checkInvariants` emits the last two FIRST. Twenty-five
 * lines off the front of a flat list are therefore one `solution-mapped` and 24
 * `assumption-mapped`, and a reader would close a red `ost_check` never having
 * been shown that the rule broken most often is broken at all: the largest class
 * in the vault, hidden behind the two that happen to come first. Per rule, every
 * class that fired gets a header carrying its own full count.
 *
 * The header is pushed BEFORE the sample and is never charged to the allowance,
 * which is what makes "capped" different from "gone" for a class the byte
 * allowance never reaches: it still prints its own total and an elision saying
 * `showing 0 of 40`. Emitting it lazily, beside the first item that fits, is the
 * natural way to write this and loses the class entirely — pinned.
 *
 * Rules appear in the order `checkInvariants` first emitted them and each group
 * keeps its own emission order, so this is a regrouping of the old flat list
 * rather than a re-sort of it.
 */
function appendViolationsByRule(lines: string[], violations: readonly Violation[], budget: Budget): number {
  const byRule = new Map<string, Violation[]>();
  for (const v of violations) {
    const group = byRule.get(v.rule);
    if (group) group.push(v);
    else byRule.set(v.rule, [v]);
  }
  let hidden = 0;
  for (const [rule, group] of byRule) {
    lines.push(`  [${rule}] ${group.length} violation(s):`);
    hidden += appendSample(
      lines,
      group,
      (v) => [`  ✗ [${v.rule}] ${v.node ? `"${v.node}": ` : ""}${v.detail}`],
      { budget, what: `[${rule}] violation(s)`, indent: "    " },
    );
  }
  return hidden;
}

/**
 * @param ruleset Which check ruleset this vault declared. Omitted, the report is
 * against the latest — the same answer every caller got before the ruleset was
 * versioned. Supplied, the version is printed ABOVE the verdict, because a clean
 * `check` says nothing until a reader is told which standard produced it.
 */
export function renderCheck(census: TreeCensus, ruleset?: RulesetResolution): { text: string; violations: number } {
  const lines: string[] = [];
  const budget = newBudget();
  let hidden = 0;
  if (ruleset) {
    lines.push(formatDeclaredRuleset(ruleset));
    lines.push("");
  }
  const violations = checkInvariants(census.nodes, census.quarantined, { ruleset: ruleset?.version });
  if (violations.length === 0) {
    // "0 violations" over an unstated denominator is the shape of a check that
    // passed because it looked at nothing. State what was checked.
    lines.push(`invariants: PASS (0 violations over ${census.nodes.length} node(s))`);
  } else {
    lines.push(`invariants: FAIL (${violations.length} violation(s) over ${census.nodes.length} node(s))`);
    hidden += appendViolationsByRule(lines, violations, budget);
  }
  const unexplained = appendUnexplained(lines, census, budget);
  hidden += unexplained.hidden;
  // After the two findings that DO fail, before the census. It never contributes
  // to `violations` below — see the function's comment for the whole argument.
  hidden += appendStanding(lines, census, budget);
  hidden += appendCensus(
    lines,
    census,
    budget,
    "  A node the reader never returned cannot violate an invariant. The verdict\n" +
      "  above covers the nodes in this denominator and no others.",
  );
  // The verdict is taken from the full arrays, above and before any sampling —
  // which is the whole point. `violations.length` is not `lines.length`, and a
  // reader (or the CLI's exit code) asking whether this run is red gets the same
  // answer at 10 nodes and at 10,000.
  appendElisionCoda(
    lines,
    hidden,
    "There is no offset to page to: fix or annotate what is listed and re-run\n" +
      "  `ost_check`, which recomputes from scratch and surfaces the next batch. Per-rule\n" +
      "  counts above are the true sizes; `ost_next_work` names the same issues as work.",
  );
  return { text: lines.join("\n"), violations: violations.length + unexplained.count };
}

/** The order the debt states are worth reading in — worst first, and fixed so a cap cannot reorder it. */
const DEBT_STATES = ["untested", "proposed", "tested"] as const;

export function renderDebt(tree: OstNode[]): string {
  const lines: string[] = [];
  const budget = newBudget();
  let hidden = 0;
  const debt = computeEvidenceDebt(tree);
  const t = debt.totals;
  // The instrument count rides on this line rather than getting its own section
  // because it is the same question the rest of the line answers — what a
  // solution owes before anyone builds it — and because the build loop reads it
  // from here. A second place to compute it is a second place for it to be wrong.
  const proseOnly = solutionsMissingInstruments(tree).length;
  lines.push(
    `Solutions: ${t.solutions}  (untested ${t.untested}, proposed-only ${t.proposed}, tested ${t.tested}` +
      `; ${proseOnly} with tests that are prose only)`,
  );
  // Grounded and blind as separate figures, because as one figure they were
  // the same string in the same field: a reader deciding whether 61 red
  // instruments are progress or laundering needs to know how many were written
  // by a pass that could see the repository at all. Unlabelled is the honest
  // third column — provenance nobody recorded is not either verdict.
  const sight = sightCensus(tree);
  if (sight.total > 0) {
    lines.push(
      `Instruments: ${sight.total}  (grounded ${sight.grounded}, blind ${sight.blind}, ` +
        `unlabelled ${sight.unlabelled} — written before sight was recorded)`,
    );
  }
  // Grouped by state and capped within each, for the same reason `ost_check`
  // groups by rule: on any real vault the `tested` solutions outnumber the
  // untested ones, and a flat cap would spend the whole window on the solutions
  // that are fine while never showing one that has no assumption test at all.
  // The totals line above is unaffected either way — it is computed before this.
  for (const state of DEBT_STATES) {
    const group = debt.solutions.filter((s) => s.state === state);
    if (group.length === 0) continue;
    hidden += appendSample(
      lines,
      group,
      (s) => {
        const detail =
          s.state === "tested"
            ? `${s.testsRun}/${s.testsProposed} test(s) with results`
            : s.state === "proposed"
              ? `${s.testsProposed} proposed, none run`
              : "no assumption test";
        return [`  [${s.state}] ${s.title} — ${detail}`];
      },
      { budget, what: `[${state}] solution(s)`, indent: "    " },
    );
  }
  const coverage = computeCoverageDebt(tree);
  const c = coverage.totals;
  lines.push(
    `\nCoverage: ${c.withResults} test(s) with results  (bounded ${c.bounded}, unbounded ${c.unbounded})`,
  );
  hidden += appendSample(
    lines,
    coverage.gaps,
    (g) => {
      const detail =
        g.stated === 0
          ? `${g.claimed} result(s), none saying what they fail to cover`
          : `${g.claimed} result(s) against ${g.stated} uncovered statement(s)`;
      return [`  [unbounded] ${g.title} — ${detail}`];
    },
    { budget, what: "unbounded test(s)" },
  );
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
    hidden += appendSample(
      lines,
      pairs,
      (p) => {
        const block = [`  ${p.title}`, `      asked:     ${p.asked ?? "(no pre-committed threshold written in this node)"}`];
        // One node's `## Uncovered` list is itself unbounded, so a cap on the
        // number of pairs would not bound this section on its own — one test
        // with ten thousand uncovered statements is the same defect one level in.
        const [first, ...rest] = p.uncovered.slice(0, MAX_ITEMS_PER_LIST);
        block.push(`      uncovered: ${first ?? "(nothing stated)"}`);
        for (const more of rest) block.push(`                 ${more}`);
        const over = p.uncovered.length - Math.min(p.uncovered.length, MAX_ITEMS_PER_LIST);
        if (over > 0) {
          block.push(`                 … ${over} more statement(s) not listed (this test states ${p.uncovered.length}).`);
        }
        return block;
      },
      { budget, what: "bounded test(s)" },
    );
    // Taken over every pair, never over the sample: a threshold nobody wrote is
    // exactly the finding a display cap must not be able to retire.
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
    // Split by kind before capping. "Never written down" and "written, but still
    // an instruction to pick a number" are different amounts of work, and a flat
    // cap lets the more numerous kind hide the other one entirely.
    for (const kind of ["absent", "instruction"] as const) {
      const group = census.unfixed.filter((r) => r.kind === kind);
      if (group.length === 0) continue;
      hidden += appendSample(
        lines,
        group,
        (r) => {
          const block = [`  [${r.kind === "absent" ? "no threshold" : "not fixed"}] ${r.title}`];
          if (r.asked !== null) block.push(`      reads: ${r.asked}`);
          return block;
        },
        { budget, what: `${kind === "absent" ? "no threshold" : "not fixed"} test(s)`, indent: "    " },
      );
    }
    if (census.unfixed.length > 0) {
      lines.push("  a test whose threshold was never fixed cannot come out a failure.");
    }
  }

  appendElisionCoda(
    lines,
    hidden,
    "Every total on the section headers above is over all of them. To see one\n" +
      "  solution's full detail name it to `ost_gate`; there is no offset to page to for\n" +
      "  the lists themselves — resolve what is listed and re-run `ost_debt`.",
  );

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

  /*
   * The one unbounded thing a gate verdict can say: the "proposed, none run"
   * refusal names every outstanding assumption test under the solution, and a
   * solution can carry any number of them.
   *
   * Shortened by finding the joined list at the end of the reason rather than by
   * rebuilding the sentence, so the wording stays owned by `gateSolution` and
   * cannot drift out of sync with a copy kept here. The trade is that this fails
   * *open*: if that function stops ending the reason with the join, the
   * `endsWith` misses and the render is unbounded again with nothing to say so.
   * `test/eval/render-caps.test.ts` measures a gate refusal with more
   * outstanding tests than the cap and asserts the byte budget, which is what
   * turns that drift into a red build instead of a silent regression.
   *
   * `cleared` is read above and never below. Capping a refusal's prose cannot
   * reach the verdict, which is the property that matters most here: this gate
   * is the one that decides whether work may start.
   */
  const outstanding = verdict.debt?.outstanding ?? [];
  const tail = outstanding.join("; ");
  if (outstanding.length > MAX_ITEMS_PER_LIST && verdict.reason.endsWith(tail)) {
    const shown = outstanding.slice(0, MAX_ITEMS_PER_LIST);
    const hidden = outstanding.length - shown.length;
    const head = verdict.reason.slice(0, verdict.reason.length - tail.length);
    return {
      text:
        `gate: BLOCKED — ${head}${shown.join("; ")} … and ${hidden} more not listed ` +
        `(showing ${shown.length} of ${outstanding.length}). The refusal counts all ` +
        `${outstanding.length}; every one of them is linked from this solution's node, so ` +
        `\`ost_read_tree\` names them.`,
      cleared: false,
    };
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
 *
 * Nothing here is capped and nothing here needs to be. Every line is a rollup —
 * one per unknown *class*, from the classifier's declared vocabulary — so this
 * section is O(classes) and does not grow with the tree. The unknowns
 * themselves are never listed here; `ost_next_work`'s `openUnknowns` is where
 * they are named, and that list is capped at its own source.
 */
function appendAttention(lines: string[], ctx: PassContext, tree: readonly OstNode[]): void {
  if (!tree.some((n) => n.layer === "Unknown")) return;

  const rollup = computeAttention(tree, ctx.dir, {
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
    const stray = weightedTokenCost(rollup.unattributed.tokens);
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
  const budget = newBudget();
  let hidden = 0;
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
  hidden += appendCensus(lines, census, budget);
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
    // The `bounded/withResults` line above is the summary; this is the naming,
    // and it is the only part of `ost_status` that grows one line per node. One
    // list of one kind, so there is nothing to group it by — a flat cap here
    // cannot hide a class of finding behind another class.
    hidden += appendSample(
      lines,
      coverage.gaps,
      (g) => [`  unbounded: ${g.title} (${g.claimed} result(s), ${g.stated} stated limit(s)) — see \`debt\``],
      { budget, what: "unbounded test(s)" },
    );
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
  // One line, only when instruments exist, and never charged to the budget:
  // the same figures `debt` breaks out, next to the tree's shape, so a stock
  // of instruments written blind is visible without asking for it.
  const sight = sightCensus(tree);
  if (sight.total > 0) {
    lines.push(
      `Sight: ${sight.grounded}/${sight.total} instrument(s) written with repo sight ` +
        `(blind ${sight.blind}, unlabelled ${sight.unlabelled}) — see \`debt\``,
    );
  }
  // The product's own compression posture, from the surface registry
  // (`src/compression/registry.ts`): how many bounded outputs are under a
  // declared contract, how many contracts a test actually drives, and how many
  // surfaces still clip without recording the loss. One line, all totals —
  // never charged to the budget, like every other total here.
  const silent = COMPRESSION_SURFACES.filter((s) => s.drops === "silent").length;
  const proven = COMPRESSION_SURFACES.filter((s) => s.proof === "behavioral").length;
  lines.push(
    `Compression: ${COMPRESSION_SURFACES.length} bounded surface(s) under contract ` +
      `(${proven} proven by test, ${COMPRESSION_SURFACES.length - proven} declared; ${silent} still clip silently)`,
  );
  appendElisionCoda(
    lines,
    hidden,
    "`ost_debt` names the coverage gaps in full (itself capped, and it says so);\n" +
      "  the census lines that were not shown are files in the vault directory, which no\n" +
      "  tool on this surface pages through.",
  );
  // Last, and appended rather than interleaved: every line above keeps the
  // position it had before darkness was priced, so "a vault with no unknowns
  // renders what it always did" is checkable by reading rather than diffing.
  appendAttention(lines, ctx, tree);
  return lines.join("\n");
}
