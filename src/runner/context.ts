/**
 * Build a PassContext from a vault directory: load config, open the vault, and
 * instantiate the enabled read-only sources.
 *
 * **Source construction degrades per source, and that is the whole reason this
 * file changed.** It used to throw the moment any enabled adapter was missing its
 * credentials, and `buildPassContext` is what every tool is built through — so an
 * absent `SLACK_BOT_TOKEN` took `ost_check` and `ost_read_tree` down with it, tools
 * that never needed the token. The MCP server worked around that by refusing to
 * build sources at all (`skipSources: true`), which cost the surface every adapter
 * it ships: the tree could not feed itself because nothing on the live surface ever
 * constructed a source (S1, S5).
 *
 * The shape is `readConfig`'s, deliberately reused rather than reinvented (G1): a
 * problem becomes a NAMED, REPORTED unavailability on `unavailableSources`, the
 * capabilities that do not depend on it keep working, and the one tool that does
 * says plainly which channel is missing and why. Skipping silently is the one thing
 * it may not do — a default is a fallback, never a substitute for the operator's
 * intent, and an enabled channel that quietly vanishes makes "0 new items" mean
 * both "nothing to report" and "never looked".
 */
import path from "node:path";
import { CONFIG_FILENAME, defaultConfig, loadConfig, readConfig, resolveSessionsDir } from "../config/load.js";
import { resolveChannels } from "../adapters/channels.js";
import { InboxSource } from "../adapters/inbox.js";
import { AtlassianSource, HttpAtlassianClient } from "../adapters/atlassian.js";
import { TranscriptSource, defaultTranscriptDir, type TranscriptDir } from "../adapters/transcript.js";
import { UsageSource } from "../adapters/usage.js";
import { usageLogPath } from "../telemetry/usage.js";
import { SlackSource, HttpSlackClient } from "../adapters/slack.js";
import { ActionsSource, HttpActionsClient } from "../adapters/actions.js";
import type { Source } from "../adapters/source.js";
import { Vault } from "../ost/vault.js";
import { createLookupBudget } from "../web/budget.js";
import { braveProvider, type SearchProvider } from "../web/search.js";
import { federatedProvider } from "../web/federated.js";
import { wikipediaSource, hackerNewsSource, discourseSource } from "../web/sources.js";
import type { Config } from "../config/schema.js";
import { effectiveRuleset } from "../knowledge/ruleset-proposal.js";
import type { PassContext, UnavailableSource } from "../processes/types.js";
import { brokeredFetch } from "../security/brokered-fetch.js";
import { fileAuditSink } from "../security/credential-audit.js";
import {
  ASKER_ACTIONS,
  ASKER_ATLASSIAN,
  ASKER_SEARCH,
  ASKER_SLACK,
  CREDENTIAL_ATLASSIAN,
  CREDENTIAL_GITHUB,
  CREDENTIAL_SEARCH,
  CREDENTIAL_SLACK,
  credentialBrokerFromEnv,
  type EnvBroker,
} from "./credentials.js";

/**
 * Which session directories the transcript adapter reads, and what to call them.
 *
 * Two, when the vault runs unattended, and the second one is the point.
 *
 * `adapters.transcript` names the sessions an operator asked for — but Claude
 * Code keys a session directory to the cwd a session ran in, and an unattended
 * firing runs with cwd set to the *vault*. So a vault that configures the code
 * repository harvests every session in which the agent was worked on by a person
 * and none of the ones in which it ran by itself. That is what happened to this
 * product's own vault for the loop's whole life: 36 sessions cited, all attended,
 * zero firings, and no signal anywhere that a whole half was missing.
 *
 * The firing directory is **not a third thing for the operator to declare.** It
 * is already written down, once, as `loop.spend.sessionsDir` — the same reuse and
 * the same argument as `src/loop/corrections.ts`: a key somebody has to type
 * twice is a key they leave unset, which would turn this off on exactly the
 * vaults that run unattended and therefore need it most. Consent is not stretched
 * by reading it, either: `adapters.transcript.enabled` is opt-in and off by
 * default *because* it reads transcripts, and these are the same agent's
 * transcripts in the folder the operator pointed the loop at.
 *
 * A vault with no `loop:` block gets exactly what it got before — one directory.
 */
export function transcriptDirs(vaultDir: string, config: Config): TranscriptDir[] {
  const t = config.adapters.transcript;
  const dirs: TranscriptDir[] = [];
  if (t.path) {
    dirs.push({ dir: path.resolve(vaultDir, t.path), origin: `sessions in ${t.path}` });
  } else if (t.projectDir) {
    dirs.push({ dir: defaultTranscriptDir(t.projectDir), origin: `sessions run in ${t.projectDir}` });
  }
  // `questions.sessionsDir` is the fallback for the same reason `corrections`
  // reads it: it is the other place the loop's own session directory is declared,
  // and a vault that set only that one still means the same folder.
  const declared = config.loop?.spend?.sessionsDir ?? config.loop?.questions?.sessionsDir;
  if (declared) {
    dirs.push({
      dir: resolveSessionsDir(vaultDir, declared),
      origin: "this vault's own unattended firings — nobody was watching",
    });
  }
  return dirs;
}

/**
 * Brave if a key is held, else the keyless federated sources if they are turned
 * on, else nothing — in which case ost_search_web tells the agent to use its
 * host's own search, which is the normal path in Claude Code.
 *
 * The provider is built over the broker's HANDLE, never the key: `braveProvider`
 * puts what it is given into `X-Subscription-Token`, and what it is given now
 * names a secret instead of being one.
 */
function resolveSearchProvider(config: Config, credentials: EnvBroker): SearchProvider | undefined {
  if (credentials.broker.holds(CREDENTIAL_SEARCH)) {
    // The brokered transport is bound INTO the provider rather than left on
    // `ctx.web.fetchFn`, because that field is also what `ost_read_web` reads
    // pages with: routing every page read through the search credential's grant
    // would deny every URL that is not Brave. A credential's transport belongs
    // to the credential.
    return braveProvider(
      credentials.broker.handle(CREDENTIAL_SEARCH),
      brokeredFetch(credentials.broker, ASKER_SEARCH),
    );
  }
  if (!config.web.search.federated.enabled) return undefined;
  const sources = [
    wikipediaSource(),
    hackerNewsSource(),
    ...config.web.search.federated.discourseHosts.map((h) => discourseSource(h)),
  ];
  return federatedProvider(sources);
}

export interface BuildPassContextOptions {
  /**
   * Tolerate a directory that has no `ost.config.yaml` yet, falling back to
   * defaults. Only the MCP server sets this: it must start in a not-yet-a-vault
   * directory in order to tell the operator how to create one. Every tool it
   * exposes is gated behind `vaultReadiness`, so the defaults are never acted on.
   */
  allowMissingConfig?: boolean;
  /**
   * Build no adapter sources at all, and claim nothing about them:
   * `unavailableSources` comes back empty because nothing was considered.
   *
   * The MCP server no longer sets this — its `ost_ingest_inbox` reads
   * `ctx.passContext.sources`, so suppressing them is what left the tree unable to
   * feed itself (S1). What is left is `init`, which needs the config and the vault
   * handle and nothing else, and the listing-only path. It is NOT a way to survive
   * a missing credential any more: that is per-source degradation's job, above.
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
  /**
   * Survive a present-but-BROKEN `ost.config.yaml` by falling back to schema defaults
   * and reporting the problem on `configProblem`, instead of throwing (G1).
   *
   * Set by the MCP server and not by the CLI, and the split is deliberate. A human at
   * a shell who runs `ost-agent check` against a broken config wants the error and can
   * fix it in the next second; the unattended surface has nobody to tell, and taking
   * every tool down over a file that reading the tree never needed is the failure this
   * option exists to end.
   */
  tolerateInvalidConfig?: boolean;
}

/** One line, so a multi-line adapter message cannot forge structure in a report. */
function oneLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").trim();
}

interface AssembledSources {
  sources: Source[];
  unavailableSources: UnavailableSource[];
}

/**
 * Every source this vault declares — the ones that could be built, and by name the
 * ones that could not.
 *
 * The two outputs are a partition of what the config asks for, and that is the
 * property to preserve when adding an adapter: a declared channel lands in exactly
 * one of them, always. Dropping a channel from both lists is how "0 new items" and
 * "never looked" became the same sentence.
 */
function buildSources(dir: string, config: Config, credentials: EnvBroker): AssembledSources {
  const sources: Source[] = [];
  const unavailableSources: UnavailableSource[] = [];

  /**
   * Construct one source, or record why not. `disabled` is a message when the
   * operator turned this channel off and `null` when they did not — the
   * distinction survives all the way to the report because "off by choice" and
   * "asked for and broken" are different facts.
   */
  const consider = (name: string, disabled: string | null, build: () => Source): void => {
    if (disabled !== null) {
      unavailableSources.push({ name, kind: "disabled", reason: disabled });
      return;
    }
    try {
      sources.push(build());
    } catch (e) {
      // The throw is CAUGHT, not prevented, so an adapter keeps stating its own
      // requirement in its own words at the place that knows it — and one adapter's
      // unmet requirement costs that adapter alone.
      unavailableSources.push({ name, kind: "unavailable", reason: oneLine(e) });
    }
  };

  // Drop folders come from `resolveChannels` and never from `config.adapters.inbox`
  // directly: the resolver is the single place drop-folder configuration and its
  // back-compat live, and reading the config here would be a second answer to "which
  // folder is the inbox".
  try {
    const resolution = resolveChannels(dir, config);
    for (const problem of resolution.problems) {
      // A refused channel is not a disabled one. The operator asked for it and it is
      // not running, which is exactly the state that must never read as "empty".
      unavailableSources.push({ name: "adapters.inbox.channels", kind: "unavailable", reason: problem });
    }
    for (const channel of resolution.channels) {
      consider(
        channel.name,
        channel.enabled ? null : `turned off in ${CONFIG_FILENAME} — nothing is read from ${channel.declaredPath}`,
        () => new InboxSource({ dir: channel.dir, channel: channel.name }),
      );
    }
  } catch (e) {
    // Nothing in `resolveChannels` is supposed to throw — it reports refusals on
    // `problems`. If it does anyway, the drop folders are lost and every OTHER
    // channel must still run: this catch is what keeps that true, and it names the
    // loss rather than leaving an empty channel list to be read as "no folders".
    unavailableSources.push({
      name: "adapters.inbox",
      kind: "unavailable",
      reason: `the channel list could not be resolved: ${oneLine(e)}`,
    });
  }

  consider(
    "transcript",
    config.adapters.transcript.enabled ? null : `turned off in ${CONFIG_FILENAME} (adapters.transcript.enabled: false)`,
    () => {
      const t = config.adapters.transcript;
      if (!t.path && !t.projectDir) {
        throw new Error(
          "adapters.transcript is enabled but neither `path` nor `projectDir` is set — " +
            "set projectDir to the repo whose sessions to harvest, or path to a directory of *.jsonl transcripts.",
        );
      }
      return new TranscriptSource({
        dirs: transcriptDirs(dir, config),
        quietMinutes: t.quietMinutes,
        maxEventsPerSession: t.maxEventsPerSession,
      });
    },
  );

  consider(
    "usage",
    config.adapters.usage.enabled ? null : `turned off in ${CONFIG_FILENAME} (adapters.usage.enabled: false)`,
    () => new UsageSource({ file: usageLogPath(dir), minEvents: config.adapters.usage.minEvents }),
  );

  consider(
    "atlassian",
    config.adapters.atlassian.enabled ? null : `turned off in ${CONFIG_FILENAME} (adapters.atlassian.enabled: false)`,
    () => {
      const baseUrl = process.env.ATLASSIAN_BASE_URL;
      const email = process.env.ATLASSIAN_EMAIL;
      if (!baseUrl || !email || !credentials.broker.holds(CREDENTIAL_ATLASSIAN)) {
        const why = credentials.problems[CREDENTIAL_ATLASSIAN];
        throw new Error(
          "adapters.atlassian is enabled but ATLASSIAN_BASE_URL / ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN are not all set" +
            `${why ? ` — ${why}` : ""}. Use a read-only API token (id.atlassian.com → API tokens).`,
        );
      }
      // The client composes the same Basic header it always did, over a HANDLE
      // rather than the token. The broker substitutes the secret at the last
      // moment — after the URL has been checked against the grant and the
      // request has been written to the vault's credential log.
      return new AtlassianSource(
        new HttpAtlassianClient({
          baseUrl,
          email,
          apiToken: credentials.broker.handle(CREDENTIAL_ATLASSIAN),
          fetchFn: brokeredFetch(credentials.broker, ASKER_ATLASSIAN),
        }),
        {
          projects: config.adapters.atlassian.projects,
          spaces: config.adapters.atlassian.spaces,
        },
      );
    },
  );

  consider(
    "slack",
    config.adapters.slack.enabled ? null : `turned off in ${CONFIG_FILENAME} (adapters.slack.enabled: false)`,
    () => {
      if (!credentials.broker.holds(CREDENTIAL_SLACK)) {
        throw new Error(
          `adapters.slack is enabled but ${credentials.problems[CREDENTIAL_SLACK] ?? "SLACK_BOT_TOKEN is not set"}. ` +
            "Use a least-privilege bot token (scopes: channels:history, channels:read); it is never written into the vault.",
        );
      }
      return new SlackSource(
        new HttpSlackClient({
          token: credentials.broker.handle(CREDENTIAL_SLACK),
          fetchFn: brokeredFetch(credentials.broker, ASKER_SLACK),
        }),
        { channels: config.adapters.slack.channels },
      );
    },
  );

  consider(
    "actions",
    config.adapters.actions.enabled ? null : `turned off in ${CONFIG_FILENAME} (adapters.actions.enabled: false)`,
    () => {
      const a = config.adapters.actions;
      if (!a.repo) {
        throw new Error(
          'adapters.actions is enabled but `repo` is not set — set it to the "owner/repo" whose workflow runs ' +
            "measure this product. It is not derived from a git remote, because a checkout can point at a fork.",
        );
      }
      // A public repository needs no credential at all, so a held token is an
      // upgrade rather than a requirement: an unauthenticated read still works and
      // still delivers, it just carries the anonymous rate limit. Refusing to run
      // without GITHUB_TOKEN would make the commonest case — a public repo — the
      // one that reports itself unavailable.
      const authed = credentials.broker.holds(CREDENTIAL_GITHUB);
      return new ActionsSource(
        new HttpActionsClient({
          repo: a.repo,
          ...(authed ? { token: credentials.broker.handle(CREDENTIAL_GITHUB) } : {}),
          fetchFn: authed ? brokeredFetch(credentials.broker, ASKER_ACTIONS) : undefined,
        }),
        { repo: a.repo, minRuns: a.minRuns, lookbackDays: a.lookbackDays },
      );
    },
  );

  return { sources, unavailableSources };
}

export function buildPassContext(vaultDir: string, opts: BuildPassContextOptions = {}): PassContext {
  const dir = path.resolve(vaultDir);
  const missing = opts.allowMissingConfig ? ({ missing: "defaults" } as const) : {};
  const loaded = opts.listingOnly
    ? { config: defaultConfig(), problem: undefined }
    : opts.tolerateInvalidConfig
      ? readConfig(dir, missing)
      : { config: loadConfig(dir, missing), problem: undefined };
  const config = loaded.config;
  const skipSources = opts.skipSources === true || opts.listingOnly === true;

  // Every secret this process will use is read once, here, and never again. What
  // travels onward — to the adapters, onto this context, into a tool — is a
  // handle and a brokered fetch. The audit sink writes into the vault, which is
  // the thing an operator already backs up and already reads.
  const credentials = credentialBrokerFromEnv({
    audit: fileAuditSink(dir),
    // The grant for a GitHub token names the one repository the operator declared;
    // see `githubRepo` in credentials.ts for why it is not derived from a remote.
    githubRepo: config.adapters.actions.repo,
  });

  const { sources, unavailableSources } = skipSources
    ? { sources: [] as Source[], unavailableSources: [] as UnavailableSource[] }
    : buildSources(dir, config, credentials);

  return {
    vault: new Vault(dir, { create: !opts.listingOnly }),
    dir,
    config,
    ...(loaded.problem ? { configProblem: loaded.problem } : {}),
    // The ruleset with every human-ACCEPTED proposal folded in. Pending and
    // rejected proposals change nothing here — see src/knowledge/ruleset-proposal.ts.
    ruleset: effectiveRuleset(dir).ruleset,
    sources,
    unavailableSources,
    remote: { enabled: config.remote.enabled, url: config.remote.url },
    // The key is optional: ost_read_web works without it, and ost_search_web
    // answers at call time — with results if a provider resolved, otherwise
    // with the delegation instruction.
    //
    // `searchApiKey` is a HANDLE now, not a key. This field is on the object every
    // tool is built with, so for as long as it carried the real thing the search
    // credential was readable by every code path that could reach a context — a
    // containment hole nothing was watching. The handle keeps the field's one
    // remaining job (does search have a credential at all?) and is worth nothing
    // to anyone who reads it.
    web: {
      searchApiKey: credentials.broker.holds(CREDENTIAL_SEARCH)
        ? credentials.broker.handle(CREDENTIAL_SEARCH)
        : undefined,
      provider: resolveSearchProvider(config, credentials),
      // The operator's number governs unless the genome explicitly overrides
      // it — one budget, never two that can disagree. The refill rate stays
      // the operator's alone: it is what makes a weeks-long session workable,
      // not a trait worth varying between vaults.
      budget: createLookupBudget(config.web.lookupBudget, {
        refillPerHour: config.web.lookupRefillPerHour,
      }),
    },
    productRepos: config.product.repos,
  };
}
