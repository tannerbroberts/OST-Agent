/**
 * "Replay all existing tests to count how many a refusal would have blocked" —
 * the instrument beneath "Refuse to record a result against a threshold that was
 * never fixed".
 *
 * The solution moves the threshold classifier from the read boundary
 * (`ost-agent debt` flags an unfixed bar) to the write boundary (`ost-agent
 * result` refuses a filing against one). Its own node names the stake exactly: *a
 * wrong flag costs a glance and a wrong refusal costs the whole recording*. So the
 * assumption test asks for a dry run before an implementation — replay the
 * classifier over every assumption test in a vault, produce the list a refusal
 * would have blocked, and hand it to a person.
 *
 * **The pre-committed threshold, copied from the node rather than restated:** the
 * false-refusal rate — misread real pre-commitments as a share of everything
 * blocked — must be at or below 5%. Above 5% closes the candidate and the flag
 * stands as the permanent answer.
 *
 * **That rate cannot be asserted here, and saying so is part of the instrument.**
 * The node reserves the verdict for a person in as many words — "the classifier
 * run itself is mechanical, but a verdict here must not be recorded by compute".
 * Deciding whether a blocked test's threshold is genuinely not a commitment is
 * reading, not counting. So this file pins the three things compute *can* settle:
 * the replay is correct, the worksheet is judgeable, and the count is honest about
 * what it cannot conclude.
 *
 * **Honest about what it cannot conclude** is the load-bearing one, and it is this
 * opportunity's own subject turned on the instrument built to serve it. Under the
 * reading the solution node names, this vault returns *zero* blocked filings — and
 * a census that printed `0 blocked, 0% misread` would read as the bar cleared by a
 * rule that never fired. A rate over an empty set is undefined, not passing, and
 * the last block below holds the renderer to saying so.
 *
 * **What a green run here does not settle**, verbatim from the node: whether the
 * refusal is worth having. That turns on the risk the node names as deciding —
 * this would be the second required field added to the one command its operator is
 * already not running — and no exit code reaches a person's willingness.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { readVaultPointer } from "../../src/config/pointer.js";
import { thresholdKindOf, type ThresholdKind } from "../../src/eval/coverage.js";
import type { OstNode } from "../../src/ost/node.js";
import {
  bearingOnTheBar,
  censusOfTree,
  censusRefusals,
  FALSE_REFUSAL_BAR,
  formatRefusalCensus,
  formatReviewWorksheet,
  misreadAllowance,
  REFUSAL_READINGS,
  REFUSED_KINDS,
  wouldRefuse,
  type RefusalReading,
} from "../../src/ost/refusal-census.js";
import { recordResult } from "../../src/ost/results.js";
import { Vault } from "../../src/ost/vault.js";

const KINDS: readonly ThresholdKind[] = ["bound", "instruction", "prose", "absent"];

/** An assumption test carrying one pre-commitment paragraph, in the shape both live vaults write. */
function testNode(title: string, precommitment: string | null, results?: string): OstNode {
  const body = [
    "#AssumptionTest",
    "",
    "**The assumption under test.** Something a run could contradict.",
    "",
    ...(precommitment === null ? [] : [`**Pre-committed threshold:** ${precommitment}`, ""]),
    ...(results ? ["## Results", "", `- 2026-08-30 **supported** (ran by a person) — ${results}`, ""] : []),
  ].join("\n");
  return { title, layer: "AssumptionTest", body } as OstNode;
}

describe("the replay: which filings a refusal would have stopped, under each reading this repository already holds", () => {
  test("`flag` refuses what `ost-agent debt` calls unfixed, and lets a bar written in words through", () => {
    // The solution node says to reuse the flag's classification at the write
    // boundary, so this is the reading it specifies. `prose` passing is the whole
    // of `coverage.ts`'s stated position: a falsifiable bar in words is a bar, and
    // nagging about well-written thresholds is how a report gets turned off.
    expect(REFUSED_KINDS.flag).toEqual(["instruction", "absent"]);
    expect(wouldRefuse("instruction", "flag")).toBe(true);
    expect(wouldRefuse("absent", "flag")).toBe(true);
    expect(wouldRefuse("prose", "flag")).toBe(false);
    expect(wouldRefuse("bound", "flag")).toBe(false);
  });

  test("`strict` refuses `prose` as well — the line `rollup` and `confirmPermit` already draw", () => {
    expect(wouldRefuse("prose", "strict")).toBe(true);
    expect(wouldRefuse("bound", "strict")).toBe(false);
  });

  test("every reading refuses a superset of `flag`, so the two can never disagree about a bound bar", () => {
    // A future classifier change that made `flag` block something `strict` did not
    // would mean the write boundary and the rollup were reading opposite ways off
    // one function. This is the invariant that would catch it.
    for (const reading of REFUSAL_READINGS) {
      for (const kind of KINDS) {
        if (wouldRefuse(kind, "flag")) expect(wouldRefuse(kind, reading)).toBe(true);
      }
      expect(wouldRefuse("bound", reading)).toBe(false);
    }
  });

  test("the count is over every assumption test, classified four ways, with the never-run subset named", () => {
    const tree = [
      testNode("bound one", "at least 5 of 20 sessions end without a retry."),
      testNode("bound two, already run", "no more than a third abandon.", "3 of 20 abandoned."),
      testNode("instruction one", "Decide the acceptable failure rate before starting."),
      testNode("prose one", "The piece survives a page reload."),
      testNode("absent one", null),
      { title: "not a test", layer: "Solution", body: "**Pre-committed threshold:** Decide it." } as OstNode,
    ];

    const flag = censusRefusals(tree, "flag");
    expect(flag.tests).toBe(5);
    expect(flag.byKind).toEqual({ bound: 2, instruction: 1, prose: 1, absent: 1 });
    // The four kinds account for every test, so a reader sees what the classifier
    // did with all of them rather than only with the ones it complained about.
    expect(KINDS.reduce((n, k) => n + flag.byKind[k], 0)).toBe(flag.tests);
    expect(flag.blocked.map((b) => b.test)).toEqual(["instruction one", "absent one"]);
    expect(flag.blockedShare).toBeCloseTo(2 / 5);
    // Four of the five have never recorded a result; those are the filings the
    // operator would actually be making next.
    expect(flag.awaitingResult).toBe(4);
    expect(flag.blocked.every((b) => b.awaitingResult)).toBe(true);

    const strict = censusRefusals(tree, "strict");
    expect(strict.blocked.map((b) => b.test)).toEqual(["instruction one", "prose one", "absent one"]);
    expect(strict.byKind).toEqual(flag.byKind);
  });

  test("a filing against a test that already has a result is counted, and marked as not the next one", () => {
    const tree = [testNode("run once, bar never fixed", "Choose a bar.", "it went fine, apparently")];
    const c = censusRefusals(tree, "flag");
    expect(c.awaitingResult).toBe(0);
    expect(c.blocked).toHaveLength(1);
    // Blocked on a SECOND filing rather than a first: still a cost, and a smaller
    // one, and a census that pooled them would hide which.
    expect(c.blocked[0].awaitingResult).toBe(false);
  });

  test("an empty tree is 0 blocked and 0 share, not a division by zero", () => {
    const c = censusRefusals([], "strict");
    expect(c.tests).toBe(0);
    expect(c.blockedShare).toBe(0);
    expect(c.blocked).toEqual([]);
  });

  test("the refusal names the node and what it found, so fixing it is one edit", () => {
    // The node's own requirement, verbatim: "The refusal names the node and prints
    // what it found, so fixing it is one edit." A refusal that says only "unfixed
    // threshold" sends its reader back to the file to work out which sentence.
    const instruction = censusRefusals([testNode("pick a bar later", "Decide the acceptable failure rate.")], "flag");
    expect(instruction.blocked[0].refusal).toContain('"pick a bar later"');
    expect(instruction.blocked[0].refusal).toContain("Decide the acceptable failure rate.");
    expect(instruction.blocked[0].refusal).toContain("instruction");

    const absent = censusRefusals([testNode("nothing written", null)], "flag");
    expect(absent.blocked[0].asked).toBeNull();
    expect(absent.blocked[0].refusal).toContain("no pre-commitment at all");
    // No dangling `"null"` where the paragraph would have been quoted.
    expect(absent.blocked[0].refusal).not.toContain("null");
  });
});

describe("the worksheet a person judges, and the anchoring it has to withhold", () => {
  const tree = [
    testNode("bar in words", "The piece survives a page reload."),
    testNode("pick one later", "Decide the acceptable failure rate."),
  ];

  test("each blocked filing appears once, with the paragraph the classifier read", () => {
    const sheet = formatReviewWorksheet("fixture", censusRefusals(tree, "strict"));
    expect(sheet).toContain("bar in words");
    expect(sheet).toContain("The piece survives a page reload.");
    expect(sheet).toContain("pick one later");
    expect(sheet.match(/verdict \(not a commitment \/ misread\)/g)).toHaveLength(2);
  });

  test("the classifier's verdict is withheld — the reviewer checks it, they do not ratify it", () => {
    // "Judge from the node text, blind to the classifier's reasoning." A reviewer
    // shown `instruction` beside a paragraph is being asked to agree with a label,
    // and a census whose reviewer agrees with it by construction measures nothing.
    const sheet = formatReviewWorksheet("fixture", censusRefusals(tree, "strict"));
    for (const kind of ["instruction", "prose", "absent", "bound"]) expect(sheet).not.toContain(kind);
    expect(sheet).not.toContain("cannot supply one");
  });

  test("the worksheet states the arithmetic of the bar the node fixed, not a bar of its own", () => {
    expect(FALSE_REFUSAL_BAR).toBe(0.05);
    // Floored, never rounded: 1 misread out of 10 admitted against an "at or below
    // 5%" bar has quietly made it a 10% bar.
    expect(misreadAllowance(10)).toBe(0);
    expect(misreadAllowance(20)).toBe(1);
    expect(misreadAllowance(72)).toBe(3);
    expect(formatReviewWorksheet("fixture", censusRefusals(tree, "strict"))).toContain("5%");
  });
});

describe("a rate over an empty set is undefined, not cleared", () => {
  test("with nothing blocked, both surfaces say the bar cannot be judged rather than reporting 0%", () => {
    // This is not hypothetical: under the reading the solution node names, the live
    // vault below blocks nothing at all. A census that reported `0% misread` there
    // would hand the candidate a pass earned by a rule that never fired — the exact
    // shape of "my tests carry thresholds nobody ever fixed, so nothing can come out
    // a failure", reproduced by the instrument built to measure it.
    expect(bearingOnTheBar(0)).toContain("cannot be cleared");
    expect(bearingOnTheBar(0)).not.toMatch(/at most \d/);
    expect(bearingOnTheBar(1)).toContain("at most 0 may be a misread");

    const clean = [testNode("bar fixed", "at least 5 of 20.")];
    const summary = formatRefusalCensus("fixture", censusOfTree(clean));
    expect(summary).toContain("0/1");
    expect(summary).toContain("cannot be cleared");

    const sheet = formatReviewWorksheet("fixture", censusRefusals(clean, "flag"));
    expect(sheet).toContain("nothing to judge");
  });
});

describe("the census counts; it does not adopt", () => {
  test("`ost-agent result` still files against an unfixed threshold — the node's sequencing, as behaviour", () => {
    // The solution node's own honest sequencing: "do not build this until somebody
    // has actually recorded a result under the current rules." Nothing here is
    // wired into `recordResult`, and this is the assertion that keeps it that way —
    // a future commit that switches the refusal on fails here and has to argue for
    // itself rather than arriving as a side effect of a count.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refusal-census-"));
    try {
      const vault = new Vault(dir);
      vault.createNode({
        title: "pick a bar later",
        layer: "AssumptionTest",
        tags: [],
        links: [],
        evidence: "assertion",
        body: "**Pre-committed threshold:** Decide the acceptable failure rate.",
      });
      const node = vault.read("pick a bar later");
      expect(thresholdKindOf(node)).toBe("instruction");
      expect(wouldRefuse(thresholdKindOf(node), "flag")).toBe(true);

      const line = recordResult(dir, {
        test: "pick a bar later",
        verdict: "supported",
        note: "ran it; it looked fine",
        by: "a person",
        uncovered: "everything the unfixed bar would have decided",
      });
      expect(line).toContain("supported");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * The live half — the replay the assumption test actually asks for, over every
 * vault this repository's committed pointer can reach. Skips visibly on a bare
 * clone, the one machine where the corpus does not exist.
 *
 * No pre-committed bar is asserted here, and that omission is the honest reading of
 * the node rather than a gap: the only bar it fixed is the false-refusal rate, and
 * that is a person's to judge off the worksheet this prints. What is asserted is
 * that the replay is total and internally consistent — every test classified,
 * every blocked filing reachable in the worksheet, and `flag` a subset of `strict`.
 * The numbers are printed so a reader of the run sees the count the node was
 * waiting for.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function liveVaults(): string[] {
  let pointed: string;
  try {
    pointed = readVaultPointer(REPO_ROOT).dir;
  } catch {
    return [];
  }
  if (!fs.existsSync(path.join(pointed, "ost.config.yaml"))) return [];
  const found = [pointed];
  const parent = path.dirname(pointed);
  for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(parent, entry.name);
    if (dir === pointed) continue;
    if (fs.existsSync(path.join(dir, "ost.config.yaml"))) found.push(dir);
  }
  return found;
}

const VAULTS = liveVaults();

describe.runIf(VAULTS.length > 0)("what the refusal would have blocked on the live vaults", () => {
  for (const dir of VAULTS) {
    const name = path.basename(dir);
    test(`${name}: every assumption test is replayed, and the blocked list is judgeable`, () => {
      const tree = new Vault(dir, { create: false }).readTree();
      const both = censusOfTree(tree);
      const report = formatRefusalCensus(name, both);
      // eslint-disable-next-line no-console -- the count IS the deliverable; a census nobody reads answers nothing.
      console.log(report);

      const flag = both.flag;
      const strict = both.strict;
      expect(flag.tests).toBeGreaterThan(0);
      expect(KINDS.reduce((n, k) => n + flag.byKind[k], 0), report).toBe(flag.tests);
      expect(strict.tests).toBe(flag.tests);

      // The reading the solution node names can never block something the stricter
      // one lets through.
      const strictly = new Set(strict.blocked.map((b) => b.test));
      for (const b of flag.blocked) expect(strictly.has(b.test), `${b.test} blocked by flag but not by strict`).toBe(true);

      for (const reading of REFUSAL_READINGS) {
        const c = both[reading as RefusalReading];
        expect(c.blocked.length).toBeLessThanOrEqual(c.tests);
        // Every blocked filing reaches the human who has to judge it. A count whose
        // list is shorter than the count is the unreconcilable number this vault
        // already records against `debt` and `rollup`.
        const sheet = formatReviewWorksheet(name, c);
        for (const b of c.blocked) expect(sheet).toContain(b.test);
        expect(sheet).toContain(bearingOnTheBar(c.blocked.length));
      }
    });
  }
});
