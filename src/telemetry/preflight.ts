/**
 * The preflight-uncertainty census: how often a call that failed came from a
 * caller who was already showing it did not know the call would be accepted.
 *
 * The question is not academic. A validate-only twin of every mutating tool — a
 * call that runs every check, writes nothing, and returns a verdict — helps
 * exactly one caller: the one who thinks to use it. So before that twin is worth
 * building, someone has to establish that failing callers were hesitating. The
 * evidence in this vault points the other way: four identical rung refusals
 * arrived nine seconds apart in one afternoon, which is the signature of a caller
 * that was confident and wrong, not one that was unsure.
 *
 * This module takes the count. The denominator is every failed call in the usage
 * trace — a mechanical record, not a narrated one. For each, it finds that call
 * in the session transcript and reads a bounded window of what the caller did
 * immediately before it.
 *
 * ## The rule is committed here, not chosen after seeing the number
 *
 * "Knew to be uncertain" is inferred from behaviour rather than observed, so the
 * classifier is a proxy somebody picked — and a proxy tuned after the count is a
 * number that means nothing. {@link UNCERTAINTY_RULE} is that proxy, written down
 * in full, including what it deliberately refuses to count. Two exclusions carry
 * most of the weight:
 *
 * - **Bare epistemic hedges are not doubt.** `might`, `maybe`, `probably`,
 *   `should be`, `I think`, `likely` appear in ordinary assistant prose whatever
 *   the caller believes about the call it is about to make. Counting them would
 *   put a doubt signal in front of nearly every call, and a classifier that
 *   always answers cannot come out a failure.
 * - **A shell command is not a read.** `Bash` may be reading or writing and the
 *   census cannot tell which, so it is not a read-before-write signal.
 *
 * ## What a count out of this cannot settle
 *
 * It cannot say whether a validating call would have been *made*. A caller that
 * was demonstrably uncertain and committed to the real call anyway is evidence
 * against the dry-run twin, not for it, and nothing here separates the two —
 * only shipping the twin and watching it be declined would. The census also says
 * nothing about desirability: nobody outside this project has asked for a
 * validate-before-commit call, however the share comes out.
 *
 * And it is bounded by what survives. A failed call whose session transcript is
 * gone is UNREAD, never "confident" — see {@link PreflightCensus.unread}, which
 * is reported ahead of the share for the reason a sibling opportunity in this
 * tree already names: a sweep that cannot read its subject must not report a
 * clean result.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../adapters/transcript.js";
import { usageLogPath, type UsageEvent } from "./usage.js";

/** One session transcript, as its id and its raw JSONL text. */
export interface TranscriptSession {
  /** The session file's basename without `.jsonl` — what a reader greps for. */
  id: string;
  jsonl: string;
}

/** Which kind of prior doubt a failing call was preceded by. */
export type DoubtSignalKind = "hedge" | "check" | "read" | "question";

export interface DoubtSignal {
  kind: DoubtSignalKind;
  /** The marker phrase or tool name that fired, so the reading can be checked. */
  marker: string;
  /** Short redacted excerpt of what fired it. */
  excerpt: string;
}

/** Why a failed call could not be read against a session record. */
export type UnreadReason = "no session record";

/**
 * How much of the caller's own voice survives in one lookback window.
 *
 * The two prose signals — {@link DoubtSignalKind} `hedge` and `check` — can only
 * fire on text the caller wrote. Claude Code stores an assistant's `thinking`
 * block with its `text` field emptied and only the signature retained, so the
 * reasoning where a caller would say "I'm not sure this rung is allowed" is not
 * in the record at all. A window with no prose therefore reports "no hedge" for a
 * reason that has nothing to do with how confident the caller was, and a census
 * that did not separate the two would be answering a question it never read.
 *
 * Tool calls are unaffected: they are recorded in full, so `read` and `question`
 * mean what they say in every window.
 */
export interface ProseCoverage {
  /** Characters of readable caller prose (`text` + non-empty `thinking`) in the window. */
  chars: number;
  /** `thinking` blocks present in the window. */
  thinkingBlocks: number;
  /** Of those, how many arrived with their text removed. */
  redactedThinkingBlocks: number;
}

export interface FailedCallReading {
  /** The usage event's timestamp — the join key, and the way to find it by hand. */
  ts: string;
  tool: string;
  /** Which surface dispatched it; `cli-tool` failures rarely have a session record. */
  surface: string;
  /** Redacted failure message, clipped. */
  err: string;
  /** Transcript session the call was found in, absent when unread. */
  session?: string;
  /** Index of the entry that issued the call within that session, for checking by hand. */
  entry?: number;
  /** Every doubt signal in the lookback window. Empty means the caller showed none. */
  signals: DoubtSignal[];
  /** What survived of the caller's own voice in that window. Absent when unread. */
  prose?: ProseCoverage;
  /** Absent when unread — an unreadable call is not evidence either way. */
  uncertain?: boolean;
  unread?: UnreadReason;
}

export interface PreflightCensus {
  /** Every call in the trace, failed or not — the share of traffic that fails is context. */
  calls: number;
  /** Every failed call. The honest denominator of the question, before coverage. */
  failed: number;
  /** Failed calls found in a session transcript. The denominator any share is over. */
  readable: number;
  /** Failed calls with no session record to read. Never counted as confident. */
  unread: number;
  /** Readable failures preceded by at least one doubt signal. */
  uncertain: number;
  /** Readable failures preceded by none. */
  confident: number;
  /**
   * Readable failures whose window carried no caller prose at all.
   *
   * For these, "no hedge" is not a finding — it is the absence of a place a hedge
   * could have been seen. Reported ahead of any verdict for the same reason
   * {@link PreflightCensus.unread} is.
   */
  proseless: number;
  /** uncertain / readable, or null when nothing was readable. */
  share: number | null;
  /** How many readable failures each signal kind fired on (a call may carry several). */
  byKind: Record<DoubtSignalKind, number>;
  /**
   * The same count taken at other lookback bounds, so the reader can see how much
   * of the headline is the corpus and how much is the bound.
   *
   * This is the admitted weakness of the whole design made into a number. "Knew to
   * be uncertain" is inferred from behaviour, the window is the inference, and a
   * share that moves from none to all across plausible windows is not a fact about
   * callers. Reported always, not only when it disagrees.
   */
  sensitivity: { lookbackEntries: number; uncertain: number }[];
  /** True when the ladder does not agree — the share is then a property of the bound. */
  boundDecides: boolean;
  /** One reading per failed call, in trace order. */
  readings: FailedCallReading[];
}

/**
 * The classifier, fixed in source before the corpus was counted.
 *
 * Exported so a test can assert against it and a reader can disagree with it by
 * name. Changing a list here changes the finding; that is the point of it being
 * one object rather than constants scattered through the reader.
 */
export const UNCERTAINTY_RULE = {
  /**
   * How many transcript entries before the failing call are in scope, plus the
   * entry that issued the call itself.
   *
   * Bounded on purpose. A caller that read the tree twenty turns earlier and then
   * fired confidently is not hesitating, and an unbounded window would score it
   * as though it were — in a session that reads constantly, every call would come
   * out doubtful.
   */
  lookbackEntries: 6,

  /**
   * How close a transcript `tool_use` must be to the usage event to be the same
   * call. The trace stamps the moment the call started and the transcript stamps
   * the assistant message that issued it, so the two differ by a dispatch, not by
   * a turn. Five seconds is wide enough for that and narrow enough that four
   * failures nine seconds apart stay four distinct calls.
   */
  joinWindowMs: 5_000,

  /**
   * First-person doubt about what is about to happen. Matched case-insensitively
   * against the caller's own `text` and `thinking` blocks in the window.
   */
  hedgeMarkers: [
    "not sure",
    "unsure",
    "not certain",
    "uncertain whether",
    "uncertain if",
    "i wonder if",
    "i wonder whether",
    "i am guessing",
    "i'm guessing",
    "i suspect",
    "i don't know if",
    "i don't know whether",
    "if that's allowed",
    "if that is allowed",
    "if this is allowed",
    "may be rejected",
    "might be rejected",
    "may be refused",
    "might be refused",
    "may not be allowed",
    "might not be allowed",
    "may not accept",
    "might not accept",
    "hopefully",
  ],

  /**
   * The caller announcing a check before it acts. Weaker than a hedge — it says
   * the caller went to look, not that it doubted the answer — so it is counted
   * as its own kind rather than folded in.
   */
  checkMarkers: [
    "let me check",
    "let me verify",
    "let me confirm",
    "let me first",
    "let's check",
    "let's verify",
    "let's confirm",
    "worth checking",
    "check first",
    "before committing",
  ],

  /**
   * Phrases that look like hedges and are NOT counted, recorded so the exclusion
   * is auditable rather than an omission. Each occurs in ordinary prose
   * independent of what the caller believes about the call it is making.
   */
  excludedMarkers: ["might", "maybe", "perhaps", "probably", "should be", "i think", "likely", "seems", "assuming"],

  /**
   * A call whose presence in the window means the caller went and looked before
   * writing. The product's read-only tools plus the generic file readers, matched
   * bare or with an MCP prefix (`mcp__ost-agent__ost_read_tree`).
   *
   * `Bash` is absent deliberately: a shell command is as likely to be a write as
   * a read and the census cannot tell which.
   */
  readTools: [
    "ost_read_tree",
    "ost_next_work",
    "ost_status",
    "ost_check",
    "ost_debt",
    "ost_gate",
    "ost_read_repo",
    "ost_search_web",
    "ost_read_web",
    "Read",
    "Grep",
    "Glob",
  ],

  /** A clarifying question in the window — the caller asking rather than assuming. */
  questionTools: ["AskUserQuestion"],

  /**
   * Other bounds the same count is taken at, reported beside the headline.
   *
   * The census cannot defend `lookbackEntries` against these — there is no
   * principled window — so it publishes what each one would have said instead of
   * asking to be trusted. See {@link PreflightCensus.sensitivity}.
   */
  sensitivityLadder: [2, 6, 12, 24],
} as const;

const MAX_EXCERPT_CHARS = 160;

function clip(text: string): string {
  const flat = redactSecrets(text).replace(/\s+/g, " ").trim();
  return flat.length > MAX_EXCERPT_CHARS ? `${flat.slice(0, MAX_EXCERPT_CHARS)}…` : flat;
}

/** Curly and straight apostrophes are the same word; a transcript carries both. */
function normalize(text: string): string {
  return text.replace(/[‘’]/g, "'").toLowerCase();
}

/** A tool_use in a session transcript, flattened to what the census reads. */
interface TranscriptCall {
  session: string;
  /** Index of the entry within its session, counting parsed entries from 0. */
  entry: number;
  /** Position of the block within that entry, so blocks before the call can be told apart. */
  block: number;
  name: string;
  tsMs: number;
}

interface TranscriptEntry {
  session: string;
  index: number;
  /** `assistant`, `user`, … as the transcript records it. */
  type: string;
  blocks: Record<string, unknown>[];
}

interface ParsedSession {
  entries: TranscriptEntry[];
  calls: TranscriptCall[];
}

function blocksOf(entry: Record<string, unknown>): Record<string, unknown>[] {
  const message = entry.message as Record<string, unknown> | undefined;
  const content = message?.content;
  return Array.isArray(content) ? (content as Record<string, unknown>[]) : [];
}

function parseSession(session: TranscriptSession): ParsedSession {
  const entries: TranscriptEntry[] = [];
  const calls: TranscriptCall[] = [];
  for (const raw of session.jsonl.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue; // a corrupt line costs one entry, never the session
    }
    const index = entries.length;
    const blocks = blocksOf(parsed);
    entries.push({ session: session.id, index, type: String(parsed.type ?? ""), blocks });

    const tsMs = Date.parse(typeof parsed.timestamp === "string" ? parsed.timestamp : "");
    if (Number.isNaN(tsMs)) continue;
    blocks.forEach((block, blockIndex) => {
      if (block.type !== "tool_use") return;
      calls.push({ session: session.id, entry: index, block: blockIndex, name: String(block.name ?? ""), tsMs });
    });
  }
  return { entries, calls };
}

/** `mcp__ost-agent__ost_create_node` and `ost_create_node` are the same tool. */
function sameTool(transcriptName: string, tracedName: string): boolean {
  return transcriptName === tracedName || transcriptName.endsWith(`__${tracedName}`);
}

function isRead(name: string): boolean {
  return UNCERTAINTY_RULE.readTools.some((t) => sameTool(name, t));
}

function isQuestion(name: string): boolean {
  return UNCERTAINTY_RULE.questionTools.some((t) => sameTool(name, t));
}

/**
 * The caller's own prose in one entry: what it wrote, and what it reasoned.
 *
 * A `thinking` block is counted whether or not it still carries text, because an
 * emptied one is the evidence that the caller reasoned somewhere this census
 * cannot follow — see {@link ProseCoverage}.
 */
function callerProse(entry: TranscriptEntry): { prose: string[]; thinking: number; redacted: number } {
  if (entry.type !== "assistant") return { prose: [], thinking: 0, redacted: 0 };
  const prose: string[] = [];
  let thinking = 0;
  let redacted = 0;
  for (const block of entry.blocks) {
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) prose.push(block.text);
    if (block.type === "thinking") {
      thinking++;
      const text = typeof block.thinking === "string" ? block.thinking : "";
      if (text.trim()) prose.push(text);
      else redacted++;
    }
  }
  return { prose, thinking, redacted };
}

function markersIn(prose: string, markers: readonly string[]): string[] {
  const haystack = normalize(prose);
  return markers.filter((m) => haystack.includes(m));
}

/**
 * Every doubt signal in the window before one failing call.
 *
 * "Before" is enforced at block granularity, not entry granularity: a `text`
 * block the caller wrote in the same message, ahead of the tool call, is prose it
 * committed to before making the call, but a tool call later in that same message
 * is not a read that preceded it.
 */
function readBefore(
  parsed: ParsedSession,
  call: TranscriptCall,
  lookbackEntries: number,
): { signals: DoubtSignal[]; prose: ProseCoverage } {
  const signals: DoubtSignal[] = [];
  const prose: ProseCoverage = { chars: 0, thinkingBlocks: 0, redactedThinkingBlocks: 0 };
  const first = Math.max(0, call.entry - lookbackEntries);

  for (let i = first; i <= call.entry; i++) {
    const entry = parsed.entries[i];
    if (!entry) continue;

    const voice = callerProse(entry);
    prose.thinkingBlocks += voice.thinking;
    prose.redactedThinkingBlocks += voice.redacted;
    for (const text of voice.prose) {
      prose.chars += text.length;
      for (const marker of markersIn(text, UNCERTAINTY_RULE.hedgeMarkers)) {
        signals.push({ kind: "hedge", marker, excerpt: clip(text) });
      }
      for (const marker of markersIn(text, UNCERTAINTY_RULE.checkMarkers)) {
        signals.push({ kind: "check", marker, excerpt: clip(text) });
      }
    }

    entry.blocks.forEach((block, blockIndex) => {
      if (block.type !== "tool_use") return;
      if (i === call.entry && blockIndex >= call.block) return; // not before the call
      const name = String(block.name ?? "");
      if (isRead(name)) signals.push({ kind: "read", marker: name, excerpt: clip(JSON.stringify(block.input ?? {})) });
      else if (isQuestion(name)) {
        signals.push({ kind: "question", marker: name, excerpt: clip(JSON.stringify(block.input ?? {})) });
      }
    });
  }
  return { signals, prose };
}

/**
 * Take the census: every failed call in `events`, read against `sessions`.
 *
 * Both inputs are passed in rather than read from disk so the reading is testable
 * against a committed corpus offline, which is the only way this number stays the
 * same number tomorrow.
 */
export function preflightUncertaintyCensus(
  events: readonly UsageEvent[],
  sessions: readonly TranscriptSession[],
): PreflightCensus {
  const parsed = sessions.map(parseSession);
  // A transcript call is spent once it explains a failure. Four identical
  // refusals nine seconds apart are four calls, and without this the nearest one
  // would answer for all of them.
  const claimed = new Set<string>();

  const failures = events.filter((e) => !e.ok);
  const readings: FailedCallReading[] = [];
  // Kept so the sensitivity ladder re-reads the same joined calls rather than
  // re-joining — the join is fixed by timestamps and does not move with the bound.
  const joins: { session: ParsedSession; call: TranscriptCall }[] = [];

  for (const event of failures) {
    const eventMs = Date.parse(event.ts);
    let best: { session: ParsedSession; call: TranscriptCall; distance: number } | undefined;

    if (!Number.isNaN(eventMs)) {
      for (const session of parsed) {
        for (const call of session.calls) {
          if (!sameTool(call.name, event.tool)) continue;
          const distance = Math.abs(call.tsMs - eventMs);
          if (distance > UNCERTAINTY_RULE.joinWindowMs) continue;
          if (claimed.has(`${call.session}:${call.entry}:${call.block}`)) continue;
          if (!best || distance < best.distance) best = { session, call, distance };
        }
      }
    }

    const base = {
      ts: event.ts,
      tool: event.tool,
      surface: event.surface,
      err: clip(event.err ?? ""),
    };

    if (!best) {
      readings.push({ ...base, signals: [], unread: "no session record" });
      continue;
    }

    claimed.add(`${best.call.session}:${best.call.entry}:${best.call.block}`);
    joins.push({ session: best.session, call: best.call });
    const { signals, prose } = readBefore(best.session, best.call, UNCERTAINTY_RULE.lookbackEntries);
    readings.push({
      ...base,
      session: best.call.session,
      entry: best.call.entry,
      signals,
      prose,
      uncertain: signals.length > 0,
    });
  }

  const readable = readings.filter((r) => !r.unread);
  const uncertain = readable.filter((r) => r.uncertain);
  const byKind: Record<DoubtSignalKind, number> = { hedge: 0, check: 0, read: 0, question: 0 };
  for (const reading of readable) {
    for (const kind of new Set(reading.signals.map((s) => s.kind))) byKind[kind]++;
  }

  const sensitivity = UNCERTAINTY_RULE.sensitivityLadder.map((lookbackEntries) => ({
    lookbackEntries,
    uncertain: joins.filter((j) => readBefore(j.session, j.call, lookbackEntries).signals.length > 0).length,
  }));

  return {
    calls: events.length,
    failed: failures.length,
    readable: readable.length,
    unread: readings.length - readable.length,
    uncertain: uncertain.length,
    confident: readable.length - uncertain.length,
    proseless: readable.filter((r) => (r.prose?.chars ?? 0) === 0).length,
    share: readable.length ? uncertain.length / readable.length : null,
    byKind,
    sensitivity,
    boundDecides: new Set(sensitivity.map((s) => s.uncertain)).size > 1,
    readings,
  };
}

/**
 * Read a vault's usage trace. A missing or corrupt log yields the events that
 * parsed, never an exception: the census's own answer to a subject it cannot read
 * is `unread`, and it must reach that answer rather than crash short of it.
 */
export function readUsageEvents(vaultDir: string): UsageEvent[] {
  let text: string;
  try {
    text = fs.readFileSync(usageLogPath(vaultDir), "utf8");
  } catch {
    return [];
  }
  const events: UsageEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as UsageEvent);
    } catch {
      // a corrupt line costs one event, never the trace
    }
  }
  return events;
}

/** Read every `*.jsonl` session transcript in a directory, oldest name first. */
export function readTranscriptSessions(dir: string): TranscriptSession[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort();
  } catch {
    return [];
  }
  const sessions: TranscriptSession[] = [];
  for (const name of names) {
    try {
      sessions.push({ id: name.replace(/\.jsonl$/, ""), jsonl: fs.readFileSync(path.join(dir, name), "utf8") });
    } catch {
      // an unreadable transcript is one fewer session, reported as `unread` coverage
    }
  }
  return sessions;
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * The census as an operator reads it: coverage first, then the share.
 *
 * Coverage leads because it is the number most likely to invalidate the other
 * one. A share of a denominator the reader has not seen is the shape of every
 * confident wrong finding this repository has had to withdraw.
 */
export function formatPreflightCensus(census: PreflightCensus): string {
  const lines: string[] = [];

  if (census.readable === 0) {
    lines.push(
      `Preflight uncertainty: UNREAD — ${census.failed} failed call(s) of ${census.calls}, ` +
        `and not one of them has a session record to read.`,
    );
  } else {
    lines.push(
      `Preflight uncertainty: ${census.uncertain} of ${census.readable} readable failure(s) ` +
        `(${pct(census.share ?? 0)}) came from a caller already showing doubt; ${census.confident} showed none.`,
    );
  }
  lines.push(
    `  Coverage: ${census.readable} of ${census.failed} failed call(s) were found in a transcript; ` +
      `${census.unread} had no session record and are counted neither way.`,
  );
  lines.push(
    `  Signals: hedge ${census.byKind.hedge}, check ${census.byKind.check}, ` +
      `read-before-write ${census.byKind.read}, question ${census.byKind.question}.`,
  );
  const ladder = census.sensitivity.map((s) => `${s.lookbackEntries}→${s.uncertain}`).join(", ");
  lines.push(
    census.boundDecides
      ? `  Bound: THE WINDOW DECIDES THIS. At other lookbacks the count would be ${ladder} of ${census.readable}. ` +
          `The share above is as much a property of the ${UNCERTAINTY_RULE.lookbackEntries}-entry window as of the callers.`
      : `  Bound: stable — at lookbacks ${ladder} of ${census.readable}, the count does not move with the window.`,
  );
  if (census.proseless) {
    lines.push(
      `  Prose: ${census.proseless} of ${census.readable} readable window(s) carried no caller prose at all ` +
        `— reasoning is stored with its text removed, so a hedge could not have been seen there however ` +
        `hesitant the caller was. Only read-before-write and question are evidence in those windows.`,
    );
  }

  lines.push("");
  lines.push("Readable failures:");
  const readable = census.readings.filter((r) => !r.unread);
  if (!readable.length) lines.push("  (none)");
  for (const r of readable) {
    const verdict = r.uncertain ? "DOUBT" : "confident";
    lines.push(`  ${r.ts} ${r.tool} [${verdict}] — ${r.err}`);
    for (const s of r.signals) lines.push(`      ${s.kind}: ${s.marker} — ${s.excerpt}`);
    if (!r.signals.length) {
      const blind = (r.prose?.chars ?? 0) === 0
        ? ` (${r.prose?.redactedThinkingBlocks ?? 0} emptied thinking block(s): no prose to read)`
        : ` (${r.prose?.chars ?? 0} chars of prose read)`;
      lines.push(`      no hedge, no check, no read, no question in the window${blind}`);
    }
  }

  const unread = census.readings.filter((r) => r.unread);
  if (unread.length) {
    lines.push("");
    lines.push(`Unread — no session record survives for these ${unread.length} failure(s):`);
    const byTool = new Map<string, number>();
    for (const r of unread) byTool.set(`${r.tool} (${r.surface})`, (byTool.get(`${r.tool} (${r.surface})`) ?? 0) + 1);
    for (const [tool, n] of [...byTool.entries()].sort((a, b) => b[1] - a[1])) lines.push(`  ${tool} ×${n}`);
  }

  lines.push("");
  lines.push(
    "What this does not settle: whether a validating call would have been MADE. A caller that " +
      "was uncertain and committed to the real call anyway is evidence against a dry-run twin, not " +
      "for it, and only shipping the twin and watching it be declined separates the two. " +
      `The doubt rule is the one in UNCERTAINTY_RULE — ${UNCERTAINTY_RULE.excludedMarkers.length} bare ` +
      "hedges are deliberately not counted; read it before believing the share.",
  );
  return lines.join("\n");
}
