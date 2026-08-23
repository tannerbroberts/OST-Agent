/**
 * The log-only friction census: how much of what the agent actually struggled
 * with is recoverable from the machine trace alone?
 *
 * The solution under test is "Mine tool errors and retries from run logs" — derive
 * friction from records that already exist (failed calls, retries, validation
 * rejections) instead of from prose, and so pay for the channel with no new
 * instrumentation. Its feasibility assumption is stated plainly in the node: *the
 * logs already contain enough signal*. That is a claim about the world and it is
 * measurable, because this vault already has a second, independent account of the
 * same friction — the transcript channel, which reads every tool call in a session
 * and labels the failures, the retries and the refusals it finds.
 *
 * So the question has a number: take a thirty-day window of both, derive friction
 * classes from the trace alone, and see what share of the classes the transcript
 * channel found come back. That share is {@link LogOnlyFrictionRecall.recall}.
 *
 * ## Classes, not events — and why the finer unit is not available
 *
 * The obvious comparison is per event: this failed `Edit`, is it in the trace? It
 * cannot be run. The two records share no join key. A transcript is keyed by the
 * Claude session uuid; a trace event's `session` is minted by the MCP server per
 * *server instance* (`mcp-<uuid>`), and one session can open several while several
 * sessions can share one. Nothing in either record maps one to the other, so an
 * event in one cannot be found in the other even when both plainly describe the
 * same call.
 *
 * The unit here is therefore the **friction class** — a (kind, tool) pair, counted
 * over the window — which is also the unit the assumption test asks about
 * ("distinct recurring failure patterns"). A class recurs when it appears at least
 * {@link LOG_ONLY_FRICTION_RULE.recurrenceFloor} times.
 *
 * ## Three buckets, because "missed" and "could never see" are different findings
 *
 * A known class the trace does not name divides in two, and folding them together
 * would be the whole error this census exists to avoid:
 *
 * - **out of reach** — the tool is not one this product holds. The trace is written
 *   by {@link withUsageTracing}, which wraps OST-Agent's own closed allowlist, so a
 *   failing `Bash`, `Edit`, `Glob` or `Write` is not something the derivation missed.
 *   It is a call the trace was never in a position to see. Counting those against the
 *   derivation would measure the allowlist, not the signal.
 * - **missed in scope** — the tool IS in the traced allowlist and the trace still has
 *   no such class. This is the bucket that bears on the assumption, and it is the one
 *   that turned out to be interesting: see {@link LogOnlyFrictionRecall.missedInScope}.
 * - **recovered** — the derivation named it.
 *
 * Both a total recall and an in-scope recall are reported, and neither is the
 * headline on its own. The total says what fraction of the agent's known friction a
 * log-only channel would surface; the in-scope one says how good the derivation is
 * at the part of the record it can actually read.
 */
import fs from "node:fs";
import path from "node:path";
import { ALLOWED_TOOL_NAMES } from "../security/policy.js";
import { INIT_TRACE_TOOL, type UsageEvent } from "./usage.js";

/**
 * What this census counts and the bars it counts against — fixed by the assumption
 * test "Thirty-day log sample for existing signal" before anything was counted.
 *
 * Each number is here rather than inline so that changing one shows up as a changed
 * expectation in `test/telemetry/log-only-friction-recall.test.ts` rather than as a
 * quietly different finding.
 */
export const LOG_ONLY_FRICTION_RULE = {
  /** The sample the assumption test named: "the last thirty days of existing logs". */
  windowDays: 30,

  /**
   * Occurrences that make a class *recurring* rather than a one-off.
   *
   * Three, matching the assumption test's own "≥3 recurring patterns" — a pattern
   * seen three times is the smallest thing that test is willing to call recurring,
   * so it is also the smallest thing counted as one here.
   */
  recurrenceFloor: 3,

  /** Recurring patterns the log-only derivation must find for the channel to be worth it. */
  patternsFloor: 3,

  /**
   * Of those, how many must map to a product problem a human agrees is worth fixing.
   *
   * Recorded, never computed. See {@link LOG_ONLY_FRICTION_RULE.refuses}.
   */
  productProblemFloor: 2,

  /**
   * The clause this module refuses. Named rather than omitted: a census that quietly
   * reported the countable clause would read as settling the assumption.
   */
  refuses:
    "whether a recurring pattern maps to a product problem worth fixing — that is a ranking, and the assumption test assigns it to a person",
} as const;

/** The friction kinds both records speak in. Mirrors `FrictionKind` in the transcript adapter. */
export type FrictionClassKind =
  | "tool_error"
  | "retry"
  | "permission_denied"
  | "interruption"
  | "clarifying_question";

/**
 * The kinds the trace can represent at all.
 *
 * A failed call and a denial are events the trace records directly; a retry is
 * derived from repeat call signatures (see {@link deriveFrictionClasses}). An
 * interruption and a clarifying question are not tool outcomes — nothing about them
 * reaches a tool's `run`, so no wrapper around one could record them. That is a
 * property of the trace's vantage point, not a gap in this derivation.
 */
export const TRACE_REPRESENTABLE_KINDS: readonly FrictionClassKind[] = ["tool_error", "retry", "permission_denied"];

/**
 * Tools whose calls can ever appear in the trace: OST-Agent's closed allowlist, plus
 * the vault's own beginning, which is traced under a name that is not a tool.
 *
 * Imported rather than restated. The allowlist is the thing that bounds what the
 * trace can see, so a tool added there must widen this set in the same commit or the
 * census would report a real miss as out of reach.
 */
export const TRACEABLE_TOOLS: ReadonlySet<string> = new Set<string>([...ALLOWED_TOOL_NAMES, INIT_TRACE_TOOL]);

/** One friction class, from either record. */
export interface FrictionClass {
  kind: FrictionClassKind;
  /** Normalized tool name, or `""` for the kinds that name no tool. */
  tool: string;
  /** How many times it occurred in the window. */
  occurrences: number;
  /** Whether that clears {@link LOG_ONLY_FRICTION_RULE.recurrenceFloor}. */
  recurring: boolean;
  /** A short, already-redacted example, so a reader can tell what the class is. */
  sample?: string;
}

/** `kind|tool`, the identity two records are compared on. */
export function classKey(c: { kind: string; tool: string }): string {
  return `${c.kind}|${c.tool}`;
}

/**
 * Strip the host's MCP prefix so the two records name the same tool the same way.
 *
 * The transcript sees `mcp__ost-agent__ost_next_work`, and — when the same tools are
 * reached through the plugin — `mcp__plugin_ost-agent_ost-agent__ost_next_work`. The
 * trace sees `ost_next_work`, because it is written inside the tool. Both prefixes
 * are the host's routing, not part of the tool's identity, and leaving either on
 * would file every OST tool as a tool this product does not hold.
 */
export function normalizeToolName(tool: string): string {
  return tool.replace(/^mcp__[A-Za-z0-9_-]*?__/, "");
}

/** Inclusive-start, inclusive-end UTC day bounds. */
export interface Window {
  /** First UTC day in the window, `YYYY-MM-DD`. */
  from: string;
  /** Last UTC day in the window, `YYYY-MM-DD`. */
  to: string;
}

/**
 * The {@link LOG_ONLY_FRICTION_RULE.windowDays}-day window ending on `lastDay`.
 *
 * `lastDay` is supplied rather than read off the clock: a census whose window moved
 * with the wall clock would give a different answer every day it ran, and the number
 * this file pins is a reading of a fixed sample.
 */
export function windowEndingOn(lastDay: string, days: number = LOG_ONLY_FRICTION_RULE.windowDays): Window {
  const end = Date.parse(`${lastDay}T00:00:00.000Z`);
  const from = new Date(end - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to: lastDay };
}

function inWindow(iso: string, w: Window): boolean {
  const day = iso.slice(0, 10);
  return day >= w.from && day <= w.to;
}

/** What {@link deriveFrictionClasses} could not do, reported beside what it did. */
export interface DerivationCoverage {
  /** Trace events inside the window. */
  events: number;
  /** Of those, how many failed. */
  failures: number;
  /** Of those failures, how many the surface stamped as a grant refusal. */
  denials: number;
  /**
   * Events the retry rule could not consider, because the surface stamped no session.
   *
   * A retry is "the same call again in the same session", and an event with no
   * session has no *same session* to be again in. Pooling them under a shared blank
   * key would invent retries across unrelated CLI invocations, so they are excluded
   * and counted here instead.
   */
  retryUnattributable: number;
}

/**
 * Derive friction classes from the trace alone — failed calls, denials, and retries.
 *
 * ## The retry rule, and the fidelity it gives up
 *
 * The transcript's rule is "this tool with this exact input, seen before in this
 * session". The trace deliberately records input SIZE and never input content, so
 * the closest available key is `session + tool + argBytes`. That is strictly
 * weaker: two genuinely different calls of the same size collide and are reported
 * as a retry that did not happen. The direction of the error is worth stating
 * because it decides how to read the output — it inflates the trace's retry counts,
 * which costs precision and cannot cost recall, so a retry class the trace *fails*
 * to name is a real absence rather than an artefact of the key.
 *
 * Widening the trace to carry an input hash would close it. That is new
 * instrumentation, which is the cost the solution under test is trying to avoid, so
 * the weaker key stands and the census says what it costs.
 */
export function deriveFrictionClasses(
  events: readonly UsageEvent[],
  window: Window,
): { classes: FrictionClass[]; coverage: DerivationCoverage } {
  const counts = new Map<string, FrictionClass>();
  const bump = (kind: FrictionClassKind, tool: string, sample?: string) => {
    const key = classKey({ kind, tool });
    const existing = counts.get(key);
    if (existing) {
      existing.occurrences += 1;
      if (!existing.sample && sample) existing.sample = sample;
    } else {
      counts.set(key, { kind, tool, occurrences: 1, recurring: false, ...(sample ? { sample } : {}) });
    }
  };

  const seenCalls = new Set<string>();
  const coverage: DerivationCoverage = { events: 0, failures: 0, denials: 0, retryUnattributable: 0 };

  for (const ev of events) {
    if (typeof ev.ts !== "string" || !inWindow(ev.ts, window)) continue;
    coverage.events += 1;
    const tool = normalizeToolName(ev.tool);

    if (!ev.ok) {
      coverage.failures += 1;
      if (ev.denied) coverage.denials += 1;
      bump(ev.denied ? "permission_denied" : "tool_error", tool, ev.err);
    }

    if (!ev.session) {
      coverage.retryUnattributable += 1;
      continue;
    }
    const signature = `${ev.session}|${ev.tool}|${ev.argBytes}`;
    if (seenCalls.has(signature)) bump("retry", tool);
    else seenCalls.add(signature);
  }

  return { classes: rank(counts), coverage };
}

function rank(counts: Map<string, FrictionClass>): FrictionClass[] {
  return [...counts.values()]
    .map((c) => ({ ...c, recurring: c.occurrences >= LOG_ONLY_FRICTION_RULE.recurrenceFloor }))
    .sort((a, b) => b.occurrences - a.occurrences || (classKey(a) < classKey(b) ? -1 : 1));
}

/** One friction event as the transcript channel already recorded it. */
export interface KnownFrictionEvent {
  kind: FrictionClassKind;
  /** Normalized tool name; `""` when the event named none. */
  tool: string;
  detail: string;
  /** The transcript session it came from, for provenance only — it joins nothing. */
  session: string;
  /** The evidence item's timestamp, which is when the session was harvested. */
  timestamp: string;
}

/**
 * The bullet the transcript channel writes for one friction event.
 *
 * Anchored to the start of a line and to the exact `- **kind** (tool): detail` shape
 * `renderBody` emits (`src/adapters/transcript.ts`), because a friction detail is
 * itself clipped prose that routinely contains bullets and asterisks. The test
 * round-trips this against the real writer, so a change to the renderer shows up as
 * a failed parse rather than as a known set that silently shrank.
 */
const FRICTION_BULLET = /^- \*\*([a-z_]+)\*\*(?: \(([^)]*)\))?: (.*)$/;

const KNOWN_KINDS = new Set<string>([
  "tool_error",
  "retry",
  "permission_denied",
  "interruption",
  "clarifying_question",
]);

/** Pull every friction event out of one rendered `TRANSCRIPT_*.md` evidence body. */
export function parseKnownFriction(body: string, session: string, timestamp: string): KnownFrictionEvent[] {
  const events: KnownFrictionEvent[] = [];
  for (const line of body.split("\n")) {
    const m = FRICTION_BULLET.exec(line.trim());
    if (!m || !KNOWN_KINDS.has(m[1])) continue;
    events.push({
      kind: m[1] as FrictionClassKind,
      tool: normalizeToolName(m[2] ?? ""),
      detail: m[3].trim(),
      session,
      timestamp,
    });
  }
  return events;
}

/**
 * How many events the item SAID it found, so a truncated known set cannot pass for a
 * complete one.
 *
 * The transcript source caps events per session and writes "Showing the first N; the
 * rest are counted only." A known set read off a capped item is smaller than the
 * friction that happened, and a recall taken against it would be measured against a
 * denominator that quietly moved.
 */
export function declaredFrictionCount(body: string): number | null {
  const m = /produced (\d+) friction events/.exec(body);
  return m ? Number(m[1]) : null;
}

/**
 * What reading the known set could and could not account for.
 *
 * Describes the READ, never the window: the cap check below compares what the items
 * said they found against what they printed, and a window that legitimately drops
 * six events from an older session would otherwise read as six events lost to a cap.
 */
export interface KnownSetCoverage {
  /** Evidence items read. */
  items: number;
  /** Friction events parsed out of them, before any window is applied. */
  events: number;
  /** Events those items said they found — larger than {@link events} when any was capped. */
  declared: number;
}

/**
 * Read the transcript channel's own account of the agent's friction out of a vault's
 * evidence folder.
 *
 * A missing folder reads as no known friction rather than throwing: "this vault has
 * never harvested a transcript" is a result the census must be able to return, and it
 * is the one most worth distinguishing from a crash.
 */
export function evidenceDirOf(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), ".ost-agent", "evidence");
}

export function readKnownFriction(evidenceDir: string): { events: KnownFrictionEvent[]; coverage: KnownSetCoverage } {
  let names: string[];
  try {
    names = fs.readdirSync(evidenceDir);
  } catch {
    return { events: [], coverage: { items: 0, events: 0, declared: 0 } };
  }

  const events: KnownFrictionEvent[] = [];
  const coverage: KnownSetCoverage = { items: 0, events: 0, declared: 0 };
  for (const name of names.sort()) {
    if (!name.startsWith("TRANSCRIPT_") || !name.endsWith(".md")) continue;
    let body: string;
    try {
      body = fs.readFileSync(path.join(evidenceDir, name), "utf8");
    } catch {
      continue; // an unreadable item costs one session, never the census
    }
    coverage.items += 1;
    coverage.declared += declaredFrictionCount(body) ?? 0;
    const timestamp = /^timestamp: *'?([^'\n]+)'?$/m.exec(body)?.[1]?.trim() ?? "";
    events.push(...parseKnownFriction(body, name.slice("TRANSCRIPT_".length, -".md".length), timestamp));
  }
  coverage.events = events.length;
  return { events, coverage };
}

/** Fold known events into classes, over the window. */
export function knownFrictionClasses(events: readonly KnownFrictionEvent[], window: Window): FrictionClass[] {
  const counts = new Map<string, FrictionClass>();
  for (const ev of events) {
    if (!inWindow(ev.timestamp, window)) continue;
    const key = classKey(ev);
    const existing = counts.get(key);
    if (existing) existing.occurrences += 1;
    else counts.set(key, { kind: ev.kind, tool: ev.tool, occurrences: 1, recurring: false, sample: ev.detail });
  }
  return rank(counts);
}

/** Why a known class could not be recovered. */
export type OutOfReachReason =
  | "the tool is outside the traced allowlist"
  | "the trace records no such kind";

/** One known recurring class, and what became of it. */
export interface RecallVerdict {
  known: FrictionClass;
  /** `recovered` | `missed` | `out-of-reach`. */
  outcome: "recovered" | "missed" | "out-of-reach";
  /** Set only on `out-of-reach`. */
  reason?: OutOfReachReason;
  /** The derivation's own count for the class, when it named one. */
  derivedOccurrences?: number;
}

export interface LogOnlyFrictionRecall {
  window: Window;
  derivation: DerivationCoverage;
  knownSet: KnownSetCoverage;
  /** Known friction events that fall inside {@link window} — the denominator's raw material. */
  knownInWindow: number;
  /** Every recurring class the trace-only derivation found. */
  derivedRecurring: FrictionClass[];
  /** Every recurring class the transcript channel found, with its verdict. */
  verdicts: RecallVerdict[];
  recovered: number;
  /** Known recurring classes on a traced tool that the derivation did not name. */
  missedInScope: RecallVerdict[];
  /** Known recurring classes the trace could never have held. */
  outOfReach: RecallVerdict[];
  /** recovered / all known recurring classes. `null` when there are none. */
  recall: number | null;
  /** recovered / (recovered + missed in scope). `null` when nothing was in scope. */
  inScopeRecall: number | null;
  /**
   * Recurring classes the derivation named that the known set does not call recurring.
   *
   * Not "false positives" — the transcript channel is a second account, not ground
   * truth — but the direction that catches a derivation tuned to say "recurring" to
   * everything, which would otherwise score a perfect recall.
   */
  unmatched: FrictionClass[];
  /** Whether the derivation cleared {@link LOG_ONLY_FRICTION_RULE.patternsFloor}. */
  meetsPatternsFloor: boolean;
}

/**
 * Score a trace-only derivation against the transcript channel's known friction.
 *
 * Only the *recurring* classes on each side are compared. A class seen once in
 * either record is not a pattern, and scoring recall over singletons would make the
 * number a reading of how long each channel has been running rather than of how much
 * signal the trace holds.
 */
export function logOnlyFrictionRecall(
  derived: { classes: FrictionClass[]; coverage: DerivationCoverage },
  known: { events: readonly KnownFrictionEvent[]; coverage: KnownSetCoverage },
  window: Window,
): LogOnlyFrictionRecall {
  const derivedRecurring = derived.classes.filter((c) => c.recurring);
  const derivedByKey = new Map(derivedRecurring.map((c) => [classKey(c), c]));
  const knownRecurring = knownFrictionClasses(known.events, window).filter((c) => c.recurring);
  const knownKeys = new Set(knownRecurring.map(classKey));

  const verdicts: RecallVerdict[] = knownRecurring.map((c) => {
    const hit = derivedByKey.get(classKey(c));
    if (hit) return { known: c, outcome: "recovered", derivedOccurrences: hit.occurrences };
    if (!TRACE_REPRESENTABLE_KINDS.includes(c.kind)) {
      return { known: c, outcome: "out-of-reach", reason: "the trace records no such kind" };
    }
    if (!TRACEABLE_TOOLS.has(c.tool)) {
      return { known: c, outcome: "out-of-reach", reason: "the tool is outside the traced allowlist" };
    }
    return { known: c, outcome: "missed" };
  });

  const recovered = verdicts.filter((v) => v.outcome === "recovered").length;
  const missedInScope = verdicts.filter((v) => v.outcome === "missed");
  const outOfReach = verdicts.filter((v) => v.outcome === "out-of-reach");
  const inScope = recovered + missedInScope.length;

  return {
    window,
    derivation: derived.coverage,
    knownSet: known.coverage,
    knownInWindow: known.events.filter((e) => inWindow(e.timestamp, window)).length,
    derivedRecurring,
    verdicts,
    recovered,
    missedInScope,
    outOfReach,
    recall: knownRecurring.length === 0 ? null : recovered / knownRecurring.length,
    inScopeRecall: inScope === 0 ? null : recovered / inScope,
    unmatched: derivedRecurring.filter((c) => !knownKeys.has(classKey(c))),
    meetsPatternsFloor: derivedRecurring.length >= LOG_ONLY_FRICTION_RULE.patternsFloor,
  };
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function label(c: FrictionClass): string {
  return `${c.kind}${c.tool ? ` (${c.tool})` : ""}`;
}

/**
 * The census as an operator reads it: coverage, the countable clause, the recall,
 * then the clause this cannot settle.
 *
 * The refusal is printed every time, including when every bar is met. A report that
 * ended on the recall figure would read as the assumption confirmed, and the clause
 * that decides whether these patterns are worth anything — whether a human would
 * call them product problems — is the one not in this output.
 */
export function formatLogOnlyFrictionRecall(census: LogOnlyFrictionRecall): string {
  const lines: string[] = [];
  const d = census.derivation;

  lines.push(
    `Window: ${census.window.from} … ${census.window.to} (${LOG_ONLY_FRICTION_RULE.windowDays} days) — ` +
      `${d.events} traced call(s), ${d.failures} failed (${d.denials} of them refusals), and ` +
      `${census.knownInWindow} friction event(s) the transcript channel already recorded across ` +
      `${census.knownSet.items} session(s).`,
  );
  if (census.knownSet.declared > census.knownSet.events) {
    lines.push(
      `  Known set is capped: those items report ${census.knownSet.declared} event(s) and show ` +
        `${census.knownSet.events}. Recall below is against what is shown.`,
    );
  }
  if (d.retryUnattributable > 0) {
    lines.push(
      `  ${d.retryUnattributable} traced call(s) carry no session and were left out of retry detection — ` +
        `a repeat needs a session to be a repeat in.`,
    );
  }

  lines.push(
    `Patterns: the trace alone yields ${census.derivedRecurring.length} recurring class(es) ` +
      `(≥${LOG_ONLY_FRICTION_RULE.recurrenceFloor} occurrences) — floor is ` +
      `${LOG_ONLY_FRICTION_RULE.patternsFloor}, ${census.meetsPatternsFloor ? "MET" : "NOT MET"}.`,
  );
  for (const c of census.derivedRecurring) lines.push(`  ${label(c)} ×${c.occurrences}`);

  if (census.recall === null) {
    lines.push("Recall: the transcript channel recorded no recurring class in this window, so there is none to take.");
  } else {
    lines.push(
      `Recall: ${census.recovered}/${census.verdicts.length} (${pct(census.recall)}) of the recurring classes the ` +
        `transcript channel found are recoverable from the trace alone.`,
    );
    if (census.inScopeRecall !== null) {
      lines.push(
        `  In scope: ${census.recovered}/${census.recovered + census.missedInScope.length} ` +
          `(${pct(census.inScopeRecall)}) counting only classes on a tool the trace can ever record.`,
      );
    }
    for (const v of census.missedInScope) {
      lines.push(`  MISSED ${label(v.known)} ×${v.known.occurrences} — traced tool, no such class in the trace`);
      if (v.known.sample) lines.push(`    e.g. ${v.known.sample}`);
    }
    // Structural, never textual: two counts and one fact about where the trace is
    // written. Nothing here reads what a missed event SAYS — a classifier that
    // pattern-matched refusal wording would drift the moment host wording changed,
    // which is the failure `UsageEvent.denied` was made structural to rule out.
    if (census.missedInScope.length > 0 && d.denials === 0) {
      lines.push(
        `  Note: no traced call in this window was stamped as a refusal, and ${census.missedInScope.length} ` +
          `in-scope class(es) went missing. The trace is written INSIDE the tool, so a refusal the host issues ` +
          `before the call reaches it cannot appear here at all — a blind spot no derivation over this trace can close.`,
      );
    }
    if (census.outOfReach.length > 0) {
      lines.push(
        `  Out of reach: ${census.outOfReach.length} class(es) the trace could never hold — ` +
          `${census.outOfReach.map((v) => label(v.known)).join(", ")}.`,
      );
    }
  }

  if (census.unmatched.length > 0) {
    lines.push(
      `Named by the trace and not by the transcript channel: ${census.unmatched.length} class(es) — ` +
        `${census.unmatched.map((c) => `${label(c)} ×${c.occurrences}`).join(", ")}. ` +
        `The transcript channel is a second account, not ground truth; these are where the two disagree.`,
    );
  }

  lines.push(
    `Not settled: ${LOG_ONLY_FRICTION_RULE.refuses}. The bar is ` +
      `${LOG_ONLY_FRICTION_RULE.productProblemFloor} of them, and no count in this output can supply it.`,
  );

  return lines.join("\n");
}
