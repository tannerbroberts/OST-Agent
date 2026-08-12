import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  applyCritic,
  annotationFor,
  criticPass,
  objection,
  renderCritic,
  type Objection,
} from "../../src/eval/critic.js";
import { entriesUnder } from "../../src/ost/headings.js";
import type { OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";

/**
 * The two invariants that make the adversarial grounding judge a CRITIC rather
 * than another author, pinned from the solution node's own defining sentence:
 * it "never writes new opportunities and never removes anything — it lowers
 * unearned confidence."
 *
 * 1. A critic pass creates no nodes and removes nothing. Checked against a real
 *    vault on disk, not against the function's promises: same files before and
 *    after, every original line still present in order, twice-applied is
 *    once-applied.
 * 2. Every objection it emits names the evidence that would settle it. Checked
 *    at both ends: the constructor refuses an objection without one, and every
 *    objection a fully-planted tree produces carries one.
 *
 * What a green here does NOT settle, per the node: whether a human finds the
 * objections worth acting on, and whether the list stays small enough to read.
 * Those are the humans-required assumption test, and no assertion below grades
 * them.
 */

const node = (title: string, layer: OstNode["layer"], links: string[] = [], extra: Partial<OstNode> = {}): OstNode => ({
  title,
  layer,
  tags: [],
  links,
  body: "b",
  evidence: "assertion",
  ...extra,
});

/** A tree that claims only what it can back — the critic must have nothing to say. */
function cleanTree(): OstNode[] {
  return [
    // Outcome: validated by mandate, exempt by design.
    node("Out", "Outcome", ["Opp"], { status: "validated" }),
    // Honest floor: unvalidated, assertion. Honesty is not attackable.
    node("Opp", "Opportunity", ["Sol"], { status: "unvalidated" }),
    node("Sol", "Solution", ["Asm"], { status: "unvalidated" }),
    // A run test with a pre-committed bar.
    node("Asm", "AssumptionTest", [], {
      status: "unvalidated",
      threshold: "at least 4 of 10 rated worth acting on",
      body: "plan\n\n## Results\n- 2026-08-01 ran it (supported) — 6 of 10",
    }),
  ];
}

describe("the baseline is clean", () => {
  test("a tree that claims only what it can back draws zero objections", () => {
    // Every planted-violation test below is meaningless without this one.
    expect(criticPass(cleanTree()).objections).toEqual([]);
  });
});

describe("invariant: every objection names the evidence that would settle it", () => {
  test("the constructor refuses an objection with no settledBy", () => {
    expect(() => objection("N", "borrowed-voice", "a charge", "what is missing", "")).toThrow(/settledBy/);
    expect(() => objection("N", "borrowed-voice", "a charge", "what is missing", "   ")).toThrow(/noise/);
  });

  test("and an empty charge or missing is refused the same way", () => {
    expect(() => objection("N", "borrowed-voice", "", "m", "s")).toThrow(/charge/);
    expect(() => objection("N", "borrowed-voice", "c", "", "s")).toThrow(/missing/);
  });

  test("every objection a fully-planted tree produces carries all three parts", () => {
    const planted = [
      ...cleanTree(),
      // validated-on-nothing: promoted, nothing recorded beneath.
      node("Promoted opp", "Opportunity", [], { status: "validated" }),
      // unearned-rung: claims a measurement nobody made.
      node("Observed claim", "Solution", [], { evidence: "observed" }),
      // borrowed-voice: an outside party's rung, no party named.
      node("Stated claim", "Opportunity", [], { evidence: "stated", source: "agent:P3_ideate" }),
      // graded-after-the-fact: a result with no bar fixed before it.
      node("Unbarred test", "AssumptionTest", [], { body: "plan\n\n## Results\n- 2026-08-01 it went fine" }),
    ];
    const report = criticPass(planted);

    expect(report.objections.length).toBe(4);
    for (const o of report.objections) {
      expect(o.settledBy.trim()).not.toBe("");
      expect(o.missing.trim()).not.toBe("");
      expect(o.charge.trim()).not.toBe("");
      // The settling evidence survives into the annotation a node would carry.
      expect(annotationFor(o)).toContain(`Settled by: ${o.settledBy}`);
    }
    expect(report.objections.map((o) => o.rule).sort()).toEqual([
      "borrowed-voice",
      "graded-after-the-fact",
      "unearned-rung",
      "validated-on-nothing",
    ]);
  });

  test("flood control is structural: a node wrong two ways draws one objection, the strongest", () => {
    const planted = [...cleanTree(), node("Doubly wrong", "Opportunity", [], { status: "validated", evidence: "observed" })];
    const hits = criticPass(planted).objections.filter((o) => o.node === "Doubly wrong");
    expect(hits.length).toBe(1);
    expect(hits[0].rule).toBe("validated-on-nothing");
  });

  test("a backed claim is not attacked: a validated node with a result beneath it draws nothing", () => {
    const planted = [
      ...cleanTree(),
      node("Earned opp", "Opportunity", ["Ran test"], { status: "validated" }),
      node("Ran test", "AssumptionTest", [], { threshold: "at least 1", body: "p\n\n## Results\n- 2026-08-01 supported" }),
    ];
    expect(criticPass(planted).objections.filter((o) => o.node === "Earned opp")).toEqual([]);
  });

  test("a pass over nothing says it saw nothing rather than reading as clean", () => {
    expect(renderCritic(criticPass([]))).toMatch(/BLIND/);
  });
});

/**
 * On-disk half: the write invariant, checked against what the filesystem says
 * rather than what the module promises.
 */
describe("invariant: a critic pass creates no nodes and removes nothing", () => {
  let dir: string;

  const FIXTURE: Record<string, string> = {
    "Root outcome.md": `---
type: Outcome
status: validated
created: '2026-08-01'
evidence: assertion
---
#Outcome #evidence/assertion
[[Promoted opportunity]]
[[Honest opportunity]]

The mandate.
`,
    // Draws validated-on-nothing, and already carries an Issues entry that must survive.
    "Promoted opportunity.md": `---
type: Opportunity
status: validated
created: '2026-08-01'
evidence: assertion
---
#Opportunity #evidence/assertion

Promoted with nothing recorded beneath it.

## History
- 2026-08-01 status: unvalidated → validated (promoted by founder) — felt right

## Issues
- 2026-08-02 an annotation that was here before the critic ran
`,
    // Honest floor — must draw nothing and must not be touched.
    "Honest opportunity.md": `---
type: Opportunity
status: unvalidated
created: '2026-08-01'
evidence: assertion
---
#Opportunity #evidence/assertion

Rests on assertion and says so.
`,
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-critic-"));
    for (const [name, body] of Object.entries(FIXTURE)) fs.writeFileSync(path.join(dir, name), body);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const files = (): string[] => fs.readdirSync(dir).sort();
  const readAll = (): Map<string, string> => new Map(files().map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));

  /** Every line of `before`, still present in `after`, in the original order. */
  function preservesInOrder(before: string, after: string): boolean {
    const beforeLines = before.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    const afterLines = after.split("\n").map((l) => l.trim());
    let i = 0;
    for (const line of afterLines) if (i < beforeLines.length && line === beforeLines[i]) i++;
    return i === beforeLines.length;
  }

  test("applying the critic annotates and nothing else: no file created, no file gone, no line lost", () => {
    const vault = new Vault(dir);
    const before = readAll();

    const report = criticPass(vault.readTree());
    expect(report.objections.map((o) => o.node)).toEqual(["Promoted opportunity"]);

    const applied = applyCritic(vault, report);
    expect(applied.annotated).toEqual(["Promoted opportunity"]);

    // No create, no delete.
    expect(files()).toEqual([...before.keys()]);
    // Removes nothing: every original line survives, in order — including the
    // Issues entry that was there first and the History a human wrote.
    for (const [name, original] of before) {
      expect(preservesInOrder(original, fs.readFileSync(path.join(dir, name), "utf8")), name).toBe(true);
    }
    // The annotation landed where hygiene lives, under ## Issues, naming its settling evidence.
    const issues = entriesUnder(vault.read("Promoted opportunity").body, "## Issues");
    expect(issues.some((e) => e.includes("critic (validated-on-nothing)") && e.includes("Settled by:"))).toBe(true);
    // The untouched nodes are untouched to the byte.
    expect(fs.readFileSync(path.join(dir, "Honest opportunity.md"), "utf8")).toBe(before.get("Honest opportunity.md"));
  });

  test("a second pass raises nothing new: each charge lands once, not once per pass", () => {
    const vault = new Vault(dir);
    applyCritic(vault, criticPass(vault.readTree()));
    const afterFirst = readAll();

    const second = applyCritic(vault, criticPass(vault.readTree()));
    expect(second.annotated).toEqual([]);
    expect(second.alreadyRaised).toEqual(["Promoted opportunity"]);
    expect(readAll()).toEqual(afterFirst);
  });

  test("the critic's write surface cannot express creation: the tree it reads back is the tree it read", () => {
    const vault = new Vault(dir);
    const titlesBefore = vault
      .readTree()
      .map((n) => n.title)
      .sort();
    applyCritic(vault, criticPass(vault.readTree()));
    expect(
      vault
        .readTree()
        .map((n) => n.title)
        .sort(),
    ).toEqual(titlesBefore);
  });
});

/** Objection is exported for callers; keep the type honest in this spec too. */
const _typecheck: Objection = objection("N", "borrowed-voice", "c", "m", "s");
void _typecheck;
