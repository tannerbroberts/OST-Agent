/**
 * The permission policy.
 *
 * `ALLOWED_TOOL_NAMES` is the complete, closed set of tools OST-Agent may ever
 * hold. `assertNoDestructiveTool` is a fail-closed guard the MCP server calls
 * while building its tool set, before a single tool is exposed to a session: it
 * refuses to proceed if the resolved set contains anything outside the allowlist
 * or anything whose name smells destructive. This is defense-in-depth on top of
 * the fact that no destructive tool is ever built.
 */

export const ALLOWED_TOOL_NAMES = [
  "ost_read_tree",
  "ost_next_work",
  "ost_create_node",
  "ost_append_to_node",
  "ost_link_nodes",
  "ost_set_status",
  "ost_set_evidence",
  // Restrictive-only by construction: it can put a test out of compute's reach
  // and nothing else. There is deliberately no general lane setter here — see
  // ost/lanes.ts `flagHumansRequired`.
  "ost_flag_humans_required",
  "ost_annotate",
  // Outward sensing (see docs/superpowers/specs/2026-07-26-web-lookup-and-trust-design.md):
  // read-only web lookups under a per-session budget, read-only product-repo
  // sight, and append-only publisher trust ranking capped at 'expert'.
  "ost_search_web",
  "ost_read_web",
  "ost_read_repo",
  "ost_rank_source",
  // The deterministic analysis surface: no model, no writes. These were CLI
  // commands reachable only through a Bash grant on a published binary; with
  // the binary gone they belong on the tool surface like everything else.
  "ost_check",
  "ost_debt",
  "ost_status",
  "ost_gate",
  // The vault's one input path: read the local drop folder and capture each new
  // note as an evidence record. Append-only and idempotent — the adapter's cursor
  // and writeEvidence both refuse to re-ingest. No credentials, no network.
  "ost_ingest_inbox",
  "git_commit",
  "git_push",
] as const;

export type AllowedToolName = (typeof ALLOWED_TOOL_NAMES)[number];

/**
 * Tokens that mark a tool as destructive. Matched against the name's tokens (split
 * on non-alphanumerics AND camelCase) so snake_case like `rm_rf` or `git_reset`
 * cannot slip past a `\b` word boundary. Errs toward over-flagging (fail-closed).
 */
const DESTRUCTIVE_TOKENS = new Set([
  "delete", "destroy", "remove", "rm", "rmdir", "reset", "revert", "force",
  "clean", "rewrite", "overwrite", "truncate", "drop", "wipe", "purge",
  "bash", "sh", "shell", "exec", "spawn", "eval", "system", "run",
  "unlink", "rename", "move", "mv", "replace", "write", "writefile",
  "branch", "checkout", "fetch", "pull", "clone", "rebase", "filter",
]);

function tokenize(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/**
 * Throw if `names` contains any tool that is not on the allowlist or that matches
 * a destructive token. `git_push` and `git_commit` are allowlisted and safe by
 * construction (see git/safe-git.ts) despite touching git.
 */
export function assertNoDestructiveTool(names: readonly string[]): void {
  const allowed = new Set<string>(ALLOWED_TOOL_NAMES);
  for (const name of names) {
    if (!allowed.has(name)) {
      throw new Error(`tool "${name}" is not on the OST-Agent allowlist — refusing to run`);
    }
    // allowlisted git tools are exempt from the token-level destructive scan
    if (name === "git_commit" || name === "git_push") continue;
    if (isDestructiveToolName(name)) {
      throw new Error(`tool "${name}" matches a destructive pattern — refusing to run`);
    }
  }
}

/** True if a name (from anywhere) looks destructive. Used to vet external tools. */
export function isDestructiveToolName(name: string): boolean {
  return tokenize(name).some((t) => DESTRUCTIVE_TOKENS.has(t));
}
