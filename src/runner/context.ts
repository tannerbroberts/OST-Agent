/**
 * Build a PassContext from a vault directory: load config, open the vault, and
 * instantiate the enabled read-only sources.
 */
import path from "node:path";
import { loadConfig } from "../config/load.js";
import { InboxSource } from "../adapters/inbox.js";
import { AtlassianSource, HttpAtlassianClient } from "../adapters/atlassian.js";
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
  if (config.adapters.atlassian.enabled) {
    const baseUrl = process.env.ATLASSIAN_BASE_URL;
    const email = process.env.ATLASSIAN_EMAIL;
    const apiToken = process.env.ATLASSIAN_API_TOKEN;
    if (!baseUrl || !email || !apiToken) {
      throw new Error(
        "adapters.atlassian is enabled but ATLASSIAN_BASE_URL / ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN are not all set. " +
          "Use a read-only API token (id.atlassian.com → API tokens).",
      );
    }
    const client = new HttpAtlassianClient({ baseUrl, email, apiToken });
    sources.push(
      new AtlassianSource(client, {
        projects: config.adapters.atlassian.projects,
        spaces: config.adapters.atlassian.spaces,
      }),
    );
  }
  // Slack adapter is added here once built.

  return {
    vault: new Vault(dir),
    dir,
    config,
    ruleset: OST_RULESET,
    sources,
    remote: { enabled: config.remote.enabled, url: config.remote.url },
  };
}
