/**
 * A wrapped pre-commitment lead-in is read, so the absent count stops being a
 * formatting artefact.
 *
 * `ost-agent debt` classifies every assumption test's pre-commitment as
 * `bound`, `instruction`, `prose` or `absent`. The extractor used to look for
 * the bold lead-in one line at a time, so a lead-in that prose formatting had
 * hard-wrapped — its closing `**` on the next line — matched nothing and the
 * test counted `absent`. Observed twice in a live vault, by accident, with the
 * same text moving from `absent` to `bound` on being joined onto one line and
 * not one word of the threshold changed. A count that moves with formatting
 * is not measuring what it claims.
 *
 * The bar, set before the fix existed: wrapped and unwrapped forms of one
 * paragraph classify identically — for `bound`, `instruction` and `prose`
 * alike — and the only tests counted `absent` are those with no
 * pre-commitment paragraph at all.
 */
import { describe, expect, test } from "vitest";
import { askedOf, computeUnfixedThresholds, thresholdKindOf } from "../../src/eval/coverage.js";
import type { OstNode } from "../../src/ost/node.js";

function node(title: string, body: string): OstNode {
  return { title, layer: "AssumptionTest", tags: [], links: [], body };
}

/** The same paragraph, once on one line and once wrapped where an editor put the break. */
function pair(unwrapped: string, wrapped: string): [OstNode, OstNode] {
  expect(wrapped.replace(/\n/g, " ")).toBe(unwrapped);
  return [node("flat", `the plan\n\n${unwrapped}`), node("wrapped", `the plan\n\n${wrapped}`)];
}

describe("the lead-in reads the same however the text happens to be wrapped", () => {
  test("pass 6, live: a bold lead-in broken over two lines reads as the bar it introduces", () => {
    const [flat, wrapped] = pair(
      "**Pre-commit before looking, and this is a bar rather than an instruction to set one:** at least 5 of 20 book a kickoff.",
      "**Pre-commit before looking, and this is a bar rather than an instruction to set\none:** at least 5 of 20 book a kickoff.",
    );

    expect(thresholdKindOf(flat)).toBe("bound");
    expect(thresholdKindOf(wrapped)).toBe("bound");
    expect(askedOf(wrapped)).toBe(askedOf(flat));
    expect(askedOf(wrapped)).toBe("at least 5 of 20 book a kickoff.");
  });

  test("pass 7, live: a bold span that encloses the threshold and wraps mid-sentence still reads as bound", () => {
    const [flat, wrapped] = pair(
      "**Pre-committed threshold: 20 arrivals across both arms, and revert if either arm sees none at all.**",
      "**Pre-committed threshold: 20 arrivals across both arms, and revert if either arm sees none\nat all.**",
    );

    expect(thresholdKindOf(flat)).toBe("bound");
    expect(thresholdKindOf(wrapped)).toBe("bound");
    expect(askedOf(wrapped)).toBe(askedOf(flat));
    expect(askedOf(wrapped)).toBe("20 arrivals across both arms, and revert if either arm sees none at all.");
  });

  test("an instruction stays an instruction when wrapped — the fix moves nothing it should not", () => {
    const [flat, wrapped] = pair(
      "**Pre-commit the threshold before starting:** Decide the acceptable failure rate before looking at the data.",
      "**Pre-commit the threshold before\nstarting:** Decide the acceptable failure rate before looking at the data.",
    );

    expect(thresholdKindOf(flat)).toBe("instruction");
    expect(thresholdKindOf(wrapped)).toBe("instruction");
    expect(askedOf(wrapped)).toBe(askedOf(flat));
  });

  test("prose stays prose when wrapped", () => {
    const [flat, wrapped] = pair(
      "**Pre-committed success threshold:** a piece placed by a visitor with no account survives a page reload.",
      "**Pre-committed success\nthreshold:** a piece placed by a visitor with no account survives a page reload.",
    );

    expect(thresholdKindOf(flat)).toBe("prose");
    expect(thresholdKindOf(wrapped)).toBe("prose");
    expect(askedOf(wrapped)).toBe(askedOf(flat));
  });

  test("live, this vault: a lead-in that follows the design on the same line is read, not skipped", () => {
    // 12 of this vault's 18 `absent` tests were written exactly this way. The
    // line-start anchor never looked past `**Design:**`, so a paragraph with a
    // numeric bar in it counted as having no pre-commitment at all. Where the
    // author put the line break is formatting; the bar is the same either way.
    const [flat, wrapped] = pair(
      "**Design:** Attach criteria to ten candidates and revisit after two weeks. **Pre-committed threshold:** at least three are retired, and no candidate whose criterion was met is still live.",
      "**Design:** Attach criteria to ten candidates and revisit after two weeks.\n**Pre-committed threshold:** at least three are retired, and no candidate whose criterion was met is still live.",
    );

    expect(thresholdKindOf(flat)).toBe("bound");
    expect(thresholdKindOf(wrapped)).toBe("bound");
    expect(askedOf(flat)).toBe(askedOf(wrapped));
    expect(askedOf(flat)).toBe("at least three are retired, and no candidate whose criterion was met is still live.");
  });

  test("a pre-commitment reads to the end of its paragraph, bold sub-bars and all", () => {
    // Live, this vault: bars itemise their own parts in bold — "**Soundness: 0
    // hits on a link that resolves.** … **Utility: at least 3 of the 4 …**" —
    // and put their numbers in bold at the end of a sentence ("must close **at
    // least 5 of 10**."). Any rule that cut the reading at the next bold label
    // read "Two numbers, both fixed here" and called it prose. There is no cut:
    // an over-long quotation costs a glance, a bar cut off before its number
    // costs a classification.
    const n = node(
      "Asm",
      "**Pre-committed threshold.** Two numbers, both fixed here. **Soundness: 0 hits on a link that resolves.** Any false positive kills it. **Utility: at least 3 of the 4 known occurrences must be caught.**",
    );

    expect(askedOf(n)).toBe(
      "Two numbers, both fixed here. **Soundness: 0 hits on a link that resolves.** Any false positive kills it. **Utility: at least 3 of the 4 known occurrences must be caught.**",
    );
    expect(thresholdKindOf(n)).toBe("bound");

    const trailing = node("Asm", "**Pre-committed threshold:** cwd-and-argv must close **at least 5 of 10**. Below 5, it is demoted.");
    expect(thresholdKindOf(trailing)).toBe("bound");
  });

  test("a bold mention of pre-commitment mid-sentence is not a lead-in; the labelled paragraph after it is", () => {
    // Live, this vault: a design paragraph asks the reader "**is this a real
    // pre-commitment?**" two lines above the actual `**Pre-committed
    // threshold.**` paragraph. Reading the lead-in anywhere in a line is what
    // makes the mid-line form work; a mid-line match must therefore look like
    // a label — bold closed on a colon or full stop — or it is just emphasis.
    const n = node(
      "Asm",
      "**The test.** A human reads each one and judges: **is this a real pre-commitment, or an instruction?** Judge from the node text.\n\n**Pre-committed threshold.** The false-refusal rate must be **at or below 5%**.",
    );

    expect(askedOf(n)).toBe("The false-refusal rate must be **at or below 5%**.");
    expect(thresholdKindOf(n)).toBe("bound");
  });

  test("a threshold wrapped over three lines after an unwrapped lead-in reads whole, as it always did", () => {
    const n = node(
      "Asm",
      "plan\n\n**Pre-committed threshold:** at least\n5 of 20\nbook a kickoff.\n\nThe next paragraph is not the bar.",
    );

    expect(askedOf(n)).toBe("at least 5 of 20 book a kickoff.");
    expect(thresholdKindOf(n)).toBe("bound");
  });
});

describe("only a test with no pre-commitment paragraph at all reads as absent", () => {
  test("no lead-in anywhere is absent, wrapped prose or not", () => {
    expect(thresholdKindOf(node("Asm", "just a plan,\nhard-wrapped by hand,\nwith no bar in it."))).toBe("absent");
  });

  test("a lead-in with nothing after it is still absent — joining lines does not invent a bar", () => {
    expect(thresholdKindOf(node("Asm", "plan\n\n**Pre-committed threshold:**\n\nThe run."))).toBe("absent");
    expect(thresholdKindOf(node("Asm", "plan\n\n**Pre-committed\nthreshold:**"))).toBe("absent");
  });

  test("a wrapped pre-commitment paragraph still ends where the next one begins", () => {
    // The boundary rules are unchanged: a blank line, a heading, or the next
    // bold lead-in. Wrapping the lead-in must not let the paragraph swallow
    // the design section that follows it.
    const n = node(
      "Asm",
      "plan\n\n**Pre-commit before\nlooking:** Choose the cutoff first.\n**Design.** 40 participants in two arms.",
    );

    expect(askedOf(n)).toBe("Choose the cutoff first.");
    expect(thresholdKindOf(n)).toBe("instruction");

    const headed = node("Asm", "**Pre-commit before\nlooking:** Choose the cutoff first.\n## Result\n5 of 20 booked.");
    expect(askedOf(headed)).toBe("Choose the cutoff first.");
  });

  test("a bold paragraph that is not a pre-commitment does not shadow the one that is", () => {
    const n = node(
      "Asm",
      "**The assumption under test, wrapped\nacross lines.** That people book.\n\n**Pre-committed\nthreshold:** at least 5 of 20.",
    );

    expect(askedOf(n)).toBe("at least 5 of 20.");
  });
});

describe("the census does not move with the editor", () => {
  test("a tree and its hard-wrapped twin produce the same four counts", () => {
    const flat = [
      node("A", "**Pre-committed threshold:** at least 5 of 20 book."),
      node("B", "**Pre-commit before looking, and this is a bar rather than an instruction to set one:** no more than a third may fail."),
      node("C", "**Pre-commit the threshold before starting:** Decide the bar first."),
      node("D", "**Pre-committed success threshold:** the piece survives a reload."),
      node("E", "no paragraph here"),
    ];
    const wrapped = [
      node("A", "**Pre-committed\nthreshold:** at least 5 of 20 book."),
      node("B", "**Pre-commit before looking, and this is a bar rather than an\ninstruction to set one:** no more than a third may\nfail."),
      node("C", "**Pre-commit the threshold\nbefore starting:** Decide the bar first."),
      node("D", "**Pre-committed success\nthreshold:** the piece\nsurvives a reload."),
      node("E", "no paragraph\nhere"),
    ];

    const a = computeUnfixedThresholds(flat);
    const b = computeUnfixedThresholds(wrapped);

    expect(a.totals).toEqual({ tests: 5, bound: 2, instruction: 1, prose: 1, absent: 1 });
    expect(b.totals).toEqual(a.totals);
    expect(b.unfixed.map((u) => [u.title, u.kind, u.asked])).toEqual(a.unfixed.map((u) => [u.title, u.kind, u.asked]));
    expect(b.unfixed.filter((u) => u.kind === "absent").map((u) => u.title)).toEqual(["E"]);
  });
});
