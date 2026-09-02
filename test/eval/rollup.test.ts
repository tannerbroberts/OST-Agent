/**
 * The rollup replaces a habit: appending a prose ledger to the Outcome every
 * pass, twenty times, until the root was 89KB nobody could read and no program
 * could parse.
 *
 * So the property under test throughout is *derivation*. Every figure has to
 * come from something a node already carries and that the agent could not have
 * written about itself — an exit code `ost-agent verify` watched, a verdict a
 * human recorded, a `source` the ingesting surface stamped. The tests below are
 * mostly of the form "plant the artifact, assert the number moves", because a
 * rollup that merely echoed a `confidence:` field somebody typed would pass a
 * shape test and be worthless.
 */
import { describe, expect, test } from "vitest";
import { renderRollup, rollupTree } from "../../src/eval/rollup.js";
import type { OstNode } from "../../src/ost/node.js";

const node = (title: string, layer: OstNode["layer"], extra: Partial<OstNode> = {}): OstNode => ({
  title,
  layer,
  status: "unvalidated",
  evidence: "assertion",
  tags: [],
  links: [],
  body: "prose",
  ...extra,
});

/** Outcome → bucket → opportunity → solution → test, the shape after the migration. */
function tree(overrides: Partial<Record<string, Partial<OstNode>>> = {}): OstNode[] {
  const mk = (title: string, layer: OstNode["layer"], links: string[] = []): OstNode =>
    node(title, layer, { links, ...(overrides[title] ?? {}) });
  return [
    mk("Root", "Outcome", ["Tools fail"]),
    mk("Tools fail", "Opportunity", ["My shell breaks"]),
    mk("My shell breaks", "Opportunity", ["Ship a shim"]),
    mk("Ship a shim", "Solution", ["Run it on five machines"]),
    mk("Run it on five machines", "AssumptionTest"),
  ];
}

describe("rollupTree", () => {
  test("counts a bucket's subtree without counting the bucket as one of its own opportunities", () => {
    const r = rollupTree(tree());
    expect(r.buckets).toHaveLength(1);
    const b = r.buckets[0];
    expect(b.title).toBe("Tools fail");
    expect(b.opportunities).toBe(1); // "My shell breaks", not itself
    expect(b.solutions).toBe(1);
    expect(b.tests).toBe(1);
  });

  test("the green count is read off the instrument log, not off anything a node claims", () => {
    const unbuilt = rollupTree(
      tree({ "Run it on five machines": { instrument: "npx vitest run test/shim.test.ts", body: "prose" } }),
    );
    expect(unbuilt.buckets[0].instrumented).toBe(1);
    expect(unbuilt.buckets[0].green).toBe(0);

    const built = rollupTree(
      tree({
        "Run it on five machines": {
          instrument: "npx vitest run test/shim.test.ts",
          body: "prose\n\n## Instrument Log\n- 2026-01-01 **green** (exit 0) `npx vitest run test/shim.test.ts`",
        },
      }),
    );
    expect(built.buckets[0].green).toBe(1);
  });

  test("a test with no instrument is reported as not ready to run, not as a failure to build", () => {
    // The distinction the readiness clause depends on. 243 prose-only tests are
    // not a stalled builder; they are tests nobody has named a command for, and
    // the line says which of those it is.
    const r = rollupTree(tree());
    expect(r.buckets[0].instrumented).toBe(0);
    expect(renderRollup(r)).toContain("ready to run 0 of 1 (0 observed green)");
  });

  test("tested and refuted come from the human-only Results section", () => {
    const r = rollupTree(
      tree({
        "Run it on five machines": {
          body: "prose\n\n## Results\n- 2026-01-01 **refuted** (ran by Tanner) — it broke on three of five",
        },
      }),
    );
    expect(r.buckets[0].tested).toBe(1);
    expect(r.buckets[0].refuted).toBe(1);
  });

  test("a supported result is tested but is not dissent", () => {
    const r = rollupTree(
      tree({
        "Run it on five machines": {
          body: "prose\n\n## Results\n- 2026-01-01 **supported** (ran by Tanner) — five of five",
        },
      }),
    );
    expect(r.buckets[0].tested).toBe(1);
    expect(r.buckets[0].refuted).toBe(0);
  });

  test("corroborators counts distinct sources beneath the bucket", () => {
    const r = rollupTree(
      tree({
        "My shell breaks": { source: "INBOX:a.md" },
        "Ship a shim": { source: "INBOX:b.md" },
        "Run it on five machines": { source: "INBOX:a.md" }, // same voice twice
      }),
    );
    expect(r.buckets[0].corroborators).toBe(2);
  });

  test("the weakest rung in the subtree is what the bucket reports", () => {
    const r = rollupTree(tree({ "My shell breaks": { evidence: "observed" } }));
    // The others are still `assertion`, and a bucket is only as believed as its
    // least-supported claim.
    expect(r.buckets[0].weakestRung).toBe("assertion");
  });

  test("names opportunities that no bucket reaches, because no line above counts them", () => {
    const t = tree();
    t.push(node("An orphan need", "Opportunity"));
    const r = rollupTree(t);
    expect(r.unfiled).toEqual(["An orphan need"]);
    expect(renderRollup(r)).toContain("are in no bucket");
  });

  test("names anything hanging off the Outcome that is not an Opportunity", () => {
    const t = tree();
    t[0].links.push("A stray solution");
    t.push(node("A stray solution", "Solution"));
    const r = rollupTree(t);
    expect(r.nonOpportunityChildren).toEqual(["A stray solution"]);
    expect(renderRollup(r)).toContain("only category opportunities belong there");
  });

  test("a node under two buckets is counted under both", () => {
    // The operator's rule is that overlap should be SMALL, not zero — so the
    // rollup has to be able to show it rather than assign each node one home.
    const t = tree();
    t[0].links.push("Runs stall");
    t.push(node("Runs stall", "Opportunity", { links: ["My shell breaks"] }));
    const r = rollupTree(t);
    expect(r.buckets.map((b) => b.opportunities)).toEqual([1, 1]);
  });

  test("survives a dangling link rather than throwing — check reports those, this counts what exists", () => {
    const t = tree();
    t[1].links.push("A node that was never created");
    expect(() => rollupTree(t)).not.toThrow();
    expect(rollupTree(t).buckets[0].opportunities).toBe(1);
  });

  test("a cycle terminates", () => {
    const t = tree();
    t[2].links.push("Tools fail"); // child points back at its bucket
    expect(() => rollupTree(t)).not.toThrow();
  });

  test("an empty vault renders without a root rather than throwing", () => {
    const r = rollupTree([]);
    expect(r.outcome).toBeNull();
    expect(renderRollup(r)).toContain("this vault has no root");
  });
});
