import { describe, expect, test } from "vitest";
import type { ClassifierGene, ResolutionGene } from "../../src/genome/schema.js";
import {
  CONTRACT_SECTIONS,
  DEFAULT_CLASSIFIER,
  DEFAULT_RESOLUTION,
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

describe("the resolution gene — rule order IS the precedence", () => {
  const DEFERRED_FIRST: ResolutionGene = {
    answerSection: "Answer",
    fallback: "open",
    rules: [
      { state: "abandoned", status: ["deferred"] },
      { state: "satisfied", status: ["validated"], section: "Answer" },
    ],
  };

  const ANSWER_FIRST: ResolutionGene = {
    answerSection: "Answer",
    fallback: "open",
    rules: [
      { state: "satisfied", status: ["validated"], section: "Answer" },
      { state: "abandoned", status: ["deferred"] },
    ],
  };

  const DRAFTED_AND_DEFERRED = () => unknown(`${FULL}\n\n## Answer\nx`, { status: "deferred" });

  test("the default gene decides exactly what the compiled-in machine decided", () => {
    const node = DRAFTED_AND_DEFERRED();
    expect(resolutionState(node)).toBe(resolutionState(node, DEFAULT_RESOLUTION));
    expect(resolutionState(node, DEFERRED_FIRST)).toBe("abandoned");
  });

  test("reversing the two rules makes a drafted Answer beat deferred — order, and ONLY order, decides", () => {
    const node = DRAFTED_AND_DEFERRED();
    expect(resolutionState(node, DEFERRED_FIRST)).toBe("abandoned");
    expect(resolutionState(node, ANSWER_FIRST)).toBe("satisfied");
  });

  test("a genome may name its own answer section — the heading is data, never a literal in the kernel", () => {
    const finding: ResolutionGene = {
      answerSection: "Finding",
      fallback: "open",
      rules: [
        { state: "abandoned", status: ["deferred"] },
        { state: "satisfied", status: ["validated"], section: "Finding" },
      ],
    };
    expect(resolutionState(unknown(`${FULL}\n\n## Finding\n412 per day`), finding)).toBe("satisfied");
    expect(resolutionState(unknown(`${FULL}\n\n## Answer\n412 per day`), finding)).toBe("open");
  });

  test("the default gene's satisfied rule names its own answerSection — renaming the heading stays a one-line edit", () => {
    expect(DEFAULT_RESOLUTION.rules.some((r) => r.section === DEFAULT_RESOLUTION.answerSection)).toBe(true);
  });

  test("a node no rule matches takes the fallback, whatever the fallback is named", () => {
    const gene: ResolutionGene = {
      answerSection: "Answer",
      fallback: "unexamined",
      rules: [{ state: "abandoned", status: ["deferred"] }],
    };
    expect(resolutionState(unknown(FULL), gene)).toBe("unexamined");
    expect(resolutionState(unknown(FULL, { status: "validated" }), gene)).toBe("unexamined");
    expect(resolutionState(unknown(FULL, { status: "deferred" }), gene)).toBe("abandoned");
  });

  test("a status-only rule NEVER reads the body — a rule that names no section probes none", () => {
    const gene: ResolutionGene = {
      answerSection: "Answer",
      fallback: "open",
      rules: [{ state: "satisfied", status: ["validated"] }],
    };
    expect(resolutionState(unknown(`${FULL}\n\n## Answer\nx`), gene)).toBe("open");
    expect(resolutionState(unknown(FULL, { status: "validated" }), gene)).toBe("satisfied");
  });

  test("a genome can express superseded with no code change — which is the entire reason the vocabulary left TypeScript", () => {
    const gene: ResolutionGene = {
      answerSection: "Answer",
      fallback: "open",
      rules: [
        { state: "superseded", status: ["shipped"] },
        { state: "abandoned", status: ["deferred"] },
        { state: "satisfied", status: ["validated"], section: "Answer" },
      ],
    };
    expect(resolutionState(unknown(FULL, { status: "shipped" }), gene)).toBe("superseded");
    expect(resolutionState(unknown(FULL, { status: "deferred" }), gene)).toBe("abandoned");
  });
});
