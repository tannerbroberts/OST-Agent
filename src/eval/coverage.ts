/**
 * Coverage debt — what a recorded result quietly claims but never ran.
 *
 * A result is a small piece of prose that clears a gate. It says what happened;
 * it almost never says what did *not* happen. So the artefact left behind gets
 * read as answering the whole threshold the test was written against, when in
 * practice it answered some part of it and the rest went untested and unnoticed.
 *
 * Twice in a row on a sibling product, the honest move after running a test was
 * to split the node, because the artefact covered less than the question asked —
 * and both times that depended on somebody happening to notice. This module is
 * the mechanical half of noticing: every claim must be paired with a written
 * statement of what it leaves out, and an unpaired claim is debt with a name.
 *
 * The judgement is deliberately shallow. It never reads the uncovered statement
 * or checks that it is true — only that a person was made to write one. Whether
 * the statement is honest is a human call, and nothing here pretends otherwise.
 */
import { hasRecordedResult } from "./evidence-debt.js";
import type { OstNode } from "../ost/node.js";
import { entriesUnder, RESULTS_HEADING, UNCOVERED_HEADING } from "../ost/headings.js";

export { UNCOVERED_HEADING };

export interface Coverage {
  /** How many distinct results this test claims. */
  claimed: number;
  /** How many written statements of what a run did not cover. */
  stated: number;
  /** Claims with no statement bounding them. */
  unbounded: number;
}

export interface CoverageGap {
  title: string;
  claimed: number;
  stated: number;
  unbounded: number;
}

export interface CoverageDebt {
  /** Tests that recorded a result without saying what it fails to cover. */
  gaps: CoverageGap[];
  totals: { withResults: number; bounded: number; unbounded: number };
}

/**
 * A bounded test read side by side: what it asked for, and what its runs say
 * they left out.
 *
 * `asked` is null when the node never wrote a threshold down — which is a
 * finding rather than a blank. A run that stated its limits against no stated
 * question has nothing to be checked against, and that is exactly the case a
 * count of pairs reports as healthy.
 */
export interface CoveragePair {
  title: string;
  asked: string | null;
  uncovered: string[];
}

/**
 * Count the list entries directly under a `## Heading`, stopping at the next
 * heading of any level. Only list entries count: prose under the heading is a
 * placeholder ("TODO: fill this in"), and a placeholder bounds nothing.
 */
function countEntriesUnder(body: string, heading: string): number {
  // Matched through `ost/headings.ts`, not by trim-equality, and now by its
  // reader rather than by a copy of it. This reader and `hasRecordedResult` used
  // to disagree about what a `## Results` heading is — trim-equality saw
  // `  ## Results` and missed `## Results of the pilot`; the regex did the
  // reverse — so the guard that refuses the heading could only have covered one
  // of them. One matcher, and now one entry-scanner, for every reader.
  return entriesUnder(body, heading).length;
}

/** What one assumption test claims, and how much of that claim is bounded. */
export function coverageOf(test: OstNode): Coverage {
  const results = countEntriesUnder(test.body, RESULTS_HEADING);
  // A hand-validated test with nothing written down still clears the evidence
  // gate, so it is one claim — and an unwritten claim bounds nothing at all.
  const claimed = results > 0 ? results : hasRecordedResult(test) ? 1 : 0;
  const stated = countEntriesUnder(test.body, UNCOVERED_HEADING);
  return { claimed, stated, unbounded: Math.max(0, claimed - stated) };
}

/**
 * A bold lead-in naming a pre-commitment, e.g. `**Pre-committed threshold:**`.
 *
 * Matched on the phrase rather than on one exact string, because neither vault
 * was written against this feature: between them they use "Pre-committed
 * threshold", "Pre-committed success threshold", "Pre-commit before looking",
 * "Pre-commit the threshold before starting", and more. Tightening this to one
 * spelling would silently report the tree as thresholdless.
 */
const PRECOMMIT_LEAD =
  /^\s*\*\*([^*]*pre-commit[^*]*)\*\*[:.]?\s*|(?<=\s)\*\*(?=\S)([^*]*pre-commit[^*]*)(?:[:.]\*\*|\*\*[:.])\s*/i;

/** A line that opens a bold span — where the paragraph being read ends. */
const BOLD_OPEN = /^\s*\*\*/;

/**
 * The lines of the paragraph that starts at `start`: up to a blank line, a
 * heading, or the next line that opens a bold span. The close of the bold is
 * deliberately not required on the opening line — that requirement is the
 * line-wrap misread, and an editor's hard wrap is not part of the threshold.
 */
function paragraphAt(lines: readonly string[], start: number): string[] {
  const block = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (!trimmed || /^#{1,6}\s/.test(trimmed) || BOLD_OPEN.test(line)) break;
    block.push(line);
  }
  return block;
}

/**
 * The threshold a node pre-committed to, as one paragraph, or null.
 *
 * Reads `test.threshold` first when the node carries one — a field set at
 * creation. Falls back to the prose scan for every node written before the
 * field existed, which is most of both live vaults.
 *
 * The prose scan reads paragraphs, not lines. It used to match the bold
 * lead-in at the start of a line, which made the result depend on where prose
 * formatting put a line break in two ways. A lead-in hard-wrapped across two
 * lines had no closing `**` on its first line, matched nothing, and the test
 * counted `absent` — observed twice in a live vault, and the reason every
 * `absent` count published before this read as a floor rather than a
 * measurement. And a lead-in that followed another on the same line
 * (`**Design:** … **Pre-committed threshold:** at least three…`) was never
 * looked at, which is how 12 of this vault's own 18 `absent` tests came to
 * carry a bar nobody could see. Each paragraph is now joined onto one line and
 * the lead-in looked for anywhere in it, so wrapped, unwrapped and mid-line
 * forms of the same text read identically. A bold span that encloses the
 * threshold itself (`**Pre-committed threshold: 20 arrivals.**`) is read past
 * its first colon, for the same reason: the words are the commitment, and
 * where the author closed the bold is not.
 *
 * Two things the live vault taught about reading mid-line. A match that is not
 * at the start of its paragraph must look like a label — bold closed on a
 * colon or full stop — because a design paragraph that asks "**is this a real
 * pre-commitment?**" in bold is emphasis, not a lead-in, and took a real
 * threshold's place when it was accepted. And the reading runs to the end of
 * the paragraph with no cut at the next bold, because bars here itemise their
 * own parts that way ("**Soundness: 0 hits.** … **Utility: at least 3 of 4.**")
 * and put numbers in bold at the ends of sentences; every cut rule tried read
 * ten bound tests as prose. An over-long quotation costs a glance.
 *
 * The scan is still deliberately dumb: it locates a marker and returns the
 * prose after it. Neither path checks that what it found is measurable or
 * was really written before the run — that is a human judgement, and the
 * point of printing it is to put it where a human can make it.
 */
export function askedOf(test: OstNode): string | null {
  if (test.threshold) {
    const trimmed = test.threshold.trim();
    if (trimmed) return trimmed;
  }
  const lines = test.body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("**")) continue;
    const joined = paragraphAt(lines, i).join(" ").replace(/\s+/g, " ");
    const lead = PRECOMMIT_LEAD.exec(joined);
    if (!lead) continue;

    // "**Pre-committed threshold: 20 arrivals.**" puts the bar inside the bold.
    // Whatever follows the lead-in's first colon is the commitment, not the label.
    const label = lead[1] ?? lead[2] ?? "";
    const inBold = label.includes(":") ? label.slice(label.indexOf(":") + 1) : "";
    const after = joined.slice(lead.index + lead[0].length);
    const asked = `${inBold} ${after}`.replace(/\s+/g, " ").trim();
    // A marker with nothing after it reads as a threshold in a skim and bounds
    // nothing in fact, so it is reported as absent rather than as empty.
    return asked || null;
  }
  return null;
}

/**
 * What a pre-commitment paragraph turned out to be.
 *
 * - `bound` — a bar somebody fixed: a number, or a comparison in words.
 * - `instruction` — opens on *Fix…* / *Decide…* / *Choose…* with no bar in it.
 *   An instruction to pre-commit, standing where the pre-commitment should be.
 * - `prose` — neither. Often a perfectly good falsifiable bar written in words
 *   ("the piece survives a page reload"), which is why it is not flagged.
 * - `absent` — no pre-commitment paragraph at all.
 */
export type ThresholdKind = "bound" | "instruction" | "prose" | "absent";

export interface ThresholdReading {
  title: string;
  kind: ThresholdKind;
  /** The paragraph that was read, or null when there was none. */
  asked: string | null;
}

export interface UnfixedThresholds {
  /** The tests whose threshold is an instruction, or missing entirely. */
  unfixed: ThresholdReading[];
  totals: { tests: number; bound: number; instruction: number; prose: number; absent: number };
}

/**
 * A bar somebody actually fixed. A digit is the obvious case; the phrases are
 * there because "no more than a third" is a commitment and reporting it as
 * unfixed is how a reader learns to ignore the report.
 */
const A_BOUND =
  /\d|[≥≤]|>=|<=|\b(at least|at most|no more than|no fewer than|fewer than|more than|majority|unanimous|exactly|zero|none|half)\b/i;

/**
 * Verbs that turn a pre-commitment into a request for one. A closed list on
 * purpose: an open-ended "is the first word an imperative" test would catch
 * "Ship it to a fraction and compare", which describes a run rather than
 * deferring a decision.
 */
const DEFERRING_VERBS = new Set([
  "fix",
  "decide",
  "choose",
  "set",
  "pick",
  "agree",
  "determine",
  "establish",
  "define",
  "settle",
  "select",
  "nominate",
  "specify",
]);

/**
 * Read a node's pre-commitment and say what kind of thing it is.
 *
 * Shallow by construction, and in a stated order: a bar anywhere in the
 * paragraph wins over how the paragraph opens, because something was fixed
 * even if the sentence is phrased as an ask. The false positive that would
 * cost most is nagging about a well-written threshold — that is how the report
 * gets turned off, and the genuinely empty ones come back with it.
 *
 * It cannot see everything. "Two numbers, both fixed in advance: the lift that
 * would justify building it, and the sentiment floor" names two numbers and
 * states neither, and reads here as `bound`. Only a human catches that one.
 */
export function thresholdKindOf(test: OstNode): ThresholdKind {
  const asked = askedOf(test);
  if (asked === null) return "absent";
  if (A_BOUND.test(asked)) return "bound";
  const opener = asked.replace(/^[^\p{L}]+/u, "").split(/[^\p{L}']+/u)[0]?.toLowerCase() ?? "";
  return DEFERRING_VERBS.has(opener) ? "instruction" : "prose";
}

/**
 * Every assumption test's threshold, classified, with the unfixed ones named.
 *
 * Report only. Nothing here blocks a recording, refuses a result, or edits a
 * node — the parent opportunity's own caveat is that a mechanical rule about
 * this will be wrong at the edges, so the first thing built against it may only
 * look. The four counts sum to the test count so a reader can see what the
 * classifier did with everything, not just what it complained about.
 */
export function computeUnfixedThresholds(tree: readonly OstNode[]): UnfixedThresholds {
  const readings: ThresholdReading[] = tree
    .filter((n) => n.layer === "AssumptionTest")
    .map((t) => ({ title: t.title, kind: thresholdKindOf(t), asked: askedOf(t) }));
  const count = (k: ThresholdKind): number => readings.filter((r) => r.kind === k).length;
  return {
    unfixed: readings.filter((r) => r.kind === "instruction" || r.kind === "absent"),
    totals: {
      tests: readings.length,
      bound: count("bound"),
      instruction: count("instruction"),
      prose: count("prose"),
      absent: count("absent"),
    },
  };
}

/** The statements written under `## Uncovered`, without their list markers. */
export function uncoveredStatementsOf(test: OstNode): string[] {
  return entriesUnder(test.body, UNCOVERED_HEADING);
}

/**
 * Every bounded assumption test, paired with what it asked for.
 *
 * Unbounded tests are left out on purpose: `computeCoverageDebt` already names
 * those, and they have nothing to read side by side. This covers the case that
 * one cannot see at all — a test whose paperwork is complete and whose run may
 * still have answered a different question than the one written down.
 */
export function computeCoveragePairs(tree: readonly OstNode[]): CoveragePair[] {
  return tree
    .filter((n) => n.layer === "AssumptionTest")
    .filter((t) => {
      const c = coverageOf(t);
      return c.claimed > 0 && c.unbounded === 0;
    })
    .map((t) => ({ title: t.title, asked: askedOf(t), uncovered: uncoveredStatementsOf(t) }));
}

/** Every assumption test whose recorded results outrun their uncovered statements. */
export function computeCoverageDebt(tree: readonly OstNode[]): CoverageDebt {
  const tests = tree.filter((n) => n.layer === "AssumptionTest").map((t) => ({ title: t.title, ...coverageOf(t) }));
  const withResults = tests.filter((t) => t.claimed > 0);
  const gaps = withResults.filter((t) => t.unbounded > 0);
  return {
    gaps,
    totals: {
      withResults: withResults.length,
      bounded: withResults.length - gaps.length,
      unbounded: gaps.length,
    },
  };
}
