/**
 * `ost-agent loop …` — the unattended firing's deterministic bookends.
 *
 * Four commands, in the order a firing uses them:
 *
 *   due    may this vault fire right now? cadence + spend, both fail-closed.
 *   start  refuse a dirty vault, take the overlap lock, open a health record.
 *   step   run one phase, record the exit code it actually produced.
 *   seal   compute the verdict from what was recorded, append it, unlock.
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
import { appendStep, readOpenRun, readRuns, sealRun, startRun } from "../loop/health.js";
import { assessStall } from "../loop/stall.js";
import { acquireFiringLock, releaseFiringLock, stampFiringLock } from "../loop/lock.js";
import { checkCeiling, measureFiring, type SpendCeiling } from "../loop/spend.js";
import { formatQuestionBudget, measureInterruptions, type QuestionBudget } from "../loop/questions.js";
import { gitHead, workingTreeStatus, type VaultTreeStatus } from "../loop/state.js";
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
 * **Why this prefix and not `.ost-agent/`.** The dot-folder also holds `inbox/`
 * (fed by an untrusted builder under DEC-1), `evidence/`, `state/` and `runs/` —
 * a leftover in any of those is exactly the file this gate exists to stop.
 * `usage/` is exempted because it is the one directory demonstrably written by a
 * path that never commits; everything else stays fail-closed, so a future
 * non-committing writer lands on a refusal and someone has to argue for it here.
 */
const FIRING_TRACE_PREFIX = ".ost-agent/usage/";

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
 * may begin: see `FIRING_TRACE_PREFIX` for what is filtered and why.
 *
 * Exported because it is the boundary of the criterion, and a boundary worth
 * stating is worth pinning.
 */
export function entriesRequiringAHuman(entries: string[]): string[] {
  return entries.filter((e) => !porcelainPath(e).startsWith(FIRING_TRACE_PREFIX));
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
 * `FIRING_TRACE_PREFIX`, and `test/loop/firing-residue.test.ts` for the wedge run
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
    .description("may this vault fire now? (cadence + spend ceiling; both refuse when undeclared)")
    .option("--vault <dir>", VAULT_OPTION_HELP)
    .action((opts: { vault: string }) => {
      const config = loadConfig(opts.vault);
      const now = Date.now();
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
    .action((opts: { vault: string; holderPid?: string }) => {
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
      // `FIRING_TRACE_PREFIX`. `unknown` is never filtered: there are no entries
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
          `carrying ${tree.entries.length} uncommitted usage-trace path(s) — the vault's own call record, swept into the next commit.`,
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
      const lock = acquireFiringLock(opts.vault, {
        ttlMs,
        ...(Number.isInteger(holderPid) && holderPid > 0 ? { holderPid } : {}),
      });
      if (!lock.ok) {
        console.error(`not firing: ${lock.reason}`);
        process.exitCode = LOOP_EXIT.locked;
        return;
      }
      if (lock.broke) console.error(`broke a stale firing lock — ${lock.broke.why}`);

      // If this throws, the firing does not happen. That is the point: a firing
      // nobody can read afterwards would leave the cadence window unconsumed and
      // the vault firing forever with nothing on record.
      const opened = startRun(opts.vault, {
        loopVersion: VERSION,
        cliVersion: VERSION,
        headBefore: gitHead(opts.vault),
      });
      stampFiringLock(opts.vault, lock.record, opened.runId);
      console.log(`loop run ${opened.runId} open`);
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
    });

  loop
    .command("seal")
    .description("compute the verdict from the recorded exits, append it to runs.jsonl, release the lock")
    .option("--vault <dir>", VAULT_OPTION_HELP)
    .action((opts: { vault: string }) => {
      // Observed BEFORE the seal and from the vault rather than from the firing:
      // the pass gets no say in whether it was degraded, which is the one property
      // the candidate behind this could not have if it were enforced by prose in a
      // prompt. `readOpenRun` returning null is left to `sealRun` to complain
      // about — it owns that message and there is nothing to observe anyway.
      const open = readOpenRun(opts.vault);
      const degradations = open ? observeDegradation(opts.vault, open) : [];
      const sealed = sealRun(opts.vault, { headAfter: gitHead(opts.vault), degradations });
      const released = releaseFiringLock(opts.vault, { runId: sealed.runId });
      console.log(`loop run ${sealed.runId} sealed: ${sealed.verdict}`);
      for (const s of sealed.steps) console.log(`  ${s.exit === 0 ? "✓" : "✗"} ${s.phase} (exit ${s.exit})`);
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
