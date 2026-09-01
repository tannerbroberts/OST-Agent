/**
 * Count how many past releases a push-first rule would have blocked.
 *
 * The assumption test behind "Refuse to release from history that has not been
 * pushed" asks for a replay: for every release in this project's history,
 * reconstruct whether the releasing tree was ahead of, behind, or diverged from
 * `origin/main` at that moment, and count the refusals. It pre-commits to two
 * numbers — the refusal set and the refusal frequency — and says in as many
 * words that "a result that reports precision without reporting frequency has
 * not answered the question this test was written for".
 *
 * **What this test does NOT do, stated first because the split is the point.**
 * The same node also pre-commits to a threshold no exit code reaches: *of the
 * releases the rule would have refused, at least 50% must be judged genuinely
 * problematic* — a person reading each refused release and deciding whether it
 * was a real problem or merely unpushed. Nothing here judges that, and nothing
 * here should: a green run on the arithmetic read as a validated candidate is
 * exactly the failure the ruleset warns about. What this test does is hand a
 * human the three releases to judge, with the git evidence each one carries, so
 * the judgement is an hour's reading rather than an archaeology project.
 *
 * ## Where the fixture comes from
 *
 * Reconstructed 2026-08-31 from this repository, and frozen rather than
 * recomputed, because the inputs are not all in the repository: the clone's
 * `origin/main` reflog is a local file (`.git/logs/refs/remotes/origin/main`)
 * that no CI checkout has and that expires. Each release is a commit on `main`
 * whose `package.json` version is higher than any before it:
 *
 * ```
 * git log --reverse --format='%H|%cI|%cn|%s' main -- package.json   # + read version at each
 * git rev-parse <release>^                                          # the tree released FROM
 * git rev-list --count <origin-main-then>..<parent>                 # staleAhead
 * git rev-list --count <parent>..<origin-main-then>                 # behind
 * ```
 *
 * `<origin-main-then>` is the value the clone's `origin/main` reflog held at the
 * release's committer timestamp, seeded with the clone itself
 * (`.git/logs/refs/remotes/origin/HEAD`, 2026-07-24T15:12:46Z).
 *
 * **`pushedLater` is why this is a census and not a guess.** Git records no push
 * times, so "was this tree ahead of `origin/main` at that instant" cannot be
 * read off the commit graph. What can be read off the reflog is which commits
 * this clone itself *put* on `origin/main` — `update by push` entries — after the
 * release happened. A commit that this machine pushed at T+101s was provably not
 * on the remote at T. A commit that first arrives by `fetch` may have been there
 * already, pushed from the loop's own checkout; those are counted as
 * indeterminate rather than folded into either answer.
 */
import { describe, expect, test } from "vitest";
import {
  censusPushFirst,
  checkPushFirst,
  classifySync,
  parseDivergence,
  replayVerdict,
  type ReleaseReplay,
} from "../../src/release/push-first.js";

/**
 * Every release this project has ever cut, with the state of the tree it was cut
 * from. v0.1.0 (68fabbb, 2026-07-22T18:25:42Z) is excluded and is the only
 * exclusion: it predates this clone, so no local record says what `origin/main`
 * held. 25 releases exist; 24 are replayable.
 */
const RELEASES: readonly (ReleaseReplay & { commit: string; at: string })[] = [
  { version: "0.1.1", commit: "2ed003f", at: "2026-07-24T16:58:21Z", train: "human", staleAhead: 0, pushedLater: 0, behind: 0 },
  { version: "0.1.2", commit: "f85862e", at: "2026-07-24T18:05:13Z", train: "human", staleAhead: 5, pushedLater: 0, behind: 0 },
  { version: "0.1.3", commit: "9600ea0", at: "2026-07-24T18:12:27Z", train: "human", staleAhead: 6, pushedLater: 0, behind: 0 },
  { version: "0.4.0", commit: "3475ded", at: "2026-07-25T02:09:53Z", train: "human", staleAhead: 7, pushedLater: 7, behind: 0 },
  { version: "0.5.0", commit: "f091b04", at: "2026-07-25T04:51:22Z", train: "machine", staleAhead: 0, pushedLater: 0, behind: 0 },
  { version: "0.6.0", commit: "7f8de06", at: "2026-07-25T05:53:29Z", train: "machine", staleAhead: 2, pushedLater: 0, behind: 0 },
  { version: "0.7.0", commit: "b317508", at: "2026-07-25T11:07:56Z", train: "machine", staleAhead: 3, pushedLater: 0, behind: 0 },
  { version: "0.8.0", commit: "d9ed3ac", at: "2026-07-25T15:53:05Z", train: "machine", staleAhead: 5, pushedLater: 0, behind: 0 },
  { version: "0.9.0", commit: "d9ace23", at: "2026-07-25T21:12:57Z", train: "machine", staleAhead: 6, pushedLater: 0, behind: 0 },
  { version: "0.10.0", commit: "019780f", at: "2026-07-26T00:51:44Z", train: "machine", staleAhead: 0, pushedLater: 0, behind: 0 },
  { version: "0.11.0", commit: "86b6ff4", at: "2026-07-26T02:32:32Z", train: "machine", staleAhead: 1, pushedLater: 0, behind: 0 },
  { version: "0.12.0", commit: "d3efbbd", at: "2026-07-26T05:52:36Z", train: "machine", staleAhead: 2, pushedLater: 0, behind: 0 },
  { version: "0.13.0", commit: "1790775", at: "2026-07-26T10:53:30Z", train: "machine", staleAhead: 3, pushedLater: 0, behind: 0 },
  { version: "0.14.0", commit: "49580d2", at: "2026-07-26T16:09:42Z", train: "machine", staleAhead: 0, pushedLater: 0, behind: 0 },
  { version: "0.15.0", commit: "6a20798", at: "2026-07-26T19:50:48Z", train: "machine", staleAhead: 0, pushedLater: 0, behind: 0 },
  { version: "0.16.0", commit: "d1442c3", at: "2026-07-26T20:58:18Z", train: "machine", staleAhead: 1, pushedLater: 0, behind: 0 },
  { version: "0.17.0", commit: "ac3db05", at: "2026-07-26T21:23:38Z", train: "machine", staleAhead: 2, pushedLater: 0, behind: 0 },
  { version: "0.18.0", commit: "4f0ab1e", at: "2026-07-27T00:55:27Z", train: "machine", staleAhead: 0, pushedLater: 0, behind: 0 },
  { version: "0.19.0", commit: "a10e75f", at: "2026-07-27T02:13:16Z", train: "human", staleAhead: 2, pushedLater: 2, behind: 0 },
  { version: "0.19.1", commit: "2f4ef3e", at: "2026-07-27T02:27:10Z", train: "human", staleAhead: 0, pushedLater: 0, behind: 0 },
  { version: "0.20.0", commit: "54b45ed", at: "2026-07-27T06:06:36Z", train: "machine", staleAhead: 0, pushedLater: 0, behind: 0 },
  { version: "0.21.0", commit: "87164d6", at: "2026-07-27T11:13:27Z", train: "machine", staleAhead: 1, pushedLater: 0, behind: 0 },
  { version: "0.22.0", commit: "df5288a", at: "2026-07-27T15:58:07Z", train: "machine", staleAhead: 0, pushedLater: 0, behind: 0 },
  { version: "0.23.0", commit: "dd673e4", at: "2026-07-28T16:34:17Z", train: "human", staleAhead: 55, pushedLater: 0, behind: 19 },
];

describe("the precondition itself", () => {
  test("the four states a comparison can report, and the fifth for one that did not run", () => {
    expect(classifySync(parseDivergence("0\t0"))).toBe("in-sync");
    expect(classifySync(parseDivergence("0\t2"))).toBe("ahead");
    expect(classifySync(parseDivergence("3\t0"))).toBe("behind");
    expect(classifySync(parseDivergence("19\t55"))).toBe("diverged");
    expect(classifySync(null)).toBe("unknown");

    // Left is the remote side, right is HEAD. Getting this backwards would
    // refuse the right releases while naming the wrong direction.
    expect(parseDivergence("19\t55")).toEqual({ behind: 19, ahead: 55 });
    // Output that is not two non-negative integers is not agreement.
    expect(parseDivergence("")).toBeNull();
    expect(parseDivergence("fatal: ambiguous argument 'origin/main'")).toBeNull();
    expect(parseDivergence("0")).toBeNull();
    expect(parseDivergence("-1\t2")).toBeNull();
  });

  test("only a freshly fetched, in-sync tree may release", () => {
    const fetched = (behind: number, ahead: number) =>
      checkPushFirst({ counts: { behind, ahead }, freshness: "fetched" });

    expect(fetched(0, 0)).toEqual({ allowed: true, state: "in-sync" });
    expect(fetched(0, 2).allowed).toBe(false);
    expect(fetched(3, 0).allowed).toBe(false);
    expect(fetched(19, 55).allowed).toBe(false);

    // A comparison that did not complete refuses, and says so as itself rather
    // than as "there is nothing here".
    const unknown = checkPushFirst({ counts: null, freshness: "fetched" });
    expect(unknown.allowed).toBe(false);
    expect(unknown.allowed === false && unknown.state).toBe("unknown");
    expect(unknown.allowed === false && unknown.reason).toContain("did not run");

    // An unfetched in-sync reading is the clone saying "nothing has reached
    // me", which is what the second train believed on 2026-07-26 too.
    const stale = checkPushFirst({ counts: { behind: 0, ahead: 0 }, freshness: "stale" });
    expect(stale.allowed).toBe(false);
    expect(stale.allowed === false && stale.reason).toContain("had not refreshed");
  });
});

describe("the census: every past release, replayed against the rule", () => {
  const census = censusPushFirst(RELEASES);

  test("the refusal set — the releases a push-first rule would have blocked", () => {
    const refused = RELEASES.filter((r) => replayVerdict(r) === "refused").map((r) => r.version);

    // Three, and each is a distinct kind of thing, which is why the human
    // judgement this test does not make is not a formality:
    //
    //   v0.4.0  — cut from 7c3f4c0, a commit whose own subject is "merge:
    //             reunite the two development lines (0.1.3 releases + local
    //             feature work)". Seven local commits, released without being
    //             pushed. The same two-trains condition as the 2026-07-26
    //             near-collision, two days EARLIER and never filed.
    //   v0.19.0 — the near-collision the candidate was written for. Two commits
    //             ahead; this clone pushed them 101 seconds after the release.
    //   v0.23.0 — cut from 744b9af on the `attention-ledger` branch: 55 ahead
    //             and 19 behind `main`. A deliberate branch release, which is
    //             precisely the legitimate case the candidate admits it forbids.
    expect(refused).toEqual(["0.4.0", "0.19.0", "0.23.0"]);
    expect(census.refused).toBe(3);
  });

  test("the frequency — the number the node says matters as much as the threshold", () => {
    expect(census.total).toBe(24);
    expect(census.allowed).toBe(9);
    expect(census.indeterminate).toBe(12);
    expect(census.refused + census.allowed + census.indeterminate).toBe(census.total);

    // 3 in 24: one release in eight, on divergence the history can prove.
    expect(census.refusalRate).toBeCloseTo(3 / 24, 5);

    // Half the history cannot be settled either way, and the reason is a
    // property of git rather than of this reconstruction: those releases were
    // cut by the loop from a checkout whose pushes this clone only ever learned
    // about by fetching. A census that reported 3/24 without this bucket would
    // be claiming to have measured twice what it measured.
    expect(census.indeterminate / census.total).toBe(0.5);
  });

  test("the same rule refuses 5x more often if it reads origin/main without fetching", () => {
    // This is the implementation the candidate costed — "a `git rev-list
    // --left-right --count` and a refusal" — and the fetch it leaves out is
    // what decides whether the rule costs one release in eight or five in
    // eight. `staleRefusals` counts every release that diverged from whatever
    // this clone happened to be holding.
    expect(census.staleRefusals).toBe(15);
    expect(census.staleRefusalRate).toBeCloseTo(15 / 24, 5);
    expect(census.staleRefusals / census.refused).toBeGreaterThanOrEqual(5);
  });

  test("the motivating case: the rule constrains one train and lets the other through", () => {
    const builder = RELEASES.find((r) => r.version === "0.19.0")!;
    const loop = RELEASES.find((r) => r.version === "0.18.0")!;

    // The assumption test asked for this to be confirmed rather than assumed:
    // "the loop's release came from a different tree that may itself have been
    // in sync, in which case the rule constrains only one of the two trains".
    // It was in sync. At 00:55:27Z the loop's parent ac3db05 WAS `origin/main`.
    expect(replayVerdict(builder)).toBe("refused");
    expect(replayVerdict(loop)).toBe("allowed");

    // So push-first would have caught the collision — by stopping the human,
    // 78 minutes after the loop had already published v0.18.0. The builder
    // would have pushed and renumbered, which is what the rebase did by hand.
    // The rule buys the correction earlier; it does not make the loop wait.
    expect(checkPushFirst({ counts: { behind: builder.behind, ahead: builder.staleAhead }, freshness: "fetched" }).allowed).toBe(false);
    expect(checkPushFirst({ counts: { behind: loop.behind, ahead: loop.staleAhead }, freshness: "fetched" }).allowed).toBe(true);
  });

  test("whose releases it blocks — the viability question, answered as a number", () => {
    // The assumption test's stated worry is that a strict push-first rule
    // "makes the credential holder mandatory for every release" on a project
    // whose constraint is that the operator's hours do not exist.
    //
    // The history says the opposite mechanism and the same direction of cost.
    // Every provable refusal falls on a release the human cut. The loop's
    // seventeen releases clear the rule untouched — it adds no human to any of
    // them, because the loop already releases from a tree it had just pulled.
    expect(census.releasesByTrain).toEqual({ human: 7, machine: 17 });
    expect(census.refusedByTrain).toEqual({ human: 3, machine: 0 });

    // 3 of 7 human-cut releases; 0 of 17 machine-cut.
    expect(census.refusedByTrain.human / census.releasesByTrain.human).toBeCloseTo(3 / 7, 5);
    expect(census.refusedByTrain.machine).toBe(0);
  });

  test("the pre-committed 50% threshold is NOT settled here, and this records that it is not", () => {
    // "Of the releases the rule would have refused, at least 50% must be judged
    // genuinely problematic." Three releases, and the judgement of each turns on
    // whether it was a real problem or merely unpushed — which no exit code
    // reaches. The census hands over the set; a person hands back the verdict.
    const toJudge = RELEASES.filter((r) => replayVerdict(r) === "refused");
    expect(toJudge).toHaveLength(3);

    // What CAN be said mechanically, and is the reason the judgement is close:
    // one of the three (v0.23.0) is a branch release, which the candidate
    // already concedes is legitimate work its rule forbids. So the threshold
    // rests on the other two, and 2/3 versus 1/3 is the whole distance between
    // adopting this candidate and closing it in favour of its registry-checking
    // sibling.
    const branchRelease = toJudge.filter((r) => r.behind > 0);
    expect(branchRelease.map((r) => r.version)).toEqual(["0.23.0"]);
    expect(toJudge.length - branchRelease.length).toBe(2);
  });
});
