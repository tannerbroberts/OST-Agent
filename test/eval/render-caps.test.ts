/**
 * Z2, second half — the four analysis renders are capped, and name what they hid.
 *
 * `test/mcp/response-size.test.ts` pins `ost_next_work` and `ost_read_tree`. This
 * pins the other four tools on the surface, all of which render through
 * `src/eval/render.ts`: `ost_check`, `ost_status`, `ost_debt` and `ost_gate`.
 * Before the caps, the same 10,000-node fixture measured here produced a **3.8 MB**
 * `ost_check` (12,998 violations, one line each) and a **500 KB** `ost_debt` — not
 * an error, just an answer nobody and no model reads.
 *
 * Four properties, and the third is the load-bearing one:
 *
 *   1. Each render stays under `RENDER_BUDGET_BYTES` on a 10,000-node vault, and
 *      every shortened list names its hidden count.
 *   2. Violations are capped **within each rule**, not across a flat list. The
 *      control for this is not "a rule name appears" — it is that the first
 *      `MAX_ITEMS_PER_LIST` violations in emission order contain no
 *      `rung-unearned` at all, though 8,438 of the fixture's 11,939 violations
 *      are `rung-unearned`. A flat cap would hide the largest rule class behind
 *      the two that happen to be emitted first.
 *   3. **The cap changed no verdict and no count.** `ost_check` is a hard gate
 *      and a mandatory human interrupt; whether it is red, how many violations
 *      it found, and every total it prints are identical to the values computed
 *      over the full, uncapped data — checked against those primitives directly
 *      rather than read back out of the capped text.
 *   4. A small tree is not shortened at all, so property 1 cannot be satisfied
 *      by a renderer that simply truncates everything.
 *
 * Every assertion below has a non-vacuity control, named where it sits.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import {
  MAX_ITEMS_PER_LIST,
  RENDER_BUDGET_BYTES,
  renderCheck,
  renderDebt,
  renderGate,
  renderStatus,
} from "../../src/eval/render.js";
import { checkInvariants } from "../../src/eval/invariants.js";
import { computeEvidenceDebt, gateSolution } from "../../src/eval/evidence-debt.js";
import { solutionsMissingInstruments } from "../../src/eval/buildable.js";
import { computeCoverageDebt, computeCoveragePairs } from "../../src/eval/coverage.js";
import { promoteNode, recordResult } from "../../src/ost/results.js";
import { buildLargeTree, phraseFrom, seededRandom } from "../ost/fixture-vault.js";
import type { PassContext } from "../../src/processes/types.js";
import type { OstNode } from "../../src/ost/node.js";
import type { TreeCensus } from "../../src/ost/census.js";

const OUTCOME = "Retention";
const bytes = (s: string): number => Buffer.byteLength(s);

/**
 * The bulk of the fixture comes from `buildLargeTree`, deliberately — the Z2
 * size pin and the Z3 timing pin are only readable against each other if they
 * measure the same tree, and a third generator would break that.
 *
 * What is added on top is not a second tree; it is the three lists
 * `buildLargeTree` does not produce, each of which is unbounded in a renderer
 * this file is about. A fixture that leaves them empty would let all four byte
 * budgets pass while three of the four caps were dead code.
 */
const GATE_SOLUTION = "Ship the one solution every outstanding assumption test hangs from";

/** Long enough that 500 of them joined exceed the whole render budget — see the gate control. */
function longTestTitle(rnd: () => number, i: number): string {
  return `Test whether ${phraseFrom(rnd)} and also ${phraseFrom(rnd)} and further ${phraseFrom(rnd)} holds up under load gt${i}`;
}

function buildFixture(vault: PassContext["vault"], dir: string): void {
  buildLargeTree(vault, OUTCOME, { opportunities: 3998, solutions: 2000, assumptionTests: 1939 });
  const rnd = seededRandom(11);

  /*
   * Tests that count as having a result and never said what that result failed
   * to cover — `coverage.gaps`, one line each in BOTH `ost_debt` and
   * `ost_status`, and the only list in `ost_status` that grows with the tree.
   *
   * Built through `promoteNode` rather than by writing `## Results` into a body,
   * because the vault refuses to write that heading from a tool at all (B1) — a
   * heading the agent can author is a gate it can clear on its own authority.
   * A hand-validated test with nothing written down is exactly the unbounded
   * claim `coverageOf` describes, and it is reachable from the human path only,
   * which is why the fixture has to take that path too.
   */
  for (let i = 0; i < 1500; i++) {
    const title = `Test whether ${phraseFrom(rnd)} u${i}`;
    vault.createNode({ title, layer: "AssumptionTest", evidence: "observed", body: "b", tags: [], links: [] });
    promoteNode(dir, { node: title, by: "the fixture's human", why: "a run nobody wrote down" });
  }

  // Bounded tests — a pre-committed threshold plus a recorded result that stated
  // its limits. These are `computeCoveragePairs`, the multi-line section of
  // `ost_debt`. The first carries 200 uncovered statements on its own, because a
  // cap on the NUMBER of pairs does not bound a section in which one pair can be
  // arbitrarily tall.
  for (let i = 0; i < 61; i++) {
    const title = `Test whether ${phraseFrom(rnd)} b${i}`;
    vault.createNode({
      title,
      layer: "AssumptionTest",
      evidence: "observed",
      body: `**Pre-committed threshold:** at least 40% of ${phraseFrom(rnd)} within one week.\n`,
      tags: [],
      links: [],
    });
    for (let k = 0; k < (i === 0 ? 200 : 1); k++) {
      recordResult(dir, {
        test: title,
        verdict: "supported",
        note: `ran it, ${phraseFrom(rnd)}`,
        by: "the fixture's human",
        uncovered: `leaves ${phraseFrom(rnd)} untested k${k}`,
        on: "2026-07-30",
      });
    }
  }

  // One solution carrying every outstanding test, so `ost_gate`'s refusal has a
  // list long enough to blow the budget on its own.
  vault.createNode({
    title: GATE_SOLUTION,
    layer: "Solution",
    evidence: "observed",
    body: "b",
    tags: [],
    links: [],
  });
  const outstanding: string[] = [];
  for (let i = 0; i < 500; i++) {
    const title = longTestTitle(rnd, i);
    outstanding.push(title);
    vault.createNode({ title, layer: "AssumptionTest", evidence: "observed", body: "b", tags: [], links: [] });
  }
  for (const title of outstanding) vault.linkNodes(GATE_SOLUTION, title);

  // Markdown the walk enumerates and declines. `formatCensus` names one file per
  // line, and the block is shared by `ost_check` and `ost_status`.
  for (let i = 0; i < 60; i++) {
    fs.writeFileSync(path.join(dir, `stray-note-${i}.md`), `A note nobody turned into a node. ${i}\n`);
  }
}

describe("Z2 — renderCheck / renderStatus / renderDebt / renderGate on a 10,000-node vault", () => {
  let dir: string;
  let ctx: PassContext;
  let tree: OstNode[];
  let census: TreeCensus;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-z2-render-"));
    await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
    ctx = buildPassContext(dir);
    buildFixture(ctx.vault, dir);
    tree = ctx.vault.readTree();
    census = ctx.vault.readTreeCensus();
  }, 600_000);
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("the fixture is the one the budgets are stated against", () => {
    // A budget test that quietly started measuring a 20-node vault would pass
    // forever. This is the guard on every number below it.
    expect(tree.length).toBe(10_000);
    expect(census.skipped.length + census.unreadable.length).toBeGreaterThan(MAX_ITEMS_PER_LIST);
  });

  test("all four renders stay under the stated byte budget", () => {
    expect(bytes(renderCheck(census).text)).toBeLessThan(RENDER_BUDGET_BYTES);
    expect(bytes(renderStatus(ctx, census))).toBeLessThan(RENDER_BUDGET_BYTES);
    expect(bytes(renderDebt(tree))).toBeLessThan(RENDER_BUDGET_BYTES);
    expect(bytes(renderGate(tree, GATE_SOLUTION).text)).toBeLessThan(RENDER_BUDGET_BYTES);
  });

  test("non-vacuity — the uncapped shape of each render blows the same budget on this fixture", () => {
    /*
     * The control that makes the four bounds above mean anything.
     *
     * A render can be small because it was capped or because the fixture never
     * had much to say, and from the assertion's side those look identical. So
     * each list is rebuilt here in the shape the renderer used to emit — one
     * line per item, no cap — and required to BREAK the budget. If any of these
     * four stops failing, the corresponding budget assertion above has quietly
     * become decoration and this is what says so.
     */
    const violations = checkInvariants(tree);
    const flatCheck = violations.map((v) => `  ✗ [${v.rule}] ${v.node ? `"${v.node}": ` : ""}${v.detail}`).join("\n");
    expect(bytes(flatCheck)).toBeGreaterThan(RENDER_BUDGET_BYTES);

    const debt = computeEvidenceDebt(tree);
    const flatDebt = debt.solutions.map((s) => `  [${s.state}] ${s.title} — ${s.testsRun}`).join("\n");
    expect(bytes(flatDebt)).toBeGreaterThan(RENDER_BUDGET_BYTES);

    const gaps = computeCoverageDebt(tree).gaps;
    const flatStatus = gaps.map((g) => `  unbounded: ${g.title} (${g.claimed} result(s))`).join("\n");
    expect(bytes(flatStatus)).toBeGreaterThan(RENDER_BUDGET_BYTES);

    const verdict = gateSolution(tree, GATE_SOLUTION);
    expect(bytes(verdict.reason)).toBeGreaterThan(RENDER_BUDGET_BYTES);
  });

  test("every shortened list names how many it hid, and how to reach the rest", () => {
    const check = renderCheck(census).text;
    const violations = checkInvariants(tree);
    const byRule = new Map<string, number>();
    for (const v of violations) byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);

    // Something was shortened, or the rest of this test asserts nothing.
    expect(check).toContain("not listed");

    for (const [rule, total] of byRule) {
      // The per-rule header carries that rule's FULL count, whether or not the
      // list beneath it was shortened.
      expect(check).toContain(`  [${rule}] ${total} violation(s):`);
      if (total > MAX_ITEMS_PER_LIST) {
        // … and an elision line naming exactly how many of that class went unshown.
        const hidden = total - MAX_ITEMS_PER_LIST;
        expect(check).toContain(
          `… ${hidden} more [${rule}] violation(s) not listed (showing ${MAX_ITEMS_PER_LIST} of ${total}).`,
        );
      } else {
        // A class that fits is printed whole and claims nothing was hidden. This
        // is the half that catches a renderer announcing elisions it never made.
        expect(check).not.toContain(`more [${rule}] violation(s) not listed`);
      }
    }
    // Non-vacuity for the branch above: this fixture really does carry both
    // kinds of class — two that overflow the cap (`test-mapped`,
    // `rung-unearned`) and one that fits inside it (`solution-mapped`, the one
    // unparented Solution). Without a class of each kind, one of the two
    // branches would never run.
    const overflowing = [...byRule.values()].filter((n) => n > MAX_ITEMS_PER_LIST).length;
    const fitting = [...byRule.values()].filter((n) => n <= MAX_ITEMS_PER_LIST).length;
    expect(overflowing).toBeGreaterThanOrEqual(2);
    expect(fitting).toBeGreaterThanOrEqual(1);

    // The census block: the header keeps the true dropped count and the elision
    // line restates the counts the per-file lines would have carried.
    const dropped = census.skipped.length + census.unreadable.length;
    expect(check).toContain(`${dropped} dropped`);
    expect(check).toContain(`the full counts are ${dropped} file(s) dropped`);

    // And the coda tells the reader how to see the rest, which is the clause an
    // elision note most often skips.
    expect(check).toContain("re-run");
    expect(check).toContain("`ost_check`");

    const debt = renderDebt(tree);
    expect(debt).toContain("not listed");
    // The one list whose elision note has to say there is no way to page it.
    const status = renderStatus(ctx, census);
    expect(status).toContain("not listed");
    expect(status).toContain("no\n  tool on this surface pages through");

    /*
     * The gate refusal, whose outstanding-test list `renderGate` shortens by
     * finding `outstanding.join("; ")` at the end of `gateSolution`'s reason
     * rather than by keeping a second copy of the wording. That fails open, so
     * it needs a pin: verified to discriminate by changing the `endsWith` to a
     * string `gateSolution` cannot produce — the byte-budget test above then
     * measures 72,979 bytes against a 49,152-byte budget and goes red, which is
     * the drift turning into a failed build instead of a silent regression.
     */
    const gate = renderGate(tree, GATE_SOLUTION).text;
    const outstanding = gateSolution(tree, GATE_SOLUTION).debt!.outstanding;
    expect(gate).toContain(`… and ${outstanding.length - MAX_ITEMS_PER_LIST} more not listed`);
    expect(gate).toContain(`showing ${MAX_ITEMS_PER_LIST} of ${outstanding.length}`);
    expect(gate).toContain("`ost_read_tree` names them");
  });

  test("violations are capped within each rule — a flat cap would have hidden a whole rule class", () => {
    /*
     * The requirement this file exists to prove, and the one a flat cap fails in
     * a way that still looks capped.
     *
     * The control is computed rather than asserted from memory: take the first
     * MAX_ITEMS_PER_LIST violations in emission order — exactly what a flat
     * `violations.slice(0, 25)` would have printed — and name the rule classes
     * it leaves out. On this fixture that set is non-empty and contains
     * `rung-unearned`, the LARGEST class of all (8,438 of 11,939). A reader of
     * the flat render would close a red `ost_check` having seen no sign that the
     * rule broken most often is broken at all. That is the amnesty failure in
     * its subtler form, and grouping is what buys it back.
     *
     * Verified to discriminate, both halves: replacing the per-rule loop in
     * `appendViolationsByRule` with one flat `appendSample` over `violations`
     * fails the `lostToAFlatCap` expectation, and replacing the per-state loop
     * in `renderDebt` with one flat pass over `debt.solutions` fails the
     * `[proposed]` expectation below (2,000 `untested` solutions crowd the one
     * `proposed` solution out of the window). Both leave every byte-budget
     * assertion in this file green, which is exactly why this test exists
     * separately from them.
     */
    const violations = checkInvariants(tree);
    const flatPrefix = new Set(violations.slice(0, MAX_ITEMS_PER_LIST).map((v) => v.rule));
    const allRules = new Set(violations.map((v) => v.rule));
    const lostToAFlatCap = [...allRules].filter((r) => !flatPrefix.has(r));
    expect(lostToAFlatCap.length).toBeGreaterThan(0);

    const check = renderCheck(census).text;
    // Every class that fired is named, including the ones a flat cap would have lost.
    for (const rule of allRules) expect(check).toContain(`  [${rule}] `);
    for (const rule of lostToAFlatCap) expect(check).toContain(`  ✗ [${rule}]`);
    // Each class gets its OWN window rather than sharing one: a class shows
    // min(its size, the cap) lines, not a share of a single budget.
    const counted = new Map<string, number>();
    for (const v of violations) counted.set(v.rule, (counted.get(v.rule) ?? 0) + 1);
    for (const [rule, total] of counted) {
      const shown = check.split("\n").filter((l) => l.startsWith(`  ✗ [${rule}]`)).length;
      expect(shown).toBe(Math.min(total, MAX_ITEMS_PER_LIST));
    }

    // Same argument, applied to `ost_debt`: the `tested` solutions outnumber the
    // untested ones on any real vault, so a flat cap would spend the window on
    // the solutions that are fine. Every state that has members is named.
    const debtText = renderDebt(tree);
    const totals = computeEvidenceDebt(tree).totals;
    for (const [state, n] of [["untested", totals.untested], ["proposed", totals.proposed], ["tested", totals.tested]] as const) {
      if (n === 0) continue;
      expect(debtText).toContain(`  [${state}] `);
    }
    expect(totals.untested).toBeGreaterThan(0);
    expect(totals.proposed).toBeGreaterThan(0);
  });

  test("the verdict and every total are identical with and without the cap", () => {
    /*
     * The load-bearing clause. `ost_check` is a hard gate and a mandatory human
     * interrupt: capping its listing must not move whether it is red, how many
     * violations it found, or any number it prints.
     *
     * Checked against the uncapped primitives — `checkInvariants` over the whole
     * tree, `computeEvidenceDebt` over the whole tree, `gateSolution` over the
     * whole tree — rather than by reading a number back out of the capped text
     * and comparing it to itself. The independent path is the point: it is what
     * would catch a cap applied one step too early, to the data instead of to
     * the display.
     *
     * Verified to discriminate: slicing `checkInvariants(census.nodes)` to 200 at
     * the top of `renderCheck` — a cap applied to the data instead of to the
     * display — leaves both byte-budget assertions in this file green (they get
     * *better*) and fails this one with "expected 200 to be 11939".
     */
    const uncappedViolations = checkInvariants(tree).length;
    expect(uncappedViolations).toBeGreaterThan(MAX_ITEMS_PER_LIST * 10);

    const check = renderCheck(census);
    // Red, and red for the full count — not for the count it displayed.
    expect(check.violations).toBe(uncappedViolations);
    expect(check.text.split("\n")[0]).toBe(
      `invariants: FAIL (${uncappedViolations} violation(s) over ${tree.length} node(s))`,
    );
    // The per-rule headers sum back to the total. A cap that leaked into a
    // header would show up here even if the FAIL line were computed correctly.
    const headerCounts = [...check.text.matchAll(/^ {2}\[[a-z-]+\] (\d+) violation\(s\):$/gm)].map((m) => Number(m[1]));
    expect(headerCounts.reduce((a, b) => a + b, 0)).toBe(uncappedViolations);

    // `ost_gate` — the verdict a cap must never be able to clear.
    const uncappedGate = gateSolution(tree, GATE_SOLUTION);
    const gate = renderGate(tree, GATE_SOLUTION);
    expect(gate.cleared).toBe(uncappedGate.cleared);
    expect(gate.cleared).toBe(false);
    expect(gate.text).toContain(`has ${uncappedGate.debt!.testsProposed} proposed assumption test(s), none run`);
    expect(uncappedGate.debt!.testsProposed).toBeGreaterThan(MAX_ITEMS_PER_LIST);

    // `ost_debt` — the totals line is computed before anything is sampled. The
    // instrument count rides on the same line and is held to the same rule:
    // taken over the whole tree, never over the sample the lines below show.
    const totals = computeEvidenceDebt(tree).totals;
    const proseOnly = solutionsMissingInstruments(tree).length;
    expect(renderDebt(tree).split("\n")[0]).toBe(
      `Solutions: ${totals.solutions}  (untested ${totals.untested}, proposed-only ${totals.proposed}, ` +
        `tested ${totals.tested}; ${proseOnly} with tests that are prose only)`,
    );

    // `ost_status` — the node count and the coverage denominator likewise.
    const status = renderStatus(ctx, census);
    const cov = computeCoverageDebt(tree).totals;
    expect(status).toContain(`Nodes: ${tree.length}  (`);
    expect(status).toContain(
      `Coverage: ${cov.bounded}/${cov.withResults} recorded result(s) say what they do not cover`,
    );
    expect(cov.unbounded).toBeGreaterThan(MAX_ITEMS_PER_LIST);
  });
});

describe("Z2 — a small tree is not shortened at all", () => {
  let dir: string;
  let ctx: PassContext;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-z2-small-"));
    await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
    ctx = buildPassContext(dir);
    buildLargeTree(ctx.vault, OUTCOME, { opportunities: 2, solutions: 6, assumptionTests: 4 });
  }, 120_000);
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("nothing says 'not listed', and every violation is still printed", () => {
    /*
     * The other direction of the control. Every assertion in the describe above
     * is about output that WAS shortened; if the renderers shortened everything,
     * or announced an elision that never happened, this is what notices.
     */
    const census = ctx.vault.readTreeCensus();
    const tree = ctx.vault.readTree();
    const check = renderCheck(census).text;
    expect(check).not.toContain("not listed");
    expect(check).not.toContain("Nothing was cleared by being hidden");
    // Non-vacuity for the negative: this tree really does have violations, so
    // "no elision note" is a fact about the cap and not about an empty list.
    const violations = checkInvariants(tree);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.length).toBeLessThanOrEqual(MAX_ITEMS_PER_LIST);
    expect(check.split("\n").filter((l) => l.trimStart().startsWith("✗ ")).length).toBe(violations.length);

    expect(renderDebt(tree)).not.toContain("not listed");
    expect(renderStatus(ctx, census)).not.toContain("not listed");
    // A gate refusal short enough to print whole passes through untouched — the
    // wording stays `gateSolution`'s, which is what the string surgery in
    // `renderGate` is arranged to preserve.
    const target = tree.find((n) => n.layer === "Solution")!.title;
    expect(renderGate(tree, target).text).toBe(`gate: BLOCKED — ${gateSolution(tree, target).reason}`);
  });
});

/**
 * A census over a hand-built node list.
 *
 * `renderCheck` takes a census, not a tree, and three of the lists it caps live
 * on fields no fixture builder produces: `unexplained` needs a usage trace older
 * than the vault, and `independent` needs git to disagree with the walk.
 * Constructing the record directly is the only way to reach those caps at all —
 * without this, they are the caps nothing measures.
 */
function censusOf(nodes: OstNode[], extra: Partial<TreeCensus> = {}): TreeCensus {
  return {
    nodes,
    examined: nodes.length,
    seenFiles: nodes.map((n) => `${n.title}.md`),
    skipped: [],
    unreadable: [],
    quarantined: [], retired: [],
    ...extra,
  };
}

/** A title at the sanitizer's ceiling (`MAX_TITLE_LENGTH`, `src/ost/sanitize.ts`). */
function longTitle(kind: string, i: number): string {
  const filler = "customers abandon the flow before they reach the part that would have helped them ";
  return `${kind} ${i} — ${filler.repeat(4)}`.slice(0, 200);
}

describe("Z2 — a finding the cap hid is still the thing making the check red", () => {
  /*
   * The property the criterion is actually about, isolated.
   *
   * Everything in the big fixture above is red several times over, so "still
   * red" proves little there — a cap could drop an entire list and the verdict
   * would not move. Here the tree is structurally perfect and the ONLY red comes
   * from a list long enough to be shortened. If the cap were applied a step too
   * early, this check would read PASS.
   */
  const clean: OstNode[] = [{ title: OUTCOME, layer: "Outcome", evidence: "assertion", tags: [], links: [], body: "b" }];

  test("the tree itself is clean — the control for both tests below", () => {
    // Without this, "red because of the hidden list" would be indistinguishable
    // from "red because the tree was broken anyway".
    expect(checkInvariants(clean)).toEqual([]);
    const out = renderCheck(censusOf(clean));
    expect(out.violations).toBe(0);
    expect(out.text).toContain("invariants: PASS (0 violations over 1 node(s))");
    expect(out.text).not.toContain("provenance: FAIL");
    expect(out.text).not.toContain("not listed");
  });

  test("40 unexplained node files: 25 listed, 15 named as hidden, and the verdict counts all 40", () => {
    const files = Array.from({ length: 40 }, (_, i) => `${longTitle("Ghost", i)}.md`);
    const out = renderCheck(
      censusOf(clean, {
        unexplained: { source: "usage-trace", basis: ".ost-agent/usage/events.jsonl", unexplained: files },
      }),
    );

    // Red — and red for 40, not for the 25 it could afford to print.
    expect(out.violations).toBe(40);
    expect(out.text).toContain("provenance: FAIL (40 node file(s) no tool invocation explains)");
    expect(out.text).toContain("… 15 more unexplained node file(s) not listed (showing 25 of 40).");
    expect(out.text.split("\n").filter((l) => l.includes("[unexplained-node]"))).toHaveLength(MAX_ITEMS_PER_LIST);

    // The 15 that were not shown are genuinely absent from the text, which is
    // what makes the count above the only thing carrying them.
    for (const f of files.slice(MAX_ITEMS_PER_LIST)) expect(out.text).not.toContain(f);
    // And the reader is told what to do about a file they cannot see named.
    expect(out.text).toContain("Nothing was cleared by being hidden");
  });

  test("a census whose blindness alarm sits behind 60 routine drops still prints the alarm", () => {
    /*
     * The regression this test was written for. `formatCensus` emits the
     * independent-denominator lines LAST, after one line per dropped file, and
     * sampling the block as a single list meant 60 stray notes — the most
     * harmless thing a vault can contain — pushed out the one line that says the
     * walk is blind and every count above it is short. The count survived in the
     * elision note; the alarm, and the name of the file nobody can now page to,
     * did not.
     *
     * Verified to discriminate: sampling `detail` as one list again (the shape
     * before the fix) fails both `toContain`s below while every byte-budget and
     * total assertion in this file stays green.
     */
    const census = censusOf(clean, {
      examined: 121,
      skipped: Array.from({ length: 60 }, (_, i) => ({ file: `stray-${i}.md`, reason: "not an OST node" })),
      independent: { source: "git", tracked: 122, unseenByWalk: ["a-file-the-walk-never-enumerated.md"] },
    });
    const text = renderCheck(census).text;

    expect(text).toContain("git tracks 122 markdown file(s); the walk enumerated 121.");
    expect(text).toContain("The walk never saw: a-file-the-walk-never-enumerated.md");
    // Non-vacuity: the block really was shortened, so the alarm survived a cap
    // rather than there having been nothing to cap.
    expect(text).toContain("census line(s) — the full counts are 60 file(s) dropped");
    expect(text).toContain("1 tracked by an independent index but never walked");
  });

  test("a blindness list too long to name still ships the fact, and the render stays bounded", () => {
    // The other end of the same line: `unseenByWalk` is joined into ONE line, so
    // a walk blind to ten thousand files would otherwise spend the whole
    // allowance naming them. Charging it bounds the render; the fallback is what
    // stops "too alarming to fit" from meaning "not reported".
    const unseen = Array.from({ length: 10_000 }, (_, i) => `${longTitle("Never-enumerated", i)}.md`);
    const census = censusOf(clean, {
      examined: 1,
      independent: { source: "git", tracked: 10_001, unseenByWalk: unseen },
    });
    const text = renderCheck(census).text;

    expect(bytes(text)).toBeLessThan(RENDER_BUDGET_BYTES);
    expect(text).toContain("git tracks 10000 markdown file(s) this walk never enumerated — too many to name here.");
    expect(text).toContain("Every count above is short by at least that much.");
    // Non-vacuity: naming them really would have broken the budget, so the
    // fallback is doing work rather than standing in for a list that fit.
    expect(bytes(unseen.join(", "))).toBeGreaterThan(RENDER_BUDGET_BYTES);
  });
});

describe("Z2 — the byte allowance, not the item cap, is what bounds long items", () => {
  /*
   * `DETAIL_BUDGET_BYTES` had no control. On the 10,000-node fixture above,
   * raising it to Infinity changes not one byte of any of the four renders —
   * every list there is short enough that `MAX_ITEMS_PER_LIST` alone does all
   * the bounding — so the whole allowance could have been deleted with the suite
   * green. These two fixtures are where it is load-bearing, and the item cap
   * demonstrably is not enough.
   */

  describe("one test's `## Uncovered` list, times twenty-five pairs", () => {
    let dir: string;
    let tree: OstNode[];

    beforeAll(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-z2-wide-"));
      await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
      const ctx = buildPassContext(dir);
      const rnd = seededRandom(7);
      // 30 bounded tests × 30 recorded results. Not a big tree — 31 nodes — but
      // `ost_debt` prints a BLOCK per pair, up to 27 lines tall, and each line
      // carries a sentence a human wrote. Item caps bound the number of blocks
      // and the height of each; nothing but bytes bounds their product.
      for (let i = 0; i < 30; i++) {
        const title = longTitle("Test whether", i);
        ctx.vault.createNode({
          title,
          layer: "AssumptionTest",
          evidence: "observed",
          body: `**Pre-committed threshold:** at least 40% of ${phraseFrom(rnd)} within one week.\n`,
          tags: [],
          links: [],
        });
        for (let k = 0; k < 30; k++) {
          recordResult(dir, {
            test: title,
            verdict: "supported",
            note: `ran it, ${phraseFrom(rnd)}`,
            by: "the fixture's human",
            uncovered: `${longTitle("leaves untested", k)} — and nothing in this run speaks to it`,
            on: "2026-07-30",
          });
        }
      }
      tree = ctx.vault.readTree();
    }, 300_000);
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    test("renderDebt is under budget, and the item caps alone would not have got it there", () => {
      const debt = renderDebt(tree);
      expect(bytes(debt)).toBeLessThan(RENDER_BUDGET_BYTES);

      /*
       * The control, and the whole reason this fixture exists. Rebuild the same
       * section with BOTH item caps applied — 25 pairs, 25 uncovered statements
       * each — and nothing charged for bytes. That is what the renderer would
       * emit with `DETAIL_BUDGET_BYTES` removed, and it is over budget. So the
       * assertion above is carried by the byte allowance and by nothing else.
       *
       * Verified to discriminate: setting `DETAIL_BUDGET_BYTES` to Infinity
       * fails the assertion above and leaves every other test in this file
       * green, including all four byte budgets on the 10,000-node fixture.
       */
      const pairs = computeCoveragePairs(tree);
      expect(pairs.length).toBeGreaterThan(MAX_ITEMS_PER_LIST);
      const itemCappedOnly = pairs
        .slice(0, MAX_ITEMS_PER_LIST)
        .flatMap((p) => [
          `  ${p.title}`,
          `      asked:     ${p.asked}`,
          ...p.uncovered.slice(0, MAX_ITEMS_PER_LIST).map((u) => `                 ${u}`),
        ])
        .join("\n");
      expect(bytes(itemCappedOnly)).toBeGreaterThan(RENDER_BUDGET_BYTES);

      // And the allowance bought that bound without moving a number: the header
      // totals are over every test, not over the pairs that fit.
      const c = computeCoverageDebt(tree).totals;
      expect(c.bounded).toBeGreaterThan(MAX_ITEMS_PER_LIST);
      expect(debt).toContain(`Coverage: ${c.withResults} test(s) with results  (bounded ${c.bounded}, unbounded ${c.unbounded})`);
      expect(debt).toContain("not listed");
    });
  });

  test("a rule class the allowance never reached is still named, and still counted", () => {
    /*
     * The byte allowance runs out mid-render, and the question is what a reader
     * sees of the rule classes below the line. `checkInvariants` emits in a fixed
     * order, so "below the line" is not hypothetical: on this tree the allowance
     * is spent inside `solution-mapped`, and `test-mapped` — 40 real
     * violations — gets zero lines.
     *
     * Zero lines is acceptable. Zero MENTION is not, and that is the difference
     * this test pins: the per-rule header is pushed before the sample and is
     * never charged, so a class that could not afford a single line still
     * carries its own full count and an elision saying "showing 0 of 40".
     *
     * Verified to discriminate: emitting the header lazily, alongside the first
     * item the allowance can afford — the natural way to write this, and the way
     * that loses a class entirely — fails the header assertion below with
     * "expected 'invariants: FAIL (200 violation(s) …' to contain
     * '  [test-mapped] 40 violation(s):'", while every byte budget in this
     * file stays green. (Merely *charging* the header does not discriminate: a
     * header is thirty-odd bytes and the allowance is still that far from spent
     * when the class is reached. It is the ordering, not the accounting, that
     * this property rests on.)
     */
    const nodes: OstNode[] = [
      {
        title: OUTCOME,
        layer: "Outcome",
        evidence: "assertion",
        tags: [],
        // 40 links to titles that do not exist — `dangling-link`, emitted first.
        links: Array.from({ length: 40 }, (_, i) => longTitle("Nothing by this name", i)),
        body: "b",
      },
    ];
    for (let i = 0; i < 40; i++) {
      // `wrapped-wikilink`, emitted second: a link the author wrote that the
      // graph does not have, because a hard wrap broke it in two.
      nodes.push({
        title: longTitle("Opportunity", i),
        layer: "Opportunity",
        evidence: "assertion",
        tags: [],
        links: [],
        body: `see [[${longTitle("Wrapped across a line", i)}\n]] for the rest`,
      });
      nodes.push({ title: longTitle("Solution", i), layer: "Solution", evidence: "assertion", tags: [], links: [], body: "b" });
      nodes.push({
        title: longTitle("Assumption test", i),
        layer: "AssumptionTest",
        evidence: "assertion",
        tags: [],
        links: [],
        body: "b",
      });
    }

    const violations = checkInvariants(nodes);
    const out = renderCheck(censusOf(nodes));

    // Bounded, and red for every violation rather than for the printed ones.
    expect(bytes(out.text)).toBeLessThan(RENDER_BUDGET_BYTES);
    expect(out.violations).toBe(violations.length);
    expect(out.text.split("\n")[0]).toBe(
      `invariants: FAIL (${violations.length} violation(s) over ${nodes.length} node(s))`,
    );

    // The allowance really did run out — some class got fewer lines than the
    // item cap would have allowed it. Without this the test would pass on a
    // render that simply had room for everything.
    const shownFor = (rule: string): number =>
      out.text.split("\n").filter((l) => l.startsWith(`  ✗ [${rule}]`)).length;
    const counts = new Map<string, number>();
    for (const v of violations) counts.set(v.rule, (counts.get(v.rule) ?? 0) + 1);
    const starved = [...counts].filter(([r, n]) => shownFor(r) < Math.min(n, MAX_ITEMS_PER_LIST));
    expect(starved.length).toBeGreaterThan(0);

    // `test-mapped` is the class that paid for it, and it is still named,
    // still counted, and still says how much of itself went unshown.
    expect(shownFor("test-mapped")).toBe(0);
    expect(out.text).toContain("  [test-mapped] 40 violation(s):");
    expect(out.text).toContain("… 40 more [test-mapped] violation(s) not listed (showing 0 of 40).");

    // Every class that fired is named, and the headers sum back to the verdict.
    for (const rule of counts.keys()) expect(out.text).toContain(`  [${rule}] `);
    const headers = [...out.text.matchAll(/^ {2}\[[a-z-]+\] (\d+) violation\(s\):$/gm)].map((m) => Number(m[1]));
    expect(headers.reduce((a, b) => a + b, 0)).toBe(violations.length);
  });
});
