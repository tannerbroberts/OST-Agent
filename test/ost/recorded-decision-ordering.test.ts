/**
 * How much of this tree can a recorded decision actually order — and does the
 * ranking refuse to position everything it cannot cite?
 *
 * This is the instrument for the tree node "Rank only what a recorded decision
 * already ordered, and leave the rest unranked", under the assumption test
 * "Count how much of the tree a recorded decision could actually order". The
 * candidate's guarantee — that the agent never authors a priority — is not in
 * doubt and is not what is measured here. **Coverage is the assumption:** the
 * mechanism is worthless if the honest answer it returns is a mostly-empty list.
 *
 * The bar was fixed on 2026-08-02, before this module existed and before
 * anything was swept: *at least 13 of the 32 under-served rows must trace to a
 * recorded decision that positions them; below 7 of 32 kills the candidate;
 * between 7 and 12 makes it a supplement to another candidate rather than an
 * answer on its own.*
 *
 * ## The denominator moved, and that is the finding
 *
 * The bar names 32 under-served rows. **This vault has one.** Everything else
 * that was under-served on 2026-08-02 has since been given solutions, so the row
 * set the bar was fixed over no longer exists at that size, and no reading of
 * a 1-row set can reach 13. That is asserted below by name rather than papered
 * over by rescaling the bar to a percentage — a bar quietly re-expressed to fit
 * the number it is judging is the failure the tree already carries a whole
 * bucket for ("My tests carry thresholds nobody ever fixed").
 *
 * So the sweep reports three readings of "the rows a ranking would order" — the
 * assumption test's literal one, the Outcome's own top-level rows (which is what
 * the root's Prioritization section actually grades), and the whole Opportunity
 * layer — and asserts the verdict of each by name.
 *
 * ## The controls are what carry this file
 *
 * A detector that called everything a decision would "support" the candidate on
 * any tree, and the first draft of this one did exactly that: reading `held`,
 * `gated` and `do not merge` as dispositions pulled in 215 passages of ordinary
 * prose and raised coverage from 25 rows to 73 on vocabulary alone. So the
 * planted cases below run first and in both directions — a record built to
 * position a row is measured as positioning it, and prose built to merely
 * discuss one is measured as positioning nothing — before the count over the
 * real tree is worth reading.
 *
 * The computation is `src/ost/recorded-decisions.ts`; the corpus is committed at
 * `test/fixtures/recorded-decisions/corpus.json`, cut by
 * `scripts/harvest-recorded-decision-corpus.ts`, and `PROVENANCE.md` there
 * records the vault and commit it came from and what a re-cut would change.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  citationReason,
  coverageOf,
  coverageVerdict,
  DECISION_KINDS,
  directionOf,
  extractDecisions,
  namesIn,
  orderByRecordedDecision,
  RECORDED_DECISION_RULE,
  type DecisionKind,
  type DecisionPassage,
} from "../../src/ost/recorded-decisions.js";
import { reasonProblem, type LedgerWorld } from "../../src/ost/ranked-ledger.js";
import { Vault } from "../../src/ost/vault.js";
import type { Layer, OstNode } from "../../src/ost/node.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.join(here, "..", "fixtures", "recorded-decisions", "corpus.json");

interface Corpus {
  vault: string;
  head: string;
  harvestedAt: string;
  layers: Record<string, number>;
  passages: DecisionPassage[];
  readings: { underserved: string[]; topLevel: string[]; allOpportunities: string[] };
}

const corpus = JSON.parse(fs.readFileSync(CORPUS, "utf8")) as Corpus;

/** A node literal — the extraction reads plain nodes, so a control needs no disk. */
function node(title: string, body: string, layer: Layer = "Opportunity", extra: Partial<OstNode> = {}): OstNode {
  return { title, layer, body, tags: [], links: [], created: "2026-01-01", ...extra };
}

describe("what counts as a recorded decision — the planted controls", () => {
  const ROWS = ["Row A", "Row B", "Row C"];

  test("a prioritization section positions the rows it names, in the order it names them", () => {
    const root = node(
      "Outcome",
      [
        "## Prioritization — row-by-row (2026-02-01, human-authorized)",
        "",
        '- **TARGET → "Row B"** — the only row whose tests create outside evidence.',
        '- **Sequenced-after-demand:** "Row A", "Row C". Hold until returning operators > 0.',
      ].join("\n"),
      "Outcome",
    );
    const tree = [root, ...ROWS.map((r) => node(r, "body"))];

    const { ranked, unranked } = orderByRecordedDecision(ROWS, extractDecisions(tree));
    expect(ranked.map((r) => r.title)).toEqual(["Row B", "Row A", "Row C"]);
    expect(unranked).toEqual([]);
    expect(ranked[0].citations[0]).toMatchObject({ kind: "prioritization-lane", node: "Outcome", direction: "advance" });
    expect(ranked[1].citations[0].direction).toBe("hold");
    // The citation quotes the sentence the row was named in, not the fragment.
    expect(ranked[0].citations[0].quote).toContain("Row B");
  });

  test("prose that merely mentions a row positions nothing — the 215-passage regression", () => {
    // Every one of these once registered as a decision. None of them is one:
    // they are a census note, a sibling comparison and a report of somebody
    // else's gate, each naming a row in passing.
    const tree = [
      node("Some census", 'The 2026-08-03 census counted 18. It grounds "Row A", which nothing here holds.'),
      node("Some sibling", '2026-08-11 adjudicated vs "Row B": DISTINCT, do not merge.'),
      node("Some ledger", 'Eight rows carry an explicit gate, and "Row C" is discussed in that light.'),
      ...ROWS.map((r) => node(r, "body")),
    ];

    const { ranked, unranked } = orderByRecordedDecision(ROWS, extractDecisions(tree));
    expect(ranked).toEqual([]);
    expect(unranked.map((u) => u.title)).toEqual(ROWS);
    expect(unranked[0].problem).toBe("no recorded decision in this vault positions this row");
  });

  test("a WIP hold counts only when it names a row, and this vault's holds name counts", () => {
    // Both are real hold declarations. Only the second one is citable per row,
    // and that difference is the whole reason coverage is what it is.
    const tree = [
      node("Ledger", '## Issues\n- 2026-03-01 WIP limit held on 20 of 23 underserved rows, deliberately.'),
      node("Ledger two", '## Issues\n- 2026-03-02 **Held: the remaining rows**, including "Row A".'),
      ...ROWS.map((r) => node(r, "body")),
    ];

    const { ranked, unranked } = orderByRecordedDecision(ROWS, extractDecisions(tree));
    expect(ranked.map((r) => r.title)).toEqual(["Row A"]);
    expect(ranked[0].citations[0].kind).toBe("wip-hold");
    expect(unranked.map((u) => u.title)).toEqual(["Row B", "Row C"]);
  });

  test("an evidence-debt gate positions the node it sits in; a later account of one does not", () => {
    const tree = [
      node("Row A", "**Evidence-debt gate (deliberate):** no solutions ideated under this node yet."),
      node("Row B", '## Issues\n- 2026-03-01 The evidence-debt gate on "Row A" is why that row is empty.'),
      node("Row C", "body"),
    ];

    const { ranked, unranked } = orderByRecordedDecision(ROWS, extractDecisions(tree));
    expect(ranked.map((r) => r.title)).toEqual(["Row A"]);
    expect(ranked[0].citations).toHaveLength(1);
    expect(ranked[0].citations[0]).toMatchObject({ kind: "evidence-debt-gate", node: "Row A", direction: "hold" });
    expect(unranked.map((u) => u.title)).toEqual(["Row B", "Row C"]);
  });

  test("a lane label positions the node carrying it, and nothing else", () => {
    const tree = [
      node("Row A", "body", "AssumptionTest", { lane: "compute-only" }),
      node("Row B", "body", "AssumptionTest"),
    ];
    const passages = extractDecisions(tree);
    expect(passages.filter((p) => p.kind === "lane-label").map((p) => p.names)).toEqual([["Row A"]]);
    expect(orderByRecordedDecision(["Row A", "Row B"], passages).unranked.map((u) => u.title)).toEqual(["Row B"]);
  });

  test("a quoted name that is not a live node names nothing", () => {
    const titles = new Set(["Row A"]);
    expect(namesIn('The lane holds "Row A" and "Row Z".', titles)).toEqual(["Row A"]);
    expect(namesIn('The lane holds "Row Z".', titles)).toEqual([]);
    expect(namesIn("The lane holds [[Row A]].", titles)).toEqual(["Row A"]);
  });

  test("a title hard-wrapped across a line break is still found", () => {
    // The `wrapped-wikilink` defect in a new place: this vault's prose is
    // hard-wrapped, and reading a split title as "no decision here" would be a
    // silent under-count rather than a visible one.
    const titles = new Set(["I have a tree full of unvalidated nodes"]);
    expect(namesIn('the lane holds "I have a tree full of\nunvalidated nodes" for now.', titles)).toEqual([
      "I have a tree full of unvalidated nodes",
    ]);
  });

  test("direction is read off stop-clauses and go-clauses, never sentiment", () => {
    expect(directionOf("Hold until external returning operators > 0.")).toBe("hold");
    expect(directionOf("Distribution becomes the critical path.")).toBe("advance");
    expect(directionOf("Target: this row, chosen because it carries no evidence-debt gate.")).toBe("mixed");
    expect(directionOf("Dogfood lane (real, observed, but produces no external evidence).")).toBe("unstated");
    // The regression that erased the contradiction: "every hope this tree holds"
    // is a verb, not a disposition.
    expect(directionOf("the gate in front of every external-evidence hope this tree holds")).toBe("unstated");
  });
});

describe("the order is read off the record, and nothing else moves it", () => {
  const decision = (title: string, date: string, order: number, names: string[], text: string): DecisionPassage => ({
    kind: "prioritization-lane",
    node: title,
    section: "Prioritization",
    date,
    text,
    names,
    direction: directionOf(text),
    order,
  });

  const PASSAGES = [
    decision("Root", "2026-02-01", 5, ["Row B", "Row C"], 'TARGET → "Row B", then "Row C".'),
    decision("Root", "2026-01-01", 9, ["Row A"], 'Hold until demand: "Row A".'),
  ];

  test("the earliest-dated decision governs, whatever order the passages arrive in", () => {
    const forwards = orderByRecordedDecision(["Row A", "Row B", "Row C"], PASSAGES);
    const backwards = orderByRecordedDecision(["Row A", "Row B", "Row C"], [...PASSAGES].reverse());
    expect(forwards.ranked.map((r) => r.title)).toEqual(["Row A", "Row B", "Row C"]);
    expect(backwards.ranked.map((r) => r.title)).toEqual(forwards.ranked.map((r) => r.title));
  });

  test("shuffling the rows cannot change the published order; editing the record can", () => {
    const shuffled = orderByRecordedDecision(["Row C", "Row B", "Row A"], PASSAGES);
    expect(shuffled.ranked.map((r) => r.title)).toEqual(["Row A", "Row B", "Row C"]);

    const redated = PASSAGES.map((p) => (p.names[0] === "Row A" ? { ...p, date: "2026-03-01" } : p));
    expect(orderByRecordedDecision(["Row A", "Row B", "Row C"], redated).ranked.map((r) => r.title)).toEqual([
      "Row B",
      "Row C",
      "Row A",
    ]);
  });

  test("ranks are 1-based and contiguous, and an unreached row is not ranked last — it is not ranked", () => {
    const o = orderByRecordedDecision(["Row A", "Row B", "Row C", "Row D"], PASSAGES);
    expect(o.ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(o.unranked.map((u) => u.title)).toEqual(["Row D"]);
  });

  test("two decisions pointing opposite ways are reported as a deadlock, not resolved", () => {
    // The live instance in the meta vault: a founder decision names the
    // distribution row the critical path while the row's own body gates it.
    const both = [
      decision("Root", "2026-02-01", 1, ["Row A"], 'Distribution becomes the critical path: "Row A".'),
      { ...decision("Row A", "2026-02-02", 2, ["Row A"], "**Evidence-debt gate (deliberate):** expand only when."), kind: "evidence-debt-gate" as DecisionKind },
    ];
    const [row] = orderByRecordedDecision(["Row A"], both).ranked;
    expect(row.contradicted).toBe(true);
    expect(row.citations.map((c) => c.direction)).toEqual(["advance", "hold"]);
    expect(citationReason(row)).toContain("pointing the other way");
  });

  test("a single passage whose own words point both ways is not called a contradiction", () => {
    const [row] = orderByRecordedDecision(
      ["Row A"],
      [decision("Root", "2026-02-01", 1, ["Row A"], 'Target: "Row A" — chosen because it carries no evidence-debt gate.')],
    ).ranked;
    expect(row.citations[0].direction).toBe("mixed");
    expect(row.contradicted).toBe(false);
  });
});

describe("end to end, against a vault on disk", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-decisions-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("a decision written into a vault is the ordering the vault publishes", () => {
    const vault = new Vault(dir);
    vault.createNode({
      title: "Users churn after week one",
      layer: "Opportunity",
      evidence: "assertion",
      body: "**Evidence-debt gate (deliberate):** no solutions ideated under this node yet.",
      tags: [],
      links: [],
    });
    vault.createNode({
      title: "Nobody can find the product",
      layer: "Opportunity",
      evidence: "assertion",
      body: "b",
      tags: [],
      links: [],
    });

    const rows = ["Users churn after week one", "Nobody can find the product"];
    const o = orderByRecordedDecision(rows, extractDecisions(vault.readTree()));
    expect(o.ranked.map((r) => r.title)).toEqual(["Users churn after week one"]);
    expect(o.unranked.map((u) => u.title)).toEqual(["Nobody can find the product"]);
  });
});

describe("the sweep over this vault — what a recorded decision could actually order", () => {
  const world = (): LedgerWorld => ({
    titles: new Set([
      ...corpus.passages.map((p) => p.node),
      ...corpus.readings.allOpportunities,
      ...corpus.readings.topLevel,
    ]),
    evidenceIds: new Set<string>(),
    rankable: [],
  });

  test("the corpus is the whole tree, not a sample", () => {
    // Same guard the unblock-leverage fixture carries: a re-cut that quietly
    // became a selection would move every number below without saying so.
    expect(corpus.layers).toEqual({
      Outcome: 1,
      Opportunity: 163,
      Solution: 441,
      Assumption: 495,
      AssumptionTest: 494,
      Unknown: 2,
    });
    expect(corpus.readings.allOpportunities).toHaveLength(corpus.layers.Opportunity);
    expect(corpus.head).toMatch(/^[0-9a-f]{40}$/);
  });

  test("the bar is the one fixed on 2026-08-02, and it is applied as written", () => {
    expect(RECORDED_DECISION_RULE).toMatchObject({ fixed: "2026-08-02", denominator: 32, pass: 13, kill: 7 });
    expect(coverageVerdict(13)).toBe("supports");
    expect(coverageVerdict(12)).toBe("supplement");
    expect(coverageVerdict(7)).toBe("supplement");
    expect(coverageVerdict(6)).toBe("kills");
  });

  test("the denominator the bar was fixed over no longer exists: 1 under-served row, not 32", () => {
    // Not a rescaling and not a rounding. The row set the assumption test named
    // has been served down to a single row since the bar was written, so the
    // reading it asked for cannot reach 13 by construction — and reports KILLS
    // for a reason that is arithmetic rather than evidential.
    const r = coverageOf("underserved", corpus.readings.underserved, corpus.passages);
    expect(r.rows).toBe(1);
    expect(r.denominatorMoved).toBe(true);
    expect(r.positioned).toBe(0);
    expect(r.verdict).toBe("kills");
  });

  test("over the rows the root's Prioritization section actually grades: 20 of 37 — SUPPORTS", () => {
    const r = coverageOf("top-level", corpus.readings.topLevel, corpus.passages);
    expect(r.rows).toBe(37);
    expect(r.positioned).toBe(20);
    expect(r.verdict).toBe("supports");
    expect(r.denominatorMoved).toBe(true);
    // Where the coverage comes from, and it is concentrated: one section of one
    // node carries thirteen of the twenty.
    expect(r.byKind).toEqual({
      "prioritization-lane": 13,
      "founder-decision": 0,
      "evidence-debt-gate": 6,
      "wip-hold": 1,
      "lane-label": 0,
    });
    expect(r.ordering.ranked[0].title).toBe("I can't tell if anyone outside my own head wants this");
    expect(r.ordering.unranked).toHaveLength(17);
  });

  test("over the whole opportunity layer: 22 of 163 — the tail is most of the tree", () => {
    const r = coverageOf("all-opportunities", corpus.readings.allOpportunities, corpus.passages);
    expect(r.positioned).toBe(22);
    expect(r.rows).toBe(163);
    expect(r.verdict).toBe("supports");
    // 141 rows no recorded decision reaches. The candidate's honest answer over
    // the whole tree IS the long unranked tail its own node warned about.
    expect(r.ordering.unranked).toHaveLength(141);
  });

  test("the coverage rests on one section of one node, and the sensitivity is measured", () => {
    // Thirteen of the twenty first citations come from the root's
    // `## Prioritization — row-by-row (2026-07-24)`. Without it the mechanism
    // stops being an answer on its own and becomes a supplement — which is the
    // difference between two of the assumption test's three pre-committed
    // verdicts, decided by one heading in one file.
    const without = corpus.passages.filter((p) => p.kind !== "prioritization-lane");
    const r = coverageOf("top-level", corpus.readings.topLevel, without);
    expect(r.positioned).toBe(9);
    expect(r.verdict).toBe("supplement");
  });

  test("the deadlock the node predicted is in the record, and is published as one", () => {
    const r = coverageOf("top-level", corpus.readings.topLevel, corpus.passages);
    const contradicted = r.ordering.ranked.filter((x) => x.contradicted);
    expect(contradicted.map((x) => x.title)).toEqual(["No one outside my own network could discover this product exists"]);
    expect(contradicted[0].citations.map((c) => c.direction)).toEqual(["hold", "advance"]);
  });

  test("lane labels exist in quantity and position no row a ranking would order", () => {
    // 60 of them, every one on an assumption test. The assumption test lists
    // lane labels as one of the five things that could position a row; over this
    // vault they position none, because they live two layers below the rows.
    const labels = corpus.passages.filter((p) => p.kind === "lane-label");
    expect(labels.length).toBeGreaterThan(50);
    const rows = new Set(corpus.readings.allOpportunities);
    expect(labels.filter((p) => p.names.some((n) => rows.has(n)))).toEqual([]);
  });

  test("every kind the rule recognises is a kind the extraction can produce", () => {
    // A kind nothing can emit is a category that will read as "absent from the
    // vault" forever, which is the difference between a floor and a measurement.
    const found = new Set<DecisionKind>(corpus.passages.map((p) => p.kind));
    expect([...DECISION_KINDS].filter((k) => !found.has(k))).toEqual([]);
  });

  test("every reason published beside a rank survives the ledger's independent refusal", () => {
    // `ranked-ledger.ts` asks a question this module never sees: does the reason
    // cite a live node title or a stored evidence id? A row ranked here is one
    // that ledger would publish, and it is checked by the ledger's own function.
    const w = world();
    for (const reading of [corpus.readings.topLevel, corpus.readings.allOpportunities]) {
      for (const row of coverageOf("x", reading, corpus.passages).ordering.ranked) {
        expect(reasonProblem(citationReason(row), w), row.title).toBeNull();
      }
    }
  });

  test("nothing is ranked that no citation reaches", () => {
    // The structural claim, checked rather than asserted: every published rank
    // carries at least one citation, and every citation names a passage that is
    // in the corpus.
    const passages = new Set(corpus.passages.map((p) => `${p.node}|${p.section}`));
    for (const reading of [corpus.readings.topLevel, corpus.readings.allOpportunities]) {
      for (const row of coverageOf("x", reading, corpus.passages).ordering.ranked) {
        expect(row.citations.length).toBeGreaterThan(0);
        for (const c of row.citations) expect(passages.has(`${c.node}|${c.section}`)).toBe(true);
      }
    }
  });
});
