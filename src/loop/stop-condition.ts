/**
 * The stop condition — the loop's published answer to "is there anything worth
 * doing right now?", and the rule that makes idling the honest default.
 *
 * **The failure it is written against, observed rather than imagined.** Six
 * consecutive firings of the meta vault produced no structure at all while the
 * outstanding-work report named the same items every time. The loop had nothing
 * it could honestly do and nothing in the loop said so. That failure splits by
 * temperament rather than by capability: a governed agent idles and burns passes
 * rediscovering the same standstill, an ungoverned one fills the quota with
 * invented structure, and both are paid for identically. The honest move at pass
 * thirteen was to file a friction note and do nothing, which is exactly the move
 * no part of the system asked for.
 *
 * ## Outstanding is not actionable, and that is the whole distinction
 *
 * `ost_next_work` already reports plenty a firing may not touch — a test only a
 * human may run, an ask waiting on a person, darkness with no bottom. Counting
 * those as work is what creates the pressure to invent. So the condition is a
 * PARTITION over the sweep's work-bearing fields, and both halves are data:
 * {@link STOP_CONDITION} is what an unattended pass may act on, and
 * {@link OUTSTANDING_NOT_ACTIONABLE} is everything else, each entry carrying the
 * reason it is not this loop's to do. `test/loop/stop-condition.test.ts` fails the
 * build if a field of `NextWork` is in neither list or in both, so a field added
 * to the sweep is an unclassified field until somebody decides which it is —
 * `mcp/next-work.ts`'s own rule-parity shape, applied to the loop's stopping
 * question.
 *
 * Published as data rather than as prose because the consumer is a scheduler.
 * "The pass should stop when there is nothing to do" is a sentence; a list of
 * named terms with counts is something `ost-agent loop stop` can evaluate and
 * exit on, and something an operator can read to see WHY a loop went quiet
 * without reading this file.
 *
 * ## What the terms come out to, stated plainly rather than sold
 *
 * Today they are exactly the five lists `ost_next_work` already computes `done`
 * from, and the parity test pins that. The condition is therefore not a new
 * predicate over the tree — the sweep had already made the outstanding/actionable
 * cut, field by field, in prose. What did not exist was anything that could
 * EVALUATE it: `done` is a boolean inside a JSON response the agent reads and may
 * act on or not, with no exit code, no command, and no consequence for ignoring
 * it. This module is the evaluation and the consequence.
 *
 * ## Idling honestly: the half that is not advice
 *
 * A published condition an agent may read is still a rule enforced by the good
 * faith of the thing it governs, and the whole point of the ungoverned failure
 * mode above is that good faith is what is missing. So the condition is also
 * checked AFTER the fact, from outside the firing, against four observations the
 * pass cannot make about itself:
 *
 *   - whether the condition held when the run opened, computed by `loop start`
 *     from the vault;
 *   - how many evidence records were on disk then, and at seal — new input is the
 *     one legitimate way work can appear mid-pass, and it voids the reading;
 *   - what the pass actually committed, folded by {@link classifyPassShape} from
 *     commit subjects the loop's own dispatcher writes;
 *   - the run's HEAD at both ends, so the commits read are this firing's.
 *
 * {@link idleBreach} is the conjunction. A firing that held, gained no new
 * evidence and authored structure anyway seals `unhealthy` — see
 * `computeVerdict`. That is what makes idling the *honest* default rather than
 * the polite one: doing nothing is free, and manufacturing something to show for
 * the hour is a failed run.
 *
 * ## What this deliberately does not do
 *
 * **It does not gate `loop due`.** The tempting wiring — refuse to fire at all
 * when the condition holds — is wrong, and the reason is ordering: ingestion
 * happens INSIDE the pass, so a maintained tree with a full inbox evaluates as
 * "nothing actionable" right up until the ingest that is the whole reason to
 * fire. Gating `due` on this would be a loop that stops reading the world because
 * it had finished filing yesterday's.
 *
 * **It does not stop a human.** Only the unattended wrapper runs `loop start`;
 * an attended session reaches the vault without it, and nothing here can refuse
 * one. That matters most for `openUnknowns`, which is declared not-actionable
 * below: exploring darkness on an otherwise maintained tree is discretionary work
 * this loop will not fire itself to do, and is a session away for anyone who
 * wants it.
 *
 * **It does not say the terms are the right ones.** Whether "actionable by an
 * unattended pass right now" is decidable in a way two readers would agree on is
 * an open assumption, and the test beneath this solution is two people labelling
 * a sweep independently. A green suite says the rule exists, evaluates, and is
 * enforced. It does not say the rule agrees with people.
 */
import { loadConfig } from "../config/load.js";
import { computeNextWork, type NextWork } from "../mcp/next-work.js";
import { DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY } from "../config/schema.js";
import { readEvidenceScan } from "../processes/tree.js";
import { Vault } from "../ost/vault.js";
import { classifyPassShape, type PassShapeAssessment } from "./pass-shape.js";

/**
 * One thing an unattended pass may do about the tree, as data.
 *
 * `field` names the `NextWork` field it reads, which is what makes the partition
 * checkable: the test walks a real sweep's fields and demands each be claimed
 * here or declared not-actionable. `action` is the pass's move, quoted from the
 * sweep's own summary vocabulary so an operator reading a stop verdict and an
 * agent reading `ost_next_work` see the same words for the same work.
 */
export interface StopTerm {
  /** Stable id, used in reports and in the run record. */
  id: string;
  /** The `NextWork` field this term counts. */
  field: string;
  /** What an unattended pass does about an item of this kind. */
  action: string;
  /** How many items the sweep found. Truncation-aware — see {@link trueTotal}. */
  count(work: NextWork): number;
}

/**
 * One kind of outstanding item this condition deliberately ignores, with the
 * reason it is not an unattended pass's to do.
 *
 * The reasons are the load-bearing part. A stop condition is a claim that the
 * loop may go quiet while a report still names open items, and the only thing
 * separating that from an amnesty is being able to say, per field, why the item
 * is somebody else's — so every entry states it and the test holds each reason to
 * a length a shrug cannot reach.
 */
export interface NotActionable {
  field: string;
  why: string;
  count(work: NextWork): number;
}

/**
 * The true size of a list, not the size of the sample shown.
 *
 * `computeNextWork` caps every list for display and records what it hid in
 * `truncated`. For the stop condition itself the distinction cannot change a
 * verdict — a capped list is never empty, so "is it zero" reads the same either
 * way — but the counts this module prints and stamps into the run record are read
 * by a human deciding whether to raise a cadence, and "25 hygiene issues" beside a
 * real 1,700 is the kind of number that ends an investigation early.
 */
function trueTotal(work: NextWork, list: string, shown: number): number {
  return work.truncated.find((t) => t.list === list)?.total ?? shown;
}

/**
 * The published stop condition: the work an unattended pass may act on with the
 * tools `/ost-pass` actually grants it.
 *
 * The condition HOLDS — the loop should idle — when every term counts zero.
 *
 * These five are the sweep's own `done` terms, and `stop-condition.test.ts` pins
 * that they stay so. The two gates answering the same question with different
 * arithmetic is the R4 defect this repository has already paid for once, and
 * there is no third thing to break the tie.
 */
export const STOP_CONDITION: readonly StopTerm[] = [
  {
    id: "unmapped-evidence",
    field: "unmappedEvidence",
    action: "distil into #Opportunity nodes",
    count: (w) => trueTotal(w, "unmappedEvidence", w.unmappedEvidence.length),
  },
  {
    id: "underserved-opportunities",
    field: "underservedOpportunities",
    action: "ideate #Solution nodes, one blind ideator per assigned dimension",
    count: (w) => trueTotal(w, "underservedOpportunities", w.underservedOpportunities.length),
  },
  {
    id: "solutions-missing-assumptions",
    field: "solutionsMissingAssumptions",
    action: "surface the #Assumption and #AssumptionTest beneath it",
    count: (w) => trueTotal(w, "solutionsMissingAssumptions", w.solutionsMissingAssumptions.length),
  },
  {
    id: "solutions-missing-instruments",
    field: "solutionsMissingInstruments",
    action: "declare an `instrument:` — a command that fails today and passes when the solution is built",
    count: (w) => trueTotal(w, "solutionsMissingInstruments", w.solutionsMissingInstruments.length),
  },
  {
    id: "hygiene-issues",
    field: "hygieneIssues",
    action: "annotate on the node (never delete)",
    count: (w) => trueTotal(w, "hygieneIssues", w.hygieneIssues.length),
  },
];

/**
 * Everything else the sweep reports, and why none of it is a reason for an
 * unattended pass to keep firing.
 *
 * Three arguments recur, and they are worth naming once here rather than reading
 * out of eleven entries: the item waits on a PERSON (an ask, a result, a
 * permission); the item was already SETTLED by somebody and re-offering it is the
 * pass re-deciding what a human decided; or the item is UNBOUNDED, and a term
 * that can never reach zero is a stop condition that never fires.
 */
export const OUTSTANDING_NOT_ACTIONABLE: readonly NotActionable[] = [
  {
    field: "agedOutEvidence",
    why:
      "still unmapped and still on disk, but past `evidence.ageOutDays` AND redundant with a record some node " +
      "already cites. It left the individual list precisely so it would stop asking; counting it here would turn " +
      "an ageing rule into a standing reason to keep firing.",
    count: (w) => w.agedOutEvidence.count,
  },
  {
    field: "solutionsAwaitingObservation",
    why:
      "asks for an instrument to be RUN and its result recorded, and recording a result is off the unattended " +
      "surface entirely (`ost-agent result`, a human's). This is the B1/B2 rule `next-work.ts` already applies to " +
      "the same queue: work no granted tool can reach is not work this loop may fire itself to do.",
    count: (w) => trueTotal(w, "solutionsAwaitingObservation", w.solutionsAwaitingObservation.length),
  },
  {
    field: "assumptionWork.runnable",
    why:
      "compute-only tests an ATTENDED session may go run right now. `/ost-pass` holds the hard rule that the " +
      "unattended pass never runs a test — an agent that runs and records its own test is the one failure this " +
      "product cannot survive — so this bucket is information to a firing, not an instruction to it.",
    count: (w) => trueTotal(w, "assumptionWork.runnable", w.assumptionWork.runnable.length),
  },
  {
    field: "assumptionWork.awaitingOneCommand",
    why: "waiting on a person to read a paragraph and run one pre-filled `ost-agent result` line.",
    count: (w) => trueTotal(w, "assumptionWork.awaitingOneCommand", w.assumptionWork.awaitingOneCommand.length),
  },
  {
    field: "assumptionWork.blockedOnPermission",
    why: "the work is finished and what is missing is a credential or a consent, which is a person's to give.",
    count: (w) => trueTotal(w, "assumptionWork.blockedOnPermission", w.assumptionWork.blockedOnPermission.length),
  },
  {
    field: "assumptionWork.needsHumans",
    why: "real people outside the building are in the loop, plus every unlabelled test, which lands here by the lanes' fail-closed rule.",
    count: (w) => trueTotal(w, "assumptionWork.needsHumans", w.assumptionWork.needsHumans.length),
  },
  {
    field: "assumptionWork.blockedOnPrerequisite",
    why:
      "a test whose declared prerequisite has no result yet. Running it produces a number nobody can interpret, " +
      "and the prerequisite that would make it interpretable is itself a human's reading.",
    count: (w) => trueTotal(w, "assumptionWork.blockedOnPrerequisite", w.assumptionWork.blockedOnPrerequisite.length),
  },
  {
    field: "outstandingAsks",
    why:
      "the standing queue of asks a person has not answered. It ages so a human can see how long they have been " +
      "waited on; a pass that treated the age as its own work would be answering for them.",
    count: (w) => trueTotal(w, "outstandingAsks", w.outstandingAsks.length),
  },
  {
    field: "openUnknowns",
    why:
      "unbounded by construction — darkness is discretionary and budget-governed, which is why `next-work.ts` keeps " +
      "it out of `done` too. A term that can never reach zero is a stop condition that never fires, and this loop " +
      "would then be paying to explore forever on the strength of its own curiosity. A human wanting an exploring " +
      "pass runs an attended session, which never passes through this gate.",
    count: (w) => trueTotal(w, "openUnknowns", w.openUnknowns.length),
  },
  {
    field: "quarantined",
    why:
      "a node-shaped file on disk whose `type:` no reader here recognises. It is the one entry in this list that " +
      "is a real defect rather than somebody else's queue, and it is still not this loop's to do: repairing it " +
      "means editing a frontmatter field, and no tool `/ost-pass` grants can write one — a term counting it would " +
      "idle the loop forever on work it is structurally unable to perform. Not counted is not unsaid, which is the " +
      "whole point of quarantining rather than dropping it: `ost_next_work` leads its summary with it, `ost_check` " +
      "names it, and `ost_read_tree` lists it apart from the tree. A person fixes the file.",
    count: (w) => trueTotal(w, "quarantined", w.quarantined.length),
  },
  {
    field: "emptyDescents",
    why:
      "a heading the under-served check found short whose leaves are all already served. There is no action here a " +
      "pass could take: a solution cannot hang on a category, so 'ideate three' is not a legal instruction for one, " +
      "and the only thing that would close it — deciding the heading's own need is broader than the sum of its " +
      "leaves and filing a new sub-opportunity — is a judgement about the world rather than a gap in the tree. " +
      "Reported on every response so the branch is never silent; counted here would idle the loop on a reading.",
    count: (w) => trueTotal(w, "emptyDescents", w.emptyDescents.length),
  },
  {
    field: "lopsidedCategories",
    why:
      "the reason a heading is on the under-served list, not a second thing to do about it. Every entry here is " +
      "already counted once under `underservedOpportunities`, and the work it points at — the empty leaves beneath " +
      "the heading — is counted there too, so a term reading this list would count the same gap twice and hold the " +
      "loop open on arithmetic rather than on anything outstanding. Reported on every response because a heading " +
      "kept for its distribution and one kept for being empty want opposite work and read identically without it.",
    count: (w) => trueTotal(w, "lopsidedCategories", w.lopsidedCategories.length),
  },
  {
    field: "retiredFromDuplicateScan",
    why:
      "not work at all: nodes withheld from the duplicate scan because they are retired, reported so a denominator " +
      "does not shrink in silence.",
    count: (w) => trueTotal(w, "retiredFromDuplicateScan", w.retiredFromDuplicateScan.length),
  },
  {
    field: "withheldByDisposition",
    why:
      "work somebody settled by asserting rather than by doing. It is disclosed on every response precisely so the " +
      "dismissal is visible; acting on it anyway would be the pass re-deciding what a human decided.",
    count: (w) => trueTotal(w, "withheldByDisposition", w.withheldByDisposition.length),
  },
  {
    field: "suppressedByCondition",
    why:
      "work a pass already declined, standing exactly as long as the machine-checkable fact it names still holds. " +
      "The item returns to its bucket by itself the moment the fact flips, so nothing is lost by not counting it.",
    count: (w) => trueTotal(w, "suppressedByCondition", w.suppressedByCondition.length),
  },
];

/** One term's reading, kept so a reader sees the arithmetic and not only the verdict. */
export interface StopTermReading {
  id: string;
  field: string;
  action: string;
  count: number;
}

/** One ignored field's reading — outstanding, and deliberately not counted. */
export interface IgnoredReading {
  field: string;
  why: string;
  count: number;
}

export interface StopVerdict {
  /** True when every term is zero: there is nothing an unattended pass may do. */
  holds: boolean;
  /** Every term, in order, whether or not it counted anything. */
  terms: StopTermReading[];
  /** Every declared-not-actionable field that DID count something. */
  ignored: IgnoredReading[];
  /** One line, in the operator's terms, for whichever surface prints it. */
  reason: string;
}

/**
 * Evaluate the published condition against one sweep.
 *
 * Pure and total: it takes a `NextWork` and reads nothing else, so the same
 * response always produces the same verdict and a caller with a recorded sweep
 * can re-run the judgement without the vault.
 */
export function evaluateStopCondition(work: NextWork): StopVerdict {
  const terms: StopTermReading[] = STOP_CONDITION.map((t) => ({
    id: t.id,
    field: t.field,
    action: t.action,
    count: t.count(work),
  }));
  const ignored: IgnoredReading[] = OUTSTANDING_NOT_ACTIONABLE.map((n) => ({
    field: n.field,
    why: n.why,
    count: n.count(work),
  })).filter((n) => n.count > 0);
  const outstanding = terms.filter((t) => t.count > 0);
  const holds = outstanding.length === 0;

  // The ignored total rides on BOTH branches, and on the holding one it is the
  // whole point: "nothing actionable" beside a report naming forty open items
  // reads as a lie unless the sentence itself says the forty are accounted for.
  const ignoredTotal = ignored.reduce((n, i) => n + i.count, 0);
  const ignoredNote =
    ignoredTotal > 0
      ? ` ${ignoredTotal} outstanding item(s) are NOT counted, by declaration: ` +
        ignored.map((i) => `${i.field} (${i.count})`).join(", ") +
        " — each waits on a person, was already settled, or is unbounded. See OUTSTANDING_NOT_ACTIONABLE."
      : "";

  const reason = holds
    ? "nothing an unattended pass may act on: every term of the published stop condition is zero." + ignoredNote
    : `work remains: ${outstanding.map((t) => `${t.count} ${t.field}`).join(", ")}.` + ignoredNote;

  return { holds, terms, ignored, reason };
}

/**
 * Sweep the vault and evaluate the condition against it, exactly as
 * `ost_next_work` would.
 *
 * Every input the MCP surface gives `computeNextWork` is given here too — the
 * ideation minimum, the operator's `discovery.target`, the age-out and staleness
 * bounds — because a stop condition computed over a different sweep from the one
 * the pass reads would be two answers to one question, and the pass would be
 * right to ignore whichever it liked. The one deliberate difference is
 * `listLimit`: this asks for the whole list, since a display cap that hid part of
 * a queue would understate a count somebody raises a cadence on.
 *
 * Throws nothing. An unreadable tree or a config that will not load comes back as
 * `heldAtStart: null` with the reason attached — see the field's own note for why
 * that is not `false`.
 */
export function observeStopCondition(vaultDir: string): StopConditionRecord {
  let evidenceAtStart = 0;
  try {
    evidenceAtStart = readEvidenceScan(vaultDir).offered;
  } catch {
    // Left at 0 and reported through the sweep's own failure below, if there is
    // one. An unreadable evidence directory on its own is not a reason to refuse
    // to evaluate: the count exists to detect GROWTH, and 0 → 0 simply means
    // nothing was seen to arrive.
  }
  try {
    const config = loadConfig(vaultDir);
    const work = computeNextWork(
      new Vault(vaultDir),
      vaultDir,
      config.processes?.["P3_ideate"]?.minSolutionsPerOpportunity ?? DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY,
      undefined,
      config.discovery?.target ?? undefined,
      config.evidence?.ageOutDays,
      Number.POSITIVE_INFINITY,
      config.evidence?.staleAfterDays,
    );
    const verdict = evaluateStopCondition(work);
    return {
      heldAtStart: verdict.holds,
      terms: verdict.terms,
      // Field and count only. The `why` behind each is stable data in
      // OUTSTANDING_NOT_ACTIONABLE, and copying a paragraph of it into every
      // firing's ledger line would be a record that grows with the prose rather
      // than with the tree.
      ignored: verdict.ignored.map((i) => ({ field: i.field, count: i.count })),
      evidenceAtStart,
    };
  } catch (e) {
    return {
      heldAtStart: null,
      unevaluated: e instanceof Error ? e.message : String(e),
      evidenceAtStart,
    };
  }
}

/** The evidence records on disk right now — the seal-time half of the growth check. */
export function countEvidence(vaultDir: string): number {
  try {
    return readEvidenceScan(vaultDir).offered;
  } catch {
    return 0;
  }
}

/**
 * What the loop observed about this firing's stopping question — stamped by
 * `loop start` from the vault, closed by `loop seal` from the vault, and never
 * supplied by the pass.
 *
 * Absent on a run started before this field existed, which is why every consumer
 * treats absence as "no enforcement" rather than as a clean reading.
 */
export interface StopConditionRecord {
  /**
   * Did the published condition hold when this run opened?
   *
   * `null` means it could not be evaluated — an unreadable tree, a config that
   * would not load. Not `false`: a firing whose sweep failed has not been told
   * there is work, and treating "could not tell" as "there was work" would license
   * exactly the invented structure this exists to refuse, on the one firing least
   * able to justify it.
   */
  heldAtStart: boolean | null;
  /** Every term's reading at start, so the verdict can be re-argued from the record. */
  terms?: StopTermReading[];
  /**
   * Every declared-not-actionable field that counted something at start.
   *
   * Carried for the reason the sweep carries its own dispositions: a firing
   * recorded as having had nothing to do, beside a tree with forty open items, is
   * an amnesty unless the record itself says the forty were accounted for and by
   * which declaration. The reason per field lives in
   * {@link OUTSTANDING_NOT_ACTIONABLE}, not here.
   */
  ignored?: { field: string; count: number }[];
  /** Why it could not be evaluated, when `heldAtStart` is null. */
  unevaluated?: string;
  /**
   * Evidence records offered under `.ost-agent/evidence/` when the run opened.
   *
   * The counterpart at seal is what makes the start reading honest to hold the
   * pass to: new input is the one legitimate way work can appear mid-firing (the
   * pass ingests, the tree gains items the start sweep could not have seen), and
   * a firing that gained input is judged on nothing here.
   */
  evidenceAtStart: number;
  /** Filled by `loop seal`. Absent on a run that never sealed. */
  closed?: StopConditionClose;
}

/** The seal-time half of {@link StopConditionRecord}. */
export interface StopConditionClose {
  /** Evidence records offered when the run sealed. */
  evidenceAtSeal: number;
  /**
   * What this firing's own commits were made of, folded by
   * {@link classifyPassShape} over the subjects between `headBefore` and
   * `headAfter`. Absent when the range could not be read — no `headBefore`, git
   * unavailable — and absence disables enforcement rather than assuming either
   * answer.
   */
  shape?: PassShapeAssessment;
}

/** A firing that authored structure it had been told there was no call for. */
export interface IdleBreach {
  /** Commits this firing made that the classifier read as structural. */
  authored: number;
  /** One line naming the breach, for the seal report. */
  reason: string;
}

/**
 * Did this firing write while the stop condition held?
 *
 * Four conjuncts, every one of them observed by the loop rather than reported by
 * the pass, and every one of them necessary:
 *
 *   - **the condition held at start** — the firing was told, before it spent
 *     anything, that there was nothing for it to do;
 *   - **the shape could be read** — there is a commit range and a classifier
 *     verdict over it; without one, nothing is claimed;
 *   - **no new evidence arrived** — the evidence directory did not grow. This is
 *     the conjunct that keeps an honest pass out of trouble: ingestion happens
 *     inside the firing, so a pass that captured five inbox notes and mapped them
 *     is doing exactly its job against a sweep that could not have known. A
 *     firing that gained input is judged on nothing here;
 *   - **it authored structure anyway** — at least one commit created a node, an
 *     edge or a declared field. Commentary is not a breach: a pass that idles and
 *     files a friction note about why is the behaviour this whole line of work
 *     wants, and `ost_ingest_inbox` is classed as commentary for the same reason.
 *
 * Returns null — no breach — whenever any conjunct fails, including when the
 * record is absent. Fail-open is right here and it is a deliberate asymmetry: the
 * cost of a missed breach is one wasted pass, and the cost of a false one is a
 * red run for a firing that did its job, which is how a gate gets turned off.
 */
export function idleBreach(record: StopConditionRecord | undefined): IdleBreach | null {
  if (!record || record.heldAtStart !== true) return null;
  const closed = record.closed;
  if (!closed?.shape) return null;
  if (closed.evidenceAtSeal > record.evidenceAtStart) return null;
  if (closed.shape.structure === 0) return null;
  return {
    authored: closed.shape.structure,
    reason:
      `the stop condition held when this run opened — every term zero, nothing an unattended pass may act on — ` +
      `and no new evidence arrived during it (${record.evidenceAtStart} record(s) at both ends), yet ` +
      `${closed.shape.structure} of this firing's ${closed.shape.structure + closed.shape.commentary} commit(s) ` +
      "created structure. Work the sweep did not ask for is work the sweep cannot check. Idling is the honest " +
      "outcome of a pass with nothing to do, and it is free: file a friction note about the standstill and seal.",
  };
}

/**
 * The lines a seal prints about the stopping question.
 *
 * Printed on EVERY sealed firing that recorded a reading, including the ordinary
 * one where the condition did not hold. A line that appeared only when something
 * was wrong could not be trusted to be silent because nothing was — the same
 * argument the sense census and the goal contract make for speaking
 * unconditionally.
 */
export function stopConditionReport(record: StopConditionRecord | undefined): string[] {
  if (!record) return [];
  if (record.heldAtStart === null) {
    return [`stop condition: not evaluated — ${record.unevaluated ?? "no reason recorded"}. Nothing was enforced.`];
  }
  const breach = idleBreach(record);
  if (breach) return [`✗ stop condition breached: ${breach.reason}`];
  if (record.heldAtStart) {
    const grew = (record.closed?.evidenceAtSeal ?? record.evidenceAtStart) - record.evidenceAtStart;
    return [
      grew > 0
        ? `stop condition: held when this run opened, and ${grew} new evidence record(s) arrived during it — this firing had input the sweep could not have seen, so nothing was held against it.`
        : "stop condition: held when this run opened, and this firing authored no structure. Idling was the honest outcome.",
    ];
  }
  const outstanding = (record.terms ?? []).filter((t) => t.count > 0);
  return [
    `stop condition: did not hold when this run opened — ${outstanding.map((t) => `${t.count} ${t.field}`).join(", ") || "work remained"}.`,
  ];
}

/**
 * Fold a firing's commit subjects into the shape half of the record.
 *
 * A thin wrapper, and it exists so the loop has exactly one way to reach the
 * classifier: `classifyPassShape` is calibrated against a labelled corpus at
 * 91.1% agreement, and a second call site that folded differently — a majority
 * vote, a different structure list — would be a second definition of "the tree
 * moved" sitting beside the one the corpus measured.
 */
export function observePassShape(subjects: readonly string[] | undefined): PassShapeAssessment | undefined {
  return subjects === undefined ? undefined : classifyPassShape(subjects);
}
