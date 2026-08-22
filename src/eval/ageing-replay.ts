/**
 * Reconstructing past sweeps from git, so an ageing rule can be tried against
 * history instead of argued about.
 *
 * **Why this has to reconstruct rather than read.** Nothing in this product has
 * ever recorded what a `next_work` sweep listed. `.ost-agent/census-history/`
 * keeps the last ten *census* firings — how many files the walk examined, what
 * it dropped — and `ost/sweep.ts` keeps offered/read pairs, but neither holds
 * the queue's contents, so there is no ledger of "what was outstanding on
 * 2026-08-04" to read. What there is, is a vault where every mutation
 * auto-commits: the tree at any past commit is fully determined, so the sweep at
 * that commit is recomputable by the same function that would have run it.
 * `test/ost/queue-delta-from-git.test.ts` established that this works; this is
 * the first thing in `src/` to depend on it.
 *
 * **The vault is never touched.** Not "not written to" as a matter of care — the
 * replay works on a `git clone --local` into a scratch directory and checks
 * commits out THERE, so no checkout, index, HEAD or worktree record of the real
 * vault is involved at all, and the operator can run this against a tree an
 * unattended pass is committing to.
 *
 * **What counts as a past pass.** Best answer first: commits that touched
 * `.ost-agent/census-history/firings.jsonl` are commits on which a `check` or
 * `status` actually fired, which is as close to a recorded pass boundary as this
 * vault has. When a vault has no such commits, the replay falls back to sampling
 * the commit history evenly — and SAYS which basis it used
 * ({@link PastSweeps.basis}), because a sample of commits is a weaker thing than
 * a record of firings and a reader who cannot tell them apart is reading a
 * number that means two things.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { computeNextWork, type NextWork } from "../mcp/next-work.js";
import { Vault } from "../ost/vault.js";
import type { SweepItem, SweepObservation } from "../ost/ageing.js";

/** The path whose commits mark a firing — relative to the vault root. */
const FIRING_LEDGER = ".ost-agent/census-history/firings.jsonl";

/** Which `next_work` queue a replay is taken over. */
export type ReplayableQueue =
  | "unmappedEvidence"
  | "underservedOpportunities"
  | "solutionsMissingAssumptions"
  | "solutionsMissingInstruments";

export const REPLAYABLE_QUEUES: readonly ReplayableQueue[] = [
  "unmappedEvidence",
  "underservedOpportunities",
  "solutionsMissingAssumptions",
  "solutionsMissingInstruments",
];

/**
 * How each queue's rows become ageing items — and, where it matters, what
 * "somebody worked on this" looks like without the item leaving the list.
 *
 * Three of the four have no signature, and that is a claim rather than an
 * omission: an evidence record is mapped or it is not, a solution has an
 * assumption test or it does not, a test names an instrument or it does not.
 * There is no half state for a pass to be caught in the middle of, so presence
 * IS neglect. `underservedOpportunities` is the exception and the reason
 * signatures exist at all: an opportunity needing three solutions and holding
 * two is on the queue and is emphatically not being neglected, so its solution
 * count rides along and any change to it restarts the streak.
 */
const QUEUE_ITEMS: Record<ReplayableQueue, (work: NextWork) => SweepItem[]> = {
  unmappedEvidence: (w) => w.unmappedEvidence.map((e) => ({ key: e.id })),
  underservedOpportunities: (w) =>
    w.underservedOpportunities.map((o) => ({ key: o.title, signature: `${o.solutions}/${o.needed}` })),
  solutionsMissingAssumptions: (w) => w.solutionsMissingAssumptions.map((s) => ({ key: s.title })),
  solutionsMissingInstruments: (w) => w.solutionsMissingInstruments.map((title) => ({ key: title })),
};

/** One commit the replay treats as a past pass. */
export interface PastPass {
  readonly sha: string;
  /** Commit date, ISO — the sweep's `at`. */
  readonly at: string;
}

/** How the replay decided which commits were passes. */
export type PassBasis = "firing-ledger" | "commit-sample";

export interface PastSweeps {
  readonly basis: PassBasis;
  /** How many commits the vault holds in total — the denominator the sample was drawn from. */
  readonly commits: number;
  readonly observations: readonly SweepObservation[];
}

export interface ReplayOptions {
  readonly queue: ReplayableQueue;
  /** How many past passes to reconstruct. The most recent ones. */
  readonly sweeps: number;
  /** `minSolutionsPerOpportunity`, held fixed across the window — it is a knob, not history. */
  readonly minSolutions: number;
  /** Where to clone to. A fresh temp directory by default, removed afterwards. */
  readonly scratchDir?: string;
}

/**
 * Every commit in the vault, newest first, as `sha` + ISO commit date.
 *
 * `%cI` rather than `%aI`: the replay is asking when the tree looked like this,
 * which is when it was committed.
 */
async function commitLog(git: SimpleGit, pathspec?: string): Promise<PastPass[]> {
  const args = ["log", "--format=%H %cI"];
  if (pathspec) args.push("--", pathspec);
  let raw: string;
  try {
    raw = await git.raw(args);
  } catch {
    // A pathspec that has never existed is not an error here — it is the
    // fallback's trigger, and it is the caller who decides what to do about it.
    return [];
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, at] = line.split(" ");
      return { sha, at };
    });
}

/**
 * Pick `wanted` commits from `all` (newest first), evenly spaced, returned
 * oldest first.
 *
 * Even spacing rather than "the last N commits" because a vault auto-commits
 * every mutation: the last 10 commits of this tree are ten minutes of one pass,
 * and an ageing rule replayed over ten minutes reports that nothing has been
 * neglected. The sample is over the whole history for the same reason a census
 * is taken over the whole directory.
 */
export function sampleCommits(all: readonly PastPass[], wanted: number): PastPass[] {
  if (wanted <= 0 || all.length === 0) return [];
  if (all.length <= wanted) return [...all].reverse();
  const step = (all.length - 1) / (wanted - 1 || 1);
  const picked: PastPass[] = [];
  for (let i = 0; i < wanted; i++) picked.push(all[Math.round(i * step)]);
  return picked.reverse();
}

/**
 * Reconstruct the last `sweeps` passes of one queue from the vault's history.
 *
 * Throws rather than returning an empty replay when the vault has no history:
 * "nothing would have aged out" computed over zero sweeps is the false-clean
 * this codebase has shipped before, and the caller cannot tell the two apart
 * from a result object.
 */
export async function replayPastSweeps(vaultDir: string, opts: ReplayOptions): Promise<PastSweeps> {
  const source = path.resolve(vaultDir);
  const scratch = opts.scratchDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "ost-ageing-replay-"));
  const ownsScratch = opts.scratchDir === undefined;
  // `--local` is a hardlinked clone: cheap even on a vault with thousands of
  // commits, and `--no-checkout` because the first thing done with it is a
  // detached checkout of some other commit anyway.
  await simpleGit().clone(source, scratch, ["--local", "--no-checkout"]);
  const git = simpleGit(scratch);

  try {
    const all = await commitLog(git);
    if (all.length === 0) {
      throw new Error(`${source} has no commit history, so there are no past sweeps to replay`);
    }
    const firings = await commitLog(git, FIRING_LEDGER);
    const basis: PassBasis = firings.length >= 2 ? "firing-ledger" : "commit-sample";
    const passes = basis === "firing-ledger" ? sampleCommits(firings, opts.sweeps) : sampleCommits(all, opts.sweeps);

    const observations: SweepObservation[] = [];
    for (const pass of passes) {
      await git.raw(["checkout", "--detach", "--force", pass.sha]);
      const work = computeNextWork(
        new Vault(scratch),
        scratch,
        opts.minSolutions,
        () => new Date(pass.at),
        undefined,
        undefined,
        // The whole list, never a page of it. See `listLimit` on computeNextWork.
        Number.POSITIVE_INFINITY,
      );
      // Belt as well as braces: if a cap ever hides part of this queue again,
      // the streaks are wrong and the replay must say so rather than count.
      const hidden = work.truncated.find((t) => t.list === opts.queue);
      if (hidden) {
        throw new Error(
          `the ${opts.queue} queue was truncated at ${pass.sha} (${hidden.shown} of ${hidden.total}) — ` +
            `an ageing streak taken over a capped list counts a hidden item as one somebody dealt with`,
        );
      }
      observations.push({ at: pass.at, ref: pass.sha, items: QUEUE_ITEMS[opts.queue](work) });
    }

    return { basis, commits: all.length, observations };
  } finally {
    if (ownsScratch) fs.rmSync(scratch, { recursive: true, force: true });
  }
}
