/**
 * `set-outcome` — retune the steering mandate the agentic system optimizes toward.
 *
 * This is the outcome-tuning knob: like editing a prompt or a harness, changing
 * this text changes what the system pursues (and which feature sets it will/won't
 * chase). It is a HUMAN operation (a CLI command, never an agent tool), so the
 * agent can never rewrite its own mandate.
 *
 * Append-only in spirit: the new mandate becomes the root node's body, the prior
 * mandate is preserved under a `## History` section (and always in git), and the
 * root node keeps its stable identity (no rename, no delete). One new commit.
 */
import fs from "node:fs";
import { configPath, loadConfig } from "../config/load.js";
import { gitCommit } from "../git/safe-git.js";
import { Vault } from "../ost/vault.js";

export interface SetOutcomeResult {
  title: string;
  previous: string;
  next: string;
  sha: string;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Split a root-node body into [currentMandate, existingHistoryBlock]. */
function splitBody(body: string): { mandate: string; history: string } {
  const idx = body.indexOf("\n## History");
  if (idx === -1) return { mandate: body.trim(), history: "" };
  return { mandate: body.slice(0, idx).trim(), history: body.slice(idx).trim() };
}

export async function setOutcome(vaultDir: string, next: string): Promise<SetOutcomeResult> {
  const trimmed = next.trim();
  if (!trimmed) throw new Error("the new outcome text is empty");

  const vault = new Vault(vaultDir);
  const root = vault.readTree().find((n) => n.layer === "Outcome");
  if (!root) throw new Error("no Outcome node found — run `ost-agent init` first");

  const { mandate: previous, history } = splitBody(root.body);
  if (previous === trimmed) throw new Error("the new outcome is identical to the current one");

  // 1) update config
  const cfg = configPath(vaultDir);
  const raw = fs.readFileSync(cfg, "utf8");
  const updated = raw.replace(/^outcome:.*$/m, `outcome: ${JSON.stringify(trimmed)}`);
  if (updated === raw) throw new Error(`could not find an 'outcome:' line in ${cfg}`);
  fs.writeFileSync(cfg, updated, "utf8");

  // 2) revise the root node body: new mandate on top, prior mandate into History
  const historyEntry = `- ${isoToday()} superseded mandate:\n  > ${previous.replace(/\n/g, "\n  > ")}`;
  const historyBlock = history ? `${history}\n${historyEntry}` : `## History\n${historyEntry}`;
  root.body = `${trimmed}\n\n${historyBlock}`;
  vault.setOutcomeBody(root.title, root.body);

  // 3) commit (loadConfig validates the rewritten config before we commit)
  loadConfig(vaultDir);
  const { sha } = await gitCommit(vaultDir, `set-outcome: retune steering mandate`);
  return { title: root.title, previous, next: trimmed, sha };
}
