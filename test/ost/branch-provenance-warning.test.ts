/**
 * The instrument for "Confidence propagation with founder-theory warnings".
 *
 * The weakest-rung roll-up already ships: `rollupTree` reports a bucket's
 * `weakestRung` and `renderRollup` prints "rests on <rung>" for every branch.
 * What it could not do is what the solution's own examples name — distinguish
 * a branch dragged down to the floor by one weak input from a branch that
 * never had anything else: "this branch rests on founder theory" (weakest)
 * says nothing about whether the branch ALSO holds an `observed` or `money`
 * node elsewhere, and a reader cannot tell the two apart from `weakestRung`
 * alone. These tests pin the second signal — `restsOnFounderOnly` — and check
 * it is genuinely independent of the first, not a restatement of it.
 */
import { describe, expect, test } from "vitest";
import { renderRollup, rollupTree } from "../../src/eval/rollup.js";
import type { OstNode } from "../../src/ost/node.js";

const node = (title: string, layer: OstNode["layer"], extra: Partial<OstNode> = {}): OstNode => ({
  title,
  layer,
  status: "unvalidated",
  tags: [],
  links: [],
  body: "prose",
  ...extra,
});

/** Outcome → bucket → opportunity → solution, the shape a rollup walks. */
function tree(overrides: Partial<Record<string, Partial<OstNode>>> = {}): OstNode[] {
  const mk = (title: string, layer: OstNode["layer"], links: string[] = []): OstNode =>
    node(title, layer, { links, ...(overrides[title] ?? {}) });
  return [
    mk("Root", "Outcome", ["Tools fail"]),
    mk("Tools fail", "Opportunity", ["My shell breaks"]),
    mk("My shell breaks", "Opportunity", ["Ship a shim"]),
    mk("Ship a shim", "Solution", []),
  ];
}

describe("restsOnFounderOnly", () => {
  test("a branch where every declared rung is assertion has no non-founder source", () => {
    const r = rollupTree(
      tree({
        "Tools fail": { evidence: "assertion" },
        "My shell breaks": { evidence: "assertion" },
        "Ship a shim": { evidence: "assertion" },
      }),
    );
    expect(r.buckets[0].restsOnFounderOnly).toBe(true);
    expect(renderRollup(r)).toContain("this opportunity has no non-founder source");
  });

  test("a branch where nothing declares a rung also has no non-founder source", () => {
    // Undeclared defaults to the floor, per the ladder's own fail-closed rule —
    // a bucket that has declared nothing has earned nothing above it either.
    const r = rollupTree(tree());
    expect(r.buckets[0].restsOnFounderOnly).toBe(true);
    expect(renderRollup(r)).toContain("this opportunity has no non-founder source");
  });

  test("one non-founder node anywhere in the branch clears the warning", () => {
    const r = rollupTree(
      tree({
        "Tools fail": { evidence: "assertion" },
        "My shell breaks": { evidence: "assertion" },
        "Ship a shim": { evidence: "observed" },
      }),
    );
    expect(r.buckets[0].restsOnFounderOnly).toBe(false);
    expect(renderRollup(r)).not.toContain("this opportunity has no non-founder source");
  });

  /**
   * The property `weakestRung` cannot express, and the reason this is a second
   * field rather than a rename: a branch can rest on assertion (its weakest
   * input) while also holding a non-founder source elsewhere, and the two
   * signals must disagree here or the second one is not adding information.
   */
  test("weakest-rung and no-non-founder-source diverge on a mixed branch", () => {
    const r = rollupTree(
      tree({
        "Tools fail": { evidence: "assertion" },
        "My shell breaks": { evidence: "money" },
        "Ship a shim": { evidence: "assertion" },
      }),
    );
    const bucket = r.buckets[0];
    expect(bucket.weakestRung).toBe("assertion");
    expect(bucket.restsOnFounderOnly).toBe(false);
    const rendered = renderRollup(r);
    expect(rendered).toContain("rests on assertion");
    expect(rendered).not.toContain("this opportunity has no non-founder source");
  });

  test("every rung above the floor also clears the warning", () => {
    const r = rollupTree(
      tree({
        "Tools fail": { evidence: "stated" },
        "My shell breaks": { evidence: "expert" },
        "Ship a shim": { evidence: "observed" },
      }),
    );
    expect(r.buckets[0].restsOnFounderOnly).toBe(false);
  });
});
