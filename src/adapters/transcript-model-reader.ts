/**
 * The interpretive transcript read — and the guard that keeps it honest.
 *
 * `transcript.ts` scans a session for error strings and finds `tool_error`,
 * `retry`, `clarifying_question`. Over 24 harvested sessions that channel produced
 * 82 events and not one conceptual item: the friction worth learning from is a
 * wrong framing, a rule misread, an approach abandoned — and none of those leave an
 * exit code behind. The input was never the limitation; the reader was. This module
 * reads the same file for a different thing: a model answers a small FIXED set of
 * questions about the whole session, and its answers become candidate evidence.
 *
 * **The guard is the point of this file, not the reading.** A model's account of
 * what an agent was confused about is an *assertion* about *observed* raw material,
 * and a pass that files it unmarked launders one rung into the other — the exact
 * failure this vault's believability ladder exists to catch. So every candidate
 * must carry a verbatim span from the transcript, and nothing is filed until that
 * span has been located in the very text the reader was handed
 * ({@link renderTranscriptForReading} produces both). A quote that cannot be found
 * is a paraphrase, a reconstruction or an invention, and it is dropped with a
 * reason rather than filed with a caveat.
 *
 * What that buys and what it does not: quote-traceability makes the reading
 * *checkable* by a human against the transcript. It says nothing about whether the
 * reading is any good — whether an interpretive read surfaces anything the regex
 * missed is a blind-rating question that needs a person, and it is open.
 *
 * The reader itself is INJECTED ({@link TranscriptReader}), the adapter pattern
 * this repo already uses for Slack and the web reader: the verification logic is
 * tested offline against a fake, and no model call, credential or cost is incurred
 * by anything in this file. Every session read costs money proportional to how much
 * the product is used, so the caller — not this module — decides when to spend it.
 */
import type { EvidenceItem } from "./source.js";
import { redactSecrets } from "./transcript.js";

/**
 * The fixed question set. Fixed, and not a caller-supplied prompt, because the
 * comparability of two sessions' readings depends on their having been asked the
 * same thing — and because an open prompt is how "read this transcript" becomes
 * "confirm what I already believe about this transcript".
 */
export const READING_QUESTIONS = [
  {
    id: "changed_mind",
    question: "Where did the agent change its mind, and what changed it?",
  },
  {
    id: "abandoned",
    question: "What did it try, abandon, and never come back to?",
  },
  {
    id: "repeated",
    question: "Where did it repeat itself without noticing?",
  },
  {
    id: "belief_shift",
    question: "What did it believe at the start that it did not believe at the end?",
  },
] as const;

export type ReadingQuestionId = (typeof READING_QUESTIONS)[number]["id"];

const QUESTION_IDS = new Set<string>(READING_QUESTIONS.map((q) => q.id));

/** What the injected reader returns, before any of it has been checked. */
export interface ReadingCandidate {
  /** Which of the fixed questions this answers. */
  question: string;
  /** The reader's interpretation, in its own words. Untrusted text. */
  finding: string;
  /** The span the reader claims to have taken verbatim from the transcript. */
  quote: string;
}

/** A candidate that survived {@link verifyReading} and may be filed. */
export interface ReadingItem {
  question: ReadingQuestionId;
  finding: string;
  /** Verified: this exact string was located in the rendered transcript. */
  quote: string;
}

/** Why a candidate was refused. Kept on the result so a caller can report it. */
export type RejectionReason =
  /** Not one of {@link READING_QUESTIONS}. */
  | "unknown-question"
  /** No interpretation offered. */
  | "empty-finding"
  /** No quote at all — the whole guard is that there is always one. */
  | "missing-quote"
  /** Short enough to be locatable by accident, so it traces nothing. */
  | "quote-too-short"
  /** Credential-shaped: cannot be both filed verbatim and safely redacted. */
  | "quote-holds-secret"
  /** Not in the transcript the item claims to come from. */
  | "quote-not-found";

export interface RejectedCandidate {
  candidate: ReadingCandidate;
  reason: RejectionReason;
}

export interface SessionReading {
  sessionId: string;
  /** Every item here carries a quote located in {@link rendered}. */
  items: ReadingItem[];
  rejected: RejectedCandidate[];
  /** Exactly the text the reader was handed and the quotes were checked against. */
  rendered: string;
}

/**
 * The injected reader: whole session in, candidates out.
 *
 * It is handed the *rendered* transcript rather than the raw JSONL precisely so
 * that the text it quotes from and the text its quotes are checked against are the
 * same string. A reader given a different rendering would produce true quotes that
 * fail verification, and the failure would look like dishonesty.
 */
export type TranscriptReader = (input: {
  sessionId: string;
  transcript: string;
  questions: typeof READING_QUESTIONS;
}) => Promise<ReadingCandidate[]>;

/** A quote shorter than this is locatable by coincidence and traces nothing. */
export const MIN_QUOTE_CHARS = 24;
/** Filed quotes are cut to a prefix at this length — a prefix is still verbatim. */
export const MAX_QUOTE_CHARS = 300;
/** How much of one session is handed to the reader. Transcripts are unbounded. */
export const MAX_READING_CHARS = 120_000;

/**
 * Collapse runs of whitespace, and nothing else.
 *
 * The one tolerance, and it is deliberately the only one: JSONL, terminal output
 * and a model's transcription disagree about line breaks and indentation, and
 * about nothing else that matters. Case, punctuation and spelling are compared
 * exactly — a "quote" that differs from the transcript in a word is a paraphrase,
 * which is the thing this file exists to refuse.
 */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The quote as it will be FILED: whitespace-collapsed and cut to a prefix.
 *
 * The cut is a plain prefix with no ellipsis, so the string that lands in the vault
 * is itself locatable in the transcript — a truncation marker would make the filed
 * quote a thing that appears nowhere in the session it cites.
 */
function normalizeQuote(quote: string): string {
  return normalize(quote).slice(0, MAX_QUOTE_CHARS);
}

/** Is this exact span present in the rendered transcript? */
export function locateQuote(quote: string, rendered: string): boolean {
  const needle = normalize(quote);
  if (!needle) return false;
  return normalize(rendered).includes(needle);
}

/** Tool results carry either a string or a list of content blocks. */
function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * Render one session's JSONL as the plain text a reader can actually read.
 *
 * This is both halves of the contract: it is what the model is handed, and it is
 * the corpus a quote must be found in. Malformed lines are skipped rather than
 * failing the session, the same way {@link extractFriction} treats them.
 *
 * Long sessions are elided in the MIDDLE, keeping the head (what the session set
 * out to do) and the tail (what it concluded) — the two ends an interpretive read
 * needs most. The elision is fail-closed for verification: a quote drawn from the
 * omitted middle cannot be located and will not be filed, which is correct, since
 * that text is not in the transcript anyone will be checking against.
 */
export function renderTranscriptForReading(jsonl: string, maxChars = MAX_READING_CHARS): string {
  const lines: string[] = [];
  const toolById = new Map<string, string>();

  for (const raw of jsonl.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const message = entry.message as Record<string, unknown> | undefined;
    const role = typeof message?.role === "string" ? message.role : String(entry.type ?? "entry");
    const content = message?.content;

    if (typeof content === "string") {
      if (content.trim()) lines.push(`[${role}] ${content}`);
      continue;
    }
    if (!Array.isArray(content)) continue;

    for (const block of content as Record<string, unknown>[]) {
      if (block.type === "text") {
        const text = String(block.text ?? "");
        if (text.trim()) lines.push(`[${role}] ${text}`);
        continue;
      }
      if (block.type === "tool_use") {
        const name = String(block.name ?? "");
        const id = String(block.id ?? "");
        if (id) toolById.set(id, name);
        lines.push(`[${role} → ${name}] ${JSON.stringify(block.input ?? {})}`);
        continue;
      }
      if (block.type === "tool_result") {
        const name = toolById.get(String(block.tool_use_id ?? "")) ?? "tool";
        const status = block.is_error === true ? "error" : "ok";
        lines.push(`[${name} ${status}] ${blockText(block.content)}`);
      }
    }
  }

  const text = lines.join("\n");
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.6);
  const tail = maxChars - head;
  const omitted = text.length - maxChars;
  return `${text.slice(0, head)}\n… [${omitted} characters omitted] …\n${text.slice(text.length - tail)}`;
}

/**
 * Check every candidate against the transcript it claims to come from.
 *
 * Fail-closed in each case: a candidate that cannot be checked is refused, never
 * filed with a warning attached. The refused ones are returned rather than dropped
 * silently, because "the reader produced nine claims and one survived" is itself
 * the finding about the reader.
 */
export function verifyReading(
  candidates: readonly ReadingCandidate[],
  rendered: string,
): { items: ReadingItem[]; rejected: RejectedCandidate[] } {
  const items: ReadingItem[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const candidate of candidates) {
    const refuse = (reason: RejectionReason): void => {
      rejected.push({ candidate, reason });
    };

    if (!QUESTION_IDS.has(candidate.question)) {
      refuse("unknown-question");
      continue;
    }
    const finding = normalize(candidate.finding ?? "");
    if (!finding) {
      refuse("empty-finding");
      continue;
    }
    const quote = normalizeQuote(candidate.quote ?? "");
    if (!quote) {
      refuse("missing-quote");
      continue;
    }
    if (quote.length < MIN_QUOTE_CHARS) {
      refuse("quote-too-short");
      continue;
    }
    // A credential-shaped span is refused rather than masked. Masking it would
    // file a quote that is no longer the text it cites — verbatim and redacted
    // cannot both hold — and the vault is committed to git, so the fail-closed
    // answer is the only one available.
    if (redactSecrets(quote) !== quote) {
      refuse("quote-holds-secret");
      continue;
    }
    if (!locateQuote(quote, rendered)) {
      refuse("quote-not-found");
      continue;
    }
    items.push({ question: candidate.question as ReadingQuestionId, finding, quote });
  }

  return { items, rejected };
}

/** Read one session interpretively. A reader that throws yields no items, not a crash. */
export async function readSession(
  sessionId: string,
  jsonl: string,
  reader: TranscriptReader,
  maxChars = MAX_READING_CHARS,
): Promise<SessionReading> {
  const rendered = renderTranscriptForReading(jsonl, maxChars);
  let candidates: ReadingCandidate[] = [];
  try {
    candidates = (await reader({ sessionId, transcript: rendered, questions: READING_QUESTIONS })) ?? [];
  } catch {
    // A reader that fails is a channel that produced nothing this pass. It is not
    // a reason to lose the mechanical harvest running beside it.
    candidates = [];
  }
  const { items, rejected } = verifyReading(candidates, rendered);
  return { sessionId, items, rejected, rendered };
}

function questionText(id: ReadingQuestionId): string {
  return READING_QUESTIONS.find((q) => q.id === id)?.question ?? id;
}

function renderBody(reading: SessionReading): string {
  const lines = [
    `An interpretive read of session \`${reading.sessionId}\` answered ${reading.items.length} of the ${READING_QUESTIONS.length} standing questions with a traceable quote.`,
    "",
    "Evidence class: **model assertion over observed material** — a reader that was not in the session interpreting a transcript. The transcript is observed behavior; this reading of it is not, and it must not be counted as observed. Every claim below carries the verbatim span it was drawn from, located in the transcript, so a human can check the reading against the source.",
    "",
  ];
  for (const item of reading.items) {
    lines.push(`- **${item.question}** — ${questionText(item.question)}`);
    lines.push(`  - ${item.finding}`);
    lines.push(`  - > ${item.quote}`);
  }
  if (reading.rejected.length > 0) {
    const counts = new Map<RejectionReason, number>();
    for (const r of reading.rejected) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
    lines.push(
      "",
      `${reading.rejected.length} further claim(s) were refused for want of a traceable quote (${[...counts]
        .map(([reason, n]) => `${reason} ×${n}`)
        .join(", ")}).`,
    );
  }
  return lines.join("\n");
}

/**
 * Turn a verified reading into a filed evidence item — the last gate.
 *
 * It re-checks every quote against the rendered transcript instead of trusting
 * that {@link verifyReading} ran, and THROWS if one does not hold. Belt and
 * braces on purpose: this is the only function that can put an interpretation
 * into the vault, the vault is append-only, and an unverified quote committed
 * there cannot be taken back.
 *
 * Returns null when the reading produced nothing — an item that says "the model
 * found nothing" is noise the tree has to carry forever.
 */
export function toEvidenceItem(reading: SessionReading, timestamp: string): EvidenceItem | null {
  for (const item of reading.items) {
    if (!locateQuote(item.quote, reading.rendered)) {
      throw new Error(
        `refusing to file a reading of ${reading.sessionId}: the quote "${item.quote.slice(0, 60)}…" is not in that transcript`,
      );
    }
  }
  if (reading.items.length === 0) return null;
  const id = `TRANSCRIPT:${reading.sessionId}#reading`;
  return {
    id,
    source: id,
    title: `Session reading ${reading.sessionId}`,
    body: renderBody(reading),
    timestamp,
  };
}
