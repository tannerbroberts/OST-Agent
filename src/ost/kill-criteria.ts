/**
 * Pre-committed kill criteria: the observation that would end a candidate,
 * written at its birth, and the sweep that reads them back.
 *
 * **The failure this exists to close.** Nothing in this product removes
 * anything. Candidates enter `unvalidated` and stay there, so a tree grows and
 * the decision it was built to serve gets harder rather than easier — 432
 * solutions in the meta vault, none of them dead. The reason is not that nobody
 * would kill one; it is that killing one is an argument had *after* effort has
 * accrued, against a person who is by then attached to it. A criterion written
 * before anyone is attached turns that argument into bookkeeping.
 *
 * **The split this module is careful about.** A kill criterion has two halves
 * and only one of them is a machine's business:
 *
 *   - {@link OstNode.killBy} — a date. Evaluable. This module compares it
 *     against a day the caller supplies and says whose has passed.
 *   - {@link OstNode.killIf} — a condition, in prose. NOT evaluable, not here
 *     and not anywhere: "no operator ran it twice in a fortnight" is an
 *     observation a person takes. This module carries it to the reader and
 *     stops.
 *
 * So {@link killCriteriaCensus} lists candidates whose date has passed and
 * which nothing has retired — it does not claim their condition was met. The
 * sentence it prints says so, because the difference between "this is overdue
 * for a reading" and "this is dead" is the whole distance between the half that
 * can be built and the half that needs a human willing to act on a list.
 *
 * **What green here does not buy.** The assumption under the test that
 * commissioned this — "a written criterion is actually honoured" — is settled
 * by candidates *getting killed*, which takes two weeks of calendar and a
 * person. Fields being required and a list being printed is the precondition
 * for measuring that, not the measurement.
 */
import { isRetiredNode, isRetractedNode, type TreeCensus } from "./census.js";
import type { OstNode } from "./node.js";
import { classifySubject, type Blindness, type SweepSubject } from "./sweep.js";

/** The pair, read off a node that carries both halves. */
export interface KillCriteria {
  /** The observation that would end the candidate. */
  readonly condition: string;
  /** ISO date (YYYY-MM-DD) by which the condition is to be checked. */
  readonly by: string;
}

/** What the `killIf` field turned out to be, once read. */
export type KillConditionReading = { readonly stated: true; readonly condition: string } | { readonly stated: false; readonly reason: string };

/** What the `killBy` field turned out to be, once read. */
export type KillDateReading = { readonly dated: true; readonly by: string } | { readonly dated: false; readonly reason: string };

/**
 * Words that open a decision rather than an observation.
 *
 * Same list, and the same argument, as `DEFERRING_VERBS` in
 * `src/eval/coverage.ts`: "decide whether it is working" is a plan to have the
 * argument later, which is the argument this field exists to have already had.
 * Kept as its own literal rather than imported because the two fields are
 * allowed to diverge — a threshold is optional and this one is not.
 */
const DEFERRING_OPENERS = new Set([
  "fix",
  "decide",
  "choose",
  "set",
  "pick",
  "agree",
  "determine",
  "establish",
  "define",
  "settle",
  "select",
  "nominate",
  "specify",
  "review",
  "revisit",
  "reassess",
  "reconsider",
  "evaluate",
]);

/** Values that fill the slot and say nothing. */
const PLACEHOLDERS = new Set(["tbd", "tba", "n/a", "na", "none", "unknown", "?", "-", "todo", "x"]);

/** A calendar date, strictly — YAML will happily hand back `2026-13-45` otherwise. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * How far out a kill date may sit, in days.
 *
 * A cap is not decoration. A criterion dated five years out is not a
 * pre-commitment — it is the same evasion an unbounded threshold is, spelled in
 * a field that looks filled: the candidate never reaches a sweep, so nothing
 * ever asks about it. A year is deliberately generous (the test that
 * commissioned this revisits at two weeks) and its only job is to close the
 * 2099 hole.
 */
export const MAX_KILL_HORIZON_DAYS = 365;

const MS_PER_DAY = 86_400_000;

/** Parse a strict ISO calendar date to UTC ms, or null when it is not one. */
function isoToMs(value: string): number | null {
  const m = ISO_DATE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  const back = new Date(ms).toISOString().slice(0, 10);
  // Round-trip check: `Date.UTC` rolls 2026-02-31 into March rather than
  // refusing it, and a date that silently moved is worse than one refused.
  return back === value.trim() ? ms : null;
}

/** Whole days from `from` to `to`, both strict ISO dates. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number | null {
  const a = isoToMs(from);
  const b = isoToMs(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * Read the `killIf` FIELD and say why not when it names no observation.
 *
 * Deliberately shallow, and the shallowness is stated rather than hidden. There
 * is no reading that can tell "no operator has run it twice in a fortnight"
 * from "it turns out not to be useful" — both are grammatical English about the
 * world, and only one of them is checkable. What this refuses is the set of
 * fillings that are *not even claims*: an empty slot, a placeholder, one word,
 * a pasted paragraph, and a sentence that opens by promising to decide later.
 * Everything past that is a person's reading at the date, which is the honest
 * limit of a required field.
 */
export function parseKillCondition(value: string): KillConditionReading {
  const trimmed = value.trim();
  if (!trimmed) return { stated: false, reason: "it is empty" };
  if (/\n/.test(trimmed)) {
    return {
      stated: false,
      reason: "it is wrapped over more than one line, which is what a pasted paragraph looks like and what a condition does not",
    };
  }
  if (PLACEHOLDERS.has(trimmed.toLowerCase().replace(/[.!]+$/, ""))) {
    return { stated: false, reason: `"${trimmed}" is a placeholder, not an observation` };
  }
  const words = trimmed.split(/\s+/).filter((w) => /\p{L}|\d/u.test(w));
  if (words.length < 2) {
    return { stated: false, reason: `"${trimmed}" is one word — a condition names something someone could go and look at` };
  }
  const opener = words[0].replace(/^[^\p{L}]+/u, "").toLowerCase();
  if (DEFERRING_OPENERS.has(opener)) {
    return {
      stated: false,
      reason: `it opens with "${words[0]}", which schedules the decision instead of stating the observation that would settle it`,
    };
  }
  return { stated: true, condition: trimmed };
}

/**
 * Read the `killBy` FIELD against the day the node is being born.
 *
 * Two refusals, each closing one way to fill the field without committing to
 * anything: a date already gone (the criterion is met at birth and nothing will
 * ever come of it) and a date past the horizon (the criterion is real and no
 * sweep will reach it inside the life of the candidate).
 */
export function parseKillDate(value: string, bornOn: string): KillDateReading {
  const trimmed = value.trim();
  if (!ISO_DATE.test(trimmed) || isoToMs(trimmed) === null) {
    return { dated: false, reason: `"${trimmed}" is not a calendar date — write it as YYYY-MM-DD (e.g. 2026-09-15)` };
  }
  const days = daysBetween(bornOn, trimmed);
  if (days === null) {
    return { dated: false, reason: `it cannot be compared against "${bornOn}", which is not a calendar date either` };
  }
  if (days <= 0) {
    return { dated: false, reason: `${trimmed} is not after ${bornOn} — a criterion whose date has already passed commits to nothing` };
  }
  if (days > MAX_KILL_HORIZON_DAYS) {
    return {
      dated: false,
      reason:
        `${trimmed} is ${days} days out, past the ${MAX_KILL_HORIZON_DAYS}-day horizon — a date nothing will reach ` +
        `inside the life of this candidate is a filled field and not a commitment`,
    };
  }
  return { dated: true, by: trimmed };
}

/** Both halves, or null when the node carries neither/one — the `unlabelled` case. */
export function readKillCriteria(node: Pick<OstNode, "killIf" | "killBy">): KillCriteria | null {
  const condition = node.killIf?.trim();
  const by = node.killBy?.trim();
  return condition && by ? { condition, by } : null;
}

/** A candidate whose date has passed and which nothing has retired. */
export interface OverdueCandidate {
  readonly title: string;
  readonly condition: string;
  readonly by: string;
  /** Whole days since `by`. Always ≥ 1 — the day itself is not yet overdue. */
  readonly daysOverdue: number;
  readonly status?: string;
}

/** A node whose kill fields are present and cannot be read. */
export interface MalformedCriteria {
  readonly title: string;
  readonly reason: string;
}

export interface KillCriteriaCensus {
  /** The day this reading was taken against, so the list is reproducible. */
  readonly today: string;
  /**
   * Files that are nodes or would have been, against the ones the walk read.
   *
   * `offered` is deliberately not every `.md` at the vault root: a README was
   * never a subject, and counting one would make every real vault report itself
   * partly blind forever. A file whose frontmatter would not parse IS a subject
   * — it might be the Solution whose criterion is due — so it is the shortfall.
   */
  readonly subject: SweepSubject;
  readonly blindness: Blindness;
  /** Solutions the sweep read, retired ones included. */
  readonly candidates: number;
  /** Of those, the ones nothing has retired — the set the sweep actually walks. */
  readonly live: number;
  /** Live solutions carrying both halves, readably — the ones this sweep can judge. */
  readonly carrying: number;
  /**
   * Live solutions carrying neither half or only one.
   *
   * Named rather than counted as compliant. Every solution written before the
   * field existed lands here, and a census that folded them into "nothing is
   * overdue" would report the exact silence this module was built to end.
   */
  readonly unlabelled: readonly string[];
  /** Kill fields present and unreadable — an unmet criterion nobody can check. */
  readonly malformed: readonly MalformedCriteria[];
  /** Solutions already retired by status or retraction — out of the sweep, by name. */
  readonly retired: readonly string[];
  /** The list. Ordered most overdue first. */
  readonly overdue: readonly OverdueCandidate[];
}

/**
 * Sweep a tree for candidates whose kill date has passed.
 *
 * `today` is a parameter and never read off the clock, for the reason
 * CONTRIBUTING states about determinism and for one more: the list an operator
 * acts on has to be reproducible from the day it was taken, or two runs
 * disagreeing is indistinguishable from the tree having changed.
 *
 * Retirement is the same predicate the rest of the product uses — `deferred`
 * status, a `## Retraction`, or a file under `archive/`. The last two never
 * reach a census read off a real vault (`Vault.readTreeCensus` withholds them
 * at the door), and the retraction check is repeated here anyway so a caller
 * that hands in a synthesized census gets the same answer as one that read a
 * disk. A retired candidate is one that HAS been killed, so it leaves the list;
 * it is named in `retired` rather than dropped, because "0 overdue" over a tree
 * where everything was deferred is a different fact from "0 overdue" over a
 * tree where everything is live.
 */
export function killCriteriaCensus(census: TreeCensus, today: string): KillCriteriaCensus {
  const subject: SweepSubject = { offered: census.nodes.length + census.unreadable.length, read: census.nodes.length };
  const solutions = census.nodes.filter((n) => n.layer === "Solution");

  const unlabelled: string[] = [];
  const malformed: MalformedCriteria[] = [];
  const retiredTitles: string[] = [];
  const overdue: OverdueCandidate[] = [];
  let carrying = 0;

  for (const node of solutions) {
    if (isRetiredNode(node) || isRetractedNode(node)) {
      retiredTitles.push(node.title);
      continue;
    }
    const criteria = readKillCriteria(node);
    if (!criteria) {
      unlabelled.push(node.title);
      continue;
    }
    const condition = parseKillCondition(criteria.condition);
    if (!condition.stated) {
      malformed.push({ title: node.title, reason: `killIf: ${condition.reason}` });
      continue;
    }
    const elapsed = daysBetween(criteria.by, today);
    if (elapsed === null) {
      malformed.push({
        title: node.title,
        reason: `killBy: "${criteria.by}" is not a calendar date, so no sweep can ever say this one is due`,
      });
      continue;
    }
    carrying++;
    if (elapsed > 0) {
      overdue.push({ title: node.title, condition: condition.condition, by: criteria.by, daysOverdue: elapsed, status: node.status });
    }
  }

  overdue.sort((a, b) => b.daysOverdue - a.daysOverdue || a.title.localeCompare(b.title));
  return {
    today,
    subject,
    blindness: classifySubject(subject),
    candidates: solutions.length,
    live: solutions.length - retiredTitles.length,
    carrying,
    unlabelled,
    malformed,
    retired: retiredTitles,
    overdue,
  };
}

/**
 * The census as an operator reads it — the list first, then what it was taken
 * over, then the part no machine took.
 *
 * A blind run is printed as a failure rather than as an empty list, on the same
 * rule `formatStrandedCensus` follows: "no candidate is overdue" over a tree
 * nobody read is the sentence this repository has shipped as clean before.
 */
export function formatKillCriteriaCensus(c: KillCriteriaCensus): string {
  const lines: string[] = [];
  if (c.blindness === "totally-blind") {
    lines.push(
      `Kill criteria: BLIND — read 0 of ${c.subject.offered} node file(s). Nothing was examined, so this is ` +
        `not a clean sweep; check that the vault path is a vault.`,
    );
    return lines.join("\n");
  }

  lines.push(
    `Kill criteria (as of ${c.today}): ${c.overdue.length} candidate(s) overdue for a reading, over ` +
      `${c.carrying} of ${c.live} live Solution(s) carrying readable criteria (${c.candidates} read in all).`,
  );
  if (c.blindness === "partly-blind") {
    const shortfall = c.subject.offered - c.subject.read;
    lines.push(
      `  ⚠ partly blind: ${shortfall} node file(s) present could not be read, so every count above is over ` +
        `${c.subject.read} of ${c.subject.offered}.`,
    );
  }

  lines.push("");
  lines.push(`Date passed, still live (${c.overdue.length}):`);
  if (!c.overdue.length) lines.push("  (none)");
  for (const o of c.overdue) {
    lines.push(`  ${o.title} — due ${o.by} (${o.daysOverdue} day(s) ago)`);
    lines.push(`    kill if: ${o.condition}`);
  }

  if (c.malformed.length) {
    lines.push("");
    lines.push(`Criteria nothing can evaluate (${c.malformed.length}):`);
    for (const m of c.malformed) lines.push(`  ${m.title} — ${m.reason}`);
  }

  lines.push("");
  lines.push(
    `${c.unlabelled.length} live Solution(s) carry no criteria at all — written before the field existed, ` +
      `and no sweep will ever call one of them due. ${c.retired.length} already retired.`,
  );
  lines.push("");
  lines.push(
    "The date is the machine's half. Whether each condition above is actually MET is a reading a person " +
      "takes, and killing the candidate is `ost-agent dispose` or `ost_set_status(…, \"deferred\")` — this " +
      "list is the bookkeeping, not the verdict.",
  );
  return lines.join("\n");
}
