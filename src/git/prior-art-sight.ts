/**
 * What a repository can show a prior-art scan about recent work.
 *
 * The read half of `src/loop/prior-art-scan.ts`, and it lives here rather than
 * beside the scoring for a reason the release gates enforce.
 * `test/release/gate-f-deciders.test.ts` requires every module under
 * `src/loop/` to be classified as a reader, a trace reader, a pure module, a
 * reporter or an off-gate decider, and a module that spawns git fits none of
 * them honestly: its input is neither the usage trace nor a ledger under
 * `.git/ost-agent/` that the unattended surface cannot reach. It is the target
 * repository's own history, which the agent writes to by building. Filing it as
 * "pure" would have been true of the regex that check uses — `simple-git`
 * spawns asynchronously and `FS_READ` looks for `fs.*Sync`, `spawnSync` and
 * `execFileSync` — and false of the code. So the git stays out of `src/loop`
 * and the scan stays a pure function over entries a caller supplies.
 *
 * Read-only git through `simple-git` directly, the same door `src/ost/census.ts`
 * and `src/product/capability.ts` already use for reads. `src/git/safe-git.ts`
 * remains the only surface that writes or reaches a network; nothing here does
 * either.
 */
import { simpleGit } from "simple-git";
import type { PriorArtEntry } from "../loop/prior-art-scan.js";

/** What {@link gitPriorArtEntries} should read out of the repository. */
export interface GitSightOptions {
  /** Read commit subjects from history. Default true. */
  commits?: boolean;
  /**
   * Read refs as entries too, so work in flight on a branch counts as taken.
   * Default true. Pass a ref glob to narrow it.
   */
  refs?: boolean | string;
  /** Cap on commits read, so a scan of a large repo stays a scan. */
  maxCommits?: number;
}

/**
 * Read what a repository can show about recent work, as scan entries.
 *
 * Read-only git, through `simple-git` directly — the same door `src/ost/census.ts`
 * and `src/product/capability.ts` already use for reads. `src/git/safe-git.ts`
 * stays the only surface that *writes* or reaches a network, and nothing here
 * does either.
 *
 * Commit time is the **committer** date (`%cI`), not the author date: what
 * matters to a scan is when the work became visible in this repository, and a
 * rebased or cherry-picked commit can carry an author date from long before it
 * was reachable here.
 *
 * The log is `--all`, and that is not a detail. A bare `git log` walks the
 * checked-out branch only, so a fetched commit sitting on `origin/main` — the
 * exact shape the recorded collision arrived in — is invisible to it. A scan
 * that reads one branch reproduces in its reader the same narrowness that let
 * the original detector fire eight hours late, and the spec caught this reader
 * doing it before the shape was fixed.
 */
export async function gitPriorArtEntries(dir: string, opts: GitSightOptions = {}): Promise<PriorArtEntry[]> {
  const git = simpleGit(dir);
  const entries: PriorArtEntry[] = [];

  if (opts.commits !== false) {
    const max = opts.maxCommits ?? 500;
    const log = await git.raw(["log", "--all", `--max-count=${max}`, "--format=%H%x09%cI%x09%s"]);
    for (const line of log.split("\n")) {
      const [sha, at, ...rest] = line.split("\t");
      if (!sha || !at || rest.length === 0) continue;
      const atMs = Date.parse(at);
      if (!Number.isFinite(atMs)) continue;
      entries.push({ kind: "commit", ref: sha.slice(0, 12), naming: rest.join("\t"), atMs });
    }
  }

  if (opts.refs !== false) {
    const glob = typeof opts.refs === "string" ? opts.refs : "refs/heads refs/remotes";
    const refs = await git.raw([
      "for-each-ref",
      "--format=%(refname:short)%09%(committerdate:iso-strict)",
      ...glob.split(/\s+/),
    ]);
    for (const line of refs.split("\n")) {
      const [name, at] = line.split("\t");
      if (!name || !at) continue;
      const atMs = Date.parse(at);
      if (!Number.isFinite(atMs)) continue;
      // A ref's own name is what it says the work is; `feature/arm-split` reads
      // as `feature arm split` once `termsOf` has split it.
      entries.push({ kind: "branch", ref: name, naming: name, atMs });
    }
  }

  return entries;
}
