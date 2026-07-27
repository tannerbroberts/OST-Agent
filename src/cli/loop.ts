/**
 * `ost-agent loop …` — the self-bootstrapping loop's CLI surface.
 *
 * `step` is the deterministic bookend: it wraps whatever command a phase runs,
 * records the observed exit code into the open run, and propagates that exit
 * code. `seal` re-runs the tree invariants itself before computing the verdict,
 * so a run cannot end healthy over a broken tree. Nothing here accepts a
 * verdict from the caller.
 */
import { spawnSync } from "node:child_process";
import type { Command } from "commander";
import { buildPassContext } from "../runner/context.js";
import { checkInvariants } from "../eval/invariants.js";
import { appendStep, readRuns, sealRun, startRun, updateOpenRun } from "../loop/health.js";
import { VERSION } from "../index.js";

export function registerLoopCommands(program: Command): void {
  const loop = program.command("loop").description("self-bootstrapping loop: prompt, health bookends, fleet review");

  loop
    .command("start")
    .description("open a health-tracked loop run (sweeps any crashed prior run first)")
    .option("--vault <dir>", "vault directory", ".")
    .action((opts: { vault: string }) => {
      const runs = readRuns(opts.vault);
      const opened = startRun(opts.vault, { loopVersion: VERSION, cliVersion: VERSION });
      console.log(`loop run ${opened.runId} open`);
      const last = runs[0];
      if (last) console.log(`  last sealed run: ${last.verdict} (${last.startedAt}, v${last.loopVersion})`);
    });

  loop
    .command("step")
    .description("run one phase command and record its observed exit code")
    .requiredOption("-p, --phase <id>", "phase id (sense, decide, build, ost-pass, fleet, …)")
    .option("--vault <dir>", "vault directory", ".")
    .argument("<command...>", "the command to run (after --)")
    .action((command: string[], opts: { phase: string; vault: string }) => {
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
    .command("decide")
    .description("record the work item the tree surfaced for this run")
    .argument("<workItem>", "title of the node ost_next_work surfaced")
    .option("--vault <dir>", "vault directory", ".")
    .action((workItem: string, opts: { vault: string }) => {
      updateOpenRun(opts.vault, { workItem });
      appendStep(opts.vault, { phase: "decide", command: `decide ${JSON.stringify(workItem)}`, exit: 0, durationMs: 0 });
      console.log(`decided: ${workItem}`);
    });

  loop
    .command("seal")
    .description("run the tree invariants, compute the verdict from recorded exits, append to runs.jsonl")
    .option("--vault <dir>", "vault directory", ".")
    .action((opts: { vault: string }) => {
      const startedAt = Date.now();
      const ctx = buildPassContext(opts.vault);
      const violations = checkInvariants(ctx.vault.readTree());
      appendStep(opts.vault, {
        phase: "check",
        command: "checkInvariants",
        exit: violations.length === 0 ? 0 : 1,
        durationMs: Date.now() - startedAt,
      });
      const sealed = sealRun(opts.vault);
      console.log(`loop run ${sealed.runId} sealed: ${sealed.verdict}`);
      for (const v of violations) console.log(`  ✗ [${v.rule}] ${v.detail}`);
      if (sealed.verdict === "unhealthy" || sealed.verdict === "crashed") process.exitCode = 1;
    });
}
