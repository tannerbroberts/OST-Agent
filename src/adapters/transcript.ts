/**
 * Transcript adapter — harvests the agent's own sessions as usage evidence.
 *
 * The agent running the OST is the product's most active user. Every failed tool
 * call, retry, interruption, denied permission and forced clarifying question it
 * hits is *observed behavior* about where the product is hard to use — and today
 * all of it is deleted when the session ends. This adapter reads finished session
 * transcripts (Claude Code's `~/.claude/projects/<slug>/*.jsonl`), extracts those
 * signals mechanically, and emits one bounded, redacted evidence item per session.
 *
 * Deliberately mechanical: it detects friction, it does not interpret it. The
 * knowledge processes downstream (P2_map onward) do the distilling, which keeps
 * this adapter deterministic, testable and free of model calls.
 *
 * Two properties matter for the vault this writes into:
 * - strictly read-only — transcripts are never modified, moved or deleted;
 * - bounded and redacted — a capped number of short excerpts per session, with
 *   secret-shaped strings masked, because transcripts are large, noisy, and may
 *   contain material that should not be committed to a shared vault.
 *
 * ## Several directories, and why each item has to say which one it came from
 *
 * "The agent's own sessions" is not one directory. Claude Code keys a session
 * directory to the *working directory* it ran in, so an agent that is worked on
 * in one place and runs unattended in another leaves two disjoint piles — and on
 * the vault this product dogfoods, the adapter read only the first. Every one of
 * the 36 sessions cited in that tree was a human-driven session in the code
 * repository; not one was an unattended firing, because a firing's cwd is the
 * vault. The channel whose entire premise is "the agent is the product's most
 * active user" was reading only the agent being *built*, never the agent
 * *running*, and nothing in the evidence said so.
 *
 * That last clause is why {@link TranscriptDir} carries an `origin` and why it is
 * not optional. Merging two piles into one channel without labelling them makes
 * the two indistinguishable downstream — every item is `TRANSCRIPT:<uuid>`, and a
 * uuid does not say whether a person was sitting there. A pass reading friction
 * out of an *attended* session is reading something a human could have fixed on
 * the spot; the same friction in an unattended firing is a failure mode nobody
 * saw. Those are different findings, so the origin travels with the evidence.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Actor, Cursor, EvidenceItem, FetchResult, Source } from "./source.js";

/**
 * Where Claude Code keeps a project's session transcripts: `~/.claude/projects/`
 * plus the project path with every non-alphanumeric character turned into `-`.
 */
export function defaultTranscriptDir(projectDir: string): string {
  const slug = path.resolve(projectDir).replace(/[^A-Za-z0-9]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", slug);
}

export type FrictionKind =
  | "tool_error"
  | "retry"
  | "interruption"
  | "permission_denied"
  | "clarifying_question";

/**
 * What a `tool_error` turned into, judged by what happened next rather than by
 * the error itself. Set only on `tool_error` — every other kind is already a
 * clean signal (a denial, an interruption, a repeated call) with nothing to
 * recover from.
 */
export type RecoveryOutcome = "recovered" | "friction";

export interface FrictionEvent {
  kind: FrictionKind;
  /** The tool involved, when the signal came from a tool call. */
  tool?: string;
  /** Short, redacted excerpt — enough context to interpret the event later. */
  detail: string;
  /** ISO timestamp of the transcript entry. */
  timestamp: string;
  /**
   * For `tool_error` only: whether the same tool went on to succeed within a
   * turn or two. `"recovered"` is a typo, collapsed into a counted summary
   * line; `"friction"` — several attempts, or the tool was never called again
   * before the session ended — gets its own record.
   */
  recovery?: RecoveryOutcome;
}

/**
 * How many subsequent tool calls count as "a turn or two". A session that
 * needs a third attempt at the same tool, or abandons it outright, is not a
 * typo — it cost the session something.
 */
const RECOVERY_WINDOW = 2;

/** One directory of session transcripts, and what kind of session lands in it. */
export interface TranscriptDir {
  /** Directory of `*.jsonl` session transcripts. */
  dir: string;
  /**
   * What these sessions are, in one phrase, written into every evidence item
   * this directory produces — "this vault's own unattended firings", "sessions
   * run against /path/to/repo". Required, not defaulted: the whole reason for
   * reading more than one directory is that the difference between them is the
   * finding, and a default would be a phrase nobody chose describing sessions
   * nobody looked at.
   */
  origin: string;
}

export interface TranscriptSourceOptions {
  /**
   * Directories to harvest, each labelled. Scanned as one pool: sessions from
   * every directory compete for the same newest-first {@link maxSessions} budget,
   * so a busy directory cannot starve a quiet one of its recent sessions and the
   * cap keeps meaning what it says however many directories are named.
   */
  dirs: TranscriptDir[];
  /** A session is "finished" once its file has been untouched this long. */
  quietMinutes?: number;
  /** Cap on friction events reported per session (the rest are counted only). */
  maxEventsPerSession?: number;
  /** Cap on sessions harvested per fetch, newest first. */
  maxSessions?: number;
}

const DEFAULT_QUIET_MINUTES = 30;
const DEFAULT_MAX_EVENTS = 25;
const DEFAULT_MAX_SESSIONS = 20;
const MAX_DETAIL_CHARS = 220;

/** Tool results whose text means "a human said no", not "the tool broke". */
const DENIAL_PATTERNS = [
  /user doesn't want to (?:proceed|take this action)/i,
  /permission (?:was )?denied by the user/i,
  /user rejected/i,
];

const INTERRUPTION_PATTERN = /\[Request interrupted by user/i;

/** Secret-shaped strings, masked before anything reaches the vault. */
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk)-[A-Za-z0-9_-]{16,}/g, // provider API keys (sk-ant-…, sk-…)
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bAKIA[0-9A-Z]{12,}/g, // AWS access key ids
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, // bearer tokens (keeps the word "Bearer")
  // The one keyword-context rule, and so the only one that can fire on English.
  // Everything above matches a credential *format*; this matches "a secret word,
  // a separator, then something". The something used to be any 8+ token characters,
  // which is also the shape of the next word in a sentence — `secret: customers do
  // not trust us` masked "customers", `password = something memorable` masked
  // "something". Prose is not a side case here: the inbox carries customer
  // verbatims, evidence records are append-only with no edit tool, and the mangled
  // sentence is what the model then reasons from.
  //
  // The discriminator is where the value ENDS. An assignment's value runs to the
  // end of the line or to a structural delimiter (`"`, `,`, `}`, …); a sentence's
  // next word is followed by a space and more words. Requiring that terminator
  // keeps dictionary-word passwords (`password: swordfish`) while dropping the
  // prose, and the trailing character may not be `.` so a sentence-final period
  // cannot stand in for one (`The secret: patience.`). The optional quote after the
  // keyword picks up inline JSON (`{"password": "hunter22", …}`), which the older
  // rule missed entirely. Measured on 30 lines of realistic verbatim prose and 16
  // credentials only this rule can catch: false positives 67% → 20%, missed
  // credentials 19% → 6% — tighter on prose without narrowing what it masks.
  /\b(?:api[_-]?key|token|secret|password|passwd)\b["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{7,}[A-Za-z0-9_~+/=-](?=["'`,;)\]}]|\s*$)/gim,
];

/** Mask anything that looks like a credential. Ordinary prose passes through. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match) => {
      const keep = /^Bearer\s/i.test(match) ? "Bearer " : labelPrefix(match);
      return `${keep}[redacted]`;
    });
  }
  return out;
}

/**
 * For `KEY=value` style matches, keep the key so the context stays readable — and
 * the quotes around it, so a masked JSON field stays parseable rather than becoming
 * `{"[redacted]", …}`. The separator stays mandatory: making it optional would let
 * this swallow a bare token match (`sk-ant-…`) as its own label and emit it intact.
 */
function labelPrefix(match: string): string {
  const m = /^([A-Za-z_][\w-]*["']?\s*[:=]\s*["']?)/.exec(match);
  return m ? m[1] : "";
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_DETAIL_CHARS ? `${flat.slice(0, MAX_DETAIL_CHARS)}…` : flat;
}

function detail(text: string): string {
  return clip(redactSecrets(text));
}

/** Lines that carry the reason a call failed, as opposed to the stdout around them. */
const ERROR_LINE =
  /(error|not found|no such|no match|failed|denied|refus|cannot|unable|invalid|missing|traceback|exception|^(?:zsh|bash|sh):)/i;

/**
 * Tool failures usually print output first and the reason last, so a plain head
 * excerpt quotes the noise. Prefer the last error-looking line, keeping the head
 * (typically the exit code) for context.
 */
function errorDetail(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const reason = [...lines].reverse().find((l) => ERROR_LINE.test(l));
  if (!reason || lines.indexOf(reason) === 0) return detail(text);
  return detail(`${lines[0]} … ${reason}`);
}

/** Tool results carry either a string or a list of content blocks. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join(" ");
  }
  return "";
}

function contentBlocks(entry: Record<string, unknown>): Record<string, unknown>[] {
  const message = entry.message as Record<string, unknown> | undefined;
  const content = message?.content;
  return Array.isArray(content) ? (content as Record<string, unknown>[]) : [];
}

function plainText(entry: Record<string, unknown>): string {
  const message = entry.message as Record<string, unknown> | undefined;
  return typeof message?.content === "string" ? message.content : "";
}

/**
 * Pull friction signals out of one session transcript (raw JSONL text).
 * Malformed lines are skipped rather than failing the session.
 */
export function extractFriction(jsonl: string): FrictionEvent[] {
  const events: FrictionEvent[] = [];
  const toolById = new Map<string, { name: string; input: string }>();
  const seenCalls = new Set<string>();
  // Every tool_result in order, success or failure — the record against which
  // recovery is judged: did the same tool succeed within the next couple of
  // calls, or did the session move on without it?
  const callSequence: { tool: string; isError: boolean }[] = [];
  const errorCallIndex = new Map<FrictionEvent, number>();

  for (const raw of jsonl.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : "";

    const text = plainText(entry);
    if (text && INTERRUPTION_PATTERN.test(text)) {
      events.push({ kind: "interruption", detail: detail(text), timestamp });
      continue;
    }

    for (const block of contentBlocks(entry)) {
      if (block.type === "tool_use") {
        const name = String(block.name ?? "");
        const input = JSON.stringify(block.input ?? {});
        const id = String(block.id ?? "");
        if (id) toolById.set(id, { name, input });

        if (name === "AskUserQuestion") {
          events.push({ kind: "clarifying_question", tool: name, detail: detail(input), timestamp });
          continue;
        }
        const signature = `${name}:${input}`;
        if (seenCalls.has(signature)) {
          events.push({ kind: "retry", tool: name, detail: detail(input), timestamp });
        } else {
          seenCalls.add(signature);
        }
        continue;
      }

      if (block.type === "tool_result") {
        const tool = toolById.get(String(block.tool_use_id ?? ""))?.name ?? "";
        const isError = block.is_error === true;
        callSequence.push({ tool, isError });
        if (!isError) continue;

        const body = resultText(block.content);
        const denied = DENIAL_PATTERNS.some((re) => re.test(body));
        const event: FrictionEvent = {
          kind: denied ? "permission_denied" : "tool_error",
          tool: tool || undefined,
          detail: errorDetail(body),
          timestamp,
        };
        events.push(event);
        if (event.kind === "tool_error" && tool) errorCallIndex.set(event, callSequence.length - 1);
      }
    }
  }

  for (const [event, index] of errorCallIndex) {
    let recovered = false;
    for (let k = index + 1; k <= index + RECOVERY_WINDOW && k < callSequence.length; k++) {
      if (callSequence[k].tool === event.tool && !callSequence[k].isError) {
        recovered = true;
        break;
      }
    }
    event.recovery = recovered ? "recovered" : "friction";
  }

  return events;
}

function renderBody(
  sessionId: string,
  origin: string,
  events: FrictionEvent[],
  maxEvents: number,
): string {
  const counts = new Map<FrictionKind, number>();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const summary = [...counts.entries()].map(([kind, n]) => `${kind} ×${n}`).join(", ");

  // Recovered tool errors are typos — they collapse into the count above and
  // the summary line below, never into a `- ` record of their own. Filtering
  // before the maxEvents slice, not after, so a run of typos near the start
  // of a session cannot crowd real friction further down out of `records`.
  const recoveredCount = events.filter((e) => e.recovery === "recovered").length;
  const records = events.filter((e) => e.recovery !== "recovered");
  const shown = records.slice(0, maxEvents);

  const lines = [
    `Session \`${sessionId}\` (${origin}) produced ${events.length} friction events (${summary}).`,
    "",
    "Evidence class: **observed behavior** — the agent's own usage of this product, captured mechanically from its session transcript. It is not outside-user demand data: it grounds usability, not desirability, and must not be counted as external evidence of want.",
    "",
  ];
  if (recoveredCount > 0) {
    lines.push(
      `${recoveredCount} tool error${recoveredCount === 1 ? "" : "s"} recovered within a turn or two — collapsed into this summary, not listed as individual records.`,
      "",
    );
  }
  lines.push(
    records.length === 0
      ? "No individual records — every tool error recovered."
      : shown.length < records.length
        ? `Showing the first ${shown.length} of ${records.length} record(s); the rest are counted only.`
        : "All records shown.",
    "",
  );
  for (const e of shown) {
    lines.push(`- **${e.kind}**${e.tool ? ` (${e.tool})` : ""}: ${e.detail}`);
  }
  return lines.join("\n");
}

export class TranscriptSource implements Source {
  readonly name = "transcript";
  readonly actor: Actor = "transcript";
  private readonly dirs: TranscriptDir[];
  private readonly quietMinutes: number;
  private readonly maxEvents: number;
  private readonly maxSessions: number;

  constructor(opts: TranscriptSourceOptions) {
    // Deduplicated by RESOLVED path, first label winning. Two names for one
    // directory is the ordinary case, not an exotic one — a vault whose loop
    // fires in its own folder can reach the same pile through the configured
    // path and through the loop's declared `sessionsDir` — and harvesting it
    // twice would double every session's friction into one evidence item.
    const byPath = new Map<string, TranscriptDir>();
    for (const d of opts.dirs) {
      const resolved = path.resolve(d.dir);
      if (!byPath.has(resolved)) byPath.set(resolved, { dir: resolved, origin: d.origin });
    }
    this.dirs = [...byPath.values()];
    this.quietMinutes = opts.quietMinutes ?? DEFAULT_QUIET_MINUTES;
    this.maxEvents = opts.maxEventsPerSession ?? DEFAULT_MAX_EVENTS;
    this.maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
  }

  async fetchSince(cursor: Cursor): Promise<FetchResult> {
    const seen = new Set<string>(decodeSeen(cursor));
    const quietBefore = Date.now() - this.quietMinutes * 60_000;

    // A directory that is not there is skipped rather than ending the scan. The
    // single-directory version returned empty on a missing one, which was the
    // same thing when there was only ever one; with several it would make an
    // absent directory silently cancel the present ones.
    const sessions: { id: string; full: string; origin: string; mtimeMs: number }[] = [];
    for (const d of this.dirs) {
      if (!fs.existsSync(d.dir)) continue;
      for (const entry of fs.readdirSync(d.dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const id = entry.name.replace(/\.jsonl$/, "");
        if (seen.has(`TRANSCRIPT:${id}`)) continue;
        const full = path.join(d.dir, entry.name);
        const mtimeMs = fs.statSync(full).mtimeMs;
        if (mtimeMs > quietBefore) continue;
        sessions.push({ id, full, origin: d.origin, mtimeMs });
      }
    }
    sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const items: EvidenceItem[] = [];
    for (const s of sessions.slice(0, this.maxSessions)) {
      const id = `TRANSCRIPT:${s.id}`;
      if (seen.has(id)) continue; // one id, one item, even if two directories hold it
      seen.add(id); // a harvested session is never revisited, friction or not
      const events = extractFriction(fs.readFileSync(s.full, "utf8"));
      if (events.length === 0) continue;
      items.push({
        id,
        source: id,
        title: `Session friction ${s.id}`,
        body: renderBody(s.id, s.origin, events, this.maxEvents),
        timestamp: new Date(s.mtimeMs).toISOString(),
      });
    }

    return { items, cursor: encodeSeen([...seen]) };
  }

  /**
   * Refuses to advance partially. The seen-set here is wider than the emitted items —
   * a harvested session with no friction is marked seen and never becomes an item —
   * so a cursor rebuilt from `stored` alone would forget those sessions and harvest
   * them again forever. Re-offering the whole batch costs a re-read; rebuilding from
   * the wrong set costs correctness.
   */
  advanceCursor(previous: Cursor): Cursor {
    return previous;
  }
}

function decodeSeen(cursor: Cursor): string[] {
  if (!cursor) return [];
  try {
    const parsed = JSON.parse(cursor);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function encodeSeen(seen: string[]): string {
  return JSON.stringify(seen);
}
