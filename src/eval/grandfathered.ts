/**
 * Telling a tree that is **wrong** from a tree that is **old**.
 *
 * `checkInvariants` returns one flat list, and every entry in it reads the same:
 * a defect somebody should fix. That is right for a node written yesterday under
 * a rule that landed last month. It is wrong for a node written last month under
 * a rule that landed yesterday, and the difference is not cosmetic — those two
 * populations want different responses, and a gate that reports one number for
 * both destroys the information needed to choose. The evidence-class tightening
 * flagged all 57 then-existing meta-vault nodes; `single-backlink` flagged 920.
 *
 * This module reads {@link RULE_INCEPTIONS} and splits the list in two:
 *
 *   - **binding** — the rule was in force when the node was written, or the node
 *     cannot show otherwise. These are violations, exactly as before.
 *   - **predating** — the node was written strictly before the rule came into
 *     force, and the rule's grace period has not run out. Reported in their own
 *     class, with the date they start binding, and counted separately from the
 *     verdict.
 *
 * **Every ambiguity resolves toward the rule.** A rule with no inception entry
 * binds everything. A violation naming no node binds. A node whose title is not
 * in the tree binds. A node stamped the same day the rule landed binds, because
 * a date-only `created` cannot be ordered against a commit that landed at 17:12.
 * And a node carrying **no `created` at all binds** — an undated node is exactly
 * the node least able to show it predates anything, and exempting it would let a
 * missing field turn a red gate green. That last one is a correction to this
 * design's first draft, which read an absent date as evidence of age; it is the
 * one direction in which a forward-only rule can quietly stop checking.
 * {@link Predating.undated} does not exist for that reason — undated nodes come
 * back in `binding` and are counted by {@link countUndatedOffenders} so the
 * class is visible without being exempt.
 *
 * **Forward-only, with a bound.** Grandfathering with no expiry is how a
 * codebase ends up with three generations of conventions all live, which is this
 * design's own stated failure mode. So the exemption is a grace period, not an
 * amnesty: {@link CLEARANCE_WINDOW_DAYS} after a rule lands, the nodes that
 * predate it bind like anything else. That constant is the same window the
 * assumption test beneath this measures history against, so the design parameter
 * and the thing that judges it cannot drift apart.
 *
 * The second half of this module is that judging: {@link clearanceOf} takes a
 * {@link TighteningReplay} — what the vault's git history says happened after a
 * rule landed, captured by `scripts/capture-tightening-replay.ts` — and computes
 * the clearance rate the assumption test's threshold is stated over.
 */
import { shiftDays, ruleInception, CLEARANCE_WINDOW_DAYS } from "./rule-inception.js";
import type { Violation } from "./invariants.js";
import type { OstNode } from "../ost/node.js";

/** A violation the tree is not asked to fix yet, and the date that stops being true. */
export interface Predating {
  /** The violation, unchanged — the detail a reader needs is the same one. */
  readonly violation: Violation;
  /** The node's `created`. Always present: an undated node is never predating. */
  readonly created: string;
  /** The day the rule came into force. */
  readonly inForceFrom: string;
  /** The day the grace period ends and this becomes an ordinary violation. */
  readonly bindsOn: string;
}

/** What {@link partitionByInception} splits a check into. */
export interface InceptionPartition {
  /** Violations that count. The verdict and the exit code are computed from these. */
  readonly binding: Violation[];
  /** Violations held in grace, newest rule first in the order they were emitted. */
  readonly predating: Predating[];
}

/** Today, UTC, as YYYY-MM-DD — the default `asOf` for a caller that has no reason to pick one. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Split `violations` into the ones that bind and the ones whose nodes predate
 * the rule they broke.
 *
 * `asOf` is injected rather than read from the clock inside, because whether a
 * grace period has expired is a fact about a date and a test that depends on
 * today's is a test that changes its mind overnight.
 */
export function partitionByInception(
  violations: readonly Violation[],
  tree: readonly OstNode[],
  asOf: string = todayIso(),
): InceptionPartition {
  const created = new Map<string, string | undefined>();
  for (const n of tree) created.set(n.title, n.created);

  const binding: Violation[] = [];
  const predating: Predating[] = [];
  for (const violation of violations) {
    const rule = ruleInception(violation.rule);
    // No entry, no node, or a node this tree does not hold — every one of these
    // is a case where nothing can be shown about age, so the rule wins.
    if (!rule || !violation.node || !created.has(violation.node)) {
      binding.push(violation);
      continue;
    }
    const when = created.get(violation.node);
    if (when === undefined || when >= rule.inForceFrom) {
      binding.push(violation);
      continue;
    }
    const bindsOn = shiftDays(rule.inForceFrom, CLEARANCE_WINDOW_DAYS);
    if (asOf >= bindsOn) {
      binding.push(violation);
      continue;
    }
    predating.push({ violation, created: when, inForceFrom: rule.inForceFrom, bindsOn });
  }
  return { binding, predating };
}

/**
 * How many of `violations` are binding only because the node carries no
 * `created` — the population the exemption cannot reach and therefore the one
 * whose size a reader should be told rather than left to infer.
 */
export function countUndatedOffenders(violations: readonly Violation[], tree: readonly OstNode[]): number {
  const created = new Map<string, string | undefined>();
  for (const n of tree) created.set(n.title, n.created);
  let n = 0;
  for (const v of violations) {
    if (!v.node || !created.has(v.node)) continue;
    if (created.get(v.node) !== undefined) continue;
    if (ruleInception(v.rule)) n += 1;
  }
  return n;
}

/* ------------------------------------------------------------------ *
 * The replay: what history says a grandfathered backlog actually did.
 * ------------------------------------------------------------------ */

/** One node that was violating `rule` the day before the rule came into force. */
export interface ReplayedNode {
  readonly node: string;
  /** The node's `created` at that moment; `null` if it carried none. */
  readonly created: string | null;
  /** The first day it stopped violating, or `null` if it never did. */
  readonly clearedOn: string | null;
  /** How it stopped: still in the tree and compliant, or no longer in the tree at all. */
  readonly resolution: "compliant" | "absent" | null;
}

/** One tightening, and what happened to the backlog it would have grandfathered. */
export interface TighteningReplay {
  readonly rule: string;
  readonly inForceFrom: string;
  /** The commit on `main` that landed the rule — how a reader re-derives the date. */
  readonly commit: string;
  /** The vault snapshot the backlog was counted from: the last one before the rule bound. */
  readonly eve: { readonly date: string; readonly vaultCommit: string; readonly nodes: number };
  /** Offenders at that moment created ON or after `inForceFrom` — bound anyway, never grandfathered. */
  readonly boundAtInception: number;
  /** Every would-be-grandfathered node, and what became of it. */
  readonly nodes: readonly ReplayedNode[];
  /** Offender count per day, spanning the lead-in before the rule as well as after it. */
  readonly daily: readonly { readonly date: string; readonly vaultCommit: string; readonly nodes: number; readonly offenders: number }[];
}

/** The whole captured record, as `test/fixtures/tightening-replay.json` holds it. */
export interface ReplayRecord {
  readonly capturedAt: string;
  readonly vault: { readonly head: string; readonly firstCommit: string };
  readonly clearanceWindowDays: number;
  readonly tightenings: readonly TighteningReplay[];
}

/** What a replay says about one tightening. */
export interface Clearance {
  readonly rule: string;
  /** How many nodes the rule would have grandfathered. */
  readonly grandfathered: number;
  /** How many of those were compliant again within the window. */
  readonly clearedWithinWindow: number;
  /** Cleared, but by the node leaving the tree rather than complying. */
  readonly clearedByRemoval: number;
  /** Still violating when the window closed. */
  readonly outstanding: number;
  /** `clearedWithinWindow / grandfathered`, or `null` when the rule grandfathered nobody. */
  readonly rate: number | null;
  /** Longest gap, in days, between the rule landing and a node clearing. `null` if none cleared. */
  readonly slowestDaysToClear: number | null;
  /** Offenders on the first captured day, and on the eve of the rule — the no-pressure trajectory. */
  readonly growthBeforeInception: { readonly from: number; readonly to: number; readonly days: number };
}

/** Whole days from `from` to `to`, both ISO dates. Negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error(`not ISO dates: ${from}, ${to}`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Compute the clearance figures the assumption test's threshold is stated over.
 *
 * A node counts as cleared only if it stopped violating within `windowDays` of
 * the rule landing. Leaving the tree counts as clearing — the violation is gone
 * either way — but it is reported separately, because a backlog that "cleared"
 * by nodes disappearing is not the same finding as one that cleared by nodes
 * complying, and a reader deciding whether forward-only is mercy or debt needs
 * to be able to tell.
 */
export function clearanceOf(replay: TighteningReplay, windowDays: number = CLEARANCE_WINDOW_DAYS): Clearance {
  const deadline = shiftDays(replay.inForceFrom, windowDays);
  let clearedWithinWindow = 0;
  let clearedByRemoval = 0;
  let slowest: number | null = null;
  for (const node of replay.nodes) {
    if (node.clearedOn === null || node.clearedOn > deadline) continue;
    clearedWithinWindow += 1;
    if (node.resolution === "absent") clearedByRemoval += 1;
    const days = daysBetween(replay.inForceFrom, node.clearedOn);
    if (slowest === null || days > slowest) slowest = days;
  }
  const before = replay.daily.filter((d) => d.date < replay.inForceFrom);
  return {
    rule: replay.rule,
    grandfathered: replay.nodes.length,
    clearedWithinWindow,
    clearedByRemoval,
    outstanding: replay.nodes.length - clearedWithinWindow,
    rate: replay.nodes.length === 0 ? null : clearedWithinWindow / replay.nodes.length,
    slowestDaysToClear: slowest,
    growthBeforeInception: {
      from: before[0]?.offenders ?? 0,
      to: before.at(-1)?.offenders ?? 0,
      days: before.length === 0 ? 0 : daysBetween(before[0].date, before.at(-1)!.date),
    },
  };
}
