/**
 * Load and validate `ost.config.yaml` from a vault directory.
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { ConfigSchema, type Config } from "./schema.js";

export const CONFIG_FILENAME = "ost.config.yaml";

/**
 * Stands in for the outcome when a config is loaded from a directory that is not
 * a vault. The schema requires a non-empty outcome, and there is no honest value
 * to put there — so the placeholder says so in the one place it could ever be
 * read. `vaultReadiness` treats a missing config as "no vault", which keeps this
 * string out of every path that could act on it.
 */
export const BOOTSTRAP_PLACEHOLDER_OUTCOME =
  "(no outcome — this directory is not an OST vault yet; run `ost-agent init`)";

export function configPath(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), CONFIG_FILENAME);
}

export interface LoadConfigOptions {
  /**
   * What to do when the file is absent. `"throw"` (the default) is right for
   * every command that needs a vault. `"defaults"` exists for the one caller
   * that must survive a directory which is not a vault yet — the MCP server,
   * which has to start in order to tell the operator how to create one. An
   * *invalid* config still throws either way: a broken file is a mistake to
   * report, not a state to tolerate.
   */
  missing?: "throw" | "defaults";
}

/**
 * The schema defaults with the placeholder outcome — a config that reads no
 * file at all. Only for surfaces that must render something before a real
 * config can be trusted (the MCP server's pre-ready tool listing); nothing
 * built from it may act on the tree.
 */
export function defaultConfig(): Config {
  return ConfigSchema.parse({ outcome: BOOTSTRAP_PLACEHOLDER_OUTCOME });
}

/** Read + validate the config. Throws a readable error on invalid/missing config. */
export function loadConfig(vaultDir: string, opts: LoadConfigOptions = {}): Config {
  const p = configPath(vaultDir);
  if (!fs.existsSync(p)) {
    if (opts.missing === "defaults") return defaultConfig();
    throw new Error(`no ${CONFIG_FILENAME} in ${vaultDir} — run \`ost-agent init\` first`);
  }
  const raw = parseYaml(fs.readFileSync(p, "utf8")) ?? {};
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`invalid ${CONFIG_FILENAME}:\n${issues}`);
  }
  return result.data;
}
