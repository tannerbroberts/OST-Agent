import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import matter from "gray-matter";
import { deserialize, type OstNode } from "../../src/ost/node.js";
import type { EvidenceRecord } from "../../src/processes/tree.js";
import {
  FAITHFULNESS_GROUNDS,
  FAITHFULNESS_SCALE,
  FAITHFULNESS_TOLERANCE,
  GROUNDING_RATER,
  PROVENANCE_EXHIBIT,
  faithfulnessScore,
  judgeFaithfulness,
  renderFaithfulness,
  stability,
  subjectsFor,
  type Exhibit,
  type FaithfulnessRater,
  type FaithfulnessSubject,
} from "../../src/eval/faithfulness.js";

/**
 * "Does the LLM judge agree with human faithfulness ratings?"
 *
 * It does not answer that, and it says so here rather than in a footnote:
 * agreement needs human faithfulness ratings to exist as ground truth, and
 * producing those is a person's work. What this file pins is the half that has
 * to be true FIRST, without which no agreement figure can be computed at all —
 * the three properties the assumption test's instrument names:
 *
 * 1. a faithfulness score on a fixed scale for **every node it is given**;
 * 2. every score **cites the specific evidence span it scored against**, and the
 *    span is verified against what the judge was shown rather than believed;
 * 3. the same node scored twice lands **within one point**.
 *
 * The corpus is twelve real nodes from the meta vault plus the seven stored
 * evidence records they cite, committed under `test/fixtures/faithfulness/`.
 * The selection rule is mechanical — the first twelve Opportunity- or
 * Solution-typed files in C-locale filename order — chosen so the sample could
 * not be picked for how it scores. Five of the twelve cite something that does
 * not resolve to a stored record, which is the vault's real ratio at that end
 * of the alphabet and not an arrangement.
 *
 * Two of the tests below matter more than the rest, because they are the ones
 * that would still fail if the judge were replaced by a model tomorrow: the
 * fabricated-quotation refusals, and the planted unstable rater. A citation
 * check that only ever sees spans a pure function copied out of the document
 * proves nothing about a judge that can invent one, and a stability check that
 * only ever sees a deterministic rater cannot report instability it has never
 * been shown.
 */

const FIXTURES = path.join(__dirname, "..", "fixtures", "faithfulness");

function corpusNodes(): OstNode[] {
  const dir = path.join(FIXTURES, "nodes");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => deserialize(f.replace(/\.md$/, ""), fs.readFileSync(path.join(dir, f), "utf8")));
}

function corpusEvidence(): EvidenceRecord[] {
  const dir = path.join(FIXTURES, "evidence");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const parsed = matter(fs.readFileSync(path.join(dir, f), "utf8"));
      const data = parsed.data as Record<string, unknown>;
      return {
        id: String(data.id ?? ""),
        source: String(data.source ?? ""),
        title: String(data.title ?? ""),
        timestamp: String(data.timestamp ?? ""),
        body: parsed.content.trim(),
        actor: "inbox",
      } as EvidenceRecord;
    });
}

function corpus(): FaithfulnessSubject[] {
  return subjectsFor(corpusNodes(), corpusEvidence());
}

describe("a fixed scale, over every node offered", () => {
  test("the corpus is there and is read — a sweep over nothing is a failure, not a pass", () => {
    const subjects = corpus();
    expect(subjects).toHaveLength(12);
    expect(corpusEvidence()).toHaveLength(7);

    const report = judgeFaithfulness(subjects);
    expect(report.subject).toEqual({ offered: 12, read: 12 });
    expect(report.rows).toHaveLength(12);
    expect(judgeFaithfulness([]).subject.read).toBe(0);
    expect(renderFaithfulness(judgeFaithfulness([]))).toContain("BLIND");
  });

  test("every node offered comes back with an integer score on the 1-5 scale", () => {
    const subjects = corpus();
    const report = judgeFaithfulness(subjects);

    // Totality is the property: the rows are the subjects, by name, with none
    // dropped for being hard to score.
    expect(report.rows.map((r) => r.node).sort()).toEqual(subjects.map((s) => s.node).sort());
    for (const row of report.rows) {
      expect(Number.isInteger(row.score)).toBe(true);
      expect(row.score).toBeGreaterThanOrEqual(FAITHFULNESS_SCALE.min);
      expect(row.score).toBeLessThanOrEqual(FAITHFULNESS_SCALE.max);
    }
    // The distribution's denominator must be the whole corpus — a histogram
    // that lost a node is how a mean flatters itself.
    const counted = Object.values(report.distribution).reduce((a, b) => a + b, 0);
    expect(counted).toBe(12);
  });

  test("a node whose citation does not resolve still scores, below every node whose citation does", () => {
    const evidenceIds = new Set(corpusEvidence().map((r) => r.id));
    const nodes = corpusNodes();
    const resolving = new Set(nodes.filter((n) => evidenceIds.has(n.source?.trim() ?? "")).map((n) => n.title));
    expect(resolving.size).toBe(7);

    const report = judgeFaithfulness(corpus());
    const scores = new Map(report.rows.map((r) => [r.node, r.score]));
    const withEvidence = [...resolving].map((t) => scores.get(t)!);
    const without = report.rows.filter((r) => !resolving.has(r.node)).map((r) => r.score);

    expect(without).toHaveLength(5);
    // Per-node, not on the means: a judge whose averages separate while
    // individual nodes overlap has discriminated nothing.
    expect(Math.min(...withEvidence)).toBeGreaterThan(Math.max(...without));
  });
});

describe("every score cites a span the judge was actually shown", () => {
  test("over the whole corpus, every citation is verbatim in the exhibit it names", () => {
    const subjects = corpus();
    const report = judgeFaithfulness(subjects);
    const byNode = new Map(subjects.map((s) => [s.node, s]));

    for (const row of report.rows) {
      const subject = byNode.get(row.node)!;
      const check = (exhibitId: string, span: string) => {
        const exhibit = subject.exhibits.find((e) => e.id === exhibitId);
        expect(exhibit, `${row.node} cited unknown exhibit ${exhibitId}`).toBeDefined();
        expect(span.trim().length).toBeGreaterThan(0);
        expect(exhibit!.text.includes(span), `${row.node}: "${span}" is not in ${exhibitId}`).toBe(true);
      };
      check(row.citation.exhibit, row.citation.span);

      // Every ground carries its own span, met or not: "why did this score 2"
      // is the question a human comparing ratings asks first.
      expect(row.grounds?.map((g) => g.name)).toEqual([...FAITHFULNESS_GROUNDS]);
      for (const ground of row.grounds!) check(ground.citation.exhibit, ground.citation.span);
    }
  });

  test("a score that scored against real evidence cites the record, not the node's own paperwork", () => {
    const evidenceIds = new Set(corpusEvidence().map((r) => r.id));
    const report = judgeFaithfulness(corpus());
    const grounded = report.rows.filter((r) => r.score >= 4);
    expect(grounded.length).toBeGreaterThan(0);

    // A node that scored for its claim being IN the evidence must be quoting
    // the evidence. Quoting `source: INBOX:…` back at itself would be the
    // grading-its-own-homework shape in citation form.
    for (const row of grounded) {
      expect(evidenceIds.has(row.citation.exhibit)).toBe(true);
      expect(row.citation.exhibit).not.toBe(PROVENANCE_EXHIBIT);
    }
  });

  test("a judge that invents a quotation is refused, not recorded", () => {
    const subject = corpus().find((s) => s.exhibits.length > 1)!;

    const fabricator: FaithfulnessRater = {
      name: "fabricator",
      rate: (s) =>
        faithfulnessScore(s, "fabricator", 5, {
          exhibit: s.exhibits[1].id,
          span: "the operator confirmed this in writing on the third of never",
        }),
    };
    expect(() => fabricator.rate(subject)).toThrow(/does not contain it/);

    // Off-by-a-word counts as invented. A judge that paraphrases its own
    // quotation is a judge whose citation cannot be checked against the source.
    const realSpan = subject.exhibits[1].text.split("\n").find((l) => l.trim().length > 40)!.trim();
    const paraphrase = realSpan.replace(/\s\S+$/, " something else entirely");
    expect(() =>
      faithfulnessScore(subject, "paraphraser", 4, { exhibit: subject.exhibits[1].id, span: paraphrase }),
    ).toThrow(/does not contain it/);
  });

  test("a judge that cites an exhibit it was never shown is refused", () => {
    const subject = corpus()[0];
    expect(() =>
      faithfulnessScore(subject, "peeker", 5, { exhibit: "INBOX:a-document-nobody-showed-it.md", span: "anything" }),
    ).toThrow(/not among the/);
  });

  test("an empty span is refused — a score with nothing quoted behind it is an opinion", () => {
    const subject = corpus()[0];
    for (const span of ["", "   ", "\n"]) {
      expect(() => faithfulnessScore(subject, "silent", 3, { exhibit: PROVENANCE_EXHIBIT, span })).toThrow(
        /empty span/,
      );
    }
  });

  test("a score off the fixed scale is refused, so the numbers stay comparable", () => {
    const subject = corpus()[0];
    const cite = { exhibit: PROVENANCE_EXHIBIT, span: subject.exhibits[0].text.split("\n")[0] };
    for (const score of [0, 6, 2.5, -1, Number.NaN]) {
      expect(() => faithfulnessScore(subject, "off-scale", score, cite)).toThrow(/the scale is 1–5 integers/);
    }
  });

  test("a ground's citation is checked as hard as the score's", () => {
    const subject = corpus()[0];
    const good = { exhibit: PROVENANCE_EXHIBIT, span: subject.exhibits[0].text.split("\n")[0] };
    expect(() =>
      faithfulnessScore(subject, "half-honest", 3, good, [
        { name: "cites-a-source", met: true, citation: good },
        { name: "source-resolves", met: true, citation: { exhibit: PROVENANCE_EXHIBIT, span: "invented line" } },
      ]),
    ).toThrow(/ground "source-resolves"/);
  });
});

describe("the same node scored twice lands within one point", () => {
  test("the deterministic rater does not move at all across the corpus", () => {
    const report = judgeFaithfulness(corpus(), GROUNDING_RATER, 3);
    expect(report.unstable).toEqual([]);
    for (const row of report.rows) {
      expect(row.repeats).toHaveLength(3);
      expect(row.spread).toBe(0);
      expect(row.spread).toBeLessThanOrEqual(FAITHFULNESS_TOLERANCE);
      expect(row.stable).toBe(true);
    }
  });

  test("the harness reports a judge that DOES move — the check is not vacuous", () => {
    // Scores 2, 4, 2, 4 … — inside the scale, deterministic in aggregate, and
    // two points apart between identical calls. A stability check that has only
    // ever seen a pure function has not been shown to catch anything.
    let call = 0;
    const jittery: FaithfulnessRater = {
      name: "jittery",
      rate: (s) =>
        faithfulnessScore(s, "jittery", call++ % 2 === 0 ? 2 : 4, {
          exhibit: PROVENANCE_EXHIBIT,
          span: s.exhibits[0].text.split("\n")[0],
        }),
    };

    const subjects = corpus().slice(0, 3);
    const report = judgeFaithfulness(subjects, jittery, 2);
    expect(report.unstable).toEqual(subjects.map((s) => s.node));
    for (const row of report.rows) {
      expect(row.spread).toBeGreaterThan(FAITHFULNESS_TOLERANCE);
      expect(row.stable).toBe(false);
    }
    // And the operator is told, by name, rather than shown a mean that averages
    // the movement away.
    const rendered = renderFaithfulness(report);
    expect(rendered).toContain("UNSTABLE on 3 node(s)");
    for (const s of subjects) expect(rendered).toContain(s.node);
  });

  test("a one-point wobble is within tolerance and a two-point one is not", () => {
    const subject = corpus()[0];
    const span = subject.exhibits[0].text.split("\n")[0];
    const cycling = (values: number[]): FaithfulnessRater => {
      let i = 0;
      return {
        name: "cycling",
        rate: (s) => faithfulnessScore(s, "cycling", values[i++ % values.length], { exhibit: PROVENANCE_EXHIBIT, span }),
      };
    };

    expect(stability(subject, cycling([3, 4]), 2).stable).toBe(true);
    expect(stability(subject, cycling([3, 5]), 2).stable).toBe(false);
    expect(stability(subject, cycling([3, 4, 5]), 3).spread).toBe(2);
    expect(() => stability(subject, GROUNDING_RATER, 0)).toThrow(/at least one score/);
  });
});

describe("what the score is actually reading", () => {
  /** A node and the record it cites, as `subjectsFor` would build them. */
  function planted(node: Partial<OstNode> & { title: string; body: string }, record?: EvidenceRecord) {
    const full: OstNode = { layer: "Solution", tags: [], links: [], ...node } as OstNode;
    return subjectsFor([full], record ? [record] : [])[0];
  }

  const RECORD: EvidenceRecord = {
    id: "INBOX:2026-08-01-checkout-latency.md",
    source: "INBOX:2026-08-01-checkout-latency.md",
    title: "checkout-latency",
    timestamp: "2026-08-01T00:00:00.000Z",
    body:
      "Three operators described abandoning the checkout queue while waiting for the payment confirmation " +
      "screen to settle. Each of them reached for the browser refresh button before the confirmation " +
      "arrived, and two of the three ended up charged twice for the same basket.",
    actor: "inbox",
  };

  test("the scale runs from a claim citing nothing to a claim its record carries", () => {
    const score = (s: FaithfulnessSubject) => GROUNDING_RATER.rate(s).score;

    // 1 — no source at all. Nothing resolved, nothing to read.
    expect(score(planted({ title: "unsourced", body: "The checkout queue is abandoned by waiting operators." }))).toBe(
      FAITHFULNESS_SCALE.min,
    );

    // 2 — a source that names a stored record, and the record is not there.
    expect(
      score(
        planted({
          title: "dangling",
          source: "INBOX:2026-08-01-checkout-latency.md",
          body: "The checkout queue is abandoned by waiting operators.",
        }),
      ),
    ).toBe(2);

    // 3 — the record resolves, the claim is about something else entirely, and
    //     it asserts a measurement the record never made.
    expect(
      score(
        planted(
          {
            title: "unrelated and quantified",
            source: RECORD.id,
            body: "Every scheduled backup finishes inside the maintenance window, always, with zero retries.",
          },
          RECORD,
        ),
      ),
    ).toBe(3);

    // 4 — the record resolves, the claim is about something else, but it claims
    //     nothing the record would have had to measure.
    expect(
      score(
        planted(
          {
            title: "unrelated and hedged",
            source: RECORD.id,
            body: "Scheduled backups may finish inside the maintenance window under ordinary conditions.",
          },
          RECORD,
        ),
      ),
    ).toBe(4);

    // 5 — the record resolves and the claim is made of the record's own words.
    expect(
      score(
        planted(
          {
            title: "grounded",
            source: RECORD.id,
            body:
              "Operators abandon the checkout queue while the payment confirmation screen settles, reaching for " +
              "browser refresh and getting charged twice for the same basket.",
          },
          RECORD,
        ),
      ),
    ).toBe(FAITHFULNESS_SCALE.max);
  });

  test("a claim that restates its record cites the record's own sentence", () => {
    const subject = planted(
      {
        title: "grounded",
        source: RECORD.id,
        body: "Operators reached for the browser refresh button and ended up charged twice for the same basket.",
      },
      RECORD,
    );
    const scored = GROUNDING_RATER.rate(subject);
    expect(scored.citation.exhibit).toBe(RECORD.id);
    expect(RECORD.body).toContain(scored.citation.span);
    expect(scored.citation.span).toContain("refresh");
  });

  test("a node with an unresolved citation cites the line that says so", () => {
    const subject = planted({
      title: "dangling",
      source: "INBOX:nothing-here.md",
      body: "Some claim about the world.",
    });
    const scored = GROUNDING_RATER.rate(subject);
    const grounds = new Map(scored.grounds!.map((g) => [g.name, g]));
    expect(grounds.get("source-resolves")!.met).toBe(false);
    expect(grounds.get("source-resolves")!.citation.span).toContain("none — this id names no stored record");
    // Every node has this exhibit, which is why an unreadable citation is a low
    // score rather than a skipped row.
    expect(subject.exhibits.map((e) => e.id)).toEqual([PROVENANCE_EXHIBIT]);
  });

  test("an honest non-stored citation is named as such, not as a broken id", () => {
    const subject = planted({
      title: "interview-sourced",
      source: "INTERVIEW:2026-08-01-operator-three",
      body: "Some claim about the world.",
    });
    const provenance = subject.exhibits[0] as Exhibit;
    // `INTERVIEW:` is not an evidence-id prefix: the node is making a true
    // statement about where the claim came from without claiming a stored
    // record exists, and the judge must not report it as a dangling id.
    expect(provenance.text).toContain("not claimed — this source names no stored record");
    expect(provenance.text).toContain("rung the source earns: stated");
  });

  test("the mechanical rater cannot see negation, and the ceiling is pinned here", () => {
    // Same vocabulary, opposite meaning. A lexical lens scores the contradiction
    // exactly as high as the restatement, because overlap is all it reads. This
    // is asserted rather than hidden: it is the ceiling of a rater that does not
    // read, it is what an injected model is FOR, and a judge measured against
    // this one would be flattered by inheriting the same blindness.
    const restates = planted(
      {
        title: "restates",
        source: RECORD.id,
        body: "Operators abandoned the checkout queue and two of the three were charged twice for the same basket.",
      },
      RECORD,
    );
    const contradicts = planted(
      {
        title: "contradicts",
        source: RECORD.id,
        body: "No operator abandoned the checkout queue, and none of the three was charged twice for the same basket.",
      },
      RECORD,
    );
    expect(GROUNDING_RATER.rate(restates).score).toBe(FAITHFULNESS_SCALE.max);
    expect(GROUNDING_RATER.rate(contradicts).score).toBe(FAITHFULNESS_SCALE.max);

    // What it does still give a human doing the comparison: the span. The
    // contradiction is visible to anyone who reads the quotation beside the
    // claim, which is the whole reason a score without one is refused.
    expect(RECORD.body).toContain(GROUNDING_RATER.rate(contradicts).citation.span);
  });

  test("the rendered report carries the spans, not only the mean", () => {
    const rendered = renderFaithfulness(judgeFaithfulness(corpus()));
    expect(rendered).toMatch(/faithfulness \(rater "grounding"\): mean \d\.\d\d on a 1–5 scale over 12 of 12/);
    expect(rendered).toContain("distribution");
    for (const subject of corpus()) expect(rendered).toContain(subject.node);
    // A grade nobody can check is the failure mode this judge exists inside of,
    // so the spans are in the operator's output too.
    for (const ground of FAITHFULNESS_GROUNDS) expect(rendered).toContain(ground);
  });
});
