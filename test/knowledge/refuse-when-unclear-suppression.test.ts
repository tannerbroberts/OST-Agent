/**
 * "Count how many of this vault's recommendations would go silent under a
 * refuse-when-unclear rule" — the instrument beneath "Refuse to recommend when
 * the source does not read cleanly".
 *
 * The solution refuses to recommend when a source cannot be read into exactly one
 * answer. Its own node names where it fails, and the failure is not a corner
 * case: recommendations are the product's actual output, and a rule that
 * suppresses most of them is a way of turning the tool off while appearing
 * careful. So the assumption test asks for a count before it asks for an
 * implementation, with the bar fixed in advance.
 *
 * **The pre-committed threshold, copied from the node rather than restated:** the
 * rule survives if at least 70% of current recommendations still render, per
 * surface, on every live vault. Below 50% on any vault kills the solution rather
 * than tuning it — a rule that silences half the output is a different product
 * decision and must be argued as one. Between 50% and 70%: report and decide
 * nothing, which is a red gate here, because a test whose middle band is silent
 * is a test that cannot come out a failure.
 *
 * **Per surface, never pooled**, and the second block below pins that as
 * behaviour rather than as a comment. A rule that leaves the structural hygiene
 * findings intact while silencing every caution hint would pass on a combined
 * number and fail the question being asked.
 *
 * **What a green run here does not say**, verbatim from the test it serves:
 * whether the suppressed recommendations were the *wrong* ones. A rule could
 * silence 5% and silence exactly the 5% that were correct and load-bearing, and
 * no exit code here distinguishes that from silencing 5% of noise.
 *
 * **The corpus, and the one thing this cannot reach.** The node's threshold says
 * "both vaults" and names them elsewhere in the tree as `ost-agent-meta` and
 * `tetrix-ost`. The live block below measures every vault it can find — the one
 * this repository's committed pointer names, plus any sibling directory of it
 * that is itself a vault — so a second vault is picked up with no code change the
 * moment it is on the machine. On a machine carrying only one, only one is
 * measured, and the bar is enforced on it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { readVaultPointer } from "../../src/config/pointer.js";
import { CLARITY_RULES, readSource, renderAmbiguity } from "../../src/knowledge/clarity.js";
import { LANES } from "../../src/knowledge/lanes.js";
import {
  censusOfTree,
  censusRecommendations,
  formatSuppressionCensus,
  RECOMMENDATION_SURFACES,
  type Recommendation,
} from "../../src/ost/recommendation-census.js";
import { Vault } from "../../src/ost/vault.js";

/** At least this share of a surface's recommendations must survive. Fixed by the node, before the count was run. */
const SURVIVES = 0.7;
/** Below this share the solution is killed rather than tuned. Also fixed by the node. */
const KILLS = 0.5;

const LANE_IDS = LANES.map((l) => l.id);

describe("the rule: a source that does not read into one answer produces no recommendation", () => {
  test("the incident sentence — one that names two lanes — is refused, and the refusal names the settlement", () => {
    // Verbatim shape of the read that produced the opportunity: `ost-agent lanes`
    // quoted as far as `compute-only` and offered a paste-ready command that would
    // have moved the human half of a split test into compute's reach.
    const verdict = readSource({
      kind: "prose",
      quote: "Lane: compute-only for the census, humans-required for the fixing.",
      alternatives: LANE_IDS,
    });
    expect(verdict.reads).toBe("unclear");
    if (verdict.reads !== "unclear") return;
    expect(verdict.report.rule).toBe("multiple-answers");
    expect(verdict.report.trigger).toContain("compute-only");
    expect(verdict.report.trigger).toContain("humans-required");
    // The whole sentence is quoted back, never the fragment that misled the reader.
    expect(verdict.report.quote).toContain("for the fixing");
    // A refusal that names no settlement is a dead end, and a reader with a dead
    // end goes back to trusting the quote.
    expect(verdict.report.settle).not.toBe("");
    expect(renderAmbiguity(verdict.report)).toContain("What has to be settled");
  });

  test("a declaration that names one lane and qualifies nothing reads cleanly", () => {
    expect(
      readSource({
        kind: "prose",
        quote: "Lane: compute-only. It reads two local vaults and counts.",
        alternatives: LANE_IDS,
      }),
    ).toEqual({ reads: "cleanly" });
  });

  test("a structural source always reads cleanly — nothing was excerpted, so nothing was clipped", () => {
    expect(readSource({ kind: "structural", derivation: "sibling extents intersect at 0.8" })).toEqual({
      reads: "cleanly",
    });
  });

  test("no source at all is refused rather than trusted", () => {
    const verdict = readSource({ kind: "prose", quote: "   " });
    expect(verdict.reads === "unclear" && verdict.report.rule).toBe("empty-source");
  });

  test("each remaining rule fires on the shape it is named for, and every rule in the vocabulary is exercised", () => {
    const cases: Array<[string, Recommendation["source"]]> = [
      ["scoped-qualification", { kind: "prose", quote: "This runs unattended but not for anything the operator paid for." }],
      ["conditional-claim", { kind: "prose", quote: "Compute can run this if the census has already been recorded." }],
      ["hedged-claim", { kind: "prose", quote: "This is mostly a replay over artifacts already on disk." }],
      [
        "negated-answer",
        // The marker is `interview`; the sentence denies it. Reading the marker as
        // a reason to flag the test is the confidently-wrong shape the rule exists
        // to stop.
        { kind: "prose", quote: "A census over fixtures already on disk — no person, no interview, no afternoon.", span: { start: 62, end: 71 } },
      ],
    ];
    const fired = new Set<string>(["empty-source", "multiple-answers"]);
    for (const [rule, source] of cases) {
      const verdict = readSource(source);
      expect(verdict.reads, `${rule}: ${JSON.stringify(source)}`).toBe("unclear");
      if (verdict.reads !== "unclear") continue;
      expect(verdict.report.rule).toBe(rule);
      fired.add(rule);
    }
    // A rule nobody can produce an example of is a branch that will never be
    // audited; the vocabulary is closed so that this check can be total.
    expect([...fired].sort()).toEqual([...CLARITY_RULES].sort());
  });

  test("a negation AFTER the answer does not govern it", () => {
    // English negation is pre-posed. The first census run over the live vault
    // caught `it is usability, and no exit code…`, where `no` sits past the marker
    // and negates something else entirely.
    const quote = "That is this candidate's real bet, it is usability, and no exit code settles it.";
    const start = quote.indexOf("usability");
    expect(readSource({ kind: "prose", quote, span: { start, end: start + "usability".length } })).toEqual({
      reads: "cleanly",
    });
  });
});

describe("the count is kept per surface, because a pooled number answers a different question", () => {
  test("a rule that wipes out one surface fails per-surface even when the pooled rate is comfortable", () => {
    const recommendations: Recommendation[] = [
      // Nine structural findings: immune to the rule by construction.
      ...Array.from({ length: 9 }, (_, i): Recommendation => ({
        surface: "hygiene-finding",
        subject: `node ${i}`,
        answer: "annotate: near-duplicate",
        source: { kind: "structural", derivation: "token-set similarity" },
      })),
      // One prose-read hint, refused. Pooled: 9/10 = 90%, comfortably past the bar.
      {
        surface: "caution-hint",
        subject: "node 9",
        answer: "flag humans-required",
        source: { kind: "prose", quote: "This might be a survey, or it might not." },
      },
    ];
    const census = censusRecommendations(recommendations);
    expect(census.bySurface["hygiene-finding"].survival).toBe(1);
    expect(census.bySurface["caution-hint"].survival).toBe(0);
    const pooled =
      RECOMMENDATION_SURFACES.reduce((n, s) => n + census.bySurface[s].rendered, 0) /
      RECOMMENDATION_SURFACES.reduce((n, s) => n + census.bySurface[s].total, 0);
    expect(pooled).toBeGreaterThan(SURVIVES);
    expect(census.bySurface["caution-hint"].survival).toBeLessThan(KILLS);
  });

  test("a surface with nothing on it survives at 1 — no recommendation was lost", () => {
    const census = censusRecommendations([]);
    for (const s of RECOMMENDATION_SURFACES) {
      expect(census.bySurface[s].total).toBe(0);
      expect(census.bySurface[s].survival).toBe(1);
    }
  });
});

/**
 * The live half. Every vault reachable from this repository's committed pointer,
 * measured against the pre-committed bar. Skips visibly on a bare clone, which is
 * the only machine where the corpus does not exist.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function liveVaults(): string[] {
  let pointed: string;
  try {
    pointed = readVaultPointer(REPO_ROOT).dir;
  } catch {
    return [];
  }
  if (!fs.existsSync(path.join(pointed, "ost.config.yaml"))) return [];
  const found = [pointed];
  // Any sibling that is itself a vault. The tree's threshold speaks of "both
  // vaults"; this is how the second one gets counted the moment it is on the
  // machine, without a config change or a test edit.
  const parent = path.dirname(pointed);
  for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(parent, entry.name);
    if (dir === pointed) continue;
    if (fs.existsSync(path.join(dir, "ost.config.yaml"))) found.push(dir);
  }
  return found;
}

const VAULTS = liveVaults();

describe.runIf(VAULTS.length > 0)("what the rule would cost on the live vaults", () => {
  for (const dir of VAULTS) {
    const name = path.basename(dir);
    test(`${name}: at least ${SURVIVES * 100}% of every surface's recommendations still render`, () => {
      const census = censusOfTree(new Vault(dir, { create: false }).readTree());
      const report = formatSuppressionCensus(name, census);
      for (const surface of RECOMMENDATION_SURFACES) {
        const count = census.bySurface[surface];
        // Failing here is a finding, not a bug in this assertion. Below 50% the
        // node says to kill the solution; between 50% and 70% it says to report
        // and decide nothing. Neither is fixed by loosening the number — the
        // rule's detectors are where the argument belongs.
        expect(count.survival, `${surface} below the kill line\n${report}`).toBeGreaterThanOrEqual(KILLS);
        expect(count.survival, `${surface} below the survival bar\n${report}`).toBeGreaterThanOrEqual(SURVIVES);
      }
    });
  }
});
