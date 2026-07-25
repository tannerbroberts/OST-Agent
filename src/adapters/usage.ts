/**
 * Usage source — rolls the mechanical tool-invocation trace into evidence.
 *
 * Where the transcript harvester summarizes what an agent SAID it did and the
 * friction adapter records what it CHOSE to file, this adapter reads the trace
 * no narrator touches (`.ost-agent/usage/events.jsonl`, written by
 * src/telemetry/usage.ts) and emits one evidence item per finished UTC day.
 * The statistics are computed, not composed: counts, error rates, durations,
 * surfaces. Where the trace disagrees with the narrative, believe the trace.
 *
 * Evidence class: observed behavior — machine-recorded as it happened. It
 * grounds usability and the behavior of the agent-tool loop; it says nothing
 * about external demand, and its items say so out loud.
 */
import fs from "node:fs";
import type { Cursor, EvidenceItem, FetchResult, Source } from "./source.js";
import type { UsageEvent } from "../telemetry/usage.js";

export interface UsageSourceOptions {
  /** Path to the events.jsonl trace (see usageLogPath). */
  file: string;
  /** A day must have at least this many events to be worth an evidence item. */
  minEvents?: number;
  /** Injectable "today" (UTC day string) for tests; defaults to the real clock. */
  today?: () => string;
}

const DEFAULT_MIN_EVENTS = 5;

function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function table(counts: Map<string, number>): string {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `| ${name} | ${n} |`)
    .join("\n");
}

export class UsageSource implements Source {
  readonly name = "usage";
  private readonly file: string;
  private readonly minEvents: number;
  private readonly today: () => string;

  constructor(opts: UsageSourceOptions) {
    this.file = opts.file;
    this.minEvents = opts.minEvents ?? DEFAULT_MIN_EVENTS;
    this.today = opts.today ?? (() => new Date().toISOString().slice(0, 10));
  }

  async fetchSince(cursor: Cursor): Promise<FetchResult> {
    if (!fs.existsSync(this.file)) return { items: [], cursor };

    const events: UsageEvent[] = [];
    for (const line of fs.readFileSync(this.file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as UsageEvent;
        if (typeof parsed.ts === "string" && typeof parsed.tool === "string") events.push(parsed);
      } catch {
        // a torn/corrupt line loses itself, never the rollup
      }
    }

    const today = this.today();
    const byDay = new Map<string, UsageEvent[]>();
    for (const ev of events) {
      const day = utcDay(ev.ts);
      if (day >= today) continue; // only finished days — a partial day would double-emit
      if (cursor && day <= cursor) continue;
      const bucket = byDay.get(day) ?? [];
      bucket.push(ev);
      byDay.set(day, bucket);
    }

    const items: EvidenceItem[] = [];
    let advanced = cursor;
    for (const day of [...byDay.keys()].sort()) {
      const dayEvents = byDay.get(day)!;
      // Every emitted-or-skipped finished day advances the cursor: a too-quiet
      // day is dropped deliberately, not left to re-surface forever.
      if (!advanced || day > advanced) advanced = day;
      if (dayEvents.length < this.minEvents) continue;
      items.push(this.rollup(day, dayEvents));
    }
    return { items, cursor: advanced };
  }

  private rollup(day: string, events: UsageEvent[]): EvidenceItem {
    const errors = events.filter((e) => !e.ok);
    const durations = events.map((e) => e.ms).sort((a, b) => a - b);
    const sessions = new Set(events.filter((e) => e.session).map((e) => e.session as string));
    const errSamples = errors.slice(0, 3).map((e) => `- \`${e.tool}\`: ${e.err ?? "(no message)"}`);

    const body = [
      `# Usage trace — ${day} (${events.length} tool invocations, machine-recorded)`,
      "",
      "Mechanical rollup of the append-only tool-invocation trace. Computed, not composed:",
      "no agent narrated, selected, or summarized these numbers.",
      "",
      `- **Calls:** ${events.length} (${events.length - errors.length} ok, ${errors.length} failed)`,
      `- **Duration:** p50 ${percentile(durations, 50)}ms, max ${percentile(durations, 100)}ms`,
      ...(sessions.size > 0 ? [`- **Sessions:** ${sessions.size}`] : []),
      "",
      "| Tool | Calls |",
      "| --- | --- |",
      table(countBy(events, (e) => e.tool)),
      "",
      "| Surface | Calls |",
      "| --- | --- |",
      table(countBy(events, (e) => e.surface ?? "unknown")),
      ...(errSamples.length > 0 ? ["", "**Failed calls (redacted, first 3):**", ...errSamples] : []),
      "",
      "Evidence class: **observed behavior** — machine-recorded trace of tool invocations;",
      "no narrator. Grounds usability and the agent-tool loop, not external demand.",
      "",
    ].join("\n");

    return {
      id: `USAGE:${day}`,
      source: `USAGE:${day}`,
      title: `Usage trace ${day} — ${events.length} calls, ${errors.length} failed`,
      body,
      timestamp: `${day}T23:59:59.000Z`,
    };
  }
}
