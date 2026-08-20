/**
 * Load and validate `ost.config.yaml` from a vault directory.
 */
import fs from "node:fs";
import os from "node:os";
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

/**
 * Resolve a session directory an operator declared in `ost.config.yaml`.
 *
 * Expand a leading `~` before resolving, because the only path an operator will
 * ever write here starts with one: Claude Code keeps transcripts under
 * `~/.claude/projects/<slug>`, and that is what `autonomous-pass.sh`'s header
 * tells them to paste. `path.resolve(vaultDir, "~/x")` silently produces
 * `<vault>/~/x`, which cannot exist — so the loop read an unmeasurable spend and
 * refused to fire, forever, on the one configuration the documentation hands out.
 * A refusal nobody can clear by following the instructions is R2's shape.
 *
 * It lives here, beside the config it interprets, rather than in `cli/loop.ts`
 * where it was written: the transcript adapter now reads the same declared
 * directory, and `src/runner/context.ts` cannot import from `src/cli/` without
 * pulling Commander into the MCP server's module graph.
 */
export function resolveSessionsDir(vaultDir: string, declared: string): string {
  if (declared === "~") return os.homedir();
  if (declared.startsWith("~/")) return path.join(os.homedir(), declared.slice(2));
  return path.resolve(vaultDir, declared);
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

/**
 * A required-but-absent path caught at load time rather than at the moment
 * something reaches for it.
 *
 * The only shape checked today: a repository named under
 * `adapters.transcript.projectDir` while `product.repos` is empty. That is
 * the case the 2026-08-06 sweep actually hit — `product.repos` has no path
 * to validate when it is simply missing, so a check that only stats declared
 * paths sails straight past it (see the assumption test this closes).
 */
export interface DeclaredPathDiagnostic {
  /** The config key that should have been set. */
  key: string;
  /** One line, naming the gap and the value that would close it. */
  message: string;
}

/**
 * Diagnose the one required-but-absent shape this schema can recognise
 * without asking the operator to declare intent twice: a key that already
 * names a repository while `product.repos` — the key that grants the agent
 * READ access to it — was never set. Silent for a fully-configured vault and
 * for one configuring neither key, which is load-bearing: those two silent
 * cases are what keep this from nagging every correctly-configured vault.
 */
export function declaredPathDiagnostics(config: Config): DeclaredPathDiagnostic[] {
  const transcriptRepo = config.adapters.transcript.projectDir.trim();
  if (transcriptRepo === "" || config.product.repos.length > 0) return [];
  return [
    {
      key: "product.repos",
      message:
        `product.repos is absent in ${CONFIG_FILENAME}, but adapters.transcript.projectDir names a repository ` +
        `(${transcriptRepo}) — add it under product.repos so the agent may read the product it is harvesting ` +
        `sessions from, e.g.:\nproduct:\n  repos:\n    - ${transcriptRepo}`,
    },
  ];
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
  /**
   * Required-but-absent declared paths, checked here so the gap is visible at
   * load time instead of the first time something reaches for the path and
   * finds nothing there. Always present, always `[]` when nothing was found —
   * never `undefined`, so a caller cannot mistake "not computed" for "clean".
   */
  diagnostics: DeclaredPathDiagnostic[];
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
    if (opts.missing === "defaults") return { config: defaultConfig(), diagnostics: [] };
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
    return {
      config: defaultConfig(),
      problem: `${CONFIG_FILENAME} is not valid YAML: ${e instanceof Error ? e.message : String(e)}`,
      diagnostics: [],
    };
  }
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    return { config: defaultConfig(), problem: `invalid ${CONFIG_FILENAME}:\n${issues}`, diagnostics: [] };
  }
  return { config: result.data, diagnostics: declaredPathDiagnostics(result.data) };
}

/** Read + validate the config. Throws a readable error on invalid/missing config. */
export function loadConfig(vaultDir: string, opts: LoadConfigOptions = {}): Config {
  const { config, problem } = readConfig(vaultDir, opts);
  if (problem) throw new Error(problem);
  return config;
}
