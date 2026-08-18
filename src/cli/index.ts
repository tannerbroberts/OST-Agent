#!/usr/bin/env node
/**
 * OST-Agent CLI: init / status / analysis / mcp.
 *
 *   ost-agent init [folder] --outcome "..."   create/adopt a vault
 *   ost-agent status [--vault DIR]            read-only tree summary
 *   ost-agent setup-check [dir]               can a session opened on this project launch the vault's tools?
 *   ost-agent result "<test>" ...             record a human-run test's outcome
 *   ost-agent promote "<node>" ...            move a node to validated (the agent cannot)
 *   ost-agent debt [--vault DIR]              evidence each solution still owes + unbounded results + unfixed thresholds
 *   ost-agent critic [--vault DIR]            attack the tree: every claim that outruns its backing, and what would settle it
 *   ost-agent judge-panel [--vault DIR]       three judges name each solution's riskiest assumption; disagreement is the signal
 *   ost-agent tournament [<solutions...>]     eliminate on refuted recorded results only; the set shrinks, nothing is crowned
 *   ost-agent canary --incumbent C --candidate C  run two commands over the same input side by side; the incumbent never stops
 *   ost-agent lanes [--vault DIR]             assumption tests by the human minutes they cost
 *   ost-agent lanes --flag-cautious <who>     bulk: humans-required for every test naming an outside person
 *   ost-agent lane "<test>" --set <lane> ...  classify one test into a lane
 *   ost-agent asks [--vault DIR]              the standing queue of pending asks, aged, with the command that clears each
 *   ost-agent dispose "<subject>" ...        settle one item so no work bucket lists it again (--reopen reverses)
 *   ost-agent dispositions [--vault DIR]     every item currently settled, dated and attributed
 *   ost-agent suppress "<subject>" ...       decline one item until a machine-checkable fact flips (it revives by itself)
 *   ost-agent suppressions [--vault DIR]     every suppression, with whether its condition still holds right now
 *   ost-agent gate "<solution>" [--vault DIR] block building against untested assumptions
 *   ost-agent verify "<test>" --repo DIR      run a test's instrument; record red/green as an observed fact
 *   ost-agent buildable ["<solution>"]        is it defined well enough to build, and against what command?
 *   ost-agent buildable "<s>" --repo DIR      …and is the recorded red still red, or was the ticket spent?
 *   ost-agent stranded [--also DIR]           evidence no node cites, split by which fix would clear it
 *   ost-agent search "<glob>" [--vault DIR]   grep the node bodies; a subject it could not read is never a zero
 *   ost-agent capability [--repo DIR]         what each builder can do, read off the commits already written
 *   ost-agent preflight [--transcripts DIR]   did the callers whose calls failed already know they were unsure?
 *   ost-agent searches [--transcripts DIR]    were the searches over node text literal, and did their text come from the tree?
 *   ost-agent path-failures [--transcripts D] which of the path failures a pass hit came through a tool this repo controls?
 *   ost-agent manifest [--vault DIR]          every precondition the tool schemas can state, before you compose a call
 *   ost-agent refusals [--transcripts DIR]    how many of the refusals a pass hit a schema-derived manifest could have named
 *   ost-agent channels [--vault DIR]          every drop folder, its last delivery, and what has gone silent
 *   ost-agent friction "<note>" [--vault DIR] file friction at the point of pain
 *   ost-agent propose-rule "<rule>" ...       draft a change to the agent's own ruleset, with friction evidence attached
 *   ost-agent proposals [--vault DIR]         the review queue: every ruleset proposal and its status
 *   ost-agent proposal "<id>" --accept -b W   decide one pending proposal in one action (humans only)
 *   ost-agent corrections [--state DIR]       refusals this workspace already paid for, for the next session to read
 *   ost-agent claim "<work>" --briefing F     take the work before building it, so a second pass sees it is taken
 *   ost-agent next-build [--rewrite F]        the standing Next Build reading at its one address: read it, or supersede it keeping every prior reading
 *   ost-agent ledger [--publish F]            the whole-tree ranked ledger: every rankable node in one order, each row carrying the reason it sits there — a reason that cites nothing is refused a rank
 *   ost-agent briefing [--vault DIR]          the standing tree briefing, regenerated in full from the tree — teaches the tree back to a cold reader
 *   ost-agent bank-question "<q>" ...         bank a fork instead of stopping at it, costed by the work it holds up
 *   ost-agent authority                       the standing contract: which classes of decision compute may take alone
 *   ost-agent allowlist --skill F --settings F  derive a run's permission grant from the skill's own allowed-tools
 *   ost-agent grants --skill F --settings F   name every tool a run declares that its grant does not cover
 *   ost-agent build-check --repo DIR          does the tree a run inherited actually build? checked before work is planned on it
 *   ost-agent ship --repo DIR                 run the gates locally and merge the branch if they are green
 *   ost-agent loop due|start|step|seal        unattended firing: cadence, lock, ceiling, health
 *   ost-agent mcp [--vault DIR]               stdio MCP server (no API key needed)
 *
 * `--vault` is optional everywhere it appears. Omitted, it resolves through
 * `ost.vault.yaml` — the pointer file a project commits at its root to say where
 * its tree lives — before falling back to `$OST_VAULT` and then the current
 * directory. See `src/cli/vault-option.ts`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { buildPassContext } from "../runner/context.js";
import { readConfig } from "../config/load.js";
import { diagnoseSetup, formatSetupDiagnosis } from "../config/setup-check.js";
import { ailingChannels, allChannels, channelHealth, renderChannels } from "../adapters/channels.js";
import { initVault } from "../runner/init.js";
import { setOutcome } from "../runner/set-outcome.js";
import { renderCheck, renderDebt, renderGate, renderStatus } from "../eval/render.js";
import { ship } from "../release/ship-repo.js";
import { BUILD_CHECK_EXIT, formatBuildCheck, inheritedTreeBuildCheck } from "../release/inherited-tree.js";
import { renderRollup, rollupTree } from "../eval/rollup.js";
import { lineageOf, renderLineage } from "../eval/lineage.js";
import { BELIEVABILITY_LADDER, type RungId } from "../knowledge/believability.js";
import { promoteNode, recordResult, retractNode, VERDICTS, type Verdict } from "../ost/results.js";
import { verifyInstrument } from "../ost/instrument.js";
import { titlesMatch } from "../ost/sanitize.js";
import { buildableSolutions, buildPermit, confirmPermit, testsAwaitingVerification } from "../eval/buildable.js";
import { applyCritic, criticPass, renderCritic } from "../eval/critic.js";
import { renderPanel, runPanel } from "../eval/judge-panel.js";
import { renderTournament, runTournament } from "../eval/tournament.js";
import { renderCanary, runCanary, type CanaryProcess } from "../eval/canary.js";
import { formatCensus, reconcileWithGit, reconcileWithUsage } from "../ost/census.js";
import { formatStrandedCensus, strandedEvidenceCensus } from "../ost/stranded.js";
import { blindnessCensus, formatBlindnessCensus, readSweepRuns, recordSweepRun } from "../ost/sweep.js";
import {
  formatSearchTotal,
  searchSubjects,
  SearchTotal,
  unread,
  type LineHit,
  type SearchOutcome,
  type SearchRequest,
} from "../ost/search.js";
import { TreeText } from "../security/tainted.js";
import { committedCapabilityProfile, formatCapabilityProfile } from "../product/capability.js";
import { formatRoutingCensus, routingRecordCensus } from "../product/routing-record.js";
import { readResourceManifest } from "../product/manifest.js";
import { formatPriorityOrder, rankBuildableWork } from "../product/planner.js";
import {
  formatPreflightCensus, preflightUncertaintyCensus, readTranscriptSessions, readUsageEvents,
} from "../telemetry/preflight.js";
import {
  formatSearchLiteralityCensus, readSearchArguments, readTreeTitles, searchLiteralityCensus,
} from "../telemetry/search-literality.js";
import {
  formatPathFailureCensus, pathFailureCensus, readPathFailures,
} from "../telemetry/path-failure-attribution.js";
import {
  formatHandExclusionCensus, handExclusionCensus, readHandExclusions,
} from "../telemetry/hand-exclusion.js";
import {
  formatRefusalCoverageCensus, refusalCoverageCensus,
} from "../telemetry/refusal-coverage.js";
import {
  generatePreflightManifest, renderPreflightManifest, type ToolSchemaLike,
} from "../security/preflight-manifest.js";
import { buildOstTools } from "../security/tools.js";
import { Vault } from "../ost/vault.js";
import { defaultTranscriptDir } from "../adapters/transcript.js";
import { cautionBacklog, flagHumansRequired, setLane, suggestCaution, triageLanes } from "../ost/lanes.js";
import { formatMigrationReport, migrateEvidenceClass } from "../ost/migrate.js";
import { readPendingAskQueue } from "../ost/pending-asks.js";
import { laneDef, LANES, type LaneId } from "../knowledge/lanes.js";
import {
  appendDisposition, DISPOSITION_KINDS, formatDispositions, isDispositionKind, latestDisposition,
  readDispositionLedger,
} from "../knowledge/dispositions.js";
import {
  appendSuppression, formatSuppressions, readSuppressionLedger, renderCondition, SUPPRESSION_CONDITION_KINDS,
} from "../knowledge/suppressions.js";
import { fileFriction, FRICTION_KINDS, type FrictionFilingKind } from "../adapters/friction.js";
import {
  decideRulesetProposal, draftRulesetProposal, effectiveRuleset, PROPOSABLE_SECTIONS, PROPOSALS_DIR,
  readRulesetProposals, type ProposableSection,
} from "../knowledge/ruleset-proposal.js";
import { createLazyOstMcpServer, MCP_TOOL_NAMES } from "../mcp/server.js";
import { vaultReadiness } from "../mcp/bootstrap.js";
import { gitCommit } from "../git/safe-git.js";
import { runAllowlistGenerator } from "../security/allowlist-generator.js";
import { runGrantPreflight } from "../runner/grant-preflight.js";
import { REQUIRED_TOOLS_EXIT, checkRequiredTools } from "../mcp/required-tools.js";
import { TOOL_SURFACE_PREFLIGHT_EXIT, checkToolSurfaces } from "../runner/tool-surface-preflight.js";
import { loopStateDir, workingTreeStatus, type VaultTreeStatus } from "../loop/state.js";
import { bankQuestion, readQuestionBank } from "../loop/question-bank.js";
import {
  classifyEncounter,
  formatConsequenceBatch,
  validateConsequenceSet,
  type ConsequenceItem,
  type ConsequenceSet,
} from "../loop/premise-consequence.js";
import { renderAuthorityContract } from "../loop/authority-contract.js";
import { renderHostSurfaces } from "../security/host-delegation.js";
import {
  DEFAULT_QUIET_MINUTES, emptyCorrectionsLedger, readLedger, recordCorrections, renderCorrections,
} from "../loop/corrections.js";
import {
  CLAIM_EXIT, DEFAULT_CLAIM_TTL_HOURS, claimWork, liveClaims, readBriefingFile, releaseClaim,
  renderClaim, renderClaims, resolveWorkItem,
} from "../loop/claim.js";
import { nextBuildPath, readBriefing, renderBriefing, rewriteBriefing } from "../ost/briefing.js";
import { publishRankedLedger, rankedLedgerPath, readRankedLedger, type LedgerRowInput } from "../ost/ranked-ledger.js";
import { composeStandingBriefing, regenerateStandingBriefing, standingBriefingPath } from "../ost/standing-briefing.js";
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

/**
 * Rows for `ledger --publish`: a JSON array of `{title, reason}`, in the
 * proposed order. Shape errors are named here so a malformed file fails as
 * itself rather than as a refusal from the write boundary.
 */
function readLedgerRowsFile(file: string): LedgerRowInput[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${file}: expected a JSON array of {title, reason} rows`);
  return parsed.map((row, i) => {
    const r = row as { title?: unknown; reason?: unknown };
    if (typeof r?.title !== "string" || r.title.trim().length === 0) {
      throw new Error(`${file}: row ${i} has no title`);
    }
    if (r.reason !== undefined && typeof r.reason !== "string") {
      throw new Error(`${file}: row ${i} ("${r.title}") has a non-string reason`);
    }
    return { title: r.title, reason: r.reason };
  });
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

interface ClaimCliOptions {
  briefing: string;
  session?: string;
  state?: string;
  ttlHours?: string;
  release?: boolean;
  list?: boolean;
  vault: string;
}

interface NextBuildCliOptions {
  rewrite?: string;
  date?: string;
  path?: boolean;
  history?: boolean;
  vault: string;
}

interface LedgerCliOptions {
  publish?: string;
  date?: string;
  path?: boolean;
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
    switch (r.toolEnabling.status) {
      case "enabled":
        console.log(`  tools: enabled by writing ${r.toolEnabling.file} — opening this vault now launches ost-agent's tools`);
        break;
      case "already-enabled":
        console.log(`  tools: already enabled (by ${r.toolEnabling.enabledBy})`);
        break;
      case "skipped":
        console.log(`  ⚠ tools: NOT enabled automatically — ${r.toolEnabling.reason}`);
        break;
    }
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
async function commitFiling(vaultDir: string, before: VaultTreeStatus, written: string, label = "friction"): Promise<FilingCommit> {
  if (before.kind === "unknown") return { kind: "no-history", reason: before.reason };
  const foreign = before.kind === "dirty" ? entriesRequiringAHuman(before.entries) : [];
  if (foreign.length > 0) return { kind: "left-dirty", entries: foreign };
  try {
    const r = await gitCommit(vaultDir, `${label}: ${path.basename(written)}`);
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

/** Shared by `propose-rule` and `proposal`: report what happened to the commit, in the filer's terms. */
function reportFilingCommit(result: FilingCommit, written: string): void {
  if (result.kind === "committed") {
    console.log(`  committed ${result.sha} — it is in the vault's history and the working tree is clean again`);
    return;
  }
  if (result.kind === "left-dirty") {
    console.log(`  NOT committed: ${result.entries.length} path(s) were already dirty here before this write:`);
    for (const e of result.entries.slice(0, 5)) console.log(`      ${e}`);
    console.log("  Committing would have put those into history under this write's name. Deal with them and commit,");
    console.log("  or `ost-agent loop start` will refuse the next firing over this file as well.");
    return;
  }
  console.log(`  NOT committed (${result.reason}).`);
  console.log(`  The file is on disk at ${written} and nothing has versioned it.`);
}

program
  .command("propose-rule")
  .description("draft a change to the agent's own ruleset as a reviewable proposal (pending until a human decides it)")
  .argument("<rule>", "the proposed rule text, in full")
  .requiredOption("-s, --section <section>", `which rule list it belongs to — one of: ${PROPOSABLE_SECTIONS.join(", ")}`)
  .requiredOption("-w, --why <text>", "rationale — what kept going wrong, in the drafter's words")
  .requiredOption(
    "-e, --evidence <id>",
    "a friction filing that triggered this (INBOX:friction/… id or filename); repeatable",
    collect,
    [] as string[],
  )
  .option("-r, --replaces <text>", "exact text of the current rule this replaces (omit to add a new rule)")
  .option("--source <text>", "who is drafting (loop, process, session)")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action(
    async (
      rule: string,
      opts: { section: string; why: string; evidence: string[]; replaces?: string; source?: string; vault: string },
    ) => {
      // Read BEFORE the write, on `friction`'s argument verbatim.
      const before = workingTreeStatus(opts.vault);
      const proposal = draftRulesetProposal(opts.vault, {
        section: opts.section as ProposableSection,
        rule,
        replaces: opts.replaces,
        rationale: opts.why,
        evidence: opts.evidence,
        source: opts.source,
      });
      console.log(`drafted "${proposal.id}" (${proposal.section}, ${proposal.replaces !== undefined ? "replaces a rule" : "adds a rule"})`);
      console.log(`  evidence: ${proposal.evidence.join(", ")}`);
      console.log("  PENDING — it changes nothing until a human runs:");
      console.log(`    ost-agent proposal "${proposal.id}" --accept -b "<you>"   # or --reject`);
      reportFilingCommit(await commitFiling(opts.vault, before, proposal.file, "proposal"), proposal.file);
    },
  );

program
  .command("proposals")
  .description("list every ruleset proposal and its status — the review queue for one-click adoption")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((opts: { vault: string }) => {
    const { proposals, unreadable } = readRulesetProposals(opts.vault);
    if (proposals.length === 0 && unreadable.length === 0) {
      console.log(`No ruleset proposals in ${PROPOSALS_DIR}/ — the agent drafts one with \`ost-agent propose-rule\`.`);
      return;
    }
    const pending = proposals.filter((p) => p.status === "pending");
    console.log(`Proposals: ${proposals.length} (${pending.length} pending)`);
    for (const p of proposals) {
      console.log("");
      console.log(`[${p.status}] ${p.id}`);
      console.log(`  ${p.section}: ${p.replaces !== undefined ? "replace" : "add"} — ${p.rule}`);
      console.log(`  why: ${p.rationale}`);
      console.log(`  evidence: ${p.evidence.join(", ")}`);
      if (p.decidedBy) console.log(`  decided by ${p.decidedBy} at ${p.decidedAt ?? "?"}`);
      if (p.status === "pending") console.log(`  → ost-agent proposal "${p.id}" --accept -b "<you>"   # or --reject`);
    }
    if (unreadable.length > 0) {
      console.log("");
      console.log(`⚠ ${unreadable.length} file(s) in ${PROPOSALS_DIR}/ could not be read as proposals: ${unreadable.join(", ")}`);
    }
  });

program
  .command("proposal")
  .description("accept or reject one pending ruleset proposal (humans only — the agent must never adopt its own proposal)")
  .argument("<id>", "the proposal id, as `ost-agent proposals` lists it")
  .option("--accept", "adopt it — the next pass runs the amended ruleset")
  .option("--reject", "decline it — the ruleset stays exactly as it is")
  .requiredOption("-b, --by <who>", "who decided — an unattributed adoption cannot be told apart from a fabricated one")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action(async (id: string, opts: { accept?: boolean; reject?: boolean; by: string; vault: string }) => {
    if (Boolean(opts.accept) === Boolean(opts.reject)) {
      throw new Error("say which way it goes: exactly one of --accept or --reject");
    }
    const before = workingTreeStatus(opts.vault);
    const decided = decideRulesetProposal(opts.vault, id, {
      decision: opts.accept ? "accept" : "reject",
      by: opts.by,
    });
    console.log(`${decided.status}: "${decided.id}" by ${decided.decidedBy}`);
    if (decided.status === "accepted") {
      const { adopted, problems } = effectiveRuleset(opts.vault);
      console.log(`  the next pass runs the amended ruleset (${adopted.length} adopted proposal(s) now fold in)`);
      for (const problem of problems) console.log(`  ⚠ ${problem}`);
      console.log("  durable form: port the rule into src/knowledge/ruleset.ts + `npm run gen:skill` — the generated");
      console.log("  SKILL.md renders from source alone, so skill-driven sessions see the rule only once it is ported.");
    } else {
      console.log("  nothing changed, which is the point: a rejected proposal never touches the ruleset");
    }
    reportFilingCommit(await commitFiling(opts.vault, before, decided.file, "proposal-decision"), decided.file);
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

/**
 * The other half of a tightening. A new invariant flags every node written
 * before it, and an append-only surface offers no compliant path back — the
 * evidence-class rule landed on all 57 then-existing meta-vault nodes with no
 * generic remediation. This command is where the author of a tightening ships
 * the mechanical remediation: frontmatter-only edits (prose byte-identical, a
 * test holds it there), a node-by-node report, and a refusal list naming what
 * only a human may decide. Dry run by default; `--write` applies and commits.
 */
program
  .command("migrate")
  .description("run the migration a tightening should have shipped with — reports by default, applies and commits with --write")
  .argument("<rule>", "the check rule to remediate (available: evidence-class)")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .option("--write", "apply the changes and commit them (default: report what would change)")
  .action(async (rule: string, opts: { vault: string; write?: boolean }) => {
    if (rule !== "evidence-class") {
      console.error(
        `no migration for "${rule}" — available: evidence-class. A tightening with no entry here shipped without the half that brings the existing tree with it.`,
      );
      process.exitCode = 1;
      return;
    }
    const dir = path.resolve(opts.vault);
    if (opts.write) {
      // Same stance as `friction`: gitCommit stages with `git add -A`, so from a
      // dirty tree it would put a stranger's edits into history under the
      // migration's name — the one attribution a meaning-preserving pass cannot afford.
      const before = workingTreeStatus(dir);
      const foreign = before.kind === "dirty" ? entriesRequiringAHuman(before.entries) : [];
      if (foreign.length > 0) {
        console.error(`refusing to migrate: ${foreign.length} path(s) were already dirty here before this run:`);
        for (const f of foreign) console.error(`    ${f}`);
        console.error("  Committing would put those into history under the migration's name. Deal with them and re-run.");
        process.exitCode = 1;
        return;
      }
    }
    const report = migrateEvidenceClass(dir, { write: opts.write });
    console.log(formatMigrationReport(report));
    if (opts.write && report.touched.length > 0) {
      const r = await gitCommit(dir, `migrate(${report.rule}): ${report.touched.length} node(s) to the floor rung — frontmatter only, prose untouched`);
      console.log(
        r.committed
          ? `  committed ${r.sha.slice(0, 8)} — every touched node is named above and recoverable from history`
          : "  NOT committed — git saw nothing to commit; something is ignoring these files, and nothing has versioned this rewrite",
      );
    }
    // A non-empty refusal list means the tree is not fully across; the exit
    // code says so, so a script cannot read a partial migration as a finished one.
    if (report.humansRequired.length > 0) process.exitCode = 1;
  });

program
  .command("setup-check")
  .description("can a session opened on this project launch the vault's tools? names the missing file and the exact line if not")
  .argument("[dir]", "the project directory a session opens (default: $CLAUDE_PROJECT_DIR, else the current directory)")
  .action((dir?: string) => {
    // The gap this diagnoses lives in the *project* the session has open, not in
    // the vault it points at — which is why this command takes a directory
    // argument instead of `--vault`: a vault can be perfect while the project
    // beside it launches nothing. Four scheduled passes ran toolless that way.
    const project = path.resolve(dir ?? process.env.CLAUDE_PROJECT_DIR ?? ".");
    const userSettings = path.join(os.homedir(), ".claude", "settings.json");
    const d = diagnoseSetup(project, { extraSettingsFiles: [userSettings] });
    console.log(formatSetupDiagnosis(d));
    if (!d.ok) process.exitCode = 1;
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
  .command("critic")
  .description("attack the tree: for each claim that outruns its backing, the strongest case it is wrong and what would settle it (no model needed)")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .option("--annotate", "write each objection under its node's ## Issues (add-only; a charge lands once, not once per pass)")
  .action((opts: { vault: string; annotate?: boolean }) => {
    const ctx = buildPassContext(opts.vault);
    const report = criticPass(ctx.vault.readTree());
    console.log(renderCritic(report));
    if (opts.annotate) {
      const applied = applyCritic(ctx.vault, report);
      console.log(
        `\nannotated ${applied.annotated.length} node(s); ${applied.alreadyRaised.length} already carried their charge.`,
      );
    }
  });

program
  .command("judge-panel")
  .description(
    "three independent judges each name every solution's riskiest assumption; disagreement means the solution has more than one (no model needed)",
  )
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    const solutions = ctx.vault
      .readTree()
      .filter((n) => n.layer === "Solution")
      .map((n) => ({ title: n.title, body: n.body }));
    console.log(renderPanel(runPanel(solutions)));
  });

program
  .command("tournament")
  .description(
    "run a bracket of solutions against each other in rounds; a candidate is eliminated only when a test beneath it has recorded a refuted result — no round crowns a winner (no model needed)",
  )
  .argument("[candidates...]", "titles of the Solutions to run the bracket over; defaults to every Solution in the tree")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((candidateTitles: string[], opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    const tree = ctx.vault.readTree();
    const candidates = tree
      .filter((n) => n.layer === "Solution")
      .filter((n) => candidateTitles.length === 0 || candidateTitles.some((t) => titlesMatch(n.title, t)));
    console.log(renderTournament(runTournament(candidates, tree)));
  });

/**
 * A shell command as a {@link CanaryProcess}: the input string is piped in on
 * stdin, stdout is the output. A nonzero exit or a spawn failure becomes a
 * thrown error, which `runCanary` catches for the candidate and rethrows for
 * the incumbent — so an incumbent command that is already broken fails the
 * `canary` invocation instead of being silently compared against itself.
 */
function shellProcess(command: string): CanaryProcess<string, string> {
  return (input: string) => {
    const result = spawnSync(command, { shell: true, input, encoding: "utf8" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`exit ${result.status ?? "signal"}: ${(result.stderr || "").trim() || "(no stderr)"}`);
    }
    return result.stdout;
  };
}

program
  .command("canary")
  .description(
    "run the incumbent command and a changed candidate over the same input, side by side, without stopping the incumbent — for a human to judge and adopt or discard",
  )
  .requiredOption("--incumbent <command>", "the command already trusted, run through the shell")
  .requiredOption("--candidate <command>", "the changed command to compare against it, run through the shell")
  .option("--input <file>", "file piped to both commands on stdin (defaults to empty input)")
  .action(async (opts: { incumbent: string; candidate: string; input?: string }) => {
    const input = opts.input ? fs.readFileSync(opts.input, "utf8") : "";
    const result = await runCanary(input, shellProcess(opts.incumbent), shellProcess(opts.candidate));
    console.log(renderCanary(result));
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

/*
 * `asks` — the standing queue of pending asks, visited at whatever cadence suits
 * the operator. Everything here is derived (lanes + the ask ledger), so the
 * queue clears itself: recording a result drops an entry without anyone marking
 * it answered. Age leads because it is the one thing the run that filed the ask
 * could not know — it was gone before the days elapsed.
 */
program
  .command("asks")
  .description("the standing queue of pending asks — aged, oldest first, each with the command that clears it")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    const queue = readPendingAskQueue(path.resolve(opts.vault), ctx.vault.readTree());
    if (queue.length === 0) {
      console.log("The queue is empty — nothing is waiting on you.");
      console.log("(An unlabelled test is triage backlog, not an ask; see `ost-agent lanes`.)");
      return;
    }
    console.log(`${queue.length} pending ask(s), oldest first. Each clears itself once you run its command.\n`);
    for (const ask of queue) {
      const age = ask.ageDays === null ? "age unknown (no ask on record)" : `${ask.ageDays} day(s) waiting`;
      console.log(`- ${ask.test}  [${ask.lane ?? "unclassified"}] — ${age}`);
      if (ask.why) console.log(`    why: ${ask.why}`);
      console.log(`    clear it: ${ask.command}`);
    }
  });

/*
 * `dispose` and `dispositions` — the write path and the audit surface for the one
 * ledger that says "settled", and the reason both live on the CLI rather than on the
 * agent's tool surface.
 *
 * Every other item leaves a work list by something checkable: code shipped, an
 * instrument attached, a node created. A disposition removes work by asserting a
 * sentence about it — and it would be written by the party whose budget the work
 * costs. That is the same shape as the self-validation the whole tool surface is
 * built to refuse, so the write sits where `result` and `promote` sit (B1/B2): a
 * command a human runs. Whether a pass should ever be able to dismiss its own work
 * list is a question about operators, not about code, and it is open — "Show five
 * operators a pass's dismissed-work list and ask whether they would have let it
 * stand" has not run.
 */
program
  .command("dispose")
  .description("settle one item so no bucket lists it again — or reopen one that was settled wrongly")
  .argument("<subject>", "an evidence id, or a node title, exactly as the work list printed it")
  .requiredOption("-b, --by <who>", "who settled it — an unattributed dismissal is unauditable")
  .requiredOption("-w, --why <text>", "why it is settled, in the writer's words; this sentence is the whole audit")
  .option(
    "-k, --kind <kind>",
    `what the subject is: ${DISPOSITION_KINDS.join(", ")} (for the auditor; the work lists read only the subject)`,
  )
  .option("--reopen", "put the subject back on its bucket — a wrong disposition is reversed, never deleted")
  .option(
    "--corroborates <node>",
    "typed verdict: the item was read and counted toward this existing node — the one verdict that can strengthen a node's evidence later",
  )
  .option("--no-genuine-need", "typed verdict: the item was read and reveals no need anyone should act on")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action(
    (
      subject: string,
      opts: { by: string; why: string; kind?: string; reopen?: boolean; corroborates?: string; genuineNeed?: boolean; vault: string },
    ) => {
      // Commander reads any `--no-X` flag as the negation of `X`: passing
      // `--no-genuine-need` sets `genuineNeed` to false (and its absence leaves the
      // default, true). The flag keeps the verdict's own name anyway — the operator
      // types the vocabulary the ledger stores — at the cost of this one translation.
      const noGenuineNeed = opts.genuineNeed === false;
      // The verdicts are exclusive by meaning, not just by flag: "counted toward a
      // node" and "nothing here" are the two readings the typed field exists to keep
      // apart, so an entry carrying both would be exactly the blur it prevents. And a
      // reopen disputes an acknowledgement rather than making one, so a verdict on it
      // has no entry to live on.
      if (opts.corroborates !== undefined && noGenuineNeed) {
        console.error("ost-agent dispose: one verdict per acknowledgement — --corroborates and --no-genuine-need are different findings");
        process.exitCode = 1;
        return;
      }
      if (opts.reopen && (opts.corroborates !== undefined || noGenuineNeed)) {
        console.error("ost-agent dispose: a reopen disputes an acknowledgement, it does not make one — drop the verdict flag");
        process.exitCode = 1;
        return;
      }
      // `kind` is required on a close and irrelevant on a reopen: the reopen names a
      // subject the ledger already carries a kind for, and asking again is one more
      // chance for the two entries to disagree about the same subject.
      const existing = latestDisposition(readDispositionLedger(opts.vault), subject);
      const kind = opts.kind ?? existing?.kind;
      if (!isDispositionKind(kind)) {
        console.error(
          `ost-agent dispose: --kind must be one of ${DISPOSITION_KINDS.join(", ")}` +
            (opts.reopen ? " (the ledger carries no earlier entry for that subject to take it from)" : ""),
        );
        process.exitCode = 1;
        return;
      }
      const state = opts.reopen ? "reopened" : "closed";
      const verdict = opts.corroborates !== undefined ? ("corroborates" as const) : noGenuineNeed ? ("no-genuine-need" as const) : undefined;
      appendDisposition(opts.vault, { subject, kind, state, reason: opts.why, by: opts.by, verdict, node: opts.corroborates });
      console.log(
        opts.reopen
          ? `reopened "${subject}" — it is back on its ${kind} bucket.`
          : `settled "${subject}" (${kind}) — no bucket will list it again.\n` +
              (verdict === "corroborates"
                ? `  Recorded as corroborating "${opts.corroborates}" — the one verdict that can strengthen that node's evidence later.\n`
                : verdict === "no-genuine-need"
                  ? "  Recorded as revealing no genuine need — it can strengthen nothing.\n"
                  : "") +
              "  It is still counted and named on every ost_next_work response, under withheldByDisposition.\n" +
              '  Reverse it with `ost-agent dispose "<subject>" --reopen --by <you> --why "<why>"`.',
      );
    },
  );

program
  .command("dispositions")
  .description("every item currently settled, dated and attributed — the dismissed-work list, in bulk")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((opts: { vault: string }) => {
    console.log(formatDispositions(readDispositionLedger(opts.vault)));
  });

/*
 * `suppress` and `suppressions` — the write path and the audit surface for the ledger
 * of declines that expire on a fact (`src/knowledge/suppressions.ts`).
 *
 * A suppression is lighter than a disposition — it postpones the offer rather than
 * settling the work, and the fact flipping reverses it with no command — but the
 * write still sits on the CLI and off the agent's tool surface, for the residual
 * risk no condition vocabulary can close: a pass choosing a condition because it
 * will never flip. Whether a pass should hold this write is a question about
 * operators reading suppressions over time, and it has not been answered.
 */
program
  .command("suppress")
  .description("decline one item until a machine-checkable fact flips — it leaves every work bucket while the condition holds and comes back by itself")
  .argument("<subject>", "an evidence id, or a node title, exactly as the work list printed it")
  .requiredOption(
    "--holds-while <kind>",
    `the fact the decline stands on, from the closed vocabulary: ${SUPPRESSION_CONDITION_KINDS.join(", ")} — prose is refused, because a condition nobody can evaluate is a delete`,
  )
  .option("--node <title>", "the node whose fact the condition reads (defaults to the subject itself)")
  .option("--status <status>", "for status-is: the status the suppression holds on, e.g. shipped")
  .option("--lane <lane>", "for lane-is: the lane the suppression holds on, e.g. humans-required")
  .option("--section <name>", "for section-missing: the `## <section>` whose absence the suppression holds on, e.g. Format")
  .requiredOption("-b, --by <who>", "who declined it — the condition-that-never-flips abuse is caught by a human reading these, and the human needs a name")
  .requiredOption("-w, --why <text>", "why it was declined, in words — the condition says when the decline ends, not why it started")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action(
    (
      subject: string,
      opts: { holdsWhile: string; node?: string; status?: string; lane?: string; section?: string; by: string; why: string; vault: string },
    ) => {
      let rec;
      try {
        rec = appendSuppression(opts.vault, {
          subject,
          condition: {
            holdsWhile: opts.holdsWhile,
            node: opts.node ?? subject,
            status: opts.status,
            lane: opts.lane,
            section: opts.section,
          },
          reason: opts.why,
          by: opts.by,
        });
      } catch (e) {
        console.error(`ost-agent suppress: ${e instanceof Error ? e.message : String(e)}`);
        process.exitCode = 1;
        return;
      }
      console.log(
        `suppressed "${subject}" ${renderCondition(rec.condition)}.\n` +
          "  No bucket will offer it while that fact holds; the moment it flips, the item is back — no command clears it.\n" +
          "  It stays counted and named on every ost_next_work response, under suppressedByCondition.",
      );
    },
  );

program
  .command("suppressions")
  .description("every suppression on the ledger, with whether its condition still holds — read for the one that can never flip")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((opts: { vault: string }) => {
    const tree = buildPassContext(opts.vault).vault.readTree();
    const index = new Map(tree.map((n) => [n.title, n]));
    console.log(formatSuppressions(readSuppressionLedger(opts.vault), index));
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
  .command("search")
  .argument("<glob>", "glob matched against each line of every node body — `*` and `?` and `{a,b}`")
  .description("grep the node bodies, reporting what it could not read rather than counting it as zero")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((glob: string, opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    const census = ctx.vault.readTreeCensus();

    // The census already knows which files it could not parse, and those are
    // unread subjects rather than absent ones. Before this they left the walk as
    // a silently smaller denominator, which is the same false zero one layer
    // down: a search over a tree with an unparseable node reported hits over the
    // nodes that happened to parse and said nothing about the one it never saw.
    const dropped = SearchTotal.over<LineHit>(
      census.unreadable.map((u) => unread<LineHit>(u.file, "unreadable", u.reason)),
    );
    // Every node title here came out of the tree, and the path below used to be
    // `${n.title}.md` — a sentence a person wrote, interpolated into a filesystem
    // path. `TreeText` is what stops that: the title arrives wrapped and the only
    // way to a path is `forPathUnder`, which builds one or refuses. A refusal is
    // an unread subject rather than a thrown error, for the same reason a
    // malformed pattern is: a title this walk could not turn into a file is a
    // subject it did not examine, and reporting it as examined-with-no-hits is
    // the miscount this whole module exists to prevent.
    const titles = census.nodes.map((n) =>
      TreeText.fromTree(n.title, { file: `${n.title}.md`, field: "title" }),
    );
    const requests: SearchRequest[] = [];
    const unbuildable: SearchOutcome<LineHit>[] = [];
    for (const title of titles) {
      const built = title.forPathUnder(ctx.vault.root);
      if (built.ok) requests.push({ subject: title.forMessage(), file: built.path, pattern: glob });
      else unbuildable.push(unread<LineHit>(title.forMessage(), "unreadable", built.reason));
    }

    const combined = SearchTotal.merge(
      dropped,
      SearchTotal.over(unbuildable),
      searchSubjects(requests),
    );

    // The count, obtained the only way there is: by saying what happens to the
    // subjects that went unread. Here they are reported beside it rather than
    // folded into it, which is what `formatSearchTotal` prints below.
    const hits = combined.resolve<number>({
      whenComplete: (found) => found.length,
      whenUnread: (_unread, found) => found.length,
    });

    try {
      recordSweepRun(ctx.dir, {
        sweep: "search",
        at: new Date().toISOString(),
        subject: combined.toSweepSubject(),
        findings: hits,
        outcome: combined.blind ? "blind" : hits > 0 ? "findings" : "clean",
      });
    } catch (e) {
      console.error(`(this run was not recorded: ${e instanceof Error ? e.message : String(e)})`);
    }

    const text = formatSearchTotal(`search ${JSON.stringify(glob)}`, combined);
    // A search that read nothing exits non-zero for the same reason a blind sweep
    // does: it has no denominator to have found nothing over.
    if (combined.blind) {
      console.error(text);
      process.exitCode = 1;
      return;
    }
    console.log(text);
    for (const s of combined.examinedSubjects) {
      for (const h of s.hits) console.log(`  ${h.subject}:${h.line}: ${h.text.trim()}`);
    }
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
  .command("routing-record")
  .description(
    "capability estimated from what each collaborator was asked to do and what came back: replays every " +
      "repository's whole committed record, classifies each artifact into a work class, and counts how many " +
      "classes were ever routed to more than one collaborator — the comparison the estimate rests on",
  )
  .option("--repo <dir>", "a repository whose routing record to read (repeatable)", collect, [])
  .action(async (opts: { repo: string[] }) => {
    const repos = opts.repo.length ? opts.repo : ["."];
    const census = await routingRecordCensus(repos.map((r) => path.resolve(r)));
    console.log(formatRoutingCensus(census));
    // A class no artifact was ever routed to more than one collaborator for is
    // absent from the record, not merely unlucky — the same reasoning as the
    // capability profile's exit code: a finding worth acting on has to reach an
    // automation through the exit, not just the printed line.
    if (census.verdict === "refuted") process.exitCode = 1;
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
  .command("searches")
  .description("how many searches over node text were literal lookups, and how many of those arguments came out of the tree")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .option(
    "--transcripts <dir>",
    "a directory of session transcripts to read the searches out of (repeatable); defaults to this project's own",
    collect,
    [],
  )
  .action((opts: { vault: string; transcripts: string[] }) => {
    // Deliberately NOT `buildPassContext`, for the reason `preflight` gives: this
    // reads transcripts and node titles and answers a question about them, and
    // opening a Vault handle would create the directory a mistyped path names.
    const vault = path.resolve(opts.vault);
    const dirs = opts.transcripts.length ? opts.transcripts : [defaultTranscriptDir(vault)];
    const sessions = dirs.flatMap((d) => readTranscriptSessions(path.resolve(d)));
    const { args, unread, calls } = readSearchArguments(sessions, { vaultDir: vault });
    const census = searchLiteralityCensus(args, readTreeTitles(vault), { sessionsRead: sessions.length, calls, unread });
    console.log(formatSearchLiteralityCensus(census));
    // A census that read no argument has not found "no patterns" — it has found
    // nothing, and an automation has to learn that through the exit code.
    if (census.args === 0) process.exitCode = 1;
  });

program
  .command("exclusions")
  .description("how many distinct test files were ever suppressed by hand — the census behind committing a quarantine list")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .option(
    "--transcripts <dir>",
    "a directory of session transcripts to read the exclusions out of (repeatable); defaults to this project's own",
    collect,
    [],
  )
  .action((opts: { vault: string; transcripts: string[] }) => {
    // Deliberately NOT `buildPassContext`, for the reason `preflight` gives: this
    // reads transcripts and answers a question about them, and opening a Vault
    // handle would create the directory a mistyped path names.
    const vault = path.resolve(opts.vault);
    const dirs = opts.transcripts.length ? opts.transcripts : [defaultTranscriptDir(vault)];
    const sessions = dirs.flatMap((d) => readTranscriptSessions(path.resolve(d)));
    const { exclusions, unread, invocations, narrowed } = readHandExclusions(sessions);
    const census = handExclusionCensus(exclusions, { sessionsRead: sessions.length, invocations, narrowed, unread });
    console.log(formatHandExclusionCensus(census));
    // Reading no runner invocation is not "nobody excludes anything" — it is a
    // sweep that could not read its subject, and an automation has to learn that
    // through the exit code rather than off a report that looks clean.
    if (census.invocations === 0) process.exitCode = 1;
  });

program
  .command("path-failures")
  .description("how many of the path failures a pass hit arrived through a tool this repository controls — the census behind improving the first failure")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .option(
    "--transcripts <dir>",
    "a directory of session transcripts to read the failures out of (repeatable); defaults to this project's own",
    collect,
    [],
  )
  .action((opts: { vault: string; transcripts: string[] }) => {
    // Deliberately NOT `buildPassContext`, for the reason `preflight` gives: this
    // reads transcripts and answers a question about them, and opening a Vault
    // handle would create the directory a mistyped path names.
    const vault = path.resolve(opts.vault);
    const dirs = opts.transcripts.length ? opts.transcripts : [defaultTranscriptDir(vault)];
    const sessions = dirs.flatMap((d) => readTranscriptSessions(path.resolve(d)));
    const { failures, calls, errors } = readPathFailures(sessions);
    const census = pathFailureCensus(failures, { sessionsRead: sessions.length, calls, errors });
    console.log(formatPathFailureCensus(census));
    // No path-shaped failure is not "the messages are fine" — it is a sweep that
    // found nothing to read, and an automation has to learn that through the exit
    // code rather than off a report that looks clean.
    if (census.pathShaped === 0) process.exitCode = 1;
  });

program
  .command("manifest")
  .description("every precondition this tool surface can state about itself, folded from the schemas — read it before composing a call")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((opts: { vault: string }) => {
    // Probe-only: the manifest is folded from schemas and reads nothing in the
    // vault, so the Vault handle is opened with `create: false` for the reason
    // the MCP server's readiness check does — probing a directory must never
    // create it, and a mistyped `--vault` here would otherwise leave one behind.
    const dir = path.resolve(opts.vault);
    const tools = buildOstTools({ vault: new Vault(dir, { create: false }), dir, remote: { enabled: false } });
    console.log(renderPreflightManifest(generatePreflightManifest(tools as unknown as ToolSchemaLike[])));
  });

program
  .command("refusals")
  .description("how many of the refusal classes a pass actually hit a schema-derived manifest could have named — the census behind the preflight manifest")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .option(
    "--transcripts <dir>",
    "a directory of session transcripts to read the refusals out of (repeatable); defaults to this project's own",
    collect,
    [],
  )
  .action((opts: { vault: string; transcripts: string[] }) => {
    // Deliberately NOT `buildPassContext`, for the reason `preflight` gives: this
    // reads transcripts and answers a question about them, and opening a writable
    // Vault handle would create the directory a mistyped path names.
    const vault = path.resolve(opts.vault);
    const dirs = opts.transcripts.length ? opts.transcripts : [defaultTranscriptDir(vault)];
    const sessions = dirs.flatMap((d) => readTranscriptSessions(path.resolve(d)));
    const { failures } = readPathFailures(sessions);
    const tools = buildOstTools({ vault: new Vault(vault, { create: false }), dir: vault, remote: { enabled: false } });
    const census = refusalCoverageCensus(failures, generatePreflightManifest(tools as unknown as ToolSchemaLike[]));
    console.log(formatRefusalCoverageCensus(census));
    // No recognised refusal is not "the surface states everything" — it is a
    // sweep that found nothing to read, and an automation has to learn that
    // through the exit code rather than off a report that looks clean.
    if (census.classes.length === 0) process.exitCode = 1;
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
  .command("claim")
  .argument("[work]", "how this pass words the work it is about to start")
  .description(
    "take the work item before building it: the naming is resolved against the briefing both passes read, so a " +
      "second pass that words the same item differently is still told it is taken",
  )
  .requiredOption("--briefing <file>", "the document that names the candidate work — the shared vocabulary")
  .option("--session <id>", "who is claiming (default: $OST_SESSION_ID)")
  .option("--state <dir>", "where the ledger lives (default: <vault>/.git/ost-agent)")
  .option("--ttl-hours <n>", `how long the claim holds without renewal (default ${DEFAULT_CLAIM_TTL_HOURS})`)
  .option("--release", "give the item back instead of taking it")
  .option("--list", "print what is claimed and take nothing")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((work: string | undefined, opts: ClaimCliOptions) => {
    /*
     * Fail-closed on every input it needs, because each degradation has the same
     * shape: a `claim` that answers 0 for a reason unrelated to the work being
     * free is a pass waved through, which is the failure the command exists to
     * stop. So an unlocatable ledger, an unnamed session and an unreadable
     * briefing are all refusals rather than defaults.
     */
    const state = opts.state ? path.resolve(opts.state) : loopStateDir(opts.vault);
    if (state === null) {
      console.error(
        "cannot locate a claim ledger: pass --state <dir>, or point --vault at a git checkout — the ledger lives under its .git/, never in the working tree.",
      );
      process.exitCode = CLAIM_EXIT.unresolved;
      return;
    }

    if (opts.list) {
      console.log(renderClaims(liveClaims(state)));
      return;
    }

    // A claim by nobody is worse than no claim: two passes that both default to
    // the same name look like one pass renewing, and each waves the other
    // through. There is no safe default, so there is no default.
    const session = opts.session ?? process.env.OST_SESSION_ID;
    if (!session) {
      console.error(
        "not claiming: no session named — pass --session <id> or set $OST_SESSION_ID. Two passes claiming under one name cannot exclude each other.",
      );
      process.exitCode = CLAIM_EXIT.unresolved;
      return;
    }
    if (!work) {
      console.error('not claiming: say what the work is — `ost-agent claim "<work>" --briefing <file>`.');
      process.exitCode = CLAIM_EXIT.unresolved;
      return;
    }

    let briefing: string;
    try {
      briefing = readBriefingFile(opts.briefing);
    } catch (e) {
      console.error(`not claiming: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = CLAIM_EXIT.unresolved;
      return;
    }

    const hours = Number(opts.ttlHours);
    const ttlMs = (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_CLAIM_TTL_HOURS) * 3_600_000;

    if (opts.release) {
      const resolution = resolveWorkItem(work, briefing);
      if (!resolution.resolved) {
        console.error(`not released: ${resolution.reason}`);
        process.exitCode = CLAIM_EXIT.unresolved;
        return;
      }
      const released = releaseClaim(state, resolution.identity.key, session);
      console.log(
        released
          ? `RELEASED "${resolution.identity.label}" — ${session} no longer holds it.`
          : `NOT RELEASED "${resolution.identity.label}" — ${session} does not hold it. A claim that lapsed and was retaken belongs to whoever retook it.`,
      );
      return;
    }

    const outcome = claimWork(state, { naming: work, briefing, session, ttlMs });
    console.log(renderClaim(outcome));
    if (outcome.status === "already-claimed") process.exitCode = CLAIM_EXIT.alreadyClaimed;
    else if (outcome.status === "unresolved") process.exitCode = CLAIM_EXIT.unresolved;
  });

program
  .command("next-build")
  .description(
    "the standing Next Build briefing at its one stable address (<vault>/.ost-agent/NEXT-BUILD.md): print the " +
      "current reading, or --rewrite it — the superseded reading is kept under History, never overwritten",
  )
  .option("--rewrite <file>", "supersede the current reading with this file's content")
  .option("--date <date>", "date the rewrite is recorded under (default: today, UTC)")
  .option("--path", "print the stable address and nothing else")
  .option("--history", "print every prior reading after the current one")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((opts: NextBuildCliOptions) => {
    if (opts.path) {
      console.log(nextBuildPath(opts.vault));
      return;
    }
    if (opts.rewrite) {
      let body: string;
      try {
        body = readBriefingFile(opts.rewrite);
      } catch (e) {
        console.error(`not rewriting: ${e instanceof Error ? e.message : String(e)}`);
        process.exitCode = 1;
        return;
      }
      const date = opts.date ?? new Date().toISOString().slice(0, 10);
      let address: string;
      try {
        address = rewriteBriefing(opts.vault, { date, body });
      } catch (e) {
        console.error(`not rewriting: ${e instanceof Error ? e.message : String(e)}`);
        process.exitCode = 1;
        return;
      }
      const kept = readBriefing(opts.vault).history.length;
      console.log(`REWRITTEN ${address} — current reading dated ${date}; ${kept} prior reading(s) preserved under History.`);
      return;
    }
    console.log(renderBriefing(readBriefing(opts.vault), nextBuildPath(opts.vault), opts.history === true));
  });

program
  .command("ledger")
  .description(
    "the whole-tree ranked ledger at its one stable address (<vault>/.ost-agent/RANKED-LEDGER.md): print it, or " +
      "--publish a JSON array of {title, reason} rows — a row whose reason is missing, empty, or cites no live " +
      "node title or stored evidence id is refused a rank and lands in the named unranked tail",
  )
  .option("--publish <file>", "publish this JSON array of {title, reason} rows, in the proposed order")
  .option("--date <date>", "date the ledger is published under (default: today, UTC)")
  .option("--path", "print the stable address and nothing else")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((opts: LedgerCliOptions) => {
    if (opts.path) {
      console.log(rankedLedgerPath(opts.vault));
      return;
    }
    if (opts.publish) {
      let address: string;
      try {
        const rows = readLedgerRowsFile(opts.publish);
        address = publishRankedLedger(opts.vault, rows, opts.date ?? new Date().toISOString().slice(0, 10));
      } catch (e) {
        console.error(`not publishing: ${e instanceof Error ? e.message : String(e)}`);
        process.exitCode = 1;
        return;
      }
      console.log(`PUBLISHED ${address}`);
      console.log(readRankedLedger(opts.vault));
      return;
    }
    const raw = readRankedLedger(opts.vault);
    console.log(
      raw ??
        `No ranked ledger yet — one would live at ${rankedLedgerPath(opts.vault)}. Publish the first with \`ost-agent ledger --publish <rows.json>\`.`,
    );
  });

program
  .command("briefing")
  .description(
    "the standing tree briefing at its one stable address (<vault>/.ost-agent/BRIEFING.md): regenerated in full " +
      "from the tree — where it stands, the live branch, the last week's delta, and the belief it all rests on. " +
      "Run it at the end of every pass; unlike next-build, it keeps no history of itself, because every line is " +
      "recomputed from the nodes and its history is the vault's git history",
  )
  .option("--date <date>", "the date the briefing is generated under (default: today, UTC)")
  .option("--dry-run", "print the briefing without writing it")
  .option("--path", "print the stable address and nothing else")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action((opts: { vault: string; date?: string; dryRun?: boolean; path?: boolean }) => {
    if (opts.path) {
      console.log(standingBriefingPath(opts.vault));
      return;
    }
    const ctx = buildPassContext(opts.vault);
    const today = opts.date ?? new Date().toISOString().slice(0, 10);
    const tree = ctx.vault.readTree();
    if (!opts.dryRun) {
      const address = regenerateStandingBriefing(ctx.dir, tree, today);
      // The content on stdout, the address on stderr: the one caller that captures
      // output is a wrapper pasting the briefing into a prompt or notification, and
      // it wants the briefing, not a path it already knows.
      console.error(`REGENERATED ${address} — in full, from ${tree.length} node(s); the previous briefing survives only in git.`);
    }
    console.log(composeStandingBriefing(tree, today));
  });

program
  .command("bank-question")
  .argument("[question]", "the question the run cannot answer, verbatim")
  .description(
    "bank a fork instead of stopping at it: record the question, the option the run would pick, and the outstanding " +
      "work — partitioned by the committed dependence rule into what can proceed and what the answer holds up",
  )
  .option("--header <text>", "short label for the fork")
  .option("-o, --option <text...>", "an option as the run saw it, `label — description` (repeatable)")
  .option("--pick <label>", "the option the run would take on its own")
  .option("--why <text>", "why the run would take it")
  .option("-w, --holds <item...>", "one item of the run's outstanding work at this fork (repeatable)")
  .option("--state <dir>", "where the bank lives (default: <vault>/.git/ost-agent)")
  .option("--list", "print the banked questions and bank nothing")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action(
    (
      question: string | undefined,
      opts: {
        header?: string;
        option?: string[];
        pick?: string;
        why?: string;
        holds?: string[];
        state?: string;
        list?: boolean;
        vault: string;
      },
    ) => {
      // Same fail-closed shape as `claim`, for the same reason: a bank that
      // silently lands nowhere is a question the next pass never drains.
      const state = opts.state ? path.resolve(opts.state) : loopStateDir(opts.vault);
      if (state === null) {
        console.error(
          "cannot locate a question bank: pass --state <dir>, or point --vault at a git checkout — the bank lives under its .git/, never in the working tree.",
        );
        process.exitCode = 1;
        return;
      }

      if (opts.list) {
        const banked = readQuestionBank(state);
        if (banked.length === 0) {
          console.log("question bank: empty — no fork has been banked here.");
          return;
        }
        for (const q of banked) {
          console.log(`[${q.askedAt}] ${q.fork.header ? `(${q.fork.header}) ` : ""}${q.fork.question}`);
          if (q.wouldPick) console.log(`  would pick: ${q.wouldPick}${q.why ? ` — ${q.why}` : ""}`);
          console.log(`  holds up ${q.cost} item(s); ${q.partition.canProceed.length} can proceed without it`);
          for (const w of q.partition.turnsOnAnswer) console.log(`    blocked: ${w}`);
        }
        return;
      }

      if (!question) {
        console.error('not banked: say what the question is — `ost-agent bank-question "<question>" ...`.');
        process.exitCode = 1;
        return;
      }

      const banked = bankQuestion(state, {
        askedAt: new Date().toISOString(),
        fork: { header: opts.header ?? "", question, options: opts.option ?? [] },
        wouldPick: opts.pick,
        why: opts.why,
        outstanding: opts.holds ?? [],
      });
      console.log(
        `BANKED — the answer holds up ${banked.cost} of ${banked.partition.calls.length} outstanding item(s).`,
      );
      for (const call of banked.partition.calls) {
        console.log(`  ${call.turnsOnAnswer ? "blocked " : "proceed "} ${call.work}`);
        console.log(`           ${call.why}`);
      }
    },
  );

const CONSEQUENCE_SET_FILENAME = "consequence-set.json";

function readConsequenceSet(state: string): ConsequenceSet | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(state, CONSEQUENCE_SET_FILENAME), "utf8")) as ConsequenceSet;
  } catch {
    return null;
  }
}

program
  .command("consequence-set")
  .argument("[premise]", "the stated premise the whole set is derived from, verbatim")
  .description(
    "derive the whole consequence set from a premise before the run begins, and present it as one batch: every " +
      "item states what it depends on and the default the run would take, so the operator answers once instead " +
      "of stopping at each one in turn. `--check` classifies a question the run meets mid-firing against the " +
      "recorded set: a match proceeds on that item's default without stopping again, no match still earns a stop.",
  )
  .option("-i, --item <spec...>", "one item as `id|question|default[|dependsOn]` (repeatable)")
  .option("--check <text>", "classify a question against the recorded set instead of recording a new one")
  .option("--list", "print the recorded set's batch and record nothing")
  .option("--state <dir>", "where the set lives (default: <vault>/.git/ost-agent)")
  .option("--vault <dir>", VAULT_OPTION_HELP)
  .action(
    (
      premise: string | undefined,
      opts: { item?: string[]; check?: string; list?: boolean; state?: string; vault: string },
    ) => {
      // Same fail-closed shape as `bank-question`, for the same reason: a set that
      // silently lands nowhere is a batch the operator never actually saw.
      const state = opts.state ? path.resolve(opts.state) : loopStateDir(opts.vault);
      if (state === null) {
        console.error(
          "cannot locate a consequence set: pass --state <dir>, or point --vault at a git checkout — the set lives under its .git/, never in the working tree.",
        );
        process.exitCode = 1;
        return;
      }

      if (opts.check !== undefined) {
        const recorded = readConsequenceSet(state);
        if (recorded === null) {
          console.error("no consequence set recorded here yet — nothing to check against.");
          process.exitCode = 1;
          return;
        }
        const result = classifyEncounter(recorded, opts.check);
        console.log(`${result.covered ? "COVERED" : "OUTSIDE"} — ${result.why}`);
        process.exitCode = result.covered ? 0 : 1;
        return;
      }

      if (opts.list) {
        const recorded = readConsequenceSet(state);
        if (recorded === null) {
          console.log("consequence set: none recorded here yet.");
          return;
        }
        console.log(formatConsequenceBatch(recorded));
        return;
      }

      if (!premise || !opts.item || opts.item.length === 0) {
        console.error(
          'not recorded: state the premise and at least one item — `ost-agent consequence-set "<premise>" -i "1|<question>|<default>"`.',
        );
        process.exitCode = 1;
        return;
      }

      const items: ConsequenceItem[] = opts.item.map((spec) => {
        const [id, question, itemDefault, dependsOn] = spec.split("|");
        return { id: id ?? "", question: question ?? "", default: itemDefault ?? "", dependsOn: dependsOn || undefined };
      });
      const set: ConsequenceSet = { premise, items };

      const issues = validateConsequenceSet(set);
      if (issues.length > 0) {
        console.error("not recorded: the dependency links do not hold —");
        for (const issue of issues) console.error(`  #${issue.itemId}: ${issue.problem}`);
        process.exitCode = 1;
        return;
      }

      fs.mkdirSync(state, { recursive: true });
      fs.writeFileSync(path.join(state, CONSEQUENCE_SET_FILENAME), JSON.stringify(set));
      console.log(formatConsequenceBatch(set));
    },
  );

program
  .command("authority")
  .description(
    "the standing authority contract: which classes of decision compute may take alone. A run at a fork reads this " +
      "and either proceeds under the clause that covers it (recording which) or stops and cites the clause — or " +
      "'uncovered', which is a stop exactly as before the contract existed",
  )
  .action(() => {
    console.log(renderAuthorityContract());
  });

program
  .command("host-delegation")
  .description(
    "for every host surface this repository ships an entry point for, whether it already resolves a " +
      "credential the host holds instead of asking the operator for a second one, and where that is implemented",
  )
  .action(() => {
    console.log(renderHostSurfaces());
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

program
  .command("grants")
  .description("name every tool a run's instructions declare that its grant does not cover — before the run starts")
  .requiredOption("--skill <file>", "the SKILL.md (or command file) whose `allowed-tools` line is the declaration")
  .requiredOption("--settings <file>", "the settings.json whose permissions.allow is the grant the run fires with")
  .option(
    "--demand <rule>",
    "a tool the run needs that the declaration does not name, in grant syntax (repeatable). Prose in the prompt " +
      "is deliberately not harvested — a sentence naming a tool may be telling the run not to use it",
    collect,
    [],
  )
  .action((opts: { skill: string; settings: string; demand: string[] }) => {
    const run = runGrantPreflight({
      skillPath: path.resolve(opts.skill),
      settingsPath: path.resolve(opts.settings),
      extraDemands: opts.demand,
    });
    // Non-zero on gaps AND on an unreadable input: a wrapper that treats either as
    // "go ahead" is the failure this command exists to stop, and the two codes are
    // distinct so it can tell "do not start" from "the check itself did not run".
    if (run.exitCode === 0) console.log(run.report);
    else {
      console.error(run.report);
      process.exitCode = run.exitCode;
    }
  });

program
  .command("required-tools")
  .description("refuse to begin a pass whose declared-required tools are not on the surface it would fire with")
  .requiredOption(
    "--pass <file>",
    "the SKILL.md (or command file) declaring `allowed-tools` and the `required-tools` subset it cannot start without",
  )
  .requiredOption(
    "--available <csv>",
    "the tools the run will actually be able to call — the same string handed to `--allowedTools`",
  )
  .action((opts: { pass: string; available: string }) => {
    const check = checkRequiredTools({
      passFile: path.resolve(opts.pass),
      available: opts.available.split(",").map((t) => t.trim()).filter(Boolean),
    });
    // Two non-zero codes, and neither means "go ahead": `missingRequired` is a run
    // that must not start, `undeclared` is a check that could not be made — which
    // is also not a cleared run, and a wrapper collapsing the two into one would
    // lose exactly the distinction this command exists to draw.
    if (check.exitCode === REQUIRED_TOOLS_EXIT.cleared) console.log(check.report);
    else {
      console.error(check.report);
      process.exitCode = check.exitCode;
    }
  });

program
  .command("tool-surface")
  .description(
    "confirm a pass's required MCP tools are on the LIVE surface by listing them, never by calling them — " +
      "closes what `required-tools` cannot check: whether the surface actually answers what `--available` claims",
  )
  .requiredOption(
    "--pass <file>",
    "the SKILL.md (or command file) declaring `allowed-tools` and the `required-tools` subset it cannot start without",
  )
  .requiredOption("--vault <dir>", "the vault directory the live MCP surface would serve")
  .action(async (opts: { pass: string; vault: string }) => {
    const dir = path.resolve(opts.vault);
    const check = await checkToolSurfaces({
      passFile: path.resolve(opts.pass),
      surfaces: [{ name: `live MCP surface (${dir})`, server: createLazyOstMcpServer(dir) }],
    });
    if (check.exitCode === TOOL_SURFACE_PREFLIGHT_EXIT.cleared) console.log(check.report);
    else {
      console.error(check.report);
      process.exitCode = check.exitCode;
    }
  });

program
  .command("build-check")
  .description(
    "does the tree this run inherited actually build? the typecheck gate, timed, refused before any work is planned on it",
  )
  .requiredOption("-r, --repo <dir>", "the repository the run inherited")
  .action(async (opts: { repo: string }) => {
    const repo = path.resolve(opts.repo);
    const result = await inheritedTreeBuildCheck(repo);
    const report = formatBuildCheck(repo, result);
    // Green to stdout, refusals to stderr, and the exit code carries the
    // verdict: 0 builds, 1 broken, 2 could-not-check. Only 0 clears — a wrapper
    // that gates on non-zero is fail-closed without knowing the difference.
    if (result.verdict === "builds") console.log(report);
    else {
      console.error(report);
      process.exitCode = BUILD_CHECK_EXIT[result.verdict];
    }
  });

program
  .command("ship")
  .description(
    "run this branch's gates on this machine and merge it if they are green (waits on no external check)",
  )
  .requiredOption("-r, --repo <dir>", "the repository whose branch is being shipped")
  .option("--default-branch <name>", "the branch work merges into", "main")
  .option("--dry-run", "run every gate and report, but never merge")
  .action((opts: { repo: string; defaultBranch: string; dryRun?: boolean }) => {
    const outcome = ship({
      repo: path.resolve(opts.repo),
      defaultBranch: opts.defaultBranch,
      dryRun: opts.dryRun === true,
      log: (line) => console.error(line),
    });

    for (const run of outcome.gateRuns) {
      const verdict = run.passed ? "green" : `RED (exit ${run.exitCode ?? "did not run"})`;
      console.log(`  ${run.gate.name}: ${verdict}`);
      if (!run.passed) console.log(run.excerpt.replace(/^/gm, "    "));
    }
    console.log(outcome.summary);

    if (outcome.shipped) return;
    // A dry run that cleared every gate did what it was asked to do, so it exits
    // 0 — otherwise the rehearsal reports the same failure as the thing it was
    // rehearsing, and nobody can use it to check the gates without merging.
    const allGreen = outcome.refusals.length === 0 && outcome.gateRuns.every((r) => r.passed);
    if (opts.dryRun === true && allGreen) return;
    // 20 for "the branch was never eligible", 1 for "a gate said no". A wrapper
    // needs to tell those apart: the first is its own mistake to fix, the second
    // is a finding about the code that belongs in the report.
    process.exitCode = outcome.refusals.length > 0 ? 20 : 1;
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
