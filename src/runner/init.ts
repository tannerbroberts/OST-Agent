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
    ...(gitignored ? { gitignored } : {}),
  };
}
