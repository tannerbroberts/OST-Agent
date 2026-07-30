/**
 * The health record — one machine-readable line per firing, verdict derived
 * from exit codes (H1), omission visible (H4).
 *
 * Two things here are not about the verdict at all and matter just as much.
 * The record lives under `.git/`, because every mutating MCP tool commits with
 * `git add -A` and a record in the working tree would be swept into the next
 * `mcp: <tool>` commit — W2's failure manufactured on every firing. And
 * `readRuns` admits a line only if its `startedAt` parses, because the cadence
 * gate sorts on that field and the recovered version accepted any string at
 * all.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  appendStep,
  computeVerdict,
  readRuns,
  runsPath,
  sealRun,
  startRun,
  sweepCrashed,
  type LoopRunRecord,
} from "../../src/loop/health.js";

let vault: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-health-"));
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  fs.writeFileSync(path.join(vault, "Root.md"), "# Root\n");
  git("add", "-A");
  git("commit", "-qm", "root");
});
afterEach(() => fs.rmSync(vault, { recursive: true, force: true }));

const meta = { loopVersion: "0.0.0", cliVersion: "0.0.0" };
const step = (phase: string, exit: number) => ({ phase, command: phase, exit, durationMs: 1 });

describe("where the record lives", () => {
  test("the ledger is inside .git, so `git add -A` can never sweep it into a node commit", () => {
    startRun(vault, meta);
    appendStep(vault, step("pass", 0));
    appendStep(vault, step("check", 0));
    sealRun(vault, { headAfter: "deadbeef" });

    expect(runsPath(vault).startsWith(path.join(vault, ".git") + path.sep)).toBe(true);
    // The working tree the next auto-committing tool sees must be clean (D5).
    expect(git("status", "--porcelain").trim()).toBe("");
  });

  test("a vault that is not a git checkout refuses to open a run rather than firing unrecorded", () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "ost-nogit-"));
    try {
      expect(() => startRun(bare, meta)).toThrow(/not a git checkout/);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe("the verdict comes from what was observed, never from what was claimed", () => {
  const base: LoopRunRecord = {
    runId: "r", startedAt: "2026-07-29T00:00:00.000Z", loopVersion: "0", cliVersion: "0", steps: [],
  };

  test("a red step is unhealthy however green the rest of the firing was", () => {
    const steps = [{ ...step("pass", 0), at: "" }, { ...step("check", 1), at: "" }];
    expect(computeVerdict({ ...base, headBefore: "a", headAfter: "b", steps })).toBe("unhealthy");
  });

  test("a skipped required phase is unhealthy — omission does not read as healthy", () => {
    // Every step green, work was done, and `check` never ran. H4.
    const run = { ...base, headBefore: "a", headAfter: "b", steps: [{ ...step("pass", 0), at: "" }] };
    expect(computeVerdict(run)).toBe("unhealthy");
  });

  test("a firing that moved no commit is no-op, not healthy", () => {
    const steps = [{ ...step("pass", 0), at: "" }, { ...step("check", 0), at: "" }];
    expect(computeVerdict({ ...base, headBefore: "a", headAfter: "a", steps })).toBe("no-op");
  });

  test("an unobservable HEAD is no-op too — healthy is a claim, and it was not earned", () => {
    const steps = [{ ...step("pass", 0), at: "" }, { ...step("check", 0), at: "" }];
    expect(computeVerdict({ ...base, steps })).toBe("no-op");
  });

  test("both phases green and the tree moved is the only way to healthy", () => {
    const steps = [{ ...step("pass", 0), at: "" }, { ...step("check", 0), at: "" }];
    expect(computeVerdict({ ...base, headBefore: "a", headAfter: "b", steps })).toBe("healthy");
  });
});

describe("a firing that dies is visible to the next one", () => {
  test("an unsealed marker becomes exactly one `crashed` record, and the marker is cleared", () => {
    const opened = startRun(vault, meta);
    appendStep(vault, step("pass", 0));
    // no seal — the process died here.
    const swept = sweepCrashed(vault);
    expect(swept?.verdict).toBe("crashed");
    expect(swept?.runId).toBe(opened.runId);

    const runs = readRuns(vault);
    expect(runs).toHaveLength(1);
    expect(runs[0].verdict).toBe("crashed");
    // Sweeping twice must not manufacture a second record for one firing.
    expect(sweepCrashed(vault)).toBeNull();
    expect(readRuns(vault)).toHaveLength(1);
  });

  test("one firing appends exactly one line", () => {
    startRun(vault, meta);
    appendStep(vault, step("pass", 0));
    appendStep(vault, step("check", 0));
    sealRun(vault, { headAfter: "b" });
    expect(readRuns(vault)).toHaveLength(1);
  });
});

describe("readRuns cannot be poisoned by a line it cannot read", () => {
  function planted(...lines: string[]): void {
    fs.mkdirSync(path.dirname(runsPath(vault)), { recursive: true });
    fs.writeFileSync(runsPath(vault), lines.join("\n") + "\n");
  }

  test("a line whose startedAt is not a timestamp is dropped, not sorted to the top", () => {
    planted(
      JSON.stringify({ runId: "real", startedAt: "2026-07-29T10:00:00.000Z", verdict: "healthy", steps: [] }),
      JSON.stringify({ runId: "junk", startedAt: "tomorrow", verdict: "healthy", steps: [] }),
    );
    expect(readRuns(vault).map((r) => r.runId)).toEqual(["real"]);
  });

  test("a corrupt line never hides the runs around it", () => {
    planted(
      JSON.stringify({ runId: "a", startedAt: "2026-07-29T09:00:00.000Z", steps: [] }),
      "{not json",
      JSON.stringify({ runId: "b", startedAt: "2026-07-29T10:00:00.000Z", steps: [] }),
    );
    expect(readRuns(vault).map((r) => r.runId)).toEqual(["b", "a"]);
  });

  test("a verdict outside the vocabulary is dropped rather than handed to a reader", () => {
    planted(JSON.stringify({ runId: "a", startedAt: "2026-07-29T09:00:00.000Z", verdict: "great", steps: [] }));
    expect(readRuns(vault)[0].verdict).toBeUndefined();
  });
});
