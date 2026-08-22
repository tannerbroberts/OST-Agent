/**
 * "Paper-classify the existing commit history as structure versus commentary" —
 * the assumption test beneath "Structure and commentary are separable from the
 * shape of the output alone", in the meta vault.
 *
 * The assumption is a feasibility claim: **commentary-vs-structure is reliably
 * detectable from commit contents alone.** Its pre-committed bar, fixed before
 * this corpus existed, is **at least 90% agreement between the rule and the hand
 * labels, else the idle-down trigger cannot be trusted and the solution is
 * deferred.** That number is asserted once, in the first test below, and nothing
 * in this file may move it.
 *
 * ## What is being compared with what
 *
 * The measurement only means something because the two sides read the same
 * commits through deliberately unequal windows:
 *
 * - **The rule** (`src/loop/pass-shape.ts`) sees the *subject line*. Nothing else.
 * - **The labels** (`test/fixtures/pass-shape/`) are cut from the *diff* — did
 *   this commit add a node, move an edge, or change a declared field — which is
 *   the assumption test's own definition of the two classes applied mechanically.
 *
 * If both sides read the same window, agreement is 100% and measures nothing. So
 * the number below is the answer to a real question: does what a commit *says* it
 * did reproduce what it *actually* did to the tree, well enough to spend money on.
 *
 * ## Where these labels came from, and what that costs
 *
 * The assumption test says "hand-label this vault's full commit history" and was
 * written to be run by a human. **No human labelled these 2,950 commits.** They
 * were cut by `scripts/harvest-pass-shape-corpus.ts` from the diffs, by a
 * predicate that is a direct transcription of the definition the test itself
 * gives ("structure = new nodes/links/status; commentary = annotations/appends
 * only"), and `labelFromFacts` in that script recomputes the label from committed
 * counts on every load, so a reader can disagree with the predicate and re-measure
 * in one edit. That is a stronger artefact than a human's labels in one respect —
 * it is reproducible and auditable row by row — and a weaker one in the respect
 * the node cares about, because a machine transcription of a definition cannot
 * catch a case where the definition is wrong. `PROVENANCE.md` in the fixture
 * directory says this again in the place a re-cutter will look.
 *
 * ## What a green run here does not say
 *
 * It does not say throttling on this signal is a good idea. The solution's own
 * counter-example survives every test in this file: the most valuable artefact of
 * the run that first showed the decay was a builder briefing, it was
 * commentary-only, and it was last. A classifier at 100% agreement would still
 * have idled immediately after the best thing the agent did. Detection is not
 * value, and nothing here licenses spending decisions.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  agreementRate,
  classifyCommitShape,
  classifyPassShape,
  COMMENTARY_CALLS,
  type PassShape,
  STRUCTURE_CALLS,
  toolFromSubject,
} from "../../src/loop/pass-shape.js";

/** The bar the assumption test fixed before the corpus was cut. Do not move it. */
const PRE_COMMITTED_AGREEMENT = 0.9;

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/pass-shape",
);

interface CommitRow {
  sha: string;
  subject: string;
  at: string;
  merge: boolean;
  nodesAdded: number;
  nodesRemoved: number;
  nodesRenamed: number;
  linksChanged: number;
  statusChanged: number;
  instrumentChanged: number;
  evidenceChanged: number;
  proseAdded: number;
  nodeFiles: number;
  otherFiles: number;
}

const corpus: { vault: string; head: string; commits: number; rows: CommitRow[] } =
  JSON.parse(readFileSync(path.join(fixtureDir, "commits.json"), "utf8"));

/**
 * The label, recomputed from the committed counts rather than read from a stored
 * string — so the definition being measured against is visible here, in the test,
 * and a re-cut is a one-line edit instead of a re-harvest.
 */
function label(row: CommitRow): PassShape {
  const structural =
    row.nodesAdded +
    row.nodesRemoved +
    row.nodesRenamed +
    row.linksChanged +
    row.statusChanged +
    row.instrumentChanged +
    row.evidenceChanged;
  return structural > 0 ? "structure" : "commentary";
}

/**
 * The stricter reading: `instrument:` and `evidence:` are not "status", so a
 * commit that only set one of them is commentary. Used to show the result does
 * not depend on which of the two readings you take — only on taking one of them
 * on both sides.
 */
function strictLabel(row: CommitRow): PassShape {
  const structural =
    row.nodesAdded +
    row.nodesRemoved +
    row.nodesRenamed +
    row.linksChanged +
    row.statusChanged;
  return structural > 0 ? "structure" : "commentary";
}

const cases = corpus.rows.map((row) => ({ subject: row.subject, label: label(row) }));

describe("the assumption test's own bar", () => {
  test("the rule reproduces the diff-cut labels on at least 90% of the corpus", () => {
    const { agreed, total, rate } = agreementRate(cases);

    // Printed rather than only asserted: the pre-committed bar is a floor, and a
    // reader re-cutting the corpus needs the number, not just the verdict.
    expect({ agreed, total, rate: Number(rate.toFixed(4)) }).toEqual({
      agreed: 2688,
      total: 2950,
      rate: 0.9112,
    });
    expect(rate).toBeGreaterThanOrEqual(PRE_COMMITTED_AGREEMENT);
  });

  test("the corpus is the vault's whole history, not a sample of it", () => {
    // The test says "this vault's *full* commit history". A corpus that had been
    // filtered to the commits the rule handles well would clear any bar.
    expect(corpus.rows).toHaveLength(corpus.commits);
    expect(corpus.commits).toBe(2950);
    expect(corpus.vault).toBe("ost-agent-meta");
    expect(new Set(corpus.rows.map((r) => r.sha)).size).toBe(corpus.commits);
  });

  test("both classes are well represented, so agreement is not a majority guess", () => {
    // A corpus that were 95% one class would let "always commentary" clear 90%.
    const structure = corpus.rows.filter((r) => label(r) === "structure").length;
    expect(structure).toBe(1436);
    expect(corpus.commits - structure).toBe(1514);

    const alwaysCommentary =
      corpus.rows.filter((r) => label(r) === "commentary").length / corpus.commits;
    expect(alwaysCommentary).toBeLessThan(PRE_COMMITTED_AGREEMENT);
  });
});

describe("what the margin is made of", () => {
  /**
   * The single most important fact about this result, and the one a reader
   * deciding whether to build idle-down needs: the rule is already at the ceiling
   * of what its input can support. Its 91.12% against a 91.80% best-possible
   * means the 8.9% it gets wrong is not waiting on a better rule.
   */
  test("no subject-only rule could do much better — the ceiling is 91.80%", () => {
    // Best possible: group commits by everything a subject reveals, then assume an
    // oracle picks each group's majority label. Nothing reading subjects beats it.
    const groupKey = (subject: string): string =>
      toolFromSubject(subject) ?? /^([A-Za-z0-9_]+(?:\([a-z]+\))?)/.exec(subject)?.[1] ?? "?";

    const groups = new Map<string, { structure: number; commentary: number }>();
    for (const row of corpus.rows) {
      const key = groupKey(row.subject);
      const g = groups.get(key) ?? { structure: 0, commentary: 0 };
      g[label(row)]++;
      groups.set(key, g);
    }
    const ceiling =
      [...groups.values()].reduce((n, g) => n + Math.max(g.structure, g.commentary), 0) /
      corpus.commits;

    expect(Number(ceiling.toFixed(4))).toBe(0.918);
    expect(agreementRate(cases).rate).toBeGreaterThan(ceiling - 0.01);
  });

  test("one tool accounts for most of the irreducible error", () => {
    // `ost_append_to_node` writes the same subject whether it appended a paragraph
    // of prose or a "## Proving this" section carrying a wikilink to a new test.
    // From outside those two commits are indistinguishable; inside, one moved an
    // edge and the other did not.
    const appends = corpus.rows.filter(
      (r) => toolFromSubject(r.subject) === "ost_append_to_node",
    );
    expect(appends).toHaveLength(617);
    expect(appends.filter((r) => label(r) === "structure")).toHaveLength(199);
    expect(appends.filter((r) => label(r) === "commentary")).toHaveLength(418);

    // 199 of the 262 disagreements — 76% of the total error in one tool.
    const wrong = corpus.rows.filter((r) => classifyCommitShape(r.subject) !== label(r));
    expect(wrong).toHaveLength(262);
    expect(
      wrong.filter((r) => toolFromSubject(r.subject) === "ost_append_to_node"),
    ).toHaveLength(199);
  });
});

describe("the result does not turn on which definition of 'status' you take", () => {
  /**
   * `instrument:` and `evidence:` are the two arguable members of
   * {@link STRUCTURE_CALLS}. Excluding them is a defensible reading of "new
   * nodes/links/status" and would be a reasonable re-cut — so the question that
   * matters is whether the 90% result survives it. It does, and these two tests
   * are the reason the answer is "pick either, but pick the same one twice".
   */
  test("the stricter reading clears the bar too, once the rule is re-cut to match", () => {
    const narrow = ["ost_create_node", "ost_set_status", "ost_merge_nodes", "ost_detach_nodes"];
    const classifyNarrow = (subject: string): PassShape => {
      const tool = toolFromSubject(subject);
      return tool !== undefined && narrow.includes(tool) ? "structure" : "commentary";
    };
    const agreed = corpus.rows.filter(
      (r) => classifyNarrow(r.subject) === strictLabel(r),
    ).length;

    expect(Number((agreed / corpus.commits).toFixed(4))).toBe(0.9197);
    expect(agreed / corpus.commits).toBeGreaterThanOrEqual(PRE_COMMITTED_AGREEMENT);
  });

  test("mixing the two readings fails the bar — coherence is the real constraint", () => {
    // The wide rule against strict labels. This is the failure mode an implementor
    // of idle-down will actually hit: classifier and ledger disagreeing about
    // whether setting an instrument counts as the tree moving.
    const agreed = corpus.rows.filter(
      (r) => classifyCommitShape(r.subject) === strictLabel(r),
    ).length;

    expect(Number((agreed / corpus.commits).toFixed(4))).toBe(0.8546);
    expect(agreed / corpus.commits).toBeLessThan(PRE_COMMITTED_AGREEMENT);
  });
});

describe("the rule itself", () => {
  test("the two call lists are disjoint and cover the MCP write surface", () => {
    for (const call of STRUCTURE_CALLS) expect(COMMENTARY_CALLS).not.toContain(call);

    // Every `ost_*` tool that appears in the corpus is handled by name. A tool
    // added to the write surface and to neither list would show up here rather
    // than being silently read as commentary.
    const seen = new Set(
      corpus.rows.map((r) => toolFromSubject(r.subject)).filter((t): t is string => !!t),
    );
    for (const tool of seen) {
      expect([...STRUCTURE_CALLS, ...COMMENTARY_CALLS]).toContain(tool);
    }
    expect(seen.size).toBe(10);
  });

  test("the three commits the original hand-reading named classify as it read them", () => {
    // The tetrix run's own decay, in the three subjects that made the case: creates
    // at 14:37, appends at 16:44, an annotation on the root at 16:45.
    expect(classifyCommitShape('mcp: ost_create_node — created Opportunity "x" under "y"')).toBe(
      "structure",
    );
    expect(classifyCommitShape('mcp: ost_append_to_node — appended to "x"')).toBe("commentary");
    expect(classifyCommitShape('mcp: ost_annotate — annotated "OST-Agent (meta)"')).toBe(
      "commentary",
    );
  });

  test("a subject from no recognised writer is commentary, and says so", () => {
    expect(toolFromSubject("Merge pull request #12 from tannerbroberts/x")).toBeUndefined();
    expect(classifyCommitShape("Merge pull request #12 from tannerbroberts/x")).toBe(
      "commentary",
    );
    expect(classifyCommitShape("chore(instruments): record 8 observation(s)")).toBe(
      "commentary",
    );
    // Not every `ost_`-looking string is a tool call subject.
    expect(toolFromSubject("ost: the eighteenth pass — root-caused the miscount")).toBeUndefined();
  });
});

describe("folding commits into a pass", () => {
  test("a pass with any structural commit is structural, however much prose follows", () => {
    // The asymmetry is deliberate: reading a still-building pass as commentary is
    // the error that idles a tree that is still learning.
    const assessment = classifyPassShape([
      'mcp: ost_create_node — created Solution "x" under "y"',
      'mcp: ost_append_to_node — appended to "x"',
      'mcp: ost_append_to_node — appended to "x"',
      'mcp: ost_annotate — annotated "OST-Agent (meta)"',
    ]);
    expect(assessment.shape).toBe("structure");
    expect(assessment).toMatchObject({ structure: 1, commentary: 3, unrecognised: 0 });
  });

  test("a pass that only appends and annotates is commentary", () => {
    expect(
      classifyPassShape([
        'mcp: ost_append_to_node — appended to "x"',
        'mcp: ost_annotate — annotated "OST-Agent (meta)"',
      ]).shape,
    ).toBe("commentary");
  });

  test("a pass that committed nothing is commentary, not unknown", () => {
    // Six consecutive governed passes of this vault produced zero structural
    // change while `ost_next_work` reported the identical list each time
    // (INBOX:2026-07-25, passes 8–13). A pass that spends its schedule and
    // commits nothing is the strongest form of the signal, not an absence of it.
    expect(classifyPassShape([])).toEqual({
      shape: "commentary",
      structure: 0,
      commentary: 0,
      unrecognised: 0,
    });
  });

  test("unrecognised subjects are counted, so the rule's blind spot is visible", () => {
    const assessment = classifyPassShape([
      "chore(instruments): record 8 observation(s) from the build loop",
      "Merge pull request #12 from tannerbroberts/x",
    ]);
    expect(assessment.unrecognised).toBe(2);
    expect(assessment.shape).toBe("commentary");
  });

  test("the corpus's own worst pass-length window is still read correctly", () => {
    // The longest run of consecutive commentary commits in the vault's history,
    // taken as one pass: whatever its length, it must not read as structure.
    let best = { start: 0, length: 0 };
    let start = 0;
    for (let i = 0; i <= corpus.rows.length; i++) {
      const isCommentary = i < corpus.rows.length && label(corpus.rows[i]!) === "commentary";
      if (!isCommentary) {
        if (i - start > best.length) best = { start, length: i - start };
        start = i + 1;
      }
    }
    expect(best.length).toBeGreaterThan(10);
    const window = corpus.rows.slice(best.start, best.start + best.length);
    expect(classifyPassShape(window.map((r) => r.subject)).shape).toBe("commentary");
  });
});
