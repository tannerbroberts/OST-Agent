#!/usr/bin/env node
/**
 * OST-Agent CLI: init / run / schedule / status.
 *
 *   ost-agent init [folder] --outcome "..."   create/adopt a vault
 *   ost-agent run <process> [--vault DIR]     one bounded pass
 *   ost-agent schedule [--vault DIR]          supervisor: cron + triggers
 *   ost-agent status [--vault DIR]            read-only tree summary
 */
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { Cron } from "croner";
import { buildPassContext } from "../runner/context.js";
import { initVault } from "../runner/init.js";
import { runPass } from "../runner/pass.js";
import { anthropicDriver } from "../runner/driver.js";
import { getProcess, PROCESSES } from "../processes/registry.js";
import { VERSION } from "../index.js";

async function prompt(question: string, fallback?: string): Promise<string> {
  if (!process.stdin.isTTY) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${question} (no TTY to prompt — pass it as a flag/argument)`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

const program = new Command();
program.name("ost-agent").description("Autonomous, append-only Opportunity Solution Tree agent").version(VERSION);

program
  .command("init")
  .argument("[folder]", "vault folder (created if absent; prompted if omitted)")
  .option("-o, --outcome <text>", "the single business/product outcome (human-set)")
  .action(async (folder: string | undefined, opts: { outcome?: string }) => {
    const dir = folder ?? (await prompt("Vault folder name: "));
    if (!dir) throw new Error("a vault folder is required");
    const outcome = opts.outcome ?? (await prompt("Desired product outcome (the tree's root): "));
    if (!outcome) throw new Error("an outcome is required — it is the single #Outcome, human-set");
    const r = await initVault(dir, outcome);
    console.log(`Initialized vault at ${r.dir}`);
    console.log(`  git: ${r.gitInitialized ? "initialized" : "already present"}`);
    console.log(`  outcome node: ${r.outcomeCreated ? "created" : "already present"}`);
    console.log(`\nDrop notes into ${path.join(dir, "inbox")}/ and run:  ost-agent run P1_ingest --vault ${dir}`);
  });

program
  .command("run")
  .argument("<process>", `process id (${PROCESSES.map((p) => p.id).join(", ")})`)
  .option("--vault <dir>", "vault directory", ".")
  .action(async (processId: string, opts: { vault: string }) => {
    const proc = getProcess(processId);
    if (!proc) throw new Error(`unknown process "${processId}". Known: ${PROCESSES.map((p) => p.id).join(", ")}`);
    const ctx = buildPassContext(opts.vault);
    const outcome = await runPass(proc, ctx, anthropicDriver());
    console.log(`${proc.id} ${proc.title}: created=${outcome.result.created} linked=${outcome.result.linked} annotated=${outcome.result.annotated} evidence=${outcome.result.evidence}`);
    if (outcome.error) console.log(`  error: ${outcome.error}`);
    console.log(`  ${outcome.committed ? `committed ${outcome.sha.slice(0, 8)}` : "nothing to commit"}; done=${outcome.done}`);
  });

program
  .command("status")
  .option("--vault <dir>", "vault directory", ".")
  .action((opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    const tree = ctx.vault.readTree();
    const byLayer = (l: string) => tree.filter((n) => n.layer === l).length;
    const unvalidated = tree.filter((n) => n.status === "unvalidated").length;
    console.log(`Vault: ${ctx.dir}`);
    console.log(`Outcome: ${ctx.config.outcome}`);
    console.log(`Nodes: ${tree.length}  (Outcome ${byLayer("Outcome")}, Opportunity ${byLayer("Opportunity")}, Solution ${byLayer("Solution")}, AssumptionTest ${byLayer("AssumptionTest")})`);
    console.log(`Unvalidated (agent-ideated, awaiting review): ${unvalidated}`);
    printLastRuns(ctx.dir);
  });

program
  .command("schedule")
  .option("--vault <dir>", "vault directory", ".")
  .action((opts: { vault: string }) => {
    const dir = path.resolve(opts.vault);
    const ctx0 = buildPassContext(dir);
    console.log(`OST-Agent supervisor watching ${dir}. Ctrl-C to stop.`);

    const fire = async (id: string) => {
      const proc = getProcess(id);
      if (!proc) return;
      // rebuild context each fire so config/state changes are picked up
      const ctx = buildPassContext(dir);
      const outcome = await runPass(proc, ctx, anthropicDriver()).catch((e) => {
        console.error(`${id} failed:`, e instanceof Error ? e.message : e);
        return null;
      });
      if (!outcome) return;
      console.log(`[${new Date().toISOString()}] ${id}: created=${outcome.result.created} committed=${outcome.committed}`);
      // fire downstream `after:<id>` triggers
      for (const [depId, cfg] of Object.entries(ctx.config.processes)) {
        if ((cfg.triggers ?? []).includes(`after:${id}`)) await fire(depId);
      }
    };

    for (const [id, cfg] of Object.entries(ctx0.config.processes)) {
      if (cfg.cron) {
        new Cron(cfg.cron, () => void fire(id));
        console.log(`  scheduled ${id} @ "${cfg.cron}"`);
      }
    }

    // inbox:new — watch the inbox and fire ingest on change
    const inboxDir = path.join(dir, ctx0.config.adapters.inbox.path);
    if (ctx0.config.adapters.inbox.enabled && fs.existsSync(inboxDir)) {
      let debounce: NodeJS.Timeout | null = null;
      fs.watch(inboxDir, () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => void fire("P1_ingest"), 1500);
      });
      console.log(`  watching ${inboxDir} for new notes (fires P1_ingest)`);
    }
  });

function printLastRuns(dir: string): void {
  const runsDir = path.join(dir, ".ost-agent", "runs");
  if (!fs.existsSync(runsDir)) return;
  const latest = new Map<string, { at: string }>();
  for (const f of fs.readdirSync(runsDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const e = JSON.parse(fs.readFileSync(path.join(runsDir, f), "utf8")) as { processId: string; at: string };
      const prev = latest.get(e.processId);
      if (!prev || e.at > prev.at) latest.set(e.processId, { at: e.at });
    } catch {
      /* skip unreadable run log */
    }
  }
  if (latest.size) {
    console.log("Last runs:");
    for (const [id, { at }] of [...latest].sort()) console.log(`  ${id}: ${at}`);
  }
}

program.parseAsync().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
