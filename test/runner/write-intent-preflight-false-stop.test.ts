/**
 * The write-intent preflight: does refusing when the ground moves actually
 * catch the one collision this building has recorded, without refusing
 * ordinary work?
 *
 * The solution under test declares that a run should state the paths it
 * intends to write and refuse to start when something else already holds
 * them. Its own text names the risk plainly: "fourteen files touched seconds
 * ago is a description of an active merge and also a description of an
 * operator who is simply working." The assumption test beneath it fixes the
 * bar before the corpus was read: refuse the recorded collision, and refuse
 * fewer than 1 in 10 of the sessions that finished cleanly. Either half alone
 * is trivially satisfiable — refuse everything and sensitivity is free,
 * refuse nothing and specificity is free — so both are asserted together.
 *
 * The synthetic cases below run first, in both directions, so a reader can
 * see each signal fire on an input built to carry it and stay silent on one
 * built to look like it and not be it. Only then is the corpus worth reading.
 * `PROVENANCE.md` alongside the fixture records exactly how each corpus case
 * was built and what it cannot support.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  WRITE_INTENT_PREFLIGHT_RULE,
  evaluateWriteIntentPreflight,
  readWorkingTreeSnapshot,
  writeIntentFalseStopCensus,
  type RecordedPreflightCase,
  type WorkingTreeSnapshot,
} from "../../src/runner/write-intent-preflight.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "write-intent-preflight");

const CLEAN: WorkingTreeSnapshot = { headSha: "a".repeat(40), mergeInProgress: false, rebaseInProgress: false, dirty: {} };

// ── the rule, before the corpus was counted ──────────────────────────────────

describe("the bar was fixed before the corpus was counted", () => {
  test("fewer than 1 in 10 clean sessions may be refused", () => {
    expect(WRITE_INTENT_PREFLIGHT_RULE.maxFalseStopShare).toBe(0.1);
  });

  test("the contention window is a fixed, named number", () => {
    expect(WRITE_INTENT_PREFLIGHT_RULE.recentDirtyWindowMs).toBe(5 * 60 * 1000);
  });
});

// ── the decision: each signal fires on the input built to carry it ──────────

describe("an unambiguous ground-moved signal refuses", () => {
  test("a merge stopped mid-flight", () => {
    const v = evaluateWriteIntentPreflight({ paths: ["a.ts"] }, { ...CLEAN, mergeInProgress: true }, 0);
    expect(v).toEqual({ refuse: true, reason: "merge-in-progress", detail: expect.stringContaining("merge") });
  });

  test("a rebase stopped mid-flight", () => {
    const v = evaluateWriteIntentPreflight({ paths: ["a.ts"] }, { ...CLEAN, rebaseInProgress: true }, 0);
    expect(v.refuse).toBe(true);
    expect((v as { reason: string }).reason).toBe("rebase-in-progress");
  });

  test("HEAD having moved since the run last confirmed it", () => {
    const intent = { paths: ["a.ts"], referenceHeadSha: "a".repeat(40) };
    const snapshot = { ...CLEAN, headSha: "b".repeat(40) };
    const v = evaluateWriteIntentPreflight(intent, snapshot, 0);
    expect(v).toEqual({
      refuse: true,
      reason: "head-moved",
      detail: expect.stringContaining(`${"a".repeat(40)} to ${"b".repeat(40)}`),
    });
  });

  test("a declared path already dirty, freshly", () => {
    const now = 1_000_000;
    const snapshot: WorkingTreeSnapshot = { ...CLEAN, dirty: { "a.ts": now - 1_000 } };
    const v = evaluateWriteIntentPreflight({ paths: ["a.ts"] }, snapshot, now);
    expect(v).toEqual({ refuse: true, reason: "path-contended", detail: expect.stringContaining("a.ts") });
  });
});

describe("what looks like ground moving and is not — the false-stop risk the solution names", () => {
  test("no reference HEAD to compare against — the run's first check this pass", () => {
    // Nothing here can say whether the ground moved, so it must not guess "yes".
    const v = evaluateWriteIntentPreflight({ paths: ["a.ts"] }, { ...CLEAN, headSha: "b".repeat(40) }, 0);
    expect(v).toEqual({ refuse: false });
  });

  test("HEAD unchanged, even with other files freshly dirty — an operator simply working", () => {
    const now = 1_000_000;
    const intent = { paths: ["a.ts"], referenceHeadSha: "a".repeat(40) };
    // Fourteen files touched seconds ago, none of them declared. This is the exact
    // shape the solution warns is indistinguishable from an active merge by mtime
    // alone — and it must not refuse, because none of it is on a path this run
    // declared, and HEAD has not moved.
    const dirty: Record<string, number> = {};
    for (let i = 0; i < 14; i++) dirty[`unrelated-${i}.ts`] = now - 5_000;
    const snapshot: WorkingTreeSnapshot = { ...CLEAN, headSha: "a".repeat(40), dirty };
    expect(evaluateWriteIntentPreflight(intent, snapshot, now)).toEqual({ refuse: false });
  });

  test("a declared path dirty, but old — yesterday's WIP, not a live writer", () => {
    const now = 1_000_000;
    const snapshot: WorkingTreeSnapshot = { ...CLEAN, dirty: { "a.ts": now - WRITE_INTENT_PREFLIGHT_RULE.recentDirtyWindowMs - 1 } };
    expect(evaluateWriteIntentPreflight({ paths: ["a.ts"] }, snapshot, now)).toEqual({ refuse: false });
  });

  test("a dirty path the run never declared", () => {
    const now = 1_000_000;
    const snapshot: WorkingTreeSnapshot = { ...CLEAN, dirty: { "b.ts": now - 1_000 } };
    expect(evaluateWriteIntentPreflight({ paths: ["a.ts"] }, snapshot, now)).toEqual({ refuse: false });
  });
});

// ── the live reader, against a real temp repository ──────────────────────────

describe("readWorkingTreeSnapshot, against a real git repository", () => {
  let dir: string;
  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "write-intent-preflight-"));
    git(["init", "-q"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(dir, "a.ts"), "1\n");
    git(["add", "a.ts"]);
    git(["commit", "-q", "-m", "initial"]);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("a clean tree reports no merge, no rebase, nothing dirty", async () => {
    const snap = await readWorkingTreeSnapshot(dir);
    expect(snap.mergeInProgress).toBe(false);
    expect(snap.rebaseInProgress).toBe(false);
    expect(snap.dirty).toEqual({});
    expect(snap.headSha).toMatch(/^[0-9a-f]{40}$/);
  });

  test("an uncommitted edit is reported dirty, with a real mtime", async () => {
    fs.writeFileSync(path.join(dir, "a.ts"), "2\n");
    const before = Date.now();
    const snap = await readWorkingTreeSnapshot(dir);
    expect(Object.keys(snap.dirty)).toEqual(["a.ts"]);
    expect(snap.dirty["a.ts"]).toBeGreaterThanOrEqual(before - 5_000);
  });

  test("a merge stopped on a conflict is reported in progress", async () => {
    git(["checkout", "-q", "-b", "other"]);
    fs.writeFileSync(path.join(dir, "a.ts"), "from-other\n");
    git(["commit", "-q", "-am", "other change"]);
    git(["checkout", "-q", "main"]);
    fs.writeFileSync(path.join(dir, "a.ts"), "from-main\n");
    git(["commit", "-q", "-am", "main change"]);
    try {
      git(["merge", "other"]);
    } catch {
      // expected: the merge stops on a conflict
    }
    expect((await readWorkingTreeSnapshot(dir)).mergeInProgress).toBe(true);
  });
});

// ── the census this test exists to run ────────────────────────────────────────

function committedCorpus(): RecordedPreflightCase[] {
  const parsed = JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8")) as {
    cases: RecordedPreflightCase[];
  };
  return parsed.cases;
}

describe("the census over the committed corpus — PROVENANCE.md records how it was cut", () => {
  const cases = committedCorpus();
  const census = writeIntentFalseStopCensus(cases);

  test("the corpus is the size PROVENANCE.md says it is: one collision, five clean", () => {
    expect(cases).toHaveLength(6);
    expect(census.collisionCases).toBe(1);
    expect(census.cleanCases).toBe(5);
  });

  test("the recorded collision is refused, on HEAD having moved — not on file mtimes", () => {
    const collision = census.verdicts.find((v) => v.isCollision)!;
    expect(collision.sessionId).toBe("424486ec-3489-4b53-8e2b-012232d221ab");
    expect(collision.verdict).toEqual({
      refuse: true,
      reason: "head-moved",
      detail: expect.stringContaining("3fd68a89738a31a5af882b53b52afebcef115b66"),
    });
  });

  test("sensitivity: the rule refuses every recorded collision", () => {
    expect(census.sensitivityMet).toBe(true);
    expect(census.refusedCollisions).toBe(census.collisionCases);
  });

  test("specificity: fewer than 1 in 10 clean sessions are refused", () => {
    expect(census.specificityMet).toBe(true);
    expect(census.falseStopRate).not.toBeNull();
    expect(census.falseStopRate!).toBeLessThan(WRITE_INTENT_PREFLIGHT_RULE.maxFalseStopShare);
    // The actual reading over this corpus, pinned so a change shows up as a
    // changed expectation rather than a quietly different finding: none of the
    // five clean sessions' declared paths were already dirty at their own
    // honest pre-work check, and none of their reference HEADs had moved.
    expect(census.refusedClean).toBe(0);
  });

  test("this is what the assumption test's instrument asserts, in one command", () => {
    // Both halves of `test/runner/write-intent-preflight-false-stop.test.ts`'s own
    // name, held together — the definition of done in the solution node.
    expect(census.sensitivityMet && census.specificityMet).toBe(true);
  });
});
