/**
 * `init` — create (or adopt) a vault: initialize git if absent, scaffold the
 * inbox + config, and create the single human-set Outcome node. Non-destructive
 * and re-runnable: existing files/nodes are never overwritten.
 *
 * The root node is written here rather than by a process: bootstrapping a vault
 * is deterministic, needs no model, and is the one write that has to happen
 * before anything else — including the MCP server — has a tree to read.
 */
import fs from "node:fs";
import path from "node:path";
import { defaultConfigYaml } from "../config/schema.js";
import { configPath } from "../config/load.js";
import { CHANNEL_ZERO, resolveChannels } from "../adapters/channels.js";
import { gitCommit, gitInitIfAbsent, gitPush, pushTargetFor } from "../git/safe-git.js";
import { FLOOR_RUNG } from "../knowledge/believability.js";
import { buildPassContext } from "./context.js";
import { INIT_TRACE_TOOL, drainCreatedNodeFiles, recordUsageEvent, usageLogPath } from "../telemetry/usage.js";
import { diagnoseSetup } from "../config/setup-check.js";
import { mergeEnablingConfig } from "../config/settings-merge.js";
import { fileNameForTitle } from "../ost/sanitize.js";
import { VERSION } from "../index.js";
import { buildScaffoldManifest, writeScaffoldManifest } from "./scaffold-manifest.js";
import {
  declaredServerPath,
  readVaultDeclaration,
  renderVaultDeclaration,
  runningServerArtifact,
  vaultDeclarationPath,
} from "../config/vault-declaration.js";

/**
 * Write the event that lets the trace be read as a denominator (W2, W3).
 *
 * `ost_check` reports a node file that no recorded invocation created — which only
 * means anything if the trace covers the vault's whole life. That is what this event
 * establishes, and the distinction it draws is between the *first* init and every
 * later one:
 *
 *   - **First init, no prior marker.** Everything at the root right now is explained,
 *     because this is the moment the trace takes over. That covers the Outcome node
 *     just written and, when a directory of existing Markdown is adopted, whatever was
 *     already there. Adoption is an honest explanation: those files predate the record
 *     and no record can speak for them.
 *   - **Any later init.** Only what this run created, drained from the writer like any
 *     other call. `init` is re-runnable and `/ost-setup` grants a `Bash(… init:*)`
 *     prefix, so an init that re-blessed the whole root would be a laundry: drop a node
 *     file beside the vault, run init, watch the violation disappear. It explains
 *     nothing it did not write.
 */
function recordInitInTrace(abs: string): void {
  const created = drainCreatedNodeFiles();
  const first = !traceHasInit(abs);
  const wrote = first ? [...new Set([...rootMarkdownFiles(abs), ...created])].sort() : created;
  recordUsageEvent(abs, {
    ts: new Date().toISOString(),
    tool: INIT_TRACE_TOOL,
    ok: true,
    ms: 0,
    surface: "cli",
    argBytes: 0,
    ...(wrote.length > 0 ? { wrote } : {}),
  });
}

function rootMarkdownFiles(abs: string): string[] {
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name);
}

function traceHasInit(abs: string): boolean {
  const file = usageLogPath(abs);
  if (!fs.existsSync(file)) return false;
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .some((line) => line.includes(`"tool":"${INIT_TRACE_TOOL}"`));
}

/**
 * The drop folder a NEW vault gets: a sibling of the vault, not a fixed `../inbox`.
 *
 * Outside the vault because that is the whole of W1 — with the folder outside the
 * git working tree, "may write the drop folder" and "may write the tree" are
 * different grants, and a read-only mount of the vault no longer denies the builder
 * its only channel. Named for the vault because two vaults under one parent would
 * otherwise share one folder and each ingest the other's notes.
 *
 * It is written as a literal string into the operator's own `ost.config.yaml`
 * rather than derived in code from an empty sentinel: a path you can read in your
 * own config is what "blessed" means, and it is what makes W1's check pass as the
 * criterion writes it rather than as somebody reinterprets it.
 */
export function defaultInboxPath(vaultDir: string): string {
  const base = path.basename(path.resolve(vaultDir)) || "ost-vault";
  return `../${base}.inbox`;
}

export interface InitResult {
  dir: string;
  gitInitialized: boolean;
  outcomeCreated: boolean;
  /** Where notes actually go, absolute — what the operator has to be told. */
  inboxDir: string;
  /** True when the drop folder resolves outside the vault (a fresh vault; W1). */
  inboxConfined: boolean;
  /** A `.gitignore` line appended for a grandfathered inside-vault drop folder. */
  gitignored?: string;
  /**
   * Channels the resolver refused, in the operator's terms.
   *
   * Reported rather than swallowed. `init` is the command an operator runs right
   * after adding a `channels:` entry, and a refused channel is a folder that is
   * never created and never read — silence there is indistinguishable from it
   * working, which is the same "success and failure share one observable" shape S2
   * is about. Never thrown: a bad channel entry costs that channel and nothing else
   * (G1), and it must not stop a vault being created or adopted.
   */
  channelProblems: string[];
  /** What happened when `init` tried to make the vault's tools launch on their own. */
  toolEnabling: ToolEnablingOutcome;
  /** What happened when `init` tried to make the vault carry its own tool server. */
  toolDeclaration: ToolDeclarationOutcome;
  /**
   * The scaffold manifest this run wrote, absolute.
   *
   * Every field above it was already computed on the way here and then printed to a
   * console — the manifest is where the same facts get written down, including the
   * negative ones (`dependencies-installed: false`, `remote-configured: false`) that
   * nothing else in the workspace records. See `src/runner/scaffold-manifest.ts` for
   * what a reader is and is not entitled to conclude from it.
   */
  manifestFile: string;
}

export type ToolEnablingOutcome =
  /** Something already enables the plugin — this vault's own settings.json or a level above it. */
  | { status: "already-enabled"; enabledBy: string }
  /** Wrote (or merged into) the project's `.claude/settings.json`. */
  | { status: "enabled"; file: string }
  /** Left the file untouched, and why. */
  | { status: "skipped"; reason: string };

export type ToolDeclarationOutcome =
  /**
   * Wrote `<vault>/.mcp.json`. `carried` is whether it names a copy of the server
   * the vault holds (portable to any machine) or the artefact on this one.
   */
  | { status: "written"; file: string; server: string; carried: boolean }
  /** The vault already declares a usable server — never rewritten. */
  | { status: "already-declared"; file: string }
  /** Left it alone, and why. */
  | { status: "skipped"; reason: string };

/**
 * Make the vault carry its own tool server, so moving or copying it does not
 * leave the tools behind.
 *
 * The sibling fix above this one — writing `enabledPlugins` into the vault's
 * `.claude/settings.json` — closes the observed failure but keeps the shape that
 * produced it: the thing that launches the tools is a *project* setting, and the
 * project is whichever directory the session opened. This writes the other half,
 * a `.mcp.json` at the vault root that names the server and binds it to
 * `${CLAUDE_PROJECT_DIR}`. Both are written; they are not alternatives, because
 * an operator whose project already enables the plugin should not have a second
 * server show up, and one whose project does not should still get tools.
 *
 * Three refusals, each of which would otherwise produce a file that fails at
 * launch rather than at setup — the failure mode this whole line of work exists
 * to stop being silent:
 *
 *   - **Never overwrites.** A declaration already at the vault root is the
 *     operator's, possibly hand-edited, possibly naming a different install.
 *   - **Never names an artefact that is not there.** `declaredServerPath`
 *     returns `null` when it cannot find one, and a `null` is reported rather
 *     than guessed around.
 *   - **Never touches a file it could not parse.** A `.mcp.json` that exists and
 *     is malformed is reported with the reason, because it may be declaring
 *     other servers the operator cares about more than this one.
 */
function writeToolDeclaration(abs: string): ToolDeclarationOutcome {
  const file = vaultDeclarationPath(abs);
  const existing = readVaultDeclaration(abs);
  if (existing.status === "found") return { status: "already-declared", file };
  if (existing.status === "problem" && fs.existsSync(file)) {
    return { status: "skipped", reason: `${file} exists and ${existing.reason} — not overwriting a file this vault already carries` };
  }

  const server = declaredServerPath(abs, runningServerArtifact());
  if (!server) {
    return {
      status: "skipped",
      reason: `no ost-agent.mjs found to name — a declaration pointing at an artefact that is not on disk fails at launch instead of here`,
    };
  }

  fs.writeFileSync(file, renderVaultDeclaration(server.path), "utf8");
  return { status: "written", file, server: server.path, carried: server.carried };
}

/**
 * Make opening this vault enough to get its tools, by writing the same
 * enabling keys `setup-check.ts` already knows how to diagnose the absence
 * of — the fix for the four toolless passes that motivated the diagnosis.
 *
 * Deliberately conservative in two ways `mergeEnablingConfig`'s own contract
 * does not enforce on its own:
 *
 * - **Never overrides an explicit `false`.** `diagnoseSetup`'s `plugin-disabled`
 *   gap exists to name a choice, not an oversight; flipping it back on `init`
 *   re-adopting an existing vault would make that choice unkeepable.
 * - **Only writes when the merge round-trips through `diagnoseSetup` as `ok`.**
 *   A settings file with comments merges safely (nothing is lost — see
 *   `settings-merge-safety.test.ts`) but `diagnoseSetup` reads the canonical
 *   file with a strict `JSON.parse`, the same as Claude Code's own settings
 *   loader is understood to. Writing a technically-safe merge that the
 *   operator's own session still can't parse would report success for a file
 *   that does not actually enable anything — worse than leaving it alone,
 *   because the existing diagnosis (which *does* handle comments as a named
 *   gap) would no longer even get a chance to say so.
 */
function writeToolEnablingConfig(abs: string): ToolEnablingOutcome {
  const before = diagnoseSetup(abs);
  if (before.ok) return { status: "already-enabled", enabledBy: before.enabledBy as string };
  if (before.gap === "plugin-disabled") {
    return { status: "skipped", reason: `${before.file} explicitly disables the plugin — not overriding a deliberate choice` };
  }

  const canonical = before.file;
  const raw = fs.existsSync(canonical) ? fs.readFileSync(canonical, "utf8") : "{}\n";
  const merged = mergeEnablingConfig(raw);
  if (!merged.ok) {
    return { status: "skipped", reason: `${canonical} could not be safely merged into: ${merged.reason}` };
  }

  fs.mkdirSync(path.dirname(canonical), { recursive: true });
  fs.writeFileSync(canonical, merged.content as string, "utf8");

  const after = diagnoseSetup(abs);
  if (!after.ok) {
    return {
      status: "skipped",
      reason: `merged into ${canonical} without losing any existing setting, but it still does not parse as the strict JSON Claude Code's settings loader expects (likely comments in the original) — run \`ost-agent setup-check\` for the exact fix`,
    };
  }
  return { status: "enabled", file: canonical };
}

/**
 * Keep a grandfathered inside-vault drop folder out of future commits.
 *
 * Appended, never rewritten, and only when the line is absent — corrections in this
 * repo are appends. It closes the residue for notes NOT YET committed and nothing
 * more: **notes already committed stay in git history**, which is exactly why the
 * honest remedy reported to the operator is moving the folder, not ignoring it.
 */
function appendGitignore(abs: string, line: string): string | undefined {
  const file = path.join(abs, ".gitignore");
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (existing.split("\n").some((l) => l.trim() === line)) return undefined;
  const prefix = existing === "" || existing.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(
    file,
    `${prefix}# drop folder inside the vault — kept out of commits; already-committed notes stay in history\n${line}\n`,
    "utf8",
  );
  return line;
}

export async function initVault(dir: string, outcome: string, outcomeTitle?: string): Promise<InitResult> {
  const abs = path.resolve(dir);
  fs.mkdirSync(abs, { recursive: true });
  const title = outcomeTitle ?? path.basename(abs);

  const gitInitialized = await gitInitIfAbsent(abs);

  const cfg = configPath(abs);
  if (!fs.existsSync(cfg)) {
    fs.writeFileSync(cfg, defaultConfigYaml(outcome, title, { inboxPath: defaultInboxPath(abs) }), "utf8");
  }

  // scaffold sidecar dirs under the .ost-agent dot-folder (Obsidian ignores it),
  // so the vault root only ever contains OST node files
  fs.mkdirSync(path.join(abs, ".ost-agent", "state"), { recursive: true });
  fs.mkdirSync(path.join(abs, ".ost-agent", "evidence"), { recursive: true });
  fs.mkdirSync(path.join(abs, ".ost-agent", "runs"), { recursive: true });

  // Adopting an existing vault re-reads its config, so the root node's title is
  // whatever that config already calls it — never silently re-titled from the
  // folder name.
  //
  // `skipSources` because init needs the config and the vault handle, not the
  // adapters: building them here means a vault whose config enables Slack without
  // a token cannot be initialized or re-adopted at all, which is a credential
  // check standing in front of a step that never needed one.
  const ctx = buildPassContext(abs, { skipSources: true });
  const rootTitle = ctx.config.outcomeTitle ?? path.basename(abs);

  // Every channel the config actually declares gets its folder — the fresh vault's
  // escaping one, an adopted vault's in-vault one, and any extra channel. Created
  // from the resolver rather than from a literal, so there is one answer to "which
  // folder is the inbox" and `init` cannot scaffold a folder nothing reads.
  const resolved = resolveChannels(abs, ctx.config);
  for (const channel of resolved.channels) {
    if (channel.enabled) fs.mkdirSync(channel.dir, { recursive: true });
  }
  // No fallback path here on purpose. `resolveChannels` always returns channel
  // zero, so its absence would mean the resolver changed under us — and guessing
  // `.ost-agent/inbox` would then print an operator a folder to drop notes into
  // that nothing reads. A guess is the one answer this cannot give.
  const zero = resolved.channels.find((c) => c.name === CHANNEL_ZERO);
  if (!zero) throw new Error("no channel zero resolved for this vault — adapters.inbox is the key every vault carries");
  const inboxDir = zero.dir;
  const inboxConfined = zero.confined;
  const gitignored = zero.confined
    ? undefined
    : appendGitignore(abs, `${path.relative(abs, zero.dir).split(path.sep).join("/")}/`);

  // Before the commit below, so a freshly-created vault's very first commit
  // is the one that makes its own tools launch — no second, invisible step.
  const toolEnabling = writeToolEnablingConfig(abs);
  const toolDeclaration = writeToolDeclaration(abs);

  let outcomeCreated = false;
  if (!ctx.vault.has(rootTitle)) {
    ctx.vault.createNode({
      title: rootTitle,
      layer: "Outcome",
      status: "validated",
      source: "config:outcome",
      created: new Date().toISOString().slice(0, 10),
      tags: [],
      links: [],
      // The mandate is a decision from inside the building, not a finding about
      // the world — it sits at the ladder's floor like any other assertion.
      evidence: FLOOR_RUNG,
      // the mandate the system optimizes toward; human-set, tuned via set-outcome
      body: ctx.config.outcome,
    });
    outcomeCreated = true;
  }

  recordInitInTrace(abs);

  // Before the commit, so the manifest is part of the same commit as the thing it
  // describes. A manifest that lands one commit later is a manifest that is wrong for
  // the length of that gap, which is the exact failure mode the file exists to avoid.
  //
  // `pushTargetFor` rather than `ctx.remote.url` directly: the manifest must say what
  // this vault will actually do, and a `remote.url` set beside `enabled: false` is a
  // configured remote nothing pushes to. The claim is about behaviour, not about a key.
  const manifestTarget = pushTargetFor(ctx.remote);
  const manifestFile = writeScaffoldManifest(
    abs,
    buildScaffoldManifest(
      abs,
      {
        gitInitialized,
        outcomeCreated,
        outcomeFile: fileNameForTitle(rootTitle),
        inboxDir,
        inboxConfined,
        remoteUrl: manifestTarget.push ? manifestTarget.remote : null,
        toolDeclaration: {
          status: toolDeclaration.status,
          file: toolDeclaration.status === "skipped" ? vaultDeclarationPath(abs) : toolDeclaration.file,
        },
        toolEnabling: {
          status: toolEnabling.status,
          file: toolEnabling.status === "enabled" ? toolEnabling.file : diagnoseSetup(abs).file,
        },
      },
      { at: new Date().toISOString(), toolVersion: VERSION },
    ),
  );

  const commit = await gitCommit(abs, `init: ${outcomeCreated ? `created Outcome "${rootTitle}"` : "no changes"}`);
  // P9: where this goes is `remote.url` in the vault's own config, not the
  // ambient `origin` of the directory init happened to be run in. A vault whose
  // config asks for publication without naming a destination is not pushed —
  // `pushTargetFor` refuses, and init's push has always been best-effort, so it
  // stays a no-op here rather than failing the initialization of a vault that is
  // otherwise fine. The operator's loud copy of that refusal is `git_push`,
  // which throws it.
  const target = pushTargetFor(ctx.remote);
  if (target.push && commit.committed) {
    await gitPush(abs, target.remote).catch(() => undefined);
  }

  return {
    dir: abs,
    gitInitialized,
    outcomeCreated,
    inboxDir,
    inboxConfined,
    channelProblems: resolved.problems,
    toolEnabling,
    toolDeclaration,
    manifestFile,
    ...(gitignored ? { gitignored } : {}),
  };
}
