/**
 * Recording an assumption test's result — the human's half of the gate.
 *
 * The agent may never run a test or record a result: that rule is what keeps
 * synthetic evidence out of the tree. But the gate it enforces is only passable
 * once a result exists, so a tree with no way to record one is a tree that can
 * never clear its own debt. This is that path, and it is deliberately CLI-only —
 * it is not on the agent's tool allowlist and not on the MCP surface, so the
 * agent cannot reach it even by accident.
 *
 * Every result carries attribution. An unattributed result is indistinguishable
 * from a fabricated one, so `by` is required and blank is refused.
 */
import fs from "node:fs";
import path from "node:path";
import { Vault } from "./vault.js";
import { RESULTS_HEADING, UNCOVERED_HEADING, VERDICTS, type Verdict } from "./headings.js";
import { isRung, type RungId } from "../knowledge/believability.js";

// The vocabulary is DEFINED in `headings.ts`, beside the heading it is written under,
// because the reader that scores an actor from a recorded verdict cannot import this
// module without a cycle (this one pulls in `Vault`, which pulls in the census, which
// reads the ledger). Re-exported so this file stays the place a reader looks for it.
export { VERDICTS, type Verdict };

export interface ResultFiling {
  /** Title of the AssumptionTest node the result belongs to. */
  test: string;
  verdict: Verdict;
  /** What happened, in the runner's words. */
  note: string;
  /** Who ran it — a person, a team, never the agent. */
  by: string;
  /**
   * What this run does NOT cover — the part of the threshold it left untested.
   * Required, because a result with no stated limit gets read as answering the
   * whole question, and the gap only ever surfaces if somebody happens to notice.
   */
  uncovered: string;
  /** Optionally raise the test's rung to what the run actually produced. */
  evidence?: RungId;
  /** ISO date; defaults to today. */
  on?: string;
}

/** Append a result to an assumption test. Returns the line that was written. */
export function recordResult(vaultDir: string, filing: ResultFiling): string {
  if (!VERDICTS.includes(filing.verdict)) {
    throw new Error(`"${filing.verdict}" is not a verdict — use one of: ${VERDICTS.join(", ")}`);
  }
  const by = (filing.by ?? "").trim();
  if (!by) {
    throw new Error(
      "a result needs attribution — say who ran it. An unattributed result cannot be told apart from a fabricated one.",
    );
  }
  const note = (filing.note ?? "").trim();
  if (!note) throw new Error("a result needs a note — what happened when the test was run");
  const uncovered = (filing.uncovered ?? "").trim();
  if (!uncovered) {
    throw new Error(
      "a result needs a statement of what it does NOT cover — the part of the threshold this run left untested. " +
        "A result with no stated limit gets read as answering the whole question.",
    );
  }

  const dir = path.resolve(vaultDir);
  const vault = new Vault(dir);
  const node = vault.read(filing.test);
  if (node.layer !== "AssumptionTest") {
    throw new Error(`"${filing.test}" is a ${node.layer} — results are recorded on an AssumptionTest`);
  }

  const on = filing.on ?? new Date().toISOString().slice(0, 10);
  const line = `- ${on} **${filing.verdict}** (ran by ${by}) — ${note}`;
  // grows the file under a single Results section, so earlier runs survive verbatim.
  // The heading travels as `appendUnderSection`'s own argument, which is the position
  // the content guard does not scan — that asymmetry IS this path's exclusivity, so
  // do not inline the heading into `line` (ost/headings.ts).
  vault.appendUnderSection(filing.test, RESULTS_HEADING, line);
  // One statement per result, in the same order, so a second run cannot ride on
  // the first run's limits — see computeCoverageDebt, which counts the pair.
  vault.appendUnderSection(filing.test, UNCOVERED_HEADING, `- ${on} (${filing.verdict}) — ${uncovered}`);

  if (filing.evidence) {
    if (!isRung(filing.evidence)) throw new Error(`"${filing.evidence}" is not on the believability ladder`);
    vault.setEvidence(filing.test, filing.evidence, `result recorded by ${by}`);
  }
  return line;
}

export interface PromotionFiling {
  /** Title of the node being promoted. */
  node: string;
  /** Who promoted it — a person, never the agent. */
  by: string;
  /** The evidence that earned it. */
  why: string;
}

/**
 * Promote a node to `validated` — the human half of B2.
 *
 * `validated` is the one status that clears an evidence gate on the strength of
 * the claim alone (`hasRecordedResult` returns true for it), so it is not on the
 * agent's tool surface at all. That refusal needs a way out or it is a wedge, and
 * this is it: CLI-only, beside `recordResult`, under the same attribution rules,
 * for the same reason — an unattributed promotion cannot be told apart from a
 * fabricated one.
 *
 * Deliberately NOT gated on a recorded result. `hasRecordedResult` is the
 * predicate this path exists to protect; making the human's only route depend on
 * it would be circular, and Opportunities have no results beneath them at all.
 * The human is the authority here; the mechanism only records who they were.
 */
export function promoteNode(vaultDir: string, filing: PromotionFiling): string {
  const by = (filing.by ?? "").trim();
  if (!by) {
    throw new Error(
      "a promotion needs attribution — say who promoted it. An unattributed promotion cannot be told apart from a fabricated one.",
    );
  }
  const why = (filing.why ?? "").trim();
  if (!why) {
    throw new Error("a promotion needs a reason — what evidence earned it. 'validated' with no stated basis is a byline.");
  }
  const vault = new Vault(path.resolve(vaultDir));
  return vault.promoteToValidated(filing.node, by, why);
}

/** True when the vault directory looks like a vault (used for friendlier CLI errors). */
export function isVault(dir: string): boolean {
  return fs.existsSync(path.join(path.resolve(dir), "ost.config.yaml"));
}
