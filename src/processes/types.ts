/**
 * The context one unit of tree maintenance runs against.
 *
 * Everything the MCP surface needs to act on a vault — the append-only Vault
 * handle, the resolved config and ruleset, the enabled read-only sources, and
 * the outward-sensing budget — gathered once by `buildPassContext`.
 */
import type { Config } from "../config/schema.js";
import type { Genome } from "../genome/schema.js";
import type { OST_RULESET } from "../knowledge/ruleset.js";
import type { RemoteConfig } from "../security/tools.js";
import type { Source } from "../adapters/source.js";
import type { Vault } from "../ost/vault.js";
import type { WebFetchFn } from "../web/reader.js";
import type { LookupBudget } from "../web/budget.js";

export interface PassContext {
  vault: Vault;
  /** Vault directory (git working tree + `.ost-agent/`). */
  dir: string;
  config: Config;
  /**
   * The policy this pass interprets: every allele governing how unknowns are
   * classed, resolved, budgeted, and costed. Loaded exactly ONCE, by
   * `buildPassContext`, and never re-read — a pass whose policy could change
   * underneath it produces a fitness record that describes no genome at all.
   *
   * Non-optional. An absent `genome.yaml` is not a missing genome; it is the
   * default genome, which is today's behaviour written down.
   */
  genome: Genome;
  ruleset: typeof OST_RULESET;
  /** Enabled read-only sources. */
  sources: Source[];
  remote: RemoteConfig;
  /** Outward web sensing: search key, injectable fetch, per-session lookup budget. */
  web?: { searchApiKey?: string; fetchFn?: WebFetchFn; budget?: LookupBudget };
  /** Local product repo roots the agent may read (config `product.repos`). */
  productRepos?: readonly string[];
}
