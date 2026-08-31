/**
 * The recurrence rule: a friction shape that comes back across sessions files an
 * evidence record, and a single incident is counted instead.
 *
 * This is the sibling candidate to {@link ./friction-surface.js}, judged on the
 * same corpus so the two can be compared. Where the surface rule asks *whose tool
 * failed*, this one asks *how often this shape of failure has come back*: an error
 * that appears in one session is held as a number, and an error whose shape appears
 * in {@link RECURRENCE_RULE.minSessions} or more distinct sessions becomes one
 * record carrying its count and the span it recurred over. The unit of filing
 * changes with it — the surface rule files *sessions*, this one files *shapes*, and
 * a pass reads four rows instead of twenty-nine.
 *
 * ## The grouping clause is the hard half, and it decides everything
 *
 * Ten sessions saying `(eval):1: == not found` are the same string, and any rule
 * that deduplicates collapses them. The thirteen blocked sleep-then-poll refusals
 * are the case that matters: **all fifteen of those events are distinct strings**,
 * because the harness's message embeds the sleep duration and the whole command
 * that followed it. A rule that filed those as thirteen records would have shown
 * that identical strings are detectable, not that repetition is.
 *
 * So a shape is the **head** of the message after its arguments are redacted, not
 * the whole of it:
 *
 * ```
 * Blocked: sleep 45 followed by: gh pr checks 8 | head -10. To wait for a …
 * Blocked: sleep 240 followed by: git status --porcelain | wc -l; ls /Users/…
 *          ↓ redact numbers, paths, urls, ids; keep the first 5 tokens
 * blocked: sleep <n> followed by:
 * ```
 *
 * The head rather than the tail for a reason the corpus makes concrete: the
 * harvester clips each detail at roughly two hundred characters, so the invariant
 * instruction *after* the embedded command survives in twelve of those fifteen
 * events and is eaten by a long path in the rest. The variable part of a tool error
 * is its payload and the payload comes last, which is also where the truncation
 * bites. Keying on the head is what makes the two agree.
 *
 * The prefix length is the whole rule and it is not free — at six tokens the key
 * reaches `gh` and the same thirteen sessions split into twelve plus one. The
 * reading is therefore reported with a {@link RecurrenceReplay.sensitivity} table
 * across both knobs, so nobody has to take the setting on trust.
 *
 * ## What a green run here does and does not settle
 *
 * It settles that repetition is mechanically detectable on material where the
 * repeated events are not the same string, and that the rule files few enough
 * records for a pass to read them all. It settles nothing about whether repetition
 * is a good proxy for *significance* — {@link RECURRENCE_RULE.refuses} — and the
 * corpus is blunt about the cost: of the five records the pass judged to carry a
 * product need, this rule's filed shapes cover two.
 */
import fs from "node:fs";
import path from "node:path";
import { parseFrictionRecord, type FrictionRecord, type JudgedRecord, type RecordEvent } from "./friction-surface.js";

/** The rule's two knobs, and the bar the assumption test fixed before the replay. */
export const RECURRENCE_RULE = {
  /**
   * Distinct sessions a shape must appear in before it files. Three rather than
   * two on the ordinary reading — twice is a coincidence — and the choice is
   * load-bearing: at two, this corpus files thirteen records and blows the bar.
   */
  minSessions: 3,

  /**
   * Tokens of the redacted head that make up a shape key. Five is the longest
   * prefix that still groups the thirteen blocked refusals as one; at six the key
   * reaches into the embedded command and splits them.
   */
  prefixTokens: 5,

  /** Records the pass judged to carry a product need, and the ones it did not. */
  needs: 5,
  nonNeeds: 24,

  /** "Files five or fewer records in total" — the assumption test's count clause. */
  filedBar: 5,

  /**
   * The number of records {@link filedBar} was fixed over.
   *
   * A count bar is a bar over a population. Run against the live vault this rule
   * files sixty shapes out of five hundred records, and printing "bar is 5, NOT
   * MET" there would report the rule refuted to anyone who pointed it at a corpus
   * the bar was never stated for — the sibling census's mistake, one clause along.
   */
  barPopulation: 29,

  /**
   * The clause this module refuses. Named rather than omitted, because a replay
   * reporting only the filed count would read as settling the comparison it feeds.
   */
  refuses:
    "whether repetition is a proxy for significance — a failure that happened once and cost a day is counted by this rule and never filed",
} as const;

/** Whether a shape reached the bar. `held` is counted, never discarded. */
export type ShapeDisposition = "filed" | "held";

/** How a corpus was grouped. `identity` is the control: exact strings only. */
export type Grouping = "shape" | "identity";

/** One harvested record, plus the timestamp the span is measured on. */
export interface RecurrenceRecord extends FrictionRecord {
  /** ISO timestamp from the record's frontmatter, or `""` when it carried none. */
  timestamp: string;
}

/** When a shape recurred, over the records that carry a readable timestamp. */
export interface ShapeSpan {
  first: string;
  last: string;
  /** Elapsed days between them, one decimal. Zero for a shape inside one day. */
  days: number;
  /** Members whose record carried no readable timestamp, so the span omits them. */
  undated: number;
}

/** One shape of friction, and everything the rule knows about its recurrence. */
export interface FrictionShape {
  /** `<kind>|<tool>|<redacted head>` — the grouping key, printable on purpose. */
  key: string;
  kind: string;
  tool: string;
  /** The redacted head the key was cut from, in the words a reader can check. */
  prefix: string;
  /** Events in this shape, across every record. */
  events: number;
  /** The distinct records it appeared in, sorted. The recurrence count. */
  sessions: string[];
  /**
   * How many distinct detail strings the shape holds. `1` means plain string
   * deduplication would have found this group too; anything above it is grouping
   * the identity control cannot do.
   */
  distinctDetails: number;
  /** Null when no member's record carried a timestamp. */
  span: ShapeSpan | null;
  /** One member's detail, verbatim, so a filed row can be read back to its source. */
  example: string;
  disposition: ShapeDisposition;
}

/** The rule's reading of a corpus. */
export interface RecurrenceReading {
  minSessions: number;
  prefixTokens: number;
  grouping: Grouping;
  /** Records read, and failing events in them. */
  records: number;
  events: number;
  /** Every shape, filed first, each side ordered by recurrence then volume. */
  shapes: FrictionShape[];
  filed: FrictionShape[];
  held: FrictionShape[];
  /** Events on each side. The two sum to {@link events}: nothing is discarded. */
  filedEvents: number;
  heldEvents: number;
  /** Records with at least one event in a filed shape. */
  coveredRecords: string[];
  /** Records whose every event was held, plus the ones with no failing call. */
  uncoveredRecords: string[];
  /** Records with no failing call at all — held, but not *demoted*. */
  nothingToJudge: string[];
}

/** One row of the knob sweep, so neither setting has to be taken on trust. */
export interface SensitivityRow {
  minSessions: number;
  prefixTokens: number;
  filed: number;
  needsCovered: number;
  meetsCountBar: boolean;
}

export interface RecurrenceReplay {
  reading: RecurrenceReading;
  /** Judgement rows supplied. Zero means the rule was asked to read, not to score. */
  judged: number;
  /** Records the judgement covers but the corpus does not hold, and the reverse. */
  missing: string[];
  unjudged: string[];
  /** Judged needs a filed shape reaches, and the ones no filed shape reaches. */
  needsCovered: string[];
  needsMissed: string[];
  /** Non-needs a filed shape reaches. Not false positives — they cost no record. */
  nonNeedsCovered: string[];
  /** Records a pass must read: one per filed shape, not one per session. */
  filedRecords: number;
  /** The count clause of the assumption test: five or fewer records filed. */
  meetsCountBar: boolean;
  /**
   * Whether the corpus read is the one {@link RECURRENCE_RULE.filedBar} was fixed
   * over. False makes {@link meetsCountBar} a comparison against somebody else's
   * population, and the report says the count instead of scoring it.
   */
  barApplies: boolean;
  /**
   * What plain deduplication would have filed at the same bar. The control: a rule
   * that only collapses identical strings is not a recurrence rule.
   */
  identityFiled: number;
  sensitivity: SensitivityRow[];
}

// ── reading the corpus ───────────────────────────────────────────────────────

const FRONTMATTER_TIMESTAMP = /^timestamp:\s*'?([^'\n]+?)'?\s*$/m;

/** The `timestamp:` a harvested record carries, or `""` when it carries none. */
export function timestampOf(body: string): string {
  return FRONTMATTER_TIMESTAMP.exec(body)?.[1]?.trim() ?? "";
}

/**
 * Every harvested record in a folder, with its timestamp. A missing folder reads
 * as none.
 *
 * The parse is {@link parseFrictionRecord}'s, deliberately: the two candidate
 * rules must read the same bytes the same way, or a difference in what they file
 * is a difference in their readers.
 */
export function readRecurrenceRecords(dir: string): RecurrenceRecord[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const records: RecurrenceRecord[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    let body: string;
    try {
      body = fs.readFileSync(path.join(dir, name), "utf8");
    } catch {
      continue; // an unreadable file costs one record, never the reading
    }
    const record = parseFrictionRecord(name, body);
    if (record) records.push({ ...record, timestamp: timestampOf(body) });
  }
  return records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ── the shape of an error ────────────────────────────────────────────────────

const HARNESS_WRAPPER = /<\/?tool_use_error>/g;
const EXIT_CODE_PREFIX = /^\s*Exit code \d+\s*(?:…|\.\.\.)?\s*/i;
const URL = /https?:\/\/\S+/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * Strip a detail down to the part that is about the failure rather than about
 * this run of it.
 *
 * What is redacted is what a second occurrence would change: the exit code and
 * the harness's own wrapper, then urls, session ids, anything path- or
 * glob-shaped, and every number. What is left is the template the tool printed.
 */
export function redactArguments(detail: string): string {
  const stripped = detail.replace(HARNESS_WRAPPER, " ").replace(URL, "<url>").replace(UUID, "<id>").replace(EXIT_CODE_PREFIX, " ").trim();
  return stripped
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (/[/*]/.test(token) ? "<path>" : token.replace(/\d+/g, "<n>")))
    .join(" ");
}

/**
 * The head of a redacted detail — the first `n` tokens, lowercased.
 *
 * The head and not the whole, because the invariant part of a tool error comes
 * first and the harvester clips the rest. See the module comment.
 */
export function shapePrefix(detail: string, prefixTokens: number): string {
  return redactArguments(detail).split(" ").filter(Boolean).slice(0, prefixTokens).join(" ").toLowerCase();
}

/** The grouping key for one event, under either grouping. */
export function shapeKeyOf(event: RecordEvent, prefixTokens: number, grouping: Grouping = "shape"): string {
  const head = grouping === "identity" ? event.detail.trim().toLowerCase() : shapePrefix(event.detail, prefixTokens);
  return `${event.kind}|${event.tool}|${head}`;
}

// ── the rule ─────────────────────────────────────────────────────────────────

function spanOf(timestamps: readonly string[], undatedMembers: number): ShapeSpan | null {
  const dated = timestamps.filter((t) => t && !Number.isNaN(Date.parse(t))).sort();
  if (dated.length === 0) return null;
  const first = dated[0];
  const last = dated[dated.length - 1];
  const days = Math.round(((Date.parse(last) - Date.parse(first)) / 86_400_000) * 10) / 10;
  return { first, last, days, undated: undatedMembers };
}

export interface ReadingOptions {
  minSessions?: number;
  prefixTokens?: number;
  grouping?: Grouping;
}

/**
 * Run the rule over a corpus.
 *
 * Recurrence is counted in **distinct records**, never in events: nine copies of
 * the same slip inside one session are one incident that repeated, which is
 * exactly what this rule declines to file.
 */
export function recurrenceReading(records: readonly RecurrenceRecord[], options: ReadingOptions = {}): RecurrenceReading {
  const minSessions = options.minSessions ?? RECURRENCE_RULE.minSessions;
  const prefixTokens = options.prefixTokens ?? RECURRENCE_RULE.prefixTokens;
  const grouping = options.grouping ?? "shape";

  interface Bucket {
    kind: string;
    tool: string;
    prefix: string;
    events: number;
    sessions: Set<string>;
    details: Set<string>;
    timestamps: string[];
    undated: number;
    example: string;
  }
  const buckets = new Map<string, Bucket>();
  let events = 0;

  for (const record of records) {
    for (const event of record.events) {
      events++;
      const key = shapeKeyOf(event, prefixTokens, grouping);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          kind: event.kind,
          tool: event.tool,
          prefix: grouping === "identity" ? event.detail.trim() : shapePrefix(event.detail, prefixTokens),
          events: 0,
          sessions: new Set(),
          details: new Set(),
          timestamps: [],
          undated: 0,
          example: event.detail,
        };
        buckets.set(key, bucket);
      }
      bucket.events++;
      bucket.sessions.add(record.id);
      bucket.details.add(event.detail);
      if (record.timestamp) bucket.timestamps.push(record.timestamp);
      else bucket.undated++;
    }
  }

  const shapes: FrictionShape[] = [...buckets.entries()]
    .map(([key, b]) => ({
      key,
      kind: b.kind,
      tool: b.tool,
      prefix: b.prefix,
      events: b.events,
      sessions: [...b.sessions].sort(),
      distinctDetails: b.details.size,
      span: spanOf(b.timestamps, b.undated),
      example: b.example,
      disposition: (b.sessions.size >= minSessions ? "filed" : "held") as ShapeDisposition,
    }))
    .sort(
      (a, b) =>
        Number(b.disposition === "filed") - Number(a.disposition === "filed") ||
        b.sessions.length - a.sessions.length ||
        b.events - a.events ||
        (a.key < b.key ? -1 : 1),
    );

  const filed = shapes.filter((s) => s.disposition === "filed");
  const held = shapes.filter((s) => s.disposition === "held");
  const covered = new Set(filed.flatMap((s) => s.sessions));

  return {
    minSessions,
    prefixTokens,
    grouping,
    records: records.length,
    events,
    shapes,
    filed,
    held,
    filedEvents: filed.reduce((n, s) => n + s.events, 0),
    heldEvents: held.reduce((n, s) => n + s.events, 0),
    coveredRecords: records.filter((r) => covered.has(r.id)).map((r) => r.id),
    uncoveredRecords: records.filter((r) => !covered.has(r.id)).map((r) => r.id),
    nothingToJudge: records.filter((r) => r.events.length === 0).map((r) => r.id),
  };
}

/** The knobs the sensitivity table sweeps, either side of the shipped setting. */
const SENSITIVITY_MIN_SESSIONS = [2, 3, 4, 5];
const SENSITIVITY_PREFIX_TOKENS = [4, 5, 6];

function needsCoveredBy(reading: RecurrenceReading, judgement: readonly JudgedRecord[]): string[] {
  const covered = new Set(reading.coveredRecords);
  return judgement.filter((j) => j.need && covered.has(j.id)).map((j) => j.id);
}

/**
 * Score the rule against a judgement made before it existed.
 *
 * The judgement is supplied rather than derived, for the reason the surface rule
 * gives: deriving "carries a product need" from the record means grading one guess
 * with another. The two rules take the identical file.
 *
 * Note what is *not* scored here. The surface rule has a drop clause because it
 * demotes sessions one at a time; this rule changes the unit, so a non-need inside
 * a filed shape costs a pass nothing — it is a tick in a count, not a record to
 * read. {@link RecurrenceReplay.filedRecords} is the cost, and the bar is over it.
 */
export function recurrenceReplay(
  records: readonly RecurrenceRecord[],
  judgement: readonly JudgedRecord[],
  options: ReadingOptions = {},
): RecurrenceReplay {
  const reading = recurrenceReading(records, options);
  const byId = new Map(records.map((r) => [r.id, r]));
  const judged = new Map(judgement.map((j) => [j.id, j]));
  const covered = new Set(reading.coveredRecords);

  const inCorpus = judgement.filter((j) => byId.has(j.id));
  const sensitivity: SensitivityRow[] = [];
  for (const prefixTokens of SENSITIVITY_PREFIX_TOKENS) {
    for (const minSessions of SENSITIVITY_MIN_SESSIONS) {
      const swept = recurrenceReading(records, { ...options, minSessions, prefixTokens });
      sensitivity.push({
        minSessions,
        prefixTokens,
        filed: swept.filed.length,
        needsCovered: needsCoveredBy(swept, inCorpus).length,
        meetsCountBar: swept.filed.length <= RECURRENCE_RULE.filedBar,
      });
    }
  }

  return {
    reading,
    judged: judgement.length,
    missing: judgement.filter((j) => !byId.has(j.id)).map((j) => j.id),
    unjudged: records.filter((r) => !judged.has(r.id)).map((r) => r.id),
    needsCovered: inCorpus.filter((j) => j.need && covered.has(j.id)).map((j) => j.id),
    needsMissed: inCorpus.filter((j) => j.need && !covered.has(j.id)).map((j) => j.id),
    nonNeedsCovered: inCorpus.filter((j) => !j.need && covered.has(j.id)).map((j) => j.id),
    filedRecords: reading.filed.length,
    meetsCountBar: reading.filed.length <= RECURRENCE_RULE.filedBar,
    barApplies: records.length === RECURRENCE_RULE.barPopulation,
    identityFiled: recurrenceReading(records, { ...options, grouping: "identity" }).filed.length,
    sensitivity,
  };
}

// ── the report ───────────────────────────────────────────────────────────────

/** How many ids a line names before it says how many more there are. */
export const MAX_IDS_SHOWN = 8;

function sample(ids: readonly string[]): string {
  if (ids.length <= MAX_IDS_SHOWN) return ids.join(", ");
  return `${ids.slice(0, MAX_IDS_SHOWN).join(", ")} … and ${ids.length - MAX_IDS_SHOWN} more`;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

/** `3rd`, `4th`, `21st` — the report says which session a held shape is waiting for. */
export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** One filed shape as a row: what it is, how often, over how long. */
export function formatShape(shape: FrictionShape): string {
  const span = shape.span
    ? `${day(shape.span.first)} → ${day(shape.span.last)} (${shape.span.days}d)`
    : "span unknown — no member carried a timestamp";
  const strings = shape.distinctDetails === 1 ? "1 distinct string" : `${shape.distinctDetails} distinct strings`;
  return `  ${shape.sessions.length} session(s), ${shape.events} event(s), ${strings} — ${span}\n    ${shape.tool || "(unnamed)"} · ${shape.kind} · "${shape.prefix}"`;
}

/**
 * The replay as an operator reads it: what was filed, what is being held, then the
 * two knobs, then what the reading cannot settle.
 *
 * The refusal prints on a met bar too. A report ending on "BAR MET" would read as
 * repetition having been shown to track significance, which is the assumption
 * underneath this rule and is not what any count here measures.
 */
export function formatRecurrenceReplay(replay: RecurrenceReplay): string {
  const { reading } = replay;
  const lines: string[] = [];

  lines.push(
    `Read: ${reading.records} record(s), ${reading.events} failing event(s) → ${reading.shapes.length} shape(s) — ` +
      `${reading.filed.length} filed, ${reading.held.length} held, 0 discarded.`,
  );
  if (replay.missing.length > 0) lines.push(`Judged but absent from the corpus: ${sample(replay.missing)}.`);
  if (replay.judged > 0 && replay.unjudged.length > 0) lines.push(`In the corpus and unjudged: ${sample(replay.unjudged)}.`);

  if (reading.filed.length === 0) {
    lines.push(`Filed: (none) — no shape reached ${reading.minSessions} distinct session(s).`);
  } else {
    lines.push(`Filed (${reading.filedEvents} event(s) across ${reading.coveredRecords.length} record(s)):`);
    for (const shape of reading.filed) lines.push(formatShape(shape));
  }
  lines.push(
    `Held, not discarded: ${reading.held.length} shape(s), ${reading.heldEvents} event(s) — each one counted and ` +
      `waiting for a ${ordinal(reading.minSessions)} session to bring it back.`,
  );
  if (reading.nothingToJudge.length > 0) {
    lines.push(`  of the records read, ${reading.nothingToJudge.length} held no failing call at all: ${sample(reading.nothingToJudge)}.`);
  }

  // A count bar is a bar over a population. Scored only against the corpus it was
  // stated for; anywhere else the count is reported and the bar is named, because
  // "NOT MET" over a vault twenty times the size is a verdict nobody fixed.
  lines.push(
    replay.barApplies
      ? `Records a pass must read: ${replay.filedRecords} — bar is ${RECURRENCE_RULE.filedBar}, ${replay.meetsCountBar ? "MET" : "NOT MET"}.`
      : `Records a pass must read: ${replay.filedRecords}. Not scored against the bar of ${RECURRENCE_RULE.filedBar}: ` +
        `that was fixed over the ${RECURRENCE_RULE.barPopulation}-record corpus and this reading is over ${reading.records}.`,
  );
  lines.push(
    `Grouping, not deduplication: exact-string grouping at the same bar would file ${replay.identityFiled}, ` +
      `and would miss every shape whose repeats are worded differently.`,
  );

  if (replay.judged === 0) {
    lines.push(
      `Not scored: no record was judged. Supply a judgement to read how many of the ${RECURRENCE_RULE.needs} needs the ` +
        `filed shapes reach. What is above is what the rule would file, not whether it should have.`,
    );
  } else {
    lines.push(
      `Needs reached by a filed shape: ${replay.needsCovered.length}/${replay.needsCovered.length + replay.needsMissed.length}` +
        (replay.needsMissed.length > 0 ? ` — missed: ${sample(replay.needsMissed)}` : ""),
    );
  }

  // The needs column is dropped when nothing was judged, for the reason the line
  // above it is: `98/0` reads as "reached none of them", not as "nobody said".
  lines.push(
    `Sensitivity (filed records${replay.judged > 0 ? " / needs reached" : ""}), by minimum sessions and shape-prefix tokens:`,
  );
  for (const prefixTokens of SENSITIVITY_PREFIX_TOKENS) {
    const row = replay.sensitivity.filter((r) => r.prefixTokens === prefixTokens);
    lines.push(
      `  ${prefixTokens} token(s): ` +
        row.map((r) => `≥${r.minSessions} sessions → ${r.filed}${replay.judged > 0 ? `/${r.needsCovered}` : ""}`).join("   "),
    );
  }

  lines.push(`Not settled: ${RECURRENCE_RULE.refuses}.`);
  return lines.join("\n");
}
