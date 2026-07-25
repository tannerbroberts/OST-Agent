#!/usr/bin/env node
/**
 * OST-Agent CLI: init / run / schedule / status.
 *
 *   ost-agent init [folder] --outcome "..."   create/adopt a vault
 *   ost-agent run <process> [--vault DIR]     one bounded pass
 *   ost-agent schedule [--vault DIR]          supervisor: cron + triggers
 *   ost-agent status [--vault DIR]            read-only tree summary
 *   ost-agent result "<test>" ...             record a human-run test's outcome
 *   ost-agent debt [--vault DIR]              evidence each solution still owes
 *   ost-agent lanes [--vault DIR]             assumption tests by the human minutes they cost
 *   ost-agent lane "<test>" --set <lane> ...  classify one test into a lane
 *   ost-agent gate "<solution>" [--vault DIR] block building against untested assumptions
 *   ost-agent friction "<note>" [--vault DIR] file friction at the point of pain
 *   ost-agent mcp [--vault DIR]               stdio MCP server (no API key needed)
 */
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { Cron } from "croner";
import { buildPassContext } from "../runner/context.js";
import { initVault } from "../runner/init.js";
import { runPass } from "../runner/pass.js";
import { failed, lastFailedRun, lastRunPerProcess, readRunJournals, type RunJournalEntry } from "../runner/journal.js";
import { runTool } from "../runner/tool.js";
import { setOutcome } from "../runner/set-outcome.js";
import { anthropicDriver } from "../runner/driver.js";
import { getProcess, PROCESSES } from "../processes/registry.js";
import { checkInvariants } from "../eval/invariants.js";
import { computeEvidenceDebt, gateSolution } from "../eval/evidence-debt.js";
import { BELIEVABILITY_LADDER, believabilityRollup, type RungId } from "../knowledge/believability.js";
import { recordResult, VERDICTS, type Verdict } from "../ost/results.js";
import { setLane, suggestCaution, triageLanes } from "../ost/lanes.js";
import { laneDef, LANES, type LaneId } from "../knowledge/lanes.js";
import { fileFriction, FRICTION_KINDS, type FrictionFilingKind } from "../adapters/friction.js";
import { ALLOWED_TOOL_NAMES } from "../security/policy.js";
import { createOstMcpServer, assertVaultReady, MCP_TOOL_NAMES } from "../mcp/server.js";
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
  .option("-o, --outcome <text>", "the steering mandate the system optimizes (human-set)")
  .option("-t, --title <label>", "stable label for the root node (default: folder name)")
  .action(async (folder: string | undefined, opts: { outcome?: string; title?: string }) => {
    const dir = folder ?? (await prompt("Vault folder name: "));
    if (!dir) throw new Error("a vault folder is required");
    const outcome = opts.outcome ?? (await prompt("Steering mandate / outcome (the tree's root): "));
    if (!outcome) throw new Error("an outcome is required — it is the human-set mandate the system optimizes");
    const r = await initVault(dir, outcome, opts.title);
    console.log(`Initialized vault at ${r.dir}`);
    console.log(`  git: ${r.gitInitialized ? "initialized" : "already present"}`);
    console.log(`  outcome node: ${r.outcomeCreated ? "created" : "already present"}`);
    const inboxPath = buildPassContext(r.dir).config.adapters.inbox.path;
    console.log(`\nDrop notes into ${path.join(dir, inboxPath)}/ and run:  ost-agent run P1_ingest --vault ${dir}`);
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
    console.log(`  ${outcome.committed ? `committed ${outcome.sha.slice(0, 8)}` : "nothing to commit"}; done=${outcome.done}`);
    if (outcome.error) {
      // A partial pass (work committed, then an error) still fails: one exit code
      // that means "do not trust this run" is the contract cron and CI already speak.
      // Whatever landed before the error is in the commit above and in the journal.
      console.error(`${proc.id} FAILED: ${outcome.error}`);
      process.exitCode = 1;
    }
  });

program
  .command("set-outcome")
  .description("retune the steering mandate (human-only; prior mandate kept in the root node's history)")
  .argument("[text]", "the new mandate (prompted if omitted)")
  .option("--vault <dir>", "vault directory", ".")
  .action(async (text: string | undefined, opts: { vault: string }) => {
    const next = text ?? (await prompt("New steering mandate: "));
    const r = await setOutcome(opts.vault, next);
    console.log(`Retuned "${r.title}" — committed ${r.sha.slice(0, 8)}`);
    console.log(`  prior mandate preserved in the root node's ## History`);
  });

program
  .command("tool")
  .description("invoke one allowlisted, append-only tool (for an agent driving the tree directly)")
  .argument("<name>", `tool name (${ALLOWED_TOOL_NAMES.join(", ")})`)
  .option("--vault <dir>", "vault directory", ".")
  .option("--input <json>", "JSON input for the tool", "{}")
  .action(async (name: string, opts: { vault: string; input: string }) => {
    let input: unknown;
    try {
      input = JSON.parse(opts.input);
    } catch {
      throw new Error(`--input is not valid JSON: ${opts.input}`);
    }
    console.log(await runTool(opts.vault, name, input));
  });

program
  .command("friction")
  .description("file one line of friction at the point of pain (lands in the vault inbox as evidence)")
  .argument("<note>", "what went wrong, in one line")
  .option("-k, --kind <kind>", `one of: ${FRICTION_KINDS.join(", ")}`, "blocked")
  .option("-c, --context <text>", "what you were doing, or what you wish existed")
  .option("-s, --source <text>", "who is filing (loop, process, session)")
  .option("--vault <dir>", "vault directory", process.env.OST_VAULT ?? ".")
  .action((note: string, opts: { kind: string; context?: string; source?: string; vault: string }) => {
    const written = fileFriction(opts.vault, {
      kind: opts.kind as FrictionFilingKind,
      note,
      context: opts.context,
      source: opts.source,
    });
    console.log(`filed ${path.basename(written)}`);
  });

program
  .command("check")
  .description("run the deterministic tree invariants (no model needed)")
  .option("--vault <dir>", "vault directory", ".")
  .action((opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    const violations = checkInvariants(ctx.vault.readTree());
    if (violations.length === 0) {
      console.log("invariants: PASS (0 violations)");
    } else {
      console.log(`invariants: FAIL (${violations.length} violation(s))`);
      for (const v of violations) console.log(`  ✗ [${v.rule}] ${v.node ? `"${v.node}": ` : ""}${v.detail}`);
      process.exitCode = 1;
    }
  });

program
  .command("result")
  .description("record what happened when a human ran an assumption test (humans only — never the agent)")
  .argument("<test>", "title of the AssumptionTest node that was run")
  .requiredOption("-v, --verdict <verdict>", `one of: ${VERDICTS.join(", ")}`)
  .requiredOption("-n, --note <text>", "what happened, in the runner's words")
  .requiredOption("-b, --by <who>", "who ran it — a result with no name on it cannot be trusted")
  .option("-e, --evidence <rung>", `raise the test's rung to what the run produced (${BELIEVABILITY_LADDER.map((r) => r.id).join(", ")})`)
  .option("--vault <dir>", "vault directory", ".")
  .action((test: string, opts: { verdict: string; note: string; by: string; evidence?: string; vault: string }) => {
    const line = recordResult(opts.vault, {
      test,
      verdict: opts.verdict as Verdict,
      note: opts.note,
      by: opts.by,
      evidence: opts.evidence as RungId | undefined,
    });
    console.log(`recorded on "${test}": ${line}`);
  });

program
  .command("debt")
  .description("what each solution owes in evidence before anyone builds it (no model needed)")
  .option("--vault <dir>", "vault directory", ".")
  .action((opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    const debt = computeEvidenceDebt(ctx.vault.readTree());
    const t = debt.totals;
    console.log(`Solutions: ${t.solutions}  (untested ${t.untested}, proposed-only ${t.proposed}, tested ${t.tested})`);
    for (const s of debt.solutions) {
      const detail =
        s.state === "tested"
          ? `${s.testsRun}/${s.testsProposed} test(s) with results`
          : s.state === "proposed"
            ? `${s.testsProposed} proposed, none run`
            : "no assumption test";
      console.log(`  [${s.state}] ${s.title} — ${detail}`);
    }
    console.log(
      "\nMechanical only: this counts whether ANY assumption beneath a solution recorded a result.\n" +
        "Whether the RIGHT (riskiest) assumption was tested is a human judgement.",
    );
  });

program
  .command("lanes")
  .description("assumption tests grouped by the human minutes they actually cost")
  .option("--vault <dir>", "vault directory", ".")
  .option("--runnable", "print only the compute-only backlog, one title per line (for scripting)")
  .action((opts: { vault: string; runnable?: boolean }) => {
    const ctx = buildPassContext(opts.vault);
    const tree = ctx.vault.readTree();
    const t = triageLanes(tree);

    if (opts.runnable) {
      for (const title of t.runnable) console.log(title);
      return;
    }

    console.log(`Assumption tests: ${t.totals.tests}  (classified ${t.totals.labelled}, unclassified ${t.totals.unlabelled})`);
    for (const lane of LANES) {
      const titles = t.byLane[lane.id];
      const marker = lane.computeMayRun ? "compute may run" : "needs a person";
      console.log(`\n[${lane.id}] ${titles.length} — ${marker}`);
      for (const title of titles) console.log(`  - ${title}`);
    }

    if (t.unlabelled.length > 0) {
      console.log(`\n[unclassified] ${t.unlabelled.length} — treated as NOT runnable by compute`);
      for (const title of t.unlabelled) {
        const node = tree.find((n) => n.title === title);
        const hint = node ? suggestCaution(node) : undefined;
        console.log(`  - ${title}${hint ? `  ⚠ likely ${hint.lane}: ${hint.why}` : ""}`);
      }
    }

    console.log(`\nRunnable right now (compute-only, no result yet): ${t.runnable.length}`);
    for (const title of t.runnable) console.log(`  - ${title}`);
    console.log(
      "\nA lane is a judgement, not a measurement. Unclassified never means safe to automate,\n" +
        "and the ⚠ hints only ever point AT a person — the permissive call is always a human's.",
    );
  });

program
  .command("lane")
  .description("classify one assumption test into a lane (attributed, recorded in History)")
  .argument("<test>", "title of the AssumptionTest node")
  .requiredOption("-s, --set <lane>", `one of: ${LANES.map((l) => l.id).join(", ")}`)
  .requiredOption("-b, --by <who>", "who made the call — an unauditable label is worse than none")
  .requiredOption("-w, --why <text>", "why this lane, in the classifier's words")
  .option("--vault <dir>", "vault directory", ".")
  .action((test: string, opts: { set: string; by: string; why: string; vault: string }) => {
    const line = setLane(opts.vault, { test, lane: opts.set as LaneId, by: opts.by, why: opts.why });
    console.log(`classified "${test}": ${line}`);
    const def = laneDef(opts.set as LaneId);
    console.log(def.computeMayRun ? "  an unattended pass MAY now run this test." : "  a person is still required.");
  });

program
  .command("gate")
  .description("refuse to build against untested assumptions: exits non-zero unless a solution has a tested assumption")
  .argument("<solution>", "title of the Solution node about to be built")
  .option("--vault <dir>", "vault directory", ".")
  .action((solution: string, opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    const verdict = gateSolution(ctx.vault.readTree(), solution);
    if (verdict.cleared) {
      console.log(`gate: CLEARED — ${verdict.reason}`);
      return;
    }
    console.error(`gate: BLOCKED — ${verdict.reason}`);
    process.exitCode = 1;
  });

program
  .command("status")
  .option("--vault <dir>", "vault directory", ".")
  .action((opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    const journals = readRunJournals(ctx.dir);
    printLastFailure(journals);
    const tree = ctx.vault.readTree();
    const byLayer = (l: string) => tree.filter((n) => n.layer === l).length;
    const unvalidated = tree.filter((n) => n.status === "unvalidated").length;
    console.log(`Vault: ${ctx.dir}`);
    console.log(`Outcome: ${ctx.config.outcome}`);
    console.log(`Nodes: ${tree.length}  (Outcome ${byLayer("Outcome")}, Opportunity ${byLayer("Opportunity")}, Solution ${byLayer("Solution")}, AssumptionTest ${byLayer("AssumptionTest")})`);
    console.log(`Unvalidated (agent-ideated, awaiting review): ${unvalidated}`);
    const rollup = believabilityRollup(tree);
    const perRung = BELIEVABILITY_LADDER.map((r) => `${r.id} ${rollup.counts[r.id]}`).join(", ");
    console.log(`Believability: ${perRung}${rollup.unlabelled ? `, unlabelled ${rollup.unlabelled}` : ""}`);
    console.log(`  the tree as a whole rests on its weakest rung: ${rollup.weakest}`);
    printLastRuns(journals);
  });

program
  .command("mcp")
  .description("run a stdio MCP server exposing the append-only OST tools (no API key needed)")
  .option("--vault <dir>", "vault directory", process.env.OST_VAULT ?? ".")
  .action(async (opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    assertVaultReady(ctx);
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const server = createOstMcpServer(ctx);
    await server.connect(new StdioServerTransport());
    // stdout is the JSON-RPC channel — log only to stderr.
    console.error(`ost-agent mcp serving ${ctx.dir} over stdio. Tools: ${MCP_TOOL_NAMES.join(", ")}`);
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
      if (outcome.error) {
        // The supervisor stays up (that is its job), but the failure goes to stderr
        // where a wrapper, launchd, or a log scraper can see it.
        console.error(`[${new Date().toISOString()}] ${id} FAILED: ${outcome.error}`);
      }
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

/**
 * Failure leads. An operator glancing at `status` after a silent overnight no-op
 * should learn in five seconds that something died — before any node counts.
 */
function printLastFailure(journals: RunJournalEntry[]): void {
  const failure = lastFailedRun(journals);
  if (!failure) return;
  console.log(`⚠ Last run FAILED — ${failure.processId} at ${failure.at}`);
  console.log(`  ${failure.error}`);
  console.log(`  journal: .ost-agent/runs/${failure.file}\n`);
}

function printLastRuns(journals: RunJournalEntry[]): void {
  const latest = lastRunPerProcess(journals);
  if (!latest.length) return;
  console.log("Last runs:");
  for (const e of latest) console.log(`  ${e.processId}: ${e.at} ${failed(e) ? "FAILED" : "ok"}`);
}

program.parseAsync().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
