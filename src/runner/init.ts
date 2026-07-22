/**
 * `init` — create (or adopt) a vault: initialize git if absent, scaffold the
 * inbox + config, and create the single human-set Outcome node. Non-destructive
 * and re-runnable: existing files/nodes are never overwritten.
 */
import fs from "node:fs";
import path from "node:path";
import { defaultConfigYaml } from "../config/schema.js";
import { configPath } from "../config/load.js";
import { gitInitIfAbsent } from "../git/safe-git.js";
import { p0Bootstrap } from "../processes/registry.js";
import { scriptedDriver } from "./driver.js";
import { buildPassContext } from "./context.js";
import { runPass } from "./pass.js";

export interface InitResult {
  dir: string;
  gitInitialized: boolean;
  outcomeCreated: boolean;
}

export async function initVault(dir: string, outcome: string): Promise<InitResult> {
  const abs = path.resolve(dir);
  fs.mkdirSync(abs, { recursive: true });

  const gitInitialized = await gitInitIfAbsent(abs);

  const cfg = configPath(abs);
  if (!fs.existsSync(cfg)) {
    fs.writeFileSync(cfg, defaultConfigYaml(outcome), "utf8");
  }

  // scaffold sidecar dirs under the .ost-agent dot-folder (Obsidian ignores it),
  // so the vault root only ever contains OST node files
  fs.mkdirSync(path.join(abs, ".ost-agent", "inbox"), { recursive: true });
  fs.mkdirSync(path.join(abs, ".ost-agent", "state"), { recursive: true });
  fs.mkdirSync(path.join(abs, ".ost-agent", "evidence"), { recursive: true });
  fs.mkdirSync(path.join(abs, ".ost-agent", "runs"), { recursive: true });

  const ctx = buildPassContext(abs);
  const outcome0 = await runPass(p0Bootstrap, ctx, scriptedDriver({}));

  return { dir: abs, gitInitialized, outcomeCreated: outcome0.result.created > 0 };
}
