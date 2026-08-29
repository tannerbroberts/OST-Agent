/**
 * Count how many open assumptions in this tree could be moved by anything
 * public at all.
 *
 * This is the instrument named by the assumption test of that name, under the
 * solution *"Outside lookups are demanded by an open assumption, never
 * scheduled on their own"*. Its bar, verbatim from the vault:
 *
 *   > At least 15 open assumptions yield a specific, searchable question.
 *
 * **The bar is met, and by less than the number suggests.** Over the 483 open
 * assumptions the meta vault held on 2026-08-29, `src/web/public-movable.ts`
 * composes a specific query for **17**. Hand adjudication of all seventeen
 * (`hand-labels.json`) confirms **14** and rejects three, so the bar is cleared
 * on the classifier's count and missed on the human's — which would be a
 * useless place to stop, except that the same key was also read against a 1-in-20
 * sample of the 466 the classifier rejected and found **2 misses in 24**. The
 * classifier is a floor, not a count: at that rate the rejected pile hides on
 * the order of forty more. So the honest answer to the vault's question is
 * *comfortably more than fifteen, and nothing like a majority* — roughly one
 * open assumption in twenty, and every figure in this paragraph is asserted
 * below rather than left as prose.
 *
 * ## Three findings the node did not have
 *
 * 1. **The demand is not diverse; it is one vendor.** Ten of the seventeen
 *    questions are about the harness this loop runs inside. Add git, npm,
 *    vitest, tsx, macOS and one editor question and *sixteen of seventeen* are
 *    a tool's own documentation. A web *search* is not what this tree is short
 *    of. One vendor's docs is.
 * 2. **There is no prior-art demand at all.** Zero of the 483 propositions ask
 *    whether something already exists in the world. The tree has redefined
 *    "prior art" to mean another pass's commits in this same repository
 *    (`src/loop/prior-art-scan.ts`), and both occurrences of the phrase in the
 *    corpus are that sense. The competitor-watching channel the parent
 *    opportunity imagines currently has nothing queued behind it.
 * 3. **A role has no documentation home.** Both misses in the negative sample
 *    name their external subject by role rather than by name — "the prompting
 *    tool", "independent judges". A registry of named referents cannot see
 *    those, and that single defect, not coverage of vendors, is what bounds
 *    recall here.
 *
 * A green on this file does not mean the demand queue was spent, or that the
 * questions in it have answers. It means these are the measurements this
 * repository produces. The corpus is a dated snapshot and the key is one
 * reader's judgement — `test/fixtures/public-movable/PROVENANCE.md` states both
 * limits before either number is used.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  MIN_SALIENT_TERMS,
  REFERENTS,
  classify,
  salientTerms,
  surveyPublicMovability,
  type OpenAssumption,
} from "../../src/web/public-movable.js";

const FIXTURES = path.join(__dirname, "../fixtures/public-movable");

const CORPUS: OpenAssumption[] = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "open-assumptions.json"), "utf8"),
);

interface HandLabel {
  title: string;
  movable: boolean;
  why: string;
}
const KEY: { positives: HandLabel[]; negativeSample: HandLabel[] } = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "hand-labels.json"), "utf8"),
);

const SURVEY = surveyPublicMovability(CORPUS);

describe("the count the vault asked for", () => {
  test("the corpus is every open assumption in the 2026-08-29 snapshot, and every one is labelled", () => {
    expect(CORPUS).toHaveLength(483);
    expect(SURVEY.total).toBe(483);
    // No assumption is skipped or double-counted: a survey that quietly dropped
    // the ones it could not read would report a clean, smaller tree.
    expect(SURVEY.movable.length + SURVEY.private.length).toBe(483);
    for (const label of [...SURVEY.movable, ...SURVEY.private]) {
      expect(label.why.length).toBeGreaterThan(0);
    }
  });

  test("17 of 483 open assumptions yield a specific, searchable question — the vault's bar of 15 is met", () => {
    expect(SURVEY.movable).toHaveLength(17);
    expect(SURVEY.movable.length).toBeGreaterThanOrEqual(15);
    // The fraction is the other half of the answer and it is small: demand-pulled
    // lookups have something to do, but they are not what this tree mostly is.
    expect(SURVEY.movable.length / SURVEY.total).toBeLessThan(0.05);
  });

  test("the demand is one vendor's documentation, not the open web", () => {
    const byReferent = new Map<string, number>();
    for (const l of SURVEY.queue) byReferent.set(l.referent, (byReferent.get(l.referent) ?? 0) + 1);
    expect(byReferent.get("harness")).toBe(10);
    // Fourteen of seventeen land on a known documentation page; only three have
    // to be spent as an open search.
    expect(SURVEY.queue.filter((l) => l.where !== "open web")).toHaveLength(14);
    expect(SURVEY.queue.filter((l) => l.publicClass === "third-party-behaviour")).toHaveLength(16);
  });

  test("no open assumption in this tree asks what already exists in the world", () => {
    expect(SURVEY.queue.filter((l) => l.publicClass === "prior-art")).toHaveLength(0);
  });
});

describe("the classifier is scored against a key it did not write", () => {
  test("every assumption the classifier calls movable is in the answer key", () => {
    // The key adjudicates all seventeen rather than a sample of them, so
    // precision below is measured and not estimated.
    expect(KEY.positives).toHaveLength(17);
    expect(new Set(KEY.positives.map((p) => p.title))).toEqual(
      new Set(SURVEY.movable.map((m) => m.title)),
    );
  });

  test("14 of the 17 survive hand adjudication; the three it gets wrong share one shape", () => {
    const confirmed = KEY.positives.filter((p) => p.movable);
    expect(confirmed).toHaveLength(14);
    const rejected = KEY.positives.filter((p) => !p.movable).map((p) => p.title);
    expect(rejected.sort()).toEqual(
      [
        "Extent flags mostly point at real duplicates, not at distinct needs sharing a source",
        "Most of what this loop waits on is work the harness tracks, not shell-backgrounded jobs it started itself",
        "The scheduling harness can afford a fresh git worktree per firing without materially slowing the build loop or exhausting disk",
      ].sort(),
    );
    // 0.82. Stated as a bar so a change that trades accuracy for count fails here.
    expect(confirmed.length / KEY.positives.length).toBeGreaterThan(0.8);
  });

  test("the sampled misses say the 17 is a floor, not a count", () => {
    // Every 20th private-only assumption, stride fixed before any was read.
    const sampled = SURVEY.private.filter((_, i) => i % 20 === 0).map((m) => m.title);
    expect(sampled).toHaveLength(24);
    expect(new Set(KEY.negativeSample.map((n) => n.title))).toEqual(new Set(sampled));

    const missed = KEY.negativeSample.filter((n) => n.movable);
    expect(missed).toHaveLength(2);
    // Agreement on the negatives is 22/24; the two it misses are not noise, they
    // are the same defect twice — see this file's header.
    expect((KEY.negativeSample.length - missed.length) / KEY.negativeSample.length).toBeGreaterThan(0.9);
    // Extrapolating the sampled rate over the whole rejected pile puts the true
    // population well above the bar, which is why the bar is reported as met
    // even though hand adjudication of the 17 alone lands at 14.
    const projected = Math.round((missed.length / KEY.negativeSample.length) * SURVEY.private.length);
    expect(projected).toBeGreaterThan(15);
  });
});

describe("what a demanded lookup has to carry", () => {
  test("no lookup exists without an open assumption demanding it", () => {
    const titles = new Set(CORPUS.map((a) => a.title));
    for (const lookup of SURVEY.queue) {
      expect(titles.has(lookup.assumption)).toBe(true);
    }
    // One assumption, one lookup: the queue is the demand, not a cross product.
    expect(SURVEY.queue).toHaveLength(SURVEY.movable.length);
    expect(new Set(SURVEY.queue.map((l) => l.assumption)).size).toBe(SURVEY.queue.length);
  });

  test("every query names its referent and enough of the belief to be specific", () => {
    for (const lookup of SURVEY.queue) {
      const ref = REFERENTS.find((r) => r.id === lookup.referent);
      expect(lookup.query.startsWith(ref ? ref.query : "existing tool that")).toBe(true);
      const belief = CORPUS.find((a) => a.title === lookup.assumption)!;
      const carried = salientTerms(belief.title).filter((t) => lookup.query.includes(t));
      expect(carried.length).toBeGreaterThanOrEqual(MIN_SALIENT_TERMS);
      expect(lookup.where.length).toBeGreaterThan(0);
    }
  });

  test("the queue is spent cheapest question first", () => {
    const costs = SURVEY.queue.map((l) => l.cost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    // A known documentation page is cheaper than an open search, and the ordering
    // has to follow from that rather than from the order the vault happens to
    // list its nodes in.
    for (const lookup of SURVEY.queue) {
      expect(lookup.cost).toBe(lookup.where === "open web" ? 2 : 1);
    }
  });
});

describe("what stops the count from being everything", () => {
  test("naming an external thing is not enough — the proposition has to be about it", () => {
    // Stated as a case rather than as a rule, because this is the single
    // distinction the count turns on. Both beliefs contain the word `git`.
    const aboutGit: OpenAssumption = {
      title: "A git merge driver can rebuild dist from source",
      prose: "The merge driver can invoke a build at merge time.",
      tests: [],
    };
    const aboutUs: OpenAssumption = {
      title: "The loop's push is rejected when another pass got there first",
      prose: "The git push is rejected after every hour has already been spent.",
      tests: [],
    };
    expect(classify(aboutGit).verdict).toBe("public-movable");
    expect(classify(aboutUs).verdict).toBe("private-only");
  });

  test("a belief written entirely in this tree's own vocabulary yields no question", () => {
    // The vault asked for a *specific* question. A query that reduces to the
    // referent plus words every node here contains is not one, and is dropped
    // even though the referent is named and a property is claimed.
    const vague: OpenAssumption = {
      title: "The vitest run can record the test",
      prose: "Whether vitest can record it.",
      tests: [],
    };
    expect(salientTerms(vague.title).length).toBeLessThan(MIN_SALIENT_TERMS);
    expect(classify(vague).verdict).toBe("private-only");
  });
});
