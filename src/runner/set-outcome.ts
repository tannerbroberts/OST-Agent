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
import { formatChartingCostHistoryLine, isChartingCostFigure, parseChartingCostFigure } from "../knowledge/charting-cost.js";

export interface SetOutcomeResult {
  title: string;
  previous: string;
  next: string;
  sha: string;
  chartingCost: string;
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

/**
 * @param chartingCost What mapping `next` is expected to take — how much
 *   evidence, how many conversations, how long before a first branch could be
 *   acted on. Required, not optional: an estimate written after the goal is
 *   already adopted cannot make the substitution a decision, so there is no
 *   path through this function that accepts a goal with no figure attached.
 */
export async function setOutcome(vaultDir: string, next: string, chartingCost: string): Promise<SetOutcomeResult> {
  const trimmed = next.trim();
  if (!trimmed) throw new Error("the new outcome text is empty");

  const parsedCost = parseChartingCostFigure(chartingCost);
  if (!isChartingCostFigure(parsedCost)) {
    throw new Error(`charting-cost estimate required before a goal can be adopted: ${parsedCost.reason}`);
  }

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

  // 2) revise the root node body: new mandate on top, prior mandate into
  // History, alongside the dated charting-cost figure for the mandate now
  // being adopted — the date is stamped here, by the system, at the moment of
  // adoption, never typed by the author, so it cannot be written after the
  // fact and passed off as having come before the choice.
  const today = isoToday();
  const historyEntry =
    `- ${today} superseded mandate:\n  > ${previous.replace(/\n/g, "\n  > ")}\n` +
    `  ${formatChartingCostHistoryLine(trimmed, parsedCost.figure, today)}`;
  const historyBlock = history ? `${history}\n${historyEntry}` : `## History\n${historyEntry}`;
  root.body = `${trimmed}\n\n${historyBlock}`;
  vault.setOutcomeBody(root.title, root.body);

  // 3) commit (loadConfig validates the rewritten config before we commit)
  loadConfig(vaultDir);
  const { sha } = await gitCommit(vaultDir, `set-outcome: retune steering mandate`);
  return { title: root.title, previous, next: trimmed, sha, chartingCost: parsedCost.figure };
}
