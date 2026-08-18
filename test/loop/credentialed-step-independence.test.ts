/**
 * The instrument for the meta vault's assumption test of the same name. Ten
 * past runs of this repository's own agent (`test/fixtures/credentialed-steps/`
 * — read PROVENANCE.md before believing anything here), each replayed through
 * {@link classifyStep} and {@link independentFraction} to see how much of a
 * run's work sat upstream of the first step that needed the operator's own
 * credential.
 *
 * The bar was pre-committed in the vault node before any of this existed: in at
 * least 6 of the 10 runs, half or more of the steps must be independent of any
 * credentialed step — asserted over the distribution, never the mean, because a
 * mean hides the runs where nothing was independent.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyStep,
  independentFraction,
  runIndependence,
  type RunStep,
} from "../../src/loop/credentialedSteps.js";

interface FixtureRun {
  run: string;
  steps: RunStep[];
}

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/credentialed-steps/runs.json"), "utf8"),
) as { runs: FixtureRun[] };

describe("classifyStep", () => {
  it("does not flag ordinary local work", () => {
    expect(classifyStep({ tool: "Read" })).toBe(false);
    expect(classifyStep({ tool: "Edit" })).toBe(false);
    expect(classifyStep({ tool: "Grep" })).toBe(false);
    expect(classifyStep({ tool: "Bash", command: "npx vitest run" })).toBe(false);
    expect(classifyStep({ tool: "Bash", command: "git status --short" })).toBe(false);
    expect(classifyStep({ tool: "Bash", command: "git commit -m 'fix'" })).toBe(false);
    expect(classifyStep({ tool: "Bash", command: "git log --oneline -5" })).toBe(false);
  });

  it("flags the credentials this repo's own broker gates", () => {
    expect(classifyStep({ tool: "WebSearch" })).toBe(true);
    expect(classifyStep({ tool: "WebFetch" })).toBe(true);
    expect(classifyStep({ tool: "mcp__ost-agent__ost_search_web" })).toBe(true);
    expect(classifyStep({ tool: "mcp__ost-agent__ost_read_web" })).toBe(true);
    expect(classifyStep({ tool: "mcp__ost-agent__ost_ingest_inbox" })).toBe(true);
  });

  it("flags the credential this build loop itself blocks on", () => {
    expect(classifyStep({ tool: "Bash", command: "git push -u origin HEAD" })).toBe(true);
    expect(classifyStep({ tool: "Bash", command: "git fetch origin" })).toBe(true);
    expect(classifyStep({ tool: "Bash", command: "cd /repo && git pull" })).toBe(true);
    expect(classifyStep({ tool: "Bash", command: "gh pr create --title x" })).toBe(true);
    expect(classifyStep({ tool: "Bash", command: "cd /repo && gh pr checks" })).toBe(true);
  });

  it("flags a raw network fetch or a registry publish", () => {
    expect(classifyStep({ tool: "Bash", command: "curl -s https://example.com" })).toBe(true);
    expect(classifyStep({ tool: "Bash", command: "npm publish" })).toBe(true);
  });
});

describe("independentFraction", () => {
  it("is 1 for a run with no credentialed step", () => {
    const steps: RunStep[] = [{ tool: "Read" }, { tool: "Edit" }, { tool: "Bash", command: "npx tsc --noEmit" }];
    expect(independentFraction(steps)).toBe(1);
  });

  it("is 0 when the very first step is credentialed", () => {
    const steps: RunStep[] = [{ tool: "Bash", command: "gh pr list" }, { tool: "Read" }];
    expect(independentFraction(steps)).toBe(0);
  });

  it("counts only the steps strictly before the first credentialed one", () => {
    const steps: RunStep[] = [
      { tool: "Read" },
      { tool: "Edit" },
      { tool: "Bash", command: "git push" },
      { tool: "Read" }, // downstream of the push — not credentialed itself, still not counted
    ];
    expect(independentFraction(steps)).toBe(0.5);
  });

  it("is vacuously 1 for an empty run", () => {
    expect(independentFraction([])).toBe(1);
  });
});

describe("the corpus is the one the assumption test named", () => {
  it("holds ten runs", () => {
    expect(fixture.runs).toHaveLength(10);
  });

  it("every run carries at least one step", () => {
    for (const run of fixture.runs) {
      expect(run.steps.length, run.run).toBeGreaterThan(0);
    }
  });
});

describe("replaying the ten runs", () => {
  const result = runIndependence(fixture.runs.map((r) => r.steps));

  /**
   * The solution node pre-committed its bar at 6 of 10. The honest replay
   * against this repository's own history comes up one run short: 5 of 10,
   * with the sixth (`run-02`, 51 of 106 steps, 0.481) missing by a single
   * step. Forcing this to 6 by loosening the classifier or reselecting the
   * corpus would be exactly the "spec bent to fit the code" this loop must
   * not do — so this test pins the number the replay actually found, and the
   * assumption goes back to the tree unmet rather than quietly assumed.
   */
  it("clears half-independent in 5 of the 10 runs — one short of the node's 6-of-10 bar", () => {
    const detail = fixture.runs
      .map((r, i) => `${result.fractions[i] >= 0.5 ? "  qualifies" : "below bar"}  ${r.run}  (${result.fractions[i].toFixed(3)})`)
      .join("\n");
    expect(result.qualifying, `\n${detail}\n`).toBe(5);
    expect(result.meetsBar).toBe(false);
  });

  it("the shortfall is a distribution fact a mean would hide", () => {
    // A mean over this corpus rounds to a healthier number than either bar: two
    // runs are almost entirely downstream of an early credentialed step (the
    // "reordering buys almost nothing" case the solution node itself warns
    // against), while the near-miss run and three solid runs pull the mean up.
    // Asserting the mean instead of the per-run count would have hidden both
    // the near-miss and the two worst runs behind one comfortable-looking number.
    expect(Math.min(...result.fractions)).toBeLessThan(0.2);
    const mean = result.fractions.reduce((a, b) => a + b, 0) / result.fractions.length;
    expect(mean).toBeGreaterThan(0.5);
    expect(result.fractions.filter((f) => f < 0.5).length).toBe(5);
  });
});
