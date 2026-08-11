/**
 * Evidence-extent decorrelation — the provenance half of duplicate detection.
 *
 * `dedupe.ts` compares wording; this compares what sibling opportunities REST
 * ON. Two opportunities restating one need in disjoint vocabulary are invisible
 * to token Jaccard (measured 0.29 on two names for the identical work item) and
 * exactly visible to their evidence extents. The verdicts are Torres's own
 * sibling semantics as set arithmetic: same extent ⇒ one concept, subset extent
 * ⇒ a child mis-hung as a sibling, entangled extents ⇒ rewrite each from its
 * own evidence.
 *
 * Unit tests run on the in-memory node shape; the integration block pins that
 * `computeNextWork` reports the issues on a real vault, that they block `done`,
 * and that an annotation clears them like every other hygiene rule.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { evidenceExtents, scanExtentOverlap, ENTANGLED_THRESHOLD, EXTENT_RULES, type ExtentNode } from "../../src/ost/extent.js";
import { computeNextWork, HYGIENE_ONLY_RULES } from "../../src/mcp/next-work.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { writeEvidence } from "../../src/processes/tree.js";
import { buildOstTools } from "../../src/security/tools.js";

const node = (title: string, layer: string, links: string[] = [], source?: string): ExtentNode =>
  source === undefined ? { title, layer, links } : { title, layer, links, source };

describe("evidenceExtents", () => {
  test("an opportunity's extent is everything its subtree cites, all layers, non-evidence sources ignored", () => {
    const nodes = [
      node("Outcome", "Outcome", ["Opp"]),
      node("Opp", "Opportunity", ["Sub", "Sol"], "INBOX:a.md"),
      node("Sub", "Opportunity", [], "INBOX:b.md"),
      node("Sol", "Solution", ["Test"], "WEB:example.com"), // not a stored-evidence claim
      node("Test", "AssumptionTest", [], "INBOX:c.md"),
    ];
    const extents = evidenceExtents(nodes);
    expect([...extents.get("Opp")!].sort()).toEqual(["INBOX:a.md", "INBOX:b.md", "INBOX:c.md"]);
    expect([...extents.get("Sub")!]).toEqual(["INBOX:b.md"]);
  });

  test("a cycle under-fills rather than hangs — the failure mode is a missed flag, never a spin", () => {
    const nodes = [
      node("A", "Opportunity", ["B"], "INBOX:a.md"),
      node("B", "Opportunity", ["A"], "INBOX:b.md"),
    ];
    const extents = evidenceExtents(nodes);
    expect(extents.get("A")!.has("INBOX:a.md")).toBe(true);
    expect(extents.get("B")!.has("INBOX:b.md")).toBe(true);
  });
});

describe("scanExtentOverlap verdicts", () => {
  const forest = (a: string[], b: string[]): ExtentNode[] => [
    node("Outcome", "Outcome", ["Alpha", "Beta"]),
    node("Alpha", "Opportunity", a.map((_, i) => `A${i}`)),
    node("Beta", "Opportunity", b.map((_, i) => `B${i}`)),
    ...a.map((id, i) => node(`A${i}`, "Opportunity", [], id)),
    ...b.map((id, i) => node(`B${i}`, "Opportunity", [], id)),
  ];

  test("same extent → shared-extent on the later sibling, naming the earlier", () => {
    const issues = [...scanExtentOverlap(forest(["INBOX:x.md"], ["INBOX:x.md"]))];
    // The sub-opportunities share the extent with their parents too; the sibling
    // pair under Outcome is what this asserts on.
    const top = issues.find((i) => i.title === "Beta");
    expect(top?.rule).toBe("shared-extent");
    expect(top?.issue).toContain('"Alpha"');
  });

  test("strict subset → subset-extent on the subset node, whichever sorts first", () => {
    const nodes = [
      node("Outcome", "Outcome", ["Broad", "Askew"]),
      node("Broad", "Opportunity", ["B0", "B1"]),
      node("Askew", "Opportunity", [], "INBOX:x.md"),
      node("B0", "Opportunity", [], "INBOX:x.md"),
      node("B1", "Opportunity", [], "INBOX:y.md"),
    ];
    const issue = [...scanExtentOverlap(nodes)].find((i) => EXTENT_RULES.includes(i.rule) && i.title === "Askew");
    expect(issue?.rule).toBe("subset-extent");
    expect(issue?.issue).toContain('beneath "Broad"');
  });

  test("crossing overlap at the threshold → entangled-extent; below it → silence", () => {
    // {1,2,3} vs {2,3,4}: 2 of 4 = 0.5 — at the threshold, flagged.
    const entangled = [...scanExtentOverlap(forest(["E:1.md", "E:2.md", "E:3.md"].map(inbox), ["E:2.md", "E:3.md", "E:4.md"].map(inbox)))];
    expect(entangled.find((i) => i.title === "Beta")?.rule).toBe("entangled-extent");
    // {1,2,3} vs {3,4,5}: 1 of 5 = 0.2 — the normal texture of a real space.
    const fine = [...scanExtentOverlap(forest(["E:1.md", "E:2.md", "E:3.md"].map(inbox), ["E:3.md", "E:4.md", "E:5.md"].map(inbox)))];
    expect(fine.find((i) => i.title === "Beta")).toBeUndefined();
  });

  test("cousins are never compared — distinctness is a sibling property", () => {
    const nodes = [
      node("Outcome", "Outcome", ["Left", "Right"]),
      node("Left", "Opportunity", ["Left leaf"]),
      node("Right", "Opportunity", ["Right leaf"]),
      node("Left leaf", "Opportunity", [], "INBOX:x.md"),
      node("Right leaf", "Opportunity", [], "INBOX:x.md"),
    ];
    // The leaves share an extent but are cousins; their PARENTS are the siblings
    // that inherit the shared record and get the flag.
    const issues = [...scanExtentOverlap(nodes)];
    expect(issues.map((i) => i.title)).not.toContain("Left leaf");
    expect(issues.map((i) => i.title)).not.toContain("Right leaf");
    expect(issues.find((i) => i.title === "Right")?.rule).toBe("shared-extent");
  });

  test("empty extents are skipped — wording scans own the nothing-cited case", () => {
    const nodes = [
      node("Outcome", "Outcome", ["Alpha", "Beta"]),
      node("Alpha", "Opportunity", []),
      node("Beta", "Opportunity", []),
    ];
    expect([...scanExtentOverlap(nodes)]).toEqual([]);
  });

  const inbox = (s: string) => `INBOX:${s.slice(2)}`;
});

describe("the hygiene channel", () => {
  let dir: string;
  const OUTCOME = "Retention";
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-extent-"));
    await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("extent rules are hygiene-only, block done on a real vault, and annotation clears them", async () => {
    for (const rule of EXTENT_RULES) expect(HYGIENE_ONLY_RULES as readonly string[]).toContain(rule);

    writeEvidence(
      dir,
      { id: "INBOX:pain.md", source: "INBOX:pain.md", title: "Pain", timestamp: "2026-08-11T00:00:00Z", body: "It hurts." },
      "inbox",
    );
    const v = buildPassContext(dir).vault;
    v.createNode({ title: "Exports keep failing", layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [], source: "INBOX:pain.md" });
    v.createNode({ title: "Downloads never finish", layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [], source: "INBOX:pain.md" });
    v.linkNodes(OUTCOME, "Exports keep failing");
    v.linkNodes(OUTCOME, "Downloads never finish");

    const before = computeNextWork(v, dir, 0);
    const flagged = before.hygieneIssues.find((h) => h.rule === "shared-extent");
    expect(flagged).toBeDefined();
    expect(before.done).toBe(false);

    // The clear path is the same one every hygiene rule has: annotate the node.
    const annotate = buildOstTools({ vault: v, dir, remote: { enabled: false } }).find(
      (t) => (t as unknown as { name: string }).name === "ost_annotate",
    ) as unknown as { run: (i: unknown) => Promise<string> };
    await annotate.run({ title: flagged!.title, issue: flagged!.issue });

    const after = computeNextWork(v, dir, 0);
    expect(after.hygieneIssues.find((h) => h.rule === "shared-extent")).toBeUndefined();
    expect(after.done).toBe(true);
  });
});
