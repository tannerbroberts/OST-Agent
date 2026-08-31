/**
 * `ost-agent loop …` — the unattended firing's deterministic bookends.
 *
 * The commands, in the order a firing uses them:
 *
 *   due      may this vault fire right now? cadence + spend, both fail-closed.
 *   reserve  may a pass of THIS KIND spend the shared pool? The one command here
 *            the build loop calls: it and the discovery pass are charged against
 *            one window, and this is what keeps build from spending the share
 *            held for discovery. Refuses build only; discovery is never refused
 *            by the mechanism that protects it.
 *   update   apply a pushed update, but only between passes. `start` does this
 *            itself; the command exists for a wrapper that wants the checkpoint
 *            on its own schedule, and for an operator who wants to see the answer.
 *   start    refuse a dirty vault, take the overlap lock, open a health record.
 *   step     run one phase, record the exit code it actually produced.
 *   fallback after the pass: if it reached no tool, route the read-only half
 *            (ingest, check, status, debt) through the command line, refuse the
 *            write half, and stamp the run so it cannot seal clean.
 *   seal     compute the verdict from what was recorded, append it, unlock.
 *
 * Nothing here accepts a verdict from its caller. Every input is something this
 * process observed itself — an exit code, a clock, a commit sha, a token count
 * out of a transcript the agent cannot write — which is what makes the record
 * worth reading afterwards by someone who was not there.
 *
 * The exit codes are distinct on purpose. A wrapper that collapsed every
 * refusal into "not firing, exit 0" would make a vault that has never fired
 * once indistinguishable from a healthy one, which is criterion S2's failure
 * statement verbatim: only `notElapsed` is a normal, quiet outcome.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { Command } from "commander";
import { loadConfig, resolveSessionsDir } from "../config/load.js";
import type { LoopConfig } from "../config/schema.js";
import { evaluateCadence, parseCadence } from "../loop/cadence.js";
import { detectLaunderedExit, launderedExitMessage } from "../loop/exitLaundering.js";
import { degradedReport, observeDegradation } from "../loop/degraded.js";
import { failureSummary } from "../loop/failure-summary.js";
import { lastNodeTouchedSince } from "../telemetry/node-touch.js";
import { fallbackBanner, fallbackRefusalReport, runFallback } from "../loop/fallback.js";
import { appendStep, readOpenRun, readRuns, sealRun, startRun, sweepCrashed } from "../loop/health.js";
import { detectHandEdits, renderDriftReport } from "../git/hand-edit-detector.js";
import { observeToolSurface } from "../loop/tool-surface-record.js";
import {
  closeGoalContract,
  goalContractReport,
  goalDriftIsLoud,
  observeGoal,
  openGoalContract,
} from "../loop/goal-contract.js";
import {
  consecutiveSkips,
  dispatchClearedLine,
  dispatchSkippedReport,
  parityLine,
  readDispatches,
  readEnvironment,
  recordDispatch,
  recordRunParity,
  verifyDispatchEnvironment,
} from "../loop/environment.js";
import { announceUpdate, applyAtCheckpoint, subscriptionOf, updateStatusLine } from "../loop/updates.js";
import { observeSenses, senseCensusReport } from "../loop/senses.js";
import { computeShortfall, declareScope, shortfallReport } from "../loop/scope.js";
import { assessStall } from "../loop/stall.js";
import {
  countEvidence,
  observePassShape,
  observeStopCondition,
  stopConditionReport,
  OUTSTANDING_NOT_ACTIONABLE,
  STOP_CONDITION,
} from "../loop/stop-condition.js";
import { releaseFiringLock, stampFiringLock, waitForFiringLock } from "../loop/lock.js";
import { checkCeiling, measureFiring, type SpendCeiling } from "../loop/spend.js";
import {
  assessReserve,
  readBuildPasses,
  recordBuildPass,
  type DiscoveryReserve,
  type PassKind,
} from "../loop/reserve.js";
import { formatQuestionBudget, measureInterruptions, type QuestionBudget } from "../loop/questions.js";
import { commitSubjectsSince, gitHead, workingTreeStatus, type VaultTreeStatus } from "../loop/state.js";
import { VERSION } from "../index.js";
import { VAULT_OPTION_HELP } from "./vault-option.js";

/**
 * Refusals, one code each. `notElapsed` is the only non-zero the caller should
 * treat as routine; every other code is a vault that is not going to fire until
 * somebody changes something, and it must not read as quiet success.
 */
export const LOOP_EXIT = {
  due: 0,
  notElapsed: 10,
  cadenceUndeclared: 11,
  ceilingUndeclared: 12,
  ceilingBlocked: 13,
  dirtyTree: 14,
  locked: 15,
  treeUnreadable: 16,
  /**
   * `loop seal` only: this firing ran without the means to do its job.
   *
   * The odd one out — every code above is a firing that did not start, and this
   * is one that finished. It is here rather than folded into seal's `1` for the
   * reason the table exists at all: a wrapper that cannot tell "the tree came
   * back red" from "the pass never reached the tree" will treat one as the other,
   * and the whole point of the degraded verdict is that those are different
   * events with different fixes. Non-zero because exit 0 is the one word an
   * unattended caller reads as clean.
   */
  degraded: 17,
  /**
   * `loop update` only: an update is pending and this moment is not a checkpoint.
   *
   * Routine, like `notElapsed`, and non-zero for the same reason — a wrapper that
   * read 0 here would report "up to date" for a vault that has been holding the
   * same fix through every pass for a week. The way out is time, not a human: the
   * next `loop start` applies it before it opens its run.
   */
  updateHeld: 18,
  /**
   * `loop update` only: this vault subscribes to no channel, so there is nothing
   * to apply and never will be. Non-zero because the operator who typed a
   * half-formed `loop.updates` block believes they subscribed, and silence is the
   * one answer that leaves them believing it.
   */
  updateUnsubscribed: 19,
  /**
   * `loop fallback` only: a name it was asked to route is not one of the four
   * read-only verbs it carries. Nothing was run. Its own code because the
   * alternative — running the verbs it could and skipping the rest — is a
   * request to author through the fallback being quietly narrowed into a report,
   * which is the exact shape the fallback exists to refuse.
   */
  fallbackRefused: 20,
  /**
   * `loop due` only: the host cannot support a firing, so none was dispatched.
   *
   * Its own code because the fix is on the machine rather than in the vault or
   * the schedule — no directory at the path, no git checkout to record into, no
   * config, a git directory this account cannot write. Folding it into
   * `treeUnreadable` would send an operator looking at their working tree for a
   * problem that is a mount, a path or a permission; folding it into
   * `notElapsed` would be worse, because that is the one refusal a wrapper is
   * told to treat as routine and exit 0 on, and a host that can never fire would
   * report a quiet success on every cycle forever.
   */
  environmentUnready: 21,
  /**
   * `loop reserve` only: the pool this pass would spend is down to the share held
   * for discovery, so a build pass is refused.
   *
   * Its own code rather than `ceilingBlocked`'s, because the two refusals are
   * different facts with different fixes and only one of them is about money. The
   * ceiling says the pair has spent too much; this says the pair's remaining
   * budget belongs to the other claimant. A wrapper that collapsed them would
   * report a starved discovery loop as an exhausted account, and the operator
   * would raise a ceiling that was never the constraint. Routine, like
   * `notElapsed` — the way out is the window rolling forward, not a person.
   */
  reserveHeld: 22,
  /**
   * `loop stop` only: every term of the published stop condition is zero, so
   * there is nothing an unattended pass may act on.
   *
   * Routine, like `notElapsed`, and non-zero for the same reason: a wrapper that
   * read 0 here would treat "nothing to do" as "go and do it", which is the
   * whole failure. Its own code rather than `notElapsed`'s because the two are
   * different facts with different fixes — one is a clock and clears itself, and
   * this one clears when the world produces something to react to. An operator
   * seeing a week of these has a signal about their inputs, not their schedule.
   */
  nothingActionable: 23,
} as const;

const HOUR_MS = 60 * 60 * 1000;

// `resolveSessionsDir` moved to `src/config/load.ts` when the transcript adapter
// became a second reader of the same declared path — see its doc comment there.
// Re-exported so a caller reaching for it through the loop surface still finds it.
export { resolveSessionsDir };

/**
 * The declared ceiling, with its transcript directory resolved against the vault.
 *
 * Returns null — meaning "no ceiling declared, refuse to fire" — for a *partially*
 * declared block as well as an absent one. The schema deliberately accepts a
 * half-typed `spend:` rather than throwing, because `loadConfig` is called by
 * every context build (`src/runner/context.ts:68`) and a throw there takes the
 * whole tool surface down over a key none of those tools read. That is G1's
 * failure mode, and an earlier version of this file reproduced it: an operator
 * partway through hand-writing the three required keys made `ost-agent status`
 * and `ost-agent check` both die. Incompleteness has to fail the *loop* closed
 * without failing anything else open.
 */
function ceilingOf(vaultDir: string, spend: LoopConfig["spend"]): SpendCeiling | null {
  if (!spend) return null;
  const { ceilingWeightedTokens, windowHours, sessionsDir } = spend;
  if (ceilingWeightedTokens == null || windowHours == null || !sessionsDir) return null;
  return {
    weightedTokens: ceilingWeightedTokens,
    windowHours,
    sessionsDir: resolveSessionsDir(vaultDir, sessionsDir),
  };
}

/**
 * The declared question budget, or null for "unbounded".
 *
 * Same all-or-nothing shape as `ceilingOf` and for the same reason — a half-typed
 * block must not be read as a bound nobody declared. `budget: 0` is a real and
 * deliberate value (ask nothing, bank everything), so this checks for null rather
 * than falsiness; an earlier draft's `!budget` would have silently turned the one
 * setting that fully protects the operator's attention back into "unbounded".
 */
function questionBudgetOf(vaultDir: string, questions: LoopConfig["questions"]): QuestionBudget | null {
  if (!questions) return null;
  const { budget, windowHours, sessionsDir } = questions;
  if (budget == null || windowHours == null || !sessionsDir) return null;
  return { interruptions: budget, windowHours, sessionsDir: resolveSessionsDir(vaultDir, sessionsDir) };
}

/**
 * How many dirty paths a refusal lists before it stops. A vault mid-conflict can
 * be thousands of lines dirty, and a refusal a cron mails out must stay readable;
 * the count is always exact even when the listing is cut.
 */
const DIRTY_PATHS_SHOWN = 10;

/**
 * The one prefix a dirty path may carry and still be allowed to fire, and the
 * reason this gate has an exemption at all.
 *
 * **The wedge this closes, which was live and not hypothetical.** Every tool
 * invocation appends one line to `<vault>/.ost-agent/usage/events.jsonl`
 * (`withUsageTracing`, `src/telemetry/usage.ts:226-249`) — including the read-only
 * ones, and the append happens inside `tool.run`, i.e. before the dispatcher's
 * commit. For a *mutating* call that is harmless: `src/mcp/server.ts:237`
 * commits with `git add -A` right after, and the line rides along. For a
 * *read-only* call nothing commits, and the line is still sitting in the working
 * tree when the firing ends. `.claude/commands/ost-pass.md` step 4 ends the
 * sweep on `ost_next_work` — a read — so **every conforming pass terminates on a
 * read-only call and leaves exactly this residue.** A gate that refused it would
 * refuse the second firing of every vault that ever fired a first one,
 * permanently, with a human-only way out: R2's shape, on the mechanism meant to
 * protect the record. Verified by driving the real in-process MCP server —
 * `test/loop/firing-residue.test.ts`.
 *
 * **Why exempting it is not a hole in D5.** D5's danger is misattribution: a
 * path the firing tool did not touch is committed under that tool's name, and
 * the verdict is earned by a stranger's change. The trace is not a stranger's
 * change. It is the vault's own mechanical record of the calls that were made,
 * written by the dispatcher itself, and being swept into the next commit is the
 * *only* route a read-only call's event has ever had into history. Nor can it
 * corrupt an F4 verdict: it reaches HEAD only via some later mutating call's
 * commit, and that call moved HEAD anyway.
 *
 * **Why these prefixes and not `.ost-agent/`.** The dot-folder also holds `inbox/`
 * (fed by an untrusted builder under DEC-1), `evidence/`, `state/` and `runs/` —
 * a leftover in any of those is exactly the file this gate exists to stop.
 * `usage/` is exempted because it is a directory demonstrably written by a path
 * that never commits; everything else stays fail-closed, so a future
 * non-committing writer lands on a refusal and someone has to argue for it here.
 *
 * **`census-history/` is the second such writer, and the argument was made by
 * the refusal firing.** `ost-agent check` and `ost-agent status` keep a rolling
 * record of what each census examined and dropped
 * (`recordCensusFiring`, `src/ost/census.ts`) — written, like the usage trace,
 * from a read-only command that commits nothing, and meant to travel in git the
 * same way. The first firing after it shipped ran `check` as its check phase,
 * left `?? .ost-agent/census-history/` in the tree, and every tick for the next
 * seventeen hours was refused at this gate with exit 14 while `loop health`
 * reported nothing blocking. It is the vault's own mechanical record of its
 * own commands, written by the firing's mandatory check phase: the same
 * argument as the trace, for the same kind of file.
 */
const FIRING_RESIDUE_PREFIXES: readonly string[] = [".ost-agent/usage/", ".ost-agent/census-history/"];

/**
 * The path a porcelain v1 entry names — the destination side of a rename.
 *
 * Deliberately does NOT unquote. Git quotes a path containing specials
 * (`core.quotePath`), and an unquoted `"…"` will not match the prefix above, so
 * a strange path fails *closed* into the refusal rather than being waved through
 * by a parser that guessed. The one path this exemption is for contains nothing
 * git would quote.
 */
function porcelainPath(entry: string): string {
  const raw = entry.slice(3);
  const arrow = raw.indexOf(" -> ");
  return arrow === -1 ? raw : raw.slice(arrow + 4);
}

/**
 * The dirty entries a human actually has to deal with. Empty means the firing
 * may begin: see `FIRING_RESIDUE_PREFIXES` for what is filtered and why.
 *
 * Exported because it is the boundary of the criterion, and a boundary worth
 * stating is worth pinning.
 */
export function entriesRequiringAHuman(entries: string[]): string[] {
  return entries.filter((e) => !FIRING_RESIDUE_PREFIXES.some((prefix) => porcelainPath(e).startsWith(prefix)));
}

/**
 * The refusal text for a vault that is not clean, or whose cleanliness cannot be
 * established. Exported because the sentence is the mechanism here: an exit code
 * tells a wrapper to stop, and only this text tells the human what to do next.
 *
 * **Why a dirty tree stops a firing at all** — this is the argument, not the
 * tidiness it looks like. Every mutating tool in the vault commits with
 * `git add -A` (`src/git/safe-git.ts:49`), which stages the whole vault rather
 * than the paths that tool touched. So a file somebody else left behind is
 * committed by the *next* mutating tool under that tool's name: a node file that
 * no tool invocation explains (W2), manufactured deterministically rather than
 * waiting for a rare race. It was demonstrated live — an audit for
 * `docs/reference/v1-readiness.md` left `?? test/zz-probe.test.ts` sitting in a
 * working tree, one `git add -A` away from being attributed to an allowlisted,
 * append-only tool.
 *
 * And it corrupts the verdict, which is the part that outlives the stray file.
 * F4 decides whether a firing accomplished anything by comparing the vault's
 * HEAD before and after (`computeVerdict`, `src/loop/health.ts:193-199`). A
 * leftover is what moves HEAD on the *next* firing, so verdicts shift by one and
 * a firing that did nothing seals `healthy` on the strength of a stranger's file.
 * A single stale untracked file keeps a dead vault reading healthy indefinitely —
 * which is why D5 is a precondition for F4's escalation half and not a lint.
 *
 * **The way out is a human, deliberately, and that is the exception the wedge
 * rule allows rather than a violation of it.** Gate F requires every stopping
 * state to name its way out and to clear automatically "unless a human interrupt
 * is the actual point." Here it is the point: an unexplained file in the vault is
 * a fact only the person who left it can interpret, and every automatic way out
 * is a worse tool than the refusal. Committing it is exactly the misattribution
 * this exists to prevent; deleting it is a destructive act this codebase does not
 * take anywhere (there is no reset, no clean, no rm in `safe-git.ts`, and
 * corrections are appends); ignoring it silently is how the file stops being
 * visible at all. So the refusal is loud, it names the paths, and it names the
 * three commands that clear it. There is deliberately no `--force`: "fire anyway"
 * must not be an expressible argument, for F1's reason.
 *
 * The loop's own records cannot cause this. They live under
 * `<vault>/.git/ost-agent/` (`src/loop/state.ts`), which git refuses to track by
 * construction, so a firing cannot wedge the firing after it. That is asserted by
 * a test rather than by this paragraph — see the wedge test in
 * `test/cli/loop.test.ts`.
 *
 * The *firing's* leavings are a different question from the *loop's*, and the
 * answer there is not "by construction" but an explicit exemption: a pass ends on
 * a read-only tool call, which appends to the usage trace and never commits. See
 * `FIRING_RESIDUE_PREFIXES`, and `test/loop/firing-residue.test.ts` for the wedge run
 * through the real MCP server. Entries under that prefix are removed before this
 * message is built, so the list an operator reads is only ever paths they can act
 * on.
 */
export function dirtyTreeMessage(vaultDir: string, tree: VaultTreeStatus): string {
  const abs = path.resolve(vaultDir);
  if (tree.kind === "unknown") {
    return [
      `not firing: cannot tell whether ${abs} is clean — ${tree.reason}.`,
      "  A firing whose starting state is unknown cannot have its verdict trusted afterwards, so this refuses",
      "  rather than assuming the tree is clean.",
      `  The way out: run \`git -C ${abs} status\` and fix what it reports. If it says this is not a repository,`,
      "  the vault has no history to record into — `ost-agent init` (or `git init`) there first. If git is not on",
      "  PATH, install it: this loop records, commits and pushes with git and cannot run without it.",
      "  Nothing was recorded and no lock was taken.",
    ].join("\n");
  }
  if (tree.kind === "clean") return "";
  const shown = tree.entries.slice(0, DIRTY_PATHS_SHOWN);
  const rest = tree.entries.length - shown.length;
  return [
    `not firing: ${tree.entries.length} path(s) are already dirty in ${abs}, and this firing did not put them there:`,
    ...shown.map((e) => `    ${e}`),
    ...(rest > 0 ? [`    … and ${rest} more`] : []),
    "  Every mutating tool in this vault commits with `git add -A`, so these get committed by whatever tool runs",
    "  next, under that tool's name — and this firing's verdict would then be earned by somebody else's change.",
    "  The way out is yours to choose, because only you know what these are:",
    `    git -C ${abs} status                              # see them in full`,
    // `commit -am` is deliberately NOT offered: it stages modifications only, so
    // an operator following it against the untracked case above would run it,
    // see a clean-looking commit, and be refused again by the same file.
    `    git -C ${abs} add -A && git -C ${abs} commit -m "…"   # keep them, attributed to you`,
    `    git -C ${abs} restore <path>                      # discard an unwanted edit`,
    "    …or add the path to .gitignore if it should never have been tracked.",
    "  Nothing was recorded and no lock was taken.",
  ].join("\n");
}

/**
 * The declared discovery reserve, or null for "nothing is held".
 *
 * Same all-or-nothing shape as `ceilingOf` and `questionBudgetOf`, and the same
 * reason: a half-typed block must not be read as a share nobody declared.
 * `discoveryPasses: 0` is a real and deliberate value — "count the passes, hold
 * none of them" — so this checks for null rather than falsiness.
 */
function reserveOf(reserve: LoopConfig["reserve"]): DiscoveryReserve | null {
  if (!reserve) return null;
  const { discoveryPasses, totalPasses, windowHours } = reserve;
  if (discoveryPasses == null || totalPasses == null || windowHours == null) return null;
  return { discoveryPasses, totalPasses, windowHours };
}

/** Which required keys a partially-declared `spend:` block is missing, for the refusal. */
function missingSpendKeys(spend: LoopConfig["spend"]): string[] {
  if (!spend) return [];
  return [
    spend.ceilingWeightedTokens == null ? "ceilingWeightedTokens" : null,
    spend.windowHours == null ? "windowHours" : null,
    !spend.sessionsDir ? "sessionsDir" : null,
  ].filter((k): k is string => k !== null);
}

export function registerLoopCommands(program: Command): void {
  const loop = program
    .command("loop")
    .description("unattended firing: cadence gate, overlap lock, spend ceiling, health record");

  loop
    .command("due")
    .description(
      "may this vault fire now? (environment + cadence + spend ceiling; all three refuse when they cannot be satisfied)",
    )
    .option("--vault <dir>", VAULT_OPTION_HELP)
    .action((opts: { vault: string }) => {
      const now = Date.now();

      // FIRST, ahead of the config load and both ledger gates, because the two
      // gates below read the vault to answer their questions and a vault that
      // cannot be read answers them wrong rather than not at all: `readRuns`
      // returns `[]` for a directory with no state dir, so a checkout whose
      // `.git` had moved read as "never fired" and came back due on every single
      // cycle. That is the failure this gate exists to stop, and it can only stop
      // it by running before the gate it would fool.
      const environment = verifyDispatchEnvironment(opts.vault);
      if (!environment.ok) {
        const recorded = recordDispatch(opts.vault, {
          at: new Date(now).toISOString(),
          verdict: "skipped",
          reading: environment.reading,
          reason: environment.problem!,
        });
        console.error(
          dispatchSkippedReport({
            problem: environment.problem!,
            consecutive: consecutiveSkips(readDispatches(opts.vault)),
            recorded,
          }),
        );
        process.exitCode = LOOP_EXIT.environmentUnready;
        return;
      }

      const config = loadConfig(opts.vault);
      const runs = readRuns(opts.vault);

      // Printed before any gate, so a vault that has never fired says so on
      // every invocation instead of being silent about it.
      const last = runs[0];
      console.log(last ? `last record: ${last.verdict ?? "unsealed"} at ${last.startedAt}` : "last record: none — this vault has never fired");

      // The stall signal rides on `due` because this is the one command a cron
      // runs every cycle whose output it reliably reads, and it is stated BEFORE
      // the gates deliberately: escalation reports, it never refuses to fire, so
      // it must not touch the decision or the exit code below. See loop/stall.ts.
      const stall = assessStall(runs);
      if (stall.stalled) console.error(`⚠ stalled: ${stall.reason}`);

      const cadence = evaluateCadence({ runs, now, cadenceMs: parseCadence(config.loop?.cadence) });
      if (cadence.ignoredFuture > 0) {
        console.error(
          `⚠ ${cadence.ignoredFuture} run record(s) are stamped in the future and were ignored — check this machine's clock.`,
        );
      }
      if (cadence.status === "undeclared") {
        console.error(`not firing: ${cadence.reason}`);
        process.exitCode = LOOP_EXIT.cadenceUndeclared;
        return;
      }
      if (cadence.status === "not-elapsed") {
        console.log(`not due: ${cadence.reason}`);
        process.exitCode = LOOP_EXIT.notElapsed;
        return;
      }

      const ceiling = ceilingOf(opts.vault, config.loop?.spend);
      const spend = checkCeiling(
        ceiling,
        ceiling
          ? measureFiring(ceiling.sessionsDir, {
              vaultDir: opts.vault,
              sinceMs: now - ceiling.windowHours * HOUR_MS,
            })
          : undefined,
      );
      if (!spend.ok) {
        // A half-typed block reaches here as `undeclared` (ceilingOf returned
        // null), which is the right refusal but a useless message on its own —
        // the operator wrote something and is told they wrote nothing. Name the
        // keys instead, since this is the state they are most likely to be in.
        const missing = missingSpendKeys(config.loop?.spend);
        const detail = missing.length > 0 ? ` — \`loop.spend\` is missing: ${missing.join(", ")}` : "";
        console.error(`not firing: ${spend.reason}${detail}`);
        process.exitCode = spend.kind === "undeclared" ? LOOP_EXIT.ceilingUndeclared : LOOP_EXIT.ceilingBlocked;
        return;
      }

      console.log(`due: ${cadence.reason}`);
      console.log(`  ${spend.reason}`);

      // Stated at the point the operator decides whether to walk away, and stated
      // whether or not it is declared — an unbounded budget is a fact about this
      // firing, not an absence to pass over in silence. It never touches the exit
      // code: this reports the attention a firing may cost, it does not refuse one.
      const questions = questionBudgetOf(opts.vault, config.loop?.questions);
      console.log(
        `  ${formatQuestionBudget(
          questions,
          questions
            ? measureInterruptions(questions.sessionsDir, {
                vaultDir: opts.vault,
                sinceMs: now - questions.windowHours * HOUR_MS,
              })
            : undefined,
        )}`,
      );

      // LAST, once every gate has cleared and this command is really dispatching
      // — recording a reading for a cycle that then refused would leave `loop
      // start` pairing a run against a dispatch that never happened. What is
      // written is the reading the gate above decided from, not a fresh one: a
      // second reading could differ from the one that cleared, and the whole
      // value of the record is that it says what the scheduler acted on.
      console.log(`  ${dispatchClearedLine(environment.reading)}`);
      if (!recordDispatch(opts.vault, { at: new Date(now).toISOString(), verdict: "dispatched", reading: environment.reading })) {
        console.error(
          "  ⚠ the dispatch reading could not be written — this firing will not be able to check that the run it " +
            "starts sees what this check saw.",
        );
      }
    });

  loop
    .command("reserve")
    .description(
      "may a pass of this kind spend the shared pool? (refuses a BUILD pass once the window is down to the " +
        "share held for discovery; never refuses discovery)",
    )
    .requiredOption("--kind <discovery|build>", "which loop is asking")
    .option(
      "--claim",
      "charge this build pass to the window when it is permitted — pass it at the moment the pass is about to " +
        "spend a model call, never on a tick that decides to do nothing. Discovery needs no claim: its passes are " +
        "counted from the run ledger `loop start` already writes.",
    )
    .option("--vault <dir>", VAULT_OPTION_HELP)
    .action((opts: { kind: string; claim?: boolean; vault: string }) => {
      /*
       * The one gate in this file that is asked by the OTHER loop. `loop due`,
       * `start`, `step` and `seal` are the discovery pass's bookends and are keyed
       * to its cadence, its lock and its window; the build loop deliberately calls
       * none of them. It calls this, because the pool it spends is not its own —
       * both wrappers run Claude Code with the vault as cwd, so both are charged
       * against `loop.spend` and only one of them was ever asked.
       *
       * Nothing here takes a verdict from its caller. `--kind` says which loop is
       * asking and both counts come off ledgers this process reads itself.
       */
      if (opts.kind !== "discovery" && opts.kind !== "build") {
        console.error(`not a pass kind: ${opts.kind} — use --kind discovery or --kind build`);
        process.exitCode = 2;
        return;
      }
      const kind: PassKind = opts.kind;
      const config = loadConfig(opts.vault);
      const verdict = assessReserve({
        reserve: reserveOf(config.loop?.reserve),
        kind,
        discoveryAt: readRuns(opts.vault).map((r) => r.startedAt),
        buildAt: readBuildPasses(opts.vault).map((r) => r.at),
        now: Date.now(),
      });

      if (verdict.ignoredFuture > 0) {
        console.error(
          `⚠ ${verdict.ignoredFuture} pass record(s) are stamped in the future and were ignored — check this machine's clock.`,
        );
      }

      if (!verdict.ok) {
        console.error(`not building: ${verdict.reason}`);
        process.exitCode = LOOP_EXIT.reserveHeld;
        return;
      }

      console.log(`${kind}: ${verdict.reason}`);

      // The claim is made only after the gate cleared, and only for the kind that
      // has a ledger to write. Charging a refused pass would consume a window the
      // pass never got to spend; charging a discovery pass here would double-count
      // the record `loop start` already writes.
      if (!opts.claim) return;
      if (kind === "discovery") {
        console.log("  nothing claimed: discovery passes are counted from the run ledger, not from a second file");
        return;
      }
      recordBuildPass(opts.vault, new Date().toISOString());
      console.log("  claimed: this build pass is charged to the window");
    });

  loop
    .command("stop")
    .description(
      "is there anything an unattended pass may act on? (evaluates the published stop condition against the " +
        "tree; exit 23 means every term is zero and idling is the honest move)",
    )
    .option("--explain", "print the whole published rule — every term, and every outstanding kind it deliberately ignores")
    .option("--vault <dir>", VAULT_OPTION_HELP)
    .action((opts: { explain?: boolean; vault: string }) => {
      /*
       * Read-only, and it writes nothing — not a ledger line, not a dispatch
       * record, not a lock. That is deliberate rather than incidental: this is the
       * command an operator is meant to be able to run at any moment to ask why
       * the loop is quiet, and a question that consumes a window is a question
       * nobody asks twice.
       *
       * It is NOT wired into `loop due`, and `stop-condition.ts` says why at
       * length: ingestion happens inside the pass, so a maintained tree with a
       * full inbox evaluates as "nothing actionable" right up until the ingest
       * that is the whole reason to fire. What consumes this is a wrapper that
       * wants to skip a firing on a vault whose inputs it knows are quiet, and
       * `loop start`, which stamps the same reading into the run record and holds
       * the pass to it at seal.
       */
      const record = observeStopCondition(opts.vault);

      if (opts.explain) {
        console.log("the published stop condition — the loop idles when every term below is zero:");
        for (const t of STOP_CONDITION) console.log(`  ${t.id} (${t.field}) → ${t.action}`);
        console.log("outstanding but NOT counted, by declaration:");
        for (const n of OUTSTANDING_NOT_ACTIONABLE) console.log(`  ${n.field} — ${n.why}`);
      }

      if (record.heldAtStart === null) {
        // Loud, and NOT the routine code: a sweep that could not be taken has not
        // said there is nothing to do. Collapsing it into the quiet exit would
        // idle a loop on the strength of a broken tree, which is the one way this
        // gate could do real damage.
        console.error(`cannot evaluate: ${record.unevaluated ?? "the sweep could not be taken"}`);
        process.exitCode = LOOP_EXIT.treeUnreadable;
        return;
      }

      for (const t of record.terms ?? []) console.log(`  ${t.count === 0 ? "·" : "→"} ${t.count} ${t.field}`);

      // Printed in BOTH branches, and it is the holding branch that needs it: a
      // loop reporting nothing to do beside a tree with forty open items reads
      // as a lie until the output says which declaration accounts for them.
      const ignored = record.ignored ?? [];
      if (ignored.length > 0) {
        console.log(
          `  not counted, by declaration (\`loop stop --explain\` says why each): ${ignored
            .map((i) => `${i.count} ${i.field}`)
            .join(", ")}`,
        );
      }

      if (record.heldAtStart) {
        console.log("stop: nothing an unattended pass may act on. Idling is the honest outcome and it is free.");
        process.exitCode = LOOP_EXIT.nothingActionable;
        return;
      }
      const outstanding = (record.terms ?? []).filter((t) => t.count > 0);
      console.log(`go: ${outstanding.map((t) => `${t.count} ${t.field}`).join(", ")}`);
    });

  loop
    .command("announce")
    .description("record an update this vault's subscriber heard (writes nothing but a spool line; applies nothing)")
    // `--release`, not `--version`: commander's program-level `--version` is
    // inherited by every subcommand, so `loop announce --version 0.12.0` printed
    // the CLI's own version and exited 0 — a subscriber whose announcements
    // silently went nowhere, reporting success on every one.
    .requiredOption("--release <version>", "the version announced")
    .option("--channel <name>", "the channel it was announced on (default: the one this vault subscribes to)")
    .option("--source <who>", "who announced it — informational, nothing branches on it")
    .option("--notes <text>", "what is in it, for a human reading the spool")
    .option("--announced-at <iso>", "when the publisher announced it (default: now)")
    .option("--vault <dir>", VAULT_OPTION_HELP)
    .action((opts: { release: string; channel?: string; source?: string; notes?: string; announcedAt?: string; vault: string }) => {
      /*
       * The subscriber's end of the push channel, and deliberately the dumbest
       * thing in the loop. It appends one line. It cannot apply anything, cannot
       * decide anything, and holds no lock — which is what lets the process that
       * listens to an outside channel be the least-trusted component here, since
       * the barrier that matters runs at the checkpoint and not at arrival.
       */
      const config = loadConfig(opts.vault);
      const subscription = subscriptionOf(config.loop?.updates);
      const result = announceUpdate(
        opts.vault,
        {
          channel: opts.channel ?? subscription?.channel ?? "",
          version: opts.release,
          ...(opts.announcedAt ? { announcedAt: opts.announcedAt } : {}),
          ...(opts.source ? { source: opts.source } : {}),
          ...(opts.notes ? { notes: opts.notes } : {}),
        },
        { subscription },
      );
      if (!result.ok) {
        console.error(`not recorded: ${result.reason}`);
        process.exitCode = subscription === null ? LOOP_EXIT.updateUnsubscribed : 2;
        return;
      }
      console.log(`announced ${result.announcement.version} on ${result.announcement.channel} — applies at the next checkpoint`);
    });

  loop
    .command("update")
    .description("apply a pushed update, but only between passes (holds it otherwise; never applies mid-pass)")
    .option("--vault <dir>", VAULT_OPTION_HELP)
    .action((opts: { vault: string }) => {
      /*
       * `loop start` runs this same barrier itself, so a vault on a cron
       * propagates without anyone adding a step. This command exists for the two
       * cases that one does not serve: a wrapper that wants the checkpoint on its
       * own schedule (between a pass sealing and the next one becoming due, which
       * may be hours), and an operator who wants to see what is waiting.
       *
       * The exit code is the interface, and `held` gets its own. A wrapper that
       * could not tell "applied" from "held" would report a fleet as up to date
       * while every instance in it sat one version behind.
       */
      const config = loadConfig(opts.vault);
      const subscription = subscriptionOf(config.loop?.updates);
      const ttlMs = (config.loop?.lockTtlMinutes ?? 60) * 60_000;
      const outcome = applyAtCheckpoint(opts.vault, { subscription, ttlMs });
      if (outcome.action === "unsubscribed") {
        console.error(`no update channel: ${outcome.reason}`);
        process.exitCode = LOOP_EXIT.updateUnsubscribed;
        return;
      }
      if (outcome.action === "held") {
        console.error(`held: ${outcome.reason}`);
        process.exitCode = LOOP_EXIT.updateHeld;
        return;
      }
      console.log(outcome.action === "applied" ? `applied: ${outcome.reason}` : `no update: ${outcome.reason}`);
    });

  loop
    .command("start")
    .description(
      "refuse a dirty working tree, take the overlap lock, open a health record (sweeps any crashed prior run first)",
    )
    .option("--vault <dir>", VAULT_OPTION_HELP)
    .option(
      "--holder-pid <pid>",
      "pid of the process that owns the whole firing (defaults to this command's parent)",
    )
    .option(
      "--pass <file>",
      "the SKILL.md (or command file) `required-tools` was already checked against — stamps the run record's " +
        "tool-surface block from the same declaration, without reading it a second time for a different purpose",
    )
    .option(
      "--available <csv>",
      "the tools this firing will actually be able to call — the same string handed to `required-tools --available`",
    )
    .action(async (opts: { vault: string; holderPid?: string; pass?: string; available?: string }) => {
      // The run's own account of where it is standing, taken in its first
      // instant and before this command has changed anything — no lock, no
      // record, no checkpoint. Later would be a reading of an environment this
      // process had already acted on, and the claim being measured is what the
      // run *was given*, not what it made for itself.
      const runEnvironment = readEnvironment(opts.vault);

      // FIRST, before the lock and before any record is opened, so a refusal
      // leaves nothing behind — no lock for the next firing to break, no open
      // marker for it to sweep as `crashed`. The cost of that ordering is
      // stated rather than hidden: a crashed prior run stays unswept while the
      // tree is dirty, because `startRun` is what sweeps it. Nothing is lost —
      // the marker is still there and the next firing that gets past this gate
      // records it — and the alternative is worse, since sweeping first would
      // mean a refusal that mutates the ledger it refused to add to.
      //
      // See `dirtyTreeMessage` for why a dirty tree is a stopping state and why
      // its way out is deliberately a human.
      const tree = workingTreeStatus(opts.vault);
      // The firing's own trace residue is filtered out before the decision, not
      // after it, so the refusal lists only paths a human can act on — see
      // `FIRING_RESIDUE_PREFIXES`. `unknown` is never filtered: there are no entries
      // to filter, and "cannot tell" is not a state anything may waive.
      const foreign = tree.kind === "dirty" ? entriesRequiringAHuman(tree.entries) : [];
      if (tree.kind === "unknown" || foreign.length > 0) {
        console.error(dirtyTreeMessage(opts.vault, tree.kind === "dirty" ? { kind: "dirty", entries: foreign } : tree));
        // Two codes, because they are two different mistakes with two different
        // fixes: 14 means "deal with your files", 16 means "this is not a
        // usable checkout". Collapsing them would send a cron operator hunting
        // for stray files on a machine that simply has no git.
        process.exitCode = tree.kind === "dirty" ? LOOP_EXIT.dirtyTree : LOOP_EXIT.treeUnreadable;
        return;
      }
      if (tree.kind === "dirty") {
        // Said out loud rather than waived in silence: the exemption is the one
        // place this gate is narrower than the criterion it implements, and an
        // operator reading a firing's output should be able to see it happen.
        console.error(
          `carrying ${tree.entries.length} uncommitted firing-record path(s) — the vault's own usage trace and census history, swept into the next commit.`,
        );
      }

      const config = loadConfig(opts.vault);
      const ttlMs = (config.loop?.lockTtlMinutes ?? 60) * 60_000;
      // The lock belongs to the FIRING, not to this command — `loop start` exits
      // in milliseconds. A wrapper that can name the process owning the whole
      // firing (`--holder-pid $$`) gets its lock released the instant that
      // process dies; one that cannot falls back to the TTL, which is slower but
      // never wrong. Deliberately not defaulted to `process.ppid`: under a
      // launcher that forks, the parent is a shim that exits immediately, and
      // the lock would be breakable from the moment it was taken.
      const holderPid = opts.holderPid === undefined ? NaN : Number(opts.holderPid);
      // Wait for the holder rather than walking away from it. A firing that
      // exits `locked` has to be re-scheduled by something before the work
      // happens at all, and — the part that is easy to miss — an arrival that
      // never watches cannot tell a hung holder from a working one, so the only
      // recovery rule left to it is a timeout long enough to be useless. The
      // wait IS the measurement; see `../loop/lock.ts`.
      const heartbeatEveryMs = (config.loop?.lockHeartbeatMinutes ?? 4) * 60_000;
      const lock = waitForFiringLock(opts.vault, {
        ttlMs,
        waitMs: (config.loop?.lockWaitMinutes ?? 15) * 60_000,
        ...(Number.isInteger(holderPid) && holderPid > 0 ? { holderPid } : {}),
        ...(heartbeatEveryMs > 0 ? { heartbeatEveryMs } : {}),
        // Said out loud as it happens, because a firing that appears to hang for
        // a quarter of an hour and explains itself only afterwards is
        // indistinguishable, to the operator watching, from the hang it is
        // recovering from.
        onObservation: (o) => {
          if (o.verdict === "suspect" || o.verdict === "broke" || o.verdict === "clock-jumped") {
            console.error(`waiting for the firing lock: ${o.verdict} — ${o.why}`);
          }
        },
      });
      if (!lock.ok) {
        console.error(`not firing: ${lock.reason}`);
        process.exitCode = LOOP_EXIT.locked;
        return;
      }
      if (lock.waitedMs > 0) console.error(`waited ${Math.round(lock.waitedMs / 1000)}s for the firing lock`);
      if (lock.broke) console.error(`broke a stale firing lock — ${lock.broke.why}`);

      // THE CHECKPOINT. This is the one instant in the whole loop that is
      // provably between passes: the lock is held so no other firing can be in
      // one, and this firing's run is not open yet. An update applied here
      // cannot land on a half-finished write; an update applied anywhere else
      // can. Doing it inside `loop start` rather than only in `loop update` is
      // what makes propagation independent of the operator remembering to add a
      // cron step, which is the whole reason a push channel beats a pull.
      //
      // The sweep runs first and is not an extra mutation: `startRun` sweeps a
      // crashed marker three lines below, and doing it here just means the
      // checkpoint sees the state that firing will. Without it a vault whose
      // previous pass died would hold every update forever, because the barrier
      // reads an unswept open marker as a pass in flight — correctly, and with
      // no way out.
      const subscription = subscriptionOf(config.loop?.updates);
      if (subscription !== null) {
        sweepCrashed(opts.vault);
        const checkpoint = applyAtCheckpoint(opts.vault, { subscription, ttlMs, holdsLock: true });
        if (checkpoint.action === "applied") console.log(`update: ${checkpoint.reason}`);
        else if (checkpoint.action === "held") console.error(`update: ${checkpoint.reason}`);
      }

      // If this throws, the firing does not happen. That is the point: a firing
      // nobody can read afterwards would leave the cadence window unconsumed and
      // the vault firing forever with nothing on record.
      //
      // The ceiling is resolved HERE, once, and stamped into the run record —
      // `loop step` enforces the stamp and never re-reads the config, so an edit
      // to `ost.config.yaml` mid-firing cannot widen the budget of the firing
      // that is spending it. See `LoopRunRecord.ceiling`.
      const stampedCeiling = ceilingOf(opts.vault, config.loop?.spend);
      // Computed from the same `--pass`/`--available` a wrapper already resolved
      // for `required-tools`, never by listing or calling a tool again. `--pass`
      // named with no `--available` (or the reverse) is a caller that asked for
      // this to be recorded and gave it half of what it needs — `unknown` rather
      // than silently dropping the block, same as an unreadable pass file.
      const toolSurface =
        opts.pass === undefined && opts.available === undefined
          ? undefined
          : opts.pass === undefined || opts.available === undefined
            ? { unknown: "only one of --pass and --available was given; the tool surface needs both" }
            : observeToolSurface({
                passFile: path.resolve(opts.pass),
                available: opts.available.split(",").map((t) => t.trim()).filter(Boolean),
              });
      // The mandate this firing is about to run against, read from the vault at
      // the last moment before the run opens and stamped unconditionally — every
      // firing records one, because a stamp a caller could omit is a stamp that
      // is missing from exactly the firing whose aim someone later disputes. It
      // is read here rather than by `startRun` for the same reason as the tool
      // surface: the record's writer observes nothing itself, so there is one
      // place a reading can come from and the firing is not it.
      const goal = openGoalContract(observeGoal(opts.vault));
      // The stopping question, asked of the vault at the last moment before the
      // run opens and stamped unconditionally — every firing records one, for the
      // reason the goal stamp gives and one more: this reading is what the pass is
      // held to at seal, and a stamp a caller could omit would be missing from
      // exactly the firing that most wanted it missing. It refuses nothing here.
      // `loop start` has already taken the lock and applied the checkpoint, and a
      // gate that fired at this point would leave both to be unwound; the wrapper
      // that wants to skip a quiet firing asks `loop stop` before any of that.
      const stopCondition = observeStopCondition(opts.vault);
      const opened = startRun(opts.vault, {
        loopVersion: VERSION,
        cliVersion: VERSION,
        headBefore: gitHead(opts.vault),
        ...(stampedCeiling ? { ceiling: stampedCeiling } : {}),
        ...(toolSurface ? { toolSurface } : {}),
        goal,
        stopCondition,
      });
      stampFiringLock(opts.vault, lock.record, opened.runId);
      console.log(`loop run ${opened.runId} open`);
      for (const line of goalContractReport(goal)) console.log(line);
      // Said at the top of the firing, on stderr when it holds, because the pass
      // about to run is entitled to know it is being held to this. A rule enforced
      // at seal and never announced at start would fail a firing for a standard it
      // was not told about, which is the shape of gate people quite rightly
      // disable. `examples/automation/autonomous-pass.sh` puts the same sentence
      // in front of the model.
      if (stopCondition.heldAtStart === true) {
        console.error(
          "⚠ the stop condition holds: nothing an unattended pass may act on. Idling is the honest outcome — " +
            "read, report, file a friction note about the standstill if there is one, and author nothing. A firing " +
            "that creates structure from here seals `unhealthy`.",
        );
      } else if (stopCondition.heldAtStart === null) {
        console.error(`stop condition: not evaluated — ${stopCondition.unevaluated ?? "the sweep could not be taken"}. Nothing is enforced.`);
      }

      // The other half of the dispatch check: what `loop due` saw when it let
      // this firing through, against what this run actually got. Recorded after
      // the run opens because the pair is worth nothing without the run id that
      // ties it to a firing — and printed either way, including the "nothing to
      // compare" case, because a run nobody dispatched and a run whose readings
      // matched are different facts and only one of them says the preflight
      // worked. A disagreement is loud and does not stop the run; see
      // `loop/environment.ts` for why refusing here would be the failure a
      // preflight is meant to prevent.
      const parity = recordRunParity(opts.vault, {
        runId: opened.runId,
        reading: runEnvironment,
        at: new Date().toISOString(),
      });
      const line = parityLine(parity);
      if (parity && parity.disagreements.length > 0) console.error(line);
      else console.log(line);

      // What changed in the vault while this loop was not looking — read from
      // git, against the commit the last sealed run left behind.
      //
      // LAST, and never a refusal. A hand edit is evidence, not a fault: the
      // 2026-07-24 incident was an operator renaming a node and retyping it
      // `Metric`, which is a person telling this product their schema is missing
      // a word. A gate here would turn the most direct user feedback the tree
      // ever receives into a reason not to run. So it prints and the pass
      // proceeds — including when the read itself fails, which is reported as
      // `unknown` rather than folded into silence, because "nothing drifted" and
      // "nobody could tell" are different facts.
      const lastSealed = [...readRuns(opts.vault)].reverse().find((r) => typeof r.headAfter === "string");
      try {
        const drift = await detectHandEdits(opts.vault, lastSealed?.headAfter ? { since: lastSealed.headAfter } : {});
        for (const driftLine of renderDriftReport(drift)) console.error(driftLine);
      } catch (e) {
        console.error(`drift: unknown — ${e instanceof Error ? e.message : String(e)}`);
      }
    });

  loop
    .command("scope")
    .description(
      "declare this run's intended scope, once, before its first step — the record `loop seal --attempted` diffs against",
    )
    .argument("<statement>", "what this run set out to do, in its own words")
    .option("--vault <dir>", VAULT_OPTION_HELP)
    .action((statement: string, opts: { vault: string }) => {
      const open = readOpenRun(opts.vault);
      if (!open) {
        console.error("not declared: no open loop run — run `ost-agent loop start` first.");
        process.exitCode = 1;
        return;
      }
      try {
        const declared = declareScope(opts.vault, open, statement);
        console.log(`scope declared for run ${declared.runId}: ${declared.statement}`);
      } catch (e) {
        console.error(`not declared: ${e instanceof Error ? e.message : String(e)}`);
        process.exitCode = 2;
      }
    });

  loop
    .command("step")
    .description("run one phase command and record the exit code it actually produced")
    .requiredOption("-p, --phase <id>", "phase id (pass, check, …)")
    .option("--vault <dir>", VAULT_OPTION_HELP)
    .argument("<command...>", "the command to run (after --)")
    .action((command: string[], opts: { phase: string; vault: string }) => {
      // Checked BEFORE anything runs and before anything is written. A command
      // whose exit code cannot report failure would be recorded as a pass no
      // matter what happened inside it, and one such step is enough to make the
      // whole record require corroboration. See loop/exitLaundering.ts for the
      // run this was written from.
      const laundered = detectLaunderedExit(command);
      if (laundered) {
        console.error(launderedExitMessage(laundered));
        process.exitCode = 2;
        return;
      }

      // THE MID-FIRING HALT. `loop due` bounds the loop between firings; this
      // bounds it inside one. A pass that crosses the ceiling while it runs is
      // stopped at the next phase boundary, however much work it believes
      // remains — the limit is external to the firing's own judgement, which is
      // the whole claim a ceiling makes. The stamp comes from the run record,
      // never from config (see `loop start`), so the one thing spending the
      // budget cannot be the thing that widens it. Enforced against a stamped
      // ceiling only: a run opened without one was let past `due`'s undeclared
      // refusal deliberately (a direct/manual bracket), and inventing a bound
      // nobody declared is the one thing the spend gate never does.
      //
      // The refusal is RECORDED, with `refused` marking that the command never
      // ran — a halt whose only trace is an exit code would leave a ledger that
      // reads as a phase that mysteriously vanished. The nonzero exit makes the
      // seal `unhealthy`, which is honest: this firing did not finish its job.
      const open = readOpenRun(opts.vault);
      if (open?.ceiling) {
        const halt = checkCeiling(
          open.ceiling,
          measureFiring(open.ceiling.sessionsDir, {
            vaultDir: opts.vault,
            sinceMs: Date.now() - open.ceiling.windowHours * HOUR_MS,
          }),
        );
        if (!halt.ok) {
          console.error(`halting mid-firing, not running phase \`${opts.phase}\`: ${halt.reason}`);
          appendStep(opts.vault, {
            phase: opts.phase,
            command: command.join(" "),
            argv: command,
            cwd: process.cwd(),
            exit: LOOP_EXIT.ceilingBlocked,
            durationMs: 0,
            refused: "spend-ceiling",
          });
          process.exitCode = LOOP_EXIT.ceilingBlocked;
          return;
        }
      }

      const startedAt = Date.now();
      // Captured BEFORE the child runs. A step's record has to answer "where
      // was this?" to be reproducible, and reading cwd afterwards would report
      // wherever the process ended up rather than where the command was given.
      const cwd = process.cwd();
      const child = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
      // `status` is null when the child never ran at all (binary not found) or
      // died on a signal. Either way the phase did not succeed, and recording a
      // 0 there would let a command that was never found seal the run healthy.
      const exit = child.status ?? 1;
      if (child.error) console.error(`${command[0]}: ${child.error.message}`);
      appendStep(opts.vault, {
        phase: opts.phase,
        command: command.join(" "),
        argv: command,
        cwd,
        exit,
        durationMs: Date.now() - startedAt,
      });
      process.exitCode = exit;
    });

  loop
    .command("fallback")
    .description(
      "after the pass: if it reached no tool, route the read-only half (ingest, check, status, debt) through the " +
        "command line — refuses every write verb, and stamps the run so it seals degraded rather than clean",
    )
    .argument("[verbs...]", "which of ingest, check, status, debt to run (default: all four, in that order); any other name is refused")
    .option("--vault <dir>", VAULT_OPTION_HELP)
    .action(async (verbs: string[], opts: { vault: string }) => {
      /*
       * The decision is the loop's, read off the vault's own trace: zero tool
       * calls since the run opened means the MCP surface was absent, and that is
       * the only condition under which this runs. The pass is never asked. See
       * `src/loop/fallback.ts` for the three properties this has to hold, and
       * `src/loop/degraded.ts` for why the fallback's own calls do not count.
       */
      const outcome = await runFallback(opts.vault, verbs);
      switch (outcome.kind) {
        case "refused":
          for (const line of fallbackRefusalReport(outcome.refused)) console.error(line);
          process.exitCode = LOOP_EXIT.fallbackRefused;
          return;
        case "no-open-run":
          console.error("not falling back: no open loop run — run `ost-agent loop start` first.");
          process.exitCode = 1;
          return;
        case "vault-not-ready":
          console.error(`not falling back: ${outcome.message}`);
          process.exitCode = 1;
          return;
        case "not-needed":
          console.log(
            `not falling back: ${outcome.passToolCalls} tool call(s) were traced since this run opened — the MCP surface was present.`,
          );
          return;
        case "already-fell-back":
          console.log(`already fell back this run at ${outcome.record.at} — the verbs are not run twice.`);
          return;
        case "ran": {
          for (const line of fallbackBanner(outcome.record, outcome.outputs.map((o) => o.verb))) console.error(line);
          for (const out of outcome.outputs) {
            console.log(`── fallback ${out.verb} (${out.tool}) ──`);
            console.log(out.text);
          }
          // A verb that threw is reported in the record and on the screen, and
          // the exit code says so — the check phase that follows is the gate, and
          // a wrapper that wants to continue past a failed report can.
          if (outcome.record.verbs.some((v) => !v.ok)) process.exitCode = 1;
          return;
        }
      }
    });

  loop
    .command("health")
    .description("report when this vault's loop last fired and what is holding it, if anything (read-only; decides nothing)")
    .option("--vault <dir>", VAULT_OPTION_HELP)
    .action((opts: { vault: string }) => {
      /*
       * A REPORTER, deliberately separate from `due`.
       *
       * `due` answers "may I fire?" — it is the discovery loop's question, it is
       * single-tenant, and a second loop asking it reads as that loop claiming
       * the window. This answers a different question that anyone may ask:
       * what is the state of the vault's loop right now?
       *
       * It exists because the build loop was telling the operator "the discovery
       * loop is working through exactly that queue. No action needed" — hourly,
       * on a vault whose discovery loop had not fired for 21 hours because it was
       * over its spend ceiling. That sentence was never checked against anything.
       * A reassurance nobody measured is worse than no reassurance, because it
       * spends the operator's trust in the channel to hide the one fact they
       * needed.
       *
       * Never sets a non-zero exit code, whatever it finds. A blocked loop is not
       * this command failing, and a caller reading the exit code would have to
       * treat "discovery is paused" as its own error.
       */
      const config = loadConfig(opts.vault);
      const runs = readRuns(opts.vault);
      const now = Date.now();

      const last = runs[0];
      if (!last) {
        console.log("last-fired: never");
      } else {
        const ageMin = Math.floor((now - new Date(last.startedAt).getTime()) / 60_000);
        console.log(`last-fired: ${last.startedAt} (${ageMin} minute(s) ago, ${last.verdict ?? "unsealed"})`);
        // The verdict word alone would send the reader back to the ledger to find
        // out what was missing, and this command exists because the reader does not
        // go and look. On stdout with the rest of the report: this is a reporter,
        // and a `degraded` line here is information rather than an alarm.
        for (const line of degradedReport(last.degradations ?? [])) console.log(line);
        // What that firing was aimed at, off its own record rather than off the
        // vault's current config. Those are the same string most of the time and
        // the report is worth nothing on the day they are not — an operator
        // asking "is it still pointed where I left it" is asking about the run,
        // and the vault answers only about now.
        for (const line of goalContractReport(last.goal)) console.log(line);
      }

      const stall = assessStall(runs);
      if (stall.stalled) console.log(`stalled: ${stall.reason}`);

      const ceiling = ceilingOf(opts.vault, config.loop?.spend);
      const spend = checkCeiling(
        ceiling,
        ceiling
          ? measureFiring(ceiling.sessionsDir, { vaultDir: opts.vault, sinceMs: now - ceiling.windowHours * HOUR_MS })
          : undefined,
      );
      // `blocked:` / `blocking: none` are the two spellings a caller greps for,
      // so the line is stable even as the reasons behind it change.
      console.log(spend.ok ? "blocking: none" : `blocked: ${spend.reason}`);

      // The other thing that holds a firing, and the one this report was silent
      // about while it mattered: a dirty tree. `loop start` refuses it at exit
      // 14 and records nothing, so a wedged vault reads "blocking: none" above
      // for as long as the stray path sits there — seventeen hours, once, on a
      // path the firing's own check phase had written. Reported with the same
      // filter `start` applies, so the paths named are the ones a human must act
      // on and never the firing's own residue.
      const tree = workingTreeStatus(opts.vault);
      const foreign = tree.kind === "dirty" ? entriesRequiringAHuman(tree.entries) : [];
      if (tree.kind === "unknown") {
        console.log(`tree: unknown — ${tree.reason}; \`loop start\` refuses until this is resolved`);
      } else if (foreign.length > 0) {
        console.log(
          `tree: dirty — \`loop start\` refuses over ${foreign.length} path(s): ${foreign.slice(0, DIRTY_PATHS_SHOWN).join(", ")}` +
            (foreign.length > DIRTY_PATHS_SHOWN ? ` … and ${foreign.length - DIRTY_PATHS_SHOWN} more` : ""),
        );
      } else {
        console.log("tree: clean");
      }

      // Printed only for a vault that subscribed to something. A line saying
      // "update-channel: none" on every vault that never wanted one is noise, and
      // this report's whole value is that an operator reads all of it. What a
      // subscriber gets instead is the fact they cannot see any other way: which
      // version this machine is actually on, and whether one has been waiting.
      const subscription = subscriptionOf(config.loop?.updates);
      if (subscription !== null) console.log(updateStatusLine(opts.vault, subscription, now));
    });

  loop
    .command("seal")
    .description("compute the verdict from the recorded exits, append it to runs.jsonl, release the lock")
    .option(
      "--attempted <statement>",
      "what this run actually attempted, in its own words — diffed against `loop scope`'s frozen declaration, if one was made",
    )
    .option("--vault <dir>", VAULT_OPTION_HELP)
    .action((opts: { vault: string; attempted?: string }) => {
      // Observed BEFORE the seal and from the vault rather than from the firing:
      // the pass gets no say in whether it was degraded, which is the one property
      // the candidate behind this could not have if it were enforced by prose in a
      // prompt. `readOpenRun` returning null is left to `sealRun` to complain
      // about — it owns that message and there is nothing to observe anyway.
      const open = readOpenRun(opts.vault);
      const degradations = open ? observeDegradation(opts.vault, open) : [];
      // The sense census, observed against the same still-open run and from the
      // vault rather than from the firing. Derived from config and grant, so a
      // sense nothing reached for still gets a state — see src/loop/senses.ts.
      const senses = open ? observeSenses(opts.vault, open) : [];
      // Read against the run's OWN frozen record — `computeShortfall` takes no
      // "declared" argument, so nothing this command does can hand it a restated
      // scope to diff against instead. Null (never declared, or nothing attempted
      // was said) prints nothing, which `shortfallReport` treats the same way.
      const shortfall = open && opts.attempted !== undefined ? computeShortfall(opts.vault, open.runId, opts.attempted) : null;
      // The second reading of the mandate, taken now and compared against the
      // run's OWN opening stamp — `open.goal.opened`, off the marker, never a
      // text this command was handed. A firing whose outcome moved under it
      // seals with both ends on the record; one whose outcome held seals with a
      // comparison that was actually made, which is a different fact from never
      // having re-read it.
      const goal = open?.goal ? closeGoalContract(open.goal.opened, observeGoal(opts.vault)) : undefined;
      // The seal-time half of the stopping question, and both readings are taken
      // from the vault rather than from the firing: how much evidence is on disk
      // now (new input during the pass voids the start reading), and what this
      // firing's own commits were made of, folded by the pass-shape classifier
      // over the range this run's OWN `headBefore` opens. A firing that never
      // recorded a head leaves `shape` undefined, and an unreadable shape enforces
      // nothing — see `idleBreach` for why fail-open is the right asymmetry here.
      const stopCondition = open?.stopCondition
        ? {
            evidenceAtSeal: countEvidence(opts.vault),
            ...(() => {
              const shape = observePassShape(commitSubjectsSince(opts.vault, open.headBefore));
              return shape ? { shape } : {};
            })(),
          }
        : undefined;
      const sealed = sealRun(opts.vault, {
        headAfter: gitHead(opts.vault),
        degradations,
        ...(goal ? { goal } : {}),
        ...(stopCondition ? { stopCondition } : {}),
      });
      const released = releaseFiringLock(opts.vault, { runId: sealed.runId });
      console.log(`loop run ${sealed.runId} sealed: ${sealed.verdict}`);
      for (const s of sealed.steps) console.log(`  ${s.exit === 0 ? "✓" : "✗"} ${s.phase} (exit ${s.exit})`);
      // On stdout with the rest of the closing report, and UNCONDITIONALLY —
      // unlike the degraded banner below, which speaks only when something is
      // already known to be wrong. The firing this is for is the one that looks
      // fine: a census that appeared only beside a degradation could never tell
      // an operator that a healthy-sealing pass spent the night unable to see the
      // product, and that is the pass whose output nobody knew to distrust.
      for (const line of senseCensusReport(senses)) console.log(line);
      // On stdout too, and unconditionally when `--attempted` was given: the
      // report is a fact printed next to the result, not an alarm, and the node
      // it implements is explicit that it has no teeth — it must not be buried on
      // stderr as though a shortfall were itself a failure.
      for (const line of shortfallReport(shortfall)) console.log(line);
      // Unconditionally, like the census: a drift line that only ever appeared
      // when something had moved could not be trusted to be silent because the
      // mandate held. Loud on stderr when it did move or could not be compared —
      // that is the one line in this report a cron's mail must not bury.
      for (const line of goalContractReport(goal)) {
        if (goalDriftIsLoud(goal)) console.error(line);
        else console.log(line);
      }
      // FIRST on stderr, above the degraded banner, because a firing that failed
      // and a firing that was degraded are different facts and only one of them
      // means "do not trust this run". The banner below used to be the ONLY thing
      // an unhealthy firing said on stderr, so a cron mail for a pass that died on
      // an auth error read `⚠ degraded` and nothing else — the exact substitution
      // this loop exists to prevent, made by the report rather than by the code.
      // The checklist on stdout stays where it is: it is the whole ledger, and this
      // is the one line of it a reader who reads nothing else must get.
      for (const line of failureSummary(sealed, lastNodeTouchedSince(opts.vault, sealed.startedAt))) {
        console.error(line);
      }
      // Unconditionally, like the census and the goal contract: a line that spoke
      // only when the condition had been breached could not be trusted to be
      // silent because it had not been. Loud on stderr only for the breach — the
      // ordinary "held, and this firing authored nothing" is the outcome this
      // whole mechanism wants and must not read as an alarm.
      for (const line of stopConditionReport(sealed.stopCondition)) {
        if (line.startsWith("✗")) console.error(line);
        else console.log(line);
      }
      // On stderr, beside the stall escalation, because a cron mails stderr and
      // this is the line that must not be scrolled past. Printed whenever a
      // degradation was observed — including on an `unhealthy` firing, where it is
      // the difference between "the check failed" and "the check failed with
      // nothing behind it".
      for (const line of degradedReport(degradations)) console.error(line);
      if (!released) {
        console.error("note: the firing lock is no longer this run's — it was broken as stale and retaken. Left alone.");
      }
      // Seal is the exact point where a `no-op` firing reports and exits 0 —
      // where, one at a time, a dead vault reads like a productive one. The
      // just-sealed run is already appended, so this fold sees it. Escalation is
      // a loud stderr line and nothing more: it does not gate the next firing and
      // does not require a human to clear (a later healthy firing does that on its
      // own), so it stays off the exit code, which reports THIS firing's verdict.
      const stall = assessStall(readRuns(opts.vault));
      if (stall.stalled) console.error(`⚠ stalled: ${stall.reason}`);
      if (sealed.verdict === "unhealthy" || sealed.verdict === "crashed") process.exitCode = 1;
      else if (sealed.verdict === "degraded") process.exitCode = LOOP_EXIT.degraded;
    });
}
