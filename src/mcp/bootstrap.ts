/**
 * First-run readiness for the MCP surface.
 *
 * A session can reach these tools before a vault exists — `/plugin install`
 * wires the server into whatever directory the operator happens to be in. That
 * is the normal first minute of using this product, not an error condition, so
 * it gets a state of its own rather than a thrown stack.
 *
 * The agent may create everything in the tree except the one thing the tree
 * hangs from. So the bootstrap message routes the human decision (the outcome)
 * back to the human and names the exact command; it never offers to pick one.
 */
import fs from "node:fs";
import path from "node:path";
import { configPath } from "../config/load.js";
import { Vault } from "../ost/vault.js";
import { initCommand, setOutcomeCommand } from "./setup.js";
import type { PassContext } from "../processes/types.js";

export type NotReadyReason = "no-vault" | "no-outcome";

export interface VaultNotReady {
  ready: false;
  reason: NotReadyReason;
  /** Absolute directory the server was pointed at. */
  vault: string;
  /** What is wrong and who has to decide what, in prose an operator can act on. */
  message: string;
  /** The single command that fixes it. */
  nextStep: string;
}

export type VaultReadiness = { ready: true } | VaultNotReady;

/**
 * Is this directory a vault the append-only tools can maintain? Two ways it can
 * fail, kept distinct because they need different commands: nothing here at all,
 * versus a vault whose root Outcome is missing.
 */
export function vaultReadiness(ctx: Pick<PassContext, "dir"> & Partial<Pick<PassContext, "vault">>): VaultReadiness {
  // Only `dir` (plus an optional already-open vault) — readiness must be
  // probeable before a config can be loaded, or the lazy server could never say
  // what to do about that. Probing is strictly read-only: no Vault is opened
  // until the directory is known to exist, so a probe against a typo'd or
  // not-yet-created path creates NOTHING on disk.
  const vault = ctx.dir;
  // Either half missing means "not a vault". Checking the config too keeps the
  // placeholder outcome a defaults-loader borrows out of every reachable path.
  if (!fs.existsSync(path.join(vault, ".git")) || !fs.existsSync(configPath(vault))) {
    // The npx form: it works whether or not the ost-agent binary is on PATH,
    // and it is the SAME command `setupGuidance` renders — one wording, both
    // surfaces (see src/mcp/setup.ts).
    const nextStep = initCommand(vault);
    return {
      ready: false,
      reason: "no-vault",
      vault,
      message:
        `No OST vault at ${vault} — this directory has not been set up yet. ` +
        `Setting one up needs no model and no API key: it creates a git repo, a config, and the single root Outcome node. ` +
        `The Outcome is the human's mandate, so ask the human what outcome they want this tree to serve, in one sentence, ` +
        `and pass their words through verbatim. Never invent it, and never proceed without it. Then run: ${nextStep}. ` +
        `The guided version of exactly this is the /ost-setup slash command.`,
      nextStep,
    };
  }
  if (!(ctx.vault ?? new Vault(vault, { create: false })).readTree().some((n) => n.layer === "Outcome")) {
    const nextStep = setOutcomeCommand(vault);
    return {
      ready: false,
      reason: "no-outcome",
      vault,
      message:
        `The vault at ${vault} is a git repository but has no Outcome node, so nothing in it can ladder up to anything. ` +
        `The MCP server maintains an existing tree; it does not bootstrap one, and it may not choose the outcome. ` +
        `Ask the human for the outcome this tree serves and pass their words through verbatim. Then run: ${nextStep}. ` +
        `The guided version of exactly this is the /ost-setup slash command.`,
      nextStep,
    };
  }
  return { ready: true };
}

/**
 * The `ost_next_work` payload for a directory that is not a vault yet. Shaped
 * like a normal report (`done: false` plus a flag) rather than an error, because
 * every pass starts at `ost_next_work` and first run is a state of the tree, not
 * a malfunction of the tool.
 */
export function bootstrapNextWork(r: VaultNotReady): Record<string, unknown> {
  return {
    bootstrap: true,
    done: false,
    reason: r.reason,
    vault: r.vault,
    message: r.message,
    nextStep: r.nextStep,
  };
}
