#!/usr/bin/env node
/**
 * OST-Agent CLI: init / status / analysis / mcp.
 *
 *   ost-agent init [folder] --outcome "..."   create/adopt a vault
 *   ost-agent status [--vault DIR]            read-only tree summary
 *   ost-agent result "<test>" ...             record a human-run test's outcome
 *   ost-agent promote "<node>" ...            move a node to validated (the agent cannot)
 *   ost-agent debt [--vault DIR]              evidence each solution still owes + unbounded results + unfixed thresholds
 *   ost-agent lanes [--vault DIR]             assumption tests by the human minutes they cost
 *   ost-agent lanes --flag-cautious <who>     bulk: humans-required for every test naming an outside person
 *   ost-agent lane "<test>" --set <lane> ...  classify one test into a lane
 *   ost-agent gate "<solution>" [--vault DIR] block building against untested assumptions
 *   ost-agent verify "<test>" --repo DIR      run a test's instrument; record red/green as an observed fact
 *   ost-agent buildable ["<solution>"]        is it defined well enough to build, and against what command?
 *   ost-agent buildable "<s>" --repo DIR      …and is the recorded red still red, or was the ticket spent?
 *   ost-agent stranded [--also DIR]           evidence no node cites, split by which fix would clear it
 *   ost-agent capability [--repo DIR]         what each builder can do, read off the commits already written
 *   ost-agent preflight [--transcripts DIR]   did the callers whose calls failed already know they were unsure?
 *   ost-agent channels [--vault DIR]          every drop folder, its last delivery, and what has gone silent
 *   ost-agent friction "<note>" [--vault DIR] file friction at the point of pain
 *   ost-agent corrections [--state DIR]       refusals this workspace already paid for, for the next session to read
 *   ost-agent allowlist --skill F --settings F  derive a run's permission grant from the skill's own allowed-tools
 *   ost-agent loop due|start|step|seal        unattended firing: cadence, lock, ceiling, health
 *   ost-agent mcp [--vault DIR]               stdio MCP server (no API key needed)
 *
 * `--vault` is optional everywhere it appears. Omitted, it resolves through
 * `ost.vault.yaml` — the pointer file a project commits at its root to say where
 * its tree lives — before falling back to `$OST_VAULT` and then the current
 * directory. See `src/cli/vault-option.ts`.
 */
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { buildPassContext } from "../runner/context.js";
import { readConfig } from "../config/load.js";
import { ailingChannels, allChannels, channelHealth, renderChannels } from "../adapters/channels.js";
import { initVault } from "../runner/init.js";
import { setOutcome } from "../runner/set-outcome.js";
import { renderCheck, renderDebt, renderGate, renderStatus } from "../eval/render.js";
import { renderRollup, rollupTree } from "../eval/rollup.js";
import { lineageOf, renderLineage } from "../eval/lineage.js";
import { BELIEVABILITY_LADDER, type RungId } from "../knowledge/believability.js";
import { promoteNode, recordResult, retractNode, VERDICTS, type Verdict } from "../ost/results.js";
import { verifyInstrument } from "../ost/instrument.js";
import { buildableSolutions, buildPermit, confirmPermit, testsAwaitingVerification } from "../eval/buildable.js";
import { formatCensus, reconcileWithGit, reconcileWithUsage } from "../ost/census.js";
import { formatStrandedCensus, strandedEvidenceCensus } from "../ost/stranded.js";
import { blindnessCensus, formatBlindnessCensus, readSweepRuns, recordSweepRun } from "../ost/sweep.js";
import { committedCapabilityProfile, formatCapabilityProfile } from "../product/capability.js";
import { readResourceManifest } from "../product/manifest.js";
import { formatPriorityOrder, rankBuildableWork } from "../product/planner.js";
import {
  formatPreflightCensus, preflightUncertaintyCensus, readTranscriptSessions, readUsageEvents,
} from "../telemetry/preflight.js";
import { defaultTranscriptDir } from "../adapters/transcript.js";
import { cautionBacklog, flagHumansRequired, setLane, suggestCaution, triageLanes } from "../ost/lanes.js";
import { laneDef, LANES, type LaneId } from "../knowledge/lanes.js";
import { fileFriction, FRICTION_KINDS, type FrictionFilingKind } from "../adapters/friction.js";
import { createLazyOstMcpServer, MCP_TOOL_NAMES } from "../mcp/server.js";
import { vaultReadiness } from "../mcp/bootstrap.js";
import { gitCommit } from "../git/safe-git.js";
import { runAllowlistGenerator } from "../security/allowlist-generator.js";
import { loopStateDir, workingTreeStatus, type VaultTreeStatus } from "../loop/state.js";
import {
  DEFAULT_QUIET_MINUTES, emptyCorrectionsLedger, readLedger, recordCorrections, renderCorrections,
} from "../loop/corrections.js";
import { entriesRequiringAHuman, registerLoopCommands, resolveSessionsDir } from "./loop.js";
import { installVaultResolution, resolvedVaultSource, VAULT_OPTION_HELP } from "./vault-option.js";
import { describeVaultSource } from "../config/pointer.js";
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

/** Commander's accumulator for a repeatable option: `--also a --also b` → `["a", "b"]`. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

interface CorrectionsOptions {
  state?: string;
  sessions?: string;
  project?: string;
  quietMinutes?: string;
  /** Commander's `--no-record`: absent ⇒ true. */
  record?: boolean;
  vault: string;
}

/**
 * Where this workspace's ledger lives.
 *
 * `--state` first and unconditionally, because the two loops on a machine do not
 * share a home and only the caller knows which one it is. The discovery loop is a
 * vault loop and gets `<vault>/.git/ost-agent/` — outside the working tree, for the
 * reason `src/loop/state.ts` spells out. The build loop keeps its state outside the
 * vault entirely (`$OST_BUILD_STATE`) so it cannot wedge discovery's dirty-tree
 * gate, and passes that path in.
 *
 * Null when neither is available, which is a real state: `--vault` may point at a
 * directory that is not a git checkout.
 */
function correctionsStateDir(opts: CorrectionsOptions): string | null {
  if (opts.state) return path.resolve(opts.state);
  return loopStateDir(opts.vault);
}

/**
 * Which transcripts to harvest, in the order a caller means them.
 *
 * `--project` derives through {@link defaultTranscriptDir} rather than by pasting
 * the slug rule into a shell script. The rule (project path, every non-alphanumeric
 * character to `-`, under `~/.claude/projects/`) already exists in one place, and a
 * second copy in bash is a second thing to get wrong on the day it changes.
 *
 * The config fallback reads the sessions directory the vault ALREADY declares for
 * its spend ceiling. Not a third declaration of the same path: it is the same
 * directory, the operator has already written it down, and a key they had to
 * duplicate is a key they would leave unset — which would turn this feature off on
 * exactly the vaults that run unattended.
 */
function correctionsSessionsDir(opts: CorrectionsOptions): string | null {
  if (opts.sessions) return path.resolve(opts.sessions);
  if (opts.project) return defaultTranscriptDir(opts.project);
  const { config } = readConfig(opts.vault, { missing: "defaults" });
  const declared = config.loop?.spend?.sessionsDir ?? config.loop?.questions?.sessionsDir;
  return declared ? resolveSessionsDir(opts.vault, declared) : null;
}

const program = new Command();
program.name("ost-agent").description("Autonomous, append-only Opportunity Solution Tree agent").version(VERSION);
// One rule for what `--vault` means, applied to every command that declares it,
// including the ones `registerLoopCommands` adds below.
installVaultResolution(program);

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
    // The absolute path off `initVault`, not a path re-derived here: the folder the
    // operator is told to use has to be the folder the ingest actually reads, and
    // two computations of it are two chances to disagree.
    console.log(`\nDrop notes into ${r.inboxDir}/, then run /ost-map in Claude Code to fold them into the tree.`);
    if (r.inboxConfined) {
      console.log("  That folder is deliberately OUTSIDE the vault: writing it is a different grant from writing the tree.");
    } else {
      console.log("  ⚠ That folder is INSIDE the vault, so writing notes and writing the tree are the same grant.");
      console.log("    Move it outside (adapters.inbox.path) when you can — ids and cursors are keyed on filenames, so nothing re-ingests.");
      if (r.gitignored) console.log(`    Added \`${r.gitignored}\` to .gitignore; notes already committed stay in git history.`);
    }
    // A refused channel gets no folder and is never read. Saying nothing about it
    // would make "refused" and "working" the same observable at the exact moment
    // the operator is looking — init is what they run after adding the entry.
    if (r.channelProblems.length > 0) {
      console.log(`\n⚠ ${r.channelProblems.length} channel(s) in ost.config.yaml were refused and will NOT be read:`);
      for (const p of r.channelProblems) console.log(`  - ${p}`);
    }
    console.log(`\nRun \`ost-agent channels --vault ${dir}\` at any time to see every drop folder and whether it has gone quiet.`);
  });

program
  .command("set-outcome")
  .description("retune the steering mandate (human-only; prior mandate kept in the root node's history)")
  .argument("[text]", "the new mandate (prompted if omitted)")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action(async (text: string | undefined, opts: { vault: string }) => {
    const next = text ?? (await prompt("New steering mandate: "));
    const r = await setOutcome(opts.vault, next);
    console.log(`Retuned "${r.title}" — committed ${r.sha.slice(0, 8)}`);
    console.log(`  prior mandate preserved in the root node's ## History`);
  });

/** What committing the filing did, in the three shapes the operator has to be told apart. */
type FilingCommit =
  | { kind: "committed"; sha: string }
  | { kind: "left-dirty"; entries: string[] }
  | { kind: "no-history"; reason: string };

/**
 * Put the filing into the vault's history, so that filing friction does not brick
 * the next unattended firing.
 *
 * **The wedge this closes.** `.ost-agent/friction/` sits INSIDE the vault on
 * purpose — that is what gets a filing committed with the tree instead of stranded
 * outside it, now that `adapters.inbox.path` escapes the vault. But nothing else
 * commits it: `fileFriction` writes the file and returns. So a filing made outside
 * a pass sits in the working tree as `?? .ost-agent/friction/`, and `loop start`'s
 * D5 gate then refuses every firing after it ({@link entriesRequiringAHuman}) until
 * a person intervenes. Filing friction is what the agent is told to do the moment it
 * is blocked — being blocked is exactly when it stops making mutating calls — so the
 * affordance for being stuck would be the thing that stops the loop, with a
 * human-only way out, reached by using the tool as `README.md` documents it.
 *
 * Committing here also closes the other half of the same residue. A file left in the
 * tree is swept into the NEXT firing's `git add -A`: the filing is attributed to that
 * firing and it is what moves the HEAD F4 reads its verdict from, so a firing that
 * did nothing seals `healthy` on the strength of a note filed before it began.
 * Committed now, it lands outside every firing's bracket, where it belongs.
 *
 * **Gated on there being nothing a human has to deal with**, because `gitCommit`
 * stages with `git add -A`: from a dirty tree it would commit a stranger's file under
 * this filing's name, which is the misattribution D5 exists to stop. The predicate is
 * `entriesRequiringAHuman` — D5's own — and not "clean", so the usage-trace residue
 * every read-only call leaves behind does not suppress the commit; riding along on
 * some later commit is the only route that trace has ever had into history, and this
 * is one of those.
 *
 * Best-effort by construction: a vault with no git, no identity or no history still
 * gets its filing. Losing the agent's record because a commit failed would be worse
 * than losing the commit — and the caller says out loud which of the two happened,
 * because an uncommitted filing is a firing the operator is about to lose.
 */
async function commitFiling(vaultDir: string, before: VaultTreeStatus, written: string): Promise<FilingCommit> {
  if (before.kind === "unknown") return { kind: "no-history", reason: before.reason };
  const foreign = before.kind === "dirty" ? entriesRequiringAHuman(before.entries) : [];
  if (foreign.length > 0) return { kind: "left-dirty", entries: foreign };
  try {
    const r = await gitCommit(vaultDir, `friction: ${path.basename(written)}`);
    return r.committed
      ? { kind: "committed", sha: r.sha.slice(0, 8) }
      : // Nothing to commit right after writing a file means git cannot see it —
        // an ignore rule over the friction folder. Reported rather than read as
        // success: the filing exists and is not versioned, which is the one state
        // that looks like the good one and is not.
        { kind: "no-history", reason: "git reports nothing to commit — something is ignoring the friction folder" };
  } catch (e) {
    return { kind: "no-history", reason: e instanceof Error ? e.message : String(e) };
  }
}

program
  .command("friction")
  .description("file one line of friction at the point of pain (lands in the vault's friction channel, and is committed)")
  .argument("<note>", "what went wrong, in one line")
  .option("-k, --kind <kind>", `one of: ${FRICTION_KINDS.join(", ")}`, "blocked")
  .option("-c, --context <text>", "what you were doing, or what you wish existed")
  .option("-s, --source <text>", "who is filing (loop, process, session)")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action(async (note: string, opts: { kind: string; context?: string; source?: string; vault: string }) => {
    // Read BEFORE the write. The question is whether this tree was already carrying
    // something a person has to explain, and after the write the answer is never no.
    const before = workingTreeStatus(opts.vault);
    const written = fileFriction(opts.vault, {
      kind: opts.kind as FrictionFilingKind,
      note,
      context: opts.context,
      source: opts.source,
    });
    console.log(`filed ${path.basename(written)}`);
    const result = await commitFiling(opts.vault, before, written);
    if (result.kind === "committed") {
      console.log(`  committed ${result.sha} — it is in the vault's history and the working tree is clean again`);
      return;
    }
    if (result.kind === "left-dirty") {
      console.log(`  NOT committed: ${result.entries.length} path(s) were already dirty here before this filing:`);
      for (const e of result.entries.slice(0, 5)) console.log(`      ${e}`);
      console.log("  Committing would have put those into history under this filing's name. Deal with them and commit,");
      console.log("  or `ost-agent loop start` will refuse the next firing over this filing as well.");
      return;
    }
    console.log(`  NOT committed (${result.reason}).`);
    console.log(`  The filing is on disk at ${written} and nothing has versioned it.`);
  });

program
  .command("check")
  .description("run the deterministic tree invariants (no model needed)")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action(async (opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    const census = ctx.vault.readTreeCensus();
    census.independent = await reconcileWithGit(ctx.dir, census);
    census.unexplained = reconcileWithUsage(ctx.dir, census);
    const { text, violations } = renderCheck(census);
    console.log(text);
    if (violations > 0) process.exitCode = 1;
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
  .option("--vault <dir>", VAULT_OPTION_HELP)
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
  .command("promote")
  .description("promote a node to 'validated' (humans only — the agent has no argument that expresses this)")
  .argument("<node>", "title of the node to promote")
  .requiredOption("-b, --by <who>", "who promoted it — an unattributed promotion cannot be told apart from a fabricated one")
  .requiredOption("-w, --why <text>", "the evidence that earned it")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((node: string, opts: { by: string; why: string; vault: string }) => {
    const line = promoteNode(opts.vault, { node, by: opts.by, why: opts.why });
    console.log(`promoted "${node}": ${line}`);
    console.log("  removed the #unvalidated marker");
  });

program
  .command("retract")
  .description("take a node out of the live tree without deleting it (humans only — no tool can express this)")
  .argument("<node>", "title of the node to retract")
  .requiredOption(
    "-b, --by <who>",
    "who retracted it — an unattributed retraction cannot be told apart from a fabricated one",
  )
  .requiredOption("-w, --why <text>", "why it is coming out — the only thing a reader who finds the file later will have")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((node: string, opts: { by: string; why: string; vault: string }) => {
    const line = retractNode(opts.vault, { node, by: opts.by, why: opts.why });
    console.log(`retracted "${node}": ${line}`);
    // What actually changed, said plainly, because retraction is the one
    // operation here whose whole effect is an ABSENCE — and an absence nobody
    // described reads exactly like the command having done nothing.
    console.log("  the file, its history and this line all stay on disk and in git");
    console.log("  it is now in no count, scan, gate or rollup; `ost-agent status` names it under retired");
    console.log("  inbound links still point at it — `ost-agent check` reports them as dangling until they are unlinked");
  });

program
  .command("debt")
  .description("what each solution owes in evidence before anyone builds it (no model needed)")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    console.log(renderDebt(ctx.vault.readTree()));
  });

program
  .command("lanes")
  .description("assumption tests grouped by the human minutes they actually cost")
  .option("--vault <dir>", VAULT_OPTION_HELP)
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
  .option("--vault <dir>", VAULT_OPTION_HELP)
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
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((solution: string, opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    const { text, cleared } = renderGate(ctx.vault.readTree(), solution);
    if (cleared) {
      console.log(text);
      return;
    }
    console.error(text);
    process.exitCode = 1;
  });

program
  .command("verify")
  .description("run an assumption test's instrument and record what it did (the machine's half — a fact, never a result)")
  .argument("<test>", "title of the AssumptionTest whose instrument to run")
  .requiredOption("-r, --repo <dir>", "the repository the instrument is measured against")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((test: string, opts: { repo: string; vault: string }) => {
    let outcome;
    try {
      outcome = verifyInstrument(opts.vault, { test, repo: opts.repo });
    } catch (e) {
      console.error(String(e instanceof Error ? e.message : e));
      process.exitCode = 1;
      return;
    }
    console.log(`observed on "${test}": ${outcome.line}`);
    if (outcome.run.observation === "red") {
      console.log("  RED — this is a build permit: the command fails today and passes when the solution is built.");
    } else if (outcome.transitioned) {
      console.log("  GREEN after red — the solution has been built. This says nothing about whether it was worth building;");
      console.log("  that is still `ost-agent result`, and still a human's.");
    }
  });

program
  .command("buildable")
  .description("may work start on this solution, and against what definition of done? (exits non-zero when not)")
  .argument("[solution]", "title of the Solution node; omit to list every buildable solution")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .option("--pending", "instead list the tests that declare an instrument nobody has run yet")
  .option(
    "--repo <dir>",
    "re-run the instrument against this repository before clearing, and refuse the permit if it passes today " +
      "(records nothing — that is `ost-agent verify`)",
  )
  .action((solution: string | undefined, opts: { vault: string; pending?: boolean; repo?: string }) => {
    const ctx = buildPassContext(opts.vault);
    const tree = ctx.vault.readTree();
    if (opts.pending) {
      // One title per line and nothing else: this is the list an unattended loop
      // reads to decide what to go run, so it is parsed far more often than read.
      for (const t of testsAwaitingVerification(tree)) console.log(t);
      return;
    }
    if (!solution) {
      // THIS is the priority order — the list an unattended loop reads top-down
      // to decide what to build next. It used to be tree order, which conditions
      // on nothing and admits to nothing. It is now ranked against what the
      // operator declared in `ost.resources.yaml`, and the citation naming every
      // declared field AND every blank goes to stderr beside it. A vault with no
      // manifest gets exactly the order it got before, and is told, out loud,
      // which five facts about its operator this order is guessing at.
      const load = readResourceManifest(opts.vault);
      const order = rankBuildableWork(tree, load.manifest, load.problem);
      // stdout carries solution titles and NOTHING else, because an unattended
      // loop reads this list to decide what to build. The advisory below went to
      // stdout once: the build script filtered out the indented detail lines,
      // kept the unindented "nothing is buildable…" sentence, and handed that
      // sentence to the model as the solution it had been cleared to build. An
      // empty list has to BE empty, not a paragraph explaining that it is.
      if (order.ranked.length === 0) {
        console.error("nothing is buildable: no solution carries an instrument that has been observed red.");
        console.error("  `ost-agent debt` says which solutions still owe a test; a test owes an `instrument:` field.");
        return;
      }
      // The citation first and in full, on stderr, because an order presented
      // before its conditions reads as arithmetic rather than as a judgement
      // made under stated assumptions.
      for (const line of formatPriorityOrder(order).split("\n")) console.error(line);
      for (const r of order.ranked) console.log(r.solution);
      return;
    }
    // A permit read off the node is a claim about the day it was recorded. With
    // `--repo` it becomes a claim about now: the command runs again, and a red
    // that has since gone green refuses instead of clearing. Nothing is written
    // either way — the caller is told which test to `verify`, because that is
    // the one path allowed to file an observation.
    const recorded = buildPermit(tree, solution);
    const permit = opts.repo ? confirmPermit(recorded, opts.repo) : recorded;
    if (permit.cleared) {
      console.log(`buildable: CLEARED — ${permit.reason}`);
      return;
    }
    // SPENT is its own word rather than a flavour of BLOCKED. They are opposite
    // findings — blocked means nobody has defined this yet, spent means somebody
    // already built it — and a loop reading this output acts differently on each.
    console.error(`buildable: ${permit.spent ? "SPENT" : "BLOCKED"} — ${permit.reason}`);
    process.exitCode = 1;
  });

program
  .command("stranded")
  .description("evidence no node cites, split into what an existing node already quotes and what only a new node type could home")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .option("--also <dir>", "another vault to include in the same census (repeatable)", collect, [])
  .option(
    "--ignore-citer <title>",
    "a node whose prose citations do not count as an attachment — a node that merely enumerates the backlog cites all of it (repeatable)",
    collect,
    [],
  )
  .action((opts: { vault: string; also: string[]; ignoreCiter: string[] }) => {
    // Deliberately NOT `buildPassContext`: this reads more than one vault, and the
    // extra ones are typed on the command line by a person asking a question about
    // them. A context per vault would construct adapters and create any directory
    // that was mistyped.
    const dirs = [opts.vault, ...opts.also].map((d) => path.resolve(d));
    const census = strandedEvidenceCensus(dirs, { excludeCiters: opts.ignoreCiter });
    const blind = census.blindness === "totally-blind";
    // The subject count goes into the ledger on every run, blind or not. That is
    // the only thing that will ever let anyone replay these and say how many were
    // blind all the way rather than partly (`ost-agent sweeps`), and a ledger
    // written only on the bad runs measures nothing.
    try {
      recordSweepRun(dirs[0], {
        sweep: "stranded",
        at: new Date().toISOString(),
        subject: census.subject,
        findings: census.stranded.length,
        outcome: blind ? "blind" : census.stranded.length > 0 ? "findings" : "clean",
      });
    } catch (e) {
      // Never costs the census. But it is said out loud rather than swallowed:
      // an unrecorded run is one more run nobody can classify later.
      console.error(`(this run was not recorded: ${e instanceof Error ? e.message : String(e)})`);
    }
    const text = formatStrandedCensus(census);
    if (blind) {
      console.error(text);
      process.exitCode = 1;
      return;
    }
    console.log(text);
  });

program
  .command("sweeps")
  .description("replay the recorded sweep runs and report how many were blind all the way rather than partly")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((opts: { vault: string }) => {
    const runs = readSweepRuns(path.resolve(opts.vault));
    if (runs.length === 0) {
      // Its own rule, applied to itself: a replay with nothing to replay has not
      // found that no sweep was ever blind.
      console.error("no sweep runs recorded in this vault — there is nothing to replay, which is not the same as no blindness.");
      process.exitCode = 1;
      return;
    }
    console.log(formatBlindnessCensus(blindnessCensus(runs)));
  });

program
  .command("capability")
  .description("what each builder demonstrably knows how to do, read off the commits and PRs already written — nothing is asked of anyone")
  .option("--repo <dir>", "the repository whose committed record to read", ".")
  .option("--commits <n>", "how many commits back to read", (v) => Number(v), 100)
  .option("--prs <n>", "how many pull requests back to read", (v) => Number(v), 30)
  .action(async (opts: { repo: string; commits: number; prs: number }) => {
    // No vault, no config, no context. The mechanism's whole argument is that a
    // path to a git repository is the only input, so taking a second one here
    // would quietly reintroduce the deposit it exists to avoid.
    const report = await committedCapabilityProfile(path.resolve(opts.repo), { commits: opts.commits, prs: opts.prs });
    console.log(formatCapabilityProfile(report));
    // A record too illegible to profile is a finding, and a finding an automation
    // can act on has to reach it through the exit code. A record the reader could
    // not see at all exits the same way, and for a stronger reason: a sweep that
    // reports a clean run over a subject it never read is worse than a red one.
    if (report.verdict === "refuted" || report.shallow) process.exitCode = 1;
  });

program
  .command("preflight")
  .description("how often a call that failed came from a caller already showing doubt — the census behind a validate-only twin")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .option(
    "--transcripts <dir>",
    "a directory of session transcripts to read the failures against (repeatable); defaults to this project's own",
    collect,
    [],
  )
  .action((opts: { vault: string; transcripts: string[] }) => {
    // Deliberately NOT `buildPassContext`: this reads a trace and some transcripts
    // and answers a question about them. Opening a Vault handle would create the
    // directory a mistyped path names, and constructing adapters would reach for
    // credentials nothing here needs.
    const vault = path.resolve(opts.vault);
    const dirs = opts.transcripts.length ? opts.transcripts : [defaultTranscriptDir(vault)];
    const sessions = dirs.flatMap((d) => readTranscriptSessions(path.resolve(d)));
    const census = preflightUncertaintyCensus(readUsageEvents(vault), sessions);
    console.log(formatPreflightCensus(census));
    // Nothing readable is not a clean result — it is the sweep that could not read
    // its subject, and an automation has to learn that through the exit code.
    if (census.readable === 0) process.exitCode = 1;
  });

program
  .command("channels")
  .description("list every commissioned channel, when it last delivered, and which ones are silent or unavailable (read-only)")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((opts: { vault: string }) => {
    const dir = path.resolve(opts.vault);
    // Deliberately NOT `buildPassContext`: that opens a Vault handle which creates
    // the vault directory, and it constructs adapters. This command answers a
    // question about configuration and state files; it must be able to run against
    // a vault it does not touch, and a test asserts it leaves the tree byte-identical.
    //
    // `readConfig`, not `loadConfig`, and the difference is the whole reason this
    // command exists: a broken `ost.config.yaml` is the most likely reason somebody
    // runs it, and the channel list is the surface that can say which line broke.
    // Throwing would hand them commander's bare error text and no channel report at
    // all. A MISSING config still throws — that is not a broken vault, it is not a
    // vault, and "run `ost-agent init`" is the only useful thing to say.
    const { config, problem } = readConfig(dir);
    // The defaults `readConfig` falls back to are a fallback and not a substitute:
    // listing `.ost-agent/inbox` here would show the operator a channel list they
    // never wrote and cannot act on. So a broken file reports the problem and no
    // channels — `renderChannels` says so in as many words.
    //
    // `allChannels`, not `resolveChannels`: the drop folders are three of the six
    // channels a default vault commissions, and S2's sentence is that EVERY one of
    // them is enumerable. `transcript`, `usage`, `atlassian` and `slack` write
    // timestamped cursor records like any other channel, so a report that omitted
    // them left four pipelines whose death had no observable at all. It stays pure:
    // no source is constructed and no credential is used, only read for presence.
    const resolved = problem ? { channels: [], problems: [problem] } : allChannels(dir, config);
    const health = channelHealth(dir, resolved.channels);
    console.log(renderChannels({ health, problems: resolved.problems }));
    // The verdict is the exit code, not the prose: a silent channel is only
    // actionable if something that is not a human reading text can notice it. An
    // enabled channel that cannot run counts too — it is reading nothing, which is
    // the same consequence by a different cause, and the report names which. A
    // config that could not be read is non-zero for the same reason — a report that
    // could not be produced must not exit 0.
    if (problem || ailingChannels(health).length > 0) process.exitCode = 1;
  });

program
  .command("status")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action(async (opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    const census = ctx.vault.readTreeCensus();
    census.independent = await reconcileWithGit(ctx.dir, census);
    console.log(renderStatus(ctx, census));
  });

program
  .command("lineage")
  .argument("<node>", "the node to trace back to the Outcome")
  .description("the path from the Outcome down to one node, arrow-separated (exits 1 if unreachable)")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((node: string, opts: { vault: string }) => {
    const path = lineageOf(buildPassContext(opts.vault).vault.readTree(), node);
    if (!path) {
      // Exit 1 rather than printing nothing: the one caller is a shell prepending
      // this to a report, and an empty string that looks like success would put a
      // bare arrow at the head of a notification.
      console.error(`no path from the Outcome to "${node}" — it is unreachable, or this vault has no root`);
      process.exitCode = 1;
      return;
    }
    console.log(renderLineage(path));
  });

program
  .command("rollup")
  .description("the top-level view: what sits under each bucket, computed from the tree (no model needed)")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    console.log(renderRollup(rollupTree(ctx.vault.readTree())));
  });

program
  .command("corrections")
  .description(
    "the corrections this workspace has already been given: refusals harvested from finished sessions, deduplicated by the permitted form they named, rendered for the next session to read before it composes",
  )
  .option("--state <dir>", "where the ledger lives (default: <vault>/.git/ost-agent)")
  .option("--sessions <dir>", "directory of Claude Code session transcripts to harvest")
  .option("--project <dir>", "derive --sessions from a project directory's transcript slug")
  .option(
    "--quiet-minutes <n>",
    `a session must be untouched this long to count as finished (default ${DEFAULT_QUIET_MINUTES})`,
  )
  .option("--no-record", "render what is already recorded; do not read any transcript")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((opts: CorrectionsOptions) => {
    /*
     * A READER that keeps itself current, and the two halves are deliberately one
     * command rather than two.
     *
     * The caller is a wrapper prepending this output to a prompt. Were harvesting a
     * separate invocation, a wrapper that added the render and forgot the harvest
     * would hand over a ledger that had silently stopped learning — and it would
     * look exactly like a workspace with nothing to correct. There is no state here
     * worth protecting from a write: the ledger is machine-local advice, outside git
     * by construction, and folding a session in twice is a no-op.
     *
     * Never a non-zero exit, whatever it finds. The caller is building a prompt, and
     * an unreachable transcript directory must degrade to "no corrections known"
     * rather than taking the firing down with it.
     */
    const state = correctionsStateDir(opts);
    if (state === null) {
      console.error(
        "cannot locate a corrections ledger: pass --state <dir>, or point --vault at a git checkout — the ledger lives under its .git/, never in the working tree.",
      );
      console.log(renderCorrections(emptyCorrectionsLedger()));
      return;
    }

    if (opts.record !== false) {
      const sessions = correctionsSessionsDir(opts);
      if (sessions === null) {
        console.error(
          "not harvesting: no session transcripts named — pass --sessions or --project, or declare `loop.spend.sessionsDir` in the vault's config.",
        );
      } else {
        const quiet = Number(opts.quietMinutes);
        const result = recordCorrections(state, sessions, {
          ...(Number.isFinite(quiet) ? { quietMinutes: quiet } : {}),
        });
        // On stderr, so what a wrapper captures from stdout is the ledger and
        // nothing else. Still worth printing: a harvest that has read nothing for a
        // week is how this feature dies without anybody noticing.
        if (!result.readable) console.error(`not harvesting: ${result.reason}`);
        else if (result.sessions.length > 0) {
          console.error(
            `harvested ${result.sessions.length} finished session(s): ${result.sightings} refusal(s), ${result.added} new correction(s).`,
          );
        }
      }
    }

    console.log(renderCorrections(readLedger(state)));
  });

program
  .command("allowlist")
  .description(
    "derive a session's permission allowlist from the skill's own allowed-tools (human-only, at install time)",
  )
  .requiredOption("--skill <file>", "the SKILL.md (or command file) whose `allowed-tools` line is the declaration")
  .requiredOption("--settings <file>", "the settings.json whose permissions.allow is derived from it")
  .option(
    "--confirm-install",
    "the human's install-time confirmation that grants the declaration names but this file lacks should be added " +
      "(without it, widening an existing grant is refused — a narrower grant may be somebody's deliberate choice)",
  )
  .action((opts: { skill: string; settings: string; confirmInstall?: boolean }) => {
    const run = runAllowlistGenerator({
      skillPath: path.resolve(opts.skill),
      settingsPath: path.resolve(opts.settings),
      confirmed: opts.confirmInstall === true,
    });
    if (run.exitCode === 0) console.log(run.report);
    else {
      console.error(run.report);
      process.exitCode = run.exitCode;
    }
  });

registerLoopCommands(program);

program
  .command("mcp")
  .description("run a stdio MCP server exposing the append-only OST tools (no API key needed)")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action(async (opts: { vault: string }) => {
    const dir = path.resolve(opts.vault);
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    // Lazy: the real context is built on the first call that finds the vault
    // ready, so a broken or absent config cannot keep the server from starting.
    const server = createLazyOstMcpServer(dir);
    await server.connect(new StdioServerTransport());
    // stdout is the JSON-RPC channel — log only to stderr.
    console.error(`ost-agent mcp serving ${dir} over stdio. Tools: ${MCP_TOOL_NAMES.join(", ")}`);
    // The plugin points every session at `${CLAUDE_PROJECT_DIR}`, so a session
    // whose vault is somewhere else got there through a pointer file. Say which
    // one: it is the difference between "the server is serving the wrong tree"
    // and "the file at this path says to serve this tree, and it is wrong".
    const provenance = describeVaultSource(resolvedVaultSource() ?? { dir, via: "argument" });
    if (provenance) console.error(`ost-agent mcp: ${provenance}`);
    // Serve first, report readiness second. A server that refuses to start on a
    // first run shows the operator a failed connection — the least actionable
    // signal available. Started, it can say what to do instead.
    // Probe-only: no Vault handle, so a typo'd --vault path creates nothing.
    const readiness = vaultReadiness({ dir });
    if (!readiness.ready) console.error(`ost-agent mcp: ${readiness.message}`);
  });

program.parseAsync().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
