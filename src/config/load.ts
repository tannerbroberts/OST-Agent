/**
 * Load and validate `ost.config.yaml` from a vault directory.
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { ConfigSchema, type Config } from "./schema.js";
import { nearMiss, renderNearMiss } from "../fs/near-miss.js";

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

/** What a read produced, and — when the file could not be used — why. */
export interface ConfigLoad {
  /** The operator's config, or the schema defaults when `problem` is set. */
  config: Config;
  /**
   * Present only when a file exists and could not be used. `config` is then the
   * defaults, which is a *fallback and not a substitute*: a caller that acts on a
   * bound must refuse rather than act on a default the operator never chose.
   */
  problem?: string;
}

/**
 * Read the config, reporting a broken file rather than throwing on it.
 *
 * The distinction this returns is the whole of G1. A malformed `ost.config.yaml`
 * used to be a throw at the bottom of `buildPassContext`, which every tool is built
 * through — so one typo in one file returned `isError` from `ost_check`,
 * `ost_read_tree` and everything else alike. Reading the tree does not depend on the
 * config at all, and a surface that cannot answer a question it never needed the file
 * for is a surface that failed for a reason it does not have.
 *
 * A YAML syntax error and a schema violation are both reported the same way, because
 * they are the same event to whoever has to fix it: the file is there and it cannot be
 * used. Only `parseYaml` throwing was previously uncaught at all.
 */
export function readConfig(vaultDir: string, opts: LoadConfigOptions = {}): ConfigLoad {
  const p = configPath(vaultDir);
  if (!fs.existsSync(p)) {
    if (opts.missing === "defaults") return { config: defaultConfig() };
    // A directory that is not there and a directory that is there but holds no
    // config are different mistakes with different fixes, and saying `run
    // ost-agent init` to the first one is the worse of the two answers: the
    // recorded miss is `--vault /Users/tanner/dev/ost-agent-meta` when the vault
    // is at `/Users/tanner/ost-agent-meta`, where following the advice would have
    // created a second, empty tree at the typo.
    const dir = path.resolve(vaultDir);
    if (!fs.existsSync(dir)) {
      throw new Error(`no vault at ${dir} — that directory does not exist; ${renderNearMiss(nearMiss(dir))}`);
    }
    throw new Error(`no ${CONFIG_FILENAME} in ${vaultDir} — run \`ost-agent init\` first`);
  }
  let raw: unknown;
  try {
    raw = parseYaml(fs.readFileSync(p, "utf8")) ?? {};
  } catch (e) {
    return { config: defaultConfig(), problem: `${CONFIG_FILENAME} is not valid YAML: ${e instanceof Error ? e.message : String(e)}` };
  }
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    return { config: defaultConfig(), problem: `invalid ${CONFIG_FILENAME}:\n${issues}` };
  }
  return { config: result.data };
}

/** Read + validate the config. Throws a readable error on invalid/missing config. */
export function loadConfig(vaultDir: string, opts: LoadConfigOptions = {}): Config {
  const { config, problem } = readConfig(vaultDir, opts);
  if (problem) throw new Error(problem);
  return config;
}
