/**
 * The instrument for the meta vault's assumption test of the same name:
 * "Take ten past blocked runs and measure how much work sat independent of
 * the block."
 *
 * Ten captured runs (`test/fixtures/blocked-runs/`, see PROVENANCE.md) each
 * filed `ost_flag_humans_required` and then kept issuing node-mutating tool
 * calls. For each run, the block's `test`/`why` stand in for an
 * `AskedFork` and the run's outstanding work is partitioned by the same
 * conservative dependence rule `question-bank.ts` already commits to
 * (`partitionOutstanding` / `classifyWork`), authored against an unrelated
 * corpus so this bar cannot be tuned to clear itself.
 *
 * The pre-committed bar: in at least 6 of the 10 runs, half or more of the
 * outstanding work is independent of the block.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { partitionOutstanding, type AskedFork } from "../../src/loop/question-bank.js";

interface BlockedRun {
  session: string;
  entries: number;
  blockedAtEntry: number;
  blockedAt: string;
  test: string;
  why: string;
  outstanding: string[];
}

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../fixtures/blocked-runs/runs.json"), "utf8"),
) as { runs: BlockedRun[] };

describe("the corpus is the one the assumption test named", () => {
  it("holds ten blocked runs, each with a block and at least one outstanding item", () => {
    expect(fixture.runs).toHaveLength(10);
    for (const run of fixture.runs) {
      expect(run.test.length, run.session).toBeGreaterThan(0);
      expect(run.outstanding.length, run.session).toBeGreaterThan(0);
    }
  });

  it("every run is a distinct session", () => {
    expect(new Set(fixture.runs.map((r) => r.session)).size).toBe(10);
  });
});

describe("walking the dependency of each run's outstanding work", () => {
  const walked = fixture.runs.map((run) => {
    const fork: AskedFork = { header: "", question: `${run.test} ${run.why}`, options: [] };
    const partition = partitionOutstanding(fork, run.outstanding);
    const share = partition.canProceed.length / run.outstanding.length;
    return {
      session: run.session.slice(0, 8),
      outstanding: run.outstanding.length,
      independent: partition.canProceed.length,
      share,
      material: share >= 0.5,
    };
  });

  it("in at least 6 of 10 runs, half or more of the outstanding work is independent of the block", () => {
    const material = walked.filter((w) => w.material);
    const detail = walked
      .map((w) => `${w.material ? "  material" : "not material"}  ${w.session}  ${w.independent}/${w.outstanding} (${w.share.toFixed(2)})`)
      .join("\n");
    expect(material.length, `\n${detail}\n`).toBeGreaterThanOrEqual(6);
  });
});
