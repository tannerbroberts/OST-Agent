/**
 * Discovery-process framework.
 *
 * A process is one bounded unit of tree maintenance. Deterministic processes
 * (bootstrap, ingest, hygiene) act directly through the append-only Vault;
 * knowledge processes (mapping, ideation, assumptions) delegate to the agent
 * via a PassDriver, which is given ONLY that process's allowlisted tools.
 */
import type { Config } from "../config/schema.js";
import type { OST_RULESET } from "../knowledge/ruleset.js";
import type { AllowedToolName } from "../security/policy.js";
import type { RemoteConfig } from "../security/tools.js";
import type { Source } from "../adapters/source.js";
import type { Vault } from "../ost/vault.js";
import type { PassDriver, ToolSet } from "../runner/driver.js";

export interface PassContext {
  vault: Vault;
  /** Vault directory (git working tree + `.ost-agent/`). */
  dir: string;
  config: Config;
  ruleset: typeof OST_RULESET;
  /** Enabled read-only sources. */
  sources: Source[];
  remote: RemoteConfig;
}

export interface ProcessResult {
  created: number;
  linked: number;
  annotated: number;
  evidence: number;
  toolCalls: { name: string; input: unknown }[];
  notes: string[];
}

export function emptyResult(): ProcessResult {
  return { created: 0, linked: 0, annotated: 0, evidence: 0, toolCalls: [], notes: [] };
}

export interface ProcessDef {
  id: string;
  title: string;
  /** Tools this process may use (subset of the allowlist). */
  allowedTools: AllowedToolName[];
  /** Do the work for one pass. `tools` are pre-built + guarded by the runner. */
  run(ctx: PassContext, driver: PassDriver, tools: ToolSet): Promise<ProcessResult>;
  /** Definition-of-done: is there nothing left for this process to do? */
  isDone(ctx: PassContext): Promise<boolean>;
}
