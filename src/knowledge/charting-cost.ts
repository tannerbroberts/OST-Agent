/**
 * Charting-cost estimates — what mapping a goal is expected to take, recorded
 * before the goal is adopted rather than reconstructed after the fact.
 *
 * `set-outcome` is the one place a goal is substituted for another, and until
 * now that substitution left no trace: the cheap goal, once adopted, is
 * indistinguishable from a goal that was actually costed and chosen. This
 * module is the checkable half of closing that gap — a dated figure, stamped
 * by the system at the moment of adoption (never typed by the author, so it
 * cannot be backdated), attached to the goal it estimates.
 *
 * Deliberately loose on the figure itself: `contribution.ts`'s three-part
 * `metric → goal: figure (date)` schema fits a claim about a metric moving
 * another metric. A charting-cost estimate is a single free-text guess at
 * effort ("12 evidence, 4 conversations, 10 days to a first actionable
 * branch") and the only thing worth enforcing is that it names a size at all
 * — a figure with no number is a direction, not something a later day could
 * be checked against.
 */

export interface ChartingCostFigure {
  figure: string;
}

export interface ChartingCostRejection {
  /** Why this string is not a checkable charting-cost figure, addressed to whoever wrote it. */
  reason: string;
}

/** A figure has to carry a number, or it is a direction with nothing to compare against later. */
const HAS_DIGIT = /\d/;

/**
 * Read a declared charting-cost figure, or say why it is not one.
 *
 * Fails closed: absent, blank, or a figure with no number in it are all
 * rejections rather than a best-effort guess at what the author meant.
 */
export function parseChartingCostFigure(raw: string | undefined): ChartingCostFigure | ChartingCostRejection {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { reason: "no charting-cost estimate supplied — a goal cannot be adopted without pricing the chart first" };
  }
  if (!HAS_DIGIT.test(trimmed)) {
    return {
      reason: `"${trimmed}" states no number, so it is a direction rather than a figure — nothing for a later day to check it against.`,
    };
  }
  return { figure: trimmed };
}

/** True when `parseChartingCostFigure` returned a usable figure. */
export function isChartingCostFigure(r: ChartingCostFigure | ChartingCostRejection): r is ChartingCostFigure {
  return (r as ChartingCostFigure).figure !== undefined;
}

export interface ChartingCostRecord {
  /** The goal (the new mandate's exact text) this figure was estimating. */
  goal: string;
  figure: string;
  /** ISO date the estimate was recorded — stamped when the goal was adopted, not typed by the author. */
  date: string;
}

const HISTORY_LINE = /^charting-cost estimate for "(?<goal>.+)":\s*(?<figure>.+?)\s*\((?<date>\d{4}-\d{2}-\d{2})\)$/;

/** One root-node history line recording a figure beside the goal it priced. */
export function formatChartingCostHistoryLine(goal: string, figure: string, date: string): string {
  return `charting-cost estimate for "${goal}": ${figure} (${date})`;
}

/**
 * Every charting-cost figure recorded in a root node's body, oldest first —
 * the same order `set-outcome` appends them in, so the newest entry (the one
 * with no later entry naming a different goal) is the currently adopted goal.
 */
export function parseChartingCostHistory(body: string): ChartingCostRecord[] {
  const out: ChartingCostRecord[] = [];
  for (const line of body.split("\n")) {
    const hit = HISTORY_LINE.exec(line.trim());
    if (!hit || !hit.groups) continue;
    out.push({ goal: hit.groups.goal, figure: hit.groups.figure, date: hit.groups.date });
  }
  return out;
}
