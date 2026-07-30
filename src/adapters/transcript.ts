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

export interface FrictionEvent {
  kind: FrictionKind;
  /** The tool involved, when the signal came from a tool call. */
  tool?: string;
  /** Short, redacted excerpt — enough context to interpret the event later. */
  detail: string;
  /** ISO timestamp of the transcript entry. */
  timestamp: string;
}

export interface TranscriptSourceOptions {
  /** Directory of `*.jsonl` session transcripts. */
  dir: string;
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

      if (block.type === "tool_result" && block.is_error === true) {
        const tool = toolById.get(String(block.tool_use_id ?? ""))?.name;
        const body = resultText(block.content);
        const denied = DENIAL_PATTERNS.some((re) => re.test(body));
        events.push({
          kind: denied ? "permission_denied" : "tool_error",
          tool,
          detail: errorDetail(body),
          timestamp,
        });
      }
    }
  }

  return events;
}

function renderBody(sessionId: string, events: FrictionEvent[], shown: FrictionEvent[]): string {
  const counts = new Map<FrictionKind, number>();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const summary = [...counts.entries()].map(([kind, n]) => `${kind} ×${n}`).join(", ");

  const lines = [
    `Session \`${sessionId}\` produced ${events.length} friction events (${summary}).`,
    "",
    "Evidence class: **observed behavior** — the agent's own usage of this product, captured mechanically from its session transcript. It is not outside-user demand data: it grounds usability, not desirability, and must not be counted as external evidence of want.",
    "",
    shown.length < events.length
      ? `Showing the first ${shown.length}; the rest are counted only.`
      : "All events shown.",
    "",
  ];
  for (const e of shown) {
    lines.push(`- **${e.kind}**${e.tool ? ` (${e.tool})` : ""}: ${e.detail}`);
  }
  return lines.join("\n");
}

export class TranscriptSource implements Source {
  readonly name = "transcript";
  readonly actor: Actor = "transcript";
  private readonly dir: string;
  private readonly quietMinutes: number;
  private readonly maxEvents: number;
  private readonly maxSessions: number;

  constructor(opts: TranscriptSourceOptions) {
    this.dir = path.resolve(opts.dir);
    this.quietMinutes = opts.quietMinutes ?? DEFAULT_QUIET_MINUTES;
    this.maxEvents = opts.maxEventsPerSession ?? DEFAULT_MAX_EVENTS;
    this.maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
  }

  async fetchSince(cursor: Cursor): Promise<FetchResult> {
    const seen = new Set<string>(decodeSeen(cursor));
    if (!fs.existsSync(this.dir)) return { items: [], cursor };

    const quietBefore = Date.now() - this.quietMinutes * 60_000;
    const sessions = fs
      .readdirSync(this.dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
      .map((e) => {
        const full = path.join(this.dir, e.name);
        return { id: e.name.replace(/\.jsonl$/, ""), full, mtimeMs: fs.statSync(full).mtimeMs };
      })
      .filter((s) => !seen.has(`TRANSCRIPT:${s.id}`) && s.mtimeMs <= quietBefore)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, this.maxSessions);

    const items: EvidenceItem[] = [];
    for (const s of sessions) {
      const id = `TRANSCRIPT:${s.id}`;
      seen.add(id); // a harvested session is never revisited, friction or not
      const events = extractFriction(fs.readFileSync(s.full, "utf8"));
      if (events.length === 0) continue;
      const shown = events.slice(0, this.maxEvents);
      items.push({
        id,
        source: id,
        title: `Session friction ${s.id}`,
        body: renderBody(s.id, events, shown),
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
