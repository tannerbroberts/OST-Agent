/**
 * The instrument for "Items age out of the default view into a backlog that is
 * counted but not reported", by way of its assumption test — "Replay past
 * sweeps to see what an ageing rule would have moved to the backlog".
 *
 * The node's definition of done states what green has to mean, and it is one
 * sentence with two halves: *the ageing rule moves items out of the default view
 * while keeping them counted and recoverable — the distinction between a backlog
 * and a quiet deletion.* So this file pins four things, and the last two are the
 * ones that make it an instrument rather than a demonstration:
 *
 *   1. **The rule is a counter over past sweeps, not over the clock.** N
 *      consecutive passes with nothing done, replayed against sweeps that
 *      already happened. There is already a calendar-age rule for evidence in
 *      `next-work.ts` (`evidence.ageOutDays`); this is a different rule with a
 *      different subject and the two must not be confused.
 *   2. **"Nothing was done about it" is checked, not assumed from presence.** An
 *      opportunity that gained a solution is still on the queue and is not being
 *      neglected. A presence-only counter buries it, which is precisely the
 *      failure the assumption underneath this solution names.
 *   3. **The backlog is counted and recoverable.** Active + backlog partitions
 *      the final sweep exactly; every aged item comes back with the pass it aged
 *      out on and the item itself; something worked on again leaves the backlog.
 *   4. **A replay over nothing cannot report a clean result.** Zero sweeps
 *      throws rather than returning an empty backlog, because "the rule would
 *      have buried nothing" and "the replay looked at nothing" are the same
 *      sentence otherwise.
 *
 * The end-to-end half builds a real vault, commits a real history, and
 * reconstructs the sweeps from git — no recorded queue exists anywhere in this
 * product, so reconstruction is the only route to a past sweep and the test has
 * to exercise it rather than hand the rule a fixture and call it replayed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { Vault } from "../../src/ost/vault.js";
import { MIN_AGEING_PASSES, replayAgeingRule, formatAgeingReplay, type SweepObservation } from "../../src/ost/ageing.js";
import { replayPastSweeps, sampleCommits } from "../../src/eval/ageing-replay.js";

/** A sweep, written the way a replay hands one over: a moment, a ref, some keys. */
function sweep(n: number, items: Array<string | { key: string; signature: string }>): SweepObservation {
  return {
    at: `2026-08-${String(n).padStart(2, "0")}T00:00:00.000Z`,
    ref: `sha${n}`,
    items: items.map((i) => (typeof i === "string" ? { key: i } : i)),
  };
}

describe("the rule: N consecutive passes with nothing done about it", () => {
  test("an item on every one of five passes ages out; one that arrived late does not", () => {
    const observations = [
      sweep(1, ["stranded-a"]),
      sweep(2, ["stranded-a"]),
      sweep(3, ["stranded-a", "fresh-b"]),
      sweep(4, ["stranded-a", "fresh-b"]),
      sweep(5, ["stranded-a", "fresh-b"]),
    ];

    const replay = replayAgeingRule(observations, { passes: 5 });

    expect(replay.backlog.items.map((i) => i.key)).toEqual(["stranded-a"]);
    expect(replay.active.map((i) => i.key)).toEqual(["fresh-b"]);
    // Not merely "it aged out" — the pass it aged out on is the number a human
    // checks the rule against.
    expect(replay.backlog.items[0].passesUntouched).toBe(5);
    expect(replay.backlog.items[0].agedOutRef).toBe("sha5");
    expect(replay.backlog.items[0].untouchedSince).toBe(observations[0].at);
  });

  test("a streak is CONSECUTIVE — an item that left the queue and came back starts over", () => {
    const observations = [
      sweep(1, ["on-and-off"]),
      sweep(2, ["on-and-off"]),
      sweep(3, []), // cleared
      sweep(4, ["on-and-off"]), // filed again
      sweep(5, ["on-and-off"]),
    ];

    const replay = replayAgeingRule(observations, { passes: 3 });

    expect(replay.backlog.count).toBe(0);
    expect(replay.active.map((i) => i.key)).toEqual(["on-and-off"]);
  });

  test("a threshold below 2 is refused rather than clamped", () => {
    expect(() => replayAgeingRule([sweep(1, ["x"])], { passes: 1 })).toThrow(/at least 2 consecutive passes/);
    expect(MIN_AGEING_PASSES).toBe(2);
  });
});

describe("`nothing was done about it` is checked, not inferred from presence", () => {
  /**
   * The assumption this solution rests on, in one test: ageing rewards neglect,
   * and the items most likely to be ignored are the hard ones. An opportunity
   * that is being worked through — one new solution per pass, still short of
   * three — is on the queue on every single pass. A counter that reads presence
   * as neglect backlogs the work in progress.
   */
  test("an item worked on between passes restarts its streak and never ages out", () => {
    const observations = [
      sweep(1, [{ key: "hard-opportunity", signature: "0/3" }]),
      sweep(2, [{ key: "hard-opportunity", signature: "0/3" }]),
      sweep(3, [{ key: "hard-opportunity", signature: "1/3" }]), // somebody ideated
      sweep(4, [{ key: "hard-opportunity", signature: "1/3" }]),
      sweep(5, [{ key: "hard-opportunity", signature: "2/3" }]), // and again
    ];

    const replay = replayAgeingRule(observations, { passes: 3 });

    expect(replay.backlog.count).toBe(0);
    expect(replay.active.map((i) => i.key)).toEqual(["hard-opportunity"]);
  });

  test("an item already in the backlog is FREED the moment somebody touches it", () => {
    const observations = [
      sweep(1, [{ key: "neglected", signature: "0/3" }]),
      sweep(2, [{ key: "neglected", signature: "0/3" }]),
      sweep(3, [{ key: "neglected", signature: "0/3" }]), // aged out here
      sweep(4, [{ key: "neglected", signature: "1/3" }]), // and freed here
    ];

    const replay = replayAgeingRule(observations, { passes: 3 });

    expect(replay.backlog.count).toBe(0);
    expect(replay.movements).toEqual([
      { kind: "aged-out", key: "neglected", at: observations[2].at, ref: "sha3", passesUntouched: 3 },
      { kind: "returned", key: "neglected", at: observations[3].at, ref: "sha4", passesUntouched: 3, because: "worked-on" },
    ]);
  });

  test("an item with no signature is aged on presence alone — the caller's declaration, not a default", () => {
    const observations = [sweep(1, ["evidence-id"]), sweep(2, ["evidence-id"]), sweep(3, ["evidence-id"])];

    expect(replayAgeingRule(observations, { passes: 3 }).backlog.count).toBe(1);
  });
});

describe("counted and recoverable — the difference between a backlog and a deletion", () => {
  const observations = [
    sweep(1, ["a", "b", "c"]),
    sweep(2, ["a", "b", "c"]),
    sweep(3, ["a", "b", "c", "d"]),
  ];

  test("active plus backlog is exactly the final sweep — nothing in both, nothing in neither", () => {
    const replay = replayAgeingRule(observations, { passes: 3 });

    expect(replay.outstanding).toBe(4);
    expect(replay.active.length + replay.backlog.count).toBe(replay.outstanding);
    const keys = [...replay.active.map((i) => i.key), ...replay.backlog.items.map((i) => i.key)].sort();
    expect(keys).toEqual(["a", "b", "c", "d"]);
    expect(new Set(keys).size).toBe(4);
  });

  test("the backlog is a count AND the items — every aged item carries what it takes to get it back", () => {
    const replay = replayAgeingRule(observations, { passes: 3 });

    expect(replay.backlog.count).toBe(3);
    expect(replay.backlog.count).toBe(replay.backlog.items.length);
    for (const aged of replay.backlog.items) {
      expect(aged.item.key).toBe(aged.key);
      expect(aged.agedOutAt).toBe(observations[2].at);
      expect(aged.passesUntouched).toBeGreaterThanOrEqual(3);
    }
  });

  test("the operator's read states the denominator before the finding", () => {
    const lines = formatAgeingReplay(replayAgeingRule(observations, { passes: 3 }), "unmappedEvidence");

    expect(lines[0]).toContain("over 3 past sweep(s)");
    expect(lines[1]).toContain("3 of 4 outstanding item(s)");
    // The threshold the replay is evidence FOR is on the sheet, so nobody has to
    // remember what number they were supposed to be judging against.
    expect(lines.join("\n")).toContain("at most 2 in 10 aged-out items");
  });

  test("a replay over zero sweeps throws — it has not found that nothing would age out", () => {
    expect(() => replayAgeingRule([], { passes: 3 })).toThrow(/0 past sweeps/);
  });
});

describe("reconstructing past sweeps from the vault's own history", () => {
  let dir: string;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-ageing-"));
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  async function commitAll(message: string): Promise<void> {
    const g = simpleGit(dir);
    await g.add(["-A"]);
    await g.commit(message);
  }

  test("even sampling picks across the whole history, oldest first, never just the last few", () => {
    // Newest first, as `git log` gives them.
    const all = Array.from({ length: 100 }, (_, i) => ({ sha: `s${i}`, at: `t${i}` }));

    const picked = sampleCommits(all, 5);

    expect(picked.map((p) => p.sha)).toEqual(["s99", "s74", "s50", "s25", "s0"]);
    expect(sampleCommits(all.slice(0, 3), 5).map((p) => p.sha)).toEqual(["s2", "s1", "s0"]);
  });

  /**
   * The end-to-end claim: three passes of real history, a solution left
   * untouched throughout and one that gained its assumption test in the middle,
   * and the rule reads both correctly off commits alone. The vault is never
   * checked out — the replay clones it — which is what makes this safe to point
   * at a tree an unattended pass is committing to.
   */
  test("a solution left alone across every reconstructed pass ages out; one that got its test does not", async () => {
    const vault = new Vault(dir);
    const opp = "Sessions rediscover the same refusal";
    vault.createNode({ title: opp, layer: "Opportunity", evidence: "observed", source: "INBOX:n.md", body: "b", tags: [], links: [] });
    vault.linkNodes("Retention", opp);
    for (const title of ["A correction that outlives its session", "A refusal ledger nobody reads"]) {
      vault.createNode({ title, layer: "Solution", evidence: "assertion", body: "b", tags: [], links: [] });
      vault.linkNodes(opp, title);
    }
    await commitAll("pass 1: two bare solutions");

    // A pass that does nothing to either — the tree moves, the queue does not.
    vault.createNode({ title: "An unrelated need", layer: "Opportunity", evidence: "observed", source: "INBOX:m.md", body: "b", tags: [], links: [] });
    vault.linkNodes("Retention", "An unrelated need");
    await commitAll("pass 2: nothing done to either solution");

    // A pass that answers one of them.
    vault.createNode({ title: "Replay five sessions for repeat refusals", layer: "AssumptionTest", evidence: "assertion", body: "b", tags: [], links: [] });
    vault.linkNodes("A correction that outlives its session", "Replay five sessions for repeat refusals");
    await commitAll("pass 3: one solution gets an assumption test");

    // Four commits — the vault's own `init`, then the three passes above.
    const past = await replayPastSweeps(dir, { queue: "solutionsMissingAssumptions", sweeps: 4, minSolutions: 3 });

    // No firing ledger in a freshly initialised vault, so the basis is sampled
    // commits — and the replay says so rather than presenting it as recorded.
    expect(past.basis).toBe("commit-sample");
    expect(past.observations).toHaveLength(4);

    const replay = replayAgeingRule(past.observations, { passes: 3 });
    expect(replay.backlog.items.map((i) => i.key)).toEqual(["A refusal ledger nobody reads"]);
    expect(replay.active).toEqual([]);
    // Non-vacuity, three ways. The queue was empty before either solution
    // existed; the answered solution was on it for two passes and left on the
    // third; and the streak that buried the other one is three, not four — a
    // replay that read only the newest commit, or that counted the empty
    // pre-history pass, would get a different number here.
    expect(past.observations[0].items).toEqual([]);
    expect(past.observations[1].items.map((i) => i.key).sort()).toEqual([
      "A correction that outlives its session",
      "A refusal ledger nobody reads",
    ]);
    expect(past.observations[3].items.map((i) => i.key)).toEqual(["A refusal ledger nobody reads"]);
    expect(replay.backlog.items[0].passesUntouched).toBe(3);
  });

  test("the replay never touches the vault it reads — HEAD and the working tree are where they were", async () => {
    const g = simpleGit(dir);
    const headBefore = (await g.revparse(["HEAD"])).trim();
    const statusBefore = await g.status();

    await replayPastSweeps(dir, { queue: "unmappedEvidence", sweeps: 2, minSolutions: 3 });

    expect((await g.revparse(["HEAD"])).trim()).toBe(headBefore);
    expect((await g.status()).files).toEqual(statusBefore.files);
    expect(fs.existsSync(path.join(dir, ".git", "worktrees"))).toBe(false);
  });
});
