/**
 * The context one unit of tree maintenance runs against.
 *
 * Everything the MCP surface needs to act on a vault — the append-only Vault
 * handle, the resolved config and ruleset, the enabled read-only sources, and
 * the outward-sensing budget — gathered once by `buildPassContext`.
 */
import type { Config } from "../config/schema.js";
import type { OST_RULESET } from "../knowledge/ruleset.js";
import type { RemoteConfig } from "../security/tools.js";
import type { Source } from "../adapters/source.js";
import type { Vault } from "../ost/vault.js";
import type { WebFetchFn } from "../web/reader.js";
import type { SearchProvider } from "../web/search.js";
import type { LookupBudget } from "../web/budget.js";

/**
 * A channel this process is NOT reading, and why — the other half of {@link
 * PassContext.sources}.
 *
 * Source construction degrades per source the way `readConfig` degrades per config
 * problem (G1): a channel whose credentials are absent becomes an entry here rather
 * than a throw that takes the whole tool surface down with it. The list exists
 * because *skipping is not reporting*. A channel the operator enabled and that
 * cannot run must be named, or "0 new items" means both "nothing to report" and
 * "never looked" — the ambiguity S2 exists to destroy.
 */
export interface UnavailableSource {
  /**
   * What to call the thing that is not running — usually the channel name, which is
   * also the cursor file it would have used.
   *
   * **It is not always a channel name, and assuming so would be a bug.** A channel
   * REFUSED by `resolveChannels` never becomes a channel at all, so there is no name
   * to key on and no cursor it would have written; those entries are named for the
   * config key that declared them (`adapters.inbox.channels`), with the refused name
   * inside `reason`. That means the field is a label for a report and not an index —
   * two entries can share it, and nothing may look a cursor up by it.
   */
  name: string;
  /**
   * `disabled` — the operator turned it off, and honouring that is not a failure.
   * `unavailable` — the operator asked for it and this process could not run it.
   * Two different facts for whoever is staring at a full drop folder, so they are
   * never merged into one word.
   */
  kind: "disabled" | "unavailable";
  /** One line, in the operator's terms: what is missing, and what to do about it. */
  reason: string;
}

export interface PassContext {
  vault: Vault;
  /** Vault directory (git working tree + `.ost-agent/`). */
  dir: string;
  config: Config;
  /**
   * Why the vault's own `ost.config.yaml` could not be used, when it could not.
   * `config` is then the schema defaults — a fallback for the capabilities that do
   * not depend on the file, and NOT a substitute for the operator's intent in the
   * ones that do. See `CONFIG_DEPENDENT` in `src/security/tools.ts`.
   */
  configProblem?: string;
  ruleset: typeof OST_RULESET;
  /** Enabled read-only sources that were successfully constructed. */
  sources: Source[];
  /**
   * Every declared channel that is NOT in {@link sources}, with the reason.
   *
   * Required rather than optional, so a surface that assembles a context has to
   * decide what it is claiming about the channels it did not build. An empty array
   * is the honest answer for a context built with `skipSources` — nothing was
   * considered — and the ingest tool reports the list verbatim.
   */
  unavailableSources: UnavailableSource[];
  remote: RemoteConfig;
  /** Outward web sensing: search key, injectable fetch, per-session lookup budget. */
  web?: { searchApiKey?: string; provider?: SearchProvider; fetchFn?: WebFetchFn; budget?: LookupBudget };
  /** Local product repo roots the agent may read (config `product.repos`). */
  productRepos?: readonly string[];
}
