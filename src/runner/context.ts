/**
 * Build a PassContext from a vault directory: load config, open the vault, and
 * instantiate the enabled read-only sources.
 */
import path from "node:path";
import { loadConfig } from "../config/load.js";
import { InboxSource } from "../adapters/inbox.js";
import type { Source } from "../adapters/source.js";
import { Vault } from "../ost/vault.js";
import { OST_RULESET } from "../knowledge/ruleset.js";
import type { PassContext } from "../processes/types.js";

export function buildPassContext(vaultDir: string): PassContext {
  const dir = path.resolve(vaultDir);
  const config = loadConfig(dir);

  const sources: Source[] = [];
  if (config.adapters.inbox.enabled) {
    sources.push(new InboxSource(path.join(dir, config.adapters.inbox.path)));
  }
  // Atlassian / Slack adapters are added here once built.

  return {
    vault: new Vault(dir),
    dir,
    config,
    ruleset: OST_RULESET,
    sources,
    remote: { enabled: config.remote.enabled, url: config.remote.url },
  };
}
