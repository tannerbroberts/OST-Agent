/**
 * "Replay one week of raw events against five questions the rollup cannot answer" —
 * the AssumptionTest beneath "Raw-first telemetry store with summaries as derived views".
 *
 * The assumption is that raw retention answers questions summaries cannot — that the
 * extra fidelity is *used*, not merely hoarded — and the pre-committed threshold is
 * that **at least three of five** questions are answerable from a week of raw events
 * and not from the derived rollup. Below three, the fidelity is not paying for itself
 * and the cheaper option wins.
 *
 * ## Why the summary is a type here, and not a document
 *
 * "The rollup cannot answer it" is easy to assert and hard to mean. Until this test
 * existed the rollup was a markdown string composed inline inside the usage adapter,
 * so the only way to ask it a question was to read the prose and decide — which is a
 * measurement of the reader. `src/telemetry/raw-event-store.ts` now names the two
 * things separately: {@link RawEventStore} is the raw trace as the system of record,
 * and {@link DailyUsageView} is **exactly** what a day's rollup retains. The five
 * questions were chosen against that type's field list, before a single answer was
 * computed, and `test/fixtures/raw-event-week/PROVENANCE.md` records that the week was
 * cut by date rather than by whether it answers them.
 *
 * ## How "cannot answer" is measured rather than argued
 *
 * Choosing the questions against the type still leaves the strongest form of the claim
 * unproven, because "I could not think how to derive it from the view" is not the same
 * as "it is not in the view". So each question carries a **witness**: a transform of
 * the raw week whose derived views are byte-identical to the real week's, and whose
 * answer is different. A summary that comes out the same on two weeks that differ in
 * the answer cannot be carrying the answer — that is an information argument, not a
 * failure of imagination, and both halves of it are asserted here rather than claimed.
 *
 * The view-identity half is what stops the witness from cheating: a transform that
 * quietly changed a count would fail `toEqual` before it ever got to move an answer.
 *
 * ## What this does not settle
 *
 * Nothing about cost. The solution node says raw-first buys maximum answerability at
 * maximum storage and privacy exposure, and this instrument speaks only to the first
 * half. What a retained week costs in bytes, and what it costs in the operator consent
 * `src/telemetry/consent.ts` governs, is untouched by anything below — a green run here
 * is not a verdict that keeping the stream is worth it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { RawEventStore, type DailyUsageView } from "../../src/telemetry/raw-event-store.js";
import type { UsageEvent } from "../../src/telemetry/usage.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "raw-event-week");

const WEEK: readonly UsageEvent[] = RawEventStore.fromText(
  fs.readFileSync(path.join(fixtureDir, "events.jsonl"), "utf8"),
).events();

const MANIFEST = JSON.parse(fs.readFileSync(path.join(fixtureDir, "week.json"), "utf8")) as {
  window: { first: string; last: string; days: string[] };
  weekEvents: number;
  perDay: Record<string, number>;
};

/** The derived summary of a week — the whole of what a summary-only store would keep. */
function viewsOf(events: readonly UsageEvent[]): DailyUsageView[] {
  return RawEventStore.of(events).views();
}

const dayOf = (e: UsageEvent) => e.ts.slice(0, 10);

/**
 * Apply a within-day rearrangement, keeping every event in the day it was recorded in.
 *
 * Day membership is the one thing the derived view reads off a timestamp, so a witness
 * that stays inside the day is a witness the summary cannot see. The rearranged events
 * are handed back out in the original append order, which matters for the two view
 * fields that are order-sensitive: the first three denials and the first three failures
 * are sampled by position, so a witness that reordered the day would change the summary
 * and be rejected by the identity assertion below.
 */
function perDay(events: readonly UsageEvent[], rearrange: (day: UsageEvent[]) => UsageEvent[]): UsageEvent[] {
  const groups = new Map<string, UsageEvent[]>();
  for (const e of events) {
    const g = groups.get(dayOf(e)) ?? [];
    g.push(e);
    groups.set(dayOf(e), g);
  }
  const done = new Map<string, UsageEvent[]>();
  for (const [day, g] of groups) done.set(day, rearrange(g));
  const cursor = new Map<string, number>();
  return events.map((e) => {
    const i = cursor.get(dayOf(e)) ?? 0;
    cursor.set(dayOf(e), i + 1);
    return done.get(dayOf(e))![i];
  });
}

/** Move every call `hours` later in its own day, wrapping at midnight so the day is kept. */
function rotateTimeOfDay(events: readonly UsageEvent[], hours: number): UsageEvent[] {
  return events.map((e) => {
    const midnight = Date.parse(`${dayOf(e)}T00:00:00.000Z`);
    const offset = (Date.parse(e.ts) - midnight + hours * 3_600_000) % 86_400_000;
    return { ...e, ts: new Date(midnight + offset).toISOString() };
  });
}

/** Deal the day's timestamps back out in reverse: same instants, different calls at them. */
function reverseTimestamps(events: readonly UsageEvent[]): UsageEvent[] {
  return perDay(events, (day) => {
    const stamps = day.map((e) => e.ts).reverse();
    return day.map((e, i) => ({ ...e, ts: stamps[i] }));
  });
}

/** Deal the day's durations back out in reverse: same multiset, attached to other tools. */
function reverseDurations(events: readonly UsageEvent[]): UsageEvent[] {
  return perDay(events, (day) => {
    const ms = day.map((e) => e.ms).reverse();
    return day.map((e, i) => ({ ...e, ms: ms[i] }));
  });
}

/**
 * Deal the week's node-file lists back out in reverse, across days rather than within one.
 *
 * The cross-day reach is deliberate and is safe for a reason the other witnesses do not
 * get to use: `touched` and `wrote` appear nowhere in {@link DailyUsageView} at all —
 * not as names, not as a count. There is no day-shaped invariant to respect because
 * there is no field to disturb, which is itself most of the answer to the fourth
 * question.
 */
function reverseFileLists(events: readonly UsageEvent[]): UsageEvent[] {
  const lists = events.map((e) => ({ touched: e.touched, wrote: e.wrote })).reverse();
  return events.map((e, i) => ({ ...e, touched: lists[i].touched, wrote: lists[i].wrote }));
}

/** The events of one session, in timestamp order — the ordering every "what happened next" needs. */
function bySession(events: readonly UsageEvent[]): Map<string, UsageEvent[]> {
  const out = new Map<string, UsageEvent[]>();
  for (const e of events) {
    const key = e.session ?? "(unattributed)";
    const g = out.get(key) ?? [];
    g.push(e);
    out.set(key, g);
  }
  for (const g of out.values()) g.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return out;
}

/** Files a call reached, preferring `touched` because it is the superset (see UsageEvent). */
const filesOf = (e: UsageEvent) => e.touched ?? e.wrote ?? [];

interface Question {
  /** What is being asked, in the words it was written down in. */
  ask: string;
  /** The answer read off the raw week, rendered as one line. */
  answer: (events: readonly UsageEvent[]) => string;
  /** What that answer is on the committed fixture, pinned so the finding is in the file. */
  onThisWeek: string;
  /** The field of `DailyUsageView` a summary would need to hold to answer it. */
  wouldNeed: string;
  /** A different week with the same summary. */
  witness: (events: readonly UsageEvent[]) => UsageEvent[];
  /** What the witness changes, in one clause. */
  witnessIs: string;
}

/**
 * The five, written down against `DailyUsageView`'s field list before any was answered.
 *
 * Each is a question this project has an actual reason to ask — the fourth is the
 * measurement behind "the file changed after I read it, and the failed edit is how I
 * find out", the third is behind "a test that failed because the machine was busy looks
 * exactly like one that failed because I broke something". None was picked for being
 * exotic; they were picked for being ordinary and outside the summary's reach.
 */
const QUESTIONS: Question[] = [
  {
    ask: "Q1. Which hour of the UTC day does the agent do most of its work in?",
    wouldNeed: "any time resolution finer than `day`",
    answer: (events) => {
      const byHour = new Map<string, number>();
      for (const e of events) byHour.set(e.ts.slice(11, 13), (byHour.get(e.ts.slice(11, 13)) ?? 0) + 1);
      const [hour, calls] = [...byHour.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
      return `${hour}:00 UTC, ${calls} calls`;
    },
    onThisWeek: "16:00 UTC, 160 calls",
    witness: (events) => rotateTimeOfDay(events, 6),
    witnessIs: "every call moved six hours later inside its own day",
  },
  {
    ask: "Q2. How long did the longest session run, first call to last?",
    wouldNeed: "a per-session first and last timestamp; the view keeps only how many sessions there were",
    answer: (events) => {
      const spans = [...bySession(events).entries()]
        .filter(([id]) => id !== "(unattributed)")
        .map(([id, calls]) => ({ id, ms: Date.parse(calls[calls.length - 1].ts) - Date.parse(calls[0].ts) }))
        .sort((a, b) => b.ms - a.ms);
      return `${Math.round(spans[0].ms / 60_000)} min (${spans[0].id})`;
    },
    onThisWeek: "244 min (mcp-bafee4e8-3acf-4028-906a-5b59a28b083c)",
    witness: reverseTimestamps,
    witnessIs: "the day's timestamps dealt back out in reverse",
  },
  {
    ask: "Q3. When a call failed, how often did that session's very next call retry the same tool?",
    wouldNeed: "the order of the calls within a session; the view keeps per-tool totals",
    answer: (events) => {
      let failures = 0;
      let retried = 0;
      for (const calls of bySession(events).values()) {
        for (let i = 0; i < calls.length; i++) {
          if (calls[i].ok) continue;
          failures++;
          if (calls[i + 1]?.tool === calls[i].tool) retried++;
        }
      }
      return `${retried} of ${failures} failures`;
    },
    onThisWeek: "15 of 18 failures",
    witness: reverseTimestamps,
    witnessIs: "the day's timestamps dealt back out in reverse",
  },
  {
    ask: "Q4. How many node files did more than one session touch in the week?",
    wouldNeed: "the node files a call reached; the view holds no filename anywhere",
    answer: (events) => {
      const sessionsPerFile = new Map<string, Set<string>>();
      for (const e of events)
        for (const file of filesOf(e)) {
          const s = sessionsPerFile.get(file) ?? new Set<string>();
          s.add(e.session ?? "(unattributed)");
          sessionsPerFile.set(file, s);
        }
      const shared = [...sessionsPerFile.values()].filter((s) => s.size > 1).length;
      return `${shared} of ${sessionsPerFile.size} files`;
    },
    onThisWeek: "21 of 157 files",
    witness: reverseFileLists,
    witnessIs: "the week's file lists dealt back out in reverse",
  },
  {
    ask: "Q5. What share of the week's in-call wall-clock went to the single most expensive tool?",
    wouldNeed: "duration grouped by tool; the view keeps p50 and max over the whole day",
    answer: (events) => {
      const msPerTool = new Map<string, number>();
      for (const e of events) msPerTool.set(e.tool, (msPerTool.get(e.tool) ?? 0) + e.ms);
      const total = [...msPerTool.values()].reduce((a, b) => a + b, 0);
      const [tool, ms] = [...msPerTool.entries()].sort((a, b) => b[1] - a[1])[0];
      return `${tool}, ${((100 * ms) / total).toFixed(1)}% of ${total}ms`;
    },
    onThisWeek: "ost_read_tree, 53.2% of 110973ms",
    witness: reverseDurations,
    witnessIs: "the day's durations dealt back out in reverse",
  },
];

describe("the week under test is the one PROVENANCE.md describes", () => {
  test("seven consecutive finished days, every event kept, one of them empty", () => {
    expect(WEEK.length).toBe(MANIFEST.weekEvents);
    expect(MANIFEST.window.days).toHaveLength(7);
    expect(MANIFEST.perDay[MANIFEST.window.first]).toBeGreaterThan(0);
    // A real week has a dead day in it. It is a zero rather than an absence on purpose:
    // "no events" and "no such day" are different facts about a window.
    expect(Object.values(MANIFEST.perDay).filter((n) => n === 0)).toHaveLength(1);
    expect(Object.values(MANIFEST.perDay).reduce((a, b) => a + b, 0)).toBe(WEEK.length);
    for (const e of WEEK) {
      expect(dayOf(e) >= MANIFEST.window.first).toBe(true);
      expect(dayOf(e) <= MANIFEST.window.last).toBe(true);
    }
  });

  test("the derived summary covers every day that had events, and nothing else", () => {
    const views = viewsOf(WEEK);
    expect(views.map((v) => v.day)).toEqual(Object.keys(MANIFEST.perDay).filter((d) => MANIFEST.perDay[d] > 0));
    expect(views.reduce((n, v) => n + v.calls, 0)).toBe(WEEK.length);
  });
});

describe("five questions, asked of the raw week and of the summary derived from it", () => {
  for (const q of QUESTIONS) {
    test(q.ask, () => {
      // 1. Raw answers it, and the answer is the one this week actually gives. Pinned
      //    rather than merely non-empty: the finding is the point of the replay, and a
      //    test that only asserted "something came back" would not hold one.
      expect(q.answer(WEEK)).toBe(q.onThisWeek);

      // 2. The witness week summarises identically. If this fails the witness is
      //    illegitimate — it changed something the rollup can see — and the question is
      //    not demonstrated, whatever step 3 says.
      const other = q.witness(WEEK);
      expect(other).toHaveLength(WEEK.length);
      expect(viewsOf(other)).toEqual(viewsOf(WEEK));

      // 3. …and answers differently. Two weeks, one summary, two answers: the summary
      //    is not carrying this one.
      expect(q.answer(other)).not.toBe(q.answer(WEEK));
    });
  }

  test("the pre-committed bar: at least three of five answerable from raw and not from the rollup", () => {
    const rawOnly = QUESTIONS.filter((q) => {
      const other = q.witness(WEEK);
      return (
        JSON.stringify(viewsOf(other)) === JSON.stringify(viewsOf(WEEK)) && q.answer(other) !== q.answer(WEEK)
      );
    });
    expect(rawOnly.length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * The other half of the measurement, and the half that keeps it honest.
 *
 * Five questions the summary cannot answer proves nothing if the summary answers
 * nothing. These three are answered from the derived views ALONE — the raw events are
 * used only to check the view got them right — so a `DailyUsageView` that had been
 * hollowed out to make the five above look good would fail here instead.
 */
describe("the rollup is not a stub: three control questions it does answer", () => {
  const views = viewsOf(WEEK);

  test("how many calls did the busiest day carry?", () => {
    const fromView = Math.max(...views.map((v) => v.calls));
    const fromRaw = Math.max(...Object.values(MANIFEST.perDay));
    expect(fromView).toBe(fromRaw);
    expect(fromView).toBe(356);
  });

  test("which tool was called most often across the week?", () => {
    const totals = new Map<string, number>();
    for (const v of views) for (const row of v.byTool) totals.set(row.name, (totals.get(row.name) ?? 0) + row.calls);
    const fromView = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
    const raw = new Map<string, number>();
    for (const e of WEEK) raw.set(e.tool, (raw.get(e.tool) ?? 0) + 1);
    expect(fromView).toEqual([...raw.entries()].sort((a, b) => b[1] - a[1])[0]);
    expect(fromView[0]).toBe("ost_read_tree");
  });

  test("how many calls failed across the week, and how many of those were refusals?", () => {
    const failed = views.reduce((n, v) => n + v.failed, 0);
    const denied = views.reduce((n, v) => n + v.denied, 0);
    expect(failed).toBe(WEEK.filter((e) => !e.ok && !e.denied).length);
    expect(denied).toBe(WEEK.filter((e) => e.denied).length);
    expect([failed, denied]).toEqual([18, 0]);
  });
});
