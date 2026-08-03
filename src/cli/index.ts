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
 *   ost-agent channels [--vault DIR]          every drop folder, its last delivery, and what has gone silent
 *   ost-agent friction "<note>" [--vault DIR] file friction at the point of pain
 *   ost-agent loop due|start|step|seal        unattended firing: cadence, lock, ceiling, health
 *   ost-agent mcp [--vault DIR]               stdio MCP server (no API key needed)
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
import { BELIEVABILITY_LADDER, type RungId } from "../knowledge/believability.js";
import { promoteNode, recordResult, VERDICTS, type Verdict } from "../ost/results.js";
import { verifyInstrument } from "../ost/instrument.js";
import { buildableSolutions, buildPermit } from "../eval/buildable.js";
import { formatCensus, reconcileWithGit, reconcileWithUsage } from "../ost/census.js";
import { cautionBacklog, flagHumansRequired, setLane, suggestCaution, triageLanes } from "../ost/lanes.js";
import { laneDef, LANES, type LaneId } from "../knowledge/lanes.js";
import { fileFriction, FRICTION_KINDS, type FrictionFilingKind } from "../adapters/friction.js";
import { createLazyOstMcpServer, MCP_TOOL_NAMES } from "../mcp/server.js";
import { vaultReadiness } from "../mcp/bootstrap.js";
import { gitCommit } from "../git/safe-git.js";
import { workingTreeStatus, type VaultTreeStatus } from "../loop/state.js";
import { entriesRequiringAHuman, registerLoopCommands } from "./loop.js";
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
  .option("--vault <dir>", "vault directory", ".")
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
  .option("--vault <dir>", "vault directory", process.env.OST_VAULT ?? ".")
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
  .option("--vault <dir>", "vault directory", ".")
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
  .command("promote")
  .description("promote a node to 'validated' (humans only — the agent has no argument that expresses this)")
  .argument("<node>", "title of the node to promote")
  .requiredOption("-b, --by <who>", "who promoted it — an unattributed promotion cannot be told apart from a fabricated one")
  .requiredOption("-w, --why <text>", "the evidence that earned it")
  .option("--vault <dir>", "vault directory", ".")
  .action((node: string, opts: { by: string; why: string; vault: string }) => {
    const line = promoteNode(opts.vault, { node, by: opts.by, why: opts.why });
    console.log(`promoted "${node}": ${line}`);
    console.log("  removed the #unvalidated marker");
  });

program
  .command("debt")
  .description("what each solution owes in evidence before anyone builds it (no model needed)")
  .option("--vault <dir>", "vault directory", ".")
  .action((opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    console.log(renderDebt(ctx.vault.readTree()));
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
  .option("--vault <dir>", "vault directory", ".")
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
  .option("--vault <dir>", "vault directory", ".")
  .action((solution: string | undefined, opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    const tree = ctx.vault.readTree();
    if (!solution) {
      const all = buildableSolutions(tree);
      if (all.length === 0) {
        console.log("nothing is buildable: no solution carries an instrument that has been observed red.");
        console.log("  `ost-agent debt` says which solutions still owe a test; a test owes an `instrument:` field.");
        return;
      }
      for (const b of all) console.log(`${b.solution}\n  ${b.instrument}  (${b.test})`);
      return;
    }
    const permit = buildPermit(tree, solution);
    if (permit.cleared) {
      console.log(`buildable: CLEARED — ${permit.reason}`);
      return;
    }
    console.error(`buildable: BLOCKED — ${permit.reason}`);
    process.exitCode = 1;
  });

program
  .command("channels")
  .description("list every commissioned channel, when it last delivered, and which ones are silent or unavailable (read-only)")
  .option("--vault <dir>", "vault directory", ".")
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
  .option("--vault <dir>", "vault directory", ".")
  .action(async (opts: { vault: string }) => {
    const ctx = buildPassContext(opts.vault);
    const census = ctx.vault.readTreeCensus();
    census.independent = await reconcileWithGit(ctx.dir, census);
    console.log(renderStatus(ctx, census));
  });

registerLoopCommands(program);

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

program.parseAsync().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
