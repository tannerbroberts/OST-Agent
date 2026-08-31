/**
 * The raw event trace as the system of record, and every summary as a view over it.
 *
 * `src/telemetry/usage.ts` appends one line per tool invocation and never rewrites
 * one; `src/adapters/usage.ts` turned those lines into a per-day evidence item. The
 * two halves were joined by nothing: the adapter parsed the log itself, rolled a day
 * up inline, and rendered markdown in the same expression, so "the day's numbers" had
 * no name and no shape — they existed only as substrings of a document. Nothing could
 * ask what a summary keeps, because the summary was prose the moment it was computed.
 *
 * This module gives both halves a name. {@link RawEventStore} is the reader: the whole
 * trace, in append order, with no aggregation applied. {@link DailyUsageView} is the
 * derived view: exactly, and only, what the daily rollup retains about a day. The
 * adapter now renders a view rather than computing one, so the summary is a projection
 * of the store instead of a substitute for it.
 *
 * **The view is deliberately lossy, and its type is where the loss is visible.** A day
 * of events carries a timestamp per call, a session id per call, an ordering, a
 * duration per call and the node files each call touched. `DailyUsageView` carries a
 * day string, a session COUNT, per-tool and per-surface call counts, two duration
 * percentiles over the whole day, and three rendered error lines. Everything else is
 * gone by construction — which is the point. A question about hour-of-day, session
 * span, call adjacency, per-file contention or per-tool time cannot be answered from
 * this type because the type has no field that holds the answer, and that is a
 * property a reader can check rather than a claim this comment makes.
 * `test/telemetry/raw-event-question-coverage.test.ts` measures it the harder way: it
 * perturbs a real week of raw events so the derived views come out byte-identical, and
 * shows the answers move anyway.
 *
 * Retention is not settled here. Keeping the raw stream is what makes those questions
 * askable; what it costs in bytes on the operator's disk, and in the consent that
 * `src/telemetry/consent.ts` governs, is a separate question this module does not
 * answer and must not be read as having answered.
 */
import fs from "node:fs";
import type { UsageEvent } from "./usage.js";
import { usageLogPath } from "./usage.js";

/**
 * "denied" | "error" | "ok" — read off the event as recorded, never off `err`'s
 * text. `denied` is stamped at capture ({@link import("./usage.js").withUsageTracing})
 * from the thrown error's TYPE, so this function has nothing to pattern-match: it just
 * reads the field. That is the whole point — the classification cannot drift when host
 * wording changes, because it was never derived from wording.
 */
export function classifyUsageEvent(event: UsageEvent): "ok" | "denied" | "error" {
  if (event.ok) return "ok";
  return event.denied ? "denied" : "error";
}

/**
 * One kind of silent frontmatter loss, aggregated across a day.
 *
 * "Silent" is the operative word and the reason this is its own section of the rollup
 * rather than a column on the tool table. The 2026-07-24 hard-fix session's two defects
 * — a rewrite that stripped `evidence:` off every node it touched, and a `create` that
 * took an `evidence` argument and did not write it — produced no error, no denial and
 * no outlying duration between them. In a rollup of counts and timings that day is
 * indistinguishable from a good one, which is exactly the limit this module's
 * assumption test set out to probe.
 */
export interface FieldLoss {
  tool: string;
  field: string;
  /** `stripped`: the node had it before this call's write and not after.
   *  `dropped`: the call's own input named it and nothing it wrote came out holding it. */
  kind: "stripped" | "dropped";
  calls: number;
}

/**
 * Every field loss in a set of events, grouped by tool + field + kind.
 *
 * Grouped rather than listed because the shape of the finding is "this tool loses
 * this field", and forty identical rows say that worse than one row saying 40.
 */
export function fieldLosses(events: readonly UsageEvent[]): FieldLoss[] {
  const counts = new Map<string, FieldLoss>();
  const add = (tool: string, field: string, kind: FieldLoss["kind"]) => {
    // `\0` written as an escape rather than as the byte itself. The separator is the
    // one this function has always used, but it arrived here as a literal NUL in the
    // source — which made `src/adapters/usage.ts` a *binary* file to git, undiffable
    // in every review since it landed. Seven other modules still carry the raw byte
    // for the same reason; see the PR that moved this one.
    const key = `${tool}\0${field}\0${kind}`;
    const existing = counts.get(key);
    if (existing) existing.calls += 1;
    else counts.set(key, { tool, field, kind, calls: 1 });
  };
  for (const ev of events) {
    for (const field of ev.lost ?? []) add(ev.tool, field, "stripped");
    for (const field of ev.dropped ?? []) add(ev.tool, field, "dropped");
  }
  return [...counts.values()].sort(
    (a, b) => b.calls - a.calls || (a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0) || (a.field < b.field ? -1 : 1),
  );
}

/** A name and how many calls carried it, ordered by count. */
export interface CountRow {
  name: string;
  calls: number;
}

/**
 * What the daily rollup keeps about one day — the whole of it.
 *
 * This type is the summary. If a field is not here, the rollup does not have it and
 * no reader downstream of the rollup can recover it; that is not an oversight to be
 * fixed field by field, it is what "summarising first" means. The five questions in
 * `test/telemetry/raw-event-question-coverage.test.ts` are chosen against this shape.
 */
export interface DailyUsageView {
  /** UTC day, `YYYY-MM-DD`. The finest time resolution that survives the projection. */
  day: string;
  calls: number;
  ok: number;
  denied: number;
  failed: number;
  /** Percentiles over the day's whole duration multiset — not per tool, not per session. */
  p50Ms: number;
  maxMs: number;
  /** How many distinct sessions dispatched a call. Which ones, and when, does not survive. */
  sessions: number;
  byTool: CountRow[];
  bySurface: CountRow[];
  losses: FieldLoss[];
  /** Calls that returned OK and still cost a node a field. Counted over calls, not rows. */
  lossyCalls: number;
  /** First three denials, already rendered to the line the rollup prints. */
  deniedSamples: string[];
  /** First three failures, likewise. */
  errorSamples: string[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function countBy(events: readonly UsageEvent[], key: (event: UsageEvent) => string): CountRow[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const k = key(event);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, calls]) => ({ name, calls }));
}

/** The line the rollup prints for a sampled failure. Rendered here so the view holds no event. */
function sample(e: UsageEvent): string {
  return `- \`${e.tool}\` on ${e.surface}${e.unknown ? ` (working: ${e.unknown})` : ""}: ${e.err ?? "(no message)"}`;
}

/**
 * Project one day's raw events onto the view the rollup renders.
 *
 * The projection is total and one-way: every field of the result is computed from the
 * events, and no event survives it. Called once per day by {@link RawEventStore.view}
 * and by the usage adapter, so the summary a reader sees and the summary this module's
 * instrument interrogates are the same computation rather than two that agree today.
 */
export function deriveDailyView(day: string, events: readonly UsageEvent[]): DailyUsageView {
  const errors = events.filter((e) => !e.ok);
  // A denial is a refusal the surface never got to attempt, not the tool failing on
  // its own terms (see `classifyUsageEvent`) — kept as its own bucket so the shape of
  // each surface's refusals accumulates instead of being buried inside "failed".
  const denied = errors.filter((e) => classifyUsageEvent(e) === "denied");
  const trueErrors = errors.filter((e) => classifyUsageEvent(e) === "error");
  const durations = events.map((e) => e.ms).sort((a, b) => a - b);
  return {
    day,
    calls: events.length,
    ok: events.length - errors.length,
    denied: denied.length,
    failed: trueErrors.length,
    p50Ms: percentile(durations, 50),
    maxMs: percentile(durations, 100),
    sessions: new Set(events.filter((e) => e.session).map((e) => e.session as string)).size,
    byTool: countBy(events, (e) => e.tool),
    bySurface: countBy(events, (e) => e.surface ?? "unknown"),
    losses: fieldLosses(events),
    // Counted over calls, not over rows: one call that stripped two fields is one call
    // that came back green while damaging a node, and that is the number a reader is
    // deciding on.
    lossyCalls: events.filter((e) => (e.lost?.length ?? 0) > 0 || (e.dropped?.length ?? 0) > 0).length,
    // First three in append order, not the worst three: the rollup samples, it does not
    // rank, and a reader must not read a sample as a selection.
    deniedSamples: denied.slice(0, 3).map(sample),
    errorSamples: trueErrors.slice(0, 3).map(sample),
  };
}

/** The UTC day an event belongs to. */
export function eventDay(event: UsageEvent): string {
  return event.ts.slice(0, 10);
}

/**
 * The trace, in append order, with nothing aggregated away.
 *
 * Construction never throws and never returns a partial answer disguised as a whole
 * one: a missing log is an empty store, and a torn line — the real state of an
 * append-only file written fail-open — costs that one event and is counted in
 * {@link unparseableLines} so a caller can say so out loud rather than quietly
 * reporting a smaller week.
 *
 * The store is immutable and holds the events in memory. That is the honest bound on
 * this design and it is stated rather than hidden: a trace larger than the process
 * wants to hold needs a different reader, and the day this vault's trace reaches that
 * size is the day this class earns a streaming sibling. At the size it is read at now —
 * ~8k events, 1.4 MB — a full parse is milliseconds and the simplicity is worth more
 * than the generality.
 */
export class RawEventStore {
  private readonly all: readonly UsageEvent[];
  /** Lines that did not parse, or parsed to something without a `ts` and `tool`. */
  readonly unparseableLines: number;

  private constructor(events: readonly UsageEvent[], unparseableLines: number) {
    this.all = events;
    this.unparseableLines = unparseableLines;
  }

  /** Parse JSONL. A line that is not an event is dropped and counted, never thrown on. */
  static fromText(text: string): RawEventStore {
    const events: UsageEvent[] = [];
    let unparseable = 0;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as UsageEvent;
        if (typeof parsed.ts === "string" && typeof parsed.tool === "string") events.push(parsed);
        else unparseable++;
      } catch {
        unparseable++;
      }
    }
    return new RawEventStore(events, unparseable);
  }

  /** Read a JSONL file. A file that is not there is an empty store, not an exception. */
  static fromFile(file: string): RawEventStore {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      return new RawEventStore([], 0);
    }
    return RawEventStore.fromText(text);
  }

  /** Read a vault's own trace, wherever {@link usageLogPath} puts it. */
  static fromVault(vaultDir: string): RawEventStore {
    return RawEventStore.fromFile(usageLogPath(vaultDir));
  }

  /** Build a store over events already in hand — the shape a test or a filter produces. */
  static of(events: readonly UsageEvent[]): RawEventStore {
    return new RawEventStore([...events], 0);
  }

  /** Every event, in append order. Append order, not timestamp order: see `node-touch.ts`. */
  events(): readonly UsageEvent[] {
    return this.all;
  }

  /** The UTC days the store holds events for, ascending. Days with no events do not appear. */
  days(): string[] {
    return [...new Set(this.all.map(eventDay))].sort();
  }

  /** One day's events, in append order. */
  eventsOn(day: string): UsageEvent[] {
    return this.all.filter((e) => eventDay(e) === day);
  }

  /** A store over the events between two ISO instants, inclusive of both ends. */
  between(fromIso: string, toIso: string): RawEventStore {
    return new RawEventStore(
      this.all.filter((e) => e.ts >= fromIso && e.ts <= toIso),
      0,
    );
  }

  /** The derived view for one day, or undefined when the store holds no event in it. */
  view(day: string): DailyUsageView | undefined {
    const events = this.eventsOn(day);
    return events.length > 0 ? deriveDailyView(day, events) : undefined;
  }

  /** Every day's view, ascending. The whole of what a summary-only store would keep. */
  views(): DailyUsageView[] {
    return this.days().map((day) => deriveDailyView(day, this.eventsOn(day)));
  }
}
