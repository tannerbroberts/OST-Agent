/**
 * The friction signature: what makes two refusals the same *observation*, so the
 * queue can carry one entry with a count instead of one entry per occurrence.
 *
 * The unmapped queue in this vault is mostly repetition. 545 of the harvested
 * `File has not been read yet` events sit across 271 records, and a pass reading
 * that queue reads the same sentence 545 times. The claim this module implements
 * is deliberately small and mechanical: **two byte-similar refusals are the same
 * observation**, whatever session or path they came from. It says nothing about
 * needs, and a group of 545 is 545 sightings of one shape, never 545 needs.
 *
 * ## The two settings that decide everything, and why they are what they are
 *
 * The candidate this implements described a signature as "tool name plus the
 * normalised refusal text". Against the corpus that description is wrong in its
 * first clause, and the corpus is what says so:
 *
 * ```
 * - **tool_error** (Edit):  <tool_use_error>File has not been read yet. Read it first…
 * - **tool_error** (Write): <tool_use_error>File has not been read yet. Read it first…
 * - **tool_error**:         <tool_use_error>File has not been read yet. Read it first…
 * ```
 *
 * Three emitting tools, one refusal, 545 events. A key that includes the emitting
 * tool splits the corpus's largest single shape into three groups and fails the
 * collapse half of the bar by construction. So:
 *
 * 1. **The emitting tool is not in the key.** It is carried on the group as
 *    {@link SignatureGroup.tools}, because losing it would be a loss, but it does
 *    not decide identity.
 * 2. **Identifiers *inside* the message are preserved.** That is the only thing
 *    left keeping refusals apart once (1) drops the tool, and it is enough:
 *    `Claude requested permissions to use mcp__ost-agent__ost_check` names its
 *    subject in its own text. Eight distinct capabilities are denied in this
 *    corpus and all eight stay apart.
 *
 * What IS stripped is what a second occurrence of the same failure would change:
 * the harness's wrapper, an exit-code preamble, urls, uuids, path-shaped tokens
 * and numbers. Nothing else. The candidate's stated failure mode — "strip too
 * much and two genuinely different refusals collapse into one entry, and the tree
 * loses the fact that two distinct capabilities were withheld" — is avoided by
 * stripping *shapes of argument* rather than *stretches of text*: a capability
 * name is not path-shaped and carries no digit, so it survives every rule here.
 *
 * ## The adjacency this was most at risk on
 *
 * The corpus holds two differently-worded permission denials, and the path one is
 * the larger:
 *
 * ```
 * Claude requested permissions to use mcp__ost-agent__ost_check, but you haven't…   95 events
 * Claude requested permissions to read from /Users/tanner/dev/OST-Agent, but you…  154 events
 * ```
 *
 * A normaliser that strips paths turns the second into `…to read from <path>, but
 * you haven't…`, which is one group across every denied directory — correct, they
 * are one withheld permission observed at different depths — and which is NOT the
 * first, because the sentence differs before the path begins. Both halves of that
 * are asserted in `test/adapters/friction-signature.test.ts` against strings taken
 * verbatim from the corpus.
 *
 * ## Where dropping the tool DOES over-collapse, and the one exception it forced
 *
 * The first run of this rule over the whole corpus put its largest row at
 * **582 `retry` events across 251 sessions, one distinct string: `{}`** — and it
 * had folded five different tools into it (`CronList`, `ost_ingest_inbox`,
 * `ost_next_work`, and two plugin-prefixed spellings of the same). That row is
 * wrong, and it is wrong for a reason (1) makes inevitable: a `retry` detail is
 * the tool's own *input* serialised as JSON, not a message the tool printed, so
 * it never names its subject. Argument (2) — "the message names what it is
 * about" — simply does not hold for a payload.
 *
 * So the rule has one exception, and it is stated as the condition rather than as
 * a list of kinds: **a detail that is a serialised payload keys on the emitting
 * tool; a detail that is printed text does not.** See {@link isPayload}. That
 * splits the `{}` row back into five and leaves both halves of the bar untouched,
 * because every string in either family is printed text.
 *
 * ## What a green run here does not settle
 *
 * That the groups correspond to needs. Grouping identical refusals is a claim
 * about strings; the opportunity above this is a claim about needs, and nothing
 * here bridges it. Nor does it clear the backlog: four grouped items are still
 * four unmapped items. See {@link FRICTION_SIGNATURE_RULE.refuses}.
 */
import type { RecordEvent } from "../telemetry/friction-surface.js";

/** The rule, its measured subject, and the clause it refuses. */
export const FRICTION_SIGNATURE_RULE = {
  /**
   * Whether the emitting tool is part of the key. Only for a serialised payload,
   * which cannot name its own subject — see {@link isPayload} and the module
   * comment. For printed text it is not, and that is the decision the whole rule
   * turns on.
   */
  keyIncludesEmittingTool: "only for payload details" as const,

  /**
   * The corpus this was fixed over: `.ost-agent/evidence/` in the OST-Agent meta
   * vault on 2026-09-02, 686 harvested records.
   *
   * Recorded so a later reading can tell "the rule changed" from "the corpus
   * grew". The candidate's own census, taken 2026-08-28 over 458 records, is
   * already out of date by these numbers and was wrong about their split — it
   * reported 209 permission-denial events as the `to use X` wording, where the
   * majority of that family is the `read from <path>` wording instead.
   */
  corpus: {
    records: 686,
    /**
     * What the shipped setting reads off that corpus: 2473 friction events fold
     * into 608 rows, where exact-string grouping leaves 785. The compression is
     * concentrated, not spread — the top row alone is 545 events.
     */
    events: 2473,
    rows: 608,
    identityRows: 785,
    /** `File has not been read yet` — the largest single shape, across 271 records. */
    readBeforeWriteEvents: 545,
    /** Emitting tools that produce it: `Edit`, `Write`, and one event naming none. */
    readBeforeWriteTools: 3,
    /** `requested permissions to use <capability>` — 95 events, 8 distinct capabilities. */
    capabilityDenialEvents: 95,
    capabilityDenialNames: 8,
    /** `requested permissions to read from <path>` — 154 events, one shape. */
    pathDenialEvents: 154,
    /**
     * `retry` events whose serialised input is the empty object `{}` — 582 across
     * 251 records, from 5 distinct tools. The row that forced {@link isPayload}:
     * without the exception this is the corpus's largest group and it is five
     * different observations wearing one string.
     */
    emptyPayloadRetries: 582,
    emptyPayloadRetryTools: 5,
  },

  /**
   * The clause this module refuses. Named rather than omitted, because a queue
   * that printed `545×` beside one line would read as a measured need.
   */
  refuses:
    "whether a group corresponds to a need — the count says how often a string came back, never how much it cost or whether anyone wants it fixed",
} as const;

// ── normalising one refusal ──────────────────────────────────────────────────

/** The harness's own wrapper around a tool error. Not part of what failed. */
const HARNESS_WRAPPER = /<\/?tool_use_error>/g;
/** `Exit code 1 …` — the run's outcome, not the shape of the failure. */
const EXIT_CODE_PREFIX = /^\s*Exit code \d+\s*(?:…|\.\.\.)?\s*/i;
const URL = /https?:\/\/\S+/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * A token that is an argument rather than part of the sentence: anything
 * path- or glob-shaped, or anything carrying a digit.
 *
 * Deliberately narrow. A capability name — `mcp__ost-agent__ost_check`,
 * `WebFetch`, `ost_read_repo` — matches neither test and is therefore preserved
 * verbatim, which is what keeps eight withheld capabilities from becoming one
 * entry once the emitting tool leaves the key.
 */
function redactToken(token: string): string {
  if (/[/*~]/.test(token) || token.startsWith(".") || token.includes("\\")) return "<path>";
  return token.replace(/\d+/g, "<n>");
}

/**
 * Reduce one refusal to the template the tool printed — its signature body.
 *
 * Case- and whitespace-folded, so `Blocked:` and `blocked:` are one shape, and
 * trailing sentence punctuation is kept: it is part of the template, and dropping
 * it buys nothing while risking a merge of two sentences that differ only there.
 */
export function normaliseRefusal(detail: string): string {
  const stripped = detail
    .replace(HARNESS_WRAPPER, " ")
    .replace(URL, "<url>")
    .replace(UUID, "<id>")
    .replace(EXIT_CODE_PREFIX, " ")
    .trim();
  return stripped.split(/\s+/).filter(Boolean).map(redactToken).join(" ").toLowerCase();
}

/**
 * Whether a detail is a serialised payload rather than something a tool printed.
 *
 * The harvester records a `retry` event's detail as the tool's own input as JSON,
 * which is how `{}` came to be the most repeated "message" in the corpus. A
 * payload describes the call, not the failure, so it cannot identify its own
 * subject and the emitting tool has to supply that.
 *
 * Tested on the raw detail, before normalisation, because normalisation would
 * have rewritten the braces' contents but never the braces.
 */
export function isPayload(detail: string): boolean {
  const trimmed = detail.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

/**
 * The grouping key for one friction event.
 *
 * `<kind>|<normalised text>` for printed text, and `<kind>|<tool>|<normalised
 * payload>` for a serialised one. The kind always stays in — a `retry` on a
 * string and a `tool_error` with the same text are different observations of it.
 * See the module comment for why the emitting tool is otherwise kept out, and
 * what running the rule over the whole corpus said about the exception.
 */
export function frictionSignature(event: Pick<RecordEvent, "kind" | "tool" | "detail">): string {
  const body = normaliseRefusal(event.detail);
  return isPayload(event.detail) ? `${event.kind}|${event.tool}|${body}` : `${event.kind}|${body}`;
}

// ── grouping a queue ─────────────────────────────────────────────────────────

/** One occurrence, as a caller hands it over: an event plus where it was seen. */
export interface SignatureOccurrence {
  kind: string;
  /** The tool that emitted it, or `""`. Carried, never keyed on. */
  tool: string;
  detail: string;
  /** The record or session it was seen in. Distinct values are the recurrence count. */
  session: string;
}

/** One queue entry: a shape, how often it was seen, and where. */
export interface SignatureGroup {
  /** `<kind>|<normalised refusal>` — printable on purpose, so a row can be checked. */
  signature: string;
  kind: string;
  /** The redacted template, in the words a reader can compare against the example. */
  template: string;
  /** Occurrences folded into this entry. The count the queue entry carries. */
  count: number;
  /** Distinct sessions it came from, sorted. */
  sessions: string[];
  /** Distinct emitting tools, sorted. More than one is the rule doing its job. */
  tools: string[];
  /**
   * Distinct verbatim details folded in. `1` means exact-string deduplication
   * would have found this group too; above 1 is grouping identity cannot do.
   */
  distinctDetails: number;
  /** One occurrence's detail, verbatim, so the entry reads back to its source. */
  example: string;
}

/** What a grouping cost the reader, and what it did not lose. */
export interface SignatureGrouping {
  occurrences: number;
  groups: SignatureGroup[];
  /**
   * Rows a pass reads after grouping — `groups.length`. The queue's length, and
   * the number the candidate is about.
   */
  rows: number;
  /** Groups holding more than one occurrence. The ones that saved a reader a row. */
  repeated: SignatureGroup[];
  /**
   * What exact-string grouping would have produced over the same occurrences.
   * The control: a rule that only folds identical bytes is not a normaliser, and
   * a reading that does not print this cannot tell the two apart.
   */
  identityRows: number;
}

/**
 * Fold occurrences into queue entries.
 *
 * Ordered by count, then by distinct sessions, then by key — so the queue leads
 * with the shape a reader has paid for most often, and the order is total and
 * deterministic rather than insertion-dependent.
 *
 * Nothing is discarded: {@link SignatureGrouping.occurrences} always equals the
 * sum of the groups' counts, which the test asserts, because a queue that folds
 * an item away is a quiet deletion wearing a nicer word.
 */
export function groupBySignature(occurrences: readonly SignatureOccurrence[]): SignatureGrouping {
  interface Bucket {
    kind: string;
    template: string;
    count: number;
    sessions: Set<string>;
    tools: Set<string>;
    details: Set<string>;
    example: string;
  }
  const buckets = new Map<string, Bucket>();
  const identity = new Set<string>();

  for (const occurrence of occurrences) {
    identity.add(`${occurrence.kind}|${occurrence.detail.trim().toLowerCase()}`);
    const signature = frictionSignature(occurrence);
    let bucket = buckets.get(signature);
    if (!bucket) {
      bucket = {
        kind: occurrence.kind,
        template: normaliseRefusal(occurrence.detail),
        count: 0,
        sessions: new Set(),
        tools: new Set(),
        details: new Set(),
        example: occurrence.detail,
      };
      buckets.set(signature, bucket);
    }
    bucket.count++;
    bucket.sessions.add(occurrence.session);
    if (occurrence.tool) bucket.tools.add(occurrence.tool);
    bucket.details.add(occurrence.detail);
  }

  const groups: SignatureGroup[] = [...buckets.entries()]
    .map(([signature, b]) => ({
      signature,
      kind: b.kind,
      template: b.template,
      count: b.count,
      sessions: [...b.sessions].sort(),
      tools: [...b.tools].sort(),
      distinctDetails: b.details.size,
      example: b.example,
    }))
    .sort((a, b) => b.count - a.count || b.sessions.length - a.sessions.length || (a.signature < b.signature ? -1 : 1));

  return {
    occurrences: occurrences.length,
    groups,
    rows: groups.length,
    repeated: groups.filter((g) => g.count > 1),
    identityRows: identity.size,
  };
}

/** Lift a harvested record's events into occurrences stamped with its id. */
export function occurrencesOf(record: { id: string; events: readonly RecordEvent[] }): SignatureOccurrence[] {
  return record.events.map((e) => ({ kind: e.kind, tool: e.tool, detail: e.detail, session: record.id }));
}

// ── the report ───────────────────────────────────────────────────────────────

/** How many sessions a row names before it says how many more there are. */
export const MAX_SESSIONS_SHOWN = 4;

/** How much of an example a row prints. Long enough to recognise, short enough to scan. */
export const MAX_EXAMPLE_CHARS = 120;

/** Rows printed when the caller names no bound. The rest are counted, never dropped. */
export const DEFAULT_MAX_ROWS = 10;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function sessionList(sessions: readonly string[]): string {
  if (sessions.length <= MAX_SESSIONS_SHOWN) return sessions.join(", ");
  return `${sessions.slice(0, MAX_SESSIONS_SHOWN).join(", ")} … and ${sessions.length - MAX_SESSIONS_SHOWN} more`;
}

/** One queue entry as a reader meets it: the count first, then what it is a count of. */
export function formatSignatureGroup(group: SignatureGroup): string {
  const tools = group.tools.length ? group.tools.join(", ") : "(unnamed)";
  const strings = group.distinctDetails === 1 ? "1 distinct string" : `${group.distinctDetails} distinct strings`;
  return (
    `  ${group.count}× across ${group.sessions.length} session(s), ${strings} — ${group.kind} · ${tools}\n` +
    `    "${clip(group.example, MAX_EXAMPLE_CHARS)}"\n` +
    `    seen in: ${sessionList(group.sessions)}`
  );
}

/**
 * The grouping as an operator reads it.
 *
 * The refusal prints on every reading, including a flattering one. A report
 * ending on "545 events → 1 row" would read as the backlog having been cleared,
 * and one row that nothing maps is still one unmapped item.
 */
export function formatSignatureGrouping(grouping: SignatureGrouping, opts: { top?: number } = {}): string {
  const top = opts.top ?? DEFAULT_MAX_ROWS;
  const lines: string[] = [];

  lines.push(
    `Read: ${grouping.occurrences} friction event(s) → ${grouping.rows} row(s), ` +
      `${grouping.repeated.length} of them holding more than one occurrence. 0 discarded.`,
  );
  if (grouping.rows === 0) {
    lines.push("Rows: (none) — no friction event was read.");
  } else {
    const shown = grouping.groups.slice(0, top);
    lines.push(`Rows (largest first${grouping.rows > shown.length ? `, showing ${shown.length} of ${grouping.rows}` : ""}):`);
    for (const group of shown) lines.push(formatSignatureGroup(group));
    if (grouping.rows > shown.length) {
      const hidden = grouping.groups.slice(shown.length);
      lines.push(
        `  … and ${hidden.length} more row(s) holding ${hidden.reduce((n, g) => n + g.count, 0)} event(s). ` +
          `Nothing is dropped by this cap; raise --top to read them.`,
      );
    }
  }

  lines.push(
    `Grouping, not deduplication: exact-string grouping over the same events would leave ${grouping.identityRows} row(s), ` +
      `and would split every shape whose repeats differ by a path, an id or a number.`,
  );
  lines.push(`Not settled: ${FRICTION_SIGNATURE_RULE.refuses}.`);
  return lines.join("\n");
}
