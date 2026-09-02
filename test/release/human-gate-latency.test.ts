/**
 * Measure how long the last human-gated release actually waited.
 *
 * **What this scores.** The solution "The loop proposes a release and a human
 * tags it" removes the second release train by putting a person on the critical
 * path of every release. It is skeptical of itself and names the reason: this
 * project already has human gates, and they may not clear. Its assumption test
 * fixed a bar on 2026-08-02, before anybody counted — **median human-gate
 * latency at or under 7 days, with fewer than 25% of gates still open** — and
 * said the data was already on disk.
 *
 * **The count, on the corpus as specified: 274 gates, 268 of them still open
 * (97.8%), median wait 15.42 days. Both clauses of the bar are missed, and every
 * one of the three classes misses both of them on its own.** By the node's own
 * pre-committed rule the candidate is closed: this operator cannot be the gate.
 *
 * **The number the node warned about, and it is not hypothetical.** Its spec
 * insisted that still-open waits be counted at their running duration rather
 * than dropped, because "a computation that silently excluded them would report
 * a flattering median from exactly the gates that closed". Run that excluded
 * computation on this corpus and it returns **six gates, zero open, median 0.00
 * days — the bar cleared perfectly**. The warning was exactly right, and the
 * margin between the two answers is the whole verdict.
 *
 * **And the six "closures" are not measurements.** Every tag in this repository
 * is lightweight, so it carries no date of its own — `creatordate` falls back to
 * the commit it points at. The instant a human tagged a release is not recorded
 * anywhere in this repository. Those six are scored at a *lower bound* of zero,
 * which is the reading most favourable to the candidate, and flagged so nobody
 * reads a zero that means "we cannot tell" as one that means "same minute". A
 * candidate whose whole proposal is "a human tags it" cannot presently be
 * audited on the act it proposes; annotated tags (`git tag -a`) would fix that
 * for every release from the next one on.
 *
 * **What the corpus does not settle**, stated in the node and repeated here
 * because the number is quotable and the limit is not: this is one operator.
 * A median over this project's gates says nothing about whether a human gate is
 * affordable for anyone else, and it cannot decide whether the honest form of
 * the idea is the sibling the node names — a single autonomous train with a
 * human veto *after* the fact rather than a human action before it.
 *
 * Evidence: `test/fixtures/human-gate-latency/corpus.json`, cut from this
 * repository's git history, its tag refs, and the vault's own dated records by
 * `scripts/harvest-human-gate-corpus.ts`. See that directory's PROVENANCE.md.
 * Nothing here touches the network or the clock.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  HUMAN_GATE_BAR,
  HUMAN_GATE_KINDS,
  median,
  scoreGate,
  scoreGates,
  scoreGatesByKind,
  type HumanGate,
} from "../../src/release/human-gate-latency.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

interface Corpus {
  asOf: string;
  repoHead: string;
  vaultHead: string;
  vaultCommits: number;
  resultsHeadingCommits: number;
  assumptionTests: number;
  draftEstimates: Record<string, string>;
  gates: HumanGate[];
}

const corpus: Corpus = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "test/fixtures/human-gate-latency/corpus.json"), "utf8"),
) as Corpus;

const overall = scoreGates(corpus.gates, corpus.asOf);
const byKind = scoreGatesByKind(corpus.gates, corpus.asOf);

describe("human-gate latency — what a person on the critical path has cost this project", () => {
  test("the bar is the one the assumption test fixed, not one chosen after the count", () => {
    // Pinned so that relaxing either clause has to argue for itself in a diff
    // rather than slide past inside the scoring code.
    expect(HUMAN_GATE_BAR).toEqual({ medianDays: 7, maxOpenShare: 0.25 });
  });

  test("the corpus is this project's own record, not a scenario built for it", () => {
    expect(corpus.repoHead).toBe("94ac1c1e706f86b2916f91030b5b7f5d459aae34");
    expect(corpus.vaultHead).toBe("e0d9facef950241d0de74bde3f643bffc15b1e50");
    expect(corpus.asOf).toBe("2026-09-02T10:04:30.249Z");

    // The three classes the node's spec enumerates, and only those.
    expect(new Set(corpus.gates.map((g) => g.kind))).toEqual(new Set(HUMAN_GATE_KINDS));
    expect(corpus.gates).toHaveLength(274);

    // The result-filing count is the vault's own "observed green" tally, which
    // `ost-agent rollup` reports independently: 244 of 503 assumption tests.
    expect(corpus.assumptionTests).toBe(503);
    expect(byKind["result-filing"].total).toBe(244);

    // Every gate carries both ends of its wait, and no ready instant is missing.
    for (const g of corpus.gates) {
      expect(Number.isFinite(Date.parse(g.readyAt)), `${g.kind} ${g.subject}`).toBe(true);
      if (g.actedAt !== null) expect(Number.isFinite(Date.parse(g.actedAt))).toBe(true);
    }
  });

  test("THE PRE-COMMITTED BAR IS MISSED — 268 of 274 gates still open, median wait 15.42 days", () => {
    expect(overall.total).toBe(274);
    expect(overall.openCount).toBe(268);
    expect(overall.openShare).toBeCloseTo(0.978, 3);
    expect(overall.medianWaitDays).toBeCloseTo(15.42, 2);

    // Both clauses, each on its own. Either alone would close the candidate;
    // both fail, and the open-share clause fails by a factor of nearly four.
    expect(overall.clearsMedian).toBe(false);
    expect(overall.clearsOpenShare).toBe(false);
    expect(overall.clearsBar).toBe(false);
    expect(overall.medianWaitDays).toBeGreaterThan(HUMAN_GATE_BAR.medianDays * 2);
    expect(overall.openShare).toBeGreaterThan(HUMAN_GATE_BAR.maxOpenShare * 3);
  });

  test("...and the verdict is not an artefact of pooling: every class misses both clauses alone", () => {
    // The candidate is about releases, and releases are 25 gates beside 244
    // result filings, so a pooled median is mostly a statement about the most
    // numerous class. Taken apart, the answer does not change.
    expect(byKind.release.total).toBe(25);
    expect(byKind.release.openCount).toBe(19);
    expect(byKind.release.openShare).toBe(0.76);
    expect(byKind.release.medianWaitDays).toBeCloseTo(37.59, 2);

    expect(byKind["result-filing"].openCount).toBe(244);
    expect(byKind["result-filing"].openShare).toBe(1);
    expect(byKind["result-filing"].medianWaitDays).toBeCloseTo(13.42, 2);

    expect(byKind["verdict-draft"].total).toBe(5);
    expect(byKind["verdict-draft"].openShare).toBe(1);
    expect(byKind["verdict-draft"].medianWaitDays).toBeCloseTo(39.31, 2);

    for (const kind of HUMAN_GATE_KINDS) {
      expect(byKind[kind].clearsMedian, `${kind} median`).toBe(false);
      expect(byKind[kind].clearsOpenShare, `${kind} open share`).toBe(false);
    }
  });

  test("the flattering median the node warned about is real: drop the open waits and it clears perfectly", () => {
    // The node's spec: "a computation that silently excluded them would report a
    // flattering median from exactly the gates that closed". This is that
    // computation, run on this corpus so the size of the warning is on record.
    const closedOnly = scoreGates(
      corpus.gates.filter((g) => g.actedAt !== null),
      corpus.asOf,
    );
    expect(closedOnly.total).toBe(6);
    expect(closedOnly.openCount).toBe(0);
    expect(closedOnly.medianWaitDays).toBe(0);
    expect(closedOnly.clearsBar).toBe(true);

    // 274 gates and a decisive no, against 6 gates and a perfect yes. The rule
    // that produced the first is a single line of the node's spec.
    expect(overall.total - closedOnly.total).toBe(268);
    expect(overall.clearsBar).toBe(false);
  });

  test("the six closed gates are lower bounds, not measurements — no tag here records when it was made", () => {
    const closed = overall.gates.filter((g) => !g.open);
    expect(closed).toHaveLength(6);

    // All six are releases, all six are lightweight tags, and all six therefore
    // score at zero because a lightweight tag's only date is the commit's. This
    // is the reading most favourable to the candidate that the refs can support,
    // and the bar is missed anyway.
    expect(closed.every((g) => g.kind === "release")).toBe(true);
    expect(closed.every((g) => g.actedAtIsLowerBound === true)).toBe(true);
    expect(closed.map((g) => g.subject).sort()).toEqual(["0.1.1", "0.1.3", "0.18.0", "0.19.0", "0.19.1", "0.4.0"]);
    expect(closed.every((g) => g.waitDays === 0)).toBe(true);

    // The act this candidate is built around leaves no timestamp today. Nothing
    // downstream can measure it until releases are tagged with `git tag -a`.
    expect(overall.gates.some((g) => !g.open && g.actedAtIsLowerBound !== true)).toBe(false);
  });

  test("the most generous reading that rescues the release class, and what believing it costs", () => {
    // A reader will ask: is an untagged bump superseded by a later bump really
    // an open gate, or a dead one? Score the generous answer — only the newest
    // version is still waiting, the other eighteen untagged ones are discarded —
    // and the release class clears the bar.
    const releases = corpus.gates.filter((g) => g.kind === "release");
    const newest = releases[0]; // newest first, as the harvest cuts them
    expect(newest.subject).toBe("0.23.0");
    expect(newest.actedAt).toBeNull();

    const generous = scoreGates([...releases.filter((g) => g.actedAt !== null), newest], corpus.asOf);
    expect(generous.total).toBe(7);
    expect(generous.openCount).toBe(1);
    expect(generous.openShare).toBeCloseTo(0.143, 3);
    expect(generous.medianWaitDays).toBe(0);
    expect(generous.clearsBar).toBe(true);

    // The price of that answer, stated rather than buried: it throws away
    // eighteen releases that were prepared and never tagged, and it reads six
    // unmeasurable closures as instantaneous ones. Both moves are exactly the
    // failure the candidate would produce — a release the human never got to —
    // recorded as if it had not happened.
    expect(releases.filter((g) => g.actedAt === null)).toHaveLength(19);
    expect(generous.gates.filter((g) => g.actedAtIsLowerBound).length).toBe(6);
    expect(byKind.release.clearsBar).toBe(false);
  });

  test("the human half of this loop has never once run, across the vault's whole history", () => {
    // `## Results` is the section `ost-agent result` and nothing else writes.
    // Not one commit in 3918 has ever touched it.
    expect(corpus.vaultCommits).toBe(3918);
    expect(corpus.resultsHeadingCommits).toBe(0);
    expect(corpus.gates.filter((g) => g.kind !== "release" && g.actedAt !== null)).toHaveLength(0);

    // Nor is the cost the obstacle. A compute-only lane pre-ran five tests and
    // left paste-ready commands with an estimate attached; the estimate has been
    // outstanding for more than five weeks.
    expect(corpus.draftEstimates[".ost-agent/drafts/compute-docket-2026-07-24.md"]).toBe("3 minutes.");
    const drafts = overall.gates.filter((g) => g.kind === "verdict-draft");
    expect(drafts).toHaveLength(5);
    expect(Math.min(...drafts.map((g) => g.waitDays))).toBeGreaterThan(37);
  });
});

describe("the computation itself", () => {
  const asOf = "2026-01-11T00:00:00.000Z";

  test("an open wait is scored at its running duration against `asOf`, never dropped", () => {
    const open: HumanGate = { kind: "release", subject: "x", readyAt: "2026-01-01T00:00:00.000Z", actedAt: null };
    const scored = scoreGate(open, Date.parse(asOf));
    expect(scored.open).toBe(true);
    expect(scored.waitDays).toBe(10);
    expect(scoreGates([open], asOf).total).toBe(1);
  });

  test("median over an even count is the mean of the two middle values", () => {
    // Stated because the verdict turns on the convention, not just the data.
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBe(0);
  });

  test("both clauses must hold — a perfect median with too many open gates does not clear", () => {
    const gates: HumanGate[] = [
      { kind: "release", subject: "a", readyAt: "2026-01-10T00:00:00.000Z", actedAt: "2026-01-10T00:00:00.000Z" },
      { kind: "release", subject: "b", readyAt: "2026-01-10T00:00:00.000Z", actedAt: "2026-01-10T00:00:00.000Z" },
      { kind: "release", subject: "c", readyAt: "2026-01-11T00:00:00.000Z", actedAt: null },
    ];
    const latency = scoreGates(gates, asOf);
    expect(latency.medianWaitDays).toBe(0);
    expect(latency.clearsMedian).toBe(true);
    expect(latency.openShare).toBeCloseTo(0.333, 3);
    expect(latency.clearsOpenShare).toBe(false);
    expect(latency.clearsBar).toBe(false);
  });

  test("an act that predates the thing it acted on is refused, not floored to zero", () => {
    // A broken pairing hidden inside a good-looking median is the one failure
    // mode this measurement cannot report on itself.
    expect(() =>
      scoreGate(
        { kind: "release", subject: "backwards", readyAt: "2026-01-10T00:00:00.000Z", actedAt: "2026-01-01T00:00:00.000Z" },
        Date.parse(asOf),
      ),
    ).toThrow(/before it was ready/);
  });

  test("an empty set clears nothing — no gates is not a fast gate", () => {
    const empty = scoreGates([], asOf);
    expect(empty.medianWaitDays).toBe(0);
    expect(empty.clearsBar).toBe(false);
  });

  test("every kind is present in a split, so a class that vanishes reads as empty rather than missing", () => {
    const split = scoreGatesByKind([], asOf);
    expect(Object.keys(split).sort()).toEqual([...HUMAN_GATE_KINDS].sort());
  });
});
