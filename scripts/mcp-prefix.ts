/**
 * The MCP tool-name prefix a Claude Code session actually mints for this
 * plugin's server, derived from `.claude-plugin/plugin.json` rather than
 * hardcoded anywhere.
 *
 * **Both the plugin name and the server key matter.** A server registered
 * directly (`claude mcp add`, a project `.mcp.json`) is namespaced
 * `mcp__<server>__`. A server delivered by a plugin — the only install path
 * `README.md` documents — is namespaced `mcp__plugin_<plugin>_<server>__`. Both
 * names here happen to be `ost-agent`, which is why the shorter form read as
 * correct for 23 releases.
 *
 * **What the wrong form cost.** Deriving from the server key alone produced
 * `mcp__ost-agent__`, and every grant in the repo — nine command files, the
 * skill, both automation examples — named tools under it. No plugin session
 * mints those names. Interactively that is a permission prompt per tool, which
 * is why it looked harmless and was documented as harmless. Under `claude -p`
 * an ungranted call is **denied, not prompted**: the unattended pass ran, had
 * every call refused, wrote nothing, and exited `0` reporting success.
 * `docs/consuming-from-claude-code.md` records five scheduled firings spent on
 * that shape before it was understood.
 *
 * **Why it lives here.** It was derived independently in two places — this
 * generator and `test/release/command-allowlists.test.ts` — and both derived it
 * the same wrong way, so the guard agreed with the thing it was guarding.
 * Deriving is not the same as deriving correctly; one derivation, imported by
 * both, is what makes the next loader change a single edit.
 *
 * The generator stays deterministic: the manifest is a committed file, so
 * output remains a pure function of files in the tree and the drift guard
 * remains a byte-for-byte comparison.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function manifest(): { name?: string; mcpServers?: Record<string, unknown> } {
  return JSON.parse(fs.readFileSync(path.join(REPO, ".claude-plugin", "plugin.json"), "utf8")) as {
    name?: string;
    mcpServers?: Record<string, unknown>;
  };
}

function serverKey(): string {
  const servers = Object.keys(manifest().mcpServers ?? {});
  if (servers.length !== 1) {
    throw new Error(`.claude-plugin/plugin.json must declare exactly one mcpServers entry, found ${servers.length}`);
  }
  return servers[0];
}

/**
 * What a PLUGIN session mints — `/plugin install ost-agent@ost-agent`, the only
 * install path `README.md` documents, and therefore what every command file and
 * the skill must grant.
 */
export const MCP_PREFIX: string = (() => {
  const plugin = manifest().name;
  if (!plugin) {
    throw new Error(".claude-plugin/plugin.json must declare a `name` — the tool namespace cannot be derived");
  }
  return `mcp__plugin_${plugin}_${serverKey()}__`;
})();

/**
 * What a DIRECTLY registered server mints — `claude mcp add`, a project
 * `.mcp.json`, or `--mcp-config`, which is how `examples/automation/*.sh` runs
 * it. Their allowlists are correct under this form and must NOT be migrated to
 * the plugin one: they never load the plugin.
 *
 * Both forms exist on purpose and neither is a fallback for the other. The
 * failure this pair exists to prevent is not "the wrong prefix" — it is a reader
 * concluding there is one right answer, migrating every list to it, and taking
 * down whichever surface they were not thinking about.
 */
export const DIRECT_PREFIX: string = `mcp__${serverKey()}__`;

/**
 * A grant with whatever namespace it carries stripped off, so two lists written
 * for different surfaces can be compared on the thing that actually has to
 * match: which tools they name. `Bash(…)` and other non-MCP entries pass through
 * unchanged.
 */
export function bareToolName(grant: string): string {
  for (const prefix of [MCP_PREFIX, DIRECT_PREFIX]) {
    if (grant.startsWith(prefix)) return grant.slice(prefix.length);
  }
  return grant;
}
