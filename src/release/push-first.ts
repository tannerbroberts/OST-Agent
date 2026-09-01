/**
 * Refuse to release from history that has not been pushed.
 *
 * **The failure this exists to end.** On 2026-07-26 a builder session finished
 * work locally — two commits ahead of `origin`, unpushed — while the autonomous
 * loop cut v0.18.0 from its own view of the world. Both trains reached for the
 * same next number and a human caught it on a rebase. Deriving the number from
 * the registry ({@link ./next-version.ts}) fixes the number; this goes after
 * the condition underneath it, which is two trains holding different histories
 * with neither able to see the other. The rule: the release path refuses unless
 * the tree it is about to release from is exactly `origin/main`. Push first, or
 * do not release.
 *
 * **Why the freshness of the comparison is an input and not a detail.** The
 * obvious implementation is `git rev-list --left-right --count
 * origin/main...HEAD` and a refusal, which is what the candidate costed. But
 * `origin/main` is a *local ref*: it says what this clone last heard, not what
 * the remote holds. Replaying this repository's own 25 releases through the
 * rule (`test/release/push-first-blocked-census.test.ts`) puts a number on the
 * difference — 15 of 24 releases refused when the rule reads a stale ref, 3
 * when it only counts divergence the history can prove. Same rule, same
 * history, a 5× swing in how often it bites. So a comparison arrives here
 * carrying whether it was fetched, and an unfetched one cannot produce an
 * allow.
 *
 * **Fail closed on a comparison that did not happen.** A `git rev-list` that
 * exits non-zero — no remote-tracking ref, no network, a repository with no
 * `origin` — reads as `unknown`, never as in-sync. The reading being replaced
 * is {@link ./ship-repo.ts}'s, which caught the failure and left `ahead` at 0;
 * a caller then reported "there is nothing to merge" about a comparison that
 * never ran.
 *
 * **Not yet on a live release path, and that is deliberate.** This repository
 * has no release *command* — RELEASING.md is a sequence a person runs, and
 * `package.json` is `private` with no publish step. Registering a subcommand
 * nobody runs would make this module import-reachable while leaving the rule
 * unexercised, which is the carve-out `test/release/module-reachability.test.ts`
 * warns about. What it does reach is the branch-state read in
 * {@link ./ship-repo.ts}, which every firing of the build loop runs.
 */

/** Where a tree stands relative to the branch it would release from. */
export type ReleaseSyncState =
  /** Same commit. The only state a release may proceed from. */
  | "in-sync"
  /** Local commits the remote does not have — the 2026-07-26 condition. */
  | "ahead"
  /** Remote commits this tree does not have. */
  | "behind"
  /** Both at once. */
  | "diverged"
  /** The comparison did not complete. Not a synonym for "in-sync". */
  | "unknown";

/** The two counts `git rev-list --left-right --count <remote>...HEAD` reports. */
export interface Divergence {
  /** Commits on the remote ref that this tree does not have. */
  readonly behind: number;
  /** Commits on this tree that the remote ref does not have. */
  readonly ahead: number;
}

/**
 * Parse `git rev-list --left-right --count origin/main...HEAD`.
 *
 * Left is the remote side (behind), right is HEAD (ahead) — the order is a
 * property of the `A...B` argument, and getting it backwards would make the
 * rule refuse the right releases for the wrong stated reason. Anything that is
 * not two non-negative integers parses to `null` rather than to zeros, so a
 * caller cannot mistake unreadable output for agreement.
 */
export function parseDivergence(raw: string): Divergence | null {
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const [behind, ahead] = parts.map(Number);
  if (!Number.isInteger(behind) || !Number.isInteger(ahead)) return null;
  if (behind! < 0 || ahead! < 0) return null;
  return { behind: behind!, ahead: ahead! };
}

/** Which of the five states a pair of counts describes. `null` counts are `unknown`. */
export function classifySync(counts: Divergence | null): ReleaseSyncState {
  if (!counts) return "unknown";
  if (counts.ahead > 0 && counts.behind > 0) return "diverged";
  if (counts.ahead > 0) return "ahead";
  if (counts.behind > 0) return "behind";
  return "in-sync";
}

/**
 * Whether the counts were read against a ref this process had just refreshed,
 * or against whatever the clone happened to be holding.
 *
 * `stale` is not a warning label — it changes the verdict. See the module note.
 */
export type ComparisonFreshness = "fetched" | "stale";

export interface PushFirstInput {
  /** What the divergence read said, or `null` if it did not complete. */
  readonly counts: Divergence | null;
  readonly freshness: ComparisonFreshness;
  /** The ref released against, for the refusal text. Defaults to `origin/main`. */
  readonly remote?: string;
}

export type PushFirstVerdict =
  | { readonly allowed: true; readonly state: "in-sync" }
  | { readonly allowed: false; readonly state: Exclude<ReleaseSyncState, "in-sync">; readonly reason: string };

/**
 * The precondition itself: may a release be cut from this tree?
 *
 * Checked before anything is built or numbered, so what it judges is the tree
 * the release would be cut FROM — not the release commit, which is by
 * construction ahead of everything the moment it is written.
 */
export function checkPushFirst(input: PushFirstInput): PushFirstVerdict {
  const remote = input.remote ?? "origin/main";
  const state = classifySync(input.counts);

  if (input.freshness === "stale") {
    // Refusing here rather than passing the stale answer through: a `stale`
    // in-sync is the clone saying "nothing has reached me", which is exactly
    // what the second train also believed on 2026-07-26.
    return {
      allowed: false,
      state: state === "in-sync" ? "unknown" : state,
      reason:
        `refusing to release: the comparison against ${remote} was made against a ref this clone had not refreshed, ` +
        `so it reports what this machine last heard rather than what ${remote} holds. Fetch, then ask again.`,
    };
  }

  switch (state) {
    case "in-sync":
      return { allowed: true, state };
    case "ahead":
      return {
        allowed: false,
        state,
        reason:
          `refusing to release: ${input.counts!.ahead} commit(s) here are not on ${remote}, so this release would ` +
          `carry history no other train can see. Push first.`,
      };
    case "behind":
      return {
        allowed: false,
        state,
        reason:
          `refusing to release: ${remote} has ${input.counts!.behind} commit(s) this tree does not, so this release ` +
          `would omit work already shared. Pull first.`,
      };
    case "diverged":
      return {
        allowed: false,
        state,
        reason:
          `refusing to release: this tree and ${remote} have diverged (${input.counts!.ahead} here, ` +
          `${input.counts!.behind} there). Reconcile them before numbering anything.`,
      };
    case "unknown":
      return {
        allowed: false,
        state,
        reason:
          `refusing to release: could not compare this tree against ${remote}. That is not the same as having ` +
          `nothing to release — the check that would have said did not run.`,
      };
  }
}

/**
 * One past release, reconstructed far enough to be replayed through the rule.
 *
 * `pushedLater` is the load-bearing field and the reason this type is not just
 * {@link Divergence}. Git records no push times, so "was this tree ahead of
 * `origin/main` at that instant" is only *provable* for commits that a later
 * `update by push` entry in the clone's `origin/main` reflog shows this machine
 * putting there. Commits that first arrive by fetch may have been on the remote
 * already; those are indeterminate rather than refused, and the census reports
 * them as their own bucket instead of rounding them into either answer.
 */
export interface ReleaseReplay {
  readonly version: string;
  /** Who committed the release — the two trains, told apart. */
  readonly train: "human" | "machine";
  /** Ahead-count against the `origin/main` this clone held at that instant. */
  readonly staleAhead: number;
  /** Of those, how many this clone provably pushed AFTER the release. */
  readonly pushedLater: number;
  /** Behind-count against that same ref. A stale ref understates this, never overstates it. */
  readonly behind: number;
}

/** What the replay of one release settles, and what it cannot. */
export type ReplayVerdict =
  /** Divergence the history proves. The rule refuses however it is implemented. */
  | "refused"
  /** Nothing diverged even on the stale ref, so nothing to refuse. */
  | "allowed"
  /** Diverged against the stale ref only; whether the remote already had it is unrecorded. */
  | "indeterminate";

export function replayVerdict(r: ReleaseReplay): ReplayVerdict {
  if (r.pushedLater > 0 || r.behind > 0) return "refused";
  if (r.staleAhead > 0) return "indeterminate";
  return "allowed";
}

export interface PushFirstCensus {
  readonly total: number;
  readonly refused: number;
  readonly allowed: number;
  readonly indeterminate: number;
  /** Refusals as a share of all replayed releases, using only provable divergence. */
  readonly refusalRate: number;
  /**
   * What the same rule refuses when it reads the clone's `origin/main` without
   * fetching first — the upper bound, and the number the naive implementation
   * would actually have produced.
   */
  readonly staleRefusals: number;
  readonly staleRefusalRate: number;
  /** Refusals split by which train cut the release. The viability question. */
  readonly refusedByTrain: { readonly human: number; readonly machine: number };
  readonly releasesByTrain: { readonly human: number; readonly machine: number };
}

/**
 * Count what a push-first rule would have blocked.
 *
 * Reports frequency alongside the refusal set on purpose: the assumption test
 * this answers states that a result giving precision without frequency "has not
 * answered the question this test was written for". Precision itself — whether
 * each refused release was genuinely problematic or merely unpushed — is a
 * human's reading and is not computed here or anywhere.
 */
export function censusPushFirst(replays: readonly ReleaseReplay[]): PushFirstCensus {
  const verdicts = replays.map((r) => ({ r, v: replayVerdict(r) }));
  const refusedSet = verdicts.filter((x) => x.v === "refused");
  const stale = replays.filter((r) => r.staleAhead > 0 || r.behind > 0).length;
  const byTrain = (rs: readonly ReleaseReplay[]) => ({
    human: rs.filter((r) => r.train === "human").length,
    machine: rs.filter((r) => r.train === "machine").length,
  });
  const total = replays.length;
  return {
    total,
    refused: refusedSet.length,
    allowed: verdicts.filter((x) => x.v === "allowed").length,
    indeterminate: verdicts.filter((x) => x.v === "indeterminate").length,
    refusalRate: total === 0 ? 0 : refusedSet.length / total,
    staleRefusals: stale,
    staleRefusalRate: total === 0 ? 0 : stale / total,
    refusedByTrain: byTrain(refusedSet.map((x) => x.r)),
    releasesByTrain: byTrain(replays),
  };
}
