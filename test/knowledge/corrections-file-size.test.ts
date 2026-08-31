/**
 * Does the corrections file fit in the context a session opens with?
 *
 * The assumption is feasibility and the node states it plainly: *"a corrections
 * file long enough to hold every lesson is one nobody opens, and there is no
 * natural expiry — a refusal that stopped happening because the file worked looks
 * identical to one that stopped mattering."* The threshold a human fixed before
 * anything was measured: **the deduplicated file is under 2,000 characters, or a
 * stated expiry rule brings it under.**
 *
 * The design asked for three measurements and this file makes all three: assemble
 * the file from real refusals, measure its length, then apply each candidate
 * expiry rule and measure again.
 *
 * ## The subject is the real ledger, not the seven-session corpus
 *
 * `test/loop/corrections-ledger.test.ts` already replays the seven-session corpus,
 * and `PROVENANCE.md` says outright why that corpus cannot answer *this* question:
 * "seven sessions produce two corrections; the cap is exercised with synthetic
 * sightings instead, which is a test of the cap and not of the growth curve." A
 * size bar measured against two entries would pass on arrival and measure nothing.
 *
 * So the subject is `aged-ledger.json` — this machine's real build-loop ledger
 * after **678 harvested sessions**, copied off disk on 2026-08-31. The corpus
 * replay is still here, as the floor: whatever the aged ledger does, a fresh
 * workspace's briefing must also fit.
 *
 * ## What the measurement found
 *
 * Three things, and only the third is the one the node was expecting to argue
 * about:
 *
 * 1. **The entry growth the node predicted did not happen.** 678 sessions produced
 *    **three** corrections. `MAX_CORRECTIONS` (25) was never approached and
 *    `dropped` is still 0. "It grows without bound" is not what went wrong.
 * 2. **It is over the bar anyway — 2,128 characters — on per-entry cost.** One
 *    entry costs 1,577 of them by itself. Both expiry rules the node proposed are
 *    counted in *entries*, so both drop **zero** and change **nothing**.
 * 3. **One of the three was never a correction.** Dropping it takes the file to
 *    **1,734 characters**, under the bar, with nothing truncated — and it has to
 *    be dropped *before* any character budget runs, because it carries the largest
 *    count in the file and a count-ordered budget would keep it and evict the
 *    sleep block instead.
 *
 * Every "over the bar" assertion below is pinned with an exact number rather than
 * an inequality. That looks backwards for a test whose job is to prove something
 * fits, and it is deliberate: these are the findings that made the rules
 * necessary, and a test asserting only the happy end state would go green the day
 * somebody deleted a rule as unnecessary.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  MAX_BRIEFING_CHARS,
  MAX_CORRECTIONS,
  emptyCorrectionsLedger,
  extractRefusals,
  fitToBudget,
  foldSightings,
  pruneNonLessons,
  renderCorrections,
  renderCorrectionsUnbounded,
  type Correction,
  type CorrectionsLedger,
} from "../../src/loop/corrections.js";

const CORPUS = path.resolve(__dirname, "../fixtures/corrections");
const AGED = path.join(CORPUS, "aged-ledger.json");

/** The bar the assumption test's threshold names, restated here so it is greppable. */
const BAR = 2000;

/**
 * The day the aged ledger was taken off disk.
 *
 * Fixed, never `Date.now()`: the 30-day rule below is a function of "now", and a
 * test whose verdict drifts with the wall clock would start reporting a different
 * finding every month without anyone changing a line. CONTRIBUTING.md asks for
 * fixed inputs for exactly this reason.
 */
const TAKEN_AT = Date.parse("2026-08-31T00:00:00.000Z");

/** The remedy of the correction this workspace has paid for most often, genuinely. */
const SLEEP_REMEDY_MARKER = "use Monitor with an until-loop";

/**
 * The ledger exactly as it sits in the file — no rule applied.
 *
 * Read straight off disk rather than through `readLedger`, which prunes. The point
 * of this test is to measure what was assembled *before* anything trimmed it.
 */
function asStored(): CorrectionsLedger {
  return JSON.parse(fs.readFileSync(AGED, "utf8")) as CorrectionsLedger;
}

function replayCorpus(): CorrectionsLedger {
  const sightings = fs
    .readdirSync(CORPUS)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .flatMap((f) => extractRefusals(fs.readFileSync(path.join(CORPUS, f), "utf8"), path.basename(f, ".jsonl")));
  return foldSightings(emptyCorrectionsLedger(), sightings);
}

/**
 * Candidate expiry rule 1, verbatim from the node: *"drop anything not seen in 30
 * days"*.
 *
 * Written here rather than in `src/` on purpose — this rule does not ship, because
 * the measurement below shows it cannot do the job. Keeping a dead rule exported
 * from the module would be an affordance for reaching a conclusion the evidence
 * does not support.
 */
function dropUnseenInDays(ledger: CorrectionsLedger, days: number, now: number): CorrectionsLedger {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return { ...ledger, corrections: ledger.corrections.filter((c) => Date.parse(c.lastSeen) >= cutoff) };
}

/** Candidate expiry rule 2, verbatim from the node: *"keep only the top ten by count"*. */
function keepTopByCount(ledger: CorrectionsLedger, n: number): CorrectionsLedger {
  const top = new Set(
    [...ledger.corrections]
      .sort((a, b) => b.occurrences - a.occurrences || b.lastSeen.localeCompare(a.lastSeen))
      .slice(0, n)
      .map((c) => c.permitted),
  );
  return { ...ledger, corrections: ledger.corrections.filter((c) => top.has(c.permitted)) };
}

/** A ledger at the storage cap — the arm nothing on this machine has ever reached. */
function atTheCap(): CorrectionsLedger {
  const corrections: Correction[] = Array.from({ length: MAX_CORRECTIONS }, (_, i) => ({
    id: `synthetic-correction-${i}`,
    permitted: `Do not write form ${i}; use the permitted form ${i} instead, which the guard names in full.`,
    attempted: `Refused: some call of shape ${i} that this workspace has composed at least once.`,
    tools: ["Bash"],
    sessions: [`session-${i}`],
    occurrences: MAX_CORRECTIONS - i,
    firstSeen: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    lastSeen: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
  }));
  return { version: 1, harvested: [], corrections, dropped: 0 };
}

describe("the file assembled from real refusals, before any rule trims it", () => {
  test("678 sessions produced three corrections — the growth the node predicted is not the growth that happened", () => {
    const ledger = asStored();
    expect(ledger.harvested.length).toBeGreaterThan(600);
    expect(ledger.corrections).toHaveLength(3);
    // The cap the module was given to defend against unbounded entry growth has
    // never fired. Nothing has ever fallen off the end of this ledger.
    expect(ledger.corrections.length).toBeLessThan(MAX_CORRECTIONS);
    expect(ledger.dropped).toBe(0);
  });

  test("it is deduplicated by permitted form, with counts, most-recent-first", () => {
    const { corrections } = asStored();
    const permitted = corrections.map((c) => c.permitted);
    expect(new Set(permitted).size).toBe(permitted.length);
    for (const c of corrections) expect(c.occurrences).toBeGreaterThanOrEqual(c.sessions.length);
    const seen = corrections.map((c) => c.lastSeen);
    expect(seen).toEqual([...seen].sort().reverse());
  });

  test("and it is over the bar — 2,128 characters against 2,000", () => {
    const rendered = renderCorrectionsUnbounded(asStored());
    expect(rendered.length).toBe(2128);
    expect(rendered.length).toBeGreaterThan(BAR);
  });

  test("the overrun is per-entry cost, not the number of entries", () => {
    const ledger = asStored();
    const header = renderCorrectionsUnbounded({ ...ledger, corrections: [], dropped: 0 }).length;
    const marginal = ledger.corrections.map(
      (c) =>
        renderCorrectionsUnbounded(ledger).length -
        renderCorrectionsUnbounded({ ...ledger, corrections: ledger.corrections.filter((x) => x !== c) }).length,
    );
    // The dearest entry is the sleep block, and it is dear because
    // `renderWaitAffordance()` appends three verbatim example commands to it.
    expect(Math.max(...marginal)).toBe(1333);
    expect(Math.max(...marginal)).toBeGreaterThan(BAR * 0.6);
    // Three entries and a header, two thirds of the budget spent on one of them.
    expect(header).toBeLessThan(BAR * 0.1);
  });
});

describe("the two expiry rules the node proposed, measured", () => {
  test("'drop anything not seen in 30 days' drops nothing and changes nothing", () => {
    const before = asStored();
    const after = dropUnseenInDays(before, 30, TAKEN_AT);
    // The oldest of the three was last seen 2026-08-03, 28 days before the ledger
    // was taken. Every entry is inside the window.
    expect(after.corrections).toHaveLength(before.corrections.length);
    expect(renderCorrectionsUnbounded(after).length).toBe(2128);
  });

  test("'keep only the top ten by count' drops nothing and changes nothing", () => {
    const before = asStored();
    const after = keepTopByCount(before, 10);
    expect(after.corrections).toHaveLength(before.corrections.length);
    expect(renderCorrectionsUnbounded(after).length).toBe(2128);
  });

  test("even both at once leave it over — they are counted in the wrong unit", () => {
    const both = keepTopByCount(dropUnseenInDays(asStored(), 30, TAKEN_AT), 10);
    expect(renderCorrectionsUnbounded(both).length).toBeGreaterThan(BAR);
  });
});

describe("the rule that does bring it under: one of the three was never a correction", () => {
  test("dropping it takes the file to 1,734 characters, with nothing truncated", () => {
    const pruned = pruneNonLessons(asStored());
    expect(pruned.corrections).toHaveLength(2);
    expect(renderCorrectionsUnbounded(pruned).length).toBe(1734);
    expect(renderCorrectionsUnbounded(pruned).length).toBeLessThanOrEqual(BAR);
    // Under the bar on its own, so the character budget has nothing left to do and
    // the reader loses no correction at all. Truncation is the last resort here.
    expect(fitToBudget(pruned).elided).toBe(0);
  });

  test("what goes is the unparseable-input report, whose remedy is 'do what you meant to do'", () => {
    const dropped = asStored().corrections.filter(
      (c) => !pruneNonLessons(asStored()).corrections.some((k) => k.permitted === c.permitted),
    );
    expect(dropped).toHaveLength(1);
    expect(dropped[0].attempted).toContain("could not be parsed as JSON");
  });

  test("a parameter-validation refusal is NOT dropped — that one is a lesson about a tool's shape", () => {
    const shapeLesson: Correction = {
      id: "glob-head-limit",
      permitted: "Use one of the parameters the tool declares instead.",
      attempted: "InputValidationError: Glob failed due to the following issue: An unexpected parameter `head_limit` was provided",
      tools: ["Glob"],
      sessions: ["s"],
      occurrences: 5,
      firstSeen: "2026-08-01T00:00:00.000Z",
      lastSeen: "2026-08-01T00:00:00.000Z",
    };
    // Both arrive under the `InputValidationError` banner, so the discriminator has
    // to be narrower than that banner or it would swallow real corrections.
    const kept = pruneNonLessons({ version: 1, harvested: [], corrections: [shapeLesson], dropped: 0 });
    expect(kept.corrections).toHaveLength(1);
  });

  test("the order is load-bearing: budget-before-prune keeps the non-lesson and evicts the sleep block", () => {
    const stored = asStored();
    const wrongOrder = fitToBudget(stored);
    // This is what shipping the character budget alone would have done. The entry
    // it protects is the one with the biggest number and the least to teach; the
    // one it evicts is the correction thirteen sessions of this workspace paid for.
    expect(wrongOrder.ledger.corrections).toHaveLength(1);
    expect(wrongOrder.ledger.corrections[0].attempted).toContain("could not be parsed as JSON");
    expect(wrongOrder.ledger.corrections.some((c) => c.permitted.includes(SLEEP_REMEDY_MARKER))).toBe(false);

    // The shipped order keeps it, because pruning happens on read.
    const rightOrder = fitToBudget(pruneNonLessons(stored));
    expect(rightOrder.ledger.corrections.some((c) => c.permitted.includes(SLEEP_REMEDY_MARKER))).toBe(true);
    expect(rightOrder.elided).toBe(0);
  });

  test("nothing on disk is touched — this bounds what is read, never what is stored", () => {
    const before = asStored();
    pruneNonLessons(before);
    fitToBudget(before);
    expect(asStored()).toEqual(before);
    expect(asStored().corrections).toHaveLength(3);
  });
});

describe("the character budget, as the standing bound for a ledger that outgrows the bar honestly", () => {
  test("the bar in the code is the bar in the threshold", () => {
    expect(MAX_BRIEFING_CHARS).toBe(BAR);
  });

  test("the real ledger's briefing fits, by the shipped path", () => {
    expect(renderCorrections(pruneNonLessons(asStored())).length).toBeLessThanOrEqual(BAR);
  });

  test("so does a fresh workspace's, assembled from the seven-session corpus", () => {
    const corpus = replayCorpus();
    expect(corpus.corrections.length).toBeGreaterThan(0);
    expect(renderCorrections(corpus).length).toBeLessThanOrEqual(BAR);
  });

  test("so does a ledger at the storage cap, which nothing here has ever reached", () => {
    const capped = atTheCap();
    expect(renderCorrectionsUnbounded(capped).length).toBeGreaterThan(BAR);
    expect(renderCorrections(capped).length).toBeLessThanOrEqual(BAR);
  });

  test("what it drops there is the least paid for, and the most paid for survives", () => {
    const capped = atTheCap();
    const fit = fitToBudget(capped);
    expect(fit.elided).toBeGreaterThan(0);

    const kept = fit.ledger.corrections.map((c) => c.permitted);
    const dearest = [...capped.corrections].sort((a, b) => b.occurrences - a.occurrences)[0];
    expect(kept).toContain(dearest.permitted);

    // Every survivor was paid for at least as often as every casualty.
    const cheapestKept = Math.min(...fit.ledger.corrections.map((c) => c.occurrences));
    for (const c of capped.corrections.filter((c) => !kept.includes(c.permitted))) {
      expect(c.occurrences).toBeLessThanOrEqual(cheapestKept);
    }
  });

  test("what it drops is named in the briefing, never dropped in silence", () => {
    const briefing = renderCorrections(atTheCap());
    expect(briefing).toContain(`${fitToBudget(atTheCap()).elided} further correction(s) are recorded but left out`);
    // A truncated list that does not say it was truncated reads as the whole truth.
    expect(briefing).toContain(String(MAX_BRIEFING_CHARS));
  });

  test("a single correction larger than the whole budget still gets through", () => {
    const huge: CorrectionsLedger = {
      version: 1,
      harvested: [],
      corrections: [
        {
          id: "huge",
          permitted: "x".repeat(BAR * 2),
          attempted: "y".repeat(BAR),
          tools: ["Bash"],
          sessions: ["s"],
          occurrences: 1,
          firstSeen: "2026-08-01T00:00:00.000Z",
          lastSeen: "2026-08-01T00:00:00.000Z",
        },
      ],
      dropped: 0,
    };
    // Over the bar, and correctly so: an empty briefing reads exactly like a
    // workspace that has never been corrected, which is worse than a long one.
    expect(renderCorrections(huge)).toContain("x".repeat(BAR * 2));
  });

  test("an empty ledger is still the honest one-line briefing", () => {
    const rendered = renderCorrections(emptyCorrectionsLedger());
    expect(rendered).toContain("none recorded");
    expect(rendered.length).toBeLessThanOrEqual(BAR);
  });

  test("--full opts out, for a human auditing the ledger rather than a prompt", () => {
    expect(renderCorrections(asStored(), { maxChars: null }).length).toBe(2128);
  });
});
