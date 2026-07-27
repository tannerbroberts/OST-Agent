#!/usr/bin/env node
/**
 * OST-Agent CLI: init / run / schedule / status.
 *
 *   ost-agent init [folder] --outcome "..."   create/adopt a vault
 *   ost-agent run <process> [--vault DIR]     one bounded pass
 *   ost-agent schedule [--vault DIR]          supervisor: cron + triggers
 *   ost-agent status [--vault DIR]            read-only tree summary
 *   ost-agent result "<test>" ...             record a human-run test's outcome
 *   ost-agent debt [--vault DIR]              evidence each solution still owes + unbounded results + unfixed thresholds
 *   ost-agent lanes [--vault DIR]             assumption tests by the human minutes they cost
 *   ost-agent lanes --flag-cautious <who>     bulk: humans-required for every test naming an outside person
 *   ost-agent lane "<test>" --set <lane> ...  classify one test into a lane
 *   ost-agent gate "<solution>" [--vault DIR] block building against untested assumptions
 *   ost-agent friction "<note>" [--vault DIR] file friction at the point of pain
 *   ost-agent mcp [--vault DIR]               stdio MCP server (no API key needed)
 *   ost-agent loop start|step|decide|seal     health bookends for one unattended firing
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
import { anthropicCredentialsPresent, credentialGuidance } from "../runner/credentials.js";
import { getProcess, PROCESSES } from "../processes/registry.js";
import { drivesModel } from "../processes/types.js";
import { checkInvariants } from "../eval/invariants.js";
import { computeEvidenceDebt, gateSolution } from "../eval/evidence-debt.js";
import { computeCoverageDebt, computeCoveragePairs, computeUnfixedThresholds } from "../eval/coverage.js";
import { BELIEVABILITY_LADDER, believabilityRollup, type RungId } from "../knowledge/believability.js";
import { recordResult, VERDICTS, type Verdict } from "../ost/results.js";
import { cautionBacklog, flagHumansRequired, setLane, suggestCaution, triageLanes } from "../ost/lanes.js";
import { laneDef, LANES, type LaneId } from "../knowledge/lanes.js";
import { fileFriction, FRICTION_KINDS, type FrictionFilingKind } from "../adapters/friction.js";
import { ALLOWED_TOOL_NAMES } from "../security/policy.js";
import { createLazyOstMcpServer, MCP_TOOL_NAMES } from "../mcp/server.js";
import { vaultReadiness } from "../mcp/bootstrap.js";
import { withAuthHint } from "../runner/errors.js";
import { registerLoopCommands } from "./loop.js";
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
    // Fail before the pass rather than inside it: an unrunnable pass should not
    // leave a journal entry and a commit behind to explain later. Only the
    // model-driven processes are gated — ingest and hygiene need no credential
    // and must keep working without one.
    // `<id> FAILED:` is the token cron and `status` already key off, so the
    // pre-flight reports failure in the same shape a dead pass would.
    if (drivesModel(proc) && !anthropicCredentialsPresent()) {
      console.error(`${proc.id} FAILED: ${credentialGuidance(`run ${proc.id}`)}`);
      process.exitCode = 1;
      return;
    }
    const ctx = buildPassContext(opts.vault);
    const outcome = await runPass(proc, ctx, anthropicDriver());
    console.log(`${proc.id} ${proc.title}: created=${outcome.result.created} linked=${outcome.result.linked} annotated=${outcome.result.annotated} evidence=${outcome.result.evidence}`);
    console.log(`  ${outcome.committed ? `committed ${outcome.sha.slice(0, 8)}` : "nothing to commit"}; done=${outcome.done}`);
    if (outcome.error) {
      // A partial pass (work committed, then an error) still fails: one exit code
      // that means "do not trust this run" is the contract cron and CI already speak.
      // Whatever landed before the error is in the commit above and in the journal.
      console.error(`${proc.id} FAILED: ${withAuthHint(outcome.error)}`);
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
  .requiredOption(
    "-u, --uncovered <text>",
    "what this run does NOT cover — the part of the threshold it left untested",
  )
  .option("-e, --evidence <rung>", `raise the test's rung to what the run produced (${BELIEVABILITY_LADDER.map((r) => r.id).join(", ")})`)
  .option("--vault <dir>", "vault directory", ".")
  .action(
    (
      test: string,
      opts: { verdict: string; note: string; by: string; uncovered: string; evidence?: string; vault: string },
    ) => {
      const line = recordResult(opts.vault, {
        test,
        verdict: opts.verdict as Verdict,
        note: opts.note,
        by: opts.by,
        uncovered: opts.uncovered,
        evidence: opts.evidence as RungId | undefined,
      });
      console.log(`recorded on "${test}": ${line}`);
      console.log(`  does not cover: ${opts.uncovered.trim()}`);
    },
  );

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
    const coverage = computeCoverageDebt(ctx.vault.readTree());
    const c = coverage.totals;
    console.log(
      `\nCoverage: ${c.withResults} test(s) with results  (bounded ${c.bounded}, unbounded ${c.unbounded})`,
    );
    for (const g of coverage.gaps) {
      const detail =
        g.stated === 0
          ? `${g.claimed} result(s), none saying what they fail to cover`
          : `${g.claimed} result(s) against ${g.stated} uncovered statement(s)`;
      console.log(`  [unbounded] ${g.title} — ${detail}`);
    }
    if (coverage.gaps.length > 0) {
      console.log("  a result with no stated limit gets read as answering the whole question.");
    }

    // The bounded tests, read side by side. Counting the pair proves a sentence
    // exists; only reading it against the threshold the node wrote down before
    // the run can show whether the run answered the question that was asked.
    // Printed, never compared — the comparison is the human's.
    const pairs = computeCoveragePairs(ctx.vault.readTree());
    if (pairs.length > 0) {
      console.log(`\nBounded — what each test asked for, and what its runs left out:`);
      for (const p of pairs) {
        console.log(`  ${p.title}`);
        console.log(`      asked:     ${p.asked ?? "(no pre-committed threshold written in this node)"}`);
        const [first, ...rest] = p.uncovered;
        console.log(`      uncovered: ${first ?? "(nothing stated)"}`);
        for (const more of rest) console.log(`                 ${more}`);
      }
      const unasked = pairs.filter((p) => p.asked === null).length;
      if (unasked > 0) {
        console.log(
          `  ${unasked} of these stated a limit against no written threshold — there is nothing to read it against.`,
        );
      }
    }

    // Every test's threshold, whether or not it has ever been run. The
    // side-by-side above only reaches tests with results; this reaches the
    // backlog, where a threshold that was never fixed is still cheap to fix.
    const census = computeUnfixedThresholds(ctx.vault.readTree());
    const u = census.totals;
    if (u.tests > 0) {
      console.log(
        `\nThresholds: ${u.tests} assumption test(s)  (fixed ${u.bound}, ` +
          `stated in words ${u.prose}, still an instruction ${u.instruction}, none written ${u.absent})`,
      );
      for (const r of census.unfixed) {
        console.log(`  [${r.kind === "absent" ? "no threshold" : "not fixed"}] ${r.title}`);
        if (r.asked !== null) console.log(`      reads: ${r.asked}`);
      }
      if (census.unfixed.length > 0) {
        console.log("  a test whose threshold was never fixed cannot come out a failure.");
      }
    }

    console.log(
      "\nMechanical only: this counts whether ANY assumption beneath a solution recorded a result,\n" +
        "and whether each result was paired with a written statement of what it left untested.\n" +
        "The side-by-side above is printed, not judged: whether the RIGHT (riskiest) assumption was\n" +
        "tested, and whether the run actually answered the threshold next to it, is a human call.\n" +
        "The threshold reading is shallower still — it asks whether a bar was written, never whether\n" +
        "the bar is the right one, and it will be wrong at the edges. It flags; it never refuses.",
    );
  });

program
  .command("lanes")
  .description("assumption tests grouped by the human minutes they actually cost")
  .option("--vault <dir>", "vault directory", ".")
  .option("--runnable", "print only the compute-only backlog, one title per line (for scripting)")
  .option(
    "--flag-cautious <who>",
    "apply humans-required, in bulk, to every unclassified test whose text names an outside person",
  )
  .action((opts: { vault: string; runnable?: boolean; flagCautious?: string }) => {
    const ctx = buildPassContext(opts.vault);
    const tree = ctx.vault.readTree();
    const t = triageLanes(tree);

    if (opts.runnable) {
      for (const title of t.runnable) console.log(title);
      return;
    }

    // The bulk half of triage, in the only direction that is safe to do in
    // bulk. Every entry here is a test the tree's own text says needs a person,
    // so applying it wholesale can only shrink what an unattended pass may run;
    // the permissive calls stay one-at-a-time and human, on `ost-agent lane`.
    if (opts.flagCautious) {
      const backlog = cautionBacklog(tree);
      if (backlog.length === 0) {
        console.log("Nothing to flag — no unclassified test names an outside person.");
        console.log("That is not a verdict on the rest: silence means no marker found, never 'safe to automate'.");
        return;
      }
      for (const entry of backlog) {
        flagHumansRequired(opts.vault, { test: entry.test, by: opts.flagCautious, why: entry.why });
        console.log(`  flagged "${entry.test}" — ${entry.why}`);
      }
      console.log(
        `\n${backlog.length} test(s) are now humans-required, attributed to ${opts.flagCautious}.\n` +
          `${t.unlabelled.length - backlog.length} remain unclassified and are still NOT runnable by compute —\n` +
          "classifying those permissively is a judgement, and it stays yours.",
      );
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
      const declaredBy = new Map(t.proseDeclared.map((d) => [d.test, d]));
      for (const title of t.unlabelled) {
        const node = tree.find((n) => n.title === title);
        const hint = node ? suggestCaution(node) : undefined;
        const said = declaredBy.get(title);
        const notes = [
          said ? `says "${said.quote}" in its own text` : "",
          hint ? `⚠ likely ${hint.lane}: ${hint.why}` : "",
        ].filter(Boolean);
        console.log(`  - ${title}${notes.length ? `  ${notes.join("  ")}` : ""}`);
      }
    }

    // The cheapest end of the backlog, called out separately because it is the
    // one part a person can clear without deciding anything new: the test
    // already says what it is, in prose the tool cannot read.
    if (t.proseDeclared.length > 0) {
      console.log(
        `\n${t.proseDeclared.length} unclassified test(s) declare a lane in their prose but carry no lane: field.`,
      );
      console.log("Reported, deliberately not applied — a node must not label itself into compute's reach.");
      console.log("If you agree with what each one says about itself:");
      for (const d of t.proseDeclared) {
        console.log(`  ost-agent lane "${d.test}" --set ${d.lane} --by "<you>" --why "declared in the test's own text"`);
      }
    }

    // A declaration naming two lanes is not a classification anyone can paste.
    // It is listed here instead, whole sentence included, because the fragment
    // is what made it look unambiguous in the first place.
    if (t.proseAmbiguous.length > 0) {
      console.log(
        `\n${t.proseAmbiguous.length} test(s) declare a lane and then qualify it — no paste-ready command for these.`,
      );
      console.log("The test is saying it splits. Split the test, or decide which half the label is about.");
      for (const a of t.proseAmbiguous) {
        console.log(`  - ${a.test}\n      names ${a.names.join(" and ")}: "${a.quote}"`);
      }
    }

    // The disagreement half. `check` fails on these; repeating them here is for
    // the person already looking at lanes, who is the one who can settle it.
    if (t.laneConflicts.length > 0) {
      console.log(`\n⚠ ${t.laneConflicts.length} test(s) carry a lane that contradicts their own prose.`);
      for (const c of t.laneConflicts) {
        const risk =
          c.labelled === "compute-only"
            ? "an unattended pass may run this one — the label is what compute obeys"
            : "stale in the safe direction";
        console.log(`  - ${c.test}\n      labelled ${c.labelled}, prose says "${c.quote}" — ${risk}`);
      }
      console.log("Reported, not resolved: choosing the permissive reading is a human's call.");
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
    const coverage = computeCoverageDebt(tree);
    if (coverage.totals.withResults > 0) {
      console.log(
        `Coverage: ${coverage.totals.bounded}/${coverage.totals.withResults} recorded result(s) say what they do not cover`,
      );
      for (const g of coverage.gaps) {
        console.log(`  unbounded: ${g.title} (${g.claimed} result(s), ${g.stated} stated limit(s)) — see \`debt\``);
      }
    }
    // One line, and only when there is something to say. A test whose threshold
    // is still an instruction to pick one cannot come out a failure, and that is
    // worth seeing next to the tree's shape rather than only on demand.
    const thresholds = computeUnfixedThresholds(tree);
    if (thresholds.unfixed.length > 0) {
      const { instruction, absent, tests } = thresholds.totals;
      console.log(
        `Thresholds: ${instruction + absent}/${tests} assumption test(s) have no fixed bar ` +
          `(${instruction} still an instruction, ${absent} unwritten) — see \`debt\``,
      );
    }
    printLastRuns(journals);
  });

program
  .command("mcp")
  .description("run a stdio MCP server exposing the append-only OST tools (no API key needed)")
  .option("--vault <dir>", "vault directory", process.env.OST_VAULT ?? ".")
  .action(async (opts: { vault: string }) => {
    const dir = path.resolve(opts.vault);
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    // Lazy: the real context is built on the first call that finds the vault
    // ready, so a broken or absent config cannot keep the server from starting.
    const server = createLazyOstMcpServer(dir);
    await server.connect(new StdioServerTransport());
    // stdout is the JSON-RPC channel — log only to stderr.
    console.error(`ost-agent mcp serving ${dir} over stdio. Tools: ${MCP_TOOL_NAMES.join(", ")}`);
    // Serve first, report readiness second. A server that refuses to start on a
    // first run shows the operator a failed connection — the least actionable
    // signal available. Started, it can say what to do instead.
    // Probe-only: no Vault handle, so a typo'd --vault path creates nothing.
    const readiness = vaultReadiness({ dir });
    if (!readiness.ready) console.error(`ost-agent mcp: ${readiness.message}`);
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
        console.error(`${id} failed:`, e instanceof Error ? withAuthHint(e.message) : e);
        return null;
      });
      if (!outcome) return;
      console.log(`[${new Date().toISOString()}] ${id}: created=${outcome.result.created} committed=${outcome.committed}`);
      if (outcome.error) {
        // The supervisor stays up (that is its job), but the failure goes to stderr
        // where a wrapper, launchd, or a log scraper can see it.
        console.error(`[${new Date().toISOString()}] ${id} FAILED: ${withAuthHint(outcome.error)}`);
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

registerLoopCommands(program);

program.parseAsync().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
