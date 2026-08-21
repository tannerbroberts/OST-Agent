import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { checkInvariants } from "../../src/eval/invariants.js";
import {
  opportunityShape,
  renderScore,
  SCORE_DIMENSIONS,
  scoreTree,
  type ScoreDimension,
  type TreeScore,
} from "../../src/eval/golden-set.js";
import { Vault } from "../../src/ost/vault.js";

/**
 * "Does the golden set discriminate good trees from bad?"
 *
 * The assumption test's pre-committed bar: good outputs score above degraded
 * ones with a clear, consistent margin ON EVERY FIXTURE. So the assertion here
 * is per pair — every good vault against every degraded vault — and never on
 * the means, because a harness whose averages separate while individual pairs
 * overlap has discriminated nothing and would pass a pooled assertion.
 *
 * The fixtures are committed under `test/fixtures/golden-set/` and described
 * in its `PROVENANCE.md`: three sound trees in three domains, and five copies
 * of one of them each broken in a single named way. Two controls bracket the
 * margin assertion, on the same logic as `planted-instance.test.ts`: the good
 * vaults must be clean by the product's own gate (otherwise "good" is the
 * author's word), and each degraded vault's breakage must show up on the
 * dimension that was planted (otherwise a gap proves the scorer reacted to
 * something, not to the breakage).
 *
 * What green here means, and only this: the scorer separates these eight
 * trees by at least the margin. It does not mean the score tracks what a human
 * would call quality, and it does not mean the scorer would see a breakage
 * nobody planted — both are the humans-required half of the assumption test.
 */

const ROOT = path.join(__dirname, "..", "fixtures", "golden-set");

/**
 * The fixed margin, in score points on the [0, 1] scale. One dimension fully
 * broken costs 0.2 (five dimensions, equal weight), so 0.1 demands that the
 * scorer see at least half of a single planted breakage — and a scoring change
 * that blurs any one dimension by that much goes red here.
 */
const MARGIN = 0.1;

/** The dimension each degraded vault was built to drag down (PROVENANCE.md's table). */
const PLANTED: Record<string, ScoreDimension> = {
  "solutions-as-opportunities": "need-shaped",
  "ungrounded-nodes": "grounded",
  "solutions-without-assumptions": "tested",
  "unfixed-bars": "fixed-bars",
  "broken-structure": "structure",
};

interface Scored {
  name: string;
  score: TreeScore;
}

function vaults(kind: "good" | "degraded"): Scored[] {
  const dir = path.join(ROOT, kind);
  return fs
    .readdirSync(dir)
    .sort()
    .map((name) => {
      // The same reader every gate uses, so the scorer sees exactly the tree
      // the product would; `create: false` because a read must never mkdir.
      const tree = new Vault(path.join(dir, name), { create: false }).readTree();
      return { name, score: scoreTree(tree) };
    });
}

const good = vaults("good");
const degraded = vaults("degraded");

const valueOf = (s: TreeScore, d: ScoreDimension): number => s.dimensions.find((x) => x.dimension === d)!.value;

describe("the golden set is there and was read", () => {
  test("three good vaults and five degraded ones, each read in full", () => {
    // A harness over nothing must not be able to report discrimination.
    expect(good.map((g) => g.name)).toEqual(["cafe-loyalty", "data-platform", "discovery-tool"]);
    expect(degraded.map((d) => d.name)).toEqual(Object.keys(PLANTED).sort());
    for (const { score } of [...good, ...degraded]) {
      expect(score.subject.read).toBeGreaterThan(0);
      expect(score.subject.read).toBe(score.subject.offered);
    }
  });
});

describe("controls", () => {
  test("every good vault is clean by the product's own gate, not by the author's word", () => {
    for (const g of good) {
      const tree = new Vault(path.join(ROOT, "good", g.name), { create: false }).readTree();
      expect(checkInvariants(tree), g.name).toEqual([]);
    }
  });

  test("every degraded vault's planted breakage is the dimension the scorer finds weakest", () => {
    // The plant has to be the shape the scorer looks for, or a gap proves
    // nothing about the breakage — `planted-instance.test.ts` learned that
    // three times over.
    for (const d of degraded) {
      const planted = PLANTED[d.name];
      const plantedValue = valueOf(d.score, planted);
      const floor = Math.min(...d.score.dimensions.map((x) => x.value));
      expect(plantedValue, `${d.name}: ${planted}`).toBe(floor);
      // And the planted dimension is below EVERY good vault on that dimension,
      // so the breakage is visible on its own axis and not only in the mean.
      for (const g of good) {
        expect(plantedValue, `${d.name} vs ${g.name} on ${planted}`).toBeLessThan(valueOf(g.score, planted));
      }
    }
  });
});

describe("discrimination", () => {
  test("every good vault outscores every degraded vault by the fixed margin, per pair", () => {
    // The report a reader needs when this goes red: every score, every pair.
    for (const s of [...good, ...degraded]) console.info(`[golden] ${s.name}\n${renderScore(s.score)}`);

    let pairs = 0;
    for (const g of good) {
      for (const d of degraded) {
        pairs++;
        expect(g.score.score - d.score.score, `${g.name} − ${d.name}`).toBeGreaterThanOrEqual(MARGIN);
      }
    }
    expect(pairs).toBe(good.length * degraded.length);
    expect(pairs).toBe(15);
  });
});

describe("what the scorer is", () => {
  test("five dimensions, each in [0, 1], and the score is their mean", () => {
    for (const s of [...good, ...degraded]) {
      expect(s.score.dimensions.map((d) => d.dimension)).toEqual([...SCORE_DIMENSIONS]);
      for (const d of s.score.dimensions) {
        expect(d.value).toBeGreaterThanOrEqual(0);
        expect(d.value).toBeLessThanOrEqual(1);
      }
      const mean = s.score.dimensions.reduce((sum, d) => sum + d.value, 0) / s.score.dimensions.length;
      expect(s.score.score).toBeCloseTo(mean, 10);
    }
  });

  test("an empty population scores zero, never full marks", () => {
    // A vault with no tests has no fixed bars, and must not score 100% on
    // fixed-bars for having nothing to get wrong. The degraded vault that
    // dropped its tests is the committed instance of this.
    const noTests = degraded.find((d) => d.name === "solutions-without-assumptions")!;
    const bars = noTests.score.dimensions.find((d) => d.dimension === "fixed-bars")!;
    expect(bars.of).toBe(0);
    expect(bars.value).toBe(0);
  });

  test("a score over nothing renders BLIND rather than a number", () => {
    const empty = scoreTree([]);
    expect(empty.subject).toEqual({ offered: 0, read: 0 });
    expect(renderScore(empty)).toContain("BLIND");
  });

  test("the rendered report names what failed, not just the grade", () => {
    const rendered = renderScore(degraded.find((d) => d.name === "solutions-as-opportunities")!.score);
    expect(rendered).toContain("need-shaped");
    expect(rendered).toContain("- Add a tree quality dashboard");
  });

  test("opportunity shape reads the title first and the argument second", () => {
    const opp = (title: string, body = ""): Parameters<typeof opportunityShape>[0] => ({
      title,
      layer: "Opportunity",
      tags: [],
      links: [],
      body,
    });
    // A feature is a feature however the paragraph beneath it argues.
    expect(opportunityShape(opp("Add a dashboard", "I cannot see my progress."))).toBe("solution");
    // The customer's voice in the title.
    expect(opportunityShape(opp("I cannot tell if the pass finished"))).toBe("need");
    // A need phrased in the third person is recognised through its argument...
    expect(opportunityShape(opp("A run that dies stays dead", "I come back and nothing says where it stopped."))).toBe("need");
    // ...and scored half, not zero, when neither title nor argument carries a marker:
    // a scorer that punishes a need it failed to recognise is a scorer people turn off.
    expect(opportunityShape(opp("A run that dies stays dead", "The process exits and the log ends."))).toBe("unclear");
    // Verbs that open a need are not build verbs.
    expect(opportunityShape(opp("Give me the shortest route from here to the goal"))).toBe("need");
  });
});
