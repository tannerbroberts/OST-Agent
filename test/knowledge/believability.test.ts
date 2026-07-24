import { describe, expect, test } from "vitest";
import {
  BELIEVABILITY_LADDER,
  believabilityBrief,
  believabilityRollup,
  classifyProvenance,
  isRung,
  rungRank,
  weakestRung,
} from "../../src/knowledge/believability.js";

describe("the believability ladder", () => {
  test("runs from money down to bare assertion, strongest first", () => {
    expect(BELIEVABILITY_LADDER.map((r) => r.id)).toEqual(["money", "observed", "stated", "expert", "assertion"]);
  });

  test("ranks a stronger rung above a weaker one", () => {
    expect(rungRank("money")).toBeLessThan(rungRank("observed"));
    expect(rungRank("observed")).toBeLessThan(rungRank("stated"));
    expect(rungRank("expert")).toBeLessThan(rungRank("assertion"));
  });

  test("every rung explains what it means, so a reader need not guess", () => {
    for (const rung of BELIEVABILITY_LADDER) {
      expect(rung.definition.length).toBeGreaterThan(20);
      expect(rung.label.length).toBeGreaterThan(0);
    }
  });

  test("recognises only real rungs", () => {
    expect(isRung("observed")).toBe(true);
    expect(isRung("vibes")).toBe(false);
  });
});

describe("weakestRung", () => {
  test("a conclusion is only as believable as its weakest input", () => {
    expect(weakestRung(["money", "stated", "observed"])).toBe("stated");
  });

  test("with nothing to go on, it reports the floor rather than assuming strength", () => {
    expect(weakestRung([])).toBe("assertion");
  });
});

describe("believabilityBrief", () => {
  test("teaches the agent every rung and the weakest-input rule", () => {
    const brief = believabilityBrief();
    for (const rung of BELIEVABILITY_LADDER) expect(brief).toContain(rung.id);
    expect(brief).toMatch(/weakest/i);
  });
});

describe("believabilityRollup", () => {
  const n = (title: string, evidence?: string) =>
    ({ title, layer: "Opportunity", tags: [], links: [], body: "", evidence }) as never;

  test("counts nodes per rung and names what is still unlabelled", () => {
    const rollup = believabilityRollup([n("a", "observed"), n("b", "assertion"), n("c", "assertion"), n("d")]);

    expect(rollup.counts.observed).toBe(1);
    expect(rollup.counts.assertion).toBe(2);
    expect(rollup.unlabelled).toBe(1);
  });

  test("reports the tree's overall believability as its weakest labelled rung", () => {
    expect(believabilityRollup([n("a", "money"), n("b", "stated")]).weakest).toBe("stated");
  });
});

describe("classifyProvenance", () => {
  test("a harvested session is observed behavior", () => {
    expect(classifyProvenance("TRANSCRIPT:8fc8d6e3")).toBe("observed");
  });

  test("a friction note the agent filed about itself is a stated report, not observed behavior", () => {
    expect(classifyProvenance("INBOX:2026-07-24-friction-the-vault-is-not-discoverable.md")).toBe("stated");
  });

  test("a ticket or page someone wrote is stated intent", () => {
    expect(classifyProvenance("JIRA:PROJ-1234")).toBe("stated");
  });

  test("an ordinary note falls to the floor rather than claiming a rung it has not earned", () => {
    expect(classifyProvenance("INBOX:2026-07-24-founder-theory-compression.md")).toBe("assertion");
    expect(classifyProvenance("")).toBe("assertion");
    expect(classifyProvenance("agent:P3_ideate")).toBe("assertion");
  });
});
