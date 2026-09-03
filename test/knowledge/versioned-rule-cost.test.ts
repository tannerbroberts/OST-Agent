/**
 * Instrument for "Count how many existing rules would need a conditional to
 * support two live versions", beneath "Supporting two live ruleset versions
 * costs few enough conditionals to stay maintainable" and its solution "The tree
 * declares which ruleset version it was built under, and checks run against
 * that".
 *
 * **This is a cost measurement, not a correctness one.** Nobody doubts versioned
 * rules can be made to work. The question is whether the checking code
 * accumulates conditionals for standards nobody has used in months — a permanent
 * cost paid for an occasional disruption. So the two bars this file asserts are
 * the node's own: version awareness across the current rule set and its
 * predecessor costs at most 5 conditionals, and the extrapolation to a year
 * stays under 20.
 *
 * **The number could be a lie, so three things check it rather than take it.**
 * A cost measured off a hand-written table is worth what the table is worth, and
 * the whole result turns on the claim that a rule ADDED in a version costs no
 * conditional of its own:
 *
 *   1. **By execution.** Every rule the lineage does not mark as changed in
 *      place must return byte-identical verdicts under both live versions, over
 *      a corpus that violates every rule this checker can emit. A rule with a
 *      hidden version branch fails here.
 *   2. **By source scan.** `src/eval/invariants.ts` is grepped for reads of the
 *      declared version. A fourth one appearing without a recorded boundary
 *      fails the build, so the count cannot drift away from the code it claims
 *      to describe.
 *   3. **By closure.** Every rule id the checker can emit must be recorded in
 *      the lineage, or the lineage filter would silently drop it from every
 *      version at once — a check that stopped checking, reported as clean.
 *
 * **Read a green result pessimistically.** Two consecutive versions are the most
 * similar pair available, so the two-version count is the optimistic end of the
 * estimate by construction. The year projection is the pessimistic end: it
 * assumes nothing is ever retired, which the design does not require. If the
 * extrapolation is what fails, that is the honest signal and not a technicality.
 *
 * **What green here does NOT settle.** Whether an operator whose tree is
 * stranded out of compliance would rather be migrated than grandfathered. That
 * is a preference about their own work and belongs to a person; no count of
 * conditionals confers it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  CHECK_RULESET_VERSIONS,
  LATEST_CHECK_RULESET,
  VERDICT_PRESERVING_COMMITS,
  RECORDED_SPAN_DAYS,
  behaviourLiveIn,
  rulesLiveIn,
  versionCost,
  yearProjection,
} from "../../src/knowledge/check-ruleset.js";
import { checkInvariants, type Violation } from "../../src/eval/invariants.js";
import {
  declareRuleset,
  previewAdoption,
  readDeclaredRuleset,
  resolveDeclaredRuleset,
} from "../../src/ost/declared-ruleset.js";
import type { OstNode } from "../../src/ost/node.js";
import type { QuarantinedNode } from "../../src/ost/quarantine.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Every rule `checkInvariants` can emit, read out of the source rather than listed. */
const EMITTABLE_RULES: string[] = (() => {
  const src = fs.readFileSync(path.join(repoRoot, "src/eval/invariants.ts"), "utf8");
  return [...new Set([...src.matchAll(/rule: "([a-z-]+)"/g)].map((m) => m[1]))].sort();
})();

/** The two live versions: the current rule set and the one before it. */
const CURRENT = LATEST_CHECK_RULESET;
const PREDECESSOR = CHECK_RULESET_VERSIONS[CHECK_RULESET_VERSIONS.length - 2].id;
const GRANDPARENT = CHECK_RULESET_VERSIONS[CHECK_RULESET_VERSIONS.length - 3].id;

function node(title: string, layer: OstNode["layer"], links: string[] = [], extra: Partial<OstNode> = {}): OstNode {
  return { title, layer, links, tags: [], body: "", evidence: "assertion", ...extra } as OstNode;
}

/**
 * A tree that violates every rule this checker can emit, so "identical verdicts"
 * is a claim about firing rules rather than about silence.
 *
 * Built in memory rather than on disk: the subject is `checkInvariants`, and a
 * vault round-trip would put a serializer between the corpus and the thing being
 * measured.
 */
function corpus(): { tree: OstNode[]; quarantined: QuarantinedNode[] } {
  const tree: OstNode[] = [
    // Two Outcomes — single-outcome. The first also links a Solution directly
    // (outcome-files-categories) and a title nothing carries (dangling-link).
    node("Root", "Outcome", ["Bucket", "Loose solution", "No such node"]),
    node("Second root", "Outcome", []),

    node("Bucket", "Opportunity", ["Shared belief", "Held twice"]),
    node("Adrift", "Opportunity", []), // opportunity-connected

    node("Loose solution", "Solution", ["Shared belief"]), // second parent → single-parent
    node("Orphan solution", "Solution", []), // solution-mapped
    node("Held twice", "Solution", ["Orphan test"]),

    node("Shared belief", "Assumption", ["Cycle A", "Cycle B"]),
    node("Orphan belief", "Assumption", []), // assumption-mapped
    node("Orphan test", "AssumptionTest", []),
    node("Loose test", "AssumptionTest", []), // test-mapped

    // rung-unearned: a measurement rung with nothing behind it.
    node("Priced claim", "Solution", [], { evidence: "money", source: "INBOX:note.md" }),

    // evidence-class: no rung declared at all.
    node("Unlabelled", "Solution", [], { evidence: undefined }),

    // no-self-validation: the #unvalidated tag beside status: validated.
    node("Both at once", "Solution", [], { tags: ["unvalidated"], status: "validated" }),

    // wrapped-wikilink and single-backlink, from one body: the wrapped one is
    // not an edge, and the intact one is a second link onto an already-linked title.
    node("Prose linker", "Solution", [], {
      body: "See [[A wrapped\ntitle]] and also [[Orphan test]] for the argument.",
    }),

    // prerequisite-unknown and prerequisite-cycle.
    node("Cycle A", "AssumptionTest", [], { prerequisites: ["Cycle B"] }),
    node("Cycle B", "AssumptionTest", [], { prerequisites: ["Cycle A", "Nobody wrote this"] }),

    // lane-conflict: the label and the prose answer "may compute run this?" differently.
    node("Two answers", "AssumptionTest", [], {
      lane: "compute-only",
      body: "**Lane: humans-required.** Somebody has to sit with an operator for this.",
    }),
  ];

  const quarantined: QuarantinedNode[] = [
    {
      file: "Unreadable type.md",
      title: "Unreadable type",
      unrecognizedType: "Metric",
      tags: [],
      links: ["Loose test"],
      body: "",
    },
  ];
  return { tree, quarantined };
}

/** Verdicts under one ruleset, keyed so two runs can be compared exactly. */
function verdicts(ruleset: string): Map<string, string[]> {
  const { tree, quarantined } = corpus();
  const out = new Map<string, string[]>();
  for (const v of checkInvariants(tree, quarantined, { ruleset })) {
    const list = out.get(v.rule);
    const line = `${v.node ?? ""} :: ${v.detail}`;
    if (list) list.push(line);
    else out.set(v.rule, [line]);
  }
  for (const list of out.values()) list.sort();
  return out;
}

describe("the corpus is worth measuring over", () => {
  test("every rule the checker can emit actually fires on it — a silent corpus proves nothing", () => {
    const fired = new Set(verdicts(CURRENT).keys());
    const silent = EMITTABLE_RULES.filter((r) => !fired.has(r) && rulesLiveIn(CURRENT).has(r));
    expect(silent, `these rules never fire on the corpus, so "identical verdicts" says nothing about them`).toEqual([]);
  });

  test("every rule the checker can emit is recorded in the lineage", () => {
    const everRecorded = new Set<string>();
    for (const version of CHECK_RULESET_VERSIONS) for (const rule of version.adds) everRecorded.add(rule);
    // The other direction matters more: a rule the lineage never records would be
    // filtered out of EVERY version, so a check that stopped checking would read clean.
    const unrecorded = EMITTABLE_RULES.filter((r) => !everRecorded.has(r));
    expect(unrecorded, "add these to CHECK_RULESET_VERSIONS — an unrecorded rule is filtered out of every version").toEqual([]);
  });
});

describe("what supporting two live versions costs", () => {
  test("the current rule set and the one before it cost at most 5 conditionals", () => {
    const cost = versionCost([PREDECESSOR, CURRENT]);

    // The node's bar.
    expect(cost.conditionals).toBeLessThanOrEqual(5);

    // And the number that makes it interesting, stated so a reader sees the
    // shape rather than only the verdict: five rules changed verdict across this
    // boundary and they cost ONE conditional between them, because the change
    // was already parameterised.
    expect(cost.flags).toEqual(["quarantine-tolerance"]);
    expect(cost.rulesChanged.length).toBeGreaterThan(cost.flags.length);
  });

  test("a third live version costs no more than the second — the churn is lineage, not conditionals", () => {
    const two = versionCost([PREDECESSOR, CURRENT]);
    const three = versionCost([GRANDPARENT, PREDECESSOR, CURRENT]);
    expect(three.conditionals).toBe(two.conditionals);
    // Not because nothing happened between them: rules came into force, and the
    // lineage filter absorbed all of them.
    expect(three.rulesGatedByLineage.length).toBeGreaterThan(two.rulesGatedByLineage.length);
  });

  test("holding EVERY recorded version live at once still costs three", () => {
    const all = versionCost(CHECK_RULESET_VERSIONS.map((v) => v.id));
    expect(all.conditionals).toBe(3);
    expect(all.conditionals).toBeLessThanOrEqual(5);
  });
});

describe("the count is not understated", () => {
  test("every rule the lineage does not mark as changed returns identical verdicts under both live versions", () => {
    const before = verdicts(PREDECESSOR);
    const after = verdicts(CURRENT);
    const changed = new Set(versionCost([PREDECESSOR, CURRENT]).rulesChanged);
    const gated = new Set(versionCost([PREDECESSOR, CURRENT]).rulesGatedByLineage);

    for (const rule of EMITTABLE_RULES) {
      if (changed.has(rule) || gated.has(rule)) continue;
      expect(after.get(rule) ?? [], `[${rule}] differs across the two live versions but declares no flag`).toEqual(
        before.get(rule) ?? [],
      );
    }
  });

  test("the rules the lineage DOES mark as changed really do differ — a flag with no branch behind it is a lie too", () => {
    const before = verdicts(PREDECESSOR);
    const after = verdicts(CURRENT);
    const differing = new Set(
      EMITTABLE_RULES.filter(
        (rule) => JSON.stringify(before.get(rule) ?? []) !== JSON.stringify(after.get(rule) ?? []),
      ),
    );
    expect(differing.size).toBeGreaterThan(0);
    for (const rule of differing) {
      expect(versionCost([PREDECESSOR, CURRENT]).rulesChanged, `[${rule}] moved but the lineage does not say so`).toContain(rule);
    }
  });

  test("the checking code reads the declared version in exactly the places the lineage accounts for", () => {
    const src = fs.readFileSync(path.join(repoRoot, "src/eval/invariants.ts"), "utf8");
    const flagReads = [...src.matchAll(/behaviourLiveIn\(/g)].length;
    const lineageReads = [...src.matchAll(/rulesLiveIn\(/g)].length;

    // One per recorded behavioural flag, and exactly one shared lineage filter.
    const flags = new Set(CHECK_RULESET_VERSIONS.flatMap((v) => v.changes.map((c) => c.flag)));
    expect(flagReads).toBe(flags.size);
    expect(lineageReads).toBe(1);
    expect(flagReads + lineageReads).toBe(versionCost(CHECK_RULESET_VERSIONS.map((v) => v.id)).conditionals);
  });
});

describe("the extrapolation", () => {
  test("a year of tightenings at the observed rate stays under 20 conditionals", () => {
    const projection = yearProjection();

    // Non-vacuity: the rate is taken off a real span with real boundaries in it.
    expect(RECORDED_SPAN_DAYS).toBeGreaterThan(30);
    expect(projection.boundariesObserved).toBeGreaterThanOrEqual(10);
    expect(projection.flagsObserved).toBeGreaterThan(0);

    // The node's second bar, assuming NOTHING is ever retired — which the design
    // does not require and which is why this is the pessimistic end.
    expect(projection.conditionals).toBeLessThan(20);
  });

  test("the rate is the rate of VERDICT changes, and most traffic through the checking code is not that", () => {
    // The naive estimate counts commits. Six of the eighteen commits over the
    // recorded span moved no verdict at all, and counting those would have put
    // the year at five times the real figure — so the classification is the
    // load-bearing part of the projection, not a detail of it.
    expect(VERDICT_PRESERVING_COMMITS.length).toBeGreaterThan(0);
    const commits = CHECK_RULESET_VERSIONS.length + VERDICT_PRESERVING_COMMITS.length;
    const naive = (commits * 365) / RECORDED_SPAN_DAYS;
    expect(naive).toBeGreaterThan(20);
  });
});

describe("a tree declares which ruleset it was built under, and checks run against that", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-ruleset-version-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("an undeclared vault is held to the LATEST, and is told that it is a default", () => {
    const resolution = resolveDeclaredRuleset(dir);
    expect(resolution.version).toBe(LATEST_CHECK_RULESET);
    expect(resolution.source).toBe("default");
    expect(resolution.reason).toMatch(/no declared ruleset version/);
    expect(resolution.reason).toContain("ost-agent ruleset-version --adopt");
  });

  test("a declared version is what the checks run against, and a tightening it predates does not fire", () => {
    // Before the prerequisite rules existed, a cycle was not a violation.
    const beforePrerequisites = CHECK_RULESET_VERSIONS.find((v) => v.id === "2026-08-05c")!.id;
    declareRuleset(dir, { version: beforePrerequisites, by: "Tanner", now: "2026-09-02T10:00:00.000Z" });

    const resolution = resolveDeclaredRuleset(dir);
    expect(resolution.source).toBe("declared");
    expect(resolution.version).toBe(beforePrerequisites);
    expect(resolution.behind).toBeGreaterThan(0);

    const { tree, quarantined } = corpus();
    const held = checkInvariants(tree, quarantined, { ruleset: resolution.version }).map((v: Violation) => v.rule);
    expect(held).not.toContain("prerequisite-cycle");
    expect(held).not.toContain("prerequisite-unknown");
    // And the rules it WAS built under still fire — grandfathering is not amnesty.
    expect(held).toContain("single-parent");
    expect(held).toContain("evidence-class");
  });

  test("adoption shows exactly what would newly fail, computed by running the gate rather than reasoning about it", () => {
    const { tree, quarantined } = corpus();
    const preview = previewAdoption(tree, quarantined, "2026-08-05c", LATEST_CHECK_RULESET);

    expect(preview.rulesAdded).toEqual(["prerequisite-cycle", "prerequisite-unknown"]);
    expect(preview.crossing.map((c) => c.id)).toEqual(["2026-08-30", "2026-08-31"]);
    expect(preview.newlyFailing.map((v) => v.rule)).toContain("prerequisite-cycle");

    // The preview IS the gate: every violation it predicts is one the checker
    // produces at the target version.
    const atTarget = new Set(
      checkInvariants(tree, quarantined, { ruleset: LATEST_CHECK_RULESET }).map((v) => `${v.rule} ${v.node ?? ""} ${v.detail}`),
    );
    for (const v of preview.newlyFailing) expect(atTarget.has(`${v.rule} ${v.node ?? ""} ${v.detail}`)).toBe(true);
  });

  test("adopting is an explicit act with a name on it, and it is recorded", () => {
    expect(() => declareRuleset(dir, { version: LATEST_CHECK_RULESET, by: "  ", now: "2026-09-02T10:00:00.000Z" })).toThrow(
      /name/i,
    );
    expect(() => declareRuleset(dir, { version: "2027-01-01", by: "Tanner", now: "2026-09-02T10:00:00.000Z" })).toThrow(
      /not a ruleset version/i,
    );

    declareRuleset(dir, { version: "2026-08-30", by: "Tanner", now: "2026-09-02T10:00:00.000Z" });
    declareRuleset(dir, { version: LATEST_CHECK_RULESET, by: "Tanner", now: "2026-09-03T10:00:00.000Z" });
    const stored = readDeclaredRuleset(dir)!;
    expect(stored.current.version).toBe(LATEST_CHECK_RULESET);
    // History only grows — which adoption was taken when is the record that says
    // whether a count moved because the tree changed or because the bar did.
    expect(stored.history.map((h) => h.version)).toEqual(["2026-08-30", LATEST_CHECK_RULESET]);
  });

  test("a declaration nothing recognises falls to the latest rather than to checking nothing", () => {
    fs.mkdirSync(path.join(dir, ".ost-agent/state"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".ost-agent/state/ruleset-version.json"),
      JSON.stringify({ current: { version: "1999-01-01", at: "2026-09-02T10:00:00.000Z", by: "Tanner" }, history: [] }),
      "utf8",
    );
    const resolution = resolveDeclaredRuleset(dir);
    expect(resolution.version).toBe(LATEST_CHECK_RULESET);
    expect(resolution.unrecognised).toBe("1999-01-01");
    expect(behaviourLiveIn("quarantine-tolerance", resolution.version)).toBe(true);
  });
});
