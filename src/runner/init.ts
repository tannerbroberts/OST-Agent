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
import { gitCommit, gitInitIfAbsent, gitPush } from "../git/safe-git.js";
import { FLOOR_RUNG } from "../knowledge/believability.js";
import { buildPassContext } from "./context.js";

export interface InitResult {
  dir: string;
  gitInitialized: boolean;
  outcomeCreated: boolean;
}

export async function initVault(dir: string, outcome: string, outcomeTitle?: string): Promise<InitResult> {
  const abs = path.resolve(dir);
  fs.mkdirSync(abs, { recursive: true });
  const title = outcomeTitle ?? path.basename(abs);

  const gitInitialized = await gitInitIfAbsent(abs);

  const cfg = configPath(abs);
  if (!fs.existsSync(cfg)) {
    fs.writeFileSync(cfg, defaultConfigYaml(outcome, title), "utf8");
  }

  // scaffold sidecar dirs under the .ost-agent dot-folder (Obsidian ignores it),
  // so the vault root only ever contains OST node files
  fs.mkdirSync(path.join(abs, ".ost-agent", "inbox"), { recursive: true });
  fs.mkdirSync(path.join(abs, ".ost-agent", "state"), { recursive: true });
  fs.mkdirSync(path.join(abs, ".ost-agent", "evidence"), { recursive: true });
  fs.mkdirSync(path.join(abs, ".ost-agent", "runs"), { recursive: true });

  // Adopting an existing vault re-reads its config, so the root node's title is
  // whatever that config already calls it — never silently re-titled from the
  // folder name.
  const ctx = buildPassContext(abs);
  const rootTitle = ctx.config.outcomeTitle ?? path.basename(abs);

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

  const commit = await gitCommit(abs, `init: ${outcomeCreated ? `created Outcome "${rootTitle}"` : "no changes"}`);
  if (ctx.remote.enabled && commit.committed) {
    await gitPush(abs).catch(() => undefined);
  }

  return { dir: abs, gitInitialized, outcomeCreated };
}
