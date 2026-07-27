/**
 * First-run setup guidance — the single source of truth for both surfaces.
 *
 * The MCP server (setup mode, when pointed at an uninitialized directory) and
 * the generated skill (`scripts/gen-skill.ts`) both render from these pieces,
 * so the instructions a session reads in a tool error and the instructions it
 * was taught by the skill can never drift apart.
 *
 * The one non-negotiable: the outcome is human-set. Setup is deliberately a
 * conversation — the agent asks, the human answers, the agent runs init with
 * their words. There is no ost_init tool for the same reason set-outcome is a
 * human-only CLI command: an agent must never originate the mandate it steers by.
 */
import type { VaultNotReady } from "./bootstrap.js";

/** The ask-the-human rule, verbatim on both surfaces. */
export const ASK_HUMAN_RULE =
  "Ask the human what outcome this tree should steer toward — a product outcome, in their words. " +
  "NEVER invent or assume the outcome yourself: the outcome is human-set, always.";

/** The exact command that scaffolds a vault. Needs no AI and no API key. */
export function initCommand(dir: string): string {
  return `npx -y ost-agent@latest init "${dir}" --outcome "<the human's outcome, verbatim>"`;
}

/** The exact command that sets the Outcome on an existing vault that lacks one. */
export function setOutcomeCommand(dir: string): string {
  return `npx -y ost-agent@latest set-outcome "<the human's outcome, verbatim>" --vault "${dir}"`;
}

export const NO_KEY_NOTE = "Setup needs no AI and no API key.";

/**
 * The message every OST tool returns while the vault is not ready.
 * Written to the connecting agent, not the human — it tells the session how to
 * drive setup conversationally and that the tools recover without a reconnect.
 *
 * Rendered from the readiness state itself so the command it names is the SAME
 * command `ost_next_work`'s bootstrap payload names for the same state: `init`
 * when there is no vault, `set-outcome` when a vault merely lacks its Outcome
 * node. (Running `init` on an existing vault would silently keep the old
 * config, discarding the human's outcome — so the two states must never share
 * a remedy.)
 */
export function setupGuidance(r: VaultNotReady): string {
  return [
    r.message,
    ASK_HUMAN_RULE,
    `Then run: ${r.nextStep}   (${NO_KEY_NOTE})`,
    "Then retry this tool — the server detects the change immediately; no reconnect needed.",
  ].join("\n");
}

/**
 * The message every OST tool returns when the vault exists but its context
 * cannot be built (unparseable `ost.config.yaml`, or an enabled adapter whose
 * requirements the config names are unmet). Answering with the cause and the
 * fix keeps a broken config from degrading every call into a raw protocol
 * error — the least actionable signal a session could get.
 */
export function configProblemGuidance(dir: string, cause: string): string {
  return [
    `The vault at ${dir} exists, but its configuration could not be loaded, so no OST tool can run yet:`,
    cause,
    "Fix `ost.config.yaml` in the vault, then retry this tool — the server picks up the fix immediately; no reconnect needed.",
  ].join("\n");
}

/** The first-run section rendered into the generated skill. */
export function firstRunSkillSection(): string {
  return [
    "## First run — if the vault is not initialized",
    "",
    "If any `ost_*` tool responds that the vault is **not initialized**, do not stop and do not guess. Setup runs itself, in conversation:",
    "",
    `1. ${ASK_HUMAN_RULE}`,
    `2. Run (via your shell): \`${initCommand("<project dir>")}\` — ${NO_KEY_NOTE}`,
    "3. Retry the tool call: the MCP server picks up the new vault immediately, with no reconnect. Then continue with the normal flow below.",
  ].join("\n");
}
