/**
 * The standing tree briefing: regenerated in full each pass, and it names the
 * belief the tree is currently resting on.
 *
 * This is the instrument for the tree node "A standing briefing that teaches
 * the tree back, rather than reporting what changed in it". The node's claim is
 * that a briefing rebuilds the tree in a cold reader's head where a changelog
 * only lists deltas — so the spec pins the two things that make that mechanical:
 * the file is a pure derivation of the tree with nothing surviving from the
 * previous briefing, and it names the weakest rung of the believability rollup
 * (the belief the whole thing rests on) rather than assuming the reader knows.
 *
 * What a green here does not settle, per the node itself: the briefing is
 * derived by the same machinery whose reading it is meant to keep the operator
 * able to check, so a misread tree yields a confidently identical misreading.
 * Whether an operator can answer questions about their own tree from this file
 * alone is the humans-required test, and no assertion below reaches it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Layer, OstNode } from "../../src/ost/node.js";
import {
  STANDING_BRIEFING_FILENAME,
  composeStandingBriefing,
  regenerateStandingBriefing,
  standingBriefingPath,
} from "../../src/ost/standing-briefing.js";

let vault: string;

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-standing-briefing-"));
});
afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

function node(over: Partial<OstNode> & { title: string; layer: Layer }): OstNode {
  return { tags: [], links: [], body: "", ...over };
}

/**
 * A small wired tree: two buckets, the newest work under the first. Weakest
 * declared rung is `stated` (on the solution) — `money` and `observed` both
 * outrank it on the ladder. The Outcome carries `observed` too, for the same
 * reason a well-formed tree always labels it (`evidence-class` in
 * `eval/invariants.ts`): an unlabelled node now pulls the rollup's weakest rung
 * to the floor rather than being invisible to it, and a fixture that left the
 * Outcome unlabelled would silently be testing that bug instead of this belief.
 */
function fixtureTree(): OstNode[] {
  return [
    node({ title: "Ship the product", layer: "Outcome", evidence: "observed", links: ["Onboarding stalls", "Exports time out"] }),
    node({ title: "Onboarding stalls", layer: "Opportunity", evidence: "observed", created: "2026-08-01", links: ["Guided first run"] }),
    node({ title: "Guided first run", layer: "Solution", evidence: "stated", created: "2026-08-10" }),
    node({ title: "Exports time out", layer: "Opportunity", evidence: "money", created: "2026-07-01" }),
  ];
}

const TODAY = "2026-08-11";

describe("one stable address", () => {
  test("resolves to <vault>/.ost-agent/BRIEFING.md, absolute", () => {
    const p = standingBriefingPath(vault);
    expect(path.isAbsolute(p)).toBe(true);
    expect(p).toBe(path.join(vault, ".ost-agent", STANDING_BRIEFING_FILENAME));
  });

  test("two spellings of the same vault answer identically", () => {
    const relative = path.relative(process.cwd(), vault);
    expect(standingBriefingPath(relative)).toBe(standingBriefingPath(vault));
  });

  test("a regeneration lands at exactly that address", () => {
    const written = regenerateStandingBriefing(vault, fixtureTree(), TODAY);
    expect(written).toBe(standingBriefingPath(vault));
    expect(fs.existsSync(written)).toBe(true);
  });
});

describe("names the belief the tree is resting on", () => {
  test("the weakest declared rung, with its label — not just a rung id for insiders", () => {
    const briefing = composeStandingBriefing(fixtureTree(), TODAY);
    expect(briefing).toContain("stated (Stated intent or report)");
  });

  test("when a weaker claim enters the tree, the named belief follows the ladder down", () => {
    const tree = fixtureTree();
    tree.push(node({ title: "A theory of ours", layer: "Solution", evidence: "assertion", created: "2026-08-09" }));
    const briefing = composeStandingBriefing(tree, TODAY);
    expect(briefing).toContain("assertion (Founder or model assertion)");
    expect(briefing).not.toContain("stated (Stated intent or report)");
  });

  test("a tree where nothing declares a rung is reported as unweighed, never as resting on assertion", () => {
    // `weakestRung([])` answers the floor, but "assessed and found weak" and
    // "never assessed" must not read the same to a cold reader.
    const tree = fixtureTree().map((n) => {
      const { evidence: _evidence, ...rest } = n;
      return rest as OstNode;
    });
    const briefing = composeStandingBriefing(tree, TODAY);
    expect(briefing).toMatch(/declares a believability rung/i);
    expect(briefing).not.toContain("assertion (Founder or model assertion)");
  });
});

describe("regenerated in full each pass", () => {
  test("the briefing is a pure derivation of the tree — same tree, same bytes", () => {
    expect(composeStandingBriefing(fixtureTree(), TODAY)).toBe(composeStandingBriefing(fixtureTree(), TODAY));
  });

  test("nothing survives from the previous briefing: regenerating over an old one equals a fresh one", () => {
    regenerateStandingBriefing(vault, fixtureTree(), "2026-07-20");

    const moved: OstNode[] = [
      node({ title: "Ship the product", layer: "Outcome", links: ["Exports time out"] }),
      node({ title: "Exports time out", layer: "Opportunity", evidence: "money", created: "2026-07-01" }),
    ];
    regenerateStandingBriefing(vault, moved, TODAY);

    const over = fs.readFileSync(standingBriefingPath(vault), "utf8");
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "ost-standing-briefing-fresh-"));
    try {
      regenerateStandingBriefing(fresh, moved, TODAY);
      expect(over).toBe(fs.readFileSync(standingBriefingPath(fresh), "utf8"));
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
    // The branch that left the tree left the briefing — a stale sentence kept
    // "for the record" is exactly what this file must never carry.
    expect(over).not.toContain("Onboarding stalls");
    expect(over).not.toContain("2026-07-20");
  });

  test("unlike NEXT-BUILD, it keeps no history of itself — its history is git's job", () => {
    regenerateStandingBriefing(vault, fixtureTree(), "2026-07-20");
    regenerateStandingBriefing(vault, fixtureTree(), TODAY);
    const raw = fs.readFileSync(standingBriefingPath(vault), "utf8");
    expect(raw).not.toContain("## History");
    expect(raw).toContain(TODAY);
    expect(raw).not.toContain("2026-07-20");
  });
});

describe("written to be read cold: the tree's standing, not a diff", () => {
  test("says where the tree stands — the outcome and what is under it", () => {
    const briefing = composeStandingBriefing(fixtureTree(), TODAY);
    expect(briefing).toContain("Ship the product");
    expect(briefing).toContain("4 nodes");
  });

  test("names the live branch by the newest dated node it holds, and says why that counts as live", () => {
    const briefing = composeStandingBriefing(fixtureTree(), TODAY);
    // The newest node (2026-08-10) sits under "Onboarding stalls"; the other
    // bucket's newest is five weeks old.
    expect(briefing).toMatch(/live branch/i);
    expect(briefing).toContain("**Onboarding stalls**");
    expect(briefing).toContain("Guided first run");
  });

  test("the last week's delta lists what entered the window and nothing older", () => {
    const briefing = composeStandingBriefing(fixtureTree(), TODAY);
    expect(briefing).toContain('2026-08-10 — Solution: "Guided first run"');
    expect(briefing).not.toContain('2026-07-01 — Opportunity');
  });

  test("a week that added nothing says so instead of going silent", () => {
    const tree = fixtureTree().map((n) => ({ ...n, ...(n.created ? { created: "2026-06-01" } : {}) }));
    const briefing = composeStandingBriefing(tree, TODAY);
    expect(briefing).toMatch(/added nothing/i);
  });

  test("a busy week is truncated out loud, never silently", () => {
    const tree = fixtureTree();
    for (let i = 0; i < 14; i++) {
      tree.push(node({ title: `Fresh finding ${i}`, layer: "Opportunity", evidence: "stated", created: "2026-08-10" }));
    }
    const briefing = composeStandingBriefing(tree, TODAY);
    expect(briefing).toMatch(/and \d+ more/);
  });
});
