import { describe, expect, test } from "vitest";
import { classifyUnknown, contractGaps, resolutionState } from "../../src/knowledge/unknowns.js";
import type { OstNode } from "../../src/ost/node.js";

const unknown = (body: string, extra: Partial<OstNode> = {}): OstNode => ({
  title: "U", layer: "Unknown", tags: [], links: [], body, evidence: "assertion", ...extra,
});

const FULL = "## Format\na count\n\n## Methodology\nquery the log\n\n## Rationale\nserves [[Outcome]]";

describe("classifyUnknown", () => {
  test("a declared shape and a declared mechanism is a cabinet you can open", () => {
    expect(classifyUnknown(unknown(FULL))).toBe("bounded");
  });

  test("a known answer shape with no way to collect it is unreached", () => {
    expect(classifyUnknown(unknown("## Format\na count\n\n## Rationale\nserves [[Outcome]]"))).toBe("unreached");
  });

  test("no declarable answer shape is unbounded, whatever else is present", () => {
    expect(classifyUnknown(unknown("## Methodology\nsail west\n\n## Rationale\nserves [[Outcome]]"))).toBe("unbounded");
  });

  test("an empty body is unbounded rather than an error — the floor, like the ladder's", () => {
    expect(classifyUnknown(unknown(""))).toBe("unbounded");
  });

  test("heading match is case-insensitive but anchored to a heading, not prose", () => {
    expect(classifyUnknown(unknown("## format\nx\n\n## METHODOLOGY\ny"))).toBe("bounded");
    expect(classifyUnknown(unknown("we discussed the Format and the Methodology at length"))).toBe("unbounded");
  });
});

describe("resolutionState", () => {
  test("open by default", () => {
    expect(resolutionState(unknown(FULL))).toBe("open");
  });

  test("an ## Answer section satisfies it", () => {
    expect(resolutionState(unknown(`${FULL}\n\n## Answer\n412 per day`))).toBe("satisfied");
  });

  test("a human moving it to validated satisfies it", () => {
    expect(resolutionState(unknown(FULL, { status: "validated" }))).toBe("satisfied");
  });

  test("deferred means abandoned — the spend that bought nothing stays visible", () => {
    expect(resolutionState(unknown(FULL, { status: "deferred" }))).toBe("abandoned");
  });

  test("abandonment wins over a stray Answer section", () => {
    expect(resolutionState(unknown(`${FULL}\n\n## Answer\nx`, { status: "deferred" }))).toBe("abandoned");
  });
});

describe("contractGaps", () => {
  test("names every missing section so a session knows what to declare", () => {
    expect(contractGaps(unknown(""))).toEqual(["Format", "Methodology", "Rationale"]);
  });

  test("a complete contract has no gaps", () => {
    expect(contractGaps(unknown(FULL))).toEqual([]);
  });
});
