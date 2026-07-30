/**
 * `ost-agent loop …` — the unattended firing's deterministic bookends.
 *
 * Four commands, in the order a firing uses them:
 *
 *   due    may this vault fire right now? cadence + spend, both fail-closed.
 *   start  take the overlap lock and open a health record.
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
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../config/load.js";
import type { LoopConfig } from "../config/schema.js";
import { evaluateCadence, parseCadence } from "../loop/cadence.js";
import { detectLaunderedExit, launderedExitMessage } from "../loop/exitLaundering.js";
import { appendStep, readRuns, sealRun, startRun } from "../loop/health.js";
import { acquireFiringLock, releaseFiringLock, stampFiringLock } from "../loop/lock.js";
import { checkCeiling, measureFiring, type SpendCeiling } from "../loop/spend.js";
import { gitHead } from "../loop/state.js";
import { VERSION } from "../index.js";

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
  locked: 15,
} as const;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Expand a leading `~` before resolving, because the only path an operator will
 * ever write here starts with one: Claude Code keeps transcripts under
 * `~/.claude/projects/<slug>`, and that is what `autonomous-pass.sh`'s header
 * tells them to paste. `path.resolve(vaultDir, "~/x")` silently produces
 * `<vault>/~/x`, which cannot exist — so the loop read an unmeasurable spend and
 * refused to fire, forever, on the one configuration the documentation hands out.
 * A refusal nobody can clear by following the instructions is R2's shape.
 */
function resolveSessionsDir(vaultDir: string, declared: string): string {
  if (declared === "~") return os.homedir();
  if (declared.startsWith("~/")) return path.join(os.homedir(), declared.slice(2));
  return path.resolve(vaultDir, declared);
}

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
    .option("--vault <dir>", "vault directory", ".")
    .action((opts: { vault: string }) => {
      const config = loadConfig(opts.vault);
      const now = Date.now();
      const runs = readRuns(opts.vault);

      // Printed before any gate, so a vault that has never fired says so on
      // every invocation instead of being silent about it.
      const last = runs[0];
      console.log(last ? `last record: ${last.verdict ?? "unsealed"} at ${last.startedAt}` : "last record: none — this vault has never fired");

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
    });

  loop
    .command("start")
    .description("take the overlap lock and open a health record (sweeps any crashed prior run first)")
    .option("--vault <dir>", "vault directory", ".")
    .option(
      "--holder-pid <pid>",
      "pid of the process that owns the whole firing (defaults to this command's parent)",
    )
    .action((opts: { vault: string; holderPid?: string }) => {
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
    .option("--vault <dir>", "vault directory", ".")
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
    .command("seal")
    .description("compute the verdict from the recorded exits, append it to runs.jsonl, release the lock")
    .option("--vault <dir>", "vault directory", ".")
    .action((opts: { vault: string }) => {
      const sealed = sealRun(opts.vault, { headAfter: gitHead(opts.vault) });
      const released = releaseFiringLock(opts.vault, { runId: sealed.runId });
      console.log(`loop run ${sealed.runId} sealed: ${sealed.verdict}`);
      for (const s of sealed.steps) console.log(`  ${s.exit === 0 ? "✓" : "✗"} ${s.phase} (exit ${s.exit})`);
      if (!released) {
        console.error("note: the firing lock is no longer this run's — it was broken as stale and retaken. Left alone.");
      }
      if (sealed.verdict === "unhealthy" || sealed.verdict === "crashed") process.exitCode = 1;
    });
}
