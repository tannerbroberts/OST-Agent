/**
 * The inherited-tree build check: does the repository this run was handed
 * actually build, before anything plans work on top of it?
 *
 * **The failure this exists to catch, observed rather than imagined.** A merge
 * was once resolved badly and committed, conflict markers and all, into
 * `src/cli/index.ts`. The next run did not inherit a disagreement to settle —
 * it inherited a repository that does not compile, formed a plan, began work,
 * and only then discovered the ground had a hole in it. The expensive part was
 * not the conflict; it was everything spent before anyone asked whether the
 * foundation was sound.
 *
 * The check is the cheapest useful form: the typecheck, not the suite. The
 * ship gates already order themselves by exactly this logic ("a type error
 * makes every test failure downstream of it noise"), so this module runs that
 * one command and stops. A tree that fails its own typecheck has nothing sound
 * to plan against; a tree that passes it may still fail its suite — accepted,
 * because this is a preflight against arriving on rubble, not a substitute for
 * the ship gates, and every second it costs is paid on every firing.
 *
 * **The typecheck argv is declared here, not read from the ship gate list, and
 * the duplication is deliberate.** `test/runner/suite-result-consumer-census.test.ts`
 * pins the readers of the ship gate's verdict shape to the ship boundary — that
 * closed set is what makes "the gate can be migrated in a single change" a scan
 * rather than a judgement, and this module is not a consumer of a suite verdict:
 * it converts a *typecheck* exit, never `vitest run`. Its own test pins the argv
 * so a drift toward running the suite here is a decision, not an accident.
 *
 * **Fail-closed, in both directions.** A check that could not run — `npx`
 * missing, a spawn that never started — is `unknown`, never `builds`. Folding
 * it into "builds" would let a run plan against a tree nothing can vouch for,
 * which is the same false clean `workingTreeStatus` refuses at the
 * working-tree level (`src/loop/state.ts`).
 *
 * **What "the commit that broke it" means here, stated rather than implied.**
 * The refusal names the commit the run inherited — HEAD — because that is the
 * state the run would have planned on. Finding the commit that *introduced*
 * the breakage is a bisect, and a bisect costs a build per step; a preflight
 * that bisects is a preflight nobody pays for hourly. HEAD plus the gate's own
 * output is enough to act on: revert it, or read the excerpt and fix forward.
 */
import path from "node:path";
import { simpleGit } from "simple-git";
import { tail, type Runner, spawnRunner } from "./ship.js";

/**
 * The one command this check runs. Argv, never a shell string, for the same
 * laundering reason the ship gates give.
 */
export const TYPECHECK = {
  name: "tsc",
  argv: ["npx", "tsc", "--noEmit"] as readonly string[],
} as const;

/** The commit a run inherited — the state the refusal names. */
export interface InheritedCommit {
  readonly sha: string;
  readonly subject: string;
}

/**
 * The three answers, deliberately three rather than a boolean: `unknown` is
 * not `builds` (fail-closed) and not `broken` either — the refusal for each
 * says a different thing, and an operator acts differently on each.
 */
export type BuildCheckVerdict = "builds" | "broken" | "unknown";

/**
 * Exit codes for the CLI surface. Only `builds` is 0; a wrapper that treats
 * any non-zero as "do not plan work" gets the fail-closed behaviour for free.
 */
export const BUILD_CHECK_EXIT = { builds: 0, broken: 1, unknown: 2 } as const;

export interface BuildCheckResult {
  readonly verdict: BuildCheckVerdict;
  /** Wall-clock cost of the check, in seconds — the tax the tree's viability test bounds. */
  readonly seconds: number;
  /** null when the command never started, which is `unknown`, never `builds`. */
  readonly exitCode: number | null;
  /** Tail of the command's output — failures report at the end. */
  readonly excerpt: string;
  /** null when no commit could be read, e.g. the directory is not a repository. */
  readonly head: InheritedCommit | null;
}

/**
 * Read the commit the run inherited. `simple-git`, like the conflict guard —
 * a door that can only ever run git — rather than a `node:child_process`
 * import of this module's own, which would widen the census of places a
 * subprocess verdict can enter (`test/runner/suite-result-consumer-census.test.ts`).
 */
export async function inheritedHead(repo: string): Promise<InheritedCommit | null> {
  const g = simpleGit(path.resolve(repo));
  const raw = await g.raw(["log", "-1", "--format=%H%x1f%s"]).catch(() => null);
  if (raw === null) return null;
  const [sha, subject] = raw.trim().split("\x1f");
  if (!sha) return null;
  return { sha, subject: subject ?? "" };
}

/** Run the check. One command, timed, plus the commit it judged. */
export async function inheritedTreeBuildCheck(repo: string, run: Runner = spawnRunner): Promise<BuildCheckResult> {
  const head = await inheritedHead(repo);
  const started = Date.now();
  const { status, output } = run(TYPECHECK.argv, path.resolve(repo));
  const seconds = (Date.now() - started) / 1000;
  const verdict: BuildCheckVerdict = status === 0 ? "builds" : status === null ? "unknown" : "broken";
  return { verdict, seconds, exitCode: status, excerpt: tail(output), head };
}

/**
 * One report per verdict, composed here so the CLI, the loop's report file and
 * the tests all say the same thing about the same state.
 */
export function formatBuildCheck(repo: string, result: BuildCheckResult): string {
  const cost = `${result.seconds.toFixed(1)}s`;
  const at = result.head
    ? `at ${result.head.sha.slice(0, 7)} "${result.head.subject}"`
    : "at a commit that could not be read (not a git repository, or git is unavailable)";
  if (result.verdict === "builds") {
    return `inherited tree builds: the "${TYPECHECK.name}" check is green in ${cost} ${at}.`;
  }
  if (result.verdict === "unknown") {
    return (
      `inherited tree could not be checked: the "${TYPECHECK.name}" check never ran ${at}.\n` +
      `${result.excerpt}\n` +
      `Fail-closed: a tree nothing can vouch for is refused, never assumed to build.`
    );
  }
  return (
    `inherited tree does not build: the "${TYPECHECK.name}" check exited ${result.exitCode} in ${cost}.\n` +
    `This run inherited ${repo} ${at}.\n` +
    `${result.excerpt}\n` +
    `Planning work on this tree means building on a foundation known to be unsound — fix or revert first.`
  );
}
