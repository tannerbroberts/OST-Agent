/**
 * What a vault's history can show about work that followed a failing step.
 *
 * The git half of `src/telemetry/unknown-context-census.ts`, and it lives here
 * for the reason `src/git/prior-art-sight.ts` states at length: the census is a
 * pure function over records a caller supplies, and a module that spawns git is
 * not that. Keeping the spawn on this side of the line is also what lets the
 * spec drive the census from a fixture instead of from a repository.
 *
 * Read-only git through `simple-git`, the same door `src/ost/census.ts` and
 * `src/product/capability.ts` already use for reads. `src/git/safe-git.ts`
 * remains the only surface that writes or reaches a network; nothing here does
 * either.
 *
 * **The exclusion is the whole design.** `git log -S<payload>` finds every commit
 * that changed the number of occurrences of the failed command's text — which
 * includes the commit that appended the failure to `.ost-agent/health/runs.jsonl`
 * in the first place. Counting that as "somebody acted on it" would let every
 * recorded failure score a follow-up on the strength of having been recorded, and
 * the second clause of the threshold it serves would then be unfailable. So the
 * health record is excluded by path, and {@link EXCLUDED_PATHS} names it rather
 * than hiding it in a call site.
 */
import { simpleGit } from "simple-git";
import type { CitingCommit, FollowUpSight } from "../telemetry/unknown-context-census.js";

/**
 * Paths whose contents never count as a citation.
 *
 * Only the ledger being measured. A commit that touches the health record *and*
 * something else still counts — pathspec exclusion narrows which diffs the
 * pickaxe reads, not which commits may be reported.
 */
export const EXCLUDED_PATHS = [".ost-agent/health"] as const;

/** Unit separator — a commit subject can contain anything a person types. */
const SEP = "\u001f";

/** Read-only `git log -S`, scoped to a window, over everything but the health ledger. */
export function gitFollowUpSight(dir: string, maxCommits = 200): FollowUpSight {
  return {
    async citingCommits(payload: string, sinceISO: string, untilISO: string): Promise<CitingCommit[]> {
      if (payload.trim() === "") return [];
      const git = simpleGit(dir);
      const out = await git
        .raw([
          "log",
          "--all",
          `-n${maxCommits}`,
          `-S${payload}`,
          `--since=${sinceISO}`,
          `--until=${untilISO}`,
          `--format=%H${SEP}%cI${SEP}%s`,
          "--",
          ".",
          ...EXCLUDED_PATHS.map((p) => `:(exclude)${p}`),
        ])
        // A directory that is not a repository, a repository with no commits in
        // the window, a git that is not installed: all of them are "this reader
        // saw nothing", never a thrown census.
        .catch(() => "");
      const commits: CitingCommit[] = [];
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        const [sha, at, ...rest] = line.split(SEP);
        if (!sha || !at) continue;
        commits.push({ sha, at, subject: rest.join(SEP) });
      }
      return commits;
    },
  };
}
