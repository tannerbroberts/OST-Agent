/**
 * R4 — `ost_check` and `ost_next_work.done` never disagree about a defect they
 * both compute.
 *
 * Two gates read the same tree. The unattended sweep reads only `done`; a human
 * reads `check`. When they can disagree permanently, neither is a health signal
 * and there is no third thing to break the tie — so `done: true` beside a red
 * `check` has to be either impossible or *declared*.
 *
 * It used to be neither. `detectHygiene` and `checkInvariants` were two
 * hand-written detectors, and four of the nine rules — `single-outcome`,
 * `assumption-mapped`, `evidence-class`, `no-self-validation` — existed only in
 * the second. A legacy or human-authored node was enough; no forging required.
 * (The readiness document named three of the four. The fourth is why this file
 * computes the set instead of listing it.)
 *
 * Three tests, in the order the argument runs:
 *
 * 1. **Partition** — every rule literal in `src/eval/invariants.ts` is either
 *    labelled as a hygiene issue or declared a non-blocker with a reason, and
 *    never both. Grepped from the source, so a tenth rule fails the build until
 *    someone classifies it.
 * 2. **Behaviour** — for each blocking rule, a planted violation actually turns
 *    `done` false. A label with no detector behind it would pass (1) and lie.
 * 3. **The property** — `done === true` implies every outstanding violation is
 *    either on a declared non-blocking rule or annotated on its node.
 *
 * On that last clause, stated plainly because it is the residue and not a
 * loophole: **an annotation suppresses a hygiene issue** (P5 — the agent flags,
 * it never deletes; R5 pins that only a real dated `ost_annotate` entry counts).
 * So the reachable disagreement is exactly "a human has been told, in writing,
 * on the node." That is a recorded difference between the gates rather than a
 * silent one, and the naïve property — never `done` while `check` is red — is
 * not achievable while annotation is the only clear path an append-only vault
 * has for a defect it cannot repair.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkInvariants } from "../../src/eval/invariants.js";
import {
  computeNextWork,
  HYGIENE_LABELS,
  HYGIENE_ONLY_RULES,
  NOT_DONE_BLOCKING,
} from "../../src/mcp/next-work.js";
import { Vault } from "../../src/ost/vault.js";
import type { OstNode } from "../../src/ost/node.js";
import { fileNameForTitle } from "../../src/ost/sanitize.js";
import { serialize } from "../../src/ost/node.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Every rule `checkInvariants` can emit, read out of the source (R9's shape). */
const RULES: string[] = (() => {
  const src = fs.readFileSync(path.join(repoRoot, "src/eval/invariants.ts"), "utf8");
  return [...new Set([...src.matchAll(/rule: "([a-z-]+)"/g)].map((m) => m[1]))].sort();
})();

const OUTCOME = "Players keep playing";
const OPPORTUNITY = "Players cannot tell what changed";
const SOLUTION = "Ship a changelog";
const ASSUMPTION = "Interview five churned players";

let dir: string;
let vault: Vault;

/** Direct vault writes — a legacy node, an import, a human in Obsidian. */
function put(node: Partial<OstNode> & { title: string; layer: OstNode["layer"] }): void {
  vault.createNode({ body: `prose for ${node.title}`, tags: [], links: [], evidence: "assertion", ...node } as OstNode);
}

/**
 * A legal tree, complete down to an assumption test — so that at `min: 0` the
 * other three `done` terms are all empty and `hygieneIssues` is the only one
 * left moving. A fixture that was already `done: false` for an unrelated reason
 * would make every assertion below pass for the wrong one.
 */
function legalTree(): void {
  put({ title: OUTCOME, layer: "Outcome" });
  put({ title: OPPORTUNITY, layer: "Opportunity" });
  vault.linkNodes(OUTCOME, OPPORTUNITY);
  put({ title: SOLUTION, layer: "Solution" });
  vault.linkNodes(OPPORTUNITY, SOLUTION);
  put({ title: ASSUMPTION, layer: "AssumptionTest" });
  vault.linkNodes(SOLUTION, ASSUMPTION);
}

/**
 * One planting per rule — how the violation arrives from outside the tool
 * surface, which is the case R4 is about (the forging paths are R5's).
 *
 * Each is kept to *its own* rule where the layer rules allow: a planted Solution
 * carries an assumption test so it does not also move `solutionsMissingAssumptions`,
 * and the rules that need no particular layer are planted on an Opportunity.
 */
const PLANT: Record<string, () => void> = {
  "single-outcome": () => put({ title: "A rival mandate", layer: "Outcome" }),
  "dangling-link": () => vault.linkNodes(OPPORTUNITY, "Ghost opportunity"),
  "wrapped-wikilink": () => {
    fs.writeFileSync(
      path.join(dir, fileNameForTitle("Hand written note")),
      serialize({
        title: "Hand written note",
        layer: "Opportunity",
        evidence: "assertion",
        body: "hard-wrapped by the editor: see [[Ship a\nchangelog]] for the shape of it",
        tags: [],
        links: [],
      }),
      "utf8",
    );
    vault.linkNodes(OUTCOME, "Hand written note");
  },
  "opportunity-connected": () => put({ title: "Adrift", layer: "Opportunity" }),
  "solution-mapped": () => {
    put({ title: "Unmapped idea", layer: "Solution" });
    put({ title: "Whether anyone asked for it", layer: "AssumptionTest" });
    vault.linkNodes("Unmapped idea", "Whether anyone asked for it");
  },
  "assumption-mapped": () => put({ title: "Unmapped test", layer: "AssumptionTest" }),
  "evidence-class": () => {
    put({ title: "A legacy gap", layer: "Opportunity", evidence: undefined });
    vault.linkNodes(OUTCOME, "A legacy gap");
  },
  "no-self-validation": () => {
    put({ title: "A planted win", layer: "Opportunity", tags: ["unvalidated"], status: "validated" });
    vault.linkNodes(OUTCOME, "A planted win");
  },
  "lane-conflict": () => {
    put({ title: "Diff two builds", layer: "AssumptionTest", body: "Compare manifests offline. Lane: compute-only." });
    vault.linkNodes(SOLUTION, "Diff two builds");
    vault.setLane("Diff two builds", "humans-required", "by human — a person reads the manifests");
  },
};

/** `min: 0`, so the *other* three `done` terms cannot mask the hygiene one. */
const work = () => computeNextWork(new Vault(dir), dir, 0);

/** What `/ost-pass` does with `hygieneIssues`: annotate each, re-read, repeat. */
function annotateUntilQuiet(passes = 4): void {
  for (let i = 0; i < passes && !work().done; i++) {
    for (const issue of work().hygieneIssues) vault.annotate(issue.title, issue.issue);
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-parity-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  vault = new Vault(dir);
  legalTree();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("every invariant rule is classified — computed or declared", () => {
  test("the rule list is grepped from the source and is not empty", () => {
    expect(RULES.length).toBeGreaterThanOrEqual(9);
    expect(RULES).toContain("evidence-class");
  });

  test("the two maps partition the rules — none unclassified, none in both", () => {
    const labelled = Object.keys(HYGIENE_LABELS);
    const declared = Object.keys(NOT_DONE_BLOCKING);
    expect([...labelled, ...declared].sort()).toEqual(RULES);
    expect(labelled.filter((r) => r in NOT_DONE_BLOCKING)).toEqual([]);
  });

  test("the non-blocking set is exactly one rule — downgrading a second needs this line edited", () => {
    // The one assertion here that a declaration cannot satisfy on its own. Every
    // other test in this file passes just as happily whether a rule blocks `done`
    // or is declared not to, because "not a blocker" is a decision rather than a
    // fact about the tree. This is what makes quietly moving a rule out of the
    // blocking set a build failure, and therefore an argument someone has to make
    // in a diff rather than a line that slips through.
    expect(Object.keys(NOT_DONE_BLOCKING)).toEqual(["single-outcome"]);
  });

  test("every non-blocking declaration states a reason, not just a name", () => {
    for (const [rule, why] of Object.entries(NOT_DONE_BLOCKING)) {
      expect(why.length, `${rule} is declared a non-blocker with no reason`).toBeGreaterThan(80);
    }
  });

  test("the hygiene-only rules are the ones with no invariant behind them", () => {
    // Stricter-than-`check` is the safe direction and is allowed; it just has to
    // be named here rather than discovered as an unmatched rule string.
    for (const rule of HYGIENE_ONLY_RULES) expect(RULES).not.toContain(rule);
  });

  test("the fixture is legal before anything is planted", () => {
    expect(checkInvariants(vault.readTree())).toEqual([]);
    expect(work().done).toBe(true);
  });
});

describe("a label is backed by a detector — each blocking rule turns done false", () => {
  for (const rule of Object.keys(HYGIENE_LABELS)) {
    test(`${rule}: planted out of band, it blocks done and is reported under its rule`, () => {
      PLANT[rule]();
      expect(checkInvariants(vault.readTree()).some((v) => v.rule === rule), "the plant did not violate the rule").toBe(true);

      const w = work();
      expect(w.hygieneIssues.map((i) => i.rule)).toContain(rule);
      expect(w.done).toBe(false);
    });
  }
});

describe("a declared non-blocker is red on check and silent on done", () => {
  for (const rule of Object.keys(NOT_DONE_BLOCKING)) {
    test(`${rule}: check reports it, done ignores it — permanently, by declaration`, () => {
      PLANT[rule]();
      expect(checkInvariants(vault.readTree()).some((v) => v.rule === rule)).toBe(true);
      expect(work().hygieneIssues.map((i) => i.rule)).not.toContain(rule);

      // A second Outcome disturbs the reachability walk as well, so clear what a
      // sweep would clear first; what is left is the declared disagreement alone.
      annotateUntilQuiet();
      expect(work().done, "the sweep cannot reach done past the declared non-blocker").toBe(true);
      expect(checkInvariants(vault.readTree()).some((v) => v.rule === rule), "check went quiet too — then it was never a disagreement").toBe(true);
    });
  }
});

describe("the property: done implies every violation is declared or annotated", () => {
  /**
   * The R4 property, over every rule at once rather than one at a time — the
   * shape a single-rule test cannot catch, where one plant masks another.
   */
  function assertNoUndeclaredDisagreement(): void {
    const w = work();
    if (!w.done) return;
    const tree = vault.readTree();
    const index = new Map(tree.map((n) => [n.title, n]));
    for (const v of checkInvariants(tree)) {
      if (v.rule in NOT_DONE_BLOCKING) continue;
      const body = index.get(v.node ?? "")?.body ?? "";
      const annotated = new RegExp(`^-\\s+\\d{4}-\\d{2}-\\d{2}\\s+${HYGIENE_LABELS[v.rule]}:`, "m").test(body);
      expect(annotated, `done: true while ${v.rule} on "${v.node}" is red and unannotated`).toBe(true);
    }
  }

  test("all nine planted at once: done is false, and stays false until each is handled", () => {
    for (const plant of Object.values(PLANT)) plant();
    expect(work().done).toBe(false);
    assertNoUndeclaredDisagreement();
  });

  test("annotating every issue reaches done, and each disagreement left is a written record", () => {
    for (const plant of Object.values(PLANT)) plant();
    annotateUntilQuiet();
    expect(work().done, "annotating every reported issue did not reach done").toBe(true);
    assertNoUndeclaredDisagreement();
  });

  test("repairing rather than annotating clears both gates together", () => {
    // The two the sweep can actually fix now that it holds ost_set_evidence (R7).
    PLANT["evidence-class"]();
    PLANT["assumption-mapped"]();
    expect(work().done).toBe(false);

    vault.setEvidence("A legacy gap", "assertion", "rests on founder theory");
    vault.linkNodes(SOLUTION, "Unmapped test");

    expect(checkInvariants(vault.readTree())).toEqual([]);
    expect(work().done).toBe(true);
  });
});
