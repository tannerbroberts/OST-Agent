/**
 * `--vault` for the whole CLI, resolved in exactly one place.
 *
 * Every command that touches a tree takes `--vault`, and every one of them used
 * to carry its own default. Twenty of the twenty-two defaulted to `"."`; two —
 * `friction` and `mcp` — read `process.env.OST_VAULT` first. So the environment
 * variable the plugin sets for every session
 * (`.claude-plugin/plugin.json`: `OST_VAULT=${CLAUDE_PROJECT_DIR}`) was honoured
 * by two commands out of twenty-two, and `ost-agent status` run from a project
 * directory looked in the project directory no matter what anything had been
 * told. A default repeated at twenty-two call sites is a rule with twenty-two
 * chances to disagree with itself.
 *
 * So none of them declare a default now. The option is left unset, a `preAction`
 * hook on the root program fills it in from `resolveVaultDir`, and every command
 * — including the ones added later, and the ones in `loop.ts` — gets the same
 * answer for the same reason. `test/config/vault-pointer-resolution.test.ts`
 * holds the declarations to that form, so a new command cannot quietly opt out by
 * bringing its own default back.
 */
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { CONFIG_FILENAME } from "../config/load.js";
import { describeVaultSource, resolveVaultDir, type VaultResolution } from "../config/pointer.js";

/**
 * The help text every `--vault` declaration shares. It names the search order
 * rather than a value, because there is no single value to print: what `--vault`
 * defaults to depends on where the command was run.
 */
export const VAULT_OPTION_HELP =
  "vault directory (default: the vault named by ost.vault.yaml, else $OST_VAULT, else the current directory)";

/**
 * Fill in `--vault` for any command that declares it and was not given one.
 *
 * `preAction` on the root program reaches every nested subcommand, so this is
 * installed once and covers commands registered from other modules. The
 * `getOptionValueSource` check is what keeps an explicit `--vault` sovereign: a
 * value that came from the command line is left exactly as typed.
 *
 * A pointer file that could not be read is reported on **stderr**, never stdout —
 * `ost-agent mcp` speaks JSON-RPC on stdout, and several commands are read for
 * their output by scripts.
 */
export function installVaultResolution(program: Command): void {
  program.hook("preAction", (_root, actionCommand) => {
    const declaresVault = actionCommand.options.some((o) => o.long === "--vault");
    if (!declaresVault) return;
    if (actionCommand.getOptionValueSource("vault") !== undefined) return;

    lastResolution = resolveVaultDir();
    actionCommand.setOptionValue("vault", lastResolution.dir);
    const complaint = lastResolution.problem ? describeVaultSource(lastResolution) : stalePointerWarning(lastResolution);
    if (complaint) console.error(`ost-agent: ${complaint}`);
  });
}

/**
 * How the running command got its vault, for the one surface with room to say
 * so. Null when `--vault` was typed — there is nothing to explain about a
 * directory the operator named themselves. A single CLI invocation runs one
 * action, so one slot holds the whole answer.
 */
let lastResolution: VaultResolution | null = null;

export function resolvedVaultSource(): VaultResolution | null {
  return lastResolution;
}

/**
 * The one thing the pointer file is bad at, said out loud.
 *
 * A pointer is only a string: it goes stale the moment the vault moves, and the
 * silent version of that is a session getting sent to a directory that used to be
 * a tree and hearing only `no ost.config.yaml in <somewhere it never chose>`.
 * Whoever reads that has to work out on their own that a file they may not know
 * exists is what sent them there.
 *
 * Only fires for a pointer-sourced answer. A missing vault at a path the operator
 * typed, exported, or is standing in needs no explanation.
 */
export function stalePointerWarning(r: VaultResolution): string | null {
  if (r.via !== "pointer" || !r.pointer) return null;
  if (fs.existsSync(path.join(r.dir, CONFIG_FILENAME))) return null;
  return (
    `${r.pointer.file} names ${r.dir}, which is not a vault (no ${CONFIG_FILENAME}). ` +
    `The pointer is stale, or that vault has not been cloned onto this machine.`
  );
}
