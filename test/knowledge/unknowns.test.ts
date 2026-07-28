import { describe, expect, test } from "vitest";
import type { ClassifierGene } from "../../src/genome/schema.js";
import {
  CONTRACT_SECTIONS,
  DEFAULT_CLASSIFIER,
  UNKNOWN_CLASSES,
  classifyUnknown,
  contractGaps,
  resolutionState,
} from "../../src/knowledge/unknowns.js";
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

describe("classifyUnknown — the classifier as an interpreted gene", () => {
  test("the default gene reproduces the compiled classifier exactly — extraction is a refactor first", () => {
    const bodies = [
      FULL,
      "## Format\na count\n\n## Rationale\nserves [[Outcome]]",
      "## Methodology\nsail west",
      "",
      "## format\nx\n\n## METHODOLOGY\ny",
    ];
    for (const body of bodies) {
      expect(classifyUnknown(unknown(body), DEFAULT_CLASSIFIER)).toBe(classifyUnknown(unknown(body)));
    }
  });

  test("a two-class genome dropping `unreached` reclassifies every existing node with no migration", () => {
    const twoClass: ClassifierGene = {
      contractSections: ["Format", "Methodology", "Rationale"],
      classes: ["bounded", "unbounded"],
      fallback: "unbounded",
      rules: [{ class: "bounded", present: ["Format"], absent: [] }],
    };
    // The same node, unedited on disk, now reads as bounded rather than unreached.
    expect(classifyUnknown(unknown("## Format\na count"))).toBe("unreached");
    expect(classifyUnknown(unknown("## Format\na count"), twoClass)).toBe("bounded");
    expect(classifyUnknown(unknown(FULL), twoClass)).toBe("bounded");
    expect(classifyUnknown(unknown(""), twoClass)).toBe("unbounded");
  });

  test("rule order decides a tie — precedence is data, not a branch", () => {
    const rules = [
      { class: "shape-first", present: ["Format"], absent: [] },
      { class: "method-first", present: ["Methodology"], absent: [] },
    ];
    const gene = (ordered: typeof rules): ClassifierGene => ({
      contractSections: ["Format", "Methodology"],
      classes: ["shape-first", "method-first"],
      fallback: "method-first",
      rules: ordered,
    });
    expect(classifyUnknown(unknown(FULL), gene(rules))).toBe("shape-first");
    expect(classifyUnknown(unknown(FULL), gene([...rules].reverse()))).toBe("method-first");
  });

  test("an empty rule list classes everything as the fallback — the floor holds with no rules at all", () => {
    const empty: ClassifierGene = {
      contractSections: ["Format"],
      classes: ["dark"],
      fallback: "dark",
      rules: [],
    };
    expect(classifyUnknown(unknown(FULL), empty)).toBe("dark");
    expect(classifyUnknown(unknown(""), empty)).toBe("dark");
  });

  test("a custom section list keeps the heading anchoring — case-insensitive, and prose is still not a heading", () => {
    const gene: ClassifierGene = {
      contractSections: ["Shape"],
      classes: ["known", "dark"],
      fallback: "dark",
      rules: [{ class: "known", present: ["Shape"], absent: [] }],
    };
    expect(classifyUnknown(unknown("## shape\nx"), gene)).toBe("known");
    expect(classifyUnknown(unknown("## SHAPE\nx"), gene)).toBe("known");
    expect(classifyUnknown(unknown("we agreed on the Shape at length"), gene)).toBe("dark");
  });

  test("the exported vocabulary still names today's classes and sections, in today's order", () => {
    expect(UNKNOWN_CLASSES).toEqual(["bounded", "unreached", "unbounded"]);
    expect(CONTRACT_SECTIONS).toEqual(["Format", "Methodology", "Rationale"]);
    expect(DEFAULT_CLASSIFIER.fallback).toBe("unbounded");
  });
});

describe("contractGaps — the section list is genome data", () => {
  test("the supplied order is the reported order, NOT a compiled constant's", () => {
    expect(contractGaps(unknown(""), ["Rationale", "Format"])).toEqual(["Rationale", "Format"]);
  });

  test("a genome that asks for one section only ever reports that one missing", () => {
    expect(contractGaps(unknown("## Format\nx"), ["Format", "Provenance"])).toEqual(["Provenance"]);
  });
});
