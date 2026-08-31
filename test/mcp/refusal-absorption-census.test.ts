/**
 * The instrument for "Refusals the tool can prevent become refusals the tool
 * never issues".
 *
 * The assumption beneath that solution is the risky half and it was written down
 * before anyone counted: *enough of the refusal classes that recur most exist for
 * reasons that could be accommodated rather than enforced to make removing the
 * occasion worth doing*. The assumption test fixed both halves of the bar in
 * advance — **at least 4 of the top 10 classes judged safe to absorb, covering
 * 30% or more of all refusals fired.**
 *
 * Over the transcript record, which is the one the solution node points at, it
 * comes out **1 of 10 classes and 30 of 330 refusals (9.1%)** — under both halves.
 * Over this repository's own usage trace it comes out **0 of 10 and 0%**. The bar
 * is not met on either record, and `census.meetsBar` is asserted `false` by name
 * below rather than left to be inferred from an exit code.
 *
 * ## This command being green does not mean the assumption held
 *
 * It is green because the count has been taken and pinned, which is what an
 * instrument on a measurement can mean; `test/friction/path-failure-attribution.test.ts`
 * and `test/preflight/manifest-covers-observed-refusals.test.ts` are both green
 * over censuses that came out against the solution that commissioned them.
 *
 * ## Three findings the exit code cannot carry, so each is asserted by name
 *
 * 1. **The judgement decides it.** On the generous reading — an accommodation
 *    exists, whatever the refusal defends — the bar is MET on both records. Every
 *    class that carries that reading is one whose absorption would dismantle a
 *    guard: read-before-write, the evidence-rung ceiling, the closed parameter
 *    set, the output schema. That is the solution node's own stated failure mode
 *    ("a census that gets that judgement wrong produces a confident number in
 *    favour of dismantling a guard") arriving as a number.
 * 2. **Almost none of it is this repository's to absorb.** 274 of the 295
 *    refusals the transcript top ten account for (93%) were issued by a surface
 *    this repository does not ship. All three candidates the solution node names
 *    — the wait idiom, shell quoting, TypeScript in a workflow script — are in
 *    that 93%.
 * 3. **The one safe class is one sentence, thirty times.** Every one of the 30
 *    `blocked-command-form` refusals in the corpus is `sleep N` followed by a
 *    check, and the refusal text names the form that would have worked each time.
 *
 * ## What carries this file is the controls, not the number
 *
 * A column that answered "load-bearing" to everything would satisfy every
 * assertion about a corpus that came out low. So the census is driven with a
 * fabricated column through the same code path that reported 9.1% over the real
 * one, and required to report MET; the two halves of the bar are shown to fail
 * independently, in both directions; every verdict is required to be derived from
 * a sentence rather than stated as a flag; and every class either corpus
 * exercises is required to be judged, so a class cannot be left out of the column
 * to keep it out of the count.
 *
 * The load-bearing column is NOT ratified. `ABSORPTION_RULE.ratifiedBy` is null
 * and asserted null here: the judgements were composed by a build pass, and the
 * solution node is explicit that which classes are safe to absorb is a human's
 * call. Nothing may be removed from a guard on the strength of a green run here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { FailingCall } from "../../src/telemetry/path-failure-attribution.js";
import { REFUSAL_RULE } from "../../src/telemetry/refusal-coverage.js";
import { REFUSAL_CLASSES, type RecordedRefusal } from "../../src/telemetry/refusal-precondition-coverage.js";
import {
  ABSORPTION_RULE,
  formatRefusalAbsorptionCensus,
  judgementOf,
  rankTranscriptRefusals,
  rankUsageRefusals,
  refusalAbsorptionCensus,
  verdictOf,
  type AbsorptionJudgement,
} from "../../src/telemetry/refusal-absorption.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The transcript record: 719 failing tool calls from 646 session transcripts, cut
 * on 2026-08-09 for a different question entirely. See that fixture's
 * PROVENANCE.md — nobody who chose those rows knew this count would be taken over
 * them, which is the strongest property either corpus here has.
 */
function transcriptCorpus(): FailingCall[] {
  const file = path.join(repoRoot, "test", "fixtures", "path-failure-attribution", "failures.jsonl");
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as FailingCall);
}

/** This repository's own trace: every `ok: false` event the vault's usage log holds. */
function usageCorpus(): RecordedRefusal[] {
  const file = path.join(repoRoot, "test", "fixtures", "usage-refusals", "refusals.jsonl");
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as RecordedRefusal);
}

function transcriptCensus(topN = ABSORPTION_RULE.topN) {
  return refusalAbsorptionCensus(rankTranscriptRefusals(transcriptCorpus()), "transcript", { topN });
}

function usageCensus() {
  const rows = usageCorpus();
  const counts = rankUsageRefusals(rows);
  const classified = counts.reduce((n, c) => n + c.occurrences, 0);
  return refusalAbsorptionCensus(counts, "usage-trace", { unclassified: rows.length - classified });
}

describe("the column is complete, and every verdict comes out of a sentence", () => {
  const judgements = ABSORPTION_RULE.judgements;

  test("every refusal class either taxonomy names is judged exactly once", () => {
    const known = [...REFUSAL_RULE.classes.map((c) => c.id), ...REFUSAL_CLASSES.map((c) => c.id)];
    for (const id of known) {
      expect(judgements.filter((j) => j.cls === id).length, `class ${id}`).toBe(1);
    }
    // And no judgement names a class that does not exist, which is how a column
    // grows entries nothing can ever count.
    for (const j of judgements) expect(known, `judgement ${j.cls}`).toContain(j.cls);
    expect(judgements.length).toBe(known.length);
  });

  test("nothing is judged safe without naming what would honour the call", () => {
    for (const j of judgements) {
      if (verdictOf(j) !== "safe-to-absorb") continue;
      expect(j.protects).toBeNull();
      expect(j.absorption!.behaviour.length, `${j.cls} behaviour`).toBeGreaterThan(40);
    }
  });

  test("nothing is judged load-bearing without naming what it defends", () => {
    for (const j of judgements) {
      if (verdictOf(j) !== "load-bearing") continue;
      expect(j.protects!.length, `${j.cls} protects`).toBeGreaterThan(40);
    }
  });

  test("the third answer exists, and is not collapsed into either of the other two", () => {
    // A refusal that protects nothing AND has nothing to honour the call with is
    // neither safe nor load-bearing. Filing these as "safe" would have added five
    // classes to the count; filing them as "load-bearing" would have defended
    // guards that defend nothing.
    const nothing = judgements.filter((j) => verdictOf(j) === "nothing-to-absorb").map((j) => j.cls);
    expect([...nothing].sort()).toEqual([
      "malformed-argument",
      "missing-config",
      "missing-path",
      "no-product-repo",
      "repo-path-missing",
      "script-parse-error",
      "tool-not-available",
      "unknown-skill",
    ]);
  });

  test("the verdict is derived from the pair, never stored", () => {
    const at = (protects: string | null, absorption: boolean): AbsorptionJudgement => ({
      cls: "x",
      issuedBy: "this-repository",
      protects,
      absorption: absorption ? { mode: "accommodate", behaviour: "b" } : null,
    });
    expect(verdictOf(at(null, true))).toBe("safe-to-absorb");
    expect(verdictOf(at("something real", true))).toBe("load-bearing");
    expect(verdictOf(at("something real", false))).toBe("load-bearing");
    expect(verdictOf(at(null, false))).toBe("nothing-to-absorb");
  });

  test("every precedent names a file in this repository that carries the symbol", () => {
    for (const j of judgements) {
      if (!j.precedent) continue;
      const [file, symbol] = j.precedent.split(":");
      const full = path.join(repoRoot, "src", file);
      expect(fs.existsSync(full), `${j.cls} precedent ${file}`).toBe(true);
      expect(fs.readFileSync(full, "utf8"), `${j.cls} precedent symbol`).toContain(symbol);
    }
  });

  test("nobody has ratified the load-bearing column", () => {
    // Asserted by name so that ratifying it is a deliberate edit to this file as
    // well as to the rule. A green run here is a count, never a licence.
    expect(ABSORPTION_RULE.ratifiedBy).toBeNull();
    expect(transcriptCensus().ratifiedBy).toBeNull();
    expect(formatRefusalAbsorptionCensus(transcriptCensus())).toContain("NOT RATIFIED");
  });
});

describe("the census can come out either way on the same code path", () => {
  const safe = (cls: string): AbsorptionJudgement => ({
    cls,
    issuedBy: "this-repository",
    protects: null,
    absorption: { mode: "accommodate", behaviour: "honour it" },
  });
  const bearing = (cls: string): AbsorptionJudgement => ({
    cls,
    issuedBy: "this-repository",
    protects: "something real",
    absorption: null,
  });
  const counts = (spec: [string, number][]) => spec.map(([cls, occurrences]) => ({ cls, occurrences }));

  test("a column of four safe classes over a corpus they dominate reports MET", () => {
    const c = refusalAbsorptionCensus(counts([["a", 30], ["b", 30], ["c", 20], ["d", 15], ["e", 5]]), "synthetic", {
      judgements: [safe("a"), safe("b"), safe("c"), safe("d"), bearing("e")],
    });
    expect(c.verdict.safe.length).toBe(4);
    expect(c.verdict.coverage).toBeCloseTo(95 / 100, 5);
    expect(c.meetsBar).toBe(true);
    expect(c.judgementDecides).toBe(false);
  });

  test("a column with nothing safe in it reports 0%", () => {
    const c = refusalAbsorptionCensus(counts([["a", 30], ["b", 30]]), "synthetic", {
      judgements: [bearing("a"), bearing("b")],
    });
    expect(c.verdict.safe).toEqual([]);
    expect(c.verdict.coverage).toBe(0);
    expect(c.meetsBar).toBe(false);
  });

  test("four rare safe classes clear the count half and fail the coverage half", () => {
    // The failure mode the solution node names for itself: "four classes that are
    // each rare would clear the count and fail the coverage, and absorbing them
    // would change nothing an operator notices".
    const c = refusalAbsorptionCensus(counts([["e", 90], ["a", 3], ["b", 3], ["c", 2], ["d", 2]]), "synthetic", {
      judgements: [safe("a"), safe("b"), safe("c"), safe("d"), bearing("e")],
    });
    expect(c.verdict.meetsCountBar).toBe(true);
    expect(c.verdict.meetsCoverageBar).toBe(false);
    expect(c.meetsBar).toBe(false);
  });

  test("one heavy safe class clears the coverage half and fails the count half", () => {
    const c = refusalAbsorptionCensus(counts([["a", 90], ["e", 10]]), "synthetic", {
      judgements: [safe("a"), bearing("e")],
    });
    expect(c.verdict.meetsCoverageBar).toBe(true);
    expect(c.verdict.meetsCountBar).toBe(false);
    expect(c.meetsBar).toBe(false);
  });

  test("a class the corpus holds and the column does not is reported, never dropped", () => {
    const c = refusalAbsorptionCensus(counts([["a", 30], ["unheard-of", 70]]), "synthetic", {
      judgements: [safe("a")],
    });
    expect(c.unjudged).toEqual(["unheard-of"]);
    // It stays in the denominator: a class nobody judged is not a class nobody hit.
    expect(c.refusals).toBe(100);
    expect(c.verdict.coverage).toBeCloseTo(0.3, 5);
    expect(formatRefusalAbsorptionCensus(c)).toContain("UNJUDGED");
  });
});

describe("the census over the transcript record — the one the solution points at", () => {
  test("the bar the assumption test fixed in advance is NOT met, on either half", () => {
    const c = transcriptCensus();
    // Printed so a red run tells its reader the numbers, not just that one moved.
    if (c.meetsBar) console.log(formatRefusalAbsorptionCensus(c));

    expect(c.refusals).toBe(330);
    expect(c.ranked.length).toBe(24);
    expect(c.unjudged).toEqual([]);
    expect(c.verdict.name).toBe("strict");
    expect(c.verdict.safe).toEqual(["blocked-command-form"]);
    expect(c.verdict.covered).toBe(30);
    expect(c.verdict.coverage).toBeCloseTo(30 / 330, 5);
    expect(c.verdict.meetsCountBar).toBe(false);
    expect(c.verdict.meetsCoverageBar).toBe(false);
    expect(c.meetsBar).toBe(false);
  });

  test("and the judgement is what decides it — the generous reading clears both halves", () => {
    const c = transcriptCensus();
    const generous = c.readings.find((r) => r.name === "could-have-honoured")!;
    expect(generous.safe).toEqual([
      "read-before-write",
      "blocked-command-form",
      "output-schema-violation",
      "closed-parameter-set",
      "evidence-rung-ceiling",
    ]);
    expect(generous.covered).toBe(138);
    expect(generous.meetsBar).toBe(true);
    expect(c.judgementDecides).toBe(true);

    // Every class that carries the generous reading and not the strict one is a
    // guard: each names, in the column, the harm it defends. That is the whole
    // finding — the bar is met exactly when guards are counted as absorbable.
    for (const cls of generous.safe.filter((s) => !c.verdict.safe.includes(s))) {
      expect(judgementOf(cls)!.protects, cls).not.toBeNull();
    }
  });

  test("93% of what the top ten account for is issued by a surface this repository cannot change", () => {
    const c = transcriptCensus();
    expect(c.topOccurrences).toBe(295);
    expect(c.byIssuer["another-surface"]).toEqual({ classes: 8, occurrences: 274 });
    expect(c.byIssuer["this-repository"]).toEqual({ classes: 2, occurrences: 21 });
    expect(c.byIssuer["another-surface"].occurrences / c.topOccurrences).toBeGreaterThan(0.9);
    // The three candidates the solution node names are all in that number.
    for (const cls of ["blocked-command-form", "script-parse-error", "argument-content-rejected"]) {
      expect(judgementOf(cls)!.issuedBy, cls).toBe("another-surface");
    }
  });

  test("the top-ten cut is not what decided it: the whole corpus says the same", () => {
    // A safe class sits just under the cut, so the obvious objection is that the
    // top ten hid it. Judge all 24 and the count half still fails.
    const whole = transcriptCensus(24);
    expect(whole.ranked.find((r) => r.cls === "response-size-cap")!.rank).toBeGreaterThan(ABSORPTION_RULE.topN);
    expect(whole.verdict.safe).toEqual([
      "blocked-command-form",
      "response-size-cap",
      "conditionally-required-parameter",
    ]);
    expect(whole.verdict.covered).toBe(36);
    expect(whole.verdict.meetsCountBar).toBe(false);
    expect(whole.meetsBar).toBe(false);
  });

  test("the one safe class is one sentence, thirty times", () => {
    const blocked = transcriptCorpus().filter((f) => /^<tool_use_error>Blocked: /.test(f.error));
    expect(blocked.length).toBe(30);
    // Not thirty different blocked forms: one idiom — wait a while, then look —
    // and the refusal names the form that would have worked in every one of them.
    for (const row of blocked) {
      expect(row.error).toMatch(/^<tool_use_error>Blocked: sleep \d+ followed by:/);
      expect(row.error).toContain("Monitor with an until-loop");
    }
    expect(new Set(blocked.map((b) => b.session)).size).toBeGreaterThan(5);
  });
});

describe("the census over this repository's own trace — the surface it could absorb", () => {
  test("nothing in the top ten is safe to absorb on the strict reading", () => {
    const c = usageCensus();
    if (c.meetsBar) console.log(formatRefusalAbsorptionCensus(c));

    expect(c.refusals).toBe(117);
    // The corpus holds 118 rows: one refusal's reason was truncated away by the
    // tracer at 300 characters before any classifier could read it. It is
    // reported rather than folded into the denominator.
    expect(c.unclassified).toBe(1);
    expect(c.unjudged).toEqual([]);
    expect(c.verdict.safe).toEqual([]);
    expect(c.verdict.coverage).toBe(0);
    expect(c.meetsBar).toBe(false);
  });

  test("every class in it is this repository's own, which the transcript record is not", () => {
    const c = usageCensus();
    expect(c.byIssuer["this-repository"].classes).toBe(10);
    expect(c.byIssuer["another-surface"]).toEqual({ classes: 0, occurrences: 0 });
  });

  test("the generous reading clears here too, on one class that is 56% of the trace", () => {
    const c = usageCensus();
    const generous = c.readings.find((r) => r.name === "could-have-honoured")!;
    expect(generous.safe).toEqual([
      "no-such-node",
      "instrument-not-a-spec-file",
      "instrument-spec-missing",
      "no-evidence-class",
    ]);
    expect(generous.covered).toBe(77);
    expect(generous.meetsBar).toBe(true);
    // And the class carrying it is the one whose accommodation this repository
    // already built and deliberately declined to act on — `fs/near-miss.ts`
    // answers a miss with the nearest thing that exists and refuses to follow its
    // own suggestion, because the recorded near-miss was one character away and
    // completely wrong.
    expect(c.ranked[0]).toMatchObject({ cls: "no-such-node", occurrences: 66, verdict: "load-bearing" });
    expect(judgementOf("no-such-node")!.precedent).toBe("fs/near-miss.ts:nearMiss");
  });
});

describe("the report a person reads", () => {
  test("it leads with ratification and with who could absorb anything at all", () => {
    const text = formatRefusalAbsorptionCensus(transcriptCensus());
    expect(text.indexOf("NOT RATIFIED")).toBeLessThan(text.indexOf("strict"));
    expect(text.indexOf("cannot change")).toBeLessThan(text.indexOf("strict"));
    expect(text).toContain("THE JUDGEMENT DECIDES IT");
  });

  test("it prints the column, so the human it is addressed to can check it", () => {
    const text = formatRefusalAbsorptionCensus(transcriptCensus());
    for (const row of transcriptCensus().top) {
      expect(text).toContain(row.cls);
      if (row.judgement?.protects) expect(text).toContain(row.judgement.protects);
    }
    // Including what the top-N cut left out, which is where a safe class is.
    expect(text).toContain("Below the cut");
    expect(text).toContain("response-size-cap");
  });
});
