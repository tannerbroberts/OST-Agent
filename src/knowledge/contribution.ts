/**
 * Contribution estimates — a written claim that moving one thing moves another.
 *
 * The ladder between the Outcome and anything actionable is too tall to cross in
 * one step, so work gets picked because it is available rather than because
 * anyone can say what it does to the goal. A contribution estimate is the
 * cheapest fix on offer: prose in a field, not a schema that enforces
 * composition (a nested sub-outcome) and not a number computed for a display (a
 * route view). It only has to be checkable later, which means it has to name
 * three things in a form a program can pull apart rather than a form only a
 * human reading the sentence would notice is missing one: the LOCAL metric
 * moving, the DISTANT goal it is claimed to ladder to, and a DATED figure —
 * because an estimate with no date cannot be lined up against what a month of
 * real movement actually did.
 *
 * Loose prose fails on purpose. "This should really move retention a lot" names
 * no metric, no goal, and no date, so there is nothing in it a later pass could
 * compare against reality — it is confident-looking noise, which is the exact
 * failure mode the assumption test beneath this exists to catch.
 */

export interface ContributionEstimate {
  /** The estimate exactly as the node declared it. */
  raw: string;
  /** The metric this node's own work is expected to move. */
  localMetric: string;
  /** The distant goal the local metric is claimed to ladder to. */
  distantGoal: string;
  /** The claimed size of the effect — free text, but must carry a number. */
  figure: string;
  /** ISO date (YYYY-MM-DD) the estimate was made. */
  date: string;
}

export interface ContributionRejection {
  /** Why this string is not a checkable contribution estimate, addressed to whoever wrote it. */
  reason: string;
}

const CONTRIBUTION_FORM =
  "<local metric> → <distant goal>: <figure> (<YYYY-MM-DD>) — e.g. " +
  '"weekly builder retries → sessions shipped unattended: +2 per week (2026-08-17)"';

/** A figure has to carry a number, or it is a direction with nothing to compare against later. */
const HAS_DIGIT = /\d/;

const PATTERN =
  /^(?<metric>[^→:()]+?)\s*→\s*(?<goal>[^:()]+?):\s*(?<figure>[^()]+?)\s*\((?<date>\d{4}-\d{2}-\d{2})\)$/;

/**
 * Read a declared contribution estimate, or say why it is not one.
 *
 * Fails closed: absent, unstructured prose, a missing arrow, a missing colon, a
 * missing parenthesised date, or a figure with no number in it are all
 * rejections rather than a best-effort guess at what the author meant — a
 * field this loose would be exactly the "confident-looking noise" the
 * assumption test is checking for.
 */
export function parseContributionEstimate(raw: string | undefined): ContributionEstimate | ContributionRejection {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { reason: "no contribution estimate declared" };
  }
  const hit = PATTERN.exec(trimmed);
  if (!hit || !hit.groups) {
    return {
      reason: `"${trimmed}" is not a checkable contribution estimate. The form is ${CONTRIBUTION_FORM}. ` +
        "Loose prose with no named goal or no dated figure cannot later be checked against what actually moved.",
    };
  }
  const localMetric = hit.groups.metric.trim();
  const distantGoal = hit.groups.goal.trim();
  const figure = hit.groups.figure.trim();
  const date = hit.groups.date;
  if (!localMetric || !distantGoal || !figure) {
    return { reason: `"${trimmed}" is missing its local metric, distant goal, or figure. The form is ${CONTRIBUTION_FORM}.` };
  }
  if (!HAS_DIGIT.test(figure)) {
    return {
      reason: `"${trimmed}" states no number — "${figure}" is a direction, not a figure. A dated claim with no ` +
        "size cannot be ranked against what actually moved.",
    };
  }
  return { raw: trimmed, localMetric, distantGoal, figure, date };
}

/** True when `parseContributionEstimate` returned a usable estimate. */
export function isContributionEstimate(r: ContributionEstimate | ContributionRejection): r is ContributionEstimate {
  return (r as ContributionEstimate).raw !== undefined;
}
