/**
 * The suppression ledger — how a pass records "I will not act on this, and here is
 * the fact under which that changes", so the next pass stops paying to reach the
 * same answer.
 *
 * Passes keep meeting items they correctly decline. A test that genuinely needs a
 * person outside the building is declined by every unattended sweep forever; a
 * shipped solution is declined by every sweep that reads its body. Today the
 * decline leaves nothing behind, so each pass pays the full reading cost to reach
 * the answer the last one reached. A suppression is that decline, written down —
 * not a deferral of the node (the node stays live, on disk, in the tree) but a
 * suppression of the *demand*, with an expiry that is a fact rather than a date.
 *
 * **The condition is the entire safety argument, and it is a closed vocabulary.**
 * A suppression is an agent quietly removing work from its own queue, and the
 * difference between "correctly declined" and "gave up" is exactly the judgement
 * this system does not let agents make unsupervised. So the reviving condition
 * must be evaluable by machine, against the tree alone, with no judgement in the
 * evaluation — "this solution's status is no longer shipped", "this test has
 * acquired a lane label". A condition stated in prose is a promise nobody can
 * check, and an item suppressed on one is removed from the queue permanently by an
 * agent's own say-so — that is the delete this tool surface deliberately
 * withholds, wearing a different name. {@link parseSuppressionCondition} therefore
 * refuses prose outright, at the write funnel, rather than storing it and hoping a
 * reader notices.
 *
 * **Revival is self-clearing.** Nothing marks a suppression expired: every read
 * re-evaluates the condition against the current tree, and the moment it stops
 * holding the item is back on its bucket — the same shape as `pendingAskQueue`,
 * where an entry leaves when the fact it waits on changes, not when somebody
 * remembers to remove it. The ledger is append-only history; the condition's
 * truth is derived, never stored.
 *
 * **How this differs from the disposition ledger** (`dispositions.ts`, its
 * sibling): a disposition settles work by *assertion* and stands until a human
 * reverses it, which is why its write lives off the agent's surface. A
 * suppression settles nothing — it postpones the offer until a named fact flips,
 * and the fact does the reversing. The residual risk a green test here cannot
 * retire, verbatim from the assumption test: whether agents choose honest
 * conditions when unobserved — a condition that will never flip is the abuse, and
 * it needs a human reading suppressions over time. That is why the write path
 * ships on the CLI (a human's `ost-agent suppress`), not on any agent tool.
 *
 * Same sidecar shape as `asks.ts` and `dispositions.ts`: append-only JSONL,
 * attributed, dated off an injected clock, read as a history, fail-open on
 * damage — a line that will not parse suppresses nothing, so a corrupted ledger
 * surfaces MORE work, never less.
 */
import fs from "node:fs";
import path from "node:path";
import type { OstNode } from "../ost/node.js";
import { isNodeStatus, NODE_STATUSES, type NodeStatus } from "../ost/node.js";
import { isLane, type LaneId } from "./lanes.js";
import { LANES } from "./lanes.js";
import { contractGaps } from "./unknowns.js";

/**
 * The condition vocabulary — every fact a suppression may hold on. Closed, so a
 * pass cannot invent an unevaluable escape hatch; each entry names the real
 * decline it was written for, because the vocabulary exists to express declines
 * the vault has actually produced, not declines someone can imagine.
 */
export const SUPPRESSION_CONDITION_KINDS = [
  /** A solution declined because it is shipped — holds while the node's status is the named one. */
  "status-is",
  /** A test declined because its lane needs people — holds while the lane label is the named one. */
  "lane-is",
  /** An item declined because the surface lacked the tool to classify it — holds while the test has no lane label at all. */
  "lane-unlabelled",
  /** An unknown declined for want of a contract section — holds while the named `## <section>` is undeclared. */
  "section-missing",
] as const;

export type SuppressionConditionKind = (typeof SUPPRESSION_CONDITION_KINDS)[number];

/**
 * One machine-checkable condition. `holdsWhile` names the reason the item was
 * declined as a fact about one node; the suppression stands exactly as long as
 * the fact does, and the item is offered again the moment it stops holding.
 */
export type SuppressionCondition =
  | { holdsWhile: "status-is"; node: string; status: NodeStatus }
  | { holdsWhile: "lane-is"; node: string; lane: LaneId }
  | { holdsWhile: "lane-unlabelled"; node: string }
  | { holdsWhile: "section-missing"; node: string; section: string };

/**
 * The sentence a refused prose condition gets back. Written once because it is
 * the module's whole thesis: an unevaluable suppression is a delete.
 */
export const PROSE_REFUSAL =
  "a suppression condition stated in prose is a promise nobody can check, and an item suppressed on one " +
  "is removed from the queue permanently by the writer's own say-so — that is a delete wearing a different " +
  `name, and this ledger refuses it. State the condition in the closed vocabulary instead: ` +
  SUPPRESSION_CONDITION_KINDS.join(", ") + ".";

/**
 * Validate one condition at the write funnel. Refuses rather than coerces: a
 * prose string, an unknown kind, a status or lane outside its vocabulary — each
 * is an unevaluable escape hatch, and storing one would hide an item behind a
 * check that can never run.
 */
export function parseSuppressionCondition(raw: unknown): SuppressionCondition {
  if (typeof raw === "string") throw new Error(PROSE_REFUSAL);
  if (!raw || typeof raw !== "object") {
    throw new Error(`a suppression condition is a typed object, one of: ${SUPPRESSION_CONDITION_KINDS.join(", ")}`);
  }
  const rec = raw as Record<string, unknown>;
  const kind = rec.holdsWhile;
  if (typeof kind !== "string" || !(SUPPRESSION_CONDITION_KINDS as readonly string[]).includes(kind)) {
    // A free-text `holdsWhile` is prose with a field name — same refusal, same reason.
    throw new Error(PROSE_REFUSAL);
  }
  if (typeof rec.node !== "string" || !rec.node.trim()) {
    throw new Error("a suppression condition names the node whose fact it holds on");
  }
  const node = rec.node;
  switch (kind as SuppressionConditionKind) {
    case "status-is":
      if (!isNodeStatus(rec.status)) {
        throw new Error(`status-is holds on a status from the vocabulary: ${NODE_STATUSES.join(", ")}`);
      }
      return { holdsWhile: "status-is", node, status: rec.status };
    case "lane-is":
      if (typeof rec.lane !== "string" || !isLane(rec.lane)) {
        throw new Error(`lane-is holds on a lane from the vocabulary: ${LANES.map((l) => l.id).join(", ")}`);
      }
      return { holdsWhile: "lane-is", node, lane: rec.lane };
    case "lane-unlabelled":
      return { holdsWhile: "lane-unlabelled", node };
    case "section-missing":
      if (typeof rec.section !== "string" || !rec.section.trim()) {
        throw new Error("section-missing holds on a named `## <section>` heading — say which section");
      }
      return { holdsWhile: "section-missing", node, section: rec.section.trim() };
  }
}

/**
 * Does the condition still hold, against the tree alone?
 *
 * `true` means the reason for the decline is still a fact and the item stays
 * suppressed; `false` means it flipped and the item is offered again. Pure over
 * the node index — no clock, no filesystem, no judgement: every branch is a
 * string comparison or a heading probe, which is the whole feasibility claim
 * the assumption test pins.
 *
 * A condition whose node has left the tree evaluates `false` — fail open. A
 * fact nobody can check anymore must not be the thing keeping work off a list;
 * the safe direction here, as everywhere in this repo, is more work surfaced,
 * never less.
 */
export function conditionHolds(condition: SuppressionCondition, index: ReadonlyMap<string, OstNode>): boolean {
  const node = index.get(condition.node);
  if (!node) return false;
  switch (condition.holdsWhile) {
    case "status-is":
      return node.status === condition.status;
    case "lane-is":
      return node.lane === condition.lane;
    case "lane-unlabelled":
      return node.lane === undefined;
    case "section-missing":
      return contractGaps(node, [condition.section]).length > 0;
  }
}

/** The condition in the vocabulary's own words — what a disclosure line prints. */
export function renderCondition(condition: SuppressionCondition): string {
  switch (condition.holdsWhile) {
    case "status-is":
      return `while "${condition.node}" has status '${condition.status}'`;
    case "lane-is":
      return `while "${condition.node}" is in lane '${condition.lane}'`;
    case "lane-unlabelled":
      return `while "${condition.node}" has no lane label`;
    case "section-missing":
      return `while "${condition.node}" declares no \`## ${condition.section}\` section`;
  }
}

/** One suppression. Attributed and reasoned like a disposition — the reason is for the auditor; only the condition decides anything. */
export interface SuppressionRecord {
  /** When it was written, from the injected clock — never `Date.now()` directly. */
  ts: string;
  /** What it suppresses, written exactly as the bucket that lists it sees it: an evidence id, or a node title. */
  subject: string;
  /** The machine-checkable fact the suppression stands on. */
  condition: SuppressionCondition;
  /** Why it was declined, in the writer's words. For the auditor; the read never consults it. */
  reason: string;
  /** Who declined it. Required — the abuse this cannot catch (a condition that will never flip) is caught by a human reading these, and the human needs a name. */
  by: string;
}

export function suppressionLedgerPath(dir: string): string {
  return path.join(dir, ".ost-agent", "suppressions", "suppressions.jsonl");
}

/**
 * Append one suppression. The condition goes through {@link parseSuppressionCondition}
 * here, at the funnel, so no caller can store prose — a rule enforced at one of two
 * callers is not a rule.
 */
export function appendSuppression(
  dir: string,
  rec: { subject: string; condition: unknown; reason: string; by: string },
  now: () => Date = () => new Date(),
): SuppressionRecord {
  if (!rec.subject.trim()) throw new Error("a suppression needs the subject it declines");
  const condition = parseSuppressionCondition(rec.condition);
  if (!rec.by.trim()) throw new Error("a suppression needs attribution — say who declined it");
  if (!rec.reason.trim()) throw new Error("a suppression needs the decline's reason in words — the condition says when it ends, not why it started");
  const record: SuppressionRecord = { ts: now().toISOString(), subject: rec.subject, condition, reason: rec.reason, by: rec.by };
  const file = suppressionLedgerPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + "\n");
  return record;
}

/**
 * The ledger as read: histories keyed by subject, plus the count of lines that
 * would not parse. A damaged line suppresses nothing — the fail-open direction,
 * same as the disposition and ask ledgers, and for the same reason: an
 * unreadable record must never be the one that removes work.
 */
export interface SuppressionLedger {
  histories: ReadonlyMap<string, readonly SuppressionRecord[]>;
  damaged: number;
}

function parseSuppressionLine(raw: string): SuppressionRecord | null {
  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!rec || typeof rec !== "object") return null;
  if (typeof rec.ts !== "string" || !rec.ts) return null;
  if (typeof rec.subject !== "string" || !rec.subject.trim()) return null;
  // The condition fails CLOSED: a hand-edited or truncated condition is not
  // evaluable, and an unevaluable condition must never keep an item off a list.
  let condition: SuppressionCondition;
  try {
    condition = parseSuppressionCondition(rec.condition);
  } catch {
    return null;
  }
  return {
    ts: rec.ts,
    subject: rec.subject,
    condition,
    reason: String(rec.reason ?? ""),
    by: String(rec.by ?? ""),
  };
}

export function readSuppressionLedger(dir: string): SuppressionLedger {
  const file = suppressionLedgerPath(dir);
  const histories = new Map<string, SuppressionRecord[]>();
  let damaged = 0;
  if (!fs.existsSync(file)) return { histories, damaged };
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const rec = parseSuppressionLine(line);
    if (!rec) {
      damaged += 1;
      continue;
    }
    const list = histories.get(rec.subject) ?? [];
    list.push(rec);
    histories.set(rec.subject, list);
  }
  return { histories, damaged };
}

/**
 * The standing suppression for one subject — the last entry written about it, or
 * `null` when the ledger never named it. Latest wins, like the disposition
 * ledger: what an auditor needs is every entry; what a bucket needs is only the
 * most recent condition.
 */
export function latestSuppression(ledger: SuppressionLedger, subject: string): SuppressionRecord | null {
  const list = ledger.histories.get(subject);
  if (!list || list.length === 0) return null;
  return list[list.length - 1];
}

/**
 * Is this subject suppressed right now — a live entry whose condition still
 * holds against this tree? The one question every bucket asks, re-evaluated on
 * every read, which is what makes revival automatic: the answer changes the
 * moment the tree does, with no write anywhere.
 */
export function isSuppressed(ledger: SuppressionLedger, subject: string, index: ReadonlyMap<string, OstNode>): boolean {
  const standing = latestSuppression(ledger, subject);
  return standing !== null && conditionHolds(standing.condition, index);
}

/** One item a live suppression kept off a list, carried on the response that withheld it. */
export interface SuppressedItem {
  /** The `NextWork` field it would otherwise have appeared on. */
  list: string;
  subject: string;
  /** The condition in words — what has to flip for the item to come back. */
  until: string;
  reason: string;
  by: string;
  /** When the suppression was written. */
  at: string;
}

/**
 * Drop every item whose live suppression condition still holds, recording what
 * was dropped. The shared call the buckets make — one function, one predicate,
 * one accumulator of what it hid, so there is no version of "consulted the
 * ledger" that quietly skips the disclosure. An entry whose condition has
 * flipped is simply inert: the item is kept, which IS the revival.
 */
export function omitSuppressed<T>(
  items: readonly T[],
  subjectOf: (item: T) => string,
  ledger: SuppressionLedger,
  index: ReadonlyMap<string, OstNode>,
  list: string,
  into: SuppressedItem[],
): T[] {
  if (ledger.histories.size === 0) return [...items];
  const kept: T[] = [];
  for (const item of items) {
    const subject = subjectOf(item);
    const standing = latestSuppression(ledger, subject);
    if (standing && conditionHolds(standing.condition, index)) {
      into.push({
        list,
        subject,
        until: `revives when no longer ${renderCondition(standing.condition)}`,
        reason: standing.reason,
        by: standing.by,
        at: standing.ts,
      });
      continue;
    }
    kept.push(item);
  }
  return kept;
}

/**
 * Every suppression on the ledger with whether its condition holds right now —
 * the audit surface, because the abuse this mechanism cannot police itself (a
 * condition chosen because it will never flip) is only caught by a person
 * reading these over time.
 */
export function formatSuppressions(ledger: SuppressionLedger, index: ReadonlyMap<string, OstNode>): string {
  const standing = [...ledger.histories.keys()]
    .map((subject) => latestSuppression(ledger, subject))
    .filter((r): r is SuppressionRecord => r !== null)
    .sort((a, b) => a.ts.localeCompare(b.ts));
  const lines: string[] = [];
  if (standing.length === 0) {
    lines.push("No suppressions — every bucket is offering everything it derives.");
  } else {
    const holding = standing.filter((r) => conditionHolds(r.condition, index));
    lines.push(
      `${standing.length} suppression(s) on the ledger, ${holding.length} currently holding — a holding one is work no bucket is offering:\n`,
    );
    for (const r of standing) {
      const holds = conditionHolds(r.condition, index);
      lines.push(`  ${r.ts.slice(0, 10)}  ${r.subject}  [${holds ? "HOLDING" : "expired — offered again"}]`);
      lines.push(`      ${renderCondition(r.condition)} — ${r.reason} — ${r.by}`);
    }
    lines.push("");
    lines.push(
      "A suppression expires by itself the moment its condition stops holding; nothing here needs clearing. " +
        "What to read for: a condition that can never flip is a delete wearing a suppression's name.",
    );
  }
  if (ledger.damaged) {
    lines.push(
      `\n${ledger.damaged} ledger line(s) would not parse and were dropped. A dropped line suppresses nothing, ` +
        "so the effect is more work offered, never less — but the entries themselves are lost to the audit.",
    );
  }
  return lines.join("\n");
}
