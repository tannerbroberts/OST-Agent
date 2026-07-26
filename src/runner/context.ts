/**
 * Build a PassContext from a vault directory: load config, open the vault, and
 * instantiate the enabled read-only sources.
 */
import path from "node:path";
import { loadConfig } from "../config/load.js";
import { InboxSource } from "../adapters/inbox.js";
import { AtlassianSource, HttpAtlassianClient } from "../adapters/atlassian.js";
import { TranscriptSource, defaultTranscriptDir } from "../adapters/transcript.js";
import { UsageSource } from "../adapters/usage.js";
import { usageLogPath } from "../telemetry/usage.js";
import { SlackSource, HttpSlackClient } from "../adapters/slack.js";
import type { Source } from "../adapters/source.js";
import { Vault } from "../ost/vault.js";
import { createLookupBudget } from "../web/budget.js";
import { OST_RULESET } from "../knowledge/ruleset.js";
import type { PassContext } from "../processes/types.js";

export interface BuildPassContextOptions {
  /**
   * Tolerate a directory that has no `ost.config.yaml` yet, falling back to
   * defaults. Only the MCP server sets this: it must start in a not-yet-a-vault
   * directory in order to tell the operator how to create one. Every tool it
   * exposes is gated behind `vaultReadiness`, so the defaults are never acted on.
   */
  allowMissingConfig?: boolean;
}

export function buildPassContext(vaultDir: string, opts: BuildPassContextOptions = {}): PassContext {
  const dir = path.resolve(vaultDir);
  const config = loadConfig(dir, opts.allowMissingConfig ? { missing: "defaults" } : {});

  const sources: Source[] = [];
  if (config.adapters.inbox.enabled) {
    sources.push(new InboxSource(path.join(dir, config.adapters.inbox.path)));
  }
  if (config.adapters.transcript.enabled) {
    const t = config.adapters.transcript;
    if (!t.path && !t.projectDir) {
      throw new Error(
        "adapters.transcript is enabled but neither `path` nor `projectDir` is set — " +
          "set projectDir to the repo whose sessions to harvest, or path to a directory of *.jsonl transcripts.",
      );
    }
    sources.push(
      new TranscriptSource({
        dir: t.path ? path.resolve(dir, t.path) : defaultTranscriptDir(t.projectDir),
        quietMinutes: t.quietMinutes,
        maxEventsPerSession: t.maxEventsPerSession,
      }),
    );
  }
  if (config.adapters.usage.enabled) {
    sources.push(new UsageSource({ file: usageLogPath(dir), minEvents: config.adapters.usage.minEvents }));
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
  if (config.adapters.slack.enabled) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      throw new Error(
        "adapters.slack is enabled but SLACK_BOT_TOKEN is not set. " +
          "Use a least-privilege bot token (scopes: channels:history, channels:read); it is never written into the vault.",
      );
    }
    sources.push(new SlackSource(new HttpSlackClient({ token }), { channels: config.adapters.slack.channels }));
  }

  return {
    vault: new Vault(dir),
    dir,
    config,
    ruleset: OST_RULESET,
    sources,
    remote: { enabled: config.remote.enabled, url: config.remote.url },
    // The key is optional: ost_read_web works without it, and ost_search_web
    // answers with the setup hint at call time rather than failing the build.
    web: {
      searchApiKey: process.env.BRAVE_SEARCH_API_KEY,
      budget: createLookupBudget(config.web.lookupBudget),
    },
    productRepos: config.product.repos,
  };
}
