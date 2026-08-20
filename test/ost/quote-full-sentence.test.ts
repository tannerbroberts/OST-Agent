import { describe, expect, test } from "vitest";
import {
  laneConflicts,
  proseDeclaredLane,
  sentencesAround,
  suggestCaution,
} from "../../src/ost/lanes.js";
import type { OstNode } from "../../src/ost/node.js";

const node = (title: string, layer: OstNode["layer"], extra: Partial<OstNode> = {}): OstNode => ({
  title,
  layer,
  tags: [],
  links: [],
  body: "b",
  evidence: "assertion",
  ...extra,
});

// "Every quoting surface renders the whole sentence, not just the detector
// that already does" — pinned by "Every machine-selected quote carries the
// sentence it was cut from".
//
// `proseLaneAmbiguity` already does this (see test/ost/lanes.test.ts). This
// file pins the surfaces that did not: a clean prose-declared lane, a lane
// conflict, and the cautious-lane suggestion — each of which used to quote
// only the matched fragment, hiding whatever qualification sat next to it.

describe("proseDeclaredLane renders the sentence a fragment was cut from", () => {
  test("a qualifier next to the declaration survives into the quote", () => {
    // The elision this node exists to close: a fragment-only quote reads as
    // an unconditional "compute-only" and hides the condition right next to
    // it. Only one lane is named, so this is the clean-declaration path, not
    // the two-lane ambiguity `proseLaneAmbiguity` already guards.
    const t = node("A", "AssumptionTest", {
      body: "**Lane: compute-only, but only while the census has not changed.** A regex over git history.",
    });

    const found = proseDeclaredLane(t);

    expect(found?.quote).toBe("Lane: compute-only");
    expect(found?.sentence).toBe("Lane: compute-only, but only while the census has not changed.");
    expect(found?.sentence).not.toBe(found?.quote);
  });

  test("fragment and sentence coincide for a bare declaration — both are still rendered", () => {
    const t = node("A", "AssumptionTest", { body: "**Lane: compute-only.** A regex over git history." });

    const found = proseDeclaredLane(t);

    expect(found?.quote).toBe("Lane: compute-only");
    expect(found?.sentence).toBe("Lane: compute-only.");
  });
});

describe("laneConflicts renders the sentence too", () => {
  test("the conflict quote carries its qualifier", () => {
    const tree = [
      node("Sol", "Solution", { links: ["A"] }),
      node("A", "AssumptionTest", {
        lane: "compute-only",
        body: "**Lane: humans-required, unless the interview backlog clears first.** five players",
      }),
    ];

    const [conflict] = laneConflicts(tree);

    expect(conflict.quote).toBe("Lane: humans-required");
    expect(conflict.sentence).toBe("Lane: humans-required, unless the interview backlog clears first.");
  });
});

describe("suggestCaution renders the sentence the marker was cut from", () => {
  test("the matched phrase alone would have hidden a disqualifying clause", () => {
    const t = node("Weekly assumption review", "AssumptionTest", {
      body:
        "Nothing here is scheduled yet. This assumed we would interview real users, but that step was cut " +
        "from the plan months ago. Everything below still runs over recorded artifacts.",
    });

    const hint = suggestCaution(t);

    expect(hint?.why).toContain("interview");
    expect(hint?.sentence).toBe(
      "This assumed we would interview real users, but that step was cut from the plan months ago.",
    );
    // The old failure mode: a reader sees only the marker word and assumes
    // the plan still calls for it, missing "cut from the plan" right next to it.
    expect(hint?.why).toContain("cut from the plan");
  });
});

describe("sentencesAround — the shared rule every quoting surface now uses", () => {
  test("a fragment that sits inside one sentence renders exactly that sentence", () => {
    const text = "First sentence stays out. Second sentence has the match in it. Third stays out too.";
    const start = text.indexOf("match");

    expect(sentencesAround(text, start, start + "match".length)).toBe(
      "Second sentence has the match in it.",
    );
  });

  test("a fragment straddling a sentence boundary renders every sentence it touches, not just the first", () => {
    // The match itself crosses the period — clipping to the sentence
    // containing its start would silently drop the second half, which is
    // exactly the elision this node exists to make visible.
    const text = "Lane: compute-only. Humans-required for the interviews.";
    const start = text.indexOf("compute-only");
    const end = text.indexOf("interviews") + "interviews".length;

    const rendered = sentencesAround(text, start, end);

    expect(rendered).toBe("Lane: compute-only. Humans-required for the interviews.");
  });

  test("strips emphasis markers and collapses whitespace, same as the detector that already did this", () => {
    const text = "**Lane: compute-only for the census, humans-required for the fixing.** Counting is mechanical.";
    const start = text.indexOf("Lane");
    const end = text.indexOf("compute-only") + "compute-only".length;

    expect(sentencesAround(text, start, end)).toBe(
      "Lane: compute-only for the census, humans-required for the fixing.",
    );
  });
});
