/**
 * The assumption underneath "New rules apply forward only, and existing nodes
 * are marked as predating them", and the mechanism that claim needs to be true
 * of the code.
 *
 * **The assumption.** *A grandfathered backlog eventually gets cleared rather
 * than sitting forever.* The threshold on the node is "at least 60% of the
 * would-be-grandfathered nodes were brought into compliance within a month", and
 * the design says: replay the last three tightenings, count who would have been
 * grandfathered, count who complied.
 *
 * That is a question about history, and history is in the meta vault's git log —
 * one operator's working directory, which a committed test may not read. So the
 * reading was taken once by `scripts/capture-tightening-replay.ts` and the
 * *observation* is what is committed, in `test/fixtures/tightening-replay.json`:
 * per day, the vault commit it was read from, how many nodes it held, and which
 * of them broke each rule. Every row is re-derivable by anyone with that
 * repository. This file does the arithmetic and applies the threshold; it does
 * not decide what happened.
 *
 * **What the replay says, and the part that matters more than the rate.** All
 * three of the last tightenings landed on 2026-08-05. Two of them had a backlog
 * — `single-backlink` with 301 would-be-grandfathered nodes, `single-parent`
 * with 5 — and `test-mapped` had none, because it introduced a layer nothing
 * older could violate. Every one of the 306 cleared, and cleared on **day
 * zero**: the migration shipped in the same commit as the rule. So 100% is real
 * and it is also the weakest possible evidence for this solution, because no
 * grandfathered backlog has ever existed in this vault to be observed. The
 * assumption test said so in advance — "clearance under that pressure is an
 * upper bound" — and the numbers are how that stops being a caveat and starts
 * being a measurement.
 *
 * The counter-evidence is in the same fixture and this file pins it too: over
 * the eleven days before `single-backlink` bound, when nothing enforced it, the
 * offender count went 3 → 324. That is the only unpressured stretch on record,
 * and the backlog grew every day of it. Which is why the mechanism below is a
 * grace period and not an amnesty.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { checkInvariants, type Violation } from "../../src/eval/invariants.js";
import {
  clearanceOf,
  countUndatedOffenders,
  daysBetween,
  partitionByInception,
  type ReplayRecord,
} from "../../src/eval/grandfathered.js";
import { CLEARANCE_WINDOW_DAYS, RULE_INCEPTIONS, lastTightenings, ruleInception, shiftDays } from "../../src/eval/rule-inception.js";
import { renderCheck } from "../../src/eval/render.js";
import type { OstNode } from "../../src/ost/node.js";
import type { TreeCensus } from "../../src/ost/census.js";

/** The threshold written on "Replay the last three tightenings…" in the meta vault. */
const THRESHOLD = 0.6;

const REPLAY: ReplayRecord = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "tightening-replay.json"), "utf8"),
);

function node(title: string, over: Partial<OstNode> = {}): OstNode {
  return { title, layer: "Solution", tags: [], links: [], body: "", evidence: "assertion", ...over };
}

function violation(rule: string, nodeTitle?: string): Violation {
  return { rule, node: nodeTitle, detail: `broke ${rule}` };
}

function census(nodes: OstNode[]): TreeCensus {
  return {
    nodes,
    examined: nodes.length,
    seenFiles: nodes.map((n) => `${n.title}.md`),
    skipped: [],
    unreadable: [],
    retired: [],
  };
}

describe("the replay: did a would-be-grandfathered backlog ever clear?", () => {
  test("the fixture covers the last three tightenings, read off the same registry the code uses", () => {
    expect(REPLAY.tightenings.map((t) => t.rule)).toEqual(lastTightenings(3).map((t) => t.rule));
    expect(REPLAY.clearanceWindowDays).toBe(CLEARANCE_WINDOW_DAYS);
    for (const t of REPLAY.tightenings) {
      const registered = ruleInception(t.rule);
      expect(registered, t.rule).toBeDefined();
      expect(t.inForceFrom).toBe(registered!.inForceFrom);
      expect(t.commit).toBe(registered!.commit);
      // The backlog was counted from the last snapshot before the rule bound —
      // counting it from after would count the migration's own result.
      expect(t.eve.date < t.inForceFrom, `${t.rule} eve`).toBe(true);
    }
  });

  test("clearance clears the 60% bar for every tightening that grandfathered anybody", () => {
    const rules = REPLAY.tightenings.map((t) => clearanceOf(t, REPLAY.clearanceWindowDays));

    const withBacklog = rules.filter((c) => c.grandfathered > 0);
    expect(withBacklog.map((c) => c.rule)).toEqual(["single-backlink", "single-parent"]);
    for (const c of withBacklog) {
      expect(c.rate, `${c.rule} clearance`).not.toBeNull();
      expect(c.rate!, `${c.rule} clearance`).toBeGreaterThanOrEqual(THRESHOLD);
      expect(c.outstanding, `${c.rule} outstanding`).toBe(0);
    }

    // The pooled figure the threshold is most naturally read over.
    const grandfathered = rules.reduce((n, c) => n + c.grandfathered, 0);
    const cleared = rules.reduce((n, c) => n + c.clearedWithinWindow, 0);
    expect(grandfathered).toBe(306);
    expect(cleared / grandfathered).toBeGreaterThanOrEqual(THRESHOLD);

    // A rule that grandfathered nobody reports no rate rather than a vacuous
    // 100% — `test-mapped` added a layer, so nothing older could break it, and
    // folding that into the average would inflate the evidence with a case that
    // never tested anything.
    expect(rules.find((c) => c.rule === "test-mapped")!.rate).toBeNull();
  });

  test("and the rate is an upper bound: every node cleared on day zero, under a red gate, by a migration", () => {
    for (const c of REPLAY.tightenings.map((t) => clearanceOf(t, REPLAY.clearanceWindowDays))) {
      if (c.grandfathered === 0) continue;
      // Zero days. Not "fast" — simultaneous. The rule and the fix were one
      // commit, so no node in this history was ever left grandfathered long
      // enough for anyone to observe whether it would have been fixed.
      expect(c.slowestDaysToClear, `${c.rule} slowest`).toBe(0);
      // And none of it cleared by nodes vanishing, which would have been a
      // different finding wearing the same number.
      expect(c.clearedByRemoval, `${c.rule} cleared by removal`).toBe(0);
    }
  });

  test("the only unpressured stretch on record shows the backlog growing, not clearing", () => {
    const backlink = REPLAY.tightenings.find((t) => t.rule === "single-backlink")!;
    const before = backlink.daily.filter((d) => d.date < backlink.inForceFrom);
    const growth = clearanceOf(backlink, REPLAY.clearanceWindowDays).growthBeforeInception;

    expect(growth.from).toBe(3);
    expect(growth.to).toBe(324);
    expect(growth.days).toBe(daysBetween(before[0].date, before.at(-1)!.date));
    // Monotone: no day in that stretch had fewer offenders than the day before
    // it. Nothing was clearing this backlog while nothing was enforcing it.
    for (let i = 1; i < before.length; i++) {
      expect(before[i].offenders, `${before[i].date} vs ${before[i - 1].date}`).toBeGreaterThanOrEqual(before[i - 1].offenders);
    }
    // And it went to zero on the day the rule bound, in one step.
    expect(backlink.daily.find((d) => d.date === backlink.inForceFrom)!.offenders).toBe(0);
  });
});

describe("the mechanism: a rule records when it came into force", () => {
  test("every rule literal checkInvariants can emit has an inception entry", () => {
    // Fail-closed means an unregistered rule binds everything, so a missing
    // entry loses the exemption rather than the check. It is still a bug, and
    // this is where it becomes a loud one — the same parity argument
    // test/mcp/rule-parity.test.ts makes for the two health gates.
    const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "eval", "invariants.ts"), "utf8");
    const emitted = new Set([...source.matchAll(/rule:\s*"([a-z-]+)"/g)].map((m) => m[1]));
    expect(emitted.size).toBeGreaterThan(0);
    for (const rule of emitted) expect(ruleInception(rule), `no inception recorded for "${rule}"`).toBeDefined();
    // No entry for a rule that does not exist either, or the registry becomes a
    // graveyard nobody can read the current rules off.
    for (const entry of RULE_INCEPTIONS) expect(emitted.has(entry.rule), `"${entry.rule}" is registered but never emitted`).toBe(true);
  });

  test("a node written before a rule predates it; one written on or after it does not", () => {
    const rule = ruleInception("single-backlink")!;
    const tree = [
      node("Written under the old rules", { created: shiftDays(rule.inForceFrom, -1) }),
      node("Written the day it landed", { created: rule.inForceFrom }),
      node("Written after", { created: shiftDays(rule.inForceFrom, 1) }),
    ];
    const asOf = shiftDays(rule.inForceFrom, 1);
    const { binding, predating } = partitionByInception(tree.map((n) => violation("single-backlink", n.title)), tree, asOf);

    expect(predating.map((p) => p.violation.node)).toEqual(["Written under the old rules"]);
    // The tie goes to the rule: a date-only `created` cannot be ordered against
    // a commit that landed at 17:12, so same-day is bound.
    expect(binding.map((v) => v.node)).toEqual(["Written the day it landed", "Written after"]);
    expect(predating[0].bindsOn).toBe(shiftDays(rule.inForceFrom, CLEARANCE_WINDOW_DAYS));
  });

  test("the exemption is a grace period: it expires, and the same node binds afterwards", () => {
    const rule = ruleInception("single-backlink")!;
    const tree = [node("Old", { created: shiftDays(rule.inForceFrom, -30) })];
    const v = [violation("single-backlink", "Old")];
    const bindsOn = shiftDays(rule.inForceFrom, CLEARANCE_WINDOW_DAYS);

    expect(partitionByInception(v, tree, shiftDays(bindsOn, -1)).predating).toHaveLength(1);
    // The day the window closes, not the day after — the node has had the whole
    // window the assumption test measured clearance over.
    expect(partitionByInception(v, tree, bindsOn).binding).toHaveLength(1);
    expect(partitionByInception(v, tree, bindsOn).predating).toHaveLength(0);
    expect(partitionByInception(v, tree, shiftDays(bindsOn, 365)).binding).toHaveLength(1);
  });

  test("every way of failing to show age binds, so nothing missing can turn a red gate green", () => {
    const rule = ruleInception("single-backlink")!;
    const old = shiftDays(rule.inForceFrom, -10);
    const asOf = shiftDays(rule.inForceFrom, 1);
    const tree = [node("Undated"), node("Dated", { created: old })];

    // No `created` at all — the node least able to show it predates anything.
    expect(partitionByInception([violation("single-backlink", "Undated")], tree, asOf).binding).toHaveLength(1);
    // A rule with no inception entry.
    expect(partitionByInception([violation("not-a-registered-rule", "Dated")], tree, asOf).binding).toHaveLength(1);
    // A violation naming no node — `single-outcome` is the real one.
    expect(partitionByInception([violation("single-outcome")], tree, asOf).binding).toHaveLength(1);
    // A node the tree does not hold.
    expect(partitionByInception([violation("single-backlink", "Ghost")], tree, asOf).binding).toHaveLength(1);

    // Undated offenders are counted so the class is visible without being excused.
    expect(countUndatedOffenders([violation("single-backlink", "Undated"), violation("single-backlink", "Dated")], tree)).toBe(1);
  });

  test("check reports the two classes apart, and the verdict is taken from the binding one alone", () => {
    // The shape of the failure this whole branch exists for: an old tree, a new
    // rule. Two nodes wikilink the same child, which is `single-backlink`.
    const rule = ruleInception("single-backlink")!;
    const old = shiftDays(rule.inForceFrom, -20);
    const tree = [
      node("Outcome", { layer: "Outcome", links: ["Bucket"], created: old }),
      node("Bucket", { layer: "Opportunity", links: ["Work"], created: old }),
      node("Also links the work", { layer: "Opportunity", links: ["Work"], created: old }),
      node("Work", { created: old }),
    ];
    // `Also links the work` is an orphan opportunity too; both rules predate.
    const asOf = shiftDays(rule.inForceFrom, 1);

    const red = renderCheck(census(tree), { asOf: shiftDays(rule.inForceFrom, CLEARANCE_WINDOW_DAYS) });
    expect(red.violations).toBeGreaterThan(0);
    expect(red.text).toContain("invariants: FAIL");

    const graced = renderCheck(census(tree), { asOf });
    // Same tree, same defects, and the gate is clean — which is the sentence the
    // solution node makes: "a tightening produces a clean gate and a visible
    // backlog, rather than a red gate the operator learns to ignore".
    expect(graced.violations).toBe(0);
    expect(graced.text).toContain("invariants: PASS");
    // Visible, and with the date the mercy runs out on the same line.
    expect(graced.text).toContain("predating:");
    expect(graced.text).toContain(shiftDays(rule.inForceFrom, CLEARANCE_WINDOW_DAYS));
    expect(graced.text).toContain("single-backlink");
    // Not silence: every predating node is named, not summarised away.
    expect(graced.text).toContain('"Work"');
  });

  test("an undated offender is named as bound in the verdict line, not left to be inferred", () => {
    const rule = ruleInception("single-backlink")!;
    const tree = [
      node("Outcome", { layer: "Outcome", links: ["Bucket"], created: shiftDays(rule.inForceFrom, -20) }),
      node("Bucket", { layer: "Opportunity", links: ["Work"], created: shiftDays(rule.inForceFrom, -20) }),
      node("Also links the work", { layer: "Opportunity", links: ["Work"], created: shiftDays(rule.inForceFrom, -20) }),
      node("Work"), // no `created`
    ];
    const asOf = shiftDays(rule.inForceFrom, 1);
    const { binding } = partitionByInception(checkInvariants(tree), tree, asOf);
    const lines = renderCheck(census(tree), { asOf }).text.split("\n");
    // On its own line: the verdict line is a fixed string other callers compare
    // against, so the note sits under it rather than inside it.
    expect(lines[0]).toBe(`invariants: FAIL (${binding.length} violation(s) over ${tree.length} node(s))`);
    // "Work" is undated and breaks two rules — `single-backlink` and
    // `single-parent` — so the note counts violations, not nodes, exactly as the
    // verdict line above it does.
    const undated = countUndatedOffenders(binding, tree);
    expect(undated).toBe(2);
    expect(lines[1]).toBe(`  ${undated} of them carry no 'created' and are bound for that reason, not judged old enough to be excused.`);
  });

  test("the registry's dates are the dates the rules actually bind on in the check", () => {
    // Guards the drift this design is most exposed to: a registry entry edited
    // to a later date is a silent, permanent amnesty for everything between.
    for (const entry of RULE_INCEPTIONS) {
      const tree = [node("Old", { created: shiftDays(entry.inForceFrom, -1) })];
      const v = [violation(entry.rule, "Old")];
      const p = partitionByInception(v, tree, entry.inForceFrom).predating;
      expect(p, entry.rule).toHaveLength(1);
      expect(p[0].inForceFrom, entry.rule).toBe(entry.inForceFrom);
    }
  });
});
