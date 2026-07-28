/**
 * Build a PassContext from a vault directory: load config, open the vault, and
 * instantiate the enabled read-only sources.
 */
import path from "node:path";
import { defaultConfig, loadConfig } from "../config/load.js";
import { InboxSource } from "../adapters/inbox.js";
import { AtlassianSource, HttpAtlassianClient } from "../adapters/atlassian.js";
import { TranscriptSource, defaultTranscriptDir } from "../adapters/transcript.js";
import { UsageSource } from "../adapters/usage.js";
import { usageLogPath } from "../telemetry/usage.js";
import { SlackSource, HttpSlackClient } from "../adapters/slack.js";
import type { Source } from "../adapters/source.js";
import { Vault } from "../ost/vault.js";
import { createLookupBudget } from "../web/budget.js";
import { braveProvider } from "../web/search.js";
import { OST_RULESET } from "../knowledge/ruleset.js";
import { defaultGenome, loadGenome } from "../genome/load.js";
import type { PassContext } from "../processes/types.js";

export interface BuildPassContextOptions {
  /**
   * Tolerate a directory that has no `ost.config.yaml` yet, falling back to
   * defaults. Only the MCP server sets this: it must start in a not-yet-a-vault
   * directory in order to tell the operator how to create one. Every tool it
   * exposes is gated behind `vaultReadiness`, so the defaults are never acted on.
   */
  allowMissingConfig?: boolean;
  /**
   * Skip constructing adapter sources (and their env-var checks). The MCP
   * server sets this on its live context: its tool surface never consumes
   * `ctx.sources` — the tools are built from vault/dir/remote/web/product
   * alone — so an adapter whose env vars are absent in the MCP host process
   * must not be able to take unrelated tools down.
   */
  skipSources?: boolean;
  /**
   * Build a context fit only for RENDERING the tool listing: schema-default
   * config (never reads `ost.config.yaml`, so a present-but-broken file cannot
   * throw), no adapter sources, and a Vault handle that does not create the
   * directory. Only the MCP server's pre-ready ListTools path uses this;
   * nothing built this way may run a tool.
   */
  listingOnly?: boolean;
}

export function buildPassContext(vaultDir: string, opts: BuildPassContextOptions = {}): PassContext {
  const dir = path.resolve(vaultDir);
  const config = opts.listingOnly ? defaultConfig() : loadConfig(dir, opts.allowMissingConfig ? { missing: "defaults" } : {});
  // The genome is loaded exactly ONCE per pass, here, beside the config — and
  // never inside a tool's `run`. Two functions in this repo re-read config per
  // invocation (`ost_ingest_inbox` in src/security/tools.ts, `fileFriction` in
  // src/adapters/friction.ts); the same shape applied to the genome would let a
  // pass change its own policy while running, which corrupts the fitness record
  // rather than merely the run. There is no `allowMissingConfig` analogue: an
  // absent genome.yaml is not a missing vault, it is the default policy, always
  // and silently. A malformed one throws, exactly as a malformed config does.
  // `listingOnly` renders a tool listing for a directory that may not be a vault
  // and must not read vault files, so it takes the defaults without touching disk.
  const genome = opts.listingOnly ? defaultGenome() : loadGenome(dir);
  const skipSources = opts.skipSources === true || opts.listingOnly === true;

  const sources: Source[] = [];
  if (!skipSources && config.adapters.inbox.enabled) {
    sources.push(new InboxSource(path.join(dir, config.adapters.inbox.path)));
  }
  if (!skipSources && config.adapters.transcript.enabled) {
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
  if (!skipSources && config.adapters.usage.enabled) {
    sources.push(new UsageSource({ file: usageLogPath(dir), minEvents: config.adapters.usage.minEvents }));
  }
  if (!skipSources && config.adapters.atlassian.enabled) {
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
  if (!skipSources && config.adapters.slack.enabled) {
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
    vault: new Vault(dir, { create: !opts.listingOnly }),
    dir,
    config,
    genome,
    ruleset: OST_RULESET,
    sources,
    remote: { enabled: config.remote.enabled, url: config.remote.url },
    // The key is optional: ost_read_web works without it, and ost_search_web
    // answers at call time — with results if a provider resolved, otherwise
    // with the delegation instruction.
    web: {
      searchApiKey: process.env.BRAVE_SEARCH_API_KEY,
      provider: process.env.BRAVE_SEARCH_API_KEY ? braveProvider(process.env.BRAVE_SEARCH_API_KEY) : undefined,
      // The operator's number governs unless the genome explicitly overrides
      // it — one budget, never two that can disagree. The refill rate stays
      // the operator's alone: it is what makes a weeks-long session workable,
      // not a trait worth varying between vaults.
      budget: createLookupBudget(genome.budgets, config.web.lookupBudget, {
        refillPerHour: config.web.lookupRefillPerHour,
      }),
    },
    productRepos: config.product.repos,
  };
}
