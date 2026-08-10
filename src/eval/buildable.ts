/**
 * The build permit — may a builder start on this solution, and will it know when
 * it is finished?
 *
 * This sits BESIDE `gateSolution` and answers a different question. The gate
 * asks whether a solution is worth building: it clears on a recorded result,
 * which is a person's judgement about the world, and it stays human-only. This
 * asks whether a solution is buildable at all: it clears on an instrument that
 * has been observed failing against the real repository, which is a fact about
 * the code and nobody's judgement.
 *
 * **Neither permit subsumes the other, and running only one is a mistake in a
 * different direction each time.** Build on the gate alone and the builder is
 * handed a paragraph of prose and told to guess when it is done. Build on this
 * alone and a team spends a quarter shipping something no customer asked for,
 * perfectly measured. The build loop takes both — one says the work is worth
 * doing, the other says it is defined — which is why this file adds a permit
 * rather than loosening the one already here.
 *
 * A red observation is a permit and a green one is a completion: once the
 * instrument passes, the solution has been built and the ticket is spent. So a
 * test that has gone green stops being a reason to start work.
 *
 * **A red only counts when it is red about something.** An instrument naming a
 * spec file nobody has written also exits non-zero, and that failure is about the
 * filesystem rather than the solution: it would be identical under any title,
 * any threshold, any question, and an empty spec file would flip it green. Such
 * a run is filed as `no-spec` rather than red ({@link ../ost/instrument.ts}), so
 * it is always visible as what it is. Whether it also loses the permit turns on
 * the threshold, and the tree's own evidence set that bar rather than a rule of
 * thumb: the vault holds one complete weak-red lifecycle ("Declare a required
 * tool set and check a pass refuses before doing any work", red 2026-08-06 with
 * "No test files found", green 2026-08-07) where the builder was carried by the
 * node's pre-committed threshold after finding the path empty. Refusing every
 * weak red would have blocked that. So a weak red keeps its permit when the test
 * names a bound threshold, and loses it only when there is neither a spec nor a
 * fixed bar — the case that genuinely hands a builder nothing. Reds recorded
 * before the distinction existed are re-checked at spend time by
 * {@link confirmPermit}, because the log is append-only and a re-run is the only
 * honest correction.
 *
 * **A recorded observation is a fact about the past, and a permit is a claim
 * about now.** Everything above reads the node and nothing runs the command, so
 * a permit stays cleared for exactly as long as nobody re-observes it — and the
 * loop deliberately never re-observes an instrument it has already seen red
 * ({@link testsAwaitingVerification}). Anything that turns the command green
 * outside the loop therefore leaves a live-looking permit behind: a build merged
 * from a branch, a fix that landed under another PR, a dependency that started
 * satisfying the spec. This is not hypothetical. On 2026-08-06 the build loop
 * spent a full model pass on "A model reads the raw transcript and files what
 * the pattern scan cannot see", whose instrument had been recorded red on
 * 2026-08-05 with "No test files found" and had been green since the merge 17
 * minutes earlier. {@link confirmPermit} is the answer: before a caller spends
 * anything on a permit, run the command and find out whether the red is still
 * true. It records nothing — recording is `ost-agent verify`, and it stays
 * where it is.
 */
import { nodeInstrument, observedGreen, observedRed, runInstrument, type InstrumentRun } from "../ost/instrument.js";
import { CAUTIOUS_LANE } from "../knowledge/lanes.js";
import type { OstNode } from "../ost/node.js";
import { isInstrument, parseInstrument, type ParsedInstrument } from "../knowledge/instruments.js";
import { thresholdKindOf } from "./coverage.js";
import { testsUnderSolution } from "../processes/tree.js";

export interface BuildPermit {
  cleared: boolean;
  reason: string;
  /** The command the builder must turn green, when one is cleared. */
  instrument?: string;
  /** The test carrying it. */
  test?: string;
  /**
   * Set by {@link confirmPermit} when the recorded red no longer holds: the
   * command passes today, so the ticket was spent before this caller reached it.
   * `test` and `instrument` are still populated, because the useful next move is
   * to go and record the green on that test.
   */
  spent?: boolean;
  /**
   * Does the chosen test carry a pre-committed bar, rather than prose or an
   * instruction to pick one later?
   *
   * Read by {@link confirmPermit} when the instrument turns out to name a spec
   * nobody wrote. Carried on the permit because `permitFrom` has the node and
   * `confirmPermit` has only strings, and threading the tree through the second
   * one would put a whole index on a path that exists to run a single command.
   */
  thresholdBound?: boolean;
}

/**
 * Title → node, built once per sweep.
 *
 * The obvious spelling of `testsUnder` is a filter over the whole tree, which is
 * O(solutions × nodes) and was measurably too slow: it put `ost_next_work` at
 * 3151ms on the 10,000-node vault against a 2000ms budget
 * (`test/mcp/wall-clock-budget.test.ts`). A solution names its children, so the
 * children can be looked up instead of searched for.
 */
function indexByTitle(tree: readonly OstNode[]): Map<string, OstNode> {
  const index = new Map<string, OstNode>();
  for (const n of tree) index.set(n.title, n);
  return index;
}

function testsUnder(index: Map<string, OstNode>, solution: OstNode): OstNode[] {
  return testsUnderSolution(solution, index);
}

/**
 * May work start on this solution, and against what definition of done?
 *
 * Refusals name the missing step rather than the missing state, because every
 * one of them is something a person or a pass can go and do.
 */
export function buildPermit(tree: readonly OstNode[], title: string): BuildPermit {
  return permitFrom(indexByTitle(tree), title);
}

/** The permit, against an index the caller already built. */
function permitFrom(index: Map<string, OstNode>, title: string): BuildPermit {
  const solution = index.get(title);
  if (!solution || solution.layer !== "Solution") {
    return { cleared: false, reason: `no Solution node titled "${title}"` };
  }

  const tests = testsUnder(index, solution);
  if (tests.length === 0) {
    return {
      cleared: false,
      reason: `"${title}" has no assumption test beneath it — there is nothing that could tell a builder what to build`,
    };
  }

  const withInstruments = tests.filter((t) => nodeInstrument(t));
  if (withInstruments.length === 0) {
    return {
      cleared: false,
      reason:
        `none of the ${tests.length} test(s) under "${title}" declares a runnable instrument, so none of them ` +
        `can go red or green. Add an \`instrument:\` naming one spec file to: ${tests.map((t) => t.title).join("; ")}`,
    };
  }

  const live = withInstruments.filter((t) => observedRed(t) && !observedGreen(t));
  if (live.length === 0) {
    const built = withInstruments.filter((t) => observedGreen(t));
    if (built.length > 0 && built.length === withInstruments.length) {
      return {
        cleared: false,
        reason: `every instrument under "${title}" is already green — this solution has been built`,
      };
    }
    return {
      cleared: false,
      reason:
        `"${title}" declares an instrument that has never been run, so nobody knows whether it fails today. ` +
        `Run \`ost-agent verify\` on: ${withInstruments.map((t) => t.title).join("; ")}`,
    };
  }

  const chosen = live[0];
  const instrument = nodeInstrument(chosen)!;
  return {
    cleared: true,
    reason:
      `"${chosen.title}" is red against the repository — \`${instrument.command}\` fails today and passes when ` +
      `"${title}" is built. That is the definition of done.`,
    instrument: instrument.command,
    test: chosen.title,
    thresholdBound: thresholdKindOf(chosen) === "bound",
  };
}

/**
 * Is the recorded red still true? Run the command and find out.
 *
 * This is the step between "the tree says this is buildable" and spending a
 * model pass on it. It is deliberately NOT folded into {@link buildPermit}: that
 * function is pure, is called once per solution by {@link buildableSolutions},
 * and is on the hot path of `ost_next_work` under a wall-clock budget — running
 * a spec suite per solution there would be minutes of test runner to answer a
 * question about one solution. So the confirmation is opt-in and belongs to the
 * caller about to spend something.
 *
 * **It records nothing.** Filing an observation is `ost-agent verify`, which is
 * CLI-only and refuses a first-run green, and this must not become a second door
 * into the instrument log. What it returns instead is a refusal that names the
 * test, so the caller can go and file the green through the door that exists.
 *
 * Fail-open on a permit that was never cleared (nothing to confirm) and on a
 * command that will not parse (there is nothing to run, and `buildPermit` has
 * already refused those). Fail-CLOSED on green: a permit whose instrument passes
 * is spent, whoever spent it.
 */
export function confirmPermit(
  permit: BuildPermit,
  repoDir: string,
  run: (instrument: ParsedInstrument, dir: string) => InstrumentRun = runInstrument,
): BuildPermit {
  if (!permit.cleared || !permit.instrument) return permit;
  const parsed = parseInstrument(permit.instrument);
  if (!isInstrument(parsed)) return permit;

  const observed = run(parsed, repoDir);
  if (observed.observation === "red") return permit;

  // Fail-closed on a vacuous red, and this is the direction that matters most on
  // a tree with history. A permit minted before `no-spec` existed reads `**red**`
  // in an append-only log that must not be rewritten, so the recorded line cannot
  // be corrected — but the command can be re-run, and re-running it now says
  // plainly that nothing was ever measured. Catching it here rather than in
  // `buildPermit` keeps the hot path pure and puts the check exactly where
  // something is about to be spent.
  if (observed.observation === "no-spec") {
    // A weak red is not inert, and the tree has an observed case saying so. On
    // 2026-08-06 "Declare a required tool set and check a pass refuses before
    // doing any work" was recorded red with "No test files found", and went green
    // on 2026-08-07 — a builder read the path, found nothing there, and built to
    // the node's pre-committed threshold instead. The threshold did the work the
    // missing spec could not.
    //
    // So the bar is the threshold, not the file. A test that names a bound one
    // still hands a builder a definition of done and keeps its permit; a test
    // with neither a spec nor a fixed bar hands over nothing at all, and that is
    // the case being refused. Refusing both would have blocked the one lifecycle
    // this vault has actually watched succeed.
    if (permit.thresholdBound) return permit;
    return {
      cleared: false,
      test: permit.test,
      instrument: permit.instrument,
      reason:
        `"${permit.test}" is recorded red, but \`${permit.instrument}\` collects no spec against this repository ` +
        `(${observed.excerpt}) — so the red says a file is missing, not that any behaviour is. Every question ` +
        `written on that filename would be equally red, and an empty spec would turn it green. Nothing else here ` +
        `carries a definition of done either: this test's threshold is not a fixed bar, so there is no number to ` +
        `build to. Fix one of the two — write the failing spec, or pre-commit the bar — and the permit stands.`,
    };
  }

  return {
    cleared: false,
    spent: true,
    test: permit.test,
    instrument: permit.instrument,
    reason:
      `"${permit.test}" was observed red, but \`${permit.instrument}\` passes against this repository today ` +
      `(exit ${observed.exitCode ?? "none"}) — the solution has been built since that observation was filed, and ` +
      `the permit is spent. Nothing has been recorded here: \`ost-agent verify "${permit.test}"\` files the green.`,
  };
}

/** Every solution a builder could start on right now, in tree order. */
export function buildableSolutions(tree: readonly OstNode[]): { solution: string; test: string; instrument: string }[] {
  const index = indexByTitle(tree);
  const out: { solution: string; test: string; instrument: string }[] = [];
  for (const n of tree) {
    if (n.layer !== "Solution") continue;
    const permit = permitFrom(index, n.title);
    if (permit.cleared && permit.test && permit.instrument) {
      out.push({ solution: n.title, test: permit.test, instrument: permit.instrument });
    }
  }
  return out;
}

/**
 * Tests that declare an instrument nobody has run yet — the build loop's own work.
 *
 * This is the step between discovery writing a test and the builder being able to
 * act on it, and it belongs to neither of them by judgement: running the command
 * and reading its exit code is mechanical. Listing them here rather than letting
 * the loop's shell re-derive the rule keeps one definition of "needs verifying"
 * in the codebase instead of two that can drift.
 *
 * A test that has already been observed — red or green — is not here. Re-running
 * a red instrument every hour would burn the suite for an answer the tree already
 * has; the green→red direction (a build regressing) is a different question and
 * deliberately not this one.
 */
export function testsAwaitingVerification(tree: readonly OstNode[]): string[] {
  const out: string[] = [];
  for (const n of tree) {
    if (n.layer !== "AssumptionTest") continue;
    // A test a human put beyond compute's reach is never run by compute, even if
    // it somehow carries a command. `ost_set_instrument` refuses to create that
    // combination, so this is the second lock on the same door — and the one that
    // matters for nodes that already carry both, or that a human edited by hand.
    // The lane is the authority on who may run a test; an instrument only ever
    // says what running it would mean.
    if (n.lane === CAUTIOUS_LANE) continue;
    if (!nodeInstrument(n)) continue;
    if (observedRed(n) || observedGreen(n)) continue;
    out.push(n.title);
  }
  return out;
}

/**
 * Solutions whose tests exist but cannot be run — the discovery loop's new work.
 *
 * This is the bucket that turns "think harder about tests" into something with a
 * count. A solution here has been ideated and has had its assumptions surfaced,
 * and still cannot reach a builder, because everything written about it is
 * prose.
 */
export function solutionsMissingInstruments(tree: readonly OstNode[]): string[] {
  const index = indexByTitle(tree);
  const out: string[] = [];
  for (const n of tree) {
    if (n.layer !== "Solution") continue;
    const tests = testsUnder(index, n);
    if (tests.length === 0) continue; // already counted by solutionsMissingAssumptions
    if (tests.some((t) => nodeInstrument(t))) continue;
    out.push(n.title);
  }
  return out;
}
