/**
 * The goal contract — the outcome text a firing actually ran against, written
 * into that firing's own record.
 *
 * **The gap this closes, which is easy to miss because it looks closed.** The
 * current outcome is readable from the vault at any moment: it is
 * `ost.config.yaml`'s `outcome:` key, it is the root node's body, and
 * `ost-agent rollup` prints it. What is nowhere recoverable is what a *given
 * pass* ran against. Those differ in precisely the window the contract exists
 * for — an outcome retuned between two firings leaves both firings' records
 * looking identical, so the drift a reader would want to audit is invisible in
 * the one artefact that would have to show it. A run record that carries the
 * text makes two firings that ran against different mandates distinguishable
 * from the ledger alone, with the vault's current state never consulted.
 *
 * **Why the mid-run reading is not padding.** A naive version reads the outcome
 * once and stamps it — at start, or at seal — and either way the record asserts
 * something that was not true for the whole run. So this reads at both ends and
 * records both, always: `held` is a comparison that was actually made, not the
 * absence of one, and a firing whose mandate moved under it reports
 * {@link GoalDrift} `changed` with both texts rather than either end dressed up
 * as the one that stood throughout. Which of them the work was really steered by
 * is not recoverable, and saying so is the honest report.
 *
 * **What this decides: nothing.** It is a reporter in the
 * `test/release/gate-f-deciders.ts` sense — the observation is stamped into the
 * run record and printed beside the verdict, and no gate, no exit code and no
 * `computeVerdict` branch reads it. That is deliberate rather than incidental.
 * Retuning the outcome is a human's operation (`ost-agent set-outcome`, never an
 * agent tool), and the solution this implements says the escape hatch has to be
 * easy for a human; a firing that refused to seal because someone edited the
 * mandate while it ran would be that hatch closing. What the contract owes the
 * operator is that the edit is *visible afterwards*, not that it is prevented.
 *
 * **The source, and the half it does not cover.** The text is read from the
 * config's `outcome:` key, which is what `buildPassContext` renders into the
 * mandate a pass is steered by (`src/eval/render.ts`). `set-outcome` writes that
 * key and the root node's body together, so for the supported path they agree.
 * A hand-edit of one and not the other would leave them apart, and this records
 * only the one the pass actually read — see the note on the assumption test.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { CONFIG_FILENAME, configPath, loadConfig } from "../config/load.js";

/** The outcome text a run read, and enough to compare it without diffing prose. */
export interface GoalReading {
  /** The mandate, verbatim. Deliberately not normalised: the exact text is the contract. */
  readonly text: string;
  /** sha256 of `text`, truncated — what a reader greps for when the mandate is a paragraph. */
  readonly digest: string;
  /** Where it was read from, as a vault-relative name rather than a machine path. */
  readonly source: string;
  readonly at: string;
}

/**
 * No outcome could be read at this end of the run. Distinct from absent, for the
 * same reason `ToolSurfaceUnknown` is: a run whose mandate could not be
 * determined is not the same fact as a run nobody asked to record one, and
 * collapsing the two makes an unreadable vault look like an unstamped firing.
 */
export interface GoalUnreadable {
  readonly unknown: string;
  readonly at: string;
}

export type GoalObservation = GoalReading | GoalUnreadable;

export function isGoalUnreadable(o: GoalObservation): o is GoalUnreadable {
  return "unknown" in o;
}

/**
 * What happened to the mandate between the two readings.
 *
 * A word rather than a boolean, because the third case is real and a boolean
 * would have to lie about it: an outcome readable at one end and not the other
 * cannot be compared, and reporting that as "held" would be this module
 * committing the error it exists to name.
 */
export type GoalDrift = "held" | "changed" | "unknown";

/** One run's contract: what it opened against, what it sealed against, and whether they agree. */
export interface GoalContract {
  readonly opened: GoalObservation;
  /** The second reading, taken at seal. Absent on a run that never sealed. */
  readonly sealed?: GoalObservation;
  /** Stamped at seal, alongside `sealed`. Absent while the run is open. */
  readonly drift?: GoalDrift;
}

/** Short enough to read in a log line, long enough that a collision is not a practical worry. */
const DIGEST_CHARS = 16;

export function goalDigest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, DIGEST_CHARS);
}

/**
 * Read the mandate this vault states right now.
 *
 * `existsSync` before the load so an un-inited directory reports "there is no
 * config" rather than whatever `loadConfig`'s throw happens to say — the two are
 * different problems for the operator, and only one of them is a broken file.
 */
export function observeGoal(vaultDir: string, now: number = Date.now()): GoalObservation {
  const at = new Date(now).toISOString();
  if (!fs.existsSync(configPath(vaultDir))) {
    return { unknown: `${CONFIG_FILENAME} is absent — this directory states no outcome to run against`, at };
  }
  try {
    const text = loadConfig(vaultDir).outcome;
    return { text, digest: goalDigest(text), source: CONFIG_FILENAME, at };
  } catch (e) {
    return { unknown: `${CONFIG_FILENAME} could not be read (${e instanceof Error ? e.message : String(e)})`, at };
  }
}

/** The contract a run opens with — one reading, no comparison to make yet. */
export function openGoalContract(opened: GoalObservation): GoalContract {
  return { opened };
}

/**
 * Close a run's contract with the reading taken at seal.
 *
 * Both ends are kept whatever the comparison says. A record that dropped the
 * second reading when it matched would leave "compared, and it held" looking
 * exactly like "never re-read", which is the distinction the third clause of
 * this contract's threshold is entirely about.
 */
export function closeGoalContract(opened: GoalObservation, sealed: GoalObservation): GoalContract {
  return { opened, sealed, drift: driftBetween(opened, sealed) };
}

export function driftBetween(opened: GoalObservation, sealed: GoalObservation): GoalDrift {
  if (isGoalUnreadable(opened) || isGoalUnreadable(sealed)) return "unknown";
  return opened.digest === sealed.digest ? "held" : "changed";
}

/** A drift a reader must not scroll past — the caller routes these to stderr. */
export function goalDriftIsLoud(contract: GoalContract | undefined): boolean {
  return contract !== undefined && contract.drift !== undefined && contract.drift !== "held";
}

/** How much of a mandate a log line shows before the digest has to carry the rest. */
const SHOWN_CHARS = 120;

function shown(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= SHOWN_CHARS ? oneLine : `${oneLine.slice(0, SHOWN_CHARS - 1)}…`;
}

function describe(o: GoalObservation): string {
  return isGoalUnreadable(o) ? `no readable outcome (${o.unknown})` : `"${shown(o.text)}" (${o.digest})`;
}

/**
 * The report printed beside a run's result — a fact, not a verdict.
 *
 * Printed on every firing that stamped a contract, including the quiet one, for
 * the same reason `senseCensusReport` prints every sense: a drift report that
 * appeared only when something had moved could never be trusted to be silent
 * because the mandate held, rather than because nothing ever read it.
 */
export function goalContractReport(contract: GoalContract | undefined): string[] {
  if (contract === undefined) return [];
  if (contract.sealed === undefined) {
    return [`goal: this run opened against ${describe(contract.opened)} — it has not sealed, so nothing re-read it.`];
  }
  switch (contract.drift) {
    case "held":
      return [
        `goal: this run ran against ${describe(contract.opened)} from open to seal — ` +
          `${isGoalUnreadable(contract.opened) ? CONFIG_FILENAME : contract.opened.source}.`,
      ];
    case "changed":
      return [
        `⚠ goal changed mid-run: opened against ${describe(contract.opened)}, sealed against ${describe(contract.sealed)}.`,
        "  Neither text held for the whole firing, so the record carries both rather than stamping either as the one",
        "  that stood. Which of them this run's work was actually steered by is not recoverable from it.",
        "  Retuning the outcome is a human's call (`ost-agent set-outcome`) and this does not refuse it — what it",
        "  reports is that it happened while a pass was in flight.",
      ];
    default:
      return [
        `⚠ goal: opened against ${describe(contract.opened)}, sealed against ${describe(contract.sealed)} — the two`,
        "  cannot be compared, so whether this run's mandate held cannot be said either way.",
      ];
  }
}
